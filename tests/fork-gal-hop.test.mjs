import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const read = name => readFile(new URL('../tavern-plugin/src/client/' + name, import.meta.url), 'utf8')
const scene = await read('fork-gal-scene.js'), live = await read('fork-live2d.js')
const ctx = {}
vm.runInNewContext(scene.slice(scene.indexOf('// ---------- Scene helpers'), scene.indexOf('// ---------- Scene runtime')) +
  live.slice(live.indexOf('const FORK_LIVE2D_ACTS'), live.indexOf('// pixi-live2d-display 0.4')), ctx)
const plain = value => JSON.parse(JSON.stringify(value))
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`)
const rest = { dy: 0, scaleX: 1, scaleY: 1 }

test('hop has two ballistic apexes, a 60% rebound, bounded squash/stretch and exact rest endpoints', () => {
  for (const t of [-1, 0, 1, 2, NaN, Infinity]) assert.deepEqual(plain(ctx.forkGalHopAt(t)), rest)
  const samples = Array.from({ length: 741 }, (_, ms) => ctx.forkGalHopAt(ms / 740))
  const apexes = samples.flatMap((p, i) => i && i < 740 && p.dy < samples[i - 1].dy && p.dy < samples[i + 1].dy ? [i] : [])
  assert.deepEqual(apexes, [210, 550])
  close(samples[210].dy, -0.045)
  close(samples[550].dy / samples[210].dy, 0.6)
  for (const [start, length, height] of [[70, 280, 0.045], [440, 220, 0.027]]) {
    for (const s of [0.1, 0.25, 0.5, 0.75, 0.9]) close(ctx.forkGalHopAt((start + length * s) / 740).dy, -4 * height * s * (1 - s))
  }
  for (const f of samples) {
    assert.ok(f.dy >= -0.045 && f.dy <= 0)
    assert.ok(f.scaleX >= 0.99 && f.scaleX <= 1.03)
    assert.ok(f.scaleY >= 0.96 && f.scaleY <= 1.02)
  }
  close(ctx.forkGalHopAt(24.5 / 740).scaleY, 0.96)
  for (const ms of [381.5, 688]) assert.ok(ctx.forkGalHopAt(ms / 740).scaleY < 0.98, 'each landing compresses')
  for (const ms of [70, 350, 440, 660]) {
    const a = ctx.forkGalHopAt((ms - 1e-6) / 740), b = ctx.forkGalHopAt((ms + 1e-6) / 740)
    for (const key of Object.keys(rest)) assert.ok(Math.abs(a[key] - b[key]) < 1e-8, 'phase boundaries are continuous')
  }
})

test('both act paths use the same curve, duration, and reduced-motion single unscaled hop', () => {
  for (const reduced of [false, true]) {
    const entry = { model: { internalModel: { settings: { motions: {} } } } }
    ctx.forkLive2dStartAct(entry, 'jump', 0)
    assert.equal(entry.act.duration, 740)
    let apexes = 0, last = 0, descending = false
    for (let ms = 0; ms <= 741; ms++) {
      const flat = ctx.forkGalFlatActAt('jump', ms, reduced), animated = ctx.forkLive2dActFrame(entry, ms, reduced)
      for (const key of Object.keys(rest)) close(flat[key], animated[key])
      if (reduced) {
        assert.equal(flat.scaleX, 1); assert.equal(flat.scaleY, 1)
        assert.ok(flat.dy >= -0.015)
        if (flat.dy > last && descending) { apexes++; descending = false }
        if (flat.dy < last) descending = true
        last = flat.dy
      }
      assert.equal(flat.done, ms >= 740)
    }
    assert.equal(entry.act, null)
    if (reduced) assert.equal(apexes, 1)
  }
  assert.equal(ctx.forkGalHopReduced('low'), true)
  assert.equal(ctx.forkGalHopReduced('high'), false)
  ctx.window = { matchMedia: query => ({ matches: query === '(prefers-reduced-motion: reduce)' }) }
  assert.equal(ctx.forkGalHopReduced('high'), true)
  delete ctx.window
  assert.match(scene, /forkLive2dActFrame\(entry, now, reducedHop\)/)
  assert.match(scene, /forkGalFlatActAt\(entry.flatAct.name, now - entry.flatAct.start, reducedHop\)/)
})

test('Live2D anisotropic transform pins bottom center, including mirrors, with lift in figure-height units', () => {
  for (const flip of [1, -1]) for (const ms of [0, 25, 70, 210, 382, 550, 688, 740]) {
    const model = { x: 100, y: 80, internalModel: { originalWidth: 500, originalHeight: 1000 }, scale: { x: 0.7 * flip, y: 0.7, set(x, y) { this.x = x; this.y = y } } }
    const center = model.x + 500 * model.scale.x / 2, bottom = model.y + 1000 * model.scale.y
    const hop = ctx.forkGalHopAt(ms / 740)
    ctx.forkLive2dApplyHop(model, hop)
    close(model.x + 500 * model.scale.x / 2, center)
    close(model.y + 1000 * model.scale.y, bottom + 700 * hop.dy)
  }
  assert.match(scene, /sprite.scale.set\(L.scale \* entry.flip.v \* act.flip \* act.scaleX, L.scale \* breath \* act.scaleY\)/)
  assert.match(scene, /place\(item.sprite\)/, 'fading outfits inherit the same pose')
  assert.match(scene, /sprite.addChild\(entry.mouthCover\)/, 'mouth rig transforms remain children of the portrait')
})
test('reduced motion queries once and follows OS preference changes', () => {
  let calls = 0, changed
  const context = { window: { matchMedia(query) { calls++; assert.equal(query, '(prefers-reduced-motion: reduce)');
    return { matches: false, addEventListener(type, fn) { assert.equal(type, 'change'); changed = fn } } } } }
  vm.runInNewContext(scene.slice(scene.indexOf('// ---------- Scene helpers'), scene.indexOf('// ---------- Scene runtime')), context)
  for (let i = 0; i < 180; i++) assert.equal(context.forkGalHopReduced('high'), false)
  assert.equal(calls, 1)
  changed({ matches: true }); assert.equal(context.forkGalHopReduced('high'), true)
  changed({ matches: false }); assert.equal(context.forkGalHopReduced('high'), false)
  assert.equal(context.forkGalHopReduced('low'), true); assert.equal(calls, 1)
})
