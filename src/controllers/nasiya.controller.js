const { Op } = require('sequelize')
const AppSettingModel      = require('../models/app_setting.model')
const SaleModel            = require('../models/sale.model')
const SaleItemModel        = require('../models/sale_item.model')
const SaleInstallmentModel = require('../models/sale_installment.model')
const SalePaymentModel     = require('../models/sale_payment.model')
const ClientModel          = require('../models/client.model')
const UserModel            = require('../models/user.model')
const HttpException        = require('../utils/HttpException.utils')
const { normalizeConfig, bugunKey } = require('../utils/nasiya.utils')
const { normPasport, normPinfl, pasportTogri, pinflTogri } = require('../utils/pasport.utils')
const { pasportTekshir } = require('./client.controller')

const CONFIG_KEY = 'nasiya_config'
const r2 = v => Math.round((Number(v) || 0) * 100) / 100
const TIYIN = 0.005

// Sozlamani bazadan o'qiydi (yo'q bo'lsa — standart, Excel jadvalidagi foizlar)
async function configOqi() {
  const row = await AppSettingModel.findOne({ where: { key: CONFIG_KEY } })
  let raw = null
  try { raw = row?.value ? JSON.parse(row.value) : null } catch { raw = null }
  return normalizeConfig(raw)
}

function kunFarqi(a, b) {
  return Math.round((new Date(a) - new Date(b)) / 86400000)
}

const sonM = v => new Intl.NumberFormat('ru-RU').format(Math.round(Number(v) || 0)).replace(/\s/g, ' ')
// Muddatidan shuncha kun keyin to'langan oy "kechikkan" hisoblanadi
const KECHIKISH_CHEGARA = 3

function sanaKeyD(d) {
  const x = new Date(d)
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
}

/**
 * Mijozning do'kondagi kredit tarixi va reytingi.
 *
 * Asos — shu do'konning o'z ma'lumotlari: nasiya shartnomalari (har oy
 * qachon to'langani), oddiy qarzlar va mijoz statusi. Reyting 0–100 ball,
 * har bir chegirma sababi bilan ko'rsatiladi — kassir nima uchun shunday
 * baho chiqqanini ko'rib turadi.
 */
