import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { EventEmitter } from 'node:events'
import vm from 'node:vm'

const source = await readFile(new URL('../tavern-plugin/src/client/fork-gal-scene.js', import.meta.url), 'utf8')
const layers = await readFile(new URL('../tavern-plugin/src/client/fork-gal-motion.js', import.meta.url), 'utf8')
const vendor = await readFile(new URL('../tavern-plugin/lib/vendor/runtime-assets/live2d/pixi-live2d-display-cubism4.min.js', import.meta.url), 'utf8')
const ctx = { console, performance: { now: () => 0 }, window: { Live2DCubismCore: {} },
  PIXI: { utils: { EventEmitter }, Point: class {}, Matrix: class {}, Container: class {}, Transform: class {} } }
vm.runInNewContext(vendor, ctx)
vm.runInNewContext(layers + source.slice(source.indexOf('// ---------- Scene helpers'), source.indexOf('// ---------- Scene runtime')), ctx)
const runtime = ctx.PIXI.live2d
runtime.config.sound = false

function clip(value, end = value) {
  return runtime.CubismMotion.create({
    Meta: { Duration: 3, Fps: 30, Loop: true, CurveCount: 1, TotalSegmentCount: 1, TotalPointCount: 2,
      FadeInTime: 0, FadeOutTime: 0, UserDataCount: 0, TotalUserDataSize: 0 },
    Curves: [{ Target: 'Parameter', Id: 'ParamAngleX', FadeInTime: 0, FadeOutTime: 0, Segments: [0, value, 0, 3, end] }],
  })
}
function setup() {
  const settings = { name: 'test', motions: { Idle: [{}], Mood_joy: [{}], Mood_sad: [{}], Shake: [{}] },
    getEyeBlinkParameters: () => [], getLipSyncParameters: () => [] }
  const manager = new runtime.Cubism4MotionManager(settings, { motionPreload: 'NONE', idleMotionGroup: 'Idle' })
  const motions = { Idle: clip(-4, 4), Mood_joy: clip(30), Mood_sad: clip(-30), Shake: clip(20) }
  manager._loadMotion = async group => motions[group]
  const parameters = { ids: ['ParamAngleX'], values: new Float32Array(1) }
  const core = { getModel: () => ({ parameters }), getParameterIndex: () => 0, getParameterValueByIndex: i => parameters.values[i],
    setParameterValueByIndex(i, value, weight = 1) { parameters.values[i] += (value - parameters.values[i]) * weight } }
  const internal = Object.assign(new EventEmitter(), { motionManager: manager, coreModel: core, settings })
  ctx.forkGalMotionTransitions(internal)
  let frame = 0
  const step = () => { internal.emit('beforeMotionUpdate'); manager.update(core, frame++ / 60); internal.emit('afterMotionUpdate'); return parameters.values[0] }
  return { manager, motions, core, internal, step }
}

test('gesture smoothstep envelope is zero at ends, full in middle, continuous for short clips', () => {
  const weight = ctx.forkGalGestureWeight
  assert.equal(weight(-1, 3), 0); assert.equal(weight(0, 3), 0)
  assert.equal(weight(0.2, 3), 0.5); assert.equal(weight(0.4, 3), 1)
  assert.equal(weight(2.5, 3), 1); assert.equal(weight(2.75, 3), 0.5)
  assert.equal(weight(3, 3), 0); assert.equal(weight(5, 3), 0)
  assert.ok(weight(0.1, 0.2) > 0 && weight(0.1, 0.2) < 1)
  assert.ok(weight(0.0001, 3) < 1e-6)
})

