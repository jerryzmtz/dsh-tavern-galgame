import {stagePageSource} from './helpers/stage-page-source.mjs' // private fork
// private fork: order-only insertion, replay compatibility, spacing and reflow.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { createStageTransaction, initialStageState, replayStage, stageDigest } from "../tavern-plugin/lib/domain/stage-incremental.js"
import { projectIncrementalStageEffect } from "../tavern-plugin/lib/domain/stage-incremental-projection.js"

const read = name => readFile(new URL('../tavern-plugin/' + name, import.meta.url), 'utf8')
const source = await read('src/client/fork-gal-stage.js')
const scene = await read('src/client/fork-gal-scene.js'), effects = await read('src/client/fork-gal-effects.js')
const live = await read('src/client/fork-live2d.js')
const ctx = {}
vm.runInNewContext(await read('packages/dsh-presentation-protocol/src/fork-stage-light.cjs')
  + await read('packages/dsh-presentation-protocol/src/fork-stage-pacing.cjs')
  + await read('packages/dsh-presentation-protocol/src/fork-figure-scale.cjs')
  + live.slice(live.indexOf('function forkLive2dSlots'), live.indexOf('\n', live.indexOf('function forkLive2dSlots')))
  + scene.slice(scene.indexOf('// ---------- Scene helpers'), scene.indexOf('// ---------- Scene runtime'))
  + effects.slice(effects.indexOf('// ---------- Effect helpers'), effects.indexOf('// ---------- Effect runtime'))
  + (stagePageSource + '\n' + source.slice(source.indexOf('// Plain reading text'), source.indexOf('// The stage is a full-screen mode'))), ctx)
const plain = value => JSON.parse(JSON.stringify(value))
const slots = (order, positions, stageable) => plain(ctx.forkGalSlotMap(order, stageable, positions))
const coordinates = stage => Object.fromEntries(stage.members.filter(m => m.visible && m.x !== undefined).map(m => [m.id, m.x]))
const unique = map => {
  assert.ok(Object.values(map).every(x => Number.isFinite(x) && x > 0 && x < 1))
  assert.equal(new Set(Object.values(map)).size, Object.keys(map).length)
}

test('slots depend only on figure count and order, including small figures', () => {
  for (let count = 1; count <= 12; count++) {
    const order = Array.from({ length: count }, (_, i) => i === 0 ? 'kyubey' : 'actor' + i)
    const map = slots(order, Object.fromEntries(order.map(id => [id, 'center'])))
    unique(map)
    const values = Object.values(map)
    assert.deepEqual(map, slots(order))
    if (count === 1) assert.deepEqual(values, [0.5])
    for (let i = 1; i < count; i++) assert.ok(values[i] > values[i - 1])
    for (let i = 2; i < count; i++) assert.ok(Math.abs(values[i] - values[i - 1] - (values[1] - values[0])) < 1e-10)
    assert.ok(Object.hasOwn(map, 'kyubey'), 'small figures occupy a complete slot')
  }
  assert.deepEqual(slots(['avatar', 'kyubey', 'a'], {}, id => id !== 'avatar'), { kyubey: 0.33, a: 0.67 })
})

test('historical explicit positions cannot override or duplicate slots', () => {
  const values = ['auto', 'far-left', 'left', 'center', 'right', 'far-right', undefined, 'unknown']
  for (const a of values) for (const b of values) for (const c of values) {
    assert.deepEqual(slots(['a', 'b', 'c'], { a, b, c }), { a: 0.2, b: 0.5, c: 0.8 })
  }
})

