// private fork: native packs store registered emotion-owned renders; legacy state pools are rejected.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { syntheticPack, cardExtension, PACK_ID, FIGURE_ID, OTHER_PACK_ID } from './fixtures/asset-packs/pack.mjs'
import * as packs from '../tavern-plugin/packages/dsh-asset-library/lib/asset-packs/index.js'
import {forkValidateWidgetDocument} from '../tavern-plugin/src/client/fork-widget-contracts.cjs' // private fork: v3 document owns its schema
import * as refs from '../tavern-plugin/packages/dsh-presentation-protocol/src/asset-packs.js'
import { createCardPreparation } from '../tavern-plugin/lib/domain/card-preparation.js'
import * as cards from '../tavern-plugin/lib/domain/card-asset-bindings.js'
const clone = value => structuredClone(value)
const code = expected => error => { assert.equal(error.code, expected); assert.equal(typeof error.path, 'string'); return true }
const fixture = await syntheticPack()
// This suite targets the new reader; the shared director fixture is owned by A.
const bg=fixture.manifest.assets[0],[base,night]=Object.keys(fixture.manifest.blobs).filter(hash=>fixture.manifest.blobs[hash].mime==='image/png')
bg.variants={default:'day',entries:[{id:'day',name:'Morning',content:{media:base}},{id:'night',name:'Moonlight',content:{media:night}}]}
delete bg.media;delete bg.baseTime
const mood=fixture.manifest.assets[5];mood.layer='mood';delete mood.timeOfDay
fixture.manifest.contentHash=await packs.computeContentHash(fixture.manifest)

