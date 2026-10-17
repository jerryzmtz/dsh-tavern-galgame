// private fork: follow protocol extraction paths; behavior assertions unchanged.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { resolveFigureSizing } from '../tavern-plugin/packages/dsh-presentation-protocol/src/fork-figure-scale.cjs'

const source = await readFile(new URL('../tavern-plugin/src/client/fork-gal-scene.js', import.meta.url), 'utf8')
const css = await readFile(new URL('../tavern-plugin/lib/client-assets/fork-theme.css', import.meta.url), 'utf8')
const ctx = {}
vm.runInNewContext(source.slice(source.indexOf('// ---------- Scene helpers'), source.indexOf('// ---------- Scene runtime')), ctx)
const W = 1600, H = 900, margin = H * .02
const camera = { zoom: 1, rotation: 0, fx: .5, fy: .42, ax: .5, ay: .42 }
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`)
const sha = 'a'.repeat(64)
const input = (extra = {}) => ({ version: 1, source: sha, canvas: [1000, 1000], W, H, heightCm: 23, sceneHMax: 152,
  metrics: { status: 'confirmed', sourceSha: sha, canvas: [1000, 1000], override: { figureTop: 100, headTop: 100, chin: 620, feet: 900, visibleBottom: 900, crop: 'full', posture: 'seated', heightBasis: 'seated' } }, heightBasis: 'seated', ...extra })
const adjust = (head, rest, support = H) => ({ ...head, top: support + (head.top - support) * rest.scale - rest.lift, chin: support + (head.chin - support) * rest.scale - rest.lift, width: head.width * rest.scale })

test('small calibrated character gets the minimal REST lift; explicit elevation composes once', () => {
  const base = resolveFigureSizing(input()), elevated = resolveFigureSizing(input({ elevationCm: 15 }))
  const a = ctx.forkGalFaceRest(base.restHead, base.support.y, 70, 680, H)
  const b = ctx.forkGalFaceRest(elevated.restHead, elevated.support.y, 70, 680, H)
  assert.ok(a.lift > 0); close(a.scale, 1)
  close(adjust(base.restHead, a).chin, 680 - margin)
  close(b.lift, Math.max(0, a.lift - 15 * base.pxPerCm))
})

test('tall character is not lifted through the top safe edge', () => {
  const head = { x: 800, top: 140, chin: 280, width: 100 }
  const rest = ctx.forkGalFaceRest(head, H, 130, 680, H)
  close(rest.lift, 0); close(rest.scale, 1)
  assert.ok(adjust(head, rest).top >= 130)
})

test('impossible REST head uses the largest fitting scale and reports a shrink warning', () => {
  const head = { x: 800, top: 90, chin: 810, width: 550 }
  const rest = ctx.forkGalFaceRest(head, H, 150, 650, H), result = adjust(head, rest)
  close(rest.scale, (650 - margin - 150) / 720)
  close(result.top, 150); close(result.chin, 650 - margin)
  assert.equal(rest.warning, 'face-visibility-shrink')
  assert.match(source, /console\.warn\("\[fork-gal-scene\] face-visibility-shrink"/)
})

test('film uses lower letterbox, with full-stage scale and top letterbox safe edge', () => {
  const raw = resolveFigureSizing(input()), film = ctx.forkGalVisibleFrame(W, H, 1)
  const rest = ctx.forkGalFaceRest(raw.restHead, H, film.top + margin, film.bottom, H), result = adjust(raw.restHead, rest)
  assert.ok(rest.lift > 0); close(result.chin, film.bottom - margin)
  assert.ok(result.top >= film.top + margin)
})

test('legacy estimated head boxes are lifted too; no height calibration is required', () => {
  const raw = ctx.forkGalFlatLayout(400, 400, W, H, .5, 1, 0, .4, 0)
  const head = { x: raw.x, top: raw.y - raw.height, chin: raw.y - raw.height * .6, width: raw.width * .4 }
  const rest = ctx.forkGalFaceRest(head, H, 70, 680, H)
  assert.ok(rest.lift > 0); close(adjust(head, rest).chin, 680 - margin)
})

test('faceRect alone supplies a calibrated rest box', () => {
  const spec = input(); delete spec.metrics.override.headTop; delete spec.metrics.override.chin
  spec.metrics.override.faceRect = [200, 100, 500, 520]
  const sizing = resolveFigureSizing(spec)
  assert.ok(sizing.restHead); assert.ok(ctx.forkGalFaceRest(sizing.restHead, H, 70, 680, H).lift > 0)
})

test('REST cache ignores line, speaking, focus and act; only scene/layout keys replace it', () => {
  const head = resolveFigureSizing(input()).restHead
  let state = ctx.forkGalFaceRestUpdate(null, 'scene1:1600:900:normal', head, H, 70, 680, H, 0)
  for (const change of ['line', 'speaking', 'lean', 'step-back', 'focus']) {
    const again = ctx.forkGalFaceRestUpdate(state, state.key, { ...head, chin: 888, change }, H, 70, 680, H, 100)
    assert.equal(again, state); assert.equal(again.computations, 1)
  }
  for (const key of ['scene1:390:844:normal', 'scene1:390:844:film', 'scene2:390:844:film']) {
    state = ctx.forkGalFaceRestUpdate(state, key, head, H, 70, 680, H, 200)
  }
  assert.equal(state.computations, 4)
})

function replay() {
  const raw = resolveFigureSizing(input()), rest = ctx.forkGalFaceRest(raw.restHead, H, 70, 680, H), frames = []
  for (const actName of ['lean', 'step-back', 'jump']) {
    let previous = 0
    for (let ms = 0; ms <= 1600; ms += 8) {
      const act = ctx.forkGalFlatActAt(actName, ms), focus = 1 - .2 * ctx.forkGalFrameMix(0, 1, ms)
      const scale = focus * act.zoom * act.scaleY
      const head = { ...raw.restHead, top: H + (raw.restHead.top - H) * scale + act.dy * raw.poseSpan - rest.lift,
        chin: H + (raw.restHead.chin - H) * scale + act.dy * raw.poseSpan - rest.lift }
      const clamp = ctx.forkGalFaceClamp(head, camera, W, H, 680, previous, .008)
      assert.ok(clamp.chin - clamp.lift <= 680 - margin + 1e-6, `${actName} at ${ms}`)
      assert.ok(clamp.lift >= 0)
      if (ms) assert.ok(Math.abs(clamp.lift - previous) < 10, 'continuous correction, no frame pop')
      previous = clamp.lift; frames.push([actName, ms, clamp.lift])
    }
  }
  return frames
}
test('far focus and lean/step-back/jump remain clear at every sampled animation frame', () => { replay() })
test('replaying the same scene and animation clock is deterministic', () => { assert.deepEqual(replay(), replay()) })

test('film-normal round trip stays clear while both REST and occluder ease over 700ms', () => {
  const raw = resolveFigureSizing(input()), film = ctx.forkGalVisibleFrame(W, H, 1)
  let state = ctx.forkGalFaceRestUpdate(null, 'normal', raw.restHead, H, 70, 680, H, 0)
  let previous = 0
  for (const [start, from, to, key] of [[0, 680, film.bottom, 'film'], [700, film.bottom, 680, 'normal']]) {
    state = ctx.forkGalFaceRestUpdate(state, key, raw.restHead, H, key === 'film' ? film.top + margin : 70, to, H, start)
    for (let elapsed = 0; elapsed <= 700; elapsed += 5) {
      const rest = ctx.forkGalFaceRestFrame(state, start + elapsed), top = ctx.forkGalFrameMix(from, to, elapsed)
      const head = adjust(raw.restHead, rest)
      const clamp = ctx.forkGalFaceClamp(head, camera, W, H, top, previous, .005)
      assert.ok(clamp.chin - clamp.lift <= top - margin + 1e-6)
      previous = clamp.lift
    }
  }
})

test('final safety accounts for rotated camera, head, zoom, and shake; upward motion is unrestricted', () => {
  for (const rotation of [-.1, 0, .1]) for (const zoom of [1, 1.8]) {
    const head = { x: 1200, top: 550, chin: 720, width: 200, rotation: .2 }, cam = { ...camera, rotation, zoom, shakeY: 9 }
    const clamp = ctx.forkGalFaceClamp(head, cam, W, H, 680)
    assert.ok(clamp.chin - clamp.lift * zoom * Math.cos(rotation) <= 680 - margin + 1e-6)
  }
  close(ctx.forkGalFaceClamp({ x: 800, top: -10, chin: 150, width: 80 }, camera, W, H, 680).lift, 0)
})

test('runtime REST cache logs shrink once and survives line/speech/act updates', () => {
  const warnings = [], head = { x: 800, top: 90, chin: 810, width: 550 }
  const entry = { figure: { alias: 'legacy' }, cx: { v: .5 }, restHead: { ...head }, container: { scale: { set() {} }, position: { set() {} } } }
  const context = { ...ctx, console: { warn: (...args) => warnings.push(args) }, state: { figureScale: { scene: 1, rescales: 0 }, figures: new Map([['legacy', entry]]) },
    faceEnvironment: () => ({ key: 'normal:1600:900', top: 150, occluderTop: 650 }) }
  vm.runInNewContext(source.slice(source.indexOf('function tickFaceRest('), source.indexOf('function tickFaceClamp(')), context)
  for (let now = 0; now < 1000; now += 16) {
    entry.restHead = { ...head }; entry.figure = { ...entry.figure, speaking: now % 32 === 0, act: { name: 'lean', nonce: now } }
    context.tickFaceRest({ line: now }, now, W, H)
  }
  assert.equal(entry.faceRest.computations, 1); assert.equal(warnings.length, 1)
  assert.equal(warnings[0][0], '[fork-gal-scene] face-visibility-shrink')
  close(entry.restHead.top, 150); close(entry.restHead.chin, 650 - margin)
})

test('rare rescale REST decision uses the locked destination ruler, not a transient size', () => {
  // private fork: destination includes the short figure ground at the stable occluder.
  const spec = input({ occluderTop: 680 }), initial = resolveFigureSizing(spec), destination = resolveFigureSizing({ ...spec, sceneHMax: 220 })
  const entry = { figure: { alias: 'small' }, figureSizing: spec, figureResolved: initial, cx: { v: .5 }, restHead: initial.restHead,
    container: { scale: { set() {} }, position: { set() {} } } }
  const context = { ...ctx, resolveFigureSizing, console, state: { figureScale: { scene: 1, rescales: 1, to: 220 }, figures: new Map([['small', entry]]) },
    faceEnvironment: () => ({ key: 'normal:1600:900', top: 70, occluderTop: 680 }) }
  vm.runInNewContext(source.slice(source.indexOf('function tickFaceRest('), source.indexOf('function tickFaceClamp(')), context)
  context.tickFaceRest({}, 0, W, H)
  close(entry.faceRest.to.lift, ctx.forkGalFaceRest(destination.restHead, destination.support.y, 70, 680, H, destination.restBounds).lift) // private fork: destination full-body bounds
})

test('runtime applies REST before camera/headroom and exact transient clamp before emotes', () => {
  const tick = source.slice(source.indexOf('const dofTarget = tickFigures'), source.indexOf('// Entry/jump:'))
  assert.ok(tick.indexOf('tickFaceRest') < tick.indexOf('tickCamera'))
  assert.ok(tick.indexOf('tickFaceClamp') > tick.indexOf('entry.container.y += entry.headroom'))
  assert.ok(tick.indexOf('tickFaceClamp') < tick.indexOf('effects.tick'))
  assert.match(source, /headOf\(entry, false, true\)/)
  assert.match(source, /parseFloat\(style\.bottom\).*parseFloat\(style\.height\)/)
  assert.match(css, /--gal-frame-ms: 700ms/)
  assert.match(css, /height var\(--gal-frame-ms\) var\(--gal-frame-ease\)/)
  assert.match(css, /--gal-box-normal-height: var\(--cl-box-h\)/)
})


test('Live2D transient clamp transforms REST corners without sampling or updating Cubism', () => {
  const context = { ...ctx, emotesBox: {}, headOf() { throw Error('live drawable read') },
    forkGalDisplayMatrix: () => ({ a: -1.5, b: 0, c: 0, d: 1.2, tx: 1000, ty: 40 }) }
  vm.runInNewContext(source.slice(source.indexOf('function clampHeadOf('), source.indexOf('function tickFaceClamp(')), context)
  const entry = { model: {}, clampLocalHead: { x: 200, top: 100, chin: 300, width: 120 } }
  const head = context.clampHeadOf(entry)
  close(head.x, 700); close(head.top, 160); close(head.chin, 400); close(head.width, 180)
  const clamp = ctx.forkGalFaceClamp(head, camera, W, H, 390, 0, .016)
  assert.ok(clamp.chin - clamp.lift <= 390 - margin + 1e-6)
  let flat = 0
  context.headOf = () => { flat++; return head }
  assert.equal(context.clampHeadOf({ sprite: {} }), head)
  assert.equal(flat, 1, 'flat portraits retain exact fading-outfit union')
})

test('settled face clamp uses cached box geometry; layout invalidation refreshes it', () => {
  let reads = 0, height = 200
  const env = { box: {}, boxDirty: true, rise: 5, occluderTop: 680 }
  const context = { ...ctx, state: { faceEnvironment: env, camera: { safe: camera }, figures: new Map() },
    world: { position: { y: camera.ay * H } }, getComputedStyle: () => { reads++; return { bottom: '20', height: String(height) } } }
  vm.runInNewContext(source.slice(source.indexOf('function tickFaceClamp('), source.indexOf('// ---- one-shot effects')), context)
  for (let i = 0; i < 180; i++) context.tickFaceClamp(.006, W, H, { bottom: H })
  assert.equal(reads, 1); close(context.state.faceOccluderTop, 675)
  height = 240; env.boxDirty = true
  context.tickFaceClamp(.006, W, H, { bottom: H })
  assert.equal(reads, 2); close(context.state.faceOccluderTop, 635)
  context.world.position.y -= 10
  context.tickFaceClamp(.006, W, H, { bottom: H })
  assert.equal(reads, 2); close(context.state.faceOccluderTop, 625)
})
