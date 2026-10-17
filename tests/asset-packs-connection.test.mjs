import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as plugin from '../tavern-plugin/packages/dsh-asset-library/lib/index.js'
import { PACK_CONTROL_PATH } from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/transport.js'
import { syntheticPack, cardExtension, PACK_ID } from './fixtures/asset-packs/pack.mjs'
import { prepareAssetPackDirector, createAssetPackTransaction } from '../tavern-plugin/lib/domain/stage-asset-pack-director.js'
import { createAssetPackPresentation } from '../tavern-plugin/lib/domain/asset-pack-presentation.js'
const tick = () => new Promise(resolve => setTimeout(resolve,20))

test('package root in real Cordis/Connection: fresh binding catalogue, record, scene lease GET and detach',async t => {
  const root = await mkdtemp(join(tmpdir(),'pack-connection-')), assetRoot = join(root,'assets'), pack = await syntheticPack()
  const packRoot = join(assetRoot,'packs',PACK_ID)
  for (const [name,bytes] of new Map([['manifest.json',Buffer.from(JSON.stringify(pack.manifest))],...pack.files])) {
    await mkdir(join(packRoot,name,'..'),{recursive:true}); await writeFile(join(packRoot,name),bytes)
  }
  // A published local token is separate from the portable manifest.
  await mkdir(join(assetRoot,'local'),{recursive:true}); await writeFile(join(assetRoot,'local',PACK_ID+'.json'),JSON.stringify({revision:'installed-test-pack',retired:[]}))
  const ctx = new Context()
  t.after(async () => {await ctx.fiber.dispose(); await rm(root,{recursive:true,force:true})})
  let authenticated = true
  const connectionOwner = ctx.plugin({name:'test-real-connection',apply(owner) {new HostConnectionService(owner,[],{isAuthenticated:() => authenticated})}})
  const assetOwner = ctx.plugin(plugin,{assetRoot})
  await connectionOwner.await(); await assetOwner.await(); await tick()
  const service = ctx.get('assetLibrary'), connection = ctx.get('connection'), carrier = connection.createSharedFetchHandler('/api')
  assert.equal(service.apiVersion,2); assert.equal(typeof service.getPlan,'undefined')
  const raw = {name:'Fresh card',extensions:{dsh_tavern:cardExtension()}}
  const snapshots = await service.listPacks()
  // private fork: migrations run through the authenticated host service, sharing its CAS gate with other writers.
  const migrate = args => carrier.fetch(new Request('http://dsh.internal'+PACK_CONTROL_PATH, {method:'POST', headers:{host:'localhost:123',origin:'http://localhost:123','content-type':'application/json'}, body:JSON.stringify({method:'migrateFigureVariants',args})}))
  const dryRun = await migrate({packId:PACK_ID,expectedRevision:snapshots[0].revision,dryRun:true})
  assert.equal(dryRun.status,200) // private fork
  assert.equal((await dryRun.json()).changed,false) // private fork
  assert.equal((await migrate({packId:PACK_ID,expectedRevision:'stale',dryRun:true})).status,409) // private fork
  assert.equal((await migrate({packId:PACK_ID,expectedRevision:snapshots[0].revision,dryRun:'yes'})).status,400) // private fork
  const resolved = await service.resolveAssets({refs:snapshots.flatMap(snapshot => snapshot.manifest.assets.map(asset => ({packId:snapshot.manifest.id,kind:asset.kind,assetId:asset.id})))})
  const assetStatus = Object.fromEntries(resolved.map(row => [row.ref.packId+'/'+row.ref.kind+'/'+row.ref.assetId,{available:!!row.value && row.diagnostics.length === 0}]))
  const prepared = prepareAssetPackDirector({raw,cardRevision:'fresh-card',snapshots,assetStatus,engine:{},target:{sourceKey:'fresh-reply',branchId:'fresh',revision:1},units:['Synthetic fixture','Synthetic dusk']})
  assert.equal(prepared.context.catalogue.candidates.backgrounds[0].ref.packId,PACK_ID)
  const transaction = createAssetPackTransaction({prepared,getCurrentBinding:() => prepared.binding})
  const background = {packId:PACK_ID,kind:'backgrounds',assetId:'classroom'}
  const result = transaction.submit({sequence:1,through:2,done:true,beats:[{at:1,ops:[{op:"scene.set", background:background, time:'day'}]},{at:2,ops:[{op:"scene.set", background:background, time:'dusk'}]}]})
  assert.equal(result.ok,true,JSON.stringify(result))
  const entry = transaction.effect().entries.at(-1)
  assert.equal(entry.timeTransitionMs,2500)
  const presentation = createAssetPackPresentation({raw,getService:() => ctx.get('assetLibrary'),origin:'http://localhost:123',scope:'dsh-browser'})
  t.after(() => presentation.dispose())
  const scene = await presentation.scene(entry.state,{timeTransitionMs:entry.timeTransitionMs})
  assert.equal(scene.timeOfDay,'dusk'); assert.equal(scene.timeTransitionMs,2500); assert.equal(scene.timeMatched,true)
  const request = new Request('http://dsh.internal'+scene.backgroundUrl,{headers:{host:'localhost:123','sec-fetch-site':'same-origin'}})
  assert.equal(carrier.requestBodyMode({method:'GET',url:new URL(request.url)}),'buffered')
  assert.equal(connection.requestRejection({headers:{host:'localhost:123','sec-fetch-site':'same-origin'}}),undefined)
  const response = await carrier.fetch(request)
  assert.equal(response.status,200)
  assert.deepEqual(Buffer.from(await response.arrayBuffer()),pack.files.get('media/'+pack.manifest.assets[0].variants.entries.find(row=>row.id==='dusk').content.media+'.png'))
  service.registerModPrivate({modId:'test.private',validate:value=>assert.equal(value.version,1)})
  const privatePack=await service.createPack({name:'Private config',expectedRevision:null})
  const privateId=privatePack.snapshot.manifest.id
  await service.writeModPrivate({packId:privateId,expectedRevision:privatePack.snapshot.revision,modId:'test.private',config:{version:1,values:{}}})
  const control=(method,args={})=>carrier.fetch(new Request('http://dsh.internal'+PACK_CONTROL_PATH,{method:'POST',headers:{host:'localhost:123',origin:'http://localhost:123','content-type':'application/json'},body:JSON.stringify({method,args})}))
  assert.equal((await service.listPacks()).length,2,'native archives retain the private pack')
  assert.equal((await (await control('listPackSummaries')).json()).length,1,'asset editor cannot enumerate private config packs')
  assert.equal((await control('listPacks')).status,400,'private fork (perf): the browser has no full-list call')
  assert.notEqual((await control('getPackSnapshot',{packId:privateId})).status,200)
  authenticated = false
  assert.equal(connection.requestRejection({headers:{host:'localhost:123','sec-fetch-site':'same-origin'}}),401)
  assert.equal(prepareAssetPackDirector({raw:{name:'No binding'}}),null)
  const stale = connection.fetchRoutes.get(PACK_CONTROL_PATH)
  await assetOwner.dispose(); await tick()
  assert.equal(ctx.get('assetLibrary'),undefined); assert.equal(connection.fetchRoutes.size,0)
  assert.equal((await stale.fetch(new Request('http://dsh.internal'+PACK_CONTROL_PATH))).status,503)
  // private fork: a detached authority rejects; it is not a successful neutral scene.
  await assert.rejects(presentation.scene(entry.state),{code:'ASSET_UNAVAILABLE'})
})