test('complete synthetic pack verifies document, bundle and file hashes without I/O', async () => {
  assert.equal((await packs.verifyPackDocuments(fixture)).manifest, fixture.manifest)
  await packs.verifyPackFiles(fixture.manifest, fixture.files)
  for (const file of fixture.manifest.files) {
    const bytes = fixture.files.get(file.path)
    assert.equal(bytes.length, file.size)
    assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256)
  }
  assert.equal(fixture.files.size, fixture.manifest.files.length)
})
test('pack and global figure UUID duplicates are rejected', () => {
  assert.throws(() => packs.validatePackIdentities([fixture.manifest, fixture.manifest]), code('DUPLICATE_ID'))
  const other = clone(fixture.manifest); other.id = OTHER_PACK_ID /* private fork: no background preset */
  assert.throws(() => packs.validatePackIdentities([fixture.manifest, other]), code('DUPLICATE_ID'))
  const duplicate = clone(fixture.manifest); duplicate.figures.push(FIGURE_ID)
  assert.throws(() => packs.validatePackManifest(duplicate), code('DUPLICATE_ID'))
})
test('short IDs are scoped by kind, complete refs by pack; control words remain valid IDs', () => {
  packs.validatePackManifest(fixture.manifest)
  const bg = { packId: PACK_ID, kind: 'backgrounds', assetId: 'classroom' }, music = { ...bg, kind: 'music' }
  assert.notEqual(refs.assetRefKey(bg), refs.assetRefKey(music))
  assert.notEqual(refs.assetRefKey(bg), refs.assetRefKey({ ...bg, packId: OTHER_PACK_ID }))
  for (const assetId of ['none', 'auto', 'day']) refs.validateAssetRef({ ...bg, assetId })
  const bad = clone(fixture.manifest); bad.assets.push(bad.assets[0])
  assert.throws(() => packs.validatePackManifest(bad), code('DUPLICATE_ID'))
})
test('refs reject abbreviated, uppercase, malformed and extra identities', () => {
  const ref = { packId: PACK_ID, figureId: FIGURE_ID }
  refs.validateFigureRef(ref); refs.validateOutfitRef({ ...ref, outfitKey: 'school' })
  for (const packId of ['abc', PACK_ID.replace('11111111', 'ABCDEF12'), '00000000-0000-0000-0000-000000000000']) assert.throws(() => refs.validateFigureRef({ ...ref, packId }), code('INVALID_REF'))
  assert.throws(() => refs.validateFigureRef({ ...ref, source: 'general' }), code('UNKNOWN_FIELD'))
  for (const outfitKey of ['constructor', '__proto__', 'x'.repeat(65)]) assert.throws(() => refs.validateOutfitRef({ ...ref, outfitKey }), code('INVALID_REF'))
})
test('hash syntax, computed hash and schema versions fail closed', async () => {
  for (const contentHash of ['bad', 'A'.repeat(64), 'https://example.test/image']) assert.throws(() => packs.validatePackManifest({ ...fixture.manifest, contentHash }), code('INVALID_HASH'))
  await assert.rejects(packs.verifyContentHash({ ...fixture.manifest, contentHash: '0'.repeat(64) }), code('CONTENT_HASH_MISMATCH'))
  assert.throws(() => packs.validatePackManifest({ ...fixture.manifest, schemaVersion: 2 }), code('UNSUPPORTED_SCHEMA_VERSION'))
  assert.throws(() => packs.validateFigure({ ...fixture.figures[FIGURE_ID], schemaVersion: 0 }), code('UNSUPPORTED_SCHEMA_VERSION'))
})
test('canonical hashing sorts Unicode code points, including integer-like keys, and preserves arrays', async () => {
  const a = JSON.parse('{"z":1,"10":10,"2":2,"nested":{"b":2,"a":1},"array":[3,2,1]}')
  const b = { array: [3, 2, 1], nested: { a: 1, b: 2 }, 2: 2, 10: 10, z: 1 }
  assert.equal(packs.canonicalJson(a), '{"10":10,"2":2,"array":[3,2,1],"nested":{"a":1,"b":2},"z":1}')
  assert.equal(await packs.jsonHash(a), await packs.jsonHash(b))
  assert.equal(packs.canonicalJson({ '\u{10000}': 1, '\ue000': 2 }), '{"\ue000":2,"\u{10000}":1}')
  assert.equal(packs.canonicalJson({ n: -0 }), '{"n":0}')
  assert.notEqual(await packs.jsonHash(['a', 'b']), await packs.jsonHash(['b', 'a']))
  assert.notEqual(await packs.jsonHash('\u00e9'), await packs.jsonHash('e\u0301'))
})
test('contentHash excludes only its own field; machine state stays outside the manifest', async () => {
  assert.equal(await packs.computeContentHash({ ...fixture.manifest, contentHash: 'f'.repeat(64) }), fixture.manifest.contentHash)
  const snapshot = { manifest: fixture.manifest, revision: 'cas-1', cache: { url: 'lease-1' } }
  const before = await packs.computeContentHash(snapshot.manifest)
  snapshot.revision = 'cas-2'; snapshot.cache.url = 'lease-2'
  assert.equal(await packs.computeContentHash(snapshot.manifest), before)
  for (const key of packs.LOCAL_ONLY_FIELDS) assert.throws(() => packs.contentHashInput({ ...fixture.manifest, [key]: 'machine' }), code('UNKNOWN_FIELD'))
  assert.notEqual(await packs.computeContentHash({ ...fixture.manifest, name: 'Renamed' }), before)
})
test('strict JSON rejects duplicate escaped keys, BOM, overflow and non-JSON values', () => {
  for (const source of ['{"x":1,"x":2}', '{"nested":{"x":1,"\\u0078":2}}', '\ufeff{}', '{"n":1e999}', '[1,]', 'true false']) assert.throws(() => packs.parseJson(source), code('INVALID_JSON'))
  const cyclic = {}; cyclic.self = cyclic
  const accessor = Object.defineProperty({}, 'x', { enumerable: true, get() { throw Error('must not execute') } })
  for (const value of [undefined, NaN, Infinity, 1n, new Date(), cyclic, accessor, new Array(2), { x: undefined }, { x() {} }, { [Symbol()]: 1 }]) assert.throws(() => packs.canonicalJson(value), code('INVALID_JSON'))
  assert.deepEqual(packs.parseJson('{"array":[null,true,1,"a\\\"b"],"__proto__":{}}'), JSON.parse('{"array":[null,true,1,"a\\\"b"],"__proto__":{}}'))
})
test('bundle hash is independent of file order and rejects duplicate relative paths', async () => {
  const files = fixture.manifest.files.slice(0, 3)
  assert.equal(await packs.computeBundleHash(files), await packs.computeBundleHash([...files].reverse()))
  assert.throws(() => packs.computeBundleHash([files[0], files[0]]), code('DUPLICATE_ID'))
})
for (const format of ['chara_card_v2', 'chara_card_v3', 'flat']) test(`Card Preparation ${format} raw roundtrip retains unknown fields and writes only the authoritative location`, () => {
  const ext = cardExtension(), body = { name: 'Fixture', description: 'Original', opaque: { values: [1, null, { author: true }] }, extensions: { foreign: { foo: 'bar' }, dsh_tavern: { ...ext, futureCardField: { keep: true } } } }
  const raw = format === 'flat' ? body : { spec: format, spec_version: format.endsWith('v2') ? '2.0' : '3.0', data: body, extensions: { dsh_tavern: { notTheAuthority: true } }, foreignRoot: [1, 2] }
  const original = clone(raw), preparation = createCardPreparation({ id: () => 'synthetic-card', now: () => 1 })
  const workspace = preparation.create({ kind: 'import', payload: raw })
  assert.deepEqual(preparation.present({ card: workspace, as: 'raw' }), raw)
  assert.deepEqual(cards.readCardAssetExtension(raw), body.extensions.dsh_tavern)
  const changed = clone(ext.assetBindings); changed.boundPackIds = [] // private fork: revoke the package, not a card-local figure.
  const operations = cards.cardAssetRawOperations(raw, { assetBindings: changed })
  assert.equal(operations[0].path, (format === 'flat' ? '' : '/data') + '/extensions/dsh_tavern')
  const updated = preparation.update({ kind: 'card', card: workspace, patch: {}, rawOperations: operations })
  const exported = preparation.present({ card: updated.card, as: 'raw' }), expected = clone(raw)
  ;(format === 'flat' ? expected : expected.data).extensions.dsh_tavern.assetBindings = changed
  assert.deepEqual(exported, expected); assert.deepEqual(raw, original)
  const restored = preparation.update({ kind: 'card', card: updated.card, patch: {}, rawOperations: cards.cardAssetRawOperations(exported, { assetBindings: ext.assetBindings }) })
  assert.deepEqual(preparation.present({ card: restored.card, as: 'raw' }), raw)
  assert.deepEqual(preparation.present({ card: preparation.create({ kind: 'import', payload: exported }), as: 'raw' }), exported)
})
test('card helpers create extension through preparation without auto-binding or dropping other fields', () => {
  const preparation = createCardPreparation(), raw = { name: 'Fixture', foreign: true }, ext = cardExtension()
  const { schemaVersion, ...patch } = ext
  const workspace = preparation.create({ kind: 'import', payload: raw })
  const updated = preparation.update({ kind: 'card', card: workspace, patch: {}, rawOperations: cards.cardAssetRawOperations(raw, patch) })
  assert.deepEqual(preparation.present({ card: updated.card, as: 'raw' }), // private fork: first opt-in persists the card-centric switch defaults.
    { ...raw, extensions: { dsh_tavern: ext } })
  assert.equal(cards.readCardAssetExtension(raw), undefined)
})
// private fork: cards select packages; removed cast tables are never accepted as opaque data.
test('package selection and retired cast rejection are explicit', () => {
  const extension = cardExtension()
  cards.validateCardAssetExtension(extension) // Installation is deliberately not required.
  const unbound = clone(extension); unbound.assetBindings.boundPackIds = [OTHER_PACK_ID]
  cards.validateCardAssetExtension(unbound)
  unbound.assetBindings.boundPackIds = []; cards.validateCardAssetExtension(unbound)
  const alias = clone(extension); alias.assetBindings.characters = {stranger:{figure:null}}
  assert.throws(() => cards.validateCardAssetExtension(alias), code('UNKNOWN_FIELD'))
  const duplicate = clone(extension); duplicate.assetBindings.boundPackIds.push(PACK_ID)
  assert.throws(() => cards.validateCardAssetExtension(duplicate), code('DUPLICATE_ID'))
  for (const key of ['heightCm', 'stageForm', 'outfits', 'avatars', 'voice']) {
    const bad = clone(extension); bad.characters = {actor:{[key]:'override'}}
    assert.throws(() => cards.validateCardAssetExtension(bad), code('UNKNOWN_FIELD'))
  }
  assert.throws(() => cards.validateCardAssetExtension({ ...extension, schemaVersion: 2 }), code('UNSUPPORTED_SCHEMA_VERSION'))
})
test('sprite emotion renders, used mouthSets, masks, fractional coordinates and references are lossless', () => {
  const source = clone(fixture.sprites.school), before = packs.canonicalJson(source)
  assert.equal(packs.validateSpriteManifest(source), source)
  assert.equal(packs.canonicalJson(source), before)
  assert.deepEqual(packs.parseJson(before), source)
  assert.equal(packs.validateFigure(fixture.figures[FIGURE_ID]), fixture.figures[FIGURE_ID])
  assert.ok(packs.spriteResourcePaths(source).includes('assets/special-atlas.png'))
  const long = clone(source); long.emotions['special_'.repeat(15)] = long.emotions.crying; assert.throws(() => packs.validateSpriteManifest(long))
  const noPortrait = clone(source); delete noPortrait.emotions.calm.portrait; packs.validateSpriteManifest(noPortrait)
  const v1 = clone(source); v1.version = 1; delete v1.defaultState; v1.closedBehavior = 'restore-base except explicit surprise closed override'
  const beforeV1 = clone(v1); packs.validateSpriteManifest(v1); assert.deepEqual(v1, beforeV1)
  const bad = clone(source); bad.emotions.crying.mouthSet = 'missing'; assert.throws(() => packs.validateSpriteManifest(bad))
})
test('sprite validation rejects invalid coordinates, atlas overlap, missing states and resource maps', () => {
  for (const mutate of [s => { s.emotions.calm.stage.mouth.x = 20 }, s => { s.mouthAtlas.frames.closed.x = 0 }, s => { s.defaultState = 'missing' }, s => { s.emotions.crying={fallback:'missing'} }, s => { s.mouthSets = Object.fromEntries(Array.from({ length: 17 }, (_, i) => ['set' + i, s.mouthAtlas])) }]) {
    const sprite = clone(fixture.sprites.school); mutate(sprite); assert.throws(() => packs.validateSpriteManifest(sprite))
  }
  const bad = clone(fixture); delete bad.figures[FIGURE_ID].outfits[0].sprite.assets['assets/special-atlas.png']
  assert.throws(() => packs.validatePackDocuments(bad), code('FILE_CLOSURE_MISMATCH'))
})
// private fork: outfits use the same strict recall schema as all other pack assets.
test('optional outfit recall stores constant/keyword and synonyms on ordered outfits', () => {
  const figure=clone(fixture.figures[FIGURE_ID])
  packs.validateFigure(figure)
  for(const recall of [{mode:'constant',keywords:[]},{mode:'keyword',keywords:['School'],synonyms:{School:['Uniform']}}]) { // private fork: no priority
    figure.outfits[0].recall=recall
    packs.validateFigure(figure)
    assert.deepEqual(packs.parseJson(packs.canonicalJson(figure)).outfits[0].recall,recall)
  }
  // private fork (entry cleanup): an old priority is now the unknown field; a recall without keywords is still incomplete.
  for(const recall of [{mode:'constant',keywords:[],priority:0},{mode:'always',keywords:[]},{mode:'keyword'},{mode:'keyword',keywords:['xx','xx']},{mode:'keyword',keywords:[3]},{mode:'keyword',keywords:['School'],synonyms:{Missing:['Uniform']}}]) {
    figure.outfits[0].recall=recall
    assert.throws(()=>packs.validateFigure(figure))
  }
})
test('voice-only, ordered outfits, voice ownership and nonsecret model requirements', () => {
  const voiceOnly = { ...clone(fixture.figures[FIGURE_ID]), outfits: [] }; delete voiceOnly.heightCm
  packs.validateFigure(voiceOnly)
  for (const heightCm of [0, -1, Infinity]) assert.throws(() => packs.validateFigure({ ...fixture.figures[FIGURE_ID], heightCm }))
  const bad = clone(fixture.figures[FIGURE_ID]); bad.outfits[0].enabled = false
  packs.validateFigure(bad)
  bad.outfits[0].enabled = true; bad.outfits[0].voice = bad.voice
  assert.throws(() => packs.validateFigure(bad), code('UNKNOWN_FIELD'))
  // private fork: presets are embedded; old clone/service-preset descriptors are rejected.
  const voice = clone(voiceOnly.voice); voice.apiKey = 123
  assert.throws(() => packs.validateVoice(voice))
  assert.throws(() => packs.validateVoice({ kind: 'service-preset', engine: 'synthetic', languages: ['ja'], capability: 'speech', voiceName: 'fixture', params: { speed: 1 } }))
  packs.validateVoice({voice:'fixture-voice',language:'ja'})
})
test('manifest validates recall limits, explicit time tags, loop semantics and unknown legacy fields', () => {
  for (const mutate of [m => { m.assets[0].recall.keywords = ['x'] }, m => { m.assets[0].recall.priority = 101 }, m => { m.assets[0].recall.synonyms.other = ['alias'] }, m => { m.assets[0].directorNote = 'x'.repeat(301) }, m => { m.assets[5].layer = 'time' }, m => { m.assets[5].timeOfDay = 'day' }, m => { m.assets[3].loop = true }, m => { m.assets[0].core = true }, m => { m.assets[0].borrowedFrom = 'old-card' }]) {
    const manifest = clone(fixture.manifest); mutate(manifest); assert.throws(() => packs.validatePackManifest(manifest))
  }
  // private fork (owner 2026-10): 优先级 is removed — any stored recall.priority is an unknown field, even 0.
  const prioritized = clone(fixture.manifest); prioritized.assets[0].recall.priority = 0
  assert.throws(() => packs.validatePackManifest(prioritized), code('UNKNOWN_FIELD'))
  const bounded = clone(fixture.manifest); bounded.extensions = { vendor: { data: true } }; packs.validatePackManifest(bounded)
  bounded.extensions.vendor.text = 'x'.repeat(17000); assert.throws(() => packs.validatePackManifest(bounded), code('LIMIT_EXCEEDED'))
})
test('files reject root self-digest, undeclared namespaces, unsafe paths and conflicting MIME', () => {
  for (const path of ['manifest.json', '../outside', '/absolute', 'media/x:ads', 'credits/CON.txt', 'credits/a\\b.txt', 'unowned/file', 'credits', 'bundles/widget']) {
    const bad = clone(fixture.manifest); bad.files.push({ path, size: 1, sha256: 'a'.repeat(64) }); assert.throws(() => packs.validatePackManifest(bad))
  }
  const bad = clone(fixture.manifest); bad.files = bad.files.filter(file => file.path !== `figures/${FIGURE_ID}.json`); assert.throws(() => packs.validatePackManifest(bad))
  assert.throws(() => packs.validateBlob({ ext: 'png', mime: 'text/html', size: 1 }))
  assert.throws(() => packs.validateBlob({ ext: '.png', mime: 'image/png', size: 1 }))
  assert.throws(() => packs.validateBlob({ ext: 'jpg', mime: 'image/jpeg', size: 1 }))
  for (const paths of [['credits/A/x.txt', 'credits/a/y.txt'], ['credits/file', 'credits/file/nested.txt']]) assert.throws(() => packs.validateFiles(paths.map(path => ({ path, size: 1, sha256: 'a'.repeat(64) }))), code('INVALID_PATH'))
})
test('new inert stage state and scene selection require full typed refs and explicit time', () => {
  const background = { packId: PACK_ID, kind: 'backgrounds', assetId: 'classroom' }
  refs.validateSceneSelection({ background, timeOfDay: 'dusk' })
  assert.throws(() => refs.validateSceneSelection({ background }))
  assert.throws(() => refs.validateSceneSelection({ background, timeOfDay: null, timeLook: { ...background, kind: 'looks' } }))
  const state = { format: 'asset-packs-v1', scene: { background, timeOfDay: null, timeLook: null }, music: null, lighting: { time: { mode: 'auto', ref: null }, mood: null }, actors: { actor: { figure: { packId: PACK_ID, figureId: FIGURE_ID }, outfitKey: 'school' } }, soundscape: {}, widgets: {} }
  refs.validateAssetPackState(state)
  assert.throws(() => refs.validateAssetPackState({ ...state, format: 'stageDirectionV1' }))
  assert.throws(() => refs.validateAssetPackState({ ...state, music: 'classroom' }))
})

