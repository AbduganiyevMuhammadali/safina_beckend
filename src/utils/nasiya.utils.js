/**
 * Nasiya (muddatli to'lov) hisob-kitobi.
 *
 * DIQQAT: frontenddagi `src/utils/nasiya.js` bilan formulalar AYNAN bir xil
 * bo'lishi shart — kassir ekranda ko'rgan oylik to'lov serverda yozilgani
 * bilan tiyinigacha mos kelsin. Sotuvda frontend kutgan summani yuboradi,
 * server qayta hisoblab solishtiradi.
 *
 * Formula (do'kon Excel jadvalidagi kabi):
 *   qoldiq   = narx − oldindan to'lov
 *   ustama   = qoldiq × foiz / 100
 *   jami     = qoldiq + ustama
 *   oylik    = jami / oylar soni
 *
 * Foiz muddatga va oldindan to'lov bor-yo'qligiga qarab tanlanadi:
 *   pct     — oldindan to'lovsiz
 *   pctPre  — oldindan to'lov `minPrepayPct` foizdan kam bo'lmasa
 * Oldindan bir necha so'm berib arzon foiz olib qo'yishning oldini olish
 * uchun chegara bor: undan kam oldindan to'lovda oddiy foiz qo'llanadi.
 */

const DEFAULT_CONFIG = {
  enabled: true,
  plans: [
    { months: 3,  pct: 10, pctPre: 0 },
    { months: 6,  pct: 23, pctPre: 22.5 },
    { months: 9,  pct: 35, pctPre: 33.75 },
    { months: 12, pct: 42, pctPre: 45 },
  ],
  // Narx kartochkasida ko'rsatiladigan standart oldindan to'lov foizi
  prepayPct: 20,
  // "Oldindan to'lov bilan" foizlari shu foizdan boshlab amal qiladi
  minPrepayPct: 20,
  // Oylik to'lovni yaxlitlash qadami: 1, 100 yoki 1000 so'm
  round: 1,
  // Narx kartochkasi va shartnoma sarlavhasi
  cardTitle: 'SAFINA',
  cardSubtitle: 'Universal Market Nasiya Savdo',
  // Kartochka/shartnoma yozuvi: 'kirill' (do'kondagi Excel kabi) yoki 'lotin'
  script: 'kirill',
}

function matn(v, def, max) {
  const s = typeof v === 'string' ? v.trim().slice(0, max) : ''
  return s || def
}

const ROUND_STEPS = [1, 100, 500, 1000]

function son(v, def = 0) {
  const n = Number(v)
  return Number.isFinite(n) ? n : def
}

// Saqlangan yoki kelgan sozlamani tekshirib, xavfsiz ko'rinishga keltiradi
function normalizeConfig(raw) {
  const r = raw && typeof raw === 'object' ? raw : {}
  const seen = new Set()
  const plans = (Array.isArray(r.plans) ? r.plans : DEFAULT_CONFIG.plans)
    .map(p => ({
      months: Math.round(son(p.months)),
      pct:    Math.round(son(p.pct) * 1000) / 1000,
      pctPre: Math.round(son(p.pctPre, son(p.pct)) * 1000) / 1000,
    }))
    .filter(p => {
      if (p.months < 1 || p.months > 60) return false
      if (p.pct < 0 || p.pct > 500 || p.pctPre < 0 || p.pctPre > 500) return false
      if (seen.has(p.months)) return false
      seen.add(p.months)
      return true
    })
    .sort((a, b) => a.months - b.months)

  const clampPct = (v, def) => Math.min(95, Math.max(0, son(v, def)))
  return {
    enabled:      r.enabled === undefined ? true : !!r.enabled,
    plans:        plans.length ? plans : DEFAULT_CONFIG.plans.map(p => ({ ...p })),
    prepayPct:    clampPct(r.prepayPct,    DEFAULT_CONFIG.prepayPct),
    minPrepayPct: clampPct(r.minPrepayPct, DEFAULT_CONFIG.minPrepayPct),
    round:        ROUND_STEPS.includes(son(r.round)) ? son(r.round) : 1,
    cardTitle:    matn(r.cardTitle,    DEFAULT_CONFIG.cardTitle, 40),
    cardSubtitle: typeof r.cardSubtitle === 'string'
      ? r.cardSubtitle.trim().slice(0, 80) : DEFAULT_CONFIG.cardSubtitle,
    script:       r.script === 'lotin' ? 'lotin' : 'kirill',
  }
}