async function kreditHisobla(client) {
  const bugun = bugunKey()
  const sales = await SaleModel.findAll({
    where: { client_id: client.id, status: { [Op.ne]: 'cancelled' } },
    include: [{ model: SaleItemModel, as: 'items', attributes: ['product_name'] }],
    order: [['date', 'DESC']],
  })
  const nasiyalar = sales.filter(s => Number(s.installment_months) > 0)
  const oylarRaw = nasiyalar.length ? await SaleInstallmentModel.findAll({
    where: { sale_id: { [Op.in]: nasiyalar.map(s => s.id) } }, order: [['no', 'ASC']], raw: true,
  }) : []
  const bySale = new Map()
  for (const g of oylarRaw) {
    if (!bySale.has(g.sale_id)) bySale.set(g.sale_id, [])
    bySale.get(g.sale_id).push(g)
  }

  // ── Nasiya shartnomalari ────────────────────────────────────────
  let kechTolov = 0, engKopKech = 0, vaqtidaTolov = 0
  const shartnomalar = nasiyalar.map(s => {
    const oylar = bySale.get(s.id) || []
    const h = holatHisobla(s, oylar, bugun)
    for (const g of oylar) {
      if (!g.paid_at || !(Number(g.amount) > 0)) continue
      const kech = kunFarqi(sanaKeyD(g.paid_at), String(g.due_date).slice(0, 10))
      if (kech > KECHIKISH_CHEGARA) { kechTolov++; engKopKech = Math.max(engKopKech, kech) }
      else vaqtidaTolov++
    }
    return {
      id: s.id, docNumber: s.doc_number, date: s.date,
      months: s.installment_months, narx: Number(s.installment_base) || 0,
      tovarlar: (s.items || []).map(i => i.product_name).join(', '),
      jami: h.jami, tolangan: h.tolangan, qolgan: h.qolgan,
      kechikkan: h.kechikkan, kechikkanKun: h.kechikkanKun, holat: h.holat,
    }
  })

  // ── Oddiy qarzlar (nasiyasiz) ───────────────────────────────────
  let oddiyQarz = 0, oddiyKech = 0, oddiyKechKun = 0
  for (const s of sales) {
    if (Number(s.installment_months) > 0) continue
    const q = r2(Number(s.debt_sum) - Number(s.debt_paid))
    if (q <= TIYIN) continue
    oddiyQarz = r2(oddiyQarz + q)
    const due = s.due_date ? String(s.due_date).slice(0, 10) : null
    if (due && due < bugun) {
      oddiyKech = r2(oddiyKech + q)
      oddiyKechKun = Math.max(oddiyKechKun, kunFarqi(bugun, due))
    }
  }

  const faol      = shartnomalar.filter(x => x.holat !== 'yopilgan')
  const yopilgan  = shartnomalar.filter(x => x.holat === 'yopilgan')
  const kechikkan = r2(shartnomalar.reduce((a, x) => a + x.kechikkan, 0) + oddiyKech)
  const kechKun   = Math.max(0, oddiyKechKun, ...shartnomalar.map(x => x.kechikkanKun))
  const qolgan    = r2(faol.reduce((a, x) => a + x.qolgan, 0) + oddiyQarz)

  const jami = {
    xaridlar: sales.length,
    birinchiXarid: sales.length ? sales[sales.length - 1].date : null,
    shartnomalar: shartnomalar.length,
    faol: faol.length,
    yopilgan: yopilgan.length,
    nasiyaJami: r2(shartnomalar.reduce((a, x) => a + x.jami, 0)),
    tolangan: r2(shartnomalar.reduce((a, x) => a + x.tolangan, 0)),
    qolgan, oddiyQarz, kechikkan, kechikkanKun: kechKun,
    kechTolov, vaqtidaTolov, engKopKech,
  }

  // ── Reyting ─────────────────────────────────────────────────────
  const sabablar = []
  const status = client.status || 'faol'
  const tarixBor = sales.length > 0
  let ball = 100

  if (yopilgan.length) {
    ball += Math.min(10, yopilgan.length * 5)
    sabablar.push({ tur: 'ok', matn: `${yopilgan.length} ta nasiya to'liq yopilgan` })
  }
  if (faol.length) {
    sabablar.push({ tur: 'info', matn: `${faol.length} ta faol shartnoma — qolgan ${sonM(faol.reduce((a, x) => a + x.qolgan, 0))} so'm` })
  }
  if (kechTolov) {
    ball -= Math.min(30, kechTolov * 6)
    if (engKopKech > 30) ball -= 10
    sabablar.push({ tur: 'warn', matn: `${kechTolov} marta kechiktirib to'lagan (eng ko'pi ${engKopKech} kun)` })
  } else if (vaqtidaTolov) {
    sabablar.push({ tur: 'ok', matn: `Barcha ${vaqtidaTolov} ta oylik to'lov o'z vaqtida` })
  }
  if (kechikkan > TIYIN) {
    ball -= kechKun > 60 ? 50 : kechKun > 30 ? 35 : 20
    sabablar.push({ tur: 'bad', matn: `Hozir ${kechKun} kun kechikkan: ${sonM(kechikkan)} so'm` })
  }
  if (oddiyQarz > TIYIN) {
    sabablar.push({ tur: oddiyKech > TIYIN ? 'bad' : 'info', matn: `Oddiy qarzi: ${sonM(oddiyQarz)} so'm` })
  }
  if (status === 'muammoli') { ball -= 20; sabablar.push({ tur: 'bad', matn: 'Mijoz "muammoli" deb belgilangan' }) }
  if (status === 'ishonchli') { ball += 5; sabablar.push({ tur: 'ok', matn: 'Mijoz "ishonchli" deb belgilangan' }) }
  ball = Math.max(0, Math.min(100, Math.round(ball)))

  let reyting
  if (status === 'qora') {
    ball = 0
    sabablar.unshift({ tur: 'bad', matn: "Qora ro'yxatda" })
    reyting = { daraja: 'qora', nom: "Qora ro'yxat", tavsiya: 'Nasiya berilmaydi' }
  } else if (!tarixBor) {
    reyting = { daraja: 'yangi', nom: "Tarix yo'q", tavsiya: "Birinchi xaridi — oldindan to'lovni standartdan kam qilmaslik tavsiya etiladi" }
  } else if (ball >= 85) {
    reyting = { daraja: 'alo', nom: "A'lo", tavsiya: 'Ishonchli mijoz — nasiya berish mumkin' }
  } else if (ball >= 70) {
    reyting = { daraja: 'yaxshi', nom: 'Yaxshi', tavsiya: 'Nasiya berish mumkin' }
  } else if (ball >= 50) {
    reyting = { daraja: 'orta', nom: "O'rtacha", tavsiya: "Ehtiyot bo'ling — oldindan to'lovni oshirish tavsiya etiladi" }
  } else if (ball >= 25) {
    reyting = { daraja: 'xavfli', nom: 'Xavfli', tavsiya: "Avval kechikkan qarzni yopishni so'rang" }
  } else {
    reyting = { daraja: 'juda_xavfli', nom: 'Juda xavfli', tavsiya: 'Nasiya berish tavsiya etilmaydi' }
  }
  reyting.ball = tarixBor || status === 'qora' ? ball : null

  return { reyting, sabablar, jami, shartnomalar: shartnomalar.slice(0, 20) }
}

