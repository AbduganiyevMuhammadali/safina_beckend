const { Op } = require('sequelize')
const AppSettingModel      = require('../models/app_setting.model')
const SaleModel            = require('../models/sale.model')
const SaleItemModel        = require('../models/sale_item.model')
const SaleInstallmentModel = require('../models/sale_installment.model')
const SalePaymentModel     = require('../models/sale_payment.model')
const ClientModel          = require('../models/client.model')
const HttpException        = require('../utils/HttpException.utils')
const { normalizeConfig, bugunKey } = require('../utils/nasiya.utils')

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
      const clients = await ClientModel.findAll({
        attributes: ['id'],
        where: { [Op.or]: [{ name: { [Op.like]: `%${q}%` } }, { phone: { [Op.like]: `%${q}%` } }] },
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
      client: sale.client ? {
        id: sale.client.id, name: sale.client.name, phone: sale.client.phone,
        address: sale.client.address || '',
      } : null,
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