const catalog = { actors: Object.fromEntries(['sayaka', 'homura_megane', 'madoka'].map(id => [id, { defaultVariant: 'uniform', variants: ['uniform'] }])), scene: ['school', 'street-night'] }
function effect(baseline, beats, units = 109) {
  const tx = createStageTransaction({ baseline, catalog, target: { sourceKey: 'slot-regression' }, units })
  const accepted = tx.submit({ sequence: 1, through: units, done: true, beats })
  assert.equal(accepted.ok, true, JSON.stringify(accepted))
  return tx.effect()
}
function baseline() {
  const state = initialStageState(catalog)
  state.scene = 'school'; state.cast = ['sayaka', 'homura_megane', 'madoka']
  for (const [id, position] of Object.entries({ sayaka: 'left', homura_megane: 'center', madoka: 'right' })) state.actors[id].position = position
  return state
}

test('replay: old position/focus patches remain digest-valid but render normal, never cross', () => {
  const start = baseline(), end = structuredClone(start)
  end.actors.sayaka.position = 'far-right'; end.actors.sayaka.focus = 'far'
  end.actors.madoka.position = 'far-left'; end.actors.madoka.focus = 'near'
  end.cast = ['madoka', 'homura_megane', 'sayaka']
  const ops = [{ op: 'actor.patch', actor: 'sayaka', value: { position: 'far-right', focus: 'far' } }, { op: 'actor.patch', actor: 'madoka', value: { position: 'far-left', focus: 'near' } }, { op: 'stage.patch', value: { cast: end.cast } }]
  const canonical = { version: 1, start, end, catalogSnapshot: catalog, catalogDigest: stageDigest(catalog), baselineDigest: stageDigest(start), semanticDependencies: ops, dependencyDigest: stageDigest(ops), through: 2, units: 2, complete: true, entries: [{ at: 2, ops }] }
  const snapshot = JSON.stringify(canonical), record = projectIncrementalStageEffect(canonical)
  assert.deepEqual(replayStage(canonical), end, 'immutable receipt hashes are preserved')
  for (const para of [1, 2, 1, 2]) {
    const stage = ctx.forkGalStaging(record, para)
    assert.deepEqual(coordinates(stage), { sayaka: 0.2, homura_megane: 0.5, madoka: 0.8 })
    assert.ok(stage.members.every(m => m.focus === 'normal'))
  }
  assert.equal(JSON.stringify(canonical), snapshot)
  const legacy = { status: 'done', start: { cast: ['sayaka', 'madoka'], order: ['sayaka', 'madoka'], focus: { sayaka: 'near' } }, entries: [{ at: 1, cast: ['madoka', 'sayaka'], commands: [{ op: 'pos', id: 'sayaka', value: 'far-right' }, { op: 'pos', id: 'madoka', value: 'far-left' }, { op: 'focus', id: 'madoka', value: 'far' }] }] }
  assert.deepEqual(coordinates(ctx.forkGalStaging(legacy, 1)), { sayaka: 0.33, madoka: 0.67 })
  assert.ok(ctx.forkGalStaging(legacy, 1).members.every(m => m.focus === 'normal'))
})

test('scene reflow eases, uses equal scale, and never sweeps arrivals/exits across actors', () => {
  const a = {}, b = {}
  ctx.forkGalFigureInit(a, { x: 0.33, enter: 'none', speaking: true })
  ctx.forkGalFigureInit(b, { x: 0.67, enter: 'left' })
  assert.ok(!('cf' in a) && !('cf' in b), 'private fork: neither speech nor close-up adds a sprite-scale spring')
  assert.equal(b.cx.v, 0.67, 'an old left entrance cannot cross the existing actor')
  for (let i = 0; i < 120; i++) {
    ctx.forkGalFigureStep(a, { x: 0.2, visible: true }, i * 16, 1 / 60)
    ctx.forkGalFigureStep(b, { x: 0.5, visible: true }, i * 16, 1 / 60)
    assert.ok(a.cx.v < b.cx.v)
  }
  const x = a.cx.v
  for (let i = 0; i < 120; i++) ctx.forkGalFigureStep(a, { x: 0.2, visible: false, exit: 'right' }, i * 16, 1 / 60)
  assert.equal(a.cx.v, x); assert.ok(a.alpha.v < 0.01)
})

// private fork: exercise submission -> saved projection -> actual host/client fold, not just slot math.
