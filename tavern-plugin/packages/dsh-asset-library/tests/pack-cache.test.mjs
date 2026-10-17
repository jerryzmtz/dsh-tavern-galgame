import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import os from 'node:os'
import { mkdtemp, rm, readFile, writeFile, lstat, utimes } from 'node:fs/promises'
import { createAssetPackService } from '../src/pack-v2/service.js'
import { sealPack, jsonBytes } from '../src/pack-v2/validation.js'
import { writeZip } from '../src/zip.js'
import { syntheticPack, PACK_ID, FIGURE_ID, digest } from '../../../../tests/fixtures/asset-packs/pack.mjs'
async function fixture(t, fileCount = 0) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pack-cache-')), assetRoot = path.join(root, 'assets')
  let decodes = 0, inspections = 0, authorizations = 0, unsafe = false
  const service = createAssetPackService({assetRoot, decodeMedia:async () => { decodes++; return {width:1,height:1} },
    inspectPath:async file => { inspections++; const info = await lstat(file); if (unsafe && file.endsWith('.webp')) info.isSymbolicLink = () => true; return info },
    authorizeLease:async () => { authorizations++; return true }})
  t.after(async () => { await service.dispose(); await rm(root, {recursive:true,force:true}) })
  const pack = await syntheticPack(), bytes = Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA','base64'), hash = digest(bytes)
  pack.manifest.blobs[hash] = {ext:'webp',mime:'image/webp',size:bytes.length}; pack.files.set(`media/${hash}.webp`, bytes)
  // private fork: installed images must be referenced, never loose staging blobs.
  pack.manifest.assets.push({...pack.manifest.assets[0],id:'cache-image',name:'Cache image',variants:{default:'webp',entries:[{id:'webp',name:'WebP',content:{media:hash}}]}})
  // private fork: exercise a realistic large pack without real user assets.
  while (pack.files.size < fileCount) {
    const name = `bundles/casual/fixture-${pack.files.size}.txt`
    pack.files.set(name, Buffer.from('fixture'))
  }
  await sealPack(pack.manifest,pack.files)
  const zip = path.join(root,'test.zip')
  await writeZip(zip,[{path:'manifest.json',data:jsonBytes(pack.manifest)},...[...pack.files].map(([path,data]) => ({path,data}))])
  const preview = await service.inspectImport({bytes:await readFile(zip)})
  await service.applyImport({inspectionId:preview.inspectionId,expectedRevision:null,decision:'install'})
  return {service,assetRoot,hash, get decodes() {return decodes}, get inspections() {return inspections}, get authorizations() {return authorizations}, unsafe() {unsafe = true}}
}
test('warm catalogues reuse validated metadata, batch each pack once and never issue leases', async t => {
  const f = await fixture(t)
  await f.service.listPacks()
  const count = f.decodes
  const ref = {packId:PACK_ID,figureId:FIGURE_ID}
  let before = f.inspections
  await f.service.resolveFigures({refs:[ref]})
  const single = f.inspections - before
  before = f.inspections
  const resolved = await f.service.resolveFigures({refs:Array.from({length:100}, () => ref)})
  assert.equal(f.inspections - before,single)
  assert.equal(resolved.length,100)
  // private fork: resolved voices are pack-owned voiceSpec, not figure-inline presets.
  assert.ok(resolved[0].voiceSpec.sources.fish.references[1].text)
  await f.service.getPackSnapshot({packId:PACK_ID}); await f.service.listPacks()
  assert.equal(f.decodes,count)
  assert.equal(f.authorizations,0)
  resolved[0].value.name = 'caller mutation'
  assert.notEqual((await f.service.getPackSnapshot({packId:PACK_ID})).figures[FIGURE_ID].name, 'caller mutation')
})
// private fork: stored transcripts are trusted; reads never rehash previously installed data.
test('warm inline transcripts stay cached; fresh reads reject unparseable JSON', async t => {
  const f = await fixture(t); await f.service.listPacks()
  const file = path.join(f.assetRoot,'packs',PACK_ID,'figures',FIGURE_ID+'.json'), before = await lstat(file), bytes = await readFile(file) // private fork: cached figure binding
  bytes[0] ^= 1; await writeFile(file,bytes); await utimes(file,before.atime,before.mtime)
  const refs = [{packId:PACK_ID,figureId:FIGURE_ID}]
  assert.ok((await f.service.resolveFigures({refs}))[0].voiceSpec.sources.fish.references[1].text)
  const fresh = createAssetPackService({assetRoot:f.assetRoot,decodeMedia:async () => ({width:1,height:1})})
  t.after(() => fresh.dispose())
  await assert.rejects(fresh.resolveFigures({refs}))
})
test('cache hits still reject reparse paths; lease reads only after validation and checks bytes', async t => {
  const f = await fixture(t); await f.service.listPacks()
  const count = f.decodes
  const lease = await f.service.leaseMedia({packId:PACK_ID,hash:f.hash,origin:'http://localhost',scope:'test'})
  const response = await f.service.respondLease({ticket:lease.ticket,resource:'media',request:new Request('http://localhost'+lease.url)})
  assert.equal(response.status,200); assert.ok((await response.arrayBuffer()).byteLength)
  assert.equal(f.decodes,count)
  f.unsafe()
  await assert.rejects(f.service.respondLease({ticket:lease.ticket,resource:'media',request:new Request('http://localhost'+lease.url)}), {code:'INVALID_PATH'})
})
test('list isolates a corrupt pack while reads and mutations remain fail-closed', async t => {
  const f = await fixture(t)
  const good = (await f.service.createPack({name:'Healthy',expectedRevision:null})).snapshot
  await writeFile(path.join(f.assetRoot,'packs',PACK_ID,'manifest.json'), '{broken')
  const entries = await f.service.listPacks()
  assert.equal(entries.length, 2)
  assert.equal(entries.find(p => p.manifest)?.manifest.id, good.manifest.id)
  const broken = entries.find(p => p.error)
  assert.equal(broken.packId, PACK_ID)
  assert.ok(broken.error.code && broken.error.message)
  await assert.rejects(f.service.getPackSnapshot({packId:PACK_ID}))
  await assert.rejects(f.service.createPack({name:'Must not bypass identity checks',expectedRevision:null}))
})
test('another service publication invalidates metadata and old leases', async t => {
  const f = await fixture(t), second = createAssetPackService({assetRoot:f.assetRoot,decodeMedia:async () => ({width:1,height:1})})
  t.after(() => second.dispose())
  const snapshot = await f.service.getPackSnapshot({packId:PACK_ID})
  const lease = await f.service.leaseMedia({packId:PACK_ID,hash:f.hash,origin:'http://localhost',scope:'test'})
  await second.patchPack({packId:PACK_ID,expectedRevision:snapshot.revision,patch:{name:'New revision'}})
  assert.equal((await f.service.listPacks())[0].manifest.name,'New revision')
  await assert.rejects(f.service.respondLease({ticket:lease.ticket,resource:'media',request:new Request('http://localhost'+lease.url)}), {code:'REVISION_CONFLICT'})
})

