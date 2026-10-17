import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { EventEmitter } from 'node:events'
import vm from 'node:vm'

// Arm switches vs arm angles in the stage's gesture layer (fork-gal-motion.js). Our PSD2Live rigs select arm poses
// with ParamArmPoseSwitch; game rigs (Magia Record) key continuous angles as ParamArm[LR][ABC]0n and select the arm
// set through pose3 parts. Small fixture parameter tables, the vendored Cubism4 runtime, no Core, model or WebGL.
const source = await readFile(new URL('../tavern-plugin/src/client/fork-gal-scene.js', import.meta.url), 'utf8')
const layers = await readFile(new URL('../tavern-plugin/src/client/fork-gal-motion.js', import.meta.url), 'utf8')
const vendor = await readFile(new URL('../tavern-plugin/lib/vendor/runtime-assets/live2d/pixi-live2d-display-cubism4.min.js', import.meta.url), 'utf8')
const ctx = { console, performance: { now: () => 0 }, window: { Live2DCubismCore: {} },
  PIXI: { utils: { EventEmitter }, Point: class {}, Matrix: class {}, Container: class {}, Transform: class {} } }
vm.runInNewContext(vendor, ctx)
vm.runInNewContext(layers + source.slice(source.indexOf('// ---------- Scene helpers'), source.indexOf('// ---------- Scene runtime')), ctx)
const runtime = ctx.PIXI.live2d
runtime.config.sound = false

// [id, min, max, default, idle value, gesture value]
const SWITCHES = [['ParamArmPoseSwitch', 0, 10, 0, 0, 2], ['ParamHandLA00Display', 0, 1, 1, 1, 0], ['ParamHandLA01Display', 0, 1, 0, 0, 1]]
const ANGLES = [['ParamArmLA02', -10, 10, 0, 3, -7], ['ParamArmRB03', -10, 10, 0, 0, 8], ['ParamArmLC01', -10, 10, 0, 0, 6], ['ParamArmR', -60, 60, 0, 0, 30]]
const PARAMETERS = [...SWITCHES, ...ANGLES]

function clip(column, duration = 3) {
  const curves = PARAMETERS.map(row => ({ Target: 'Parameter', Id: row[0], Segments: [0, row[column], 0, duration, row[column]] }))
  return runtime.CubismMotion.create({ Meta: { Duration: duration, Fps: 30, Loop: true, CurveCount: curves.length,
    TotalSegmentCount: curves.length, TotalPointCount: curves.length * 2, FadeInTime: 1, FadeOutTime: 1, UserDataCount: 0, TotalUserDataSize: 0 }, Curves: curves })
}

function setup() {
  const n = PARAMETERS.length
  const model = {
    parameters: { count: n, ids: PARAMETERS.map(row => row[0]), values: new Float32Array(PARAMETERS.map(row => row[3])),
      minimumValues: new Float32Array(PARAMETERS.map(row => row[1])), maximumValues: new Float32Array(PARAMETERS.map(row => row[2])),
      defaultValues: new Float32Array(PARAMETERS.map(row => row[3])) },
    parts: { count: 0, ids: [], opacities: new Float32Array(0) }, drawables: { count: 0, ids: [] }
  }
  const core = new runtime.CubismModel(model)
  const settings = { name: 'arm-fixture', motions: { Idle: [{}], Mood_joy: [{}] }, getEyeBlinkParameters: () => [], getLipSyncParameters: () => [] }
  const manager = new runtime.Cubism4MotionManager(settings, { motionPreload: 'NONE', idleMotionGroup: 'Idle' })
  const motions = { Idle: clip(4), Mood_joy: clip(5) }
  manager._loadMotion = async group => motions[group]
  const internal = Object.assign(new EventEmitter(), { motionManager: manager, coreModel: core, settings })
  ctx.forkGalMotionTransitions(internal)
  let frame = 0
  const step = () => {
    internal.emit('beforeMotionUpdate'); manager.update(core, frame++ / 60); internal.emit('afterMotionUpdate')
    return Object.fromEntries(PARAMETERS.map(row => [row[0], core.getParameterValueById(row[0])]))
  }
  return { manager, step }
}

test('classification: declared switches stay discrete, numbered arm-set angles are continuous', () => {
  for (const [id] of SWITCHES) {
    assert.equal(ctx.forkGalMotionDiscrete(id), true, id)
    assert.equal(ctx.forkGalMotionParameter(id), null, id)
  }
  for (const id of ['ParamArmLA01', 'ParamArmLA02', 'ParamArmRB03', 'ParamArmLC01', 'ParamArmRC02', 'ParamArmLB', 'ParamArmRA', 'ParamArmR', 'ParamForearmL']) {
    assert.equal(ctx.forkGalMotionDiscrete(id), false, id)
  }
  for (const id of ['ParamArmLA02', 'ParamArmRB03', 'ParamArmLC01', 'ParamArmR']) assert.equal(ctx.forkGalMotionParameter(id).omega, 12, id)
  // pose3 parts and PartOpacity tracks are switches by declaration, whatever their name
  assert.equal(ctx.forkGalMotionDiscrete('Part01ArmLA00', new Set(['Part01ArmLA00'])), true)
})

test('gesture fade: switches change once at the dominance point, Magia arm angles blend through every frame', async () => {
  const { manager, step } = setup()
  await manager.startMotion('Idle', 0, 1)
  for (let i = 0; i < 60; i++) step()
  const layer = manager.forkMotionLayers
  for (const [id] of ANGLES) assert.equal(layer.visibility.has(id), false, `${id} is not a visibility channel`)
  await manager.startMotion('Mood_joy', 0, 2)
  const frames = []
  for (let i = 0; i < 260; i++) frames.push(step())
  assert.equal(layer.gesture, null, 'gesture finished')

  for (const [id, , , , idle, gesture] of SWITCHES) {
    const values = frames.map(f => f[id])
    assert.ok(values.every(v => v === idle || v === gesture), `${id} only takes authored values`)
    const changes = values.filter((v, i) => i > 0 && v !== values[i - 1]).length
    assert.equal(changes, 2, `${id} switches in once and out once`)
  }
  for (const [id, , , , idle, gesture] of ANGLES) {
    const values = frames.map(f => f[id]), span = Math.abs(gesture - idle)
    const between = values.filter(v => Math.abs(v - idle) > span * 0.02 && Math.abs(v - gesture) > span * 0.02).length
    const steps = values.slice(1).map((v, i) => Math.abs(v - values[i]))
    assert.ok(Math.max(...steps) < span * 0.1, `${id} has no jump (max step ${Math.max(...steps)} of ${span})`)
    assert.ok(between >= 30, `${id} passes through intermediate values during fade in and out (${between} frames)`)
    const peak = values.reduce((best, v) => Math.abs(v - idle) > Math.abs(best - idle) ? v : best, idle)
    assert.ok(Math.abs(peak - gesture) < span * 0.02, `${id} reaches the authored gesture value`)
    assert.ok(Math.abs(values.at(-1) - idle) < span * 0.02, `${id} returns to idle`)
  }
})
