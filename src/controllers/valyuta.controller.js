/**
 * Dollar kursi: GET/PUT /api/v1/valyuta
 *
 * Kurs bitta — serverda (app_setting `valyuta`), hamma kassa bir xil
 * narxda sotsin. Kurs o'zgartirilganda dollardagi barcha tovarlarning
 * so'mdagi narxi shu zahoti qayta hisoblanadi.
 */
const { Op } = require('sequelize')
const sequelize       = require('../db/db-sequelize')
const AppSettingModel = require('../models/app_setting.model')
const ProductModel    = require('../models/product.model')
const HttpException   = require('../utils/HttpException.utils')
const { normalize, somNarx, sotuvUsd } = require('../utils/valyuta.utils')

const KEY = 'valyuta'
const TARIX_MAX = 30

async function oqiXom(transaction) {
  const row = await AppSettingModel.findOne({ where: { key: KEY }, transaction })
  try { return row?.value ? JSON.parse(row.value) : {} } catch { return {} }
}

// Boshqa joylardan ham ishlatiladi (mahsulot yaratish, tezkor kiritish)
async function kursOqi(transaction) {
  return normalize(await oqiXom(transaction))
}

// Bir nechta qatorni bitta UPDATE bilan yozish (CASE … WHEN)
async function narxlarniYoz(qatorlar, transaction) {
  if (!qatorlar.length) return
  const ids = qatorlar.map(q => Number(q.id))
  const ustun = (nom, kalit) => `\`${nom}\` = CASE \`id\` ${qatorlar.map(q => `WHEN ${Number(q.id)} THEN ${Number(q[kalit])}`).join(' ')} ELSE \`${nom}\` END`
  const qism = [ustun('retail_price', 'retail'), ustun('wholesale_price', 'wholesale')]
  if (qatorlar.some(q => q.retailUsd !== undefined)) qism.push(ustun('retail_price_usd', 'retailUsd'))
  await sequelize.query(
    `UPDATE \`product\` SET ${qism.join(', ')} WHERE \`id\` IN (${ids.join(',')})`,
    { transaction },
  )
}

class ValyutaController {
  get = async (req, res) => {
    const xom = await oqiXom()
    const usdTovarlar = await ProductModel.count({ where: { currency: 'USD' } })
    res.json({ ...normalize(xom), tarix: Array.isArray(xom.tarix) ? xom.tarix : [], usdTovarlar })
  }

  /**
   * PUT { kurs, ustama, yaxlitlash, ustamaniQollash? }
   *   ustamaniQollash — yangi ustama barcha dollarli tovarlarga qo'llansin
   *   (sotuv $ = kelish $ × (1 + ustama%)); aks holda har tovar o'z sotuv
   *   narxini saqlaydi, faqat so'mdagi narx kursga moslanadi.
   */
  save = async (req, res) => {
    const k = Number(req.body?.kurs)
    if (!(k >= 1000 && k <= 1000000)) {
      throw new HttpException(400, "Kurs noto'g'ri: 1 000 dan 1 000 000 so'mgacha bo'lishi kerak")
    }
    const yangi = normalize(req.body)
    const ustamaniQollash = !!req.body?.ustamaniQollash
    const kim = req.currentUser?.fullname || req.currentUser?.username || ''

    let yangilandi = 0
    await sequelize.transaction(async (t) => {
      const xom = await oqiXom(t)
      const eski = normalize(xom)

      const tovarlar = await ProductModel.findAll({
        where: { currency: 'USD', retail_price_usd: { [Op.gt]: 0 } },
        attributes: ['id', 'retail_price', 'wholesale_price', 'retail_price_usd', 'wholesale_price_usd', 'cost_price_usd'],
        raw: true,
        transaction: t,
      })
      const qatorlar = []
      for (const p of tovarlar) {
        let retailUsd = Number(p.retail_price_usd) || 0
        if (ustamaniQollash && Number(p.cost_price_usd) > 0) retailUsd = sotuvUsd(p.cost_price_usd, yangi.ustama)
        const retail = somNarx(retailUsd, yangi)
        const wholesale = Number(p.wholesale_price_usd) > 0 ? somNarx(p.wholesale_price_usd, yangi) : Number(p.wholesale_price) || 0
        const ozgardi = retail !== Number(p.retail_price) || wholesale !== Number(p.wholesale_price)
          || (ustamaniQollash && retailUsd !== Number(p.retail_price_usd))
        if (!ozgardi) continue
        qatorlar.push({ id: p.id, retail, wholesale, ...(ustamaniQollash ? { retailUsd } : {}) })
      }
      await narxlarniYoz(qatorlar, t)
      yangilandi = qatorlar.length

      const tarix = Array.isArray(xom.tarix) ? xom.tarix : []
      if (eski.kurs !== yangi.kurs || eski.ustama !== yangi.ustama || eski.yaxlitlash !== yangi.yaxlitlash || ustamaniQollash) {
        tarix.unshift({
          sana: new Date().toISOString(), kim,
          eskiKurs: eski.kurs, kurs: yangi.kurs, ustama: yangi.ustama,
          ustamaQollandi: ustamaniQollash, tovarlar: yangilandi,
        })
      }
      await AppSettingModel.upsert(
        { key: KEY, value: JSON.stringify({ ...yangi, tarix: tarix.slice(0, TARIX_MAX) }) },
        { transaction: t },
      )
    })

    const xom = await oqiXom()
    res.json({ ...normalize(xom), tarix: xom.tarix || [], yangilandi })
  }
}

module.exports = new ValyutaController()
module.exports.kursOqi = kursOqi