function mijozKorinish(c) {
  return {
    id: c.id, name: c.name, phone: c.phone || '', address: c.address || '',
    passport: c.passport || '', pinfl: c.pinfl || '',
    status: c.status || 'faol', balance: Number(c.balance) || 0,
  }
}

/**
 * Shartnoma holatini grafik bo'yicha hisoblaydi:
 *   jami, tolangan, qolgan, kechikkan summa, navbatdagi oy, holat
 */
function holatHisobla(sale, oylar, bugun) {
  const jami     = r2(oylar.reduce((a, g) => a + Number(g.amount), 0))
  const tolangan = r2(oylar.reduce((a, g) => a + Number(g.paid), 0))
  const qolgan   = r2(jami - tolangan)
  const ochiq    = oylar.filter(g => r2(g.amount - g.paid) > TIYIN)
  const kechikkanOylar = ochiq.filter(g => String(g.due_date).slice(0, 10) < bugun)
  const kechikkan = r2(kechikkanOylar.reduce((a, g) => a + (g.amount - g.paid), 0))
  const navbat   = ochiq[0] || null
  const navbatSana = navbat ? String(navbat.due_date).slice(0, 10) : null

  let holat = 'faol'
  if (sale.status === 'cancelled') holat = 'bekor'
  else if (qolgan <= TIYIN) holat = 'yopilgan'
  else if (kechikkanOylar.length) holat = 'kechikkan'
  else if (navbatSana === bugun) holat = 'bugun'

  return {
    jami, tolangan, qolgan, kechikkan,
    kechikkanOy: kechikkanOylar.length,
    kechikkanKun: kechikkanOylar.length
      ? kunFarqi(bugun, String(kechikkanOylar[0].due_date).slice(0, 10)) : 0,
    tolanganOy: oylar.filter(g => r2(g.amount - g.paid) <= TIYIN && Number(g.amount) > 0).length,
    navbat: navbat ? {
      no: navbat.no, sana: navbatSana,
      summa: r2(navbat.amount - navbat.paid),
    } : null,
    holat,
  }
}

class NasiyaController {

  /** GET /api/v1/nasiya/config */
  getConfig = async (req, res) => {
    res.json(await configOqi())
  }

  /**
   * GET /api/v1/nasiya/kredit?passport=AA1234567 | ?pinfl=… | ?client_id=…
   * Mijozning do'kondagi kredit tarixi. Topilmasa { topildi: false }.
   */
  kredit = async (req, res) => {
    const pas = normPasport(req.query.passport)
    const pin = normPinfl(req.query.pinfl)
    const cid = Number(req.query.client_id) || null
    if (pas && !pasportTogri(pas)) throw new HttpException(400, "Pasport noto'g'ri: 2 harf va 7 raqam (AA1234567)")
    if (pin && !pinflTogri(pin)) throw new HttpException(400, "JSHSHIR 14 ta raqam bo'lishi kerak")
    if (!pas && !pin && !cid) throw new HttpException(400, 'Pasport, JSHSHIR yoki mijoz kerak')

    const or = []
    if (pas) or.push({ passport: pas })
    if (pin) or.push({ pinfl: pin })
    if (cid) or.push({ id: cid })
    const client = await ClientModel.findOne({ where: { [Op.or]: or } })
    if (!client) return res.json({ topildi: false })

    res.json({ topildi: true, client: mijozKorinish(client), ...(await kreditHisobla(client)) })
  }

