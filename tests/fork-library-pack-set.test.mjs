// private fork (library export, owner 2026-10): the 素材库's batch export is one 素材包合集 ZIP; 「获取素材包」 installs it pack
// by pack (a local file or a link), each through its own ordinary preview and applyImport. One hash per transfer archive.
import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {Readable} from 'node:stream'
import {createAssetPackService} from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/service.js'
import {createAssetPackTransport} from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/transport.js'
import {jsonBytes} from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/validation.js'
import {PACK_SET_ROOT} from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/pack-set.js'
import {partitionPackSets, packSetZipSize, COLLECTION_BYTES} from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/pack-set-partition.js'
import {writeZip, openZip} from '../tavern-plugin/packages/dsh-asset-library/src/zip.js'
import {syntheticPack, digest, PACK_ID} from './fixtures/asset-packs/pack.mjs'

async function host(t, options = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'pack-set-')), served = new Map(), fetched = []
  const catalogueNetwork = async url => {fetched.push(url); const bytes = served.get(new URL(url).pathname); return bytes ? {status:200, headers:{'content-length':String(bytes.length)}, body:Readable.from([bytes]), url} : {status:404, headers:{}, body:Readable.from([]), url}}
  const service = createAssetPackService({assetRoot:path.join(root, 'assets'), catalogueNetwork, ...options})
  t.after(async () => { await service.dispose(); await rm(root, {recursive:true, force:true}) })
  const zip = async entries => { const file = path.join(root, crypto.randomUUID() + '.zip'); await writeZip(file, entries); return readFile(file) }
  return {root, service, served, fetched, zip}
}
async function seed(f) {
  const pack = await syntheticPack()
  const p = await f.service.inspectImport({bytes:await f.zip([{path:'manifest.json', data:jsonBytes(pack.manifest)}, ...[...pack.files].map(([path, data]) => ({path, data}))])})
  const first = (await f.service.applyImport({inspectionId:p.inspectionId, expectedRevision:null, decision:'install', acceptScriptRisk:true})).snapshot
  const second = (await f.service.createPack({name:'Second pack', expectedRevision:null})).snapshot
  return [first, second]
}
const writes = packs => packs.map(p => ({packId:p.manifest.id, expectedRevision:p.revision}))
async function entries(f, bytes) {
  const file = path.join(f.root, crypto.randomUUID() + '.zip'); await writeFile(file, bytes)
  const zip = await openZip(file), out = new Map()
  for (const entry of zip.entries) if (!entry.directory) out.set(entry.path, await zip.read(entry))
  return out
}
const apply = (f, preview, decision) => f.service.applyImport({inspectionId:preview.inspectionId, expectedRevision:preview.expectedRevision, decision, acceptScriptRisk:true})

test('batch export writes one 素材包合集 of whole packs; a single-pack call stays exportPack', async t => {
  const f = await host(t), packs = await seed(f)
  await assert.rejects(async () => f.service.exportPacks({packs:writes(packs.slice(0, 1))}), /Two or more packs/)
  await assert.rejects(async () => f.service.exportPacks({packs:[...writes(packs), ...writes(packs.slice(0, 1))]}), {code:'DUPLICATE_ID'})
  await assert.rejects(f.service.exportPacks({packs:[{...writes(packs)[0], expectedRevision:'stale'}, writes(packs)[1]]}), {code:'REVISION_CONFLICT'})
  const result = await f.service.exportPacks({packs:writes(packs)})
  assert.equal(result.filename, 'asset-packs-2.zip'); assert.deepEqual(result.warnings, [])
  assert.deepEqual(result.packs.map(p => p.packId), packs.map(p => p.manifest.id))
  const files = await entries(f, result.bytes), root = JSON.parse(files.get(PACK_SET_ROOT))
  assert.equal(root.format, 'dsh-tavern-pack-set'); assert.deepEqual(root.packs.map(p => p.packId), packs.map(p => p.manifest.id))
  assert.ok(root.files.every(item => Object.keys(item).sort().join() === 'path,size'), 'the outer list is a path/size closure, no per-file digest')
  for (const pack of packs) assert.equal(JSON.parse(files.get(`packs/${pack.manifest.id}/manifest.json`)).contentHash, pack.manifest.contentHash)
  assert.equal(files.has('manifest.json'), false)
})