test('classification excludes face, expression and mouth controls; includes all head/body axes and arm prefixes', () => {
  for (const id of ['ParamMouthOpenY', 'ParamMouthForm', 'ParamEyeLOpen', 'ParamEyeROpen', 'ParamEyeLSmile', 'ParamBrowLY', 'ParamCheek', 'ParamHairFront']) assert.equal(ctx.forkGalMotionParameter(id), null)
  for (const id of ['ParamAngleX', 'ParamAngleY', 'ParamAngleZ']) assert.equal(ctx.forkGalMotionParameter(id).velocity, 180)
  for (const id of ['ParamBodyAngleX', 'ParamBodyAngleY', 'ParamBodyAngleZ']) assert.equal(ctx.forkGalMotionParameter(id).velocity, 90)
  for (const id of ['ParamArmLift', 'ParamHandR', 'ParamShoulderL']) assert.equal(ctx.forkGalMotionParameter(id).omega, 12)
  assert.equal(ctx.forkGalMotionParameter('ParamEyeBallX').omega, 20)
  for (const id of ['ParamArmPoseSwitch', 'ParamHandLBDisplay', 'ParamHandLA00Display']) {
    assert.equal(ctx.forkGalMotionParameter(id), null)
    assert.equal(ctx.forkGalMotionDiscrete(id), true)
  }
  assert.equal(ctx.forkGalMotionDiscrete('CustomSelector', new Set(['CustomSelector'])), true)
})

test('exact spring converges, preserves velocity on interruption, and clamps displacement AND velocity', () => {
  const spring = ctx.forkGalMotionSpring, state = { v: 0, d: 0 }
  for (let i = 0; i < 300; i++) {
    const previous = state.v
    spring(state, 1000, 14, 90, 1 / 60)
    assert.ok(Math.abs(state.v - previous) <= 1.500001)
    assert.ok(Math.abs(state.d) <= 90)
  }
  const before = state.v
  spring(state, -1000, 14, 90, 1 / 60)
  assert.ok(Math.abs(state.v - before) <= 1.500001)
  const rest = { v: 0, d: 0 }
  for (let i = 0; i < 300; i++) spring(rest, 1, 14, 180, 1 / 60)
  assert.equal(rest.v, 1); assert.equal(rest.d, 0)
  assert.equal(spring(rest, 0, 14, 180, 0), 1)
})

test('vendored runtime: gestures never remove or restart idle; loop overlap has no empty queue frame', async () => {
  const { manager, motions, step, internal } = setup()
  const install = manager.startMotion
  ctx.forkGalMotionTransitions(internal)
  assert.equal(manager.startMotion, install)
  await manager.startMotion('Idle', 0, 1)
  for (let i = 0; i < 60; i++) step()
  const idle = manager.queueManager._motions[0]
  await manager.startMotion('Mood_joy', 0, 2)
  assert.equal(manager.queueManager._motions[0], idle)
  assert.equal(idle.isTriggeredFadeOut(), false)
  assert.equal(manager.state.currentGroup, 'Idle')
  let overlapping = false
  for (let i = 0; i < 600; i++) {
    step()
    assert.ok(manager.queueManager._motions.length > 0, `empty idle queue at ${i}`)
    overlapping ||= manager.queueManager._motions.length > 1
  }
  assert.ok(overlapping)
  assert.equal(manager.forkMotionLayers.gesture, null)
  assert.equal(motions.Idle.getFadeInTime(), 0, 'loaded cache remains unchanged')
  assert.equal(motions.Mood_joy.getParameterFadeInTime('ParamAngleX'), 0)
})

test('mood interruption crossfades; FORCE owns gesture priority only; explicit stop and destroy clean both tracks', async () => {
  const { manager, step, internal } = setup()
  await manager.startMotion('Idle', 0, 1)
  for (let i = 0; i < 60; i++) step()
  await manager.startMotion('Mood_joy', 0, 2)
  let previous
  for (let i = 0; i < 60; i++) previous = step()
  assert.equal(await manager.startMotion('Mood_sad', 0, 2), true)
  let max = 0
  for (let i = 0; i < 60; i++) { const value = step(); max = Math.max(max, Math.abs(value - previous)); previous = value }
  assert.ok(max <= 3.00001, `head velocity clamp (Float32): ${max}`)
  assert.equal(await manager.startMotion('Shake', 0, 3), true)
  assert.equal(await manager.startMotion('Mood_joy', 0, 2), false)
  assert.equal(manager.state.currentGroup, 'Idle')
  manager.stopAllMotions()
  assert.equal(manager.queueManager._motions.length, 0)
  assert.equal(manager.forkMotionLayers.queue._motions.length, 0)
  assert.equal(manager.forkMotionLayers.springs.size, 0)
  internal.emit('destroy')
  assert.equal(await manager.startMotion('Mood_joy', 0, 2), false)
})

