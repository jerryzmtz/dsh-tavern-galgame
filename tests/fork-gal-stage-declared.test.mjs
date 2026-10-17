import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { EventEmitter } from 'node:events'
import vm from 'node:vm'

// Gesture fades follow what a Live2D model declares (fork-gal-motion.js): the motion3 Meta, then the model3 motion entry,
// then the stage default. Vendored Cubism4 runtime, a small fixture table, no Core, model or WebGL.
const source = await readFile(new URL('../tavern-plugin/src/client/fork-gal-scene.js', import.meta.url), 'utf8')
const layers = await readFile(new URL('../tavern-plugin/src/client/fork-gal-motion.js', import.meta.url), 'utf8')
const vendor = await readFile(new URL('../tavern-plugin/lib/vendor/runtime-assets/live2d/pixi-live2d-display-cubism4.min.js', import.meta.url), 'utf8')
const ctx = { console, performance: { now: () => 0 }, window: { Live2DCubismCore: {} },
  PIXI: { utils: { EventEmitter }, Point: class {}, Matrix: class {}, Container: class {}, Transform: class {} } }
vm.runInNewContext(vendor, ctx)
vm.runInNewContext(layers + source.slice(source.indexOf('// ---------- Scene helpers'), source.indexOf('// ---------- Scene runtime')), ctx)
const runtime = ctx.PIXI.live2d
runtime.config.sound = false

// motion3 JSON: curves [{ Target, Id, keys: [[time, value], ...] }] as linear segments; meta merges into Meta.
function motion3(curves, meta = {}, duration = 3) {
  const Curves = curves.map(({ Target = 'Parameter', Id, keys }) => ({ Target, Id, Segments: [keys[0][0], keys[0][1], ...keys.slice(1).flatMap(([t, v]) => [0, t, v])] }))
  return { Meta: { Duration: duration, Fps: 30, Loop: false, CurveCount: Curves.length, TotalSegmentCount: curves.reduce((n, c) => n + c.keys.length - 1, 0),
    TotalPointCount: curves.reduce((n, c) => n + c.keys.length, 0), UserDataCount: 0, TotalUserDataSize: 0, ...meta }, Curves }
}

// parameters: [id, min, max]; motions: { group: [{ json, entry }] } loaded through the runtime's createMotion.
function figure({ parameters, motions }) {
  const n = parameters.length
  const core = new runtime.CubismModel({
    parameters: { count: n, ids: parameters.map(p => p[0]), values: new Float32Array(n), minimumValues: new Float32Array(parameters.map(p => p[1])),
      maximumValues: new Float32Array(parameters.map(p => p[2])), defaultValues: new Float32Array(n) },
    parts: { count: 0, ids: [], opacities: new Float32Array(0) }, drawables: { count: 0, ids: [] }
  })
  const settings = { name: 'declared-fixture', motions: Object.fromEntries(Object.entries(motions).map(([g, list]) => [g, list.map(m => m.entry || {})])),
    getEyeBlinkParameters: () => [], getLipSyncParameters: () => [] }
  const manager = new runtime.Cubism4MotionManager(settings, { motionPreload: 'NONE', idleMotionGroup: 'Idle' })
  manager._loadMotion = async (group, index) => manager.createMotion(motions[group][index].json, group, settings.motions[group][index])
  const internal = Object.assign(new EventEmitter(), { motionManager: manager, coreModel: core, settings })
  ctx.forkGalMotionTransitions(internal)
  let frame = 0
  const step = () => {
    const time = frame++ / 60
    internal.emit('beforeMotionUpdate'); manager.update(core, time); internal.emit('afterMotionUpdate')
    return { time, motion: Object.fromEntries(parameters.map(([id]) => [id, core.getParameterValueById(id)])), gesture: manager.forkMotionLayers.gesture }
  }
  return { manager, core, step }
}

test('gesture fades: motion3 Meta first, then the model3 entry, the stage 0.40 / 0.50 s only when neither declares', async () => {
  // ParamBrowLY is neither sprung nor discrete, so its value is exactly 20 x the gesture weight over an idle at 0.
  const brow = value => motion3([{ Id: 'ParamBrowLY', keys: [[0, value], [3, value]] }])
  const cases = [
    { name: 'motion3', json: { ...brow(20), Meta: { ...brow(20).Meta, FadeInTime: 1.2, FadeOutTime: 0.3 } }, entry: { FadeInTime: 0.8, FadeOutTime: 0.6 }, fades: [1.2, 0.3] },
    { name: 'model3 entry', json: brow(20), entry: { FadeInTime: 0.8, FadeOutTime: 0.6 }, fades: [0.8, 0.6] },
    { name: 'stage default', json: brow(20), entry: {}, fades: [0.4, 0.5] },
  ]
  for (const { name, json, entry, fades: [fadeIn, fadeOut] } of cases) {
    const { manager, step } = figure({ parameters: [['ParamBrowLY', -30, 30]], motions: { Idle: [{ json: { ...brow(0), Meta: { ...brow(0).Meta, Loop: true } } }], Mood_joy: [{ json, entry }] } })
    await manager.startMotion('Idle', 0, 1)
    for (let i = 0; i < 30; i++) step()
    assert.equal(await manager.startMotion('Mood_joy', 0, 2), true)
    const frames = []
    for (let i = 0; i < 200; i++) frames.push(step())
    const start = frames[0].time, at = t => frames[Math.round((t - start) * 60)].motion.ParamBrowLY
    assert.ok(Math.abs(at(start + fadeIn / 2) - 10) < 1e-3, `${name}: half-way through a ${fadeIn} s fade-in (${at(start + fadeIn / 2)})`)
    assert.ok(Math.abs(at(start + fadeIn) - 20) < 1e-3, `${name}: full weight once the fade-in ends`)
    assert.ok(Math.abs(at(start + 3 - fadeOut / 2) - 10) < 1e-3, `${name}: half-way through a ${fadeOut} s fade-out (${at(start + 3 - fadeOut / 2)})`)
    assert.ok(Math.abs(at(start + 3 - fadeOut) - 20) < 1e-3, `${name}: the fade-out starts ${fadeOut} s before the end`)
    assert.equal(frames.at(-1).gesture, null, `${name}: gesture finished`)
  }
})
