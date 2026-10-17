import directorCommands from '../tavern-plugin/packages/dsh-presentation-protocol/src/director-commands.cjs'
import {stagePageSource} from './helpers/stage-page-source.mjs' // private fork
// private fork: follow protocol extraction paths; behavior assertions unchanged.
import { presentationSourceUrl } from './helpers/presentation-sources.mjs'
// private fork: close-ups are brief emphasis. Staging releases them after 4 paragraphs or a scene
// change, the incremental core never carries them across a scene or turn, and the renderer fades
// non-subject figures that a close-up leaves as a sliver at the frame edge.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { createStageTransaction } from '../tavern-plugin/lib/domain/stage-incremental.js'

const read = name => readFile(presentationSourceUrl(name), 'utf8')
const stage = await read('fork-gal-stage.js'), scene = await read('fork-gal-scene.js'), effects = await read('fork-gal-effects.js')
const ctx = { forkLive2dSlots: n => n === 1 ? [0.5] : n === 2 ? [0.33, 0.67] : [0.2, 0.5, 0.8] }
const effectHelpers = scene.slice(scene.indexOf('// ---------- Scene helpers'), scene.indexOf('// ---------- Scene runtime')) + effects.slice(effects.indexOf('// ---------- Effect helpers'), effects.indexOf('// ---------- Effect runtime'))
vm.runInNewContext(await read('fork-stage-light.cjs') + await read('fork-stage-pacing.cjs') + await read('fork-figure-scale.cjs') + effectHelpers
  + scene.slice(scene.indexOf('function forkGalFigureRects('), scene.indexOf('// ---------- Scene helpers'))
  + (stagePageSource + '\n' + stage.slice(stage.indexOf('// Plain reading text'), stage.indexOf('// The stage is a full-screen mode'))), ctx)
const camAt = (direction, para) => JSON.parse(JSON.stringify(ctx.forkGalStaging(direction, para, new Set(), undefined, []).camera))

test('legacy and incremental close-ups hold the cue paragraph plus four, then reset', () => {
  for (const protocol of ['submit_direction-v3', 'incremental-v1']) {
    const direction = { status: 'done', protocol, start: { cast: ['a', 'b'] }, entries: [{ at: 10, commands: [{ op: 'cam', value: 'close', id: 'b' }] }] }
    assert.deepEqual(camAt(direction, 10), { value: 'close', id: 'b' }, protocol)
    assert.deepEqual(camAt(direction, 14), { value: 'close', id: 'b' }, protocol)
    assert.deepEqual(camAt(direction, 15), { value: '' }, protocol)
    assert.deepEqual(camAt(direction, 70), { value: '' }, protocol)
  }
})

test('a scene change releases a close-up; a new close-up after it starts its own hold', () => {
  const direction = { status: 'done', start: { cast: ['a'] }, entries: [
    { at: 2, commands: [{ op: 'cam', value: 'close', id: 'a' }] }, { at: 3, scene: 'park' },
    { at: 8, commands: [{ op: 'cam', value: 'close', id: 'a' }] }] }
  assert.deepEqual(camAt(direction, 3), { value: '' })
  assert.deepEqual(camAt(direction, 12), { value: 'close', id: 'a' })
  assert.deepEqual(camAt(direction, 13), { value: '' })
  // Other persistent shots are untouched.
  assert.deepEqual(camAt({ status: 'done', start: { cast: ['a'] }, entries: [{ at: 1, commands: [{ op: 'cam', value: 'dutch' }] }] }, 40), { value: 'dutch' })
})

test('incremental core never carries a close-up across a scene change or the end of a turn', () => {
  const catalog = { actors: { a: { defaultVariant: 'u', variants: ['u'] } }, scene: ['room', 'park'], music: [] }
  const close = { op: 'stage.patch', value: { camera: { mode: 'close', actor: 'a' } } }
  const tx = createStageTransaction({ catalog, target: { sourceKey: 's' }, units: 4 })
  assert.equal(tx.submit({ sequence: 1, through: 2, done: false, beats: [{ at: 1, ops: [{ op: 'actor.enter', actor: 'a' }, close] }] }).ok, true)
  assert.equal(tx.inspect().state.camera.mode, 'close')
  assert.equal(tx.submit({ sequence: 2, through: 3, done: false, beats: [{ at: 3, ops: [{ op: 'scene.set', value: 'park' }] }] }).ok, true)
  assert.deepEqual(tx.inspect().state.camera, { mode: 'reset', actor: null })
  const held = createStageTransaction({ catalog, target: { sourceKey: 't' }, units: 2 })
  assert.equal(held.submit({ sequence: 1, through: 2, done: true, beats: [{ at: 1, ops: [{ op: 'actor.enter', actor: 'a' }, close] }] }).ok, true)
  assert.deepEqual(held.effect().end.camera, { mode: 'reset', actor: null })
  const wide = createStageTransaction({ catalog, target: { sourceKey: 'u' }, units: 1 })
  assert.equal(wide.submit({ sequence: 1, through: 1, done: true, beats: [{ at: 1, ops: [{ op: 'stage.patch', value: { camera: { mode: 'dutch' } } }] }] }).ok, true)
  assert.equal(wide.effect().end.camera.mode, 'dutch', 'only close-ups are released')
})

test('crop fade: a figure left mostly outside a close-up frame hides; a framed figure stays', () => {
  const W = 1000, H = 600
  // Close-up on a figure at 75%: zoom 1.35 around x = 0.75 (clamped as the renderer does).
  const camera = ctx.forkGalCameraClamp({ zoom: 1.35, fx: 0.75, fy: 0.4, ax: 0.5, ay: 0.36, rotation: 0 }, W, H, 0.018)
  const body = x => ({ x: x * W - 120, y: 150, width: 240, height: 450 })
  assert.equal(ctx.forkGalCropHidden(body(0.25), camera, W, H), true, 'left figure is a sliver at the edge')
  assert.equal(ctx.forkGalCropHidden(body(0.75), camera, W, H), false, 'subject stays')
  const normal = ctx.forkGalCameraClamp({ zoom: 1, fx: 0.5, fy: 0.42, ax: 0.5, ay: 0.42, rotation: 0 }, W, H, 0.018)
  assert.equal(ctx.forkGalCropHidden(body(0.25), normal, W, H), false, 'no hiding without a close-up framing')
  assert.equal(ctx.forkGalCropHidden(null, camera, W, H), false)
  assert.match(scene, /entry\.cropped = Boolean\(closeOn && figure\.alias !== closeOn/)
})

test('director rules describe close-ups as brief emphasis', () => {
  // private fork: production command guidance, not retired prose.
  assert.match(directorCommands.definitions.find(row => row.name === 'closeup.play').summary, /four paragraphs/)
})
