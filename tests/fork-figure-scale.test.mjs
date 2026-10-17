// private fork: follow protocol extraction paths; behavior assertions unchanged.
import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFile } from "node:fs/promises"

import { FORK_FIGURE_DISPLAY, forkFigureCatalog, forkFigureDirection, forkFigureCarry, resolveFigureSizing, forkFigureRatio, forkFigureSceneUpdate, forkFigureSceneFrame, forkFigureCharacter, forkNormalizeFigure, forkMeasureFigureAlpha, forkFigureMixedWarning, forkFigureSlot } from "../tavern-plugin/packages/dsh-presentation-protocol/src/fork-figure-scale.cjs"

import {normalizeLive2dManifest} from '../tavern-plugin/lib/domain/live2d-library.js'

import { normalizeBubbleConfig } from '../tavern-plugin/lib/domain/dialogue-bubbles.js'

// private fork: voice and character state remain Tavern-owned.

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`)
const source = 'a'.repeat(64)
const metrics = extra => ({ sourceSha: source, canvas: [1000, 1000], status: 'confirmed', override: { figureTop: 100, visibleBottom: 900, feet: 900, headTop: 100, chin: 220, posture: 'standing', heightBasis: 'standing', crop: 'full', ...extra } })
const input = extra => ({ version: 1, source, metrics: metrics(), canvas: [1000, 1000], heightCm: 160, sceneHMax: 160, W: 1600, H: 900, ...extra })

// private fork: v6 log-gap curve retains the knee-up ruler and below-screen shared ground.
test('scene-relative display: human pairs, reference floor and Kyubey together/alone', () => {
  const pair180 = resolveFigureSizing(input({ heightCm: 140, sceneHMax: 180 })), pair160 = resolveFigureSizing(input({ heightCm: 140, sceneHMax: 160 }))
  assert.ok(pair160.displayPx > pair180.displayPx); assert.ok(pair180.displayCm > pair160.displayCm); assert.ok(pair160.displayCm > 140)
  const lone140 = resolveFigureSizing(input({ heightCm: 140, sceneHMax: 140 }))
  close(lone140.displayPx, 900 * 1.24 * forkFigureRatio(140 / 150)); assert.ok(lone140.displayPx < 900 * 1.24); assert.equal(FORK_FIGURE_DISPLAY.MAX_ZOOM, undefined)
  const paired = resolveFigureSizing(input({ heightCm: 23, sceneHMax: 152 })), alone = resolveFigureSizing(input({ heightCm: 23, sceneHMax: 23 }))
  assert.ok(paired.displayPx > 900 * 1.24 * 0.27); assert.ok(paired.displayPx < 900 * 1.24 * 0.29)
  assert.ok(Math.abs(alone.displayPx - paired.displayPx) < 3); assert.ok(alone.displayPx > 310); close(paired.support.y, 900 * 1.37); close(alone.support.y, 900 * 1.37)
  assert.ok(resolveFigureSizing(input({ heightCm: 118, sceneHMax: 159 })).displayCm > 118)
})
test('relative curve is monotonic, C1 at the anchor; base sizing preserves ordering before REST safety', () => {
  let previous = 0
  for (let r = 0.0005; r <= 7; r += 0.0005) { const value = forkFigureRatio(r); assert.ok(value > previous); if (r <= 1) assert.ok(value <= 1); previous = value }
  close(forkFigureRatio(1), 1); close(forkFigureRatio(0), 0)
  const e = 1e-8; close((forkFigureRatio(1) - forkFigureRatio(1-e))/e, 1.1); close((forkFigureRatio(1+e) - forkFigureRatio(1))/e, 1.1)
  for (const r of [0.001, 0.1, 0.72, 1, 1.1, 1000 / 150]) { assert.ok(Number.isFinite(forkFigureRatio(r))); close(forkFigureRatio(r) * forkFigureRatio(1 / r), 1) }
  for (const sceneHMax of [23, 118, 152, 160, 180, 1000]) {
    let previous = 0
    for (let heightCm = 1; heightCm <= sceneHMax; heightCm += 0.5) {
      const result = resolveFigureSizing(input({ heightCm, sceneHMax })); assert.ok(result.displayPx > previous); previous = result.displayPx; close(result.support.y, 900 * 1.37)
    }
  }
  assert.equal(resolveFigureSizing(input({ heightCm: 23, sceneHMax: 152, occluderTop: 500 })).ownGround, true) // private fork: no hidden face on the shared ground
})
// private fork: perceptual gaps and the newcomer/mascot trade-off are explicit budgets.
test('log gaps decay quickly without flattening humans or inflating mascots', () => {
  const gap = x => -Math.log(forkFigureRatio(Math.exp(-x))), e = 1e-6
  let previousSlope = Infinity
  for (const x of [0.001, 0.01, 0.05, 0.1, 0.3, 1, 2, 5]) {
    const slope = (gap(x + e) - gap(x - e)) / (2 * e)
    assert.ok(slope >= 0.65 - 1e-9 && slope <= previousSlope + 1e-9)
    previousSlope = slope
  }
  const pixels = (h, max) => 924 * 1.24 * forkFigureRatio(h / max)
  assert.ok(pixels(155, 158) - pixels(152, 158) > 18)
  assert.ok(pixels(158, 158) - pixels(155, 158) > 20)
  assert.ok(pixels(152, 170) / pixels(152, 158) > 0.94)
  assert.ok(forkFigureRatio(23 / 155) < 0.28)
  assert.ok(forkFigureRatio(118 / 158) > 0.79 && forkFigureRatio(118 / 158) < 0.81)
  for (const [heightCm, sceneHMax] of [[1, 1000], [1000, 1], [152, 170]]) {
    const args = input({ heightCm, sceneHMax })
    assert.deepEqual(resolveFigureSizing(JSON.parse(JSON.stringify(args))), resolveFigureSizing(args))
  }
})
const catalog = Object.fromEntries([23, 118, 140, 152, 160, 170, 180, 190, 220].map(heightCm => [String(heightCm), { '': [{ heightCm, headRatio: 1, elevationCm: 0 }] }]))
const replay = (start, entries, para = Infinity) => forkFigureDirection(start, entries, catalog, para)
test('prefix replay excludes future entrants and preserves the ruler after exit', () => {
  const entries = [{ at: 1, scene: 'room', cast: ['140'] }, { at: 3, cast: ['180', '140'] }, { at: 4, cast: ['140'] }, { at: 8, scene: 'garden', cast: ['220'] }]
  // private fork: late entrances rescale only at the entrance, independent of known future beats.
  for (const para of [1,2]) assert.equal(replay({},entries,para).hMax,140)
  for (const para of [3,4,7]) assert.equal(replay({},entries,para).hMax,180)
  const start = { cast: ['180', '140'] }, exits = [{ at: 1, cast: ['140'] }]
  assert.equal(replay(start, exits).hMax, 180)
  assert.equal(replay({}, entries, 8).hMax, 220)
})
test('director transition starts a scene even with an unchanged background; cut sizes snap', () => {
  const initial = replay({ cast: ['180', '140'] }, [])
  const next = replay({ cast: ['140'], figureScale: forkFigureCarry(initial) }, [{ at: 1, commands: [{ op: 'trans', value: 'fade' }] }])
  assert.equal(next.hMax, 140); assert.equal(next.scene, initial.scene + 1)
  const frame = forkFigureSceneUpdate(forkFigureSceneUpdate(null, initial, 0), next, 100)
  close(forkFigureSceneFrame(frame, 100).hMax, 140)
  assert.equal(frame.warning, null)
})
test('player-input/turn transition pages cannot reset scale and JSON cross-turn replay is deterministic', () => {
  const first = replay({ cast: ['180', '140'] }, [{ at: 3, cast: ['140'] }])
  const start = JSON.parse(JSON.stringify({ cast: ['140'], figureScale: forkFigureCarry(first) }))
  for (const kind of ['transition', 'player-input', 'line']) {
    const pageOnly = replay(start, [{ at: 1, kind }])
    assert.equal(pageOnly.hMax, 180); assert.equal(pageOnly.scene, first.scene)
  }
  const next = [{ at: 2, cast: ['140', '220'] }, { at: 4, cast: ['140'] }]
  assert.deepEqual(replay(start, next), replay(JSON.parse(JSON.stringify(start)), next))
  assert.equal(replay(start, next, 1).hMax, 180)
  assert.equal(replay(start, next, 2).hMax, 220)
  assert.equal(replay(start, next, 4).hMax, 220)
  assert.equal(replay({ cast: ['140'], figureScale: forkFigureCarry(replay(start, next)) }, []).hMax, 220)
})
test('a later-turn taller entrant rescales only for clipping, during entrance over 1200ms, once', () => {
  const initial = replay({ cast: ['160'] }, [])
  const start = { cast: ['160'], figureScale: forkFigureCarry(initial) }
  const fits = replay(start, [{ at: 2, cast: ['160', '170'] }]) // private fork: knee-up headroom is smaller
  assert.equal(fits.hMax, 160); assert.equal(fits.rescales, 0) // private fork: head top at 0.0525H still fits.
  const entries = [{ at: 2, cast: ['160', '190'] }, { at: 4, cast: ['160'] }, { at: 6, cast: ['160', '190'] }]
  assert.equal(replay(start, entries, 1).hMax, 160)
  const clipped = replay(start, entries, 2)
  assert.equal(clipped.event.warning, 'mid-scene rescale'); assert.equal(clipped.hMax, 190)
  assert.equal(replay(start, entries).rescales, 1)
  let frame = forkFigureSceneUpdate(null, initial, 0)
  frame = forkFigureSceneUpdate(frame, clipped, 100)
  close(forkFigureSceneFrame(frame, 100).hMax, 160)
  close(forkFigureSceneFrame(frame, 700).hMax, 175)
  close(forkFigureSceneFrame(frame, 1300).hMax, 190)
  assert.equal(forkFigureSceneUpdate(frame, clipped, 600), frame)
  close(forkFigureSceneFrame(forkFigureSceneUpdate(frame, clipped, 600, true), 600).hMax, 190)
})
test('head safety includes calibrated head margin and explicit elevation, not speaking/focus/camera', () => {
  const initial = replay({ cast: ['160'] }, [])
  const start = { cast: ['160'], figureScale: forkFigureCarry(initial) }
  const raised = structuredClone(catalog); raised['180'][''][0].elevationCm = 10
  const entries = [{ at: 1, cast: ['160', '180'] }]
  assert.equal(forkFigureDirection(start, entries, raised).hMax, 180)
  const unchanged = replay(start, [{ at: 1, commands: [{ op: 'focus', id: '160', value: 'close' }, { op: 'cam', id: '160', value: 'close' }] }])
  assert.equal(unchanged.hMax, 160)
})
test('catalogue excludes uncalibrated and offstage characters and validates sources/outfits', () => {
  const models = [{ id: 'valid', modelRevision: source, figure: { ...metrics(), sourceSha: undefined, modelRevision: source, version: 1 } }, { id: 'pending' }]
  const characters = [{ alias: 'a', portrait: 'valid', heightCm: 140, outfits: [{ label: 'other', model: 'pending' }] }, { alias: 'legacy', portrait: 'valid' }, { alias: 'pending', portrait: 'pending', heightCm: 500 }, { alias: 'offstage', portrait: 'valid', heightCm: 1000, offstage: true }]
  const value = forkFigureCatalog(characters, models)
  assert.deepEqual(Object.keys(value), ['a']); assert.equal(value.a[''][0].heightCm, 140)
  assert.equal(forkFigureDirection({ cast: ['a', 'legacy', 'pending'] }, [], value).hMax, 140)
  assert.equal(forkFigureDirection({ cast: ['a'], outfits: { a: 'other' } }, [], value).hMax, 150)
  assert.deepEqual(forkFigureCatalog(characters, [{ ...models[0], modelRevision: 'b'.repeat(64) }]), {})
})
test('prefix replay recognizes command-only enters and preserves the ordering invariant after replay', () => {
  const entries = [{ at: 2, commands: [{ op: 'enter', id: '180' }] }, { at: 4, commands: [{ op: 'exit', id: '180' }] }]
  const state = replay({ cast: ['140'] }, entries, 1)
  assert.equal(state.hMax, 140) // private fork: before the entrance
  assert.ok(resolveFigureSizing(input({ heightCm: 140, sceneHMax: state.hMax })).displayPx < resolveFigureSizing(input({ heightCm: 180, sceneHMax: state.hMax })).displayPx)
  assert.equal(FORK_FIGURE_DISPLAY.transitionMs, 1200)
})
test('synthetic Neuro waist/full fixtures preserve head size; pose and crop do not double compensate', () => {
  const full = resolveFigureSizing(input())
  const waist = resolveFigureSizing(input({ metrics: metrics({ visibleBottom: 540, crop: 'waist', visibleFraction: 0.55 }) }))
  close(waist.scale, full.scale); close(waist.restHead.chin - waist.restHead.top, full.restHead.chin - full.restHead.top)
  const seated = resolveFigureSizing(input({ metrics: metrics({ posture: 'seated', poseHeightRatio: 0.5 }) }))
  close(seated.poseSpan, full.poseSpan / 2)
  assert.equal(resolveFigureSizing(input({ metrics: metrics({ posture: 'seated' }) })).reason, 'missing-pose-ratio')
})
test('virtual feet, padding, resolution, width overflow, mirror pivot, film and explicit elevation', () => {
  const base = resolveFigureSizing(input({ elevationCm: 50, stageX: 400 }))
  const padded = resolveFigureSizing(input({ canvas: [2000, 2000], metrics: { ...metrics({ figureTop: 200, visibleBottom: 1800, feet: 1800 }), canvas: [2000, 2000] }, elevationCm: 50 }))
  close(base.poseSpan, padded.poseSpan)
  const virtual = resolveFigureSizing(input({ metrics: metrics({ feet: undefined, visibleBottom: 540, crop: 'waist', visibleFraction: 0.55 }) }))
  close(virtual.feet, 900)
  const narrow = resolveFigureSizing(input({ W: 390, elevationCm: 50, film: true }))
  close(narrow.scale, base.scale); close(narrow.support.y, base.support.y)
  assert.ok(narrow.warnings.includes('width-overflow'))
  const mirrored = resolveFigureSizing(input({ stageX: 400, flip: -1, metrics: metrics({ supportX: 350 }) }))
  close(mirrored.x - 350 * mirrored.scale, 400)
})
test('legacy is opt-in, unknown/stale/pending sources and invalid geometry fail closed', () => {
  assert.deepEqual(resolveFigureSizing(input({ heightCm: undefined })).warnings, [])
  for (const heightCm of [0, -1, NaN, Infinity, '', 1001]) assert.equal(resolveFigureSizing(input({ heightCm })).mode, 'legacy')
  for (const extra of [{ version: 2 }, { source: 'b'.repeat(64) }, { metrics: { ...metrics(), status: 'pending' } }, { canvas: [9, 9] }, { metrics: metrics({ visibleBottom: 100 }) }, { metrics: metrics({ feet: 99 }) }, { metrics: metrics({ visibleFraction: 0.5 }) }, { metrics: metrics({ heightBasis: 'seated' }) }, { metrics: metrics({ posture: 'other' }) }]) assert.equal(resolveFigureSizing(input(extra)).mode, 'legacy')
  assert.deepEqual(forkFigureMixedWarning([resolveFigureSizing(input()), resolveFigureSizing({})]), ['mixed-uncalibrated-scene'])
})
test('artistic scale is retained, explicit reset and >1 propagate; only speaking follows sizing', () => {
  const base = resolveFigureSizing(input())
  for (const assetScale of [0.75, 1, 2]) close(resolveFigureSizing(input({ assetScale })).scale, base.scale * assetScale)
  close(resolveFigureSizing(input({ focus: 1.45, speaking: true })).scale, base.scale * 1.03)
  close(resolveFigureSizing(input({ focus: 1.45, elevationCm: 50 })).support.y, resolveFigureSizing(input({ elevationCm: 50 })).support.y)
  // private fork: retired focus input cannot scale or reposition figures; camera owns close-ups.
  const near = resolveFigureSizing(input({ focus: 1.45 }))
  close(near.restHead.top, base.restHead.top)
  close(near.restHead.chin, base.restHead.chin)
})
test('character fields roundtrip; reject rather than clamp, null clears; no heights inferred', () => {
  const raw = { alias: 'kyubey', heightCm: 23.04, heightBasis: 'seated', heightNote: 'seated reference', placement: { elevationCm: 50 } }
  const normalized = normalizeBubbleConfig({ characters: [raw] }).characters[0]
  assert.deepEqual(forkFigureCharacter(normalized), { heightCm: 23, heightBasis: 'seated', heightNote: 'seated reference', placement: { elevationCm: 50 } })
  assert.deepEqual(forkFigureCharacter({ heightCm: null }), {})
  for (const value of [0, '', '160', Infinity, -1, 1001]) assert.throws(() => forkFigureCharacter({ heightCm: value }))
  assert.throws(() => forkFigureCharacter({ placement: { elevationCm: 501 } }))
  assert.equal(normalizeBubbleConfig({ characters: [{ alias: 'neuro' }] }).characters[0].heightCm, undefined)
})
test('figure slots keep stale overrides, unknown versions survive; source validation cannot borrow a mood', () => {
  const raw = { version: 1, slots: { default: metrics() } }
  const stale = forkNormalizeFigure(raw, { default: 'b'.repeat(64) })
  assert.equal(stale.slots.default.status, 'stale'); assert.deepEqual(stale.slots.default.override, raw.slots.default.override)
  assert.deepEqual(forkNormalizeFigure({ version: 7, future: [1, 2] }, {}), { version: 7, future: [1, 2] })
  assert.equal(forkFigureSlot({ images: { default: 'a', joy: 'b' } }, 'sad'), 'default')
  assert.equal(forkFigureSlot({ images: { default: 'a', joy: 'b' } }, 'joy'), 'joy')
  assert.equal(normalizeLive2dManifest({ version: 2, models: [{ id: 'test', figure: { version: 8, future: true } }] }).models[0].figure.future, true)
})
function pixels(rects, w = 30, h = 30) { const p = new Uint8ClampedArray(w * h * 4); for (const [left, top, width, height] of rects) for (let y = top; y < top + height; y++) for (let x = left; x < left + width; x++) p[(y * w + x) * 4 + 3] = 255; return p }
test('alpha candidates remove noise, record whole ink, detect bottom runs but never infer crop', () => {
  const measured = forkMeasureFigureAlpha(pixels([[10, 5, 10, 20], [1, 1, 1, 1]]), 30, 30)
  assert.equal(measured.figureTop, 5); assert.equal(measured.visibleBottom, 25); assert.equal(measured.inkBounds[0], 1)
  assert.equal(measured.crop, undefined); assert.equal(measured.feet, undefined)
  assert.equal(forkMeasureFigureAlpha(pixels([[10, 5, 10, 25]]), 30, 30).cropSuspected, true)
  assert.equal(forkMeasureFigureAlpha(pixels([]), 30, 30).invalid, true)
  assert.equal(forkMeasureFigureAlpha(pixels([[0, 0, 30, 30]]), 30, 30).invalid, true)
  assert.equal(forkMeasureFigureAlpha(pixels([[3, 3, 1, 1]]), 30, 30).invalid, true)
  const shadow = forkMeasureFigureAlpha(pixels([[10, 2, 7, 15], [0, 25, 30, 3]]), 30, 30)
  assert.ok(shadow.warnings.includes('multiple-components'))
})

test('physical Live2D placement matches pure resolver; legacy layout remains byte-for-byte helper behavior', async () => {
  const ctx = { resolveFigureSizing }, source = await readFile(new URL('../tavern-plugin/src/client/fork-live2d.js', import.meta.url), 'utf8')
  vm.runInNewContext(source.slice(source.indexOf('function forkLive2dPlace('), source.indexOf('// Face window')), ctx)
  const model = { internalModel: { originalWidth: 1000, originalHeight: 1000, settings: { json: {} } }, scale: { set(x, y) { this.x = x; this.y = y } }, position: { set(x, y) { model.x = x; model.y = y } } }
  ctx.forkLive2dPlace(model, 1600, 900, 0.5, false, false, 1, 1)
  close(model.scale.y, 0.576); close(model.y, 360)
  const resolved = ctx.forkLive2dPlace(model, 1600, 900, 0.5, false, false, 1, -1, input())
  close(model.scale.x, -resolveFigureSizing(input()).scale); close(model.y, resolved.y)
})

test('each clipping entrance rescales from the recorded prefix only', () => {
  const first = replay({ cast: ['160'] }, [])
  const start = { cast: ['160'], figureScale: forkFigureCarry(first) }
  const entries = [{ at: 2, cast: ['160', '190'] }, { at: 4, cast: ['220'] }]
  assert.equal(replay(start, entries, 1).hMax, 160)
  assert.equal(replay(start, entries, 2).hMax, 190) // private fork: future 220cm entrant is not visible
  assert.equal(replay(start, entries, 4).rescales, 2) // private fork: second clipping entrance
})

test('scene-cut scale swap is concealed by the existing transition, with no size tween', async () => {
  const source = await readFile(new URL('../tavern-plugin/src/client/fork-gal-scene.js', import.meta.url), 'utf8')
  const context = { forkGalClamp01: x => Math.max(0, Math.min(1, x)), forkGalEase: { inOutSine: x => (1 - Math.cos(Math.PI * x)) / 2, inOutCubic: x => x } }
  vm.runInNewContext(source.slice(source.indexOf('const FORK_GAL_TRANSITIONS'), source.indexOf('// Wipe mask:')), context)
  for (const kind of ['fade', 'wipe', 'iris']) {
    const plan = context.forkGalTransitionPlan(kind)
    assert.equal(context.forkGalFigureCutFrame(plan, 0.49).swap, false)
    assert.equal(context.forkGalFigureCutFrame(plan, 0.5).swap, true)
    assert.equal(context.forkGalFigureCutFrame(plan, 0.5).alpha, 0)
    assert.equal(context.forkGalFigureCutFrame(plan, 1).alpha, 1)
  }
  for (const kind of ['black', 'white']) {
    const plan = context.forkGalTransitionPlan(kind), midpoint = kind === 'black' ? 0.42 : 0.36
    assert.equal(context.forkGalFigureCutFrame(plan, midpoint - 0.001).swap, false)
    assert.equal(context.forkGalFigureCutFrame(plan, midpoint).swap, true)
    assert.equal(context.forkGalTransitionFrame(plan, midpoint).cover, 1)
  }
})

test('opaque native portrait leases retain physical calibration using explicit source hashes', () => {
  const character = {alias:'alice', portrait:'portrait', heightCm:160}
  const figure = {version:1, slots:{default:metrics()}}
  const old = {id:'portrait', kind:'static', images:{default:'/old/' + source + '.webp'}, figure}
  const native = {...old, images:{default:'/api/dsh-asset-library/v1/media?ticket=opaque'}, imageSources:{default:source}}
  assert.deepEqual(forkFigureCatalog([character], [native]), forkFigureCatalog([character], [old]))
  assert.ok(forkFigureCatalog([character], [native]).alice)
  assert.deepEqual(forkFigureCatalog([character], [{...native, imageSources:{default:'b'.repeat(64)}}]), {})
})
