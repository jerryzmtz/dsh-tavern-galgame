// private fork: validate bytes on ingress once; runtime reads trust installed digests.
import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import os from 'node:os'
import {mkdtemp, mkdir, writeFile, unlink, rmdir, lstat} from 'node:fs/promises'
import {createAssetPackService} from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/service.js'
import {jsonBytes, verifyBytes} from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/validation.js'
import {syntheticPack, PACK_ID, FIGURE_ID, OTHER_PACK_ID} from './fixtures/asset-packs/pack.mjs'

async function fixture(t) {
  const assetRoot = await mkdtemp(path.join(os.tmpdir(), 'fork-lazy-pack-')), files = [], directories = new Set([assetRoot])
  async function put(name, bytes) {
    const file = path.join(assetRoot, name)
    for (let dir = path.dirname(file); dir.startsWith(assetRoot) && dir !== assetRoot; dir = path.dirname(dir)) directories.add(dir)
    await mkdir(path.dirname(file), {recursive:true}); await writeFile(file, bytes)
    if (!files.includes(file)) files.push(file)
  }
  const pack = await syntheticPack(), inspected = [], services = []
  t.after(async () => {
    for (const service of services) await service.dispose()
    for (const file of files) await unlink(file)
    for (const dir of [...directories].sort((a,b) => b.length - a.length)) await rmdir(dir)
  })
  await put(`packs/${PACK_ID}/manifest.json`, jsonBytes(pack.manifest))
  await put(`local/${PACK_ID}.json`, jsonBytes({revision:'fixture',retired:[]}))
  for (const [name, bytes] of pack.files) await put(`packs/${PACK_ID}/${name}`, bytes)
  // A corrupt unused pack must not be touched by a bound figure request.
  await put(`packs/${OTHER_PACK_ID}/manifest.json`, Buffer.from('{broken'))
  await put(`local/${OTHER_PACK_ID}.json`, jsonBytes({revision:'fixture',retired:[]}))
  const fresh = () => {
    const service = createAssetPackService({assetRoot, authorizeLease:async () => true,
      decodeMedia:async () => { throw new Error('Runtime metadata must not decode media') },
      inspectPath:async file => { inspected.push(file.replaceAll('\\','/')); return lstat(file) }})
    services.push(service); return service
  }
  return {pack, put, inspected, fresh, service:fresh()}
}

// private fork: widget.json is v3 metadata; its HTML/scripts and all model/media bytes stay lazy.
const readsPayload = file => /\/(media|bundles)(\/|$)/.test(file) && !/\/bundles(?:\/widget(?:\/widget\.json)?)?$/.test(file)

test('cold figure resolution never visits unused packs, media or model trees', async t => {
  const f = await fixture(t)
  const rows = await f.service.resolveFigures({refs:[{packId:PACK_ID,figureId:FIGURE_ID}]})
  assert.equal(rows[0].value.name, 'Synthetic figure')
  assert.ok(rows[0].voiceSpec.sources.fish.references[1].text)
  assert.ok(!f.inspected.some(file => file.includes(OTHER_PACK_ID) || readsPayload(file)))
})

test('stored media is served without rehashing; ingress is the integrity boundary', async t => {
  const f = await fixture(t), hash = f.pack.manifest.assets[0].variants.entries[0].content.media
  const descriptor = f.pack.manifest.blobs[hash], name = `media/${hash}.${descriptor.ext}`
  const corrupt = Buffer.from(f.pack.files.get(name)); corrupt[0] ^= 1
  await f.put(`packs/${PACK_ID}/${name}`, corrupt)
  assert.ok(await f.service.getPackSnapshot({packId:PACK_ID}))
  const lease = await f.service.leaseMedia({packId:PACK_ID,hash,origin:'http://localhost',scope:'test'})
  const response = await f.service.respondLease({ticket:lease.ticket,resource:'media',request:new Request('http://localhost'+lease.url)})
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), corrupt)
})

test('fresh metadata still rejects unparseable JSON without rehashing transcripts', async t => {
  const f = await fixture(t)
  // private fork: reference transcripts are inside the figure JSON, not a second file.
  for (const name of [`figures/${FIGURE_ID}.json`, 'sprites/school/manifest.json']) {
    const bytes = f.pack.files.get(name), corrupt = Buffer.from(bytes); corrupt[0] ^= 1
    await f.put(`packs/${PACK_ID}/${name}`, corrupt)
    await assert.rejects(f.fresh().getPackSnapshot({packId:PACK_ID}))
    await f.put(`packs/${PACK_ID}/${name}`, bytes)
  }
})

test('catalogue isolates an unused corrupt pack without reading model/media bytes', async t => {
  const f = await fixture(t), rows = await f.service.listPacks()
  assert.equal(rows.length, 2)
  assert.equal(rows.find(row => row.manifest)?.manifest.id, PACK_ID)
  assert.equal(rows.find(row => row.error)?.packId, OTHER_PACK_ID)
  assert.ok(!f.inspected.some(readsPayload))
})

test('stored model bytes are served without rehashing; publication revision still fences leases', async t => {
  const f = await fixture(t), name = 'bundles/casual/model.model3.json'
  const lease = await f.service.leaseBundle({packId:PACK_ID,bundleKey:'casual',origin:'http://localhost',scope:'test'})
  const read = () => f.service.respondLease({ticket:lease.ticket,resource:'model.model3.json',request:new Request('http://localhost'+lease.url)})
  const response = await read()
  assert.equal(response.status, 200)
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), f.pack.files.get(name))
  const corrupt = Buffer.from(f.pack.files.get(name)); corrupt[0] ^= 1
  await f.put(`packs/${PACK_ID}/${name}`, corrupt)
  assert.deepEqual(Buffer.from(await (await read()).arrayBuffer()), corrupt)
  await f.put(`local/${PACK_ID}.json`, jsonBytes({revision:'replaced',retired:[]}))
  await assert.rejects(read(), {code:'REVISION_CONFLICT'})
})

test('full publication verifier still rejects unread media corruption', async () => {
  const pack = await syntheticPack()
  assert.ok(await verifyBytes(pack.manifest, pack.files))
  const name = [...pack.files.keys()].find(name => name.startsWith('media/'))
  const corrupt = Buffer.from(pack.files.get(name)); corrupt[0] ^= 1
  pack.files.set(name, corrupt)
  await assert.rejects(verifyBytes(pack.manifest, pack.files))
})

test('stored manifest edits invalidate the catalogue without rehashing stored descriptors', async t => {
  const f = await fixture(t)
  await f.service.getPackSnapshot({packId:PACK_ID})
  await f.put(`packs/${PACK_ID}/manifest.json`, jsonBytes({...f.pack.manifest,name:'external edit'}))
  const snapshot = await f.service.getPackSnapshot({packId:PACK_ID})
  assert.equal(snapshot.manifest.name,'external edit')
  assert.equal(snapshot.manifest.contentHash,f.pack.manifest.contentHash,'stored digest is not silently recomputed')
})
