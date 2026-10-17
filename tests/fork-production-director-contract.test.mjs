// private fork: production replacements for retired whole-turn prompt/validator assertions.
import test from 'node:test'
import assert from 'node:assert/strict'
import { productionDirectorFixture } from './helpers/production-director-fixture.mjs'
import { buildAssetPackRequest, prepareAssetPackDirector, createAssetPackTransaction } from '../tavern-plugin/lib/domain/stage-asset-pack-director.js'
import { directorPromptData } from './fixtures/asset-packs/prompt.mjs'
import { PACK_ID, FIGURE_ID } from './fixtures/asset-packs/pack.mjs'
const requestFor = prepared => buildAssetPackRequest(prepared, true, undefined, '', true)

test('fixed production catalogue is stable across turns; reply and state stay in the volatile payload', async () => {
  const {input, prepared} = await productionDirectorFixture()
  const a = requestFor(prepared)
  const b = requestFor(prepareAssetPackDirector({...input, units: ['Another synthetic fixture.']}))
  assert.equal(a.system, b.system) // private fork
  assert.deepEqual(a.tools, b.tools) // private fork
  assert.notDeepEqual(a.messages, b.messages) // private fork
  const {inputBytes, estimatedTokens, tokenEstimate, modelContext, maxTokens, ...wire} = buildAssetPackRequest(prepared)
  assert.equal(inputBytes, Buffer.byteLength(JSON.stringify(wire))) // private fork
  assert.deepEqual(directorPromptData(a).reply.map(row => row.text), input.units) // private fork
})

test('physical heights belong to frozen production state, not compressed display heights or prompt prose', async () => {
  const {input} = await productionDirectorFixture()
  input.snapshots[0].figures[FIGURE_ID].heightCm = 152
  const prepared = prepareAssetPackDirector(input)
  assert.equal(prepared.baseline.actors.actor.ruler.heightCm, 152) // private fork
  assert.doesNotMatch(JSON.stringify(requestFor(prepared)), /heightCm|heightBasis|size class/) // private fork
})

test('production widgets expose typed pack commands once and reject disabled commands', async () => {
  const {input, prepared} = await productionDirectorFixture()
  const request = requestFor(prepared)
  assert.ok(request.commands.some(command => command.name === 'widget.clock.set')) // private fork
  const disabled = prepareAssetPackDirector({...input, engine: {...input.engine, widgetsEnabled: false}})
  const off = requestFor(disabled)
  assert.ok(!off.commands.some(command => command.name.startsWith('widget.'))) // private fork
  const tx = createAssetPackTransaction({prepared: disabled, getCurrentBinding: () => disabled.binding})
  const result = tx.submit({sequence: 1, through: 3, done: true, beats: [{at: 1, ops: [
    {op: 'widget.clock.set', ref: {packId: PACK_ID, kind: 'widgets', assetId: 'clock'}, label: 'Hello'},
    {op: 'weather.set', weather: 'rain'}
  ]}]})
  assert.equal(result.ok, false) // private fork
  tx.finish()
  assert.deepEqual(tx.effect().end.widgets, {}) // private fork
  assert.equal(tx.effect().end.weather, 'rain') // private fork
})
