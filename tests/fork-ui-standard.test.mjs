// private fork (docs/fork/ui-design.md, owner 2026-10): the UI standard's static guard. New native controls, raw text
// inputs outside ForkInlineField / SearchBox, window dialogs, hard-coded font sizes and colour literals in the client fail
// here; today's violations are counted in docs/fork/ui-standard-allowlist.json, which may only shrink.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { RULES, ALLOWLIST, scan, tally, readAllowlist, compare, totals } from './helpers/fork-ui-standard-audit.mjs'

// Shrink-only ceilings (2026-10 baseline). Lower them when the allowlist shrinks; never raise them in routine work.
const CEILING = { 'native-select': 42, 'native-input-type': 27, 'raw-input': 69, 'window-dialog': 0, 'font-size-literal': 385, 'colour-literal': 647 } // private fork (UI standard phase 2): lowered as batches land; batch 18 palettes replaced by image colours colour 681→647; batch 16 ForkTextArea / ForkInlineAdd raw-input 82→69; batch 15 539→385; chips 541→540; entry-name-once 540→539; batch 10 search boxes raw-input 88→84; batch 11 warn token colour 709→681; batch 13 dead code native-input-type 30→27 raw-input 84→82
const where = list => list.map(g => g.rule + ' ' + g.path + ' (' + g.allowed + ' → ' + g.count + (g.lines ? ', lines ' + g.lines.join(',') : '') + ')').join('\n')

test('no new UI-standard violations in the client (allowlist is shrink-only)', () => {
  const allowed = readAllowlist(), { grown, shrunk } = compare(tally(), allowed)
  assert.deepEqual(grown.map(g => g.rule + ' ' + g.path), [], 'New violations — use the shared component or token from docs/fork/ui-design.md:\n' + where(grown))
  assert.deepEqual(shrunk.map(s => s.rule + ' ' + s.path), [], 'Violations were fixed — shrink the allowlist: node tests/helpers/fork-ui-standard-audit.mjs --write\n' + where(shrunk))
})

test('the allowlist is well formed and never above its ceilings', () => {
  const allowed = readAllowlist()
  assert.deepEqual(Object.keys(allowed.rules).sort(), Object.keys(RULES).sort())
  for (const [rule, files] of Object.entries(allowed.rules)) for (const [path, e] of Object.entries(files)) {
    assert.ok(Number.isInteger(e.count) && e.count > 0 && Array.isArray(e.lines), ALLOWLIST + ' ' + rule + ' ' + path)
  }
  const sums = totals(allowed.rules)
  for (const rule of Object.keys(RULES)) assert.ok(sums[rule] <= CEILING[rule], rule + ' allowlist ' + sums[rule] + ' exceeds the shrink-only ceiling ' + CEILING[rule])
  assert.deepEqual(allowed.totals, sums, 'totals match the per-file counts')
})

test('the scanner catches each rule and spares the designated shared components', () => {
  const js = (rel, text) => scan({ rel, kind: 'js', text }).map(f => f.rule)
  const css = text => scan({ rel: 'client-assets/fork-theme.css', kind: 'css', text }).map(f => f.rule)
  assert.deepEqual(js('fork-x.js', "h('select',{value})"), ['native-select'])
  assert.deepEqual(js('fork-x.js', "h('input',{type:'range',min:0})"), ['native-input-type'])
  assert.deepEqual(js('fork-x.js', 'React.createElement("input", { type: "checkbox" })'), ['native-input-type'])
  assert.deepEqual(js('fork-x.js', "h('input',{value,onChange})"), ['raw-input'])
  assert.deepEqual(js('fork-x.js', "h('textarea',{value})"), ['raw-input'])
  assert.deepEqual(js('fork-x.js', "h('input',{type:'file',hidden:true})"), [], 'hidden file pickers are fine')
  assert.deepEqual(js('fork-x.js', "if(window.confirm('?'))x(); alert('a'); onConfirm(); dialog.confirm()"), ['window-dialog', 'window-dialog'])
  assert.deepEqual(js('fork-x.js', "const s={fontSize:12,color:'#ff0000',bg:'rgba(0,0,0,.5)'}"), ['font-size-literal', 'colour-literal', 'colour-literal'])
  assert.deepEqual(js('fork-x.js', "// h('select') and '#fff' in a comment"), [])
  assert.deepEqual(js('fork-inline-field.js', "function ForkInlineText(p){return h('input',{value})}"), [])
  assert.deepEqual(js('fork-asset-pack-ui.js', "function SearchBox(p){return h('input',{type:'search'})}\nfunction Other(){return h('input',{})}"), ['raw-input'])
  assert.deepEqual(js('fork-inline-field.js', "function ForkSwitch(p){return h('input',{type:'checkbox',role:'switch'})}"), []) // private fork (batch 7): the one switch
  assert.deepEqual(js('fork-asset-pack-card-ui.js', "function SwitchRow(p){return h('input',{type:'checkbox',role:'switch'})}"), ['native-input-type'])
  assert.deepEqual(js('fork-surfaces.cjs', "const p=['#ffffff']"), [], 'the palette module is the token source')
  assert.deepEqual(css('.a { font-size: 12px; color: #fff; background: rgb(0 0 0 / .4); border-color: white; }'), ['font-size-literal', 'colour-literal', 'colour-literal', 'colour-literal'])
  assert.deepEqual(css('.a { font-size: var(--fork-fs-meta); font-size: 0; white-space: nowrap; --x: 12px; color: var(--fork-ink); }'), [])
  assert.deepEqual(css(".a { --icon: url(\"data:image/svg+xml,stroke='black'\"); } /* color: #fff */"), [])
  assert.deepEqual(css('/* ==== fork UI standard tokens ==== */\n.a { --t: #fff; color: #000; }\n/* ==== end fork UI standard tokens ==== */\n.b { color: #000; }'), ['colour-literal'])
})

