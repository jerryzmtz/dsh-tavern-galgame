import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { EventEmitter } from 'node:events'
import vm from 'node:vm'

// Director gaze and head acts on a Live2D figure (fork-gal-scene.js forkGalApplyStageHead): offsets on the model's own
// idle/gesture head pose, written before physics so the model's physics3 inputs see them. Vendored Cubism4 runtime with a
// small parameter table; the update order below is Cubism4InternalModel.update's.
const source = await readFile(new URL('../tavern-plugin/src/client/fork-gal-scene.js', import.meta.url), 'utf8')
const layers = await readFile(new URL('../tavern-plugin/src/client/fork-gal-motion.js', import.meta.url), 'utf8')
const vendor = await readFile(new URL('../tavern-plugin/lib/vendor/runtime-assets/live2d/pixi-live2d-display-cubism4.min.js', import.meta.url), 'utf8')
const ctx = { console, performance: { now: () => 0 }, window: { Live2DCubismCore: {} },
  PIXI: { utils: { EventEmitter }, Point: class {}, Matrix: class {}, Container: class {}, Transform: class {} } }
vm.runInNewContext(vendor, ctx)
vm.runInNewContext(layers + source.slice(source.indexOf('// ---------- Scene helpers'), source.indexOf('// ---------- Scene runtime')), ctx)
const runtime = ctx.PIXI.live2d
runtime.config.sound = false

// [id, min, max] and the idle clip's keyframes (time, value)
const PARAMETERS = [['ParamAngleX', -30, 30, [[0, 0], [1.5, 10], [3, 0]]], ['ParamAngleY', -30, 30, [[0, 0], [3, 0]]], ['ParamEyeBallX', -1, 1, [[0, 0.1], [1.5, 0.4], [3, 0.1]]]]

function idleClip() {
  const curves = PARAMETERS.map(([Id, , , keys]) => ({ Target: 'Parameter', Id, Segments: [keys[0][0], keys[0][1], ...keys.slice(1).flatMap(([t, v]) => [0, t, v])] }))
  return runtime.CubismMotion.create({ Meta: { Duration: 3, Fps: 30, Loop: true, CurveCount: curves.length, TotalSegmentCount: 5,
    TotalPointCount: 8, FadeInTime: 0.5, FadeOutTime: 0.5, UserDataCount: 0, TotalUserDataSize: 0 }, Curves: curves })
}

async function run(stage) {
  const model = {
    parameters: { count: PARAMETERS.length, ids: PARAMETERS.map(row => row[0]), values: new Float32Array(PARAMETERS.length),
      minimumValues: new Float32Array(PARAMETERS.map(row => row[1])), maximumValues: new Float32Array(PARAMETERS.map(row => row[2])),
      defaultValues: new Float32Array(PARAMETERS.length) },
    parts: { count: 0, ids: [], opacities: new Float32Array(0) }, drawables: { count: 0, ids: [] }
  }
  const core = new runtime.CubismModel(model)
  const settings = { name: 'head-fixture', motions: { Idle: [{}] }, getEyeBlinkParameters: () => [], getLipSyncParameters: () => [] }
  const manager = new runtime.Cubism4MotionManager(settings, { motionPreload: 'NONE', idleMotionGroup: 'Idle' })
  const clip = idleClip()
  manager._loadMotion = async () => clip
  const internal = Object.assign(new EventEmitter(), { motionManager: manager, coreModel: core, settings })
  ctx.forkGalMotionTransitions(internal)
  // Same registration as the stage's loadLive2d.
  internal.on('afterMotionUpdate', () => ctx.forkGalApplyStageHead(core, stage.look, stage.param))
  await manager.startMotion('Idle', 0, 1)
  const physicsInputs = []
  for (let frame = 0; frame < 360; frame++) {
    internal.emit('beforeMotionUpdate'); manager.update(core, frame / 60); internal.emit('afterMotionUpdate')
    core.saveParameters()
    physicsInputs.push(Object.fromEntries(PARAMETERS.map(([id]) => [id, core.getParameterValueById(id)]))) // physics.evaluate reads here
    core.loadParameters()
  }
  return physicsInputs
}

test('gaze offsets the idle head pose instead of freezing it, and physics sees the offset', async () => {
  const plain = await run({ look: 0, param: null }), gazing = await run({ look: 1, param: null })
  const idleX = plain.map(f => f.ParamAngleX)
  assert.ok(Math.max(...idleX) - Math.min(...idleX) > 5, 'the idle clip turns the head')
  for (let i = 0; i < plain.length; i++) {
    assert.ok(Math.abs(gazing[i].ParamAngleX - (plain[i].ParamAngleX + 20)) < 1e-4, `frame ${i}: idle head turn kept under the gaze`)
    assert.ok(Math.abs(gazing[i].ParamEyeBallX - Math.min(1, plain[i].ParamEyeBallX + 0.8)) < 1e-4, `frame ${i}: eyes offset, clamped`)
  }
})

test('head acts add to the pose and stay inside the model range without accumulating', async () => {
  const plain = await run({ look: 0, param: null }), acted = await run({ look: 1, param: { angleX: 15, angleY: -18 } })
  for (let i = 0; i < plain.length; i++) {
    assert.equal(acted[i].ParamAngleX, 30, `frame ${i}: clamped to the model maximum`)
    assert.ok(Math.abs(acted[i].ParamAngleY - (plain[i].ParamAngleY - 18)) < 1e-4, `frame ${i}: nod offset applied once`)
  }
})

test('the stage applies director head moves before physics, not after it', () => {
  assert.match(source, /on\("afterMotionUpdate", \(\) => forkGalApplyStageHead\(/)
  const late = source.slice(source.indexOf('model.internalModel.on("beforeModelUpdate"'))
  assert.doesNotMatch(late.slice(0, late.indexOf('});')), /(?:set|add)ParameterValueById\("Param(?:Angle|EyeBall)/)
})