// Jami summani oylarga bo'ladi. Oxirgi oy yaxlitlash farqini oladi —
// shunda grafik yig'indisi jami summaga tiyinigacha teng bo'ladi.
function taqsimla(jami, oylar, qadam = 1) {
  const n = Math.max(1, Math.round(oylar))
  const urin = q => {
    const asos = jami / n
    const oylik = q > 1 ? Math.round(asos / q) * q : Math.round(asos)
    const oxirgi = Math.round(jami - oylik * (n - 1))
    return { oylik, oxirgi }
  }
  let { oylik, oxirgi } = urin(qadam)
  // Juda kichik summada yaxlitlash oxirgi oyni manfiy qilib qo'ymasin
  if (oxirgi < 0 || (n > 1 && oylik <= 0)) ({ oylik, oxirgi } = urin(1))
  const res = Array(n - 1).fill(oylik)
  res.push(oxirgi)
  return res
}

/**
 * Bitta reja bo'yicha hisob.
 *   narx     — naqd narx (chegirmadan keyin)
 *   oldindan — hozir to'lanadigan pul
 *   months   — muddat (oy)
 * Muddat sozlamada bo'lmasa null qaytaradi.
 */
function hisobla({ narx, oldindan = 0, months, cfg }) {
  const c = normalizeConfig(cfg)
  const plan = c.plans.find(p => p.months === Math.round(son(months)))
  if (!plan) return null

  const N = Math.max(0, Math.round(son(narx)))
  const old = Math.max(0, Math.min(N, Math.round(son(oldindan))))
  const qoldiq = N - old
  // Oldindan to'lov chegaradan kam bo'lmasa — imtiyozli foiz
  const imtiyoz = old > 0 && old * 100 >= N * c.minPrepayPct - 0.5
  const pct = imtiyoz ? plan.pctPre : plan.pct
  const ustama = Math.round(qoldiq * pct / 100)
  const jami = qoldiq + ustama
  const oylar = taqsimla(jami, plan.months, c.round)

  return {
    months: plan.months,
    pct,
    imtiyoz,
    narx: N,
    oldindan: old,
    qoldiq,
    ustama,
    jami,                 // nasiyaga qoladigan summa (ustama bilan)
    umumiy: old + jami,   // mijoz jami to'laydigan pul
    oylik: oylar[0],
    oylar,
  }
}

// Sana yordamchilari — hammasi do'kon vaqt zonasida, 'YYYY-MM-DD'
function sanaKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function bugunKey() { return sanaKey(new Date()) }

// N oy qo'shadi. Oy oxiri kesiladi: 31-yanvar + 1 oy = 28/29-fevral
function oyQosh(key, n) {
  const [y, m, d] = String(key).slice(0, 10).split('-').map(Number)
  const jamiOy = (m - 1) + n
  const yil = y + Math.floor(jamiOy / 12)
  const oy = ((jamiOy % 12) + 12) % 12
  const oxirgiKun = new Date(yil, oy + 1, 0).getDate()
  return sanaKey(new Date(yil, oy, Math.min(d, oxirgiKun)))
}

// Oylar ro'yxatidan to'lov grafigi: [{ no, due_date, amount }]
function grafikTuz(oylar, birinchiSana) {
  return oylar.map((amount, i) => ({
    no: i + 1,
    due_date: oyQosh(birinchiSana, i),
    amount,
  }))
}

module.exports = {
  DEFAULT_CONFIG,
  normalizeConfig,
  hisobla,
  taqsimla,
  grafikTuz,
  oyQosh,
  bugunKey,
  sanaKey,
}
