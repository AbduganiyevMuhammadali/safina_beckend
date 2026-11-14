/**
 * Qarz to'lovini sotuvlar (va nasiya oylari) orasida taqsimlash.
 *
 * Qoidalar:
 *   • To'lov eng birinchi muddati kelgan qarzga yoziladi: nasiyada —
 *     eng eski to'lanmagan oy, oddiy qarzda — sotuvning muddati.
 *     Muddatsiz qarzlar eng oxirida.
 *   • `saleId` berilsa — faqat shu shartnomaga yoziladi.
 *   • `sale.debt_sum` (dastlabki qarz) o'zgarmaydi, to'lov `debt_paid` ga
 *     qo'shiladi. Mijoz hisob varag'i debt_sum ni dastlabki qarz deb
 *     hisoblaydi — uni buzmaslik uchun.
 *   • Nasiyada sotuvning `due_date` i doim navbatdagi to'lanmagan oy
 *     sanasiga suriladi — Qarzdorlar bo'limidagi "kechikkan / bugun"
 *     toifalari shu orqali to'g'ri ishlaydi.
 */
const { Op } = require('sequelize')
const SaleModel            = require('../models/sale.model')
const SaleInstallmentModel = require('../models/sale_installment.model')
const SalePaymentModel     = require('../models/sale_payment.model')

const r2 = v => Math.round((Number(v) || 0) * 100) / 100
const TIYIN = 0.005

// Sotuvdagi qolgan qarz
function qolgan(sale) {
  return r2((Number(sale.debt_sum) || 0) - (Number(sale.debt_paid) || 0))
}

// Nasiyada navbatdagi to'lanmagan oy sanasi (hammasi to'langan bo'lsa — oxirgisi)
async function navbatdagiSana(saleId, transaction) {
  const rows = await SaleInstallmentModel.findAll({
    where: { sale_id: saleId }, order: [['no', 'ASC']], transaction,
  })
  if (!rows.length) return null
  const ochiq = rows.find(r => r2(r.amount - r.paid) > TIYIN)
  return String((ochiq || rows[rows.length - 1]).due_date).slice(0, 10)
}

/**
 * To'lovni taqsimlaydi. Qaytaradi:
 *   { taqsimlandi, ortiqcha, sotuvlar: [{ sale_id, doc_number, summa, oylar: [{no, summa}] }] }
 */
async function tolovniTaqsimla({
  clientId, amount, saleId = null, transaction,
  date = new Date(), paymentType = null, cashierName = null, cashTransactionId = null,
}) {
  let qoldi = r2(amount)

  const where = {
    client_id: clientId,
    status: { [Op.ne]: 'cancelled' },
    debt_sum: { [Op.gt]: 0 },
  }
  if (saleId) where.id = saleId
  const sales = (await SaleModel.findAll({
    where, order: [['date', 'ASC'], ['id', 'ASC']], transaction,
  })).filter(s => qolgan(s) > TIYIN)

  if (!sales.length) return { taqsimlandi: 0, ortiqcha: qoldi, sotuvlar: [] }

  const grafiklar = await SaleInstallmentModel.findAll({
    where: { sale_id: { [Op.in]: sales.map(s => s.id) } },
    order: [['due_date', 'ASC'], ['no', 'ASC']],
    transaction,
  })
  const grafikBySale = new Map()
  for (const g of grafiklar) {
    if (!grafikBySale.has(g.sale_id)) grafikBySale.set(g.sale_id, [])
    grafikBySale.get(g.sale_id).push(g)
  }

  // Majburiyatlar ro'yxati: nasiya oylari + oddiy qarzlar
  const majburiyat = []
  for (const s of sales) {
    const oylar = grafikBySale.get(s.id)
    if (oylar?.length) {
      for (const g of oylar) {
        const q = r2(g.amount - g.paid)
        if (q > TIYIN) majburiyat.push({ sale: s, oy: g, due: String(g.due_date).slice(0, 10), q })
      }
    } else {
      majburiyat.push({
        sale: s, oy: null,
        due: s.due_date ? String(s.due_date).slice(0, 10) : '9999-12-31',
        q: qolgan(s),
      })
    }
  }
  majburiyat.sort((a, b) =>
    a.due.localeCompare(b.due)
    || (new Date(a.sale.date) - new Date(b.sale.date))
    || ((a.oy?.no || 0) - (b.oy?.no || 0)))

  const saleQoldi = new Map(sales.map(s => [s.id, qolgan(s)]))
  const natija = new Map()   // sale_id -> { summa, oylar }

  for (const m of majburiyat) {
    if (qoldi <= TIYIN) break
    const x = r2(Math.min(qoldi, m.q, saleQoldi.get(m.sale.id)))
    if (x <= TIYIN) continue

    if (m.oy) {
      const yangi = r2(Number(m.oy.paid) + x)
      await m.oy.update({
        paid: yangi,
        paid_at: r2(m.oy.amount - yangi) <= TIYIN ? date : m.oy.paid_at,
      }, { transaction })
    }
    qoldi = r2(qoldi - x)
    saleQoldi.set(m.sale.id, r2(saleQoldi.get(m.sale.id) - x))

    if (!natija.has(m.sale.id)) natija.set(m.sale.id, { sale: m.sale, summa: 0, oylar: [] })
    const n = natija.get(m.sale.id)
    n.summa = r2(n.summa + x)
    if (m.oy) n.oylar.push({ no: m.oy.no, summa: x })
  }

  // Sotuvlarni yangilash + to'lov tarixi
  for (const { sale, summa } of natija.values()) {
    const patch = { debt_paid: r2(Number(sale.debt_paid) + summa) }
    if (grafikBySale.has(sale.id)) patch.due_date = await navbatdagiSana(sale.id, transaction)
    await sale.update(patch, { transaction })
    await SalePaymentModel.create({
      sale_id: sale.id,
      client_id: clientId,
      cash_transaction_id: cashTransactionId,
      date,
      amount: summa,
      payment_type: paymentType,
      cashier_name: cashierName,
    }, { transaction })
  }

  const sotuvlar = [...natija.values()].map(n => ({
    sale_id: n.sale.id, doc_number: n.sale.doc_number, summa: n.summa, oylar: n.oylar,
  }))
  return { taqsimlandi: r2(amount - qoldi), ortiqcha: qoldi, sotuvlar }
}

/**
 * Qaytarishda nasiya grafigini kamaytiradi — oxirgi oydan boshlab
 * (mijoz eng uzoq muddatli to'lovlardan ozod bo'ladi).
 */
async function grafikniKamaytir(saleId, summa, transaction) {
  let qoldi = r2(summa)
  if (qoldi <= TIYIN) return
  const rows = await SaleInstallmentModel.findAll({
    where: { sale_id: saleId }, order: [['no', 'DESC']], transaction,
  })
  for (const g of rows) {
    if (qoldi <= TIYIN) break
    const ochiq = r2(g.amount - g.paid)
    if (ochiq <= TIYIN) continue
    const x = Math.min(ochiq, qoldi)
    await g.update({ amount: r2(g.amount - x) }, { transaction })
    qoldi = r2(qoldi - x)
  }
}

module.exports = { tolovniTaqsimla, grafikniKamaytir, navbatdagiSana, qolgan }
