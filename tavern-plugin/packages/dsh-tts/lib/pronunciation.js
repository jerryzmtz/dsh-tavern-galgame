// Plain global substitutions are independent of the language-specific reading presets.
export const DEFAULT_PRONUNCIATIONS = [
  {term:'Wi-Fi', spoken:'WiFi'}, {term:'WiFi', spoken:'WiFi'},
  {term:'AI', spoken:'A I'},
  {term:'OK', spoken:'O K'}, {term:'Claude', spoken:'\u514b\u52b3\u5fb7'}, {term:'GPT', spoken:'G P T'},
]
const dash = /[-\u2010-\u2015\u2212\ufe63\uff0d]/gu
const latinToken = /[\p{Script=Latin}\p{M}\d]+(?:[-\u2010-\u2015\u2212\ufe63\uff0d][\p{Script=Latin}\p{M}\d]+)+/gu
export function normalizeDashes(text) {
  // Limit math context to a numeric expression, not an unrelated sign elsewhere in the prose.
  return text.replace(/\d+(?:\.\d+)?(?:\s*[=+\u00d7*/\u00f7\-\u2010-\u2015\u2212\ufe63\uff0d]\s*\d+(?:\.\d+)?)+/gu,
    expression => /[=+\u00d7*/\u00f7]/u.test(expression) || /\d\s+[-\u2010-\u2015\u2212\ufe63\uff0d]\s+\d/u.test(expression) ? expression.replace(dash, '\u51cf') : expression)
    .replace(latinToken, token => /\p{Script=Latin}/u.test(token) ? token.replace(dash, ' ') : token)
    .replace(/(?<=\d)[-\u2010-\u2015\u2212\ufe63\uff0d](?=\d)/gu, '\u5230')
    .replace(/(^|[\s(\[\{\uff08\u3010])[-\u2010-\u2015\u2212\ufe63\uff0d](?=\d)/gu, '$1\u8d1f')
}
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
export function validatePronunciations(rows) {
  if (!Array.isArray(rows) || rows.length > 256 || rows.some(row => !row || typeof row.term !== 'string' || !row.term.trim() || row.term.length > 256 || typeof row.spoken !== 'string' || row.spoken.length > 512)) {
    throw Object.assign(new Error('INVALID_INPUT'), {code:'INVALID_INPUT'})
  }
  return rows
}
export function compilePronunciations(rows = []) {
  const values = new Map([...DEFAULT_PRONUNCIATIONS, ...rows].map(({term, spoken}) => [term.trim().toLowerCase(), spoken.trim()]))
  // An empty override removes a built-in entry without restoring it on the next load.
  for (const [term, spoken] of values) if (!spoken) values.delete(term)
  const forms = [...values.keys()].sort((a,b) => b.length - a.length)
  const pattern = new RegExp(forms.length ? forms.map(form => {
    const latin = /\p{Script=Latin}/u.test(form)
    return (latin ? '(?<![\\p{Script=Latin}\\p{M}\\d_])' : '') + escape(form) + (latin ? '(?![\\p{Script=Latin}\\p{M}\\d_])' : '')
  }).join('|') : '(?!)', 'giu')
  return text => {
    // String.replace visits only original matches: spoken forms never trigger another entry.
    const replaced = text.replace(pattern, form => values.get(form.toLowerCase()))
    return normalizeDashes(replaced)
  }
}