  /**
   * POST /api/v1/nasiya/pasport { client_id, passport, pinfl, phone, address }
   * Nasiya rasmiylashtirilayotganda mijozga pasport, telefon va manzilni
   * yozib qo'yish (shartnomada chiqadi).
   * Kassirda mijozlarni tahrirlash huquqi bo'lmasa ham ishlaydi — faqat
   * shu maydonlar o'zgaradi (ism, balans va boshqalar emas).
   */
  pasportSaqla = async (req, res) => {
    const client = await ClientModel.findByPk(req.body.client_id)
    if (!client) throw new HttpException(404, 'Mijoz topilmadi')
    const body = {}
    if (req.body.passport !== undefined) body.passport = req.body.passport
    if (req.body.pinfl !== undefined) body.pinfl = req.body.pinfl
    // Shartnomada chiqadigan telefon va manzil — faqat yangi qiymat
    // berilganda yoziladi (bo'sh yuborilsa eskisi o'chmaydi)
    const matn = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
    const tel = matn(req.body.phone, 30)
    const manzil = matn(req.body.address, 300)
    if (tel) body.phone = tel
    if (manzil) body.address = manzil
    await pasportTekshir(body, client.id)
    await client.update(body)
    res.json(mijozKorinish(client))
  }

  /** PUT /api/v1/nasiya/config */
  saveConfig = async (req, res) => {
    const cfg = normalizeConfig(req.body)
    if (!Array.isArray(req.body?.plans) || !req.body.plans.length) {
      throw new HttpException(400, 'Kamida bitta muddat kiriting')
    }
    await AppSettingModel.upsert({ key: CONFIG_KEY, value: JSON.stringify(cfg) })
    res.json(cfg)
  }

  /**
   * GET /api/v1/nasiya — shartnomalar ro'yxati
   *   ?holat=faol|kechikkan|bugun|yopilgan|hammasi  ?search=ism/telefon/raqam
   */
  list = async (req, res) => {
    const bugun = bugunKey()
    const { holat = 'ochiq', search } = req.query

    const where = { installment_months: { [Op.gt]: 0 }, status: { [Op.ne]: 'cancelled' } }
    if (search) {
      const q = String(search).trim()
      const pas = normPasport(q)
      const clients = await ClientModel.findAll({
        attributes: ['id'],
        where: { [Op.or]: [
          { name: { [Op.like]: `%${q}%` } },
          { phone: { [Op.like]: `%${q}%` } },
          ...(pas && pas.length >= 4 ? [{ passport: { [Op.like]: `%${pas}%` } }, { pinfl: { [Op.like]: `%${pas}%` } }] : []),
        ] },
        raw: true, limit: 200,
      })
      where[Op.or] = [
        { doc_number: isNaN(q) ? -1 : Number(q) },
        ...(clients.length ? [{ client_id: { [Op.in]: clients.map(c => c.id) } }] : []),
      ]
    }

    const sales = await SaleModel.findAll({
      where,
      order: [['date', 'DESC']],
      include: [
        { model: ClientModel, as: 'client', attributes: ['id', 'name', 'phone', 'address'] },
        { model: SaleItemModel, as: 'items', attributes: ['product_name', 'qty'] },
      ],
      limit: 2000,
    })
    const oylar = sales.length ? await SaleInstallmentModel.findAll({
      where: { sale_id: { [Op.in]: sales.map(s => s.id) } },
      order: [['no', 'ASC']],
      raw: true,
    }) : []
    const bySale = new Map()
    for (const g of oylar) {
      if (!bySale.has(g.sale_id)) bySale.set(g.sale_id, [])
      bySale.get(g.sale_id).push(g)
    }

    let data = sales.map(s => {
      const h = holatHisobla(s, bySale.get(s.id) || [], bugun)
      return {
        id: s.id,
        docNumber: s.doc_number,
        date: s.date,
        client: s.client ? { id: s.client.id, name: s.client.name, phone: s.client.phone } : null,
        tovarlar: (s.items || []).map(i => i.product_name).join(', '),
        months: s.installment_months,
        percent: Number(s.installment_percent) || 0,
        narx: Number(s.installment_base) || 0,
        oldindan: Number(s.paid_sum) || 0,
        ...h,
      }
    })

    // Sanoqlar — filtrdan oldin
    const sanoq = { ochiq: { n: 0, sum: 0 } }
    for (const d of data) {
      if (!sanoq[d.holat]) sanoq[d.holat] = { n: 0, sum: 0 }
      sanoq[d.holat].n++
      sanoq[d.holat].sum = r2(sanoq[d.holat].sum + (d.holat === 'kechikkan' ? d.kechikkan : d.qolgan))
      if (d.holat !== 'yopilgan') { sanoq.ochiq.n++; sanoq.ochiq.sum = r2(sanoq.ochiq.sum + d.qolgan) }
    }
    sanoq.hammasi = { n: data.length, sum: r2(data.reduce((a, d) => a + d.qolgan, 0)) }

    if (holat === 'ochiq') data = data.filter(d => d.holat !== 'yopilgan')
    else if (holat !== 'hammasi') data = data.filter(d => d.holat === holat)

    // Kechikkanlar birinchi, keyin navbatdagi to'lovi yaqinlar
    const tartib = { kechikkan: 0, bugun: 1, faol: 2, yopilgan: 3 }
    data.sort((a, b) => (tartib[a.holat] - tartib[b.holat])
      || (b.kechikkanKun - a.kechikkanKun)
      || String(a.navbat?.sana || '9999').localeCompare(String(b.navbat?.sana || '9999')))

    res.json({ data, sanoq, bugun })
  }