test('a 素材包合集 file imports pack by pack: one preview each, one upload hash, the set counts as one preview', async t => {
  const source = await host(t), packs = await seed(source), {bytes} = await source.service.exportPacks({packs:writes(packs)})
  const f = await host(t, {limits:{previews:2}})
  const set = await f.service.inspectImport({bytes})
  assert.equal(set.kind, 'pack-set'); assert.equal(set.packs.length, 2)
  assert.deepEqual(set.packs.map(p => p.packId), packs.map(p => p.manifest.id))
  assert.ok(set.packs.every(p => p.uploadHash === digest(bytes) && p.uploadHash === set.uploadHash), 'one hash for the whole transfer')
  assert.ok(set.packs.every(p => p.choices.includes('install') && p.inspectionId !== set.inspectionId))
  assert.deepEqual(set.packs.map(p => p.incoming.manifest.name), packs.map(p => p.manifest.name), 'each pack keeps its own install sheet data')
  // Two sets (four packs) fit a two-preview budget: a set is one inspection.
  const again = await f.service.inspectImport({bytes}); assert.equal(again.kind, 'pack-set')
  await assert.rejects(f.service.inspectImport({bytes}), {code:'LIMIT_EXCEEDED'})
  for (const p of again.packs) await apply(f, p, 'cancel')
  const installed = await apply(f, set.packs[0], 'install'); assert.equal(installed.snapshot.manifest.id, PACK_ID)
  assert.equal((await apply(f, set.packs[1], 'cancel')).status, 'cancelled')
  assert.deepEqual((await f.service.listPacks()).map(p => p.manifest.id), [PACK_ID])
  // The per-pack checks are unchanged: an expired / applied preview cannot be applied twice.
  await assert.rejects(apply(f, set.packs[0], 'install'), {code:'ASSET_UNAVAILABLE'})
})

test('a 素材包合集 with undeclared, resized or misidentified content is rejected before any preview', async t => {
  const source = await host(t), packs = await seed(source), {bytes} = await source.service.exportPacks({packs:writes(packs)})
  const files = await entries(source, bytes), f = await host(t)
  const rezip = map => f.zip([...map].map(([path, data]) => ({path, data})))
  await assert.rejects(f.service.inspectImport({bytes:await rezip(new Map([...files, ['packs/extra.txt', Buffer.from('x')]]))}), {code:'FILE_CLOSURE_MISMATCH'})
  const root = JSON.parse(files.get(PACK_SET_ROOT)), wrong = {...root, packs:root.packs.map((p, i) => i ? p : {...p, contentHash:'0'.repeat(64)})}
  await assert.rejects(f.service.inspectImport({bytes:await rezip(new Map([...files, [PACK_SET_ROOT, jsonBytes(wrong)]]))}), {code:'FILE_CLOSURE_MISMATCH'})
  const first = `packs/${packs[0].manifest.id}/credits/license.txt`
  await assert.rejects(f.service.inspectImport({bytes:await rezip(new Map([...files, [first, Buffer.from('Tampered! test data. CC0.')]]))}), {code:'CONTENT_HASH_MISMATCH'}, 'each pack is authenticated against its own manifest')
  assert.deepEqual(await f.service.listPacks(), [])
})

test('a link to a 素材包合集 downloads once and the job finishes after every pack was applied or cancelled', async t => {
  const source = await host(t), packs = await seed(source), {bytes} = await source.service.exportPacks({packs:writes(packs)})
  const f = await host(t); f.served.set('/set.zip', bytes)
  const wait = async jobId => { for (let i = 0; i < 500; i++) { const j = await f.service.getPackDownload({jobId}); if (!['queued','downloading','verifying'].includes(j.state)) return j; await new Promise(r => setTimeout(r, 10)) } throw Error('job did not finish') }
  const {jobId} = await f.service.startPackDownload({url:'https://packs.test/set.zip'})
  let job = await wait(jobId)
  assert.equal(job.state, 'ready', JSON.stringify(job.error)); assert.equal(job.inspection.kind, 'pack-set'); assert.equal(f.fetched.length, 1)
  assert.ok(job.inspection.packs.every(p => p.uploadHash === digest(bytes) && p.distribution.archiveSha256 === digest(bytes)), 'the download is hashed once, as a whole')
  const [a, b] = job.inspection.packs
  assert.equal((await apply(f, a, 'install')).snapshot.manifest.id, PACK_ID)
  job = await f.service.getPackDownload({jobId}); assert.equal(job.state, 'ready'); assert.equal(job.inspection.packs[0].done, 'applied')
  await apply(f, b, 'cancel')
  job = await f.service.getPackDownload({jobId}); assert.equal(job.state, 'completed'); assert.equal(job.inspection, undefined); assert.equal(job.result.snapshot.manifest.id, PACK_ID)
  // Cancelling a pending set download discards every pack still waiting.
  const second = (await f.service.startPackDownload({url:'https://packs.test/set.zip'})).jobId, pending = (await wait(second)).inspection
  await f.service.controlPackDownload({jobId:second, action:'cancel'})
  await assert.rejects(apply(f, pending.packs[0], 'update'), {code:'ASSET_UNAVAILABLE'})
})

