// private fork (docs/fork/ui-design.md, owner 2026-10): the static UI-standard scanner behind tests/fork-ui-standard.test.mjs.
// Lexical and dependency-free, like fork-surface-audit.mjs: it counts violations per rule and file; the explicit allowlist
// docs/fork/ui-standard-allowlist.json holds today's counts and may only shrink.
//   node tests/helpers/fork-ui-standard-audit.mjs            → report (rule, file, count, lines)
//   node tests/helpers/fork-ui-standard-audit.mjs --write    → shrink the allowlist to the current counts; refuses growth
//   ... --write --grow=<path>[,<path>]                       → upstream merges only: accept growth in the named files
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url)).replaceAll('\\', '/')
export const ALLOWLIST = 'docs/fork/ui-standard-allowlist.json'
const CLIENT = 'tavern-plugin/src/client'
const ASSETS = 'tavern-plugin/lib/client-assets'

export const RULES = {
  'native-select': 'native <select> (use ForkInlineField kind:"menu" / the shared menu)',
  'native-input-type': 'native <input type="range|color|checkbox|radio"> outside its designated shared component',
  'raw-input': 'raw text <input> / <textarea> outside ForkInlineField / SearchBox',
  'window-dialog': 'window.confirm / alert / prompt (use ConfirmDialog)',
  'font-size-literal': 'hard-coded font size (use --fork-fs-* / --fork-ui-* / --gal-ui-* tokens)',
  'colour-literal': 'hard-coded colour literal outside the token definitions (use --fork-* / --fk-current-* / --gal-ui-* tokens)'
}
// The one shared implementation allowed to hold each native element: path (relative to src/client) → function names,
// '*' for the whole file.
export const DESIGNATED = {
  'raw-input': { 'fork-inline-field.js': ['*'], 'fork-asset-pack-ui.js': ['SearchBox'] },
  'native-input-type': { 'fork-inline-field.js': ['ForkSwitch'] } // private fork (UI standard phase 2 batch 7): SwitchRow and the chat-side rows share ForkSwitch
}
// Token sources: the colour palette module and the token blocks of fork-theme.css.
const TOKEN_FILES = new Set(['fork-surfaces.cjs'])
const TOKEN_BLOCKS = [['/* ==== stage UI tokens ==== */', '/* ==== end stage UI tokens ==== */'], ['/* ==== fork UI standard tokens ==== */', '/* ==== end fork UI standard tokens ==== */']]

function walk(dir) {
  return readdirSync(root + dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(dir + '/' + e.name) : /\.c?js$/.test(e.name) ? [dir + '/' + e.name] : [])
}
export function sources() {
  const js = walk(CLIENT).map(path => ({ path, rel: path.slice(CLIENT.length + 1), kind: 'js' }))
  const css = readdirSync(root + ASSETS).filter(n => /^fork-.*\.css$/.test(n)).map(n => ({ path: ASSETS + '/' + n, rel: 'client-assets/' + n, kind: 'css' }))
  return [...js, ...css].map(f => ({ ...f, text: readFileSync(root + f.path, 'utf8') }))
}

