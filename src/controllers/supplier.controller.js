const { Op }               = require('sequelize')
const sequelize             = require('../db/db-sequelize')
const SupplierModel         = require('../models/supplier.model')
const PurchaseModel         = require('../models/purchase.model')
const CashTransactionModel  = require('../models/cash_transaction.model')
const SupplierEntryModel    = require('../models/supplier_entry.model')
const { kursOqi }           = require('./valyuta.controller')

const HttpException         = require('../utils/HttpException.utils')
const BaseController        = require('./BaseController')

const r2 = v => Math.round((Number(v) || 0) * 100) / 100
const r4 = v => Math.round((Number(v) || 0) * 10000) / 10000

/**
 * Yetkazuvchilar balansi — to'rt manbadan:
 *   kirimlar (purchase, tasdiqlangan)      → qarz
 *   kassadan to'lovlar (cash_transaction)  → qarz kamayadi
 *   qo'lda: qarz / kassadan tashqari to'lov (supplier_entry)
 * Manfiy = biz qarzdormiz. Dollardagi hisob ham shu yo'l bilan.
 */
async function balanslar(ids, transaction) {
  const natija = new Map(ids.map(id => [Number(id), { som: 0, usd: 0 }]))
  if (!ids.length) return natija
  const [kirim, tolov, qolda] = await Promise.all([
    PurchaseModel.findAll({
      attributes: ['supplier_id', [sequelize.fn('SUM', sequelize.col('total_sum')), 'som'], [sequelize.fn('SUM', sequelize.col('total_usd')), 'usd']],
      where: { supplier_id: { [Op.in]: ids }, status: 'confirmed' }, group: ['supplier_id'], raw: true, transaction,
    }),
    CashTransactionModel.findAll({
      attributes: ['reference_id', [sequelize.fn('SUM', sequelize.col('amount')), 'som'], [sequelize.fn('SUM', sequelize.col('amount_usd')), 'usd']],
      where: { reference_type: 'supplier_payment', reference_id: { [Op.in]: ids } }, group: ['reference_id'], raw: true, transaction,
    }),
    SupplierEntryModel.findAll({
      attributes: ['supplier_id', 'type', [sequelize.fn('SUM', sequelize.col('amount')), 'som'], [sequelize.fn('SUM', sequelize.col('amount_usd')), 'usd']],
      where: { supplier_id: { [Op.in]: ids } }, group: ['supplier_id', 'type'], raw: true, transaction,
    }),
  ])
  const qosh = (id, som, usd) => { const b = natija.get(Number(id)); if (b) { b.som += Number(som) || 0; b.usd += Number(usd) || 0 } }
  kirim.forEach(r => qosh(r.supplier_id, -r.som, -r.usd))
  tolov.forEach(r => qosh(r.reference_id, r.som, r.usd))
  qolda.forEach(r => r.type === 'qarz' ? qosh(r.supplier_id, -r.som, -r.usd) : qosh(r.supplier_id, r.som, r.usd))
  for (const b of natija.values()) { b.som = r2(b.som); b.usd = r4(b.usd) }
  return natija
}

// Saqlangan balans hisoblanganidan farq qilsa — to'g'rilaydi
async function balansniYoz(supplier, b, transaction) {
  if (Number(supplier.balance) !== b.som || Number(supplier.balance_usd) !== b.usd) {
    await supplier.update({ balance: b.som, balance_usd: b.usd }, { transaction })
  }
}

// Summani hisob valyutasiga moslash: dollardagi yetkazuvchida $ asosiy
function summalar(s, body, kurs) {
  const usdHisob = s.currency === 'USD'
  if (usdHisob) {
    const usd = r4(body.amount_usd)
    return { usdHisob, usd, som: r2(usd * kurs) }
  }
  const som = r2(body.amount)
  return { usdHisob, som, usd: kurs > 0 ? r4(som / kurs) : 0 }
}

function sanaOl(v) {
  if (!v) return new Date()
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) throw new HttpException(400, "Sana noto'g'ri")
  if (d.getTime() > Date.now() + 60_000) throw new HttpException(400, "Kelajakdagi sana bo'lmaydi")
  return d
}

class SupplierController extends BaseController {

  getAll = async (req, res) => {
    const { search, active } = req.query
    const where = {}
    if (active !== undefined) where.active = active === 'true'
    if (search) {
      where[Op.or] = [
        { name:  { [Op.like]: `%${search}%` } },
        { phone: { [Op.like]: `%${search}%` } },
        { code:  { [Op.like]: `%${search}%` } },
      ]
    }
    // Ro'yxat cheklanadi — global qidiruv har harfda shu endpointni
    // chaqiradi, cheksiz ro'yxat esa yetkazuvchi ko'paygan sari sekinlashadi
    const limit = Math.min(Number(req.query.limit) > 0 ? Number(req.query.limit) : 200, 500)
    const rows = await SupplierModel.findAll({ where, order: [['name', 'ASC']], limit })
    if (!rows.length) return res.json(rows)

    const ids = rows.map(s => s.id)
    // Balanslar guruhlangan so'rovlarda hisoblanadi (har yetkazuvchiga
    // alohida so'rov emas); saqlangani farq qilsa — to'g'rilanadi
    const bal = await balanslar(ids)
    for (const s of rows) {
      const b = bal.get(s.id)
      await balansniYoz(s, b)
      s.balance = b.som
      s.balance_usd = b.usd
    }

    res.json(rows)
  }

