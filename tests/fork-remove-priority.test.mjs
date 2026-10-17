// private fork (entry cleanup, owner 2026-10): 优先级 (recall.priority) is removed everywhere. Writes reject it as
// UNKNOWN_FIELD; old archives still import (ingress drops it once); installed packs migrate once, offline, with CAS.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {validateAsset} from '../tavern-plugin/packages/dsh-asset-library/src/asset-packs/manifest.js'
import {validateFigure} from '../tavern-plugin/packages/dsh-asset-library/src/asset-packs/figure.js'
import {migrateRecallPriorityManifest, migrateRecallPriorityFigure, migrateRecallPriorityBaselines} from '../tavern-plugin/packages/dsh-asset-library/src/asset-packs/recall-priority.js'
import {createAssetPackService} from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/service.js'
import {sealPack, jsonBytes} from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/validation.js'
import {writeZip} from '../tavern-plugin/packages/dsh-asset-library/src/zip.js'
import {syntheticPack, PACK_ID, FIGURE_ID} from './fixtures/asset-packs/pack.mjs'
import legacy from '../tavern-plugin/shared/keyword-catalogue.cjs'

const unknown = error => error.code === 'UNKNOWN_FIELD'
// Old documents: every entry, the figure and its outfits carry priority.
function prioritize(pack) {
  for (const asset of pack.manifest.assets) asset.recall = {...asset.recall, priority:0}
  const figure = pack.figures[FIGURE_ID]
  figure.recall = {...figure.recall, priority:3}
  figure.outfits = figure.outfits.map(outfit => outfit.recall ? {...outfit, recall:{...outfit.recall, priority:-2}} : outfit)
  pack.files.set('figures/'+FIGURE_ID+'.json', jsonBytes(figure))
  return pack
}
const hasPriority = value => JSON.stringify(value).includes('"priority"')
async function tempRoot(name) {
  const base = fileURLToPath(new URL('../.tmp/', import.meta.url)); await fs.mkdir(base, {recursive:true})
  return fs.mkdtemp(path.join(base, name))
}

test('schema: priority is an unknown field on entries, figures and outfits (no compatibility reader)', async () => {
  const pack = await syntheticPack(), asset = pack.manifest.assets[0], figure = pack.figures[FIGURE_ID]
  validateAsset(asset); validateFigure(figure)
  assert.throws(() => validateAsset({...asset, recall:{...asset.recall, priority:0}}), unknown)
  assert.throws(() => validateFigure({...figure, recall:{...figure.recall, priority:0}}), unknown)
  assert.throws(() => validateFigure({...figure, outfits:figure.outfits.map(o => ({...o, recall:{mode:'keyword', keywords:[], priority:0}}))}), unknown)
})

test('the one conversion strips entries, figure, outfits and publisher baselines, and is idempotent', async () => {
  const pack = prioritize(await syntheticPack())
  const manifest = migrateRecallPriorityManifest(pack.manifest), figure = migrateRecallPriorityFigure(pack.figures[FIGURE_ID])
  assert.equal(hasPriority(manifest.assets), false); assert.equal(hasPriority(figure), false)
  assert.equal(migrateRecallPriorityManifest(manifest), manifest); assert.equal(migrateRecallPriorityFigure(figure), figure)
  validateFigure(figure); manifest.assets.forEach(asset => validateAsset(asset))
  const local = {revision:'r', distribution:{baseMetadata:{'asset/backgrounds/x':{enabled:true, recall:{mode:'keyword', keywords:[], priority:5}}, ['figure/'+FIGURE_ID]:{recall:{mode:'constant', priority:1}}}}}
  const next = migrateRecallPriorityBaselines(local)
  assert.equal(hasPriority(next), false); assert.equal(hasPriority(local), true, 'input is not mutated')
  assert.equal(migrateRecallPriorityBaselines(next), next)
})

