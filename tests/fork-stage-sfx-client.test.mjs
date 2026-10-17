import {stagePageSource} from './helpers/stage-page-source.mjs' // private fork
// private fork: follow protocol extraction paths; behavior assertions unchanged.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import soundscape from '../tavern-plugin/packages/dsh-presentation-protocol/src/fork-stage-soundscape.cjs'

const sfx = await readFile(new URL('../tavern-plugin/src/client/fork-stage-sfx.js', import.meta.url), 'utf8')
const stage = await readFile(new URL('../tavern-plugin/src/client/fork-gal-stage.js', import.meta.url), 'utf8')
const live2d = await readFile(new URL('../tavern-plugin/src/client/fork-live2d.js', import.meta.url), 'utf8')
const effects = await readFile(new URL('../tavern-plugin/src/client/fork-gal-effects.js', import.meta.url), 'utf8')
const lighting = await readFile(new URL('../tavern-plugin/packages/dsh-presentation-protocol/src/fork-stage-light.cjs', import.meta.url), 'utf8')

test('environment audio has one scene/weather planner; obsolete amb cannot suppress rain', () => {
  const direction = { start: { weather: 'rain', amb: 'none' }, entries: [{ at: 2, commands: [{ op: 'amb', value: 'none' }] }] }
  const sounds = ['amb-rain', 'amb-rain-window'].map(id => ({ id, kind: 'ambience', url: '/' + id + '.ogg' }))
  const first = soundscape.forkSoundscapeRecordPlan(direction, 1, sounds)
  assert.ok(first.layers.some(layer => layer.slot === 'weather'))
  assert.deepEqual(soundscape.forkSoundscapeRecordPlan(direction, 2, sounds).layers, first.layers)
  assert.doesNotMatch(sfx, /forkStageAmbienceId|FORK_WEATHER_AMBIENCE|ambience\(url/)
})

test('staging: obsolete amb is not replayed; sfx still fires only on its paragraph', () => {
  const ctx = {}
  const slots = live2d.slice(live2d.indexOf('function forkLive2dSlots'), live2d.indexOf('\n', live2d.indexOf('function forkLive2dSlots')))
  const helpers = effects.slice(effects.indexOf('// ---------- Effect helpers'), effects.indexOf('// Light presets.'))
  vm.runInNewContext(lighting + slots + '\n' + helpers + '\n' + (stagePageSource + '\n' + stage.slice(stage.indexOf('// Plain reading text'), stage.indexOf('// The stage is a full-screen mode'))) + ';this.staging=forkGalStaging;', ctx)
  const direction = { status: 'done', start: { cast: ['madoka'], amb: 'amb-city-street' }, entries: [
    { at: 2, commands: [{ op: 'sfx', value: 'door-open' }] },
    { at: 4, commands: [{ op: 'amb', value: 'amb-rain' }] },
    { at: 6, commands: [{ op: 'amb', value: 'none' }] }
  ] }
  assert.equal(Object.hasOwn(ctx.staging(direction, 1), 'amb'), false)
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.staging(direction, 2).effects)), [{ op: 'sfx', value: 'door-open' }])
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.staging(direction, 3).effects)), [])
  assert.equal(Object.hasOwn(ctx.staging(direction, 5), 'amb'), false)
  assert.equal(Object.hasOwn(ctx.staging(direction, 7), 'amb'), false)
})