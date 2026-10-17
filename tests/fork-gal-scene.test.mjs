import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

// Private fork (docs/fork/galgame-stage.md): pure helpers of the pixi stage scene.
const source = await readFile(new URL('../tavern-plugin/src/client/fork-gal-scene.js', import.meta.url), 'utf8')
const helpers = source.slice(source.indexOf('// ---------- Scene helpers'), source.indexOf('// ---------- Scene runtime'))
const ctx = {}
vm.runInNewContext(helpers + `;Object.assign(this, { forkGalEase, forkGalSpring, forkGalTween, forkGalTweenAt, forkGalResolution, forkGalCover, forkGalTransitionPlan,
  forkGalTransitionFrame, forkGalWipeRect, forkGalIrisSize, forkGalMatrix, forkGalCameraTarget, forkGalShakeAt, forkGalOverlayAt,
  forkGalFigurePlan, forkGalFigureInit, forkGalFigureStep, forkGalFigureGone, forkGalFlatLayout, forkGalFlatActAt, forkGalSceneMerge, forkGalFlapStep, forkGalStaticVoiced, forkGalShouldBlink, forkGalOwnBlink, FORK_GAL_ZOOM_IN })`, ctx)
const plain = value => JSON.parse(JSON.stringify(value))
const close = (a, b, eps = 1e-3) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`)

// private fork: restored/reopened figures do not replay an entrance on a throttled render clock.
test('restored figures start opaque; real entrances still finish within half a second of render time', async () => {
  const stage = await readFile(new URL('../tavern-plugin/src/client/fork-gal-stage.js',import.meta.url),'utf8')
  assert.match(stage,/enter:forwardReading&&!skipping\?'soft':'none'/)
  const figure={x:0.5,visible:true,scene:'room',enter:'none'}, restored={}
  ctx.forkGalFigureInit(restored,figure)
  assert.equal(restored.alpha.v,1)
  const arrival={};ctx.forkGalFigureInit(arrival,{...figure,enter:'soft'})
  for(let frame=1;frame<=30;frame++) ctx.forkGalFigureStep(arrival,{...figure,enter:'soft'},frame*1000/60,1/60)
  assert.ok(arrival.alpha.v>0.9)
})

test('stage blink runs during gestures under expressions, retaining already closed eyes', () => {
  assert.equal(ctx.forkGalShouldBlink(1), true)
  assert.equal(ctx.forkGalShouldBlink(0.2), true)
  assert.equal(ctx.forkGalShouldBlink(0.19), false)
  assert.equal(ctx.forkGalShouldBlink(0), false)
  let eye = 0.1
  const calls = [], events = {}, coreModel = { getParameterValueById: () => eye, setParameterValueById: (id, value) => { eye = value } }, motionManager = { playing: true, isFinished: () => false }
  const internal = { coreModel, motionManager, eyeBlink: { getParameterIds: () => ['ParamEyeLOpen'], updateParameters: (...args) => { calls.push(args); eye = 0.6 } }, on: (event, fn) => { events[event] = fn } }
  let seconds = 1 / 60
  ctx.forkGalOwnBlink(internal, () => seconds)
  assert.equal(internal.eyeBlink, undefined, 'disable the expression-overwriting runtime blink')
  events.afterMotionUpdate()
  assert.equal(calls.length, 1, 'gesture does not suppress blink clock')
  assert.equal(eye, 0.1, 'closed pose is not reopened')
  eye = 1
  assert.deepEqual(calls, [[coreModel, 1 / 60]])
  seconds = 0.025
  motionManager.playing = false
  events.afterMotionUpdate()
  assert.deepEqual(calls[1], [coreModel, 0.025])
  assert.equal(eye, 0.6, 'open pose receives blink')
  ctx.forkGalOwnBlink({ eyeBlink: undefined }, () => 0)
  assert.match(source, /forkLive2dStartIdle\(model, \(\) => entry\.updateSeconds \|\| 0\)/)
})

test('static lip flap: opening threshold, hysteresis, 80 ms minimum hold on both frames, immediate no-voice close', () => {
  const step = ctx.forkGalFlapStep
  let state = step(null, 0.32, true, 0)
  assert.equal(state.open, false)
  state = step(state, 0.33, true, 1)
  assert.equal(state.open, true)
  assert.equal(step(state, 0, true, 80).open, true, 'holds open for at least 80 ms')
  assert.equal(step(state, 0.18, true, 81).open, true, 'lower hysteresis threshold stays open')
  state = step(state, 0.17, true, 81)
  assert.equal(state.open, false)
  assert.equal(step(state, 1, true, 160).open, false, 'holds base for at least 80 ms')
  state = step(state, 1, true, 161)
  assert.equal(state.open, true)
  state = step(state, 1, false, 162)
  assert.equal(state.open, false, 'no voice overrides hold')
  assert.equal(step(state, 1, false, 999).open, false, 'text-only cannot open')
  assert.equal(step(null, NaN, true, 0).open, false)
  assert.equal(step(null, Infinity, true, 0).open, false)
})

test('static lip flap: only a visible speaker with actually playing, audible audio is voiced', () => {
  const figure = { speaking: true, audio: { paused: false, ended: false, muted: false, volume: 1 } }
  assert.equal(ctx.forkGalStaticVoiced(figure), true)
  for (const audio of [null, { ...figure.audio, paused: true }, { ...figure.audio, ended: true }, { ...figure.audio, muted: true }, { ...figure.audio, volume: 0 }]) assert.equal(ctx.forkGalStaticVoiced({ ...figure, audio }), false)
  assert.equal(ctx.forkGalStaticVoiced({ ...figure, speaking: false }), false)
  assert.equal(ctx.forkGalStaticVoiced({ ...figure, visible: false }), false)
  assert.equal(ctx.forkGalStaticVoiced({ speaking: true, talking: true }), false)
  assert.match(source, /voiced \? forkLipSync\.level\(figure\.audio\) : 0/)
  assert.match(source, /entry\.sprite\.texture = entry\.flap\.open \? talkTexture : entry\.baseTexture/)
  assert.match(source, /loadTexture\(figure\.talkSrc\)/)
})

// Runs a figure through the ticker at 60 fps for ms milliseconds.
function run(entry, figure, from, ms) {
  let now = from
  for (let t = 0; t < ms; t += 1000 / 60) { now += 1000 / 60; ctx.forkGalFigureStep(entry, figure, now, 1 / 60) }
  return now
}

test('spring: smooth start, settles without overshoot, frame-rate independent', () => {
  const a = { v: 0, d: 0 }, b = { v: 0, d: 0 }
  let max = 0
  for (let i = 0; i < 60; i++) { ctx.forkGalSpring(a, 1, 8, 1 / 60); max = Math.max(max, a.v) }
  for (let i = 0; i < 30; i++) ctx.forkGalSpring(b, 1, 8, 1 / 30)
  assert.ok(max <= 1)
  close(a.v, b.v, 1e-6)
  assert.ok(a.v > 0.99)
  const c = { v: 0, d: 0 }
  ctx.forkGalSpring(c, 1, 8, 1 / 60)
  assert.ok(c.v < 0.01, 'first frame barely moves (no pop)')
})

test('cover fit, resolution cap and camera targets', () => {
  const fit = ctx.forkGalCover(1920, 1080, 1712, 926, 1.04)
  assert.ok(fit.scale * 1920 >= 1712 * 1.04 - 1e-6 && fit.scale * 1080 >= 926 * 1.04 - 1e-6)
  close(fit.x, (1712 - 1920 * fit.scale) / 2)
  assert.equal(ctx.forkGalResolution('high', 2.25), 2)
  assert.equal(ctx.forkGalResolution('high', 1.25), 1.25)
  assert.equal(ctx.forkGalResolution('low', 2.25), 1)
  assert.deepEqual(plain(ctx.forkGalCameraTarget({ zoom: ctx.FORK_GAL_ZOOM_IN })), { zoom: 1.12, panX: 0, panY: 0, rotation: 0 })
  assert.deepEqual(plain(ctx.forkGalCameraTarget(null)), { zoom: 1, panX: 0, panY: 0, rotation: 0 })
  const push = ctx.forkGalTween(1, 1.12, 0, 1200, 'inOutCubic')
  assert.equal(ctx.forkGalTweenAt(push, 0), 1)
  close(ctx.forkGalTweenAt(push, 600), 1.06)
  assert.equal(ctx.forkGalTweenAt(push, 5000), 1.12)
})

test('transition planner: default cross-fade, cut, black/white swap under cover, masks, skipping', () => {
  assert.deepEqual(plain(ctx.forkGalTransitionPlan()), { kind: 'fade', duration: 600, direction: 'left' })
  assert.equal(ctx.forkGalTransitionPlan('bogus').kind, 'fade')
  assert.equal(ctx.forkGalTransitionPlan('iris', { first: true }).kind, 'fade', 'the first picture rises from the dark')
  assert.deepEqual(plain(ctx.forkGalTransitionPlan('black', { skipping: true })), { kind: 'fade', duration: 180, direction: 'left' })
  const cut = ctx.forkGalTransitionPlan('cut')
  assert.equal(ctx.forkGalTransitionFrame(cut, 0).done, true)
  const fade = ctx.forkGalTransitionPlan('fade')
  assert.equal(ctx.forkGalTransitionFrame(fade, 0).incoming, 0)
  close(ctx.forkGalTransitionFrame(fade, 0.5).incoming, 0.5)
  assert.equal(ctx.forkGalTransitionFrame(fade, 1).done, true)
  const black = ctx.forkGalTransitionPlan('black')
  const before = ctx.forkGalTransitionFrame(black, 0.3), peak = ctx.forkGalTransitionFrame(black, 0.5), after = ctx.forkGalTransitionFrame(black, 0.9)
  assert.equal(before.incoming, 0)
  assert.ok(before.cover > 0.5 && before.cover < 1)
  assert.deepEqual([peak.cover, peak.incoming, peak.color], [1, 1, 0])
  assert.ok(after.cover < 0.2 && after.incoming === 1)
  assert.equal(ctx.forkGalTransitionFrame(ctx.forkGalTransitionPlan('white'), 0.4).color, 0xffffff)
  const wipe = ctx.forkGalTransitionPlan('wipe')
  close(ctx.forkGalTransitionFrame(wipe, 0.5).mask, 0.5)
  assert.equal(ctx.forkGalTransitionFrame(wipe, 1).mask, -1, 'done layers drop their mask')
  const start = ctx.forkGalWipeRect(0, 1000, 0.25, 'left'), end = ctx.forkGalWipeRect(1, 1000, 0.25, 'left')
  close(start.x + start.width, 0)
  close(end.x, 0)
  assert.equal(ctx.forkGalWipeRect(1, 1000, 0.25, 'right').flip, -1)
  const size = ctx.forkGalIrisSize(1, 1600, 900, 800, 378, 0.78)
  assert.ok(size * 0.78 / 2 >= Math.hypot(800, 900 - 378) - 1e-6, 'opaque disc covers the far corner')
  assert.equal(ctx.forkGalIrisSize(0, 1600, 900, 800, 378, 0.78), 0)
})

test('colour matrices: identity, multiply order, mixing', () => {
  const M = ctx.forkGalMatrix
  assert.ok(M.isIdentity(M.multiply(M.identity(), M.identity())))
  const half = M.mix(M.identity(), M.scale(0.5, 0.5, 0.5), 0.5)
  close(half[0], 0.75)
  assert.deepEqual(plain(M.multiply(M.scale(2, 2, 2), M.offset(0.1, 0, 0)).slice(0, 5)), [2, 0, 0, 0, 0.2], 'offset applied first, then scaled')
})

test('shake decays to rest; overlays: flash, fade black dip and return, fade in', () => {
  const rest = ctx.forkGalShakeAt(2, 1, 0)
  close(rest.x, 0); close(rest.y, 0); assert.equal(rest.done, false)
  const mid = ctx.forkGalShakeAt(3, 1, 120)
  assert.ok(Math.abs(mid.x) <= 24 && (Math.abs(mid.x) + Math.abs(mid.y)) > 0)
  assert.equal(ctx.forkGalShakeAt(1, 1, 600).done, true)
  const peak = Math.max(...Array.from({ length: 50 }, (_, i) => Math.abs(ctx.forkGalShakeAt(1, 2, i * 10).x)))
  assert.ok(peak > 1 && peak <= 4)
  close(ctx.forkGalOverlayAt({ op: 'flash' }, 0).alpha, 0.92)
  assert.equal(ctx.forkGalOverlayAt({ op: 'flash' }, 600).done, true)
  assert.equal(ctx.forkGalOverlayAt({ op: 'fade', value: 'black' }, 0).alpha, 0)
  assert.equal(ctx.forkGalOverlayAt({ op: 'fade', value: 'black' }, 750).alpha, 1)
  assert.equal(ctx.forkGalOverlayAt({ op: 'fade', value: 'black' }, 750).color, 'black')
  assert.ok(ctx.forkGalOverlayAt({ op: 'fade', value: 'black' }, 1800).alpha < 0.05)
  assert.equal(ctx.forkGalOverlayAt({ op: 'fade', value: 'in' }, 0).alpha, 1)
  assert.equal(ctx.forkGalOverlayAt({ op: 'fade', value: 'in' }, 1300).done, true)
})

test('static and Live2D tremble share a 6Hz, 1.25px, 1000ms eased shiver; head shakes stay restrained', async () => {
  const live = await readFile(new URL('../tavern-plugin/src/client/fork-live2d.js', import.meta.url), 'utf8')
  vm.runInNewContext(live.slice(live.indexOf('const FORK_LIVE2D_ACTS'), live.indexOf('// pixi-live2d-display 0.4')), ctx)
  let peak = 0, crossings = 0, last = 0
  for (let ms = 0; ms <= 1000; ms++) {
    const flat = ctx.forkGalFlatActAt('tremble', ms)
    const entry = { act: { name: 'tremble', start: 0, duration: 1000 } }
    const liveFrame = ctx.forkLive2dActFrame(entry, ms)
    close(flat.px, liveFrame.px)
    assert.equal(liveFrame.dx, 0, 'shiver uses pixels, not a viewport-dependent translation')
    peak = Math.max(peak, Math.abs(flat.px))
    if (last * flat.px < 0) crossings++
    if (Math.abs(flat.px) > 1e-6) last = flat.px
    if (ms < 10 || ms > 990) assert.ok(Math.abs(flat.px) < 0.001, 'smooth start and finish')
    const shake = ctx.forkLive2dActFrame({ act: { name: 'shake', start: 0, duration: 850 } }, ms)
    assert.ok(Math.abs(shake.angleX) <= 10)
    assert.ok(Math.abs(ctx.forkGalFlatActAt('shake', ms).dx) <= 0.01)
  }
  assert.equal(crossings, 11, 'six cycles in one second')
  assert.ok(peak > 1.2 && peak <= 1.25)
  assert.equal(ctx.forkGalFlatActAt('tremble', 999).done, false)
  assert.equal(ctx.forkGalFlatActAt('tremble', 1000).done, true)
  // private fork: the stage scene is the only Live2D renderer (the unused ForkLive2dCanvas was removed).
  assert.match(source, /model\.x \+= act\.px/)
})

// private fork: arrivals/exits fade without crossing others; speaking does not resize.
test('figure lifecycle: plan, fade-in, scene dip, in-place exits', () => {
  const plan = ctx.forkGalFigurePlan([
    { key: 'a', kind: 'live2d', identity:'u1', url: 'u1' }, { key: 'b', kind: 'live2d', identity:'u2', url: 'u2' }, { key: 'c', kind: 'static', url: '' }, { key: 'd', kind: 'static', url: '', leaving: true }
  ], [{ key: 'a', kind: 'live2d', identity:'u1', url: 'u1' }, { key: 'b', kind: 'live2d', identity:'u9', url: 'u9' }, { key: 'd', kind: 'static' }, { key: 'e', kind: 'static' }])
  assert.deepEqual(plain(plan), { add: [{ key: 'e', kind: 'static' }], replace: ['b'], retire: ['c'], revive: ['d'] })

  const slide = {}
  const figure = { key: 'a', x: 0.2, focus: 1, enter: 'left', visible: true, scene: 'S1' }
  ctx.forkGalFigureStep(slide, figure, 0, 1 / 60)
  assert.ok(slide.cx.v === 0.2 && slide.alpha.v < 0.05, 'historical enter left fades at its slot')
  run(slide, figure, 0, 1200)
  close(slide.cx.v, 0.2)

  const soft = {}
  const softFigure = { key: 'b', x: 0.8, focus: 1, enter: 'soft', visible: true, scene: 'S1' }
  ctx.forkGalFigureStep(soft, softFigure, 0, 1 / 60)
  assert.ok(soft.alpha.v < 0.05 && soft.cx.v === 0.8, 'soft entrance fades at its slot')
  let now = run(soft, softFigure, 0, 1500)
  close(soft.alpha.v, 1); close(soft.cx.v, 0.8)

  // Scene change: dip out, then fade back at the same slot.
  now = run(soft, { ...softFigure, scene: 'S2' }, now, 300)
  assert.ok(soft.alpha.v < 0.1, 'dips out with the old scene')
  now = run(soft, { ...softFigure, scene: 'S2' }, now, 1400)
  close(soft.alpha.v, 1); close(soft.cx.v, 0.8)

  // Focus, speaking and lighting ease, never jump.
  const lit = { ...softFigure, scene: 'S2', focus: 1.45, close: true, speaking: true, shade: 0.8 }
  ctx.forkGalFigureStep(soft, lit, now + 16, 1 / 60)
  assert.ok(!('cf' in soft) && soft.shade.v > 0.99, 'private fork: camera close-up never scales one sprite')
  now = run(soft, lit, now, 1500)
  /* private fork: no independent focus spring */ close(soft.shade.v, 0.8); close(soft.lift.v, 1)

  // Exits fade in place, regardless of old direction hints.
  const exitLeft = run(slide, { ...figure, visible: false, exit: 'left' }, 1200, 900)
  assert.ok(slide.cx.v === 0.2 && ctx.forkGalFigureGone(slide), 'fades out without sweeping left')
  assert.ok(exitLeft > 0)
  run(soft, { ...lit, visible: false, exit: 'soft' }, now, 800)
  assert.ok(soft.alpha.v < 0.02 && soft.cx.v === 0.8 && ctx.forkGalFigureGone(soft))

  // Skipping: entrances are instant.
  const instant = {}
  ctx.forkGalFigureStep(instant, { key: 'c', x: 0.5, enter: 'none', visible: true, scene: 'S1' }, 0, 1 / 60)
  assert.deepEqual([instant.cx.v, instant.alpha.v], [0.5, 1])
})

test('gaze eases; static portraits: layout, close-up lift, acts; debug override merge', () => {
  const entry = {}
  const figure = { key: 'a', x: 0.3, enter: 'none', visible: true, scene: 'S', gaze: 1 }
  run(entry, figure, 0, 1000)
  assert.ok(entry.look > 0.95 && entry.lookOn)
  run(entry, { ...figure, gaze: -1 }, 1000, 1000)
  close(entry.flip.v, -1, 0.01)

  const L = ctx.forkGalFlatLayout(1000, 2000, 1600, 900, 0.5, 1, 0)
  close(L.height, 900 * 0.88); assert.equal(L.x, 800); assert.equal(L.y, 900)
  const wide = ctx.forkGalFlatLayout(2000, 1000, 1600, 900, 0.5, 1, 0)
  close(wide.width, 1600 * 0.4, 1e-6)
  const closeUp = ctx.forkGalFlatLayout(1000, 2000, 1600, 900, 0.5, 1.45, 1)
  assert.ok(closeUp.y > 900 && closeUp.y - closeUp.height < 30, 'close-up grows and drops so the face stays in frame')
  assert.equal(ctx.forkGalFlatActAt('nod', 100).done, false)
  close(ctx.forkGalFlatActAt('jump', 210).dy, -0.045)
  assert.equal(ctx.forkGalFlatActAt('turn', 650).flip, -1)
  assert.equal(ctx.forkGalFlatActAt('nod', 700).done, true)
  assert.equal(ctx.forkGalFlatActAt('bogus', 10).done, true)

  const base = { grade: '', background: { url: 'a', name: 'A', transition: 'fade' }, camera: { zoom: 1, panX: 0 }, figures: [1, 2] }
  const merged = ctx.forkGalSceneMerge(base, { grade: 'night', background: { transition: 'iris' }, camera: { zoom: 1.12 }, figures: [] })
  assert.deepEqual(plain(merged), { grade: 'night', background: { url: 'a', name: 'A', transition: 'iris' }, camera: { zoom: 1.12, panX: 0 }, figures: [] })
  assert.equal(ctx.forkGalSceneMerge(base, null), base)
})
