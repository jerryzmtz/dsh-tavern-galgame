// private fork: current reading dictionary fixtures.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { createCardPreparation } from '../tavern-plugin/lib/domain/card-preparation.js'
import { cardAssetRawOperations, readCardAssetExtension } from '../tavern-plugin/lib/domain/card-asset-bindings.js'
import { createCardAssetBoundary, createOptionalAssetPackConsumer, cardAssetWorkspaceRevision } from '../tavern-plugin/lib/fork-card-asset-bindings.js'
import { createAssetEngineSettings } from '../tavern-plugin/lib/fork-asset-engine.js'
import { cardEngineSettings } from '../tavern-plugin/lib/domain/card-stage-settings.js' // private fork (one setting, one place)
import { defaultAssetEngineSettings, validateAssetEngineSettings, patchAssetEngineSettings, ENGINE_SECTION } from '../tavern-plugin/lib/domain/asset-engine-settings.js'
import { cardExtension, PACK_ID, OTHER_PACK_ID, FIGURE_ID } from './fixtures/asset-packs/pack.mjs'
const clone = value => structuredClone(value)
const errorCode = code => error => error.code === code
function fixture(format = 'flat') {
  const prep = createCardPreparation({id:() => 'card-test', now:() => 1})
  const body = {name:'Fixture', extensions:{foreign:{keep:true}, dsh_tavern:{...cardExtension(), opaque:{keep:true}}}, unknown:[1, null]}
  const raw = format === 'flat' ? body : {spec:format, data:body, extensions:{outside:{keep:true}}}
  let card = prep.create({kind:'import', payload:raw}), writes = 0, tail = Promise.resolve()
  const services = new Map(), ctx = {get:key => services.get(key)}
  const boundary = createCardAssetBoundary({ctx, listCards:async () => [{path:'cards/test.json'}], readWorkspace:async () => clone(card),
    updateCard:(_path, patch, revision, rawOperations, expected) => {
      const task = tail.then(() => {
        assert.equal(expected, cardAssetWorkspaceRevision(card))
        const result = prep.update({kind:'card', card, patch, revision, rawOperations})
        card = result.card; writes++
      }); tail = task.catch(() => {}); return task
    }})
  return {prep, boundary, services, ctx, raw, card:() => clone(card), writes:() => writes}
}
test('real host RPCs persist bindings via Card Preparation without activating play settings', async t => {
  const root = await mkdtemp(join(tmpdir(), 'tavern-p2-'))
  t.after(() => rm(root, {recursive:true, force:true}))
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./fixtures/asset-packs-host.mjs', import.meta.url))], {
    env:{...process.env, DSH_HOME:root}, encoding:'utf8', timeout:30000,
  })
  assert.ifError(result.error)
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.match(result.stdout, /asset packs backend RPC smoke passed/)
})
const save = async (f, patch) => f.boundary.update({path:'cards/test.json', expectedRevision:(await f.boundary.snapshot('cards/test.json')).revision, patch})
for (const format of ['flat', 'chara_card_v2', 'chara_card_v3']) test('binding writer roundtrip and opaque raw: ' + format, async () => {
  const f = fixture(format), ext = cardExtension()
  ext.assetBindings.boundPackIds = [] // private fork: revoke the package, not a card figure.
  await save(f, {assetBindings:ext.assetBindings})
  const raw = f.prep.present({card:f.card(), as:'raw'}), data = format === 'flat' ? raw : raw.data
  assert.deepEqual(data.extensions.foreign, {keep:true}); assert.deepEqual(data.unknown, [1, null])
  assert.deepEqual(data.extensions.dsh_tavern.opaque, {keep:true})
  assert.equal(Object.hasOwn(readCardAssetExtension(raw), 'readings'), false) // private fork: no per-card dictionary
  assert.deepEqual(readCardAssetExtension(raw).assetBindings.boundPackIds, [])
  assert.deepEqual(f.prep.present({card:f.prep.create({kind:'import', payload:raw}), as:'raw'}), raw)
  if (format !== 'flat') assert.deepEqual(raw.extensions, f.raw.extensions)
})
// private fork: cast v3 removes borrowed voices and outfit overrides.
test('binding rejects removed voice and outfit overrides, including null values', async () => {
  const f = fixture(), ext = cardExtension(), before = f.card()
  for (const key of ['outfitKey', 'voice', 'voiceFromFigure']) for (const value of [null, 'casual']) {
    const characters = {actor:{figure:null, [key]:value}}
    await assert.rejects(save(f, {assetBindings:{...ext.assetBindings, characters}}), errorCode('UNKNOWN_FIELD'))
  }
  assert.deepEqual(f.card(), before); assert.equal(f.writes(), 0)
})
test('direct raw editing cannot remove bound packs or the required binding table to evade validation', () => {
  const f = fixture()
  assert.deepEqual(readCardAssetExtension(f.prep.update({kind:'card', card:f.card(), rawOperations:[{op:'set', path:'/extensions/dsh_tavern/assetBindings/boundPackIds', value:[]}]}).card.raw).assetBindings.boundPackIds, [])
  assert.throws(() => f.prep.update({kind:'card', card:f.card(), rawOperations:[{op:'delete', path:'/extensions/dsh_tavern/assetBindings'}]}), errorCode('INVALID_ASSET_PACK'))
})
test('new binding extension must declare characters and packs explicitly; old cards remain inactive', async () => {
  const prep = createCardPreparation({id:() => 'old', now:() => 1})
  const card = prep.create({kind:'import', payload:{name:'Old', extensions:{dsh_tavern:{old:true}}}})
  let touched = false
  const consumer = createOptionalAssetPackConsumer({get:() => { touched = true; throw Error('not allowed') }})
  assert.equal((await consumer.inspect(null)).active, false); assert.equal(touched, false)
  assert.equal(cardAssetRawOperations({...card.raw,extensions:{}}, {assetBindings:{boundPackIds:[]}}).length,1)
  assert.equal(prep.update({kind:'card', card, patch:{description:'text chat'}}).view.description, 'text chat')
})
test('workspace revision conflicts do not write and concurrent updates cannot lose bindings', async () => {
  const f = fixture(), expectedRevision = (await f.boundary.snapshot('cards/test.json')).revision
  await save(f, {stage:{}})
  await assert.rejects(f.boundary.update({path:'cards/test.json', expectedRevision, patch:{stage:{}}}), errorCode('REVISION_CONFLICT'))
  const revision = (await f.boundary.snapshot('cards/test.json')).revision
  const results = await Promise.allSettled([1, 2].map(n => f.boundary.update({path:'cards/test.json', expectedRevision:revision, patch:{stage:{widgets:n === 1}}})))
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
  assert.equal(f.writes(), 2)
})
function service() { return {apiVersion:2, capabilities:['packs','figures'], listPacks() {}, resolveFigures() {}, getPackSnapshot:async ({packId}) => ({manifest:{id:packId, figures:[FIGURE_ID]}})} }
test('missing, incompatible, late and unloaded plugin/TTS are diagnostic only, references and text chat survive', async () => {
  const f = fixture(), original = f.card().raw
  assert.equal((await f.boundary.inspect({path:'cards/test.json'})).available, false)
  f.services.set('assetLibrary', {...service(), apiVersion:1})
  assert.equal((await f.boundary.inspect({path:'cards/test.json'})).diagnostics[0].code, 'API_INCOMPATIBLE')
  f.services.set('assetLibrary', {...service(), capabilities:['figures']})
  assert.equal((await f.boundary.inspect({path:'cards/test.json'})).diagnostics[0].code, 'API_INCOMPATIBLE')
  f.services.set('assetLibrary', service())
  let view = await f.boundary.inspect({path:'cards/test.json'})
  assert.equal(view.available, true); assert.equal(view.figures.length, 2)
  assert.ok(view.diagnostics.some(item => item.code === 'TTS_UNAVAILABLE'))
  f.services.set('tts', {}); view = await f.boundary.inspect({path:'cards/test.json'})
  // private fork: no legacy voice references survive the schema boundary.
  assert.deepEqual(view.diagnostics, [])
  f.services.delete('assetLibrary'); f.services.delete('tts')
  assert.equal((await f.boundary.inspect({path:'cards/test.json'})).available, false)
  assert.deepEqual(f.card().raw, original)
  assert.equal(f.prep.update({kind:'card', card:f.card(), patch:{description:'Text still works'}}).view.description, 'Text still works')
})
test('selector queries only explicit bound packs, never global list; unload during snapshot clears choices', async () => {
  const f = fixture(), called = [], provider = service()
  provider.listPacks = () => { throw Error('global catalogue must not be queried') }
  provider.getPackSnapshot = async ({packId}) => { called.push(packId); return {manifest:{id:packId, figures:[FIGURE_ID]}} }
  f.services.set('assetLibrary', provider)
  const ext = cardExtension(); ext.assetBindings = {boundPackIds:[PACK_ID]}
  await save(f, {assetBindings:ext.assetBindings})
  assert.deepEqual((await f.boundary.inspect({path:'cards/test.json'})).figures, [{packId:PACK_ID, figureId:FIGURE_ID}]); assert.deepEqual(called, [PACK_ID])
  provider.getPackSnapshot = async () => { f.services.delete('assetLibrary'); return {manifest:{id:PACK_ID, figures:[FIGURE_ID]}} }
  assert.deepEqual((await f.boundary.inspect({path:'cards/test.json'})).figures, [])
})
test('pack missing or service throwing never erases dangling declared references', async () => {
  const f = fixture(), provider = service()
  provider.getPackSnapshot = async () => { throw Error('missing') }; f.services.set('assetLibrary', provider)
  const view = await f.boundary.inspect({path:'cards/test.json'})
  assert.equal(view.figures.length, 0); assert.equal(view.diagnostics.filter(item => item.code === 'PACK_UNAVAILABLE').length, 2)
  provider.getPackSnapshot = async ({packId}) => ({manifest:{id:packId, figures:[FIGURE_ID, 'invalid']}})
  assert.deepEqual((await f.boundary.inspect({path:'cards/test.json'})).figures, [])
  await save(f, {stage:{}})
  assert.deepEqual(readCardAssetExtension(f.card().raw).assetBindings, cardExtension().assetBindings)
})
test('reverse index tracks edits and returns unknown rather than zero on missing or invalid cards', async () => {
  const f = fixture()
  assert.equal((await f.boundary.dependencies({packId:PACK_ID})).count, 1)
  await save(f, {assetBindings:{boundPackIds:[]}})
  assert.equal((await f.boundary.dependencies({packId:PACK_ID})).count, 0)
  const broken = createCardAssetBoundary({ctx:f.ctx, listCards:async () => [{path:'broken'}], readWorkspace:async () => { throw Error('unavailable') }})
  const result = await broken.dependencies({packId:PACK_ID})
  assert.equal(result.available, false); assert.equal(result.count, null)
})
function engineFixture() {
  let source, hooks, disposed, writes = 0
  const services = new Map(), ctx = {get:key => services.get(key), inject(_keys, callback) { callback(ctx) }, effect(callback) { disposed = callback() }}
  const provider = {installSection(_ctx, key, schema, entry, callbacks) { assert.equal(key, ENGINE_SECTION); source = schema(entry); hooks = callbacks; hooks.setSource(() => source) },
    async replace(key, next) { assert.equal(key, ENGINE_SECTION); source = hooks.validate(next); writes++ }}
  services.set('settings', provider)
  const engine = createAssetEngineSettings(ctx)
  return {engine, services, provider, dispose:() => disposed(), writes:() => writes}
}
test('Engine module settings and exact integer ranges', () => {
  const defaults = defaultAssetEngineSettings()
  assert.equal(Object.hasOwn(defaults,'widgetExecutionEnabled'), false)
  // private fork: removed vector settings are rejected at entry, never silently projected.
  assert.equal(Object.hasOwn(defaults,'semanticRecall'),false)
  assert.throws(() => patchAssetEngineSettings(defaults,{semanticRecall:{}}),{code:'UNKNOWN_FIELD'})
  assert.throws(() => validateAssetEngineSettings({...defaults,semanticRecall:{}}),{code:'UNKNOWN_FIELD'})
  for (const key of Object.keys(defaults.actionCaps)) for (const value of [0, 257, 1.5]) assert.throws(() => patchAssetEngineSettings(defaults, {actionCaps:{[key]:value}}))
  // private fork: no director call quota in settings or patches; old persisted quotas are projected away.
  assert.equal(Object.hasOwn(defaults,'limits'),false)
  assert.throws(() => patchAssetEngineSettings(defaults,{limits:{maxToolCalls:3}}))
  assert.deepEqual(validateAssetEngineSettings({...defaults,limits:{maxToolCalls:3}}),defaults)
  assert.throws(() => patchAssetEngineSettings(defaults, {directorModel:{provider:'local', model:'test', apiKey:'secret'}}))
  assert.throws(() => patchAssetEngineSettings(defaults, {dimensions:{'scene.proposals':true}}))
})
test('Engine module toggles persist immediately via native settings with revision CAS', async () => {
  const f = engineFixture(), old = f.engine.read()
  await f.engine.save({patch:{stageToggles:{music:false}, directorModel:{provider:'local', model:'test'}}, expectedRevision:old.revision})
  assert.equal(f.engine.read().values.stageToggles.music, false) // private fork: widgets moved to the card
  await assert.rejects(f.engine.save({patch:{}, expectedRevision:old.revision}), errorCode('REVISION_CONFLICT'))
  assert.equal(f.writes(), 1); f.services.delete('settings')
  await assert.rejects(f.engine.save({patch:{}, expectedRevision:f.engine.read().revision}), errorCode('SETTINGS_UNAVAILABLE'))
  f.dispose(); assert.throws(() => f.engine.read(), errorCode('CONSUMER_UNAVAILABLE'))
})
// private fork (global only, owner 2026-10, AGENTS rule 15): the director command toggles are only the global
// `dimensions` (舞台引擎 › 可用演出). The stored value is read, a save writes it, and a
// card's stored stage.dimensions (the retired per-card override) is ignored by cardEngineSettings.
test('private fork: the director command toggles are global only; a card override is ignored', async () => {
  const f = engineFixture(), entry = defaultAssetEngineSettings()
  await f.provider.replace(ENGINE_SECTION, {...entry, dimensions:{...entry.dimensions, camera:false}})
  const read = f.engine.read()
  assert.equal(read.values.dimensions.camera, false, 'the stored global value is read')
  assert.equal(read.values.dimensions.cg, true)
  await f.engine.save({patch:{dimensions:{cg:false}}, expectedRevision:read.revision})
  assert.equal(f.engine.read().values.dimensions.cg, false); assert.equal(f.engine.read().values.dimensions.camera, false)
  const ext = {...cardExtension(), stage:{dimensions:{camera:true, weather:false}}}
  const effective = cardEngineSettings(f.engine.read().values, ext).dimensions
  assert.equal(effective.camera, false); assert.equal(effective.weather, true); assert.equal(effective.cg, false)
})
test('custom Engine presets import/export only dialogue themes and reject retired direction presets', async () => {
  const f = engineFixture()
  const theme = {format:'dsh-dialogue-theme', schemaVersion:1, id:'custom', name:'Custom', style:{theme:'gothic', tokens:{'--gal-ui-accent':'#aabbcc', '--gal-ui-radius':'12px'}}}
  const style = {format:'dsh-direction-style', schemaVersion:1, id:'quiet', name:'Quiet', rules:[{id:'joint', requires:['scene', 'music'], text:'Keep changes restrained.\nAvoid redundant changes.'}]}
  for (const document of [theme]) {
    await f.engine.importPreset({document:JSON.stringify(document), expectedRevision:f.engine.read().revision})
    assert.deepEqual(JSON.parse(f.engine.exportPreset(document).document), document)
    await assert.rejects(f.engine.importPreset({document, expectedRevision:f.engine.read().revision}), errorCode('PRESET_EXISTS'))
  }
  await f.engine.save({patch:{dialogueTheme:'custom'}, expectedRevision:f.engine.read().revision})
  await assert.rejects(f.engine.importPreset({document:style,expectedRevision:f.engine.read().revision}),errorCode('UNKNOWN_FIELD'))
  assert.throws(()=>f.engine.exportPreset(style),errorCode('UNKNOWN_FIELD'))
  for (const patch of [{directionStyle:null},{directionStyles:[]}]) await assert.rejects(f.engine.save({patch,expectedRevision:f.engine.read().revision}),errorCode('UNKNOWN_FIELD'))
  for (const document of [{...theme, style:{theme:'classic', script:'evil'}}, {...theme, style:{theme:'classic', tokens:{'--gal-ui-ink':'url(https://example.test)'}}}, {...theme, style:{theme:'classic', tokens:{'--gal-ui-font':'external'}}}, {...style, limits:{}}, {...style, rules:[{id:'bad', requires:['nope'], text:'unknown command'}]}]) {
    await assert.rejects(f.engine.importPreset({document, expectedRevision:f.engine.read().revision}))
  }
  await assert.rejects(f.engine.importPreset({document:'{"format":"dsh-dialogue-theme","format":"bad"}', expectedRevision:f.engine.read().revision}), errorCode('INVALID_JSON'))
})