// Blank out comments (keeping line breaks) so commented-out code and prose never count.
function stripCssComments(text) { return text.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' ')) }
function stripJsCommentLines(line) { const t = line.trimStart(); return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') ? '' : line }

const ELEMENT = /\b(?:h|createElement)\(\s*(['"])(select|input|textarea)\1/g
const TEMPLATE = /<(select|input|textarea)\b([^>]*)/g
const HEX = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])/g
const FUNC = /\b(?:rgba?|hsla?)\(\s*[\d.]/g
const NAMED = /(?<![-\w#.$])(?:white|black)(?![-\w])/g

// `fn` maps a line index to the enclosing top-level function name (the nearest preceding `function Name(`).
function functionNames(lines) {
  let current = ''
  return lines.map(line => { const m = line.match(/^\s*(?:export\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/); if (m) current = m[1]; return current })
}
const designated = (rule, rel, fn) => { const d = DESIGNATED[rule]?.[rel]; return !!d && (d.includes('*') || d.includes(fn)) }

export function scan({ rel, kind, text }) {
  const found = []
  const add = (rule, line) => found.push({ rule, path: rel, line })
  if (kind === 'js') {
    const lines = text.split('\n'), fns = functionNames(lines)
    lines.forEach((raw, i) => {
      const line = stripJsCommentLines(raw), n = i + 1, fn = fns[i]
      for (const m of line.matchAll(ELEMENT)) {
        const tag = m[2], rest = line.slice(m.index + m[0].length), end = rest.search(/\b(?:h|createElement)\(/), attrs = end < 0 ? rest : rest.slice(0, end)
        const type = (attrs.match(/\btype\s*:\s*(['"])([\w-]+)\1/) || [])[2] || ''
        if (tag === 'select') add('native-select', n)
        else if (tag === 'input' && /^(range|color|checkbox|radio)$/.test(type)) { if (!designated('native-input-type', rel, fn)) add('native-input-type', n) }
        else if (tag === 'textarea' || !/^(file|hidden|range|color|checkbox|radio)$/.test(type)) { if (!designated('raw-input', rel, fn)) add('raw-input', n) }
      }
      for (const m of line.matchAll(TEMPLATE)) {
        const type = (m[2].match(/type\s*=\s*["']?([\w-]+)/) || [])[1] || ''
        if (m[1] === 'select') add('native-select', n)
        else if (m[1] === 'input' && /^(range|color|checkbox|radio)$/.test(type)) add('native-input-type', n)
        else if (m[1] === 'textarea' || !/^(file|hidden)$/.test(type)) { if (!designated('raw-input', rel, fn)) add('raw-input', n) }
      }
      for (const _ of line.matchAll(/(?<![.\w$])(?:window\.)?(?:confirm|alert|prompt)\s*\(/g)) if (!/function\s+(?:confirm|alert|prompt)\s*\(/.test(line)) add('window-dialog', n)
      for (const _ of line.matchAll(/\bfontSize\s*:\s*['"`]?\d/g)) add('font-size-literal', n)
      if (!TOKEN_FILES.has(rel)) for (const m of line.matchAll(/(['"`])((?:\\.|(?!\1).)*)\1/g)) {
        const s = m[2]; for (const _ of s.matchAll(HEX)) add('colour-literal', n); for (const _ of s.matchAll(FUNC)) add('colour-literal', n)
      }
    })
  } else {
    const clean = stripCssComments(text), lines = clean.split('\n'), rawLines = text.split('\n')
    let token = false
    lines.forEach((line, i) => {
      const n = i + 1, raw = rawLines[i]
      if (TOKEN_BLOCKS.some(([open]) => raw.includes(open))) token = true
      const closes = TOKEN_BLOCKS.some(([, close]) => raw.includes(close))
      const body = line.replace(/url\((?:[^()]|\([^()]*\))*\)/g, 'url()')
      // Declarations: split on ; and {} so a one-line rule counts each declaration.
      for (const decl of body.split(/[;{}]/)) {
        const m = decl.match(/^\s*([-\w]+)\s*:(.*)$/); if (!m) continue
        const [, prop, value] = m, custom = prop.startsWith('--')
        if (!custom && /^font(-size)?$/.test(prop)) for (const _ of value.matchAll(/(?<![\w.-])\d*\.?\d+(?:px|rem|pt)\b/g)) { if (!/^\s*0(px|rem|pt)?\s*$/.test(value)) { add('font-size-literal', n); break } }
        if (!token) { for (const _ of value.matchAll(HEX)) add('colour-literal', n); for (const _ of value.matchAll(FUNC)) add('colour-literal', n); for (const _ of value.matchAll(NAMED)) add('colour-literal', n) }
      }
      if (closes) token = false
    })
  }
  return found
}

export function audit() { return sources().flatMap(scan) }
// {rule: {path: {count, lines}}}
export function tally(found = audit()) {
  const out = Object.fromEntries(Object.keys(RULES).map(r => [r, {}]))
  for (const { rule, path, line } of found) { const e = out[rule][path] ||= { count: 0, lines: [] }; e.count++; if (e.lines.at(-1) !== line) e.lines.push(line) }
  for (const rule of Object.keys(out)) out[rule] = Object.fromEntries(Object.entries(out[rule]).sort(([a], [b]) => a.localeCompare(b)))
  return out
}
export function readAllowlist() { return JSON.parse(readFileSync(root + ALLOWLIST, 'utf8')) }
export function compare(actual, allowed) {
  const grown = [], shrunk = []
  for (const rule of Object.keys(RULES)) {
    const a = actual[rule] || {}, b = allowed.rules?.[rule] || {}
    for (const [path, e] of Object.entries(a)) { const limit = b[path]?.count ?? 0; if (e.count > limit) grown.push({ rule, path, count: e.count, allowed: limit, lines: e.lines.filter(l => !(b[path]?.lines || []).includes(l)) }) }
    for (const [path, e] of Object.entries(b)) { const now = a[path]?.count ?? 0; if (now < e.count) shrunk.push({ rule, path, count: now, allowed: e.count }) }
  }
  return { grown, shrunk }
}
export const totals = rules => Object.fromEntries(Object.entries(rules).map(([rule, files]) => [rule, Object.values(files).reduce((s, e) => s + e.count, 0)]))

if (process.argv[1] && fileURLToPath(import.meta.url).replaceAll('\\', '/') === process.argv[1].replaceAll('\\', '/')) {
  const actual = tally(), write = process.argv.includes('--write')
  const grow = (process.argv.find(a => a.startsWith('--grow=')) || '').slice(7).split(',').filter(Boolean)
  let allowed = { rules: {} }
  try { allowed = readAllowlist() } catch (_) { /* first run: no allowlist yet */ }
  const { grown, shrunk } = compare(actual, allowed)
  if (!write) {
    console.log(JSON.stringify(totals(actual)))
    for (const g of grown) console.log('NEW ' + g.rule + ' ' + g.path + ' ' + g.allowed + ' → ' + g.count + ' (lines ' + g.lines.join(',') + ')')
    for (const s of shrunk) console.log('FIXED ' + s.rule + ' ' + s.path + ' ' + s.allowed + ' → ' + s.count)
  } else {
    const refused = Object.keys(allowed.rules || {}).length ? grown.filter(g => !grow.includes(g.path)) : []
    if (refused.length) { for (const g of refused) console.error('refused (shrink-only): ' + g.rule + ' ' + g.path + ' ' + g.allowed + ' → ' + g.count + ' lines ' + g.lines.join(',')); process.exit(1) }
    const doc = { note: 'private fork (docs/fork/ui-design.md): existing UI-standard violations, per rule and file. Shrink-only — fix a violation, then run `node tests/helpers/fork-ui-standard-audit.mjs --write`. `lines` are informative (refreshed on write); the test compares counts.', totals: totals(actual), rules: actual }
    writeFileSync(root + ALLOWLIST, JSON.stringify(doc, null, 1).replace(/\[\n\s+([\d,\n\s]+?)\n\s+\]/g, (_, xs) => '[' + xs.replace(/\s+/g, '') + ']') + '\n')
    console.log('wrote ' + ALLOWLIST + ' ' + JSON.stringify(totals(actual)))
  }
}
