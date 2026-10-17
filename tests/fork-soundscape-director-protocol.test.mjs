// private fork: soundscape wire and validation coverage now exercises the production pack director.
import test from 'node:test'
import assert from 'node:assert/strict'
import { productionDirectorFixture } from './helpers/production-director-fixture.mjs'
import { buildAssetPackRequest, createAssetPackTransaction } from '../tavern-plugin/lib/domain/stage-asset-pack-director.js'
import { createDirectorHandles } from '../tavern-plugin/lib/domain/stage-director-handles.js'
const transaction = prepared => createAssetPackTransaction({prepared, getCurrentBinding: () => prepared.binding})
const batch = ops => ({sequence: 1, through: 3, done: true, beats: [{at: 1, ops}]})

test('production ambience requires recalled handles and retains valid siblings', async () => {
  const {prepared} = await productionDirectorFixture()
  const rain = createDirectorHandles(prepared.context).ref(prepared.context.catalogue.candidates.ambience[0].ref)
  const candidates = [undefined, null, {}, 'empty', 1, [], [rain], [rain,rain], ['missing'], [rain,rain,rain]]
  for (const refs of candidates) {
    const tx = transaction(prepared)
    const result = tx.submitModel(batch([{op: 'ambience.set', ...(refs === undefined ? {} : {refs})}, {op: 'weather.set', weather: 'rain'}]))
    const valid = Array.isArray(refs) && refs.length === 1 && refs[0] === rain
    assert.equal(result.ok, valid, JSON.stringify(refs)) // private fork
    tx.finish()
    const end = tx.effect().end
    assert.equal(end.weather, 'rain') // private fork: legal siblings survive drops.
    assert.equal(Object.values(end.soundscape).length,valid ? 1 : 0) // private fork
  }
})

test('sound omission carries, explicit reset clears, and sealed windows match one complete submission', async () => {
  const {prepared} = await productionDirectorFixture()
  const rain = createDirectorHandles(prepared.context).ref(prepared.context.catalogue.candidates.ambience[0].ref)
  const beats = [
    {at: 1, ops: [{op: 'ambience.set', refs: [rain]}]},
    {at: 2, ops: [{op: 'weather.set', weather: 'rain'}]},
    {at: 3, ops: [{op: 'ambience.clear'}]}
  ]
  const whole = transaction(prepared), windows = transaction(prepared)
  assert.equal(whole.submitModel({sequence: 1, through: 3, done: true, beats}).ok, true) // private fork
  for (const [index, beat] of beats.entries()) assert.equal(windows.submitModel({sequence: index + 1, through: index + 1, done: index === 2, beats: [beat]}).ok, true) // private fork
  assert.deepEqual(windows.effect().entries, whole.effect().entries) // private fork
  assert.equal(Object.values(whole.effect().entries[1].state.soundscape).length, 1) // private fork
  assert.deepEqual(whole.effect().end.soundscape, {}) // private fork
})

test('production provider schemas are portable and never expose acoustic engine state', async () => {
  const {prepared} = await productionDirectorFixture()
  for (const incremental of [true, false]) {
    const request = buildAssetPackRequest(prepared, incremental, undefined, '', true)
    function check(value) {
      if (!value || typeof value !== 'object') return
      if (value.type === 'array') {
        assert.ok(value.items) // private fork
        assert.equal(Object.hasOwn(value, 'enum'), false) // private fork
      }
      Object.values(value).forEach(check)
    }
    check(request.tools)
    assert.ok(request.commands.some(command => command.name === 'ambience.set')) // private fork
    assert.doesNotMatch(JSON.stringify(request), /hushUntil|lowpassHz|sceneKey|ENGINE_ONLY_RAIN/) // private fork
    const tx = transaction(prepared)
    assert.equal(tx.submitModel(batch([{op: 'amb', value: 'rain'}, {op: 'weather.set', weather: 'rain'}])).ok, false) // private fork
    tx.finish()
    assert.equal(tx.effect().end.weather, 'rain') // private fork
  }
})