test('late asynchronous loads cannot resurrect a replaced or destroyed gesture', async () => {
  const { manager, internal } = setup()
  let resolve
  manager.loadMotion = () => new Promise(r => { resolve = r })
  const pending = manager.startMotion('Mood_joy', 0, 2)
  internal.emit('destroy')
  resolve(clip(30))
  assert.equal(await pending, false)
})

test('gesture output never feeds back into the underlying idle phase or parameters', async () => {
  const layered = setup(), idleOnly = setup()
  await layered.manager.startMotion('Idle', 0, 1)
  await idleOnly.manager.startMotion('Idle', 0, 1)
  for (let i = 0; i < 60; i++) { layered.step(); idleOnly.step() }
  await layered.manager.startMotion('Mood_joy', 0, 2)
  for (let i = 0; i < 300; i++) {
    layered.step(); idleOnly.step()
    assert.equal(layered.manager.forkMotionLayers.base[0], idleOnly.manager.forkMotionLayers.base[0])
  }
})

test('active expression ownership excludes even normally smoothed angle parameters', async () => {
  const { manager, step } = setup()
  await manager.startMotion('Idle', 0, 1)
  for (let i = 0; i < 60; i++) step()
  manager.expressionManager = { queueManager: { _motions: [{ _motion: { _parameters: [{ parameterId: 'ParamAngleX' }] } }] } }
  await manager.startMotion('Mood_joy', 0, 2)
  for (let i = 0; i < 45; i++) step()
  assert.equal(manager.forkMotionLayers.springs.size, 0)
  assert.equal(manager.forkMotionLayers.output[0], 30)
})

test('a pending FORCE blocks NORMAL and explicit stop invalidates pending loads', async () => {
  const { manager } = setup()
  let resolve
  manager.loadMotion = () => new Promise(r => { resolve = r })
  const force = manager.startMotion('Shake', 0, 3)
  assert.equal(await manager.startMotion('Mood_joy', 0, 2), false)
  manager.stopAllMotions()
  resolve(clip(30))
  assert.equal(await force, false)
  assert.equal(manager.forkMotionLayers.gesture, null)
})

