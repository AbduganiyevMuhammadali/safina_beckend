/**
 * Pasport va JSHSHIR (PINFL) bilan ishlash.
 *
 * Pasport / ID-karta: 2 lotin harf + 7 raqam (AA1234567, AD1234567).
 * JSHSHIR: 14 raqam — pasport almashsa ham o'zgarmaydi, shuning uchun
 * mijozni aniqlashda eng ishonchlisi.
 *
 * Kassir "aa 123 45 67" yoki kirill harflarda yozib yuborishi mumkin —
 * bir xil ko'rinishga keltiramiz.
 */
const KIRILL = { 'А': 'A', 'В': 'B', 'С': 'C', 'Е': 'E', 'Н': 'H', 'К': 'K', 'М': 'M', 'О': 'O', 'Р': 'P', 'Т': 'T', 'Х': 'X', 'У': 'Y', 'Д': 'D', 'Ф': 'F' }

function normPasport(v) {
  if (v === null || v === undefined) return null
  const s = String(v).toUpperCase()
    .replace(/[АВСЕНКМОРТХУДФ]/g, ch => KIRILL[ch] || ch)
    .replace(/[^A-Z0-9]/g, '')
  return s || null
}

function normPinfl(v) {
  if (v === null || v === undefined) return null
  const s = String(v).replace(/\D/g, '')
  return s || null
}

const pasportTogri = s => /^[A-Z]{2}\d{7}$/.test(s || '')
const pinflTogri   = s => /^\d{14}$/.test(s || '')

module.exports = { normPasport, normPinfl, pasportTogri, pinflTogri }