  getById = async (req, res) => {
    const s = await SupplierModel.findByPk(req.params.id)
    if (!s) throw new HttpException(404, req.mf('data not found'))
    res.json(s)
  }

  create = async (req, res) => {
    const { name, phone, address, comment, code } = req.body
    if (!name) throw new HttpException(400, 'Yetkazuvchi ismi majburiy')
    const currency = req.body.currency === 'USD' ? 'USD' : 'UZS'
    const supplier = await SupplierModel.create({ name, phone, address, comment, code, currency, balance: 0 })
    res.status(201).json(supplier)
  }

  update = async (req, res) => {
    const s = await SupplierModel.findByPk(req.params.id)
    if (!s) throw new HttpException(404, req.mf('data not found'))
    const { name, phone, address, comment, code, active } = req.body
    const patch = { name, phone, address, comment, code, active }
    if (req.body.currency !== undefined) patch.currency = req.body.currency === 'USD' ? 'USD' : 'UZS'
    await s.update(patch)
    res.json(s)
  }

  delete = async (req, res) => {
    const s = await SupplierModel.findByPk(req.params.id)
    if (!s) throw new HttpException(404, req.mf('data not found'))
    // Qarzi bor yetkazuvchi o'chirilmaydi (hisob valyutasida tekshiriladi)
    const b = (await balanslar([s.id])).get(s.id)
    if ((s.currency === 'USD' ? b.usd : b.som) < -0.005) throw new HttpException(400, 'Qarzli yetkazuvchini o\'chirib bo\'lmaydi')
    await s.destroy()
    res.json({ message: req.mf('data has been deleted') })
  }

  /**
   * POST /suppliers/:id/pay — yetkazuvchiga to'lov
   *   { amount | amount_usd, payment_type, comment, kassadan = true, date }
   * Dollardagi yetkazuvchida summa $ da (so'mi joriy kursdan).
   * kassadan = false — avval yoki boshqa manbadan to'langan: kassaga
   * yozilmaydi (bugungi kassa qoldig'i buzilmaydi), faqat qarz kamayadi.
   */
  pay = async (req, res) => {
    const s = await SupplierModel.findByPk(req.params.id)
    if (!s) throw new HttpException(404, req.mf('data not found'))

    const { kurs } = await kursOqi()
    const { usdHisob, som, usd } = summalar(s, req.body, kurs)
    if (!((usdHisob ? usd : som) > 0)) throw new HttpException(400, "Summa noto'g'ri")
    const kassadan    = req.body.kassadan !== false
    const safePayType = ['Naqd', 'Karta', "O'tkazma"].includes(req.body.payment_type) ? req.body.payment_type : 'Naqd'
    const sana        = sanaOl(req.body.date)
    const izoh        = String(req.body.comment || '').trim().slice(0, 300)
    const cashierId   = req.currentUser?.id ?? null

    await sequelize.transaction(async (t) => {
      const b = (await balanslar([s.id], t)).get(s.id)
      const qarz = usdHisob ? Math.max(0, -b.usd) : Math.max(0, -b.som)
      if ((usdHisob ? usd : som) > qarz + (usdHisob ? 0.01 : 1)) {
        const q = usdHisob ? `${qarz.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} $` : `${Math.round(qarz).toLocaleString('ru-RU')} so'm`
        throw new HttpException(400, `Qarz miqdoridan ko'p to'lab bo'lmaydi. Qarz: ${q}`)
      }
      const nomi = usdHisob ? `${usd.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} $` : ''
      if (kassadan) {
        await CashTransactionModel.create({
          date:           sana,
          type:           'expense',
          amount:         som,
          amount_usd:     usd,
          exchange_rate:  kurs,
          payment_type:   safePayType,
          reference_id:   s.id,
          reference_type: 'supplier_payment',
          description:    `Yetkazuvchiga to'lov: ${s.name}${nomi ? ` (${nomi})` : ''}${izoh ? ` · ${izoh}` : ''}`,
          cashier_id:     cashierId,
        }, { transaction: t })
      } else {
        await SupplierEntryModel.create({
          supplier_id: s.id, date: sana, type: 'tolov',
          amount: som, amount_usd: usd, exchange_rate: kurs,
          comment: izoh || "Kassadan tashqari to'lov", created_by: cashierId,
        }, { transaction: t })
      }
      await balansniYoz(s, (await balanslar([s.id], t)).get(s.id), t)
    })

    res.json(await SupplierModel.findByPk(s.id))
  }

