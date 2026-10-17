import {stagePageSource} from './helpers/stage-page-source.mjs' // private fork
// private fork: ordinary pack sources are authoring inputs, not runtime defaults.
// private fork: follow protocol extraction paths; behavior assertions unchanged.
import { presentationSourceUrl } from './helpers/presentation-sources.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { forkStageLightingReplay } from "../tavern-plugin/packages/dsh-presentation-protocol/src/fork-stage-light.cjs"

const read = name => readFile(presentationSourceUrl(name), 'utf8')
const looks = JSON.parse(await readFile(new URL('./fixtures/public-lighting.json', import.meta.url), 'utf8')).looks
const light = value => ({ op: 'light', value })
const entries = [{ at: 1, commands: [light('night')] }, { at: 19, commands: [light('warm')] }]
const plain = value => JSON.parse(JSON.stringify(value))
const section = (source, a, b) => source.slice(source.indexOf(a), source.indexOf(b))
const scene = await read('fork-gal-scene.js'), effects = await read('fork-gal-effects.js'), stage = await read('fork-gal-stage.js'), render = await read('fork-gal-looks.js')
const client = {}
const live2d = await read('fork-live2d.js')
const slots = live2d.slice(live2d.indexOf('function forkLive2dSlots'), live2d.indexOf('\n', live2d.indexOf('function forkLive2dSlots')))
vm.runInNewContext(slots + await read('fork-stage-light.cjs') + section(scene, '// ---------- Scene helpers', '// ---------- Scene runtime') +
  section(effects, '// ---------- Effect helpers', '// ---------- Effect runtime') + section(render, '// ---------- Look helpers', '// ---------- Look runtime') +
  (stagePageSource + '\n' + section(stage, '// Plain reading text', '// The stage is a full-screen mode')) +
  ';Object.assign(this, { forkGalStaging, forkGalLookRegistry, forkGalLookResolve, forkGalLookComposeMatrix, forkGalLookMatrix, forkGalLookUi, forkGalTimeGrade, forkGalMatrix });', client)

test('renderer composes mood AFTER time, preserves time extras and follows the composed matrix at half strength', () => {
  const registry = client.forkGalLookRegistry(looks, 1), M = client.forkGalMatrix
  const night = client.forkGalLookResolve(registry, { time: 'night', mood: 'none' }, 'dusk')
  const warm = client.forkGalLookResolve(registry, { time: 'night', mood: 'warm' }, 'dusk')
  assert.equal(warm.grade, night.grade); assert.equal(warm.grade, 'night')
  const timeMatrix = client.forkGalTimeGrade(registry, warm.grade).grade, moodMatrix = client.forkGalLookMatrix(warm.moodWorld)
  const matrix = client.forkGalLookComposeMatrix(timeMatrix, moodMatrix)
  const apply = (matrix, rgb) => [0, 1, 2].map(row => rgb.reduce((sum, value, col) => sum + matrix[row * 5 + col] * value, matrix[row * 5 + 4]))
  const close = (a, b) => a.forEach((value, i) => assert.ok(Math.abs(value - b[i]) < 1e-8))
  close(apply(matrix, [0.7, 0.5, 0.3]), apply(moodMatrix, apply(timeMatrix, [0.7, 0.5, 0.3])))
  assert.notDeepEqual(plain(matrix), plain(M.multiply(timeMatrix, moodMatrix)), 'order is observable, including affine offsets')
  const ui = client.forkGalLookUi({ look: warm.world, matrix: moodMatrix, grade: timeMatrix })
  close(ui.matrix, M.mix(M.identity(), matrix, 0.5))
  const dark = client.forkGalLookResolve(registry, { time: 'dark', mood: 'warm' }, '')
  assert.ok(dark.world.vignette.amount >= dark.timeWorld.vignette.amount, 'mood does not discard the base vignette')
  assert.ok(apply(matrix, [1, 1, 1])[0] < apply(moodMatrix, [1, 1, 1])[0], 'warm keeps night darkening')
})
