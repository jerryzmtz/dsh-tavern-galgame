import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp, readFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {randomUUID} from 'node:crypto'
import {createAssetPackService} from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/service.js'
import {jsonBytes, sealPack} from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/validation.js'
import {computeContentHash, verifyPackHashes} from '../tavern-plugin/packages/dsh-asset-library/src/asset-packs/index.js'
import {writeZip} from '../tavern-plugin/packages/dsh-asset-library/src/zip.js'
import {syntheticPack, FIGURE_ID} from './fixtures/asset-packs/pack.mjs'

async function fixture(t, legacyVoice = false, options = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'pack-integrity-')), pack = await syntheticPack({legacyVoice})
  const service = createAssetPackService({assetRoot:path.join(root, 'assets'), ...options})
  t.after(() => service.dispose())
  async function inspect() {
    const file = path.join(root, randomUUID() + '.zip')
    await writeZip(file, [{path:'manifest.json', data:jsonBytes(pack.manifest)}, ...[...pack.files].map(([path,data]) => ({path,data}))])
    return service.inspectImport({bytes:await readFile(file)})
  }
  return {pack, service, inspect}
}

test('canonical ZIP import authenticates each media file only once', async t => {
  const f = await fixture(t), media = [...f.pack.files].filter(([name]) => name.startsWith('media/'))
  const digest = t.mock.method(globalThis.crypto.subtle, 'digest')
  const preview = await f.inspect()
  for (const [,bytes] of media) {
    const copies = [...f.pack.files.values()].filter(file => file.equals(bytes)).length
    assert.equal(digest.mock.calls.filter(call => Buffer.from(call.arguments[1]).equals(bytes)).length, copies)
  }
  assert.deepEqual(preview.incoming.manifest, f.pack.manifest)
})

for (const legacy of [false, true]) {
  test(`${legacy ? 'legacy' : 'canonical'} ZIP rejects changed bytes and forged bundle hashes before publication`, async t => {
    const f = await fixture(t, legacy), name = [...f.pack.files.keys()].find(name => name.startsWith('media/'))
    const bytes = f.pack.files.get(name), corrupt = Buffer.from(bytes); corrupt[corrupt.length - 1] ^= 1
    f.pack.files.set(name, corrupt)
    await assert.rejects(f.inspect(), {code:'CONTENT_HASH_MISMATCH'})
    f.pack.files.set(name, bytes)
    f.pack.manifest.bundles.widget.contentHash = '0'.repeat(64)
    f.pack.manifest.contentHash = await computeContentHash(f.pack.manifest)
    await assert.rejects(f.inspect(), {code:'CONTENT_HASH_MISMATCH'})
    assert.deepEqual(await f.service.listPacks(), [])
  })
}

test('authenticated legacy ZIP migrates voices without rehashing unchanged files', async t => {
  const f = await fixture(t, true), digest = t.mock.method(globalThis.crypto.subtle, 'digest')
  const preview = await f.inspect()
  for (const [name, bytes] of f.pack.files) if (!name.startsWith('figures/')) {
    const copies = [...f.pack.files.values()].filter(file => file.equals(bytes)).length
    assert.equal(digest.mock.calls.filter(call => Buffer.from(call.arguments[1]).equals(bytes)).length, copies, name)
  }
  assert.ok(preview.incoming.manifest.voiceLibrary)
  assert.equal(preview.incoming.figures[FIGURE_ID].voice.voice, 'v-' + FIGURE_ID)
  assert.equal(f.pack.figures[FIGURE_ID].voice.preset.kind, 'reference')
  await verifyPackHashes(preview.incoming.manifest)
  const figure = jsonBytes(preview.incoming.figures[FIGURE_ID])
  assert.equal(digest.mock.calls.filter(call => Buffer.from(call.arguments[1]).equals(figure)).length, 1)
})