test('vendored Pose: virtual PartOpacity selectors and real arm switches select one track, never cross-dissolve', async () => {
  const model = {
    parameters: { count: 3, ids: ['ParamAngleX', 'ParamArmPoseSwitch', 'ParamHandLBDisplay'], values: new Float32Array(3),
      minimumValues: new Float32Array([-30, 0, 0]), maximumValues: new Float32Array([30, 10, 1]), defaultValues: new Float32Array(3) },
    parts: { count: 4, ids: ['PartArmA', 'PartArmB', 'PartArmALink', 'PartArmBLink'], opacities: new Float32Array([1, 0, 1, 0]) },
    drawables: { count: 0, ids: [] }
  }
  const core = new runtime.CubismModel(model)
  const pose = runtime.CubismPose.create({ FadeInTime: 0.2, Groups: [[{ Id: 'PartArmA', Link: ['PartArmALink'] }, { Id: 'PartArmB', Link: ['PartArmBLink'] }]] })
  const make = active => {
    const curves = [
      { Target: 'Parameter', Id: 'ParamAngleX', Segments: [0, active * 30, 0, 3, active * 30] },
      { Target: 'Parameter', Id: 'ParamArmPoseSwitch', Segments: [0, active * 3, 0, 3, active * 3] },
      { Target: 'Parameter', Id: 'ParamHandLBDisplay', Segments: [0, active, 0, 3, active] },
      { Target: 'PartOpacity', Id: 'PartArmA', Segments: [0, 1 - active, 0, 3, 1 - active] },
      { Target: 'PartOpacity', Id: 'PartArmB', Segments: [0, active, 0, 3, active] },
    ]
    return runtime.CubismMotion.create({ Meta: { Duration: 3, Fps: 30, Loop: false, CurveCount: curves.length,
      TotalSegmentCount: curves.length, TotalPointCount: curves.length * 2, FadeInTime: 1, FadeOutTime: 1, UserDataCount: 0, TotalUserDataSize: 0 }, Curves: curves })
  }
  const settings = { name: 'pose-test', motions: { Idle: [{}], Mood_joy: [{}], Mood_sad: [{}] }, getEyeBlinkParameters: () => [], getLipSyncParameters: () => [] }
  const manager = new runtime.Cubism4MotionManager(settings, { motionPreload: 'NONE', idleMotionGroup: 'Idle' })
  const motions = { Idle: make(0), Mood_joy: make(1), Mood_sad: make(0) }
  manager._loadMotion = async group => motions[group]
  const internal = Object.assign(new EventEmitter(), { motionManager: manager, coreModel: core, pose, settings })
  ctx.forkGalMotionTransitions(internal)
  assert.ok(core.getParameterIndex('PartArmA') >= model.parameters.count, 'pose selectors are outside the core value array')
  let frame = 0, gestureFrames = 0, idleFrames = 0
  const step = () => {
    internal.emit('beforeMotionUpdate'); manager.update(core, frame++ / 60); internal.emit('afterMotionUpdate')
    const gesture = manager.forkMotionLayers.gesture
    const dominates = gesture && ctx.forkGalGestureWeight(manager.forkMotionLayers.time - gesture.start, gesture.duration) >= 0.5
    const active = dominates && gesture.group === 'Mood_joy' ? 1 : 0
    assert.equal(core.getParameterValueById('ParamArmPoseSwitch'), active * 3)
    assert.equal(core.getParameterValueById('ParamHandLBDisplay'), active)
    assert.equal(core.getParameterValueById('PartArmA'), 1 - active)
    assert.equal(core.getParameterValueById('PartArmB'), active)
    // Match Cubism4InternalModel: Pose runs AFTER the blend/physics, before model rendering.
    pose.updateParameters(core, 1 / 60)
    assert.equal(core.getPartOpacityById('PartArmA'), 1 - active)
    assert.equal(core.getPartOpacityById('PartArmB'), active)
    assert.equal(core.getPartOpacityById('PartArmALink'), 1 - active)
    assert.equal(core.getPartOpacityById('PartArmBLink'), active)
    assert.equal(manager.forkMotionLayers.springs.has(1), false)
    assert.equal(manager.forkMotionLayers.springs.has(2), false)
    active ? gestureFrames++ : idleFrames++
  }
  await manager.startMotion('Idle', 0, 1)
  for (let i = 0; i < 60; i++) step()
  // Both runtime global modes must behave identically, without modifying that global setting.
  const mode = runtime.CubismConfig.setOpacityFromMotion
  try {
    for (const direct of [false, true]) {
      runtime.CubismConfig.setOpacityFromMotion = direct
      await manager.startMotion('Mood_joy', 0, 2)
      for (let i = 0; i < 210; i++) step()
      await manager.startMotion('Mood_joy', 0, 2)
      for (let i = 0; i < 40; i++) step()
      await manager.startMotion('Mood_sad', 0, 2)
      for (let i = 0; i < 210; i++) step()
      assert.equal(runtime.CubismConfig.setOpacityFromMotion, direct)
    }
  } finally { runtime.CubismConfig.setOpacityFromMotion = mode }
  assert.ok(gestureFrames > 0 && idleFrames > 0)
  assert.equal(motions.Idle._motionData.curves[3].type, 2, 'cached PartOpacity targets are not rewritten')
  assert.match(vendor, /afterMotionUpdate[\s\S]*physics\)[\s\S]*pose\)\|\|a\.updateParameters\(o,t\),this\.emit\("beforeModelUpdate"\)/)
})