// private fork: a warm texture request must not scan 1,700 unrelated files.
test('1700-file pack warm Live2D reads stay under 100ms and republish invalidates', async t => {
  const f = await fixture(t, 1700)
  const lease = await f.service.leaseBundle({packId:PACK_ID,bundleKey:'casual',origin:'http://localhost',scope:'test'})
  const read = () => f.service.respondLease({ticket:lease.ticket,resource:'textures/face.png',request:new Request(new URL('textures/face.png','http://localhost'+lease.url))})
  await read()
  const times = [], before = f.inspections
  for (let i = 0; i < 5; i++) {
    const start = performance.now(), response = await read()
    assert.equal(response.status,200); await response.arrayBuffer()
    times.push(performance.now() - start)
  }
  t.diagnostic(`warm Live2D lease ms: ${times.map(n => n.toFixed(2)).join(', ')}`)
  assert.ok(Math.max(...times) < 100, `warm reads: ${times}`)
  assert.ok(f.inspections - before < 1000, 'no whole-pack traversal')
  const snapshot = await f.service.getPackSnapshot({packId:PACK_ID})
  await f.service.patchPack({packId:PACK_ID,expectedRevision:snapshot.revision,patch:{name:'Republished'}})
  await assert.rejects(read(), {code:'REVISION_CONFLICT'})
  const current = await f.service.getPackSnapshot({packId:PACK_ID})
  assert.equal(current.manifest.name,'Republished')
  const fresh = await f.service.leaseBundle({packId:PACK_ID,bundleKey:'casual',origin:'http://localhost',scope:'test'})
  await f.service.removePack({packId:PACK_ID,expectedRevision:current.revision})
  await assert.rejects(f.service.respondLease({ticket:fresh.ticket,resource:'model.model3.json',request:new Request('http://localhost'+fresh.url)}), {code:'REVISION_CONFLICT'})
})

// private fork: delayed file I/O must not block unrelated metadata operations.
test('lease byte reads release the shared storage queue', async t => {
  const f = await fixture(t)
  let delay = false, entered
  const waiting = new Promise(resolve => { entered = resolve })
  let release
  const gate = new Promise(resolve => { release = resolve })
  const service = createAssetPackService({assetRoot:f.assetRoot,decodeMedia:async () => ({width:1,height:1}),authorizeLease:async () => true,
    inspectPath:async file => { if (delay && file.endsWith('.webp')) { entered(); await gate } return lstat(file) }})
  t.after(() => service.dispose())
  const lease = await service.leaseMedia({packId:PACK_ID,hash:f.hash,origin:'http://localhost',scope:'test'})
  delay = true
  const read = service.respondLease({ticket:lease.ticket,resource:'media',request:new Request('http://localhost'+lease.url)})
  try {
    await waiting
    const result = await Promise.race([f.service.getPackSnapshot({packId:PACK_ID}),new Promise(resolve => setTimeout(() => resolve(null),1000))])
    assert.ok(result, 'metadata must finish while the lease file is blocked')
  } finally { release(); await read }
})