test('voice source fallback reseals only the changed figure document', async t => {
  const f = await fixture(t, false, {voiceSourceAvailable:async source => source.provider === 'fish-audio'})
  f.pack.figures[FIGURE_ID].voice.source = 'local'
  f.pack.files.set('figures/' + FIGURE_ID + '.json', jsonBytes(f.pack.figures[FIGURE_ID]))
  await sealPack(f.pack.manifest, f.pack.files)
  const digest = t.mock.method(globalThis.crypto.subtle, 'digest'), preview = await f.inspect()
  assert.equal(preview.voiceChanges[0].to, 'fish')
  assert.equal(preview.incoming.figures[FIGURE_ID].voice.source, 'fish')
  for (const [name, bytes] of f.pack.files) if (!name.startsWith('figures/')) {
    const copies = [...f.pack.files.values()].filter(file => file.equals(bytes)).length
    assert.equal(digest.mock.calls.filter(call => Buffer.from(call.arguments[1]).equals(bytes)).length, copies, name)
  }
  await verifyPackHashes(preview.incoming.manifest)
  await assert.rejects(f.service.applyImport({inspectionId:preview.inspectionId, expectedRevision:null, decision:'install', acceptScriptRisk:true}), {code:'VOICE_FALLBACK_CONFIRMATION_REQUIRED'})
  assert.deepEqual(await f.service.listPacks(), [])
})

test('authenticated ZIP composes existing voice and figure-name migrations before resealing', async t => {
  const f = await fixture(t, true), figure = f.pack.figures[FIGURE_ID]
  figure.recall = {...figure.recall, keywords:['Teacher'], synonyms:{Teacher:['Sensei']}}
  f.pack.files.set('figures/' + FIGURE_ID + '.json', jsonBytes(figure))
  await sealPack(f.pack.manifest, f.pack.files)
  const preview = await f.inspect(), incoming = preview.incoming.figures[FIGURE_ID]
  assert.deepEqual(incoming.aliases, [...figure.aliases, 'Teacher', 'Sensei'])
  assert.equal(Object.hasOwn(incoming.recall, 'keywords'), false)
  assert.equal(Object.hasOwn(incoming.recall, 'synonyms'), false)
  assert.equal(incoming.voice.voice, 'v-' + FIGURE_ID)
  assert.ok(preview.incoming.manifest.voiceLibrary.voices[incoming.voice.voice])
  await verifyPackHashes(preview.incoming.manifest)
  assert.equal(figure.voice.preset.kind, 'reference')
  assert.deepEqual(figure.recall.keywords, ['Teacher'])
})

// A model alias may trigger legacy conversion again, but voice IDs are pack-owned author data.
test('same-UUID update import preserves unchanged voice entries and explicit emotion IDs', async t => {
  const f = await fixture(t, false, {voiceSourceAvailable:async()=>true});
  const preview = await f.inspect();
  const initial = (await f.service.applyImport({inspectionId:preview.inspectionId,expectedRevision:null,decision:'install',acceptScriptRisk:true})).snapshot;
  const figure = structuredClone(initial.figures[FIGURE_ID]);
  const library = structuredClone(initial.manifest.voiceLibrary), voice = library.voices[figure.voice.voice];
  for (const row of figure.emotions) {
    const id = row.id + '-' + FIGURE_ID;
    voice.emotions[id] = {...voice.emotions[row.voiceEmotion]};
    row.voiceEmotion = id;
  }
  figure.outfits[1].live2d.emotionMap.neutral = {expression:'smile'};
  const authored = (await f.service.patchPack({packId:f.pack.manifest.id,expectedRevision:initial.revision,patch:{voiceLibrary:library},fileUpdates:new Map([['figures/'+FIGURE_ID+'.json',jsonBytes(figure)]])})).snapshot;
  const archive = await f.service.exportPack({packId:f.pack.manifest.id,expectedRevision:authored.revision});
  const local = (await f.service.patchPack({packId:f.pack.manifest.id,expectedRevision:authored.revision,patch:{name:'Local name'}})).snapshot;
  const incoming = await f.service.inspectImport({bytes:archive.bytes});
  assert.ok(incoming.choices.includes('update'));
  assert.deepEqual(incoming.incoming.manifest.voiceLibrary,library);
  assert.deepEqual(incoming.incoming.figures[FIGURE_ID].emotions.map(e=>e.voiceEmotion),figure.emotions.map(e=>e.voiceEmotion));
  const updated = (await f.service.applyImport({inspectionId:incoming.inspectionId,expectedRevision:local.revision,decision:'update',acceptScriptRisk:true})).snapshot;
  assert.deepEqual(updated.manifest.voiceLibrary,library);
  assert.deepEqual(updated.figures[FIGURE_ID].emotions.map(e=>e.voiceEmotion),figure.emotions.map(e=>e.voiceEmotion));
});