test('archive ingress: a pack exported before the removal still imports, without priority', async t => {
  const root = await tempRoot('remove-priority-import-')
  const service = createAssetPackService({assetRoot:path.join(root, 'assets'), voiceSourceAvailable:async () => true}); t.after(() => service.dispose())
  const pack = prioritize(await syntheticPack()); await sealPack(pack.manifest, pack.files)
  const zip = path.join(root, 'old.zip')
  await writeZip(zip, [{path:'manifest.json', data:jsonBytes(pack.manifest)}, ...[...pack.files].map(([path, data]) => ({path, data}))])
  const preview = await service.inspectImport({bytes:await fs.readFile(zip)})
  assert.equal(hasPriority(preview.incoming.manifest.assets), false); assert.equal(hasPriority(preview.incoming.figures), false)
  const installed = await service.applyImport({inspectionId:preview.inspectionId, expectedRevision:preview.expectedRevision, decision:'install'})
  assert.equal(hasPriority(installed.snapshot.manifest), false); assert.equal(hasPriority(installed.snapshot.figures), false)
  const assets = structuredClone(installed.snapshot.manifest.assets); assets[0].recall.priority = 0
  await assert.rejects(service.patchPack({packId:PACK_ID, expectedRevision:installed.snapshot.revision, patch:{assets}}), unknown)
})

test('offline migration of an installed pack: CAS, one metadata publication, baseline included, then a no-op', async t => {
  const root = await tempRoot('remove-priority-migrate-'), pack = prioritize(await syntheticPack())
  await sealPack(pack.manifest, pack.files)
  for (const [name, bytes] of new Map([...pack.files, ['manifest.json', jsonBytes(pack.manifest)]])) {
    const file = path.join(root, 'packs', PACK_ID, name); await fs.mkdir(path.dirname(file), {recursive:true}); await fs.writeFile(file, bytes)
  }
  await fs.mkdir(path.join(root, 'local'))
  const localFile = path.join(root, 'local', PACK_ID+'.json'), key = 'asset/'+pack.manifest.assets[0].kind+'/'+pack.manifest.assets[0].id
  await fs.writeFile(localFile, JSON.stringify({revision:'old', retired:[], installedAt:1, updatedAt:1, distribution:{baseMetadata:{[key]:{enabled:true, recall:pack.manifest.assets[0].recall}}}}))
  const service = createAssetPackService({assetRoot:root, decodeMedia:() => { throw Error('Metadata migration decoded media') }}); t.after(() => service.dispose())
  const before = await service.getPackSnapshot({packId:PACK_ID})
  assert.equal(hasPriority(before.manifest.assets), true, 'reads parse stored documents without validating them')
  await assert.rejects(service.migrateRecallPriority({packId:PACK_ID, expectedRevision:'wrong'}), error => error.code === 'REVISION_CONFLICT')
  const result = await service.migrateRecallPriority({packId:PACK_ID, expectedRevision:'old'})
  assert.equal(result.status, 'updated')
  assert.equal(hasPriority(result.snapshot.manifest), false); assert.equal(hasPriority(result.snapshot.figures), false)
  const local = JSON.parse(await fs.readFile(localFile, 'utf8'))
  assert.equal(hasPriority(local), false); assert.equal(local.revision, result.snapshot.revision)
  assert.equal((await service.migrateRecallPriority({packId:PACK_ID, expectedRevision:local.revision})).status, 'noop')
})

test('legacy keyword catalogue: priority is dropped, never an order', () => {
  assert.equal(legacy.RECALL_FIELDS.includes('priority'), false)
  assert.deepEqual(legacy.normalizeRecallMetadata({keywords:['教室'], priority:50}), {keywords:['教室']})
  const rows = [{id:'b', name:'教室', priority:100, url:'b'}, {id:'a', name:'教室二', url:'a'}]
  const {selected} = legacy.selectDirectorCatalogue({full:{scenes:rows}, units:['教室']})
  assert.equal(selected.scenes.some(row => Object.hasOwn(row, 'priority')), false)
})
