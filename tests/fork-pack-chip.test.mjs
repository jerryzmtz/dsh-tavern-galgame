// private fork (owner 2026-10 pack-chip): the pack-row state chip sizes to its content — no hole between the label and
// the chevron, the label never clipped — in the docked side panel, the full-width library and on a phone.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('state chip has no hard-coded width', async () => {
  const css = await readFile(new URL('../tavern-plugin/lib/client-assets/fork-theme.css', import.meta.url), 'utf8')
  const rules = css.split('}').filter(rule => rule.split('{')[0].split(',').some(sel => /\.ap-state-(pill|tag)(\[[^\]]*\]|:[\w-]+(\([^)]*\))?)*\s*$/.test(sel)))
  for (const rule of rules) assert.doesNotMatch(rule, /(^|[;{\s])(min-)?width:\s*\d+px/, rule.trim())
  assert.match(css, /\.ap-state-tag > span \{ flex: none;/) // private fork (UI standard chips): the one chip is the text-only tag
})

test('browser: chip width follows its content, label not clipped, side panel / full width / 375', async () => {
  const { run } = await import('./harness/pack-chip.mjs')
  const { errors, results } = await run()
  assert.deepEqual(errors, [])
  for (const [tag, chips] of Object.entries(results)) {
    assert.deepEqual(new Set(chips.map(c => c.state)), new Set(['global', 'card', 'off']), tag)
    for (const c of chips) { assert.ok(c.gap <= 2, tag + ' label off-centre ' + c.gap); assert.equal(c.height, 24, tag + ' one small size'); assert.equal(c.clipped, false, tag) } // private fork (UI standard chips): text-only 24px tag
    assert.equal(new Set(chips.map(c => c.width)).size, 1, tag + ': one width by content')
  }
})
