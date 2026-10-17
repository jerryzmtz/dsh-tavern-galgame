// private fork: isolated CG pack validation, closure and publication tests.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { syntheticPack, PACK_ID } from './fixtures/asset-packs/pack.mjs'
import { validateAsset, validatePackManifest } from '../tavern-plugin/packages/dsh-asset-library/src/asset-packs/index.js'
import { sealPack, verifyBytes, jsonBytes } from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/validation.js'
import { createAssetPackService } from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/service.js'
import { writeZip } from '../tavern-plugin/packages/dsh-asset-library/src/zip.js'

export async function cgFixture() {
  const pack = await syntheticPack(), background = pack.manifest.assets[0], [day,night]=Object.keys(pack.manifest.blobs).filter(hash=>pack.manifest.blobs[hash].mime==='image/png')
  const cg = {kind:'cg', id:'rice', name:'Rice', enabled:true, directorNote:'A meal at the desk.', recall:{mode:'keyword',keywords:['rice']},
    variants:{default:'base',entries:[{id:'base',name:'Eating',content:{description:'Eating rice.',media:day,focusHints:[{key:'bowl',label:'Bowl',x:0.5,y:0.65,zoom:1.3}]}},{id:'turn',name:'Turn',content:{description:'Turning to the door.',media:night}}]}}
  background.variants={default:'day',entries:[{id:'day',name:'Morning',content:{media:day}},{id:'night',name:'Moonlight',content:{media:night}}]}
  delete background.media;delete background.baseTime
  pack.manifest.assets=pack.manifest.assets.filter(asset=>asset.kind!=='looks')
  pack.manifest.assets.push(cg)
  await sealPack(pack.manifest, pack.files)
  return {pack,cg}
}

test('CG accepts 1..16 full-image variants and 8 normalized focuses, independently of emotion names', async () => {
  const {pack,cg} = await cgFixture()
  await verifyBytes(pack.manifest, pack.files)
  cg.variants.entries = Array.from({length:16},(_,i) => ({...cg.variants.entries[0],id:'v'+i,name:'\u56de\u5934'+i}))
  cg.variants.default = 'v0'
  cg.variants.entries[0].content.focusHints = Array.from({length:8},(_,i) => ({...cg.variants.entries[0].content.focusHints[0],key:'f'+i}))
  validateAsset(cg)
  cg.variants.entries = [cg.variants.entries[0]]; delete cg.variants.entries[0].content.focusHints
  validateAsset(cg)
})

test('CG strict fields, required descriptions, identities and focus bounds fail closed', async () => {
  const {cg} = await cgFixture()
  for (const mutate of [
    c => c.variants.entries = [], c => c.variants.entries = Array(17).fill(c.variants.entries[0]), c => c.variants.entries.push(c.variants.entries[0]),
    c => c.variants.default = 'missing', c => c.variants.entries[0].content.description = ' ', c => c.variants.entries[0].id = '__proto__',
    c => c.variants.entries[0].content.media = 'https://example.invalid/a.png', c => c.variants.entries[0].extra = true,
    c => c.variants.entries[0].content.focusHints[0].x = NaN, c => c.variants.entries[0].content.focusHints[0].y = 1.01, c => c.variants.entries[0].content.focusHints[0].zoom = 0.99,
    c => c.variants.entries[0].content.focusHints[0].key = 'full', c => c.variants.entries[0].content.focusHints.push(c.variants.entries[0].content.focusHints[0]),
    c => c.variants.entries[0].content.focusHints = Array(9).fill(c.variants.entries[0].content.focusHints[0]),
    c => c.media = c.variants.entries[0].content.media, c => c.soundscape = {},
  ]) { const next = structuredClone(cg); mutate(next); assert.throws(() => validateAsset(next)) }
})

test('CG verifies every image hash/MIME', async () => {
  const {pack} = await cgFixture()
  for (const mutate of [
    p => p.assets.at(-1).variants.entries[1].content.media = 'f'.repeat(64),
    p => p.assets.at(-1).variants.entries[1].content.media = p.assets.find(a => a.kind === 'music').media,
  ]) { const next = structuredClone(pack.manifest); mutate(next); assert.throws(() => validatePackManifest(next)) }
  const corrupt = new Map(pack.files), media = pack.manifest.assets.at(-1).variants.entries[0].content.media
  corrupt.set('media/'+media+'.png',Buffer.from('not an image'))
  await assert.rejects(verifyBytes(pack.manifest, corrupt))
})

test('CG copyItems copies images without figures and roundtrips export/keep-both', async t => {
  const root = await mkdtemp(join(tmpdir(),'cg-contract-')), service = createAssetPackService({assetRoot:join(root,'assets')})
  t.after(() => service.dispose()) // No recursive cleanup: this fixture never creates links.
  const {pack,cg} = await cgFixture()
  pack.manifest.assets.push({...structuredClone(cg),id:'rice-two'})
  await sealPack(pack.manifest, pack.files)
  const zip = join(root,'source.zip')
  await writeZip(zip,[{path:'manifest.json',data:jsonBytes(pack.manifest)},...[...pack.files].map(([path,data]) => ({path,data}))])
  const inspected = await service.inspectImport({bytes:await readFile(zip)})
  await service.applyImport({inspectionId:inspected.inspectionId,expectedRevision:inspected.expectedRevision,decision:'install'})
  const copied = await service.copyItems({sourcePackId:PACK_ID,itemRefs:[{kind:'cg',id:'rice-two'},{kind:'cg',id:'rice'}],target:{newPackName:'CG copies'}})
  const target = await service.getPackSnapshot({packId:copied.packId})
  assert.equal(target.manifest.figures.length,0) // private fork
  assert.equal(copied.copied.filter(row => row.kind === 'figures').length,0) // private fork
  for (const item of target.manifest.assets) {
    assert.deepEqual(item.variants,cg.variants); assert.deepEqual(item.variants.entries[0].content.focusHints,cg.variants.entries[0].content.focusHints)
  }
  const exported = await service.exportPack({packId:copied.packId,expectedRevision:target.revision})
  const preview = await service.inspectImport({bytes:exported.bytes,copy:true})
  const kept = await service.applyImport({inspectionId:preview.inspectionId,expectedRevision:preview.expectedRevision,decision:'keep-both'})
  const again = kept.snapshot
  assert.notEqual(again.manifest.id,target.manifest.id)
})