test('byte verification rejects missing, extra, corrupt and size-mismatched files', async () => {
  const missing = new Map(fixture.files); missing.delete(missing.keys().next().value)
  await assert.rejects(packs.verifyPackFiles(fixture.manifest, missing), code('FILE_CLOSURE_MISMATCH'))
  const extra = new Map(fixture.files); extra.set('credits/undeclared.txt', new Uint8Array([1]))
  await assert.rejects(packs.verifyPackFiles(fixture.manifest, extra), code('FILE_CLOSURE_MISMATCH'))
  const path = fixture.files.keys().next().value, bytes = Uint8Array.from(fixture.files.get(path)); bytes[0] ^= 1
  const corrupt = new Map(fixture.files); corrupt.set(path, bytes)
  await assert.rejects(packs.verifyPackFiles(fixture.manifest, corrupt), code('CONTENT_HASH_MISMATCH'))
  corrupt.set(path, bytes.slice(1))
  await assert.rejects(packs.verifyPackFiles(fixture.manifest, corrupt), code('FILE_CLOSURE_MISMATCH'))
})
test('empty packs are legal and unknown fields only survive in bounded extensions', async () => {
  const manifest = { format: 'dsh-asset-pack', schemaVersion: 1, id: PACK_ID, name: 'Empty', assets: [], figures: [], sprites: {}, bundles: {}, blobs: {}, files: [], contentHash: '0'.repeat(64) }
  manifest.contentHash = await packs.computeContentHash(manifest)
  await packs.verifyPackDocuments({ manifest, figures: {}, sprites: {} })
  assert.throws(() => packs.validatePackManifest({ ...manifest, formerNames: [] }), code('UNKNOWN_FIELD'))
  assert.throws(() => packs.validatePackManifest({ ...manifest, revision: 'local' }), code('UNKNOWN_FIELD'))
})
test('flat-mouth sprite keeps portable paths and the existing rig geometry without a new UUID', () => {
  const frames = Object.fromEntries(['closed', 'small', 'mid', 'open'].map(level => [level, 'mouth/' + level + '.png']))
  const sprite = { version: 1, kind: 'static-sprites', rig: { mouthSets: { normal: { canvas: [4, 4], pivot: [2, 2], frames } } }, emotions: {calm: { src: 'assets/still.png', talk: 'assets/talk.png', binding: { canvas: [8, 8], mouth: { set: 'normal', anchor: { x: 2, y: 2, scale: 1, rotation: 0 }, surface: 'patch', cover: { src: 'assets/patch.png', rect: [1, 1, 4, 4] } } } }} }
  const before = clone(sprite)
  packs.validateSpriteManifest(sprite); assert.deepEqual(sprite, before)
  assert.equal(packs.spriteResourcePaths(sprite).length, 7)
  const bad = clone(sprite); bad.emotions.calm.binding.mouth.anchor.scale = 8
  assert.throws(() => packs.validateSpriteManifest(bad))
})
test('widget documents retain bounded closed-schema and caps validation', () => {
  const widget = fixture.widgets.clock
  for (const mutate of [w => { delete w.stateSchema.additionalProperties }, w => { delete w.stateSchema.properties.label.maxLength }, w => { w.caps.active = 2 }, w => { w.samples = [{ unrecognized: true }] }, w => { w.stateSchema.remote = 'https://example.invalid' }]) {
    const bad = clone(widget); mutate(bad); assert.throws(() => forkValidateWidgetDocument(bad))
  }
})
// private fork: outfits have one full-resolution avatar set, not a compatibility alias.
test('figure contract rejects the removed parallel avatar set',()=>{
  const figure=clone(fixture.figures[FIGURE_ID]);figure.outfits[0].fullAvatars={...figure.outfits[0].avatars}
  assert.throws(()=>packs.validateFigure(figure),code('UNKNOWN_FIELD'))
})
