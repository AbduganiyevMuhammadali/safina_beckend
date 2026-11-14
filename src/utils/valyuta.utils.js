/**
 * Dollar kursi va dollardagi narxlar.
 *
 * DIQQAT: frontenddagi `src/utils/valyuta.js` bilan formulalar AYNAN bir
 * xil bo'lishi shart — kassir ekranda ko'rgan so'm narx bazadagisi bilan
 * tiyinigacha mos kelsin.
 *
 * Tovar `currency = 'USD'` bo'lsa uning asl narxi dollarda turadi:
 *   cost_price_usd    — kelish narxi ($)
 *   retail_price_usd  — sotuv narxi ($) = kelish × (1 + ustama%)
 *   retail_price      — so'mdagi narx = yaxlitla(sotuv$ × kurs)
 * Kurs o'zgarsa so'mdagi narxlar qayta hisoblanadi. Sotuvlar, qarzlar va
 * nasiya grafiklari so'mda yozilgani uchun ular o'zgarmaydi.
 */

const QADAMLAR = [1, 100, 500, 1000, 5000, 10000]

const DEFAULT = {
  kurs: 12000,        // 1 $ = ? so'm
  ustama: 20,         // standart ustama, % (kelish narxiga)
  yaxlitlash: 1000,   // so'mdagi narx shu qadamgacha yaxlitlanadi
}

const son = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d }

function normalize(raw) {
  const r = raw && typeof raw === 'object' ? raw : {}
  const kurs = son(r.kurs, DEFAULT.kurs)
  return {
    kurs:       kurs >= 1000 && kurs <= 1000000 ? Math.round(kurs * 100) / 100 : DEFAULT.kurs,
    ustama:     Math.min(500, Math.max(0, Math.round(son(r.ustama, DEFAULT.ustama) * 100) / 100)),
    yaxlitlash: QADAMLAR.includes(son(r.yaxlitlash)) ? son(r.yaxlitlash) : DEFAULT.yaxlitlash,
  }
}

// Avval tiyingacha (suzuvchi nuqta xatosi yo'qolsin), keyin qadamgacha
function yaxlitla(som, qadam = 1) {
  const t = Math.round(son(som) * 100) / 100
  return qadam > 1 ? Math.round(t / qadam) * qadam : Math.round(t)
}

// Dollardagi narx → so'mdagi narx
function somNarx(usd, cfg) {
  const c = normalize(cfg)
  const u = son(usd)
  return u > 0 ? yaxlitla(u * c.kurs, c.yaxlitlash) : 0
}

// Kelish narxi ($) → sotuv narxi ($), sentgacha
function sotuvUsd(kelishUsd, ustama) {
  return Math.round(son(kelishUsd) * (1 + son(ustama) / 100) * 100) / 100
}

/**
 * Mahsulot ma'lumotiga so'mdagi narxlarni qo'yadi (create/update uchun).
 * `currency = 'USD'` va dollar narxi bor bo'lsa — so'm narx kursdan
 * hisoblanadi, frontend yuborgani e'tiborga olinmaydi.
 */
function usdNarxQoy(data, cfg) {
  if (!data || data.currency !== 'USD') return data
  if (son(data.retail_price_usd) > 0)    data.retail_price    = somNarx(data.retail_price_usd, cfg)
  if (son(data.wholesale_price_usd) > 0) data.wholesale_price = somNarx(data.wholesale_price_usd, cfg)
  return data
}

module.exports = { DEFAULT, QADAMLAR, normalize, yaxlitla, somNarx, sotuvUsd, usdNarxQoy }
