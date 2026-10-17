// private fork (figure-editor r4, owner 2026-10): the figure editor's default preview framing is one deterministic rule on
// the sprite's opaque bounding box. This table pins it for the common shapes with synthetic boxes (no picture needed).
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../tavern-plugin/src/client/fork-asset-pack-figure-ui.js', import.meta.url), 'utf8')
const between = (s, a, b) => { const i = s.indexOf(a), j = s.indexOf(b, i); assert.ok(i >= 0 && j > i, 'missing ' + a); return s.slice(i, j) }
const { figureFit, figureBox, anatomyHeadShare } = new Function(between(source, 'const FIGURE_FIT=', '// end figureFit') + 'return {figureFit,figureBox,anatomyHeadShare}')()

// A desktop card's framing box (1600×900 window) and the phone card's.
const DESK = { W: 415, H: 667 }, PHONE = { W: 327, H: 248 }
// ink: [width, height] of the opaque box in source px; cut: drawn into the canvas's bottom edge.
const CASES = [
  { name: 'normal full-body', ink: [460, 1100], fill: [0.99, 1], cropMax: 0 },
  { name: 'very tall / slim', ink: [180, 1200], fill: [0.99, 1], cropMax: 0 },
  { name: 'wide costume (十二单 sleeves, skirts)', ink: [800, 1100], fill: [0.99, 1], cropMax: 0.25 },
  { name: 'wings / cape / big tail / weapon', ink: [1100, 1100], fill: [0.6, 0.8], cropMax: 0.1 },
  // r4b: a small figure (≤ 128 cm declared, or a chibi / SD build) is shown whole — never blown up to crop at the sides.
  { name: 'chibi with declared 120 cm', ink: [930, 1000], cm: 120, fill: [0.6, 0.76], cropMax: 0 },
  { name: 'chibi by anatomy, no height', ink: [840, 1000], head: 0.35, fill: [0.7, 0.79], cropMax: 0 },
  { name: 'wide chibi (big tail, spread arms), 120 cm', ink: [1150, 1000], cm: 120, fill: [0.5, 0.6], cropMax: 0 },
  { name: 'short adult 150 cm (not small)', ink: [450, 1100], cm: 150, fill: [0.93, 0.94], cropMax: 0 },
  { name: 'chibi cropped tight at the feet (reads as cut)', ink: [1000, 900], cut: true, head: 0.4, fill: [0.5, 0.6], cropMax: 0 },
  { name: '120 cm chibi touching the canvas bottom (大肥鱼)', ink: [932, 1000], cut: true, cm: 120, fill: [0.6, 0.7], cropMax: 0 },
  { name: 'half-body / bust (cut at the bottom)', ink: [900, 1000], cut: true, fill: [0.99, 1], cropMax: 0.25 },
  { name: 'seated / crouching', ink: [850, 1000], fill: [0.85, 1], cropMax: 0.2 },
  { name: 'kneeling / crouching (squat box)', ink: [700, 760], fill: [0.75, 0.9], cropMax: 0.12 },
  { name: 'lying / landscape sprite', ink: [2500, 1000], fill: [0.15, 0.3], cropMax: 0 },
  { name: 'landscape canvas, lying figure with props', ink: [1900, 620], fill: [0.15, 0.3], cropMax: 0 },
  { name: 'non-human mascot', ink: [1050, 950], fill: [0.55, 0.75], cropMax: 0.05 },
  { name: 'group / two characters', ink: [1500, 1200], fill: [0.4, 0.6], cropMax: 0 },
  { name: 'tall mascot / standing animal', ink: [600, 900], fill: [0.99, 1], cropMax: 0.1 },
  { name: 'tiny source (crispness cap)', ink: [90, 200], fill: [0.55, 0.62], cropMax: 0 },
  { name: 'huge source', ink: [2400, 6000], fill: [0.99, 1], cropMax: 0 },
  // Transparent padding / off-centre content: only the opaque box counts — a 1000×1000 canvas holding a 330×900 figure
  // frames like any normal figure (pictureInk trims the canvas before the rule sees it).
  { name: 'padded / off-centre canvas (opaque box only)', ink: [330, 900], fill: [0.99, 1], cropMax: 0 }
]
test('default framing table: every common sprite shape gets a sensible box', () => {
  const rows = []
  for (const c of CASES) {
    const aspect = c.ink[0] / c.ink[1], fit = figureFit({ aspect, cut: !!c.cut, heightCm: c.cm, headShare: c.head, inkPx: c.ink[1] })
    const box = figureBox(fit, aspect, DESK.W, DESK.H), phone = figureBox(fit, aspect, PHONE.W, PHONE.H)
    rows.push({ case: c.name, aspect: +aspect.toFixed(2), ...fit, heightShare: +box.heightShare.toFixed(2), crop: +box.cropEachSide.toFixed(2), phoneHeight: +phone.heightShare.toFixed(2) })
    assert.ok(box.heightShare >= c.fill[0] && box.heightShare <= c.fill[1], c.name + ': height share ' + box.heightShare.toFixed(3))
    assert.ok(box.cropEachSide <= c.cropMax + 1e-9, c.name + ': crops ' + box.cropEachSide.toFixed(3) + ' each side')
    // Never more than a quarter of the card cropped per side, on any card shape; never upscaled past 2× the ink.
    for (const card of [DESK, PHONE, { W: 600, H: 845 }]) { const b = figureBox(fit, aspect, card.W, card.H); assert.ok(b.cropEachSide <= 0.25 + 1e-9); assert.ok(b.height <= c.ink[1] * 2 + 0.5) }
  }
  if (process.env.FIGURE_FIT_TABLE) console.table(rows)
})
test('the rule is monotonic in width and deterministic', () => {
  let last = Infinity
  for (let a = 0.2; a <= 3; a += 0.05) { const f = figureFit({ aspect: a }); assert.ok(f.spill <= last + 1e-9); assert.ok(f.spill >= 1 && f.spill <= 1.5); last = f.spill }
  assert.deepEqual(figureFit({ aspect: 0.73, heightCm: 150 }), figureFit({ aspect: 0.73, heightCm: 150 }))
  // A declared height wins over the anatomy; a missing / broken aspect falls back to a normal figure.
  assert.equal(figureFit({ aspect: 0.5, heightCm: 200, headShare: 0.4 }).share, 1)
  assert.equal(figureFit({ aspect: 0.5, heightCm: 40 }).share, 0.6)
  assert.deepEqual(figureFit({ aspect: NaN }), figureFit({ aspect: 0.5 }))
})
test('head share reads calibrated anatomy only', () => {
  assert.equal(anatomyHeadShare({ source: 'estimated', headTop: 0.1, chin: 0.22, figureTop: 0.1, feet: 0.94 }), undefined)
  assert.ok(Math.abs(anatomyHeadShare({ source: 'calibrated', headTop: 0.12, chin: 0.4667, figureTop: 0.0108, feet: 0.9867 }) - 0.355) < 0.002)
  assert.equal(anatomyHeadShare(undefined), undefined)
})