  /** GET /api/v1/nasiya/:saleId — shartnoma: tovarlar, grafik, to'lovlar */
  getOne = async (req, res) => {
    const sale = await SaleModel.findOne({
      where: { id: req.params.saleId },
      include: [
        { model: ClientModel, as: 'client' },
        { model: SaleItemModel, as: 'items' },
      ],
    })
    if (!sale) throw new HttpException(404, 'Shartnoma topilmadi')
    if (!(Number(sale.installment_months) > 0)) throw new HttpException(400, 'Bu sotuv nasiya emas')

    const bugun = bugunKey()
    const oylar = await SaleInstallmentModel.findAll({
      where: { sale_id: sale.id }, order: [['no', 'ASC']], raw: true,
    })
    const tolovlar = await SalePaymentModel.findAll({
      where: { sale_id: sale.id }, order: [['date', 'DESC']], raw: true,
    })
    // Shartnomadagi "Hujjat tayyorlovchi" — sotuvni rasmiylashtirgan kassir
    // (id 0 ham haqiqiy foydalanuvchi — "Dasturchi")
    const kassir = sale.cashier_id !== null && sale.cashier_id !== undefined
      ? await UserModel.findByPk(sale.cashier_id, { attributes: ['fullname', 'username'], raw: true })
      : null

    res.json({
      id: sale.id,
      docNumber: sale.doc_number,
      date: sale.date,
      status: sale.status,
      months: sale.installment_months,
      percent: Number(sale.installment_percent) || 0,
      ustama: Number(sale.installment_markup) || 0,
      narx: Number(sale.installment_base) || 0,
      chegirma: Number(sale.discount) || 0,
      oldindan: Number(sale.paid_sum) || 0,
      kassir: kassir?.fullname || kassir?.username || '',
      client: sale.client ? mijozKorinish(sale.client) : null,
      items: (sale.items || []).map(i => ({
        name: i.product_name,
        qty: Number(i.qty) || 0,
        price: Number(i.base_price ?? i.price) || 0,
        nasiyaPrice: Number(i.price) || 0,
        returnedQty: Number(i.returned_qty) || 0,
      })),
      grafik: oylar.map(g => {
        const qoldi = r2(g.amount - g.paid)
        const sana = String(g.due_date).slice(0, 10)
        return {
          no: g.no, sana,
          summa: Number(g.amount) || 0,
          tolangan: Number(g.paid) || 0,
          qoldi,
          tolanganSana: g.paid_at,
          holat: qoldi <= TIYIN ? 'tolangan'
            : sana < bugun ? 'kechikkan'
            : sana === bugun ? 'bugun'
            : Number(g.paid) > 0 ? 'qisman' : 'kutilmoqda',
        }
      }),
      tolovlar: tolovlar.map(t => ({
        id: t.id, date: t.date, summa: Number(t.amount) || 0,
        turi: t.payment_type, kassir: t.cashier_name,
      })),
      ...holatHisobla(sale, oylar, bugun),
      bugun,
    })
  }
}

module.exports = new NasiyaController()
module.exports.configOqi = configOqi