test('the browser carrier allows exportPacks with its one field and the host advertises pack-set', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'pack-set-carrier-')), transport = createAssetPackTransport({assetRoot:path.join(root, 'assets')})
  t.after(async () => { await transport.service.dispose(); await rm(root, {recursive:true, force:true}) })
  assert.ok(transport.service.capabilities.includes('pack-set'))
  const client = await readFile(new URL('../tavern-plugin/src/client/fork-pack-transport.js', import.meta.url), 'utf8')
  assert.match(client, /'exportPack','exportPacks'/)
})

test('private fork: greedy volumes count ZIP overhead and isolate packs beyond 512 MiB without allocating media', () => {
  const fake = (i, mb) => ({manifest:{id:`00000000-0000-4000-8000-${String(i).padStart(12,'0')}`,contentHash:'a'.repeat(64)}, files:new Map([['media/fake.png',{length:mb*1024**2}]])})
  const packs = [fake(1,200),fake(2,300),fake(3,200),fake(4,300),fake(5,600)]
  const groups = partitionPackSets(packs)
  assert.equal(groups.length, 3) // private fork
  assert.equal(groups[0].length, 1) // private fork
  assert.equal(groups[0][0], packs[4]) // private fork
  assert.ok(groups.slice(1).every(group => group.length === 2 && packSetZipSize(group) <= COLLECTION_BYTES)) // private fork
  assert.equal(new Set(groups.flat()).size, packs.length) // private fork
  const exact = packSetZipSize(packs.slice(0,2))
  assert.equal(partitionPackSets(packs.slice(0,2),{bytes:exact}).length,1) // private fork
  assert.equal(partitionPackSets(packs.slice(0,2),{bytes:exact-1}).length,2) // private fork
})

test('private fork: generated oversized singleton and split volumes round trip through ordinary import confirmation', async t => {
  const source = await host(t,{collectionBytes:1000}), packs = await seed(source)
  const result = await source.service.exportPacks({packs:writes(packs)})
  assert.equal(result.archives.length,2) // private fork
  assert.deepEqual(result.archives.map(a=>a.filename),['素材包合集-1of2.zip','素材包合集-2of2.zip']) // private fork
  assert.ok(result.archives[0].bytes.length > 1000) // private fork: an oversized pack is not rejected or divided.
  const target = await host(t)
  for (const archive of result.archives) {
    const preview = await target.service.inspectImport({bytes:archive.bytes})
    assert.equal(preview.uploadHash,digest(archive.bytes)) // private fork
    assert.ok(preview.choices.includes('install')) // private fork
    await apply(target,preview,'install')
  }
  assert.deepEqual(new Set((await target.service.listPacks()).map(p=>p.manifest.id)),new Set(packs.map(p=>p.manifest.id))) // private fork
})

test('private fork: split carrier downloads use disk streams and remain importable', async t => {
  const f=await host(t), root=path.join(f.root,'carrier'), routes=new Map()
  const transport=createAssetPackTransport({assetRoot:root,collectionBytes:1000})
  const detach=transport.attach({fetch:{register(route){routes.set(route.path,route);return()=>routes.delete(route.path)}}})
  t.after(()=>transport.service.dispose())
  const packs=await seed({...f,service:transport.service})
  const control=await routes.get('/api/dsh-asset-library/v2/control').fetch(new Request('http://dsh.internal/api/dsh-asset-library/v2/control',{
    method:'POST',headers:{host:'host.test',origin:'https://host.test','content-type':'application/json'},body:JSON.stringify({method:'exportPacks',args:{packs:writes(packs)}})
  }))
  assert.equal(control.status,200) // private fork
  const result=await control.json()
  assert.equal(result.archives.length,2) // private fork
  const target=await host(t)
  for(const archive of result.archives){
    assert.equal(archive.file,undefined) // private fork: never disclose host paths.
    assert.equal(archive.bytes,undefined) // private fork: never buffer an export in the control response.
    const response=await routes.get('/api/dsh-asset-library/v2/download').fetch(new Request('http://dsh.internal'+archive.download.url,{headers:{host:'host.test','sec-fetch-site':'same-origin'}}))
    assert.equal(response.status,200) // private fork
    const bytes=new Uint8Array(await response.arrayBuffer()), preview=await target.service.inspectImport({bytes})
    assert.equal(Number(response.headers.get('content-length')),bytes.length) // private fork
    await apply(target,preview,'install')
  }
  assert.equal((await target.service.listPacks()).length,2) // private fork
  detach()
})