  /**
   * POST /suppliers/:id/debt — qarzni qo'lda kiritish
   *   { amount | amount_usd, date, comment }
   * Masalan tizimdan oldingi qarz yoki akt-sverka bo'yicha farq.
   */
  debt = async (req, res) => {
    const s = await SupplierModel.findByPk(req.params.id)
    if (!s) throw new HttpException(404, req.mf('data not found'))
    const { kurs } = await kursOqi()
    const { usdHisob, som, usd } = summalar(s, req.body, kurs)
    if (!((usdHisob ? usd : som) > 0)) throw new HttpException(400, "Summa noto'g'ri")
    const izoh = String(req.body.comment || '').trim().slice(0, 300)
    await sequelize.transaction(async (t) => {
      await SupplierEntryModel.create({
        supplier_id: s.id, date: sanaOl(req.body.date), type: 'qarz',
        amount: som, amount_usd: usd, exchange_rate: kurs,
        comment: izoh || 'Qarz kiritildi', created_by: req.currentUser?.id ?? null,
      }, { transaction: t })
      await balansniYoz(s, (await balanslar([s.id], t)).get(s.id), t)
    })
    res.json(await SupplierModel.findByPk(s.id))
  }

  // DELETE /suppliers/:id/entries/:entryId — qo'lda kiritilgan yozuvni o'chirish
  deleteEntry = async (req, res) => {
    const s = await SupplierModel.findByPk(req.params.id)
    if (!s) throw new HttpException(404, req.mf('data not found'))
    const e = await SupplierEntryModel.findOne({ where: { id: req.params.entryId, supplier_id: s.id } })
    if (!e) throw new HttpException(404, 'Yozuv topilmadi')
    await sequelize.transaction(async (t) => {
      await e.destroy({ transaction: t })
      await balansniYoz(s, (await balanslar([s.id], t)).get(s.id), t)
    })
    res.json(await SupplierModel.findByPk(s.id))
  }

  // GET /suppliers/:id/purchases — shu yetkazuvchining xaridlari
  getPurchases = async (req, res) => {
    const rows = await PurchaseModel.findAll({
      where:  { supplier_id: req.params.id },
      order:  [['date', 'DESC']],
      limit:  50,
    })
    res.json(rows)
  }

  // GET /suppliers/:id/ledger — oldi-berdi tarixi (so'm va $ da)
  getLedger = async (req, res) => {
    const id = req.params.id
    const s  = await SupplierModel.findByPk(id)
    if (!s) throw new HttpException(404, req.mf('data not found'))

    const [purchases, payments, qolda] = await Promise.all([
      PurchaseModel.findAll({ where: { supplier_id: id, status: 'confirmed' }, order: [['date', 'ASC']] }),
      CashTransactionModel.findAll({ where: { reference_type: 'supplier_payment', reference_id: id }, order: [['date', 'ASC']] }),
      SupplierEntryModel.findAll({ where: { supplier_id: id }, order: [['date', 'ASC']] }),
    ])

    const entries = []
    purchases.forEach(p => entries.push({
      id: `purchase-${p.id}`, type: 'purchase', date: p.date, doc_number: p.doc_number,
      description: p.comment ? `Kirim #${p.doc_number} · ${String(p.comment).replace(/^Boshlang'ich qoldiq · /, '')}` : `Kirim #${p.doc_number}`,
      payment_type: null,
      total_sum: Number(p.total_sum) || 0, total_usd: Number(p.total_usd) || 0,
      exchange_rate: Number(p.exchange_rate) || 0,
      debit: Number(p.total_sum) || 0, debit_usd: Number(p.total_usd) || 0, credit: 0, credit_usd: 0,
    }))
    payments.forEach(p => entries.push({
      id: `payment-${p.id}`, type: 'payment', date: p.date,
      description: p.description || "Yetkazuvchiga to'lov", payment_type: p.payment_type,
      exchange_rate: Number(p.exchange_rate) || 0,
      debit: 0, debit_usd: 0, credit: Number(p.amount) || 0, credit_usd: Number(p.amount_usd) || 0,
    }))
    qolda.forEach(e => entries.push({
      id: `entry-${e.id}`, entry_id: e.id, manual: true, type: e.type, date: e.date,
      description: e.comment || (e.type === 'qarz' ? 'Qarz kiritildi' : "Kassadan tashqari to'lov"),
      payment_type: null, exchange_rate: Number(e.exchange_rate) || 0,
      debit:      e.type === 'qarz'  ? Number(e.amount) || 0 : 0,
      debit_usd:  e.type === 'qarz'  ? Number(e.amount_usd) || 0 : 0,
      credit:     e.type === 'tolov' ? Number(e.amount) || 0 : 0,
      credit_usd: e.type === 'tolov' ? Number(e.amount_usd) || 0 : 0,
    }))

    entries.sort((a, b) => new Date(a.date) - new Date(b.date))
    let som = 0, usd = 0
    entries.forEach(e => {
      som = r2(som - e.debit + e.credit)
      usd = r4(usd - e.debit_usd + e.credit_usd)
      e.running_balance = som
      e.running_usd = usd
    })

    await balansniYoz(s, { som, usd })
    const { kurs } = await kursOqi()
    res.json({
      supplier: { ...s.toJSON(), balance: som, balance_usd: usd },
      entries:  entries.reverse(),
      balance:  som,
      balance_usd: usd,
      kurs,
    })
  }
}

module.exports = new SupplierController()
