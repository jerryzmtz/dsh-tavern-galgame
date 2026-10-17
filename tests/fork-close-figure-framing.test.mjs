// private fork: close means face/upper-body framing for chibi and ordinary figures alike.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { resolveFigureSizing } from '../tavern-plugin/packages/dsh-presentation-protocol/src/fork-figure-scale.cjs'
const read = name => fs.readFileSync(new URL('../tavern-plugin/src/client/' + name, import.meta.url), 'utf8')
const scene = read('fork-gal-scene.js'), effects = read('fork-gal-effects.js'), ctx = {}
vm.runInNewContext(scene.slice(scene.indexOf('// ---------- Scene helpers'), scene.indexOf('// ---------- Scene runtime')) + effects.slice(effects.indexOf('// ---------- Effect helpers'), effects.indexOf('// ---------- Effect runtime')), ctx)
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`)
for (const kind of ['static', 'live2d']) for (const H of [900, 844]) {
  test(`${kind} ${H}: close frames chibi and adult heads; reset/wide retain the ruler`, () => {
    const W = H === 900 ? 1600 : 390, frame = ctx.forkGalVisibleFrame(W, H, false), box = H * .7826
    for (const span of [H * .2084, H * .19, H * .10]) {
      const head = { x: W / 2, top: H * .49, chin: H * .49 + span, width: span }
      const framing = ctx.forkGalCloseFrame(head, frame, box, W, H)
      const shot = ctx.forkGalShotTarget('close', framing).target
      const available = box - H * .02 - frame.top - frame.margin
      near(span * shot.zoom, available * .55)
      assert.ok(shot.zoom > 1.35)
      const mapped = ctx.forkGalFrameCameraTarget(shot, frame, H)
      near(mapped.ay * H - span * shot.zoom / 2, frame.top + frame.margin + available * .075)
      for (const mode of ['reset', 'wide', 'push']) {
        const ordinary = ctx.forkGalShotTarget(mode, framing).target
        near(ordinary.zoom, mode === 'push' ? 1.12 : 1)
      }
    }
    // Calibrated shy sprite and v5 Live2D anatomy; JSON replay must preserve the live geometry.
    const canvas = kind === 'static' ? [1311, 1200] : [1280, 1280]
    const anatomy = kind === 'static' ? { figureTop: 22, headTop: 144, chin: 565, feet: 1175, visibleBottom: 1175 }
      : { figureTop: 67, headTop: 194.304, chin: 600.448, feet: 1209, visibleBottom: 1209 }
    const source = 'a'.repeat(64)
    const input = { version: 1, source, canvas, W, H, heightCm: 120, heightBasis: 'standing', assetScale: .55, sceneHMax: 150, sceneGroundRatio: 1, occluderTop: box,
      metrics: { status: 'confirmed', sourceSha: source, canvas, override: { ...anatomy, posture: 'standing', heightBasis: 'standing', crop: 'full' } } }
    for (const replayInput of [input, JSON.parse(JSON.stringify(input))]) {
      const size = resolveFigureSizing(replayInput)
      assert.equal(size.mode, 'physical')
      const rest = ctx.forkGalFaceRest(size.restHead, size.support.y, frame.top + H * .02, box, H, size.restBounds)
      assert.equal(rest.fullBody, true)
      near(size.restBounds.bottom - rest.lift, box - H * 12 / 900)
      const close = ctx.forkGalCloseFrame(size.restHead, frame, box, W, H)
      near((size.restHead.chin - size.restHead.top) * close.zoom, (box - H * .02 - frame.top - frame.margin) * .55)
    }
    const adult = ctx.forkGalFaceRest({ top: H * .13, chin: H * .32 }, H * 1.37, frame.top + H * .02, box, H, { top: H * .13, bottom: H * 1.37 })
    near(adult.lift, 0)
  })
}
test('runtime supplies rest head and stable textbox boundary to the shared close planner', () => {
  assert.match(scene, /headOf\(spec.target, true\)/)
  assert.match(scene, /forkGalCloseFrame\(head, frame, state.faceEnvironment.occluderTop, W, H\)/)
  assert.match(scene, /!closeShot && !entry.figure.close \? lockBody : null/)
  assert.equal(ctx.forkGalShotTarget('close', null).target.zoom, 1)
})