test('the standard stays one short document with the checklist and the guard', async () => {
  const doc = await readFile(new URL('../docs/fork/ui-design.md', import.meta.url), 'utf8')
  assert.ok(doc.split('\n').length <= 250, 'docs/fork/ui-design.md stays ≤ 250 lines')
  for (const text of ['做 UI 任务前必读', 'fork-ui-standard', 'ForkInlineField', '--fork-state-global', '多选']) assert.ok(doc.includes(text), text)
  const theme = await readFile(new URL('../tavern-plugin/lib/client-assets/fork-theme.css', import.meta.url), 'utf8')
  const block = theme.slice(theme.indexOf('/* ==== fork UI standard tokens ==== */'), theme.indexOf('/* ==== end fork UI standard tokens ==== */'))
  for (const token of ['--fork-state-global', '--fork-state-card', '--fork-state-off', '--fork-lamp-blue', '--fork-lamp-green', '--fork-lamp-off', '--fork-warn', '--fork-danger', '--fork-focus', '--fork-fs-title', '--fork-fs-heading', '--fork-fs-body', '--fork-fs-meta'])
    assert.match(block, new RegExp(token + ':'), token)
})

// private fork (owner 2026-10, help option A): the one (?) is a small borderless glyph in every panel and skin, and a phone
// finger still gets a >= 32px target from padding without moving the row. Real fork-theme.css, real nesting.
test('the (?) is a borderless small glyph with a 32px touch target that does not shift its row', async () => {
  const { chromium } = await import('playwright')
  const theme = await readFile(new URL('../tavern-plugin/lib/client-assets/fork-theme.css', import.meta.url), 'utf8')
  const browser = await chromium.launch({ headless: true })
  try {
    const probe = width => browser.newPage({ viewport: { width, height: 400 } }).then(async page => {
      await page.setContent('<style>' + theme + '</style><body data-fk-context="chat-dark"><div class="ap-ui"><div class="ap-section-head" style="font-size:13px"><h3 id="row"><button>素材包</button><span class="fork-help-tip"><button class="fork-help-tip-button">?</button></span></h3></div></div>' +
        '<div class="fork-gal-stage fork-gal-config" data-theme="classic" style="font-size:16px"><span class="fork-help-tip"><button id="stage" class="fork-help-tip-button">?</button></span></div></body>')
      const read = sel => page.locator(sel).evaluate(el => { const s = getComputedStyle(el), r = el.getBoundingClientRect(); return { border: s.borderTopWidth, radius: s.borderTopLeftRadius, bg: s.backgroundColor, font: parseFloat(s.fontSize) / parseFloat(getComputedStyle(el.parentElement.parentElement).fontSize), w: r.width, h: r.height } })
      const out = { panel: await read('.ap-ui .fork-help-tip-button'), stage: await read('#stage'), row: (await page.locator('#row').boundingBox()).height }
      await page.close(); return out
    })
    const pc = await probe(1280), phone = await probe(375)
    for (const [name, b] of Object.entries({ 'pc panel': pc.panel, 'pc stage': pc.stage, 'phone panel': phone.panel })) {
      assert.equal(b.border, '0px', name + ': no circle')
      assert.equal(b.bg, 'rgba(0, 0, 0, 0)', name + ': no fill')
    }
    for (const b of [pc.panel, pc.stage]) assert.ok(b.font > .6 && b.font < .8, 'glyph is ~0.72em of its row: ' + b.font)
    assert.ok(phone.panel.w >= 32 && phone.panel.h >= 32, 'phone hit target ' + phone.panel.w + 'x' + phone.panel.h)
    assert.ok(Math.abs(phone.row - pc.row) <= 1, 'touch padding does not grow the heading row: ' + pc.row + ' vs ' + phone.row)
  } finally { await browser.close() }
})
