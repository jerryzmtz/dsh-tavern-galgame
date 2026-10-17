import test from 'node:test'
import assert from 'node:assert/strict'
import {createModPerformanceMedia} from '../tavern-plugin/lib/domain/mods/performance-media.js'
import {createModCoreMedia} from '../tavern-plugin/lib/domain/mods/core-media.js'
import {syntheticPack,cardExtension} from './fixtures/asset-packs/pack.mjs'

const ref={packId:'11111111-1111-4111-8111-111111111111',kind:'props',assetId:'potion'}
test('core prop media requires an owned payload and explicit grant, and rechecks source after reading',async()=>{
  const source={branchId:'b',sourceKey:'s',generation:0,textVersion:'s'},context={gameId:'game',turn:1,source}
  const row={id:'p',modId:'dsh.items',revision:0,payload:{iconRef:ref}},store={source,performances:[row],corrections:{}}
  const manifest={id:'dsh.items',permissions:{stage:['place'],mainAssets:[{slot:'props',kinds:['props']}]}}
  let enabled=true,revision='r',afterRead=()=>{}
  const library={snapshot:()=>({revision}),active:()=>enabled?[manifest]:[]}
  const coreMedia={describe:async()=>({hash:'a'.repeat(64)}),read:async()=>{afterRead();return {mime:'image/png',data:'AA=='}}}
  const read=createModPerformanceMedia({library,coreMedia,readPresentation:async()=>({cardId:'card',store:structuredClone(store)})})
  const request={context,performanceId:'p',ref,slot:'image'}
  assert.equal((await read(request)).data,'AA==')
  await assert.rejects(read({...request,ref:{...ref,assetId:'foreign'}}),{code:'MOD_PERMISSION_DENIED'})
  await assert.rejects(read({...request,slot:'sound'}),{code:'MOD_PERMISSION_DENIED'})
  manifest.permissions.mainAssets=[]
  await assert.rejects(read(request),{code:'MOD_PERMISSION_DENIED'})
  manifest.permissions.mainAssets=[{slot:'props',kinds:['props'],refs:[{...ref,assetId:'other'}]}]
  await assert.rejects(read(request),{code:'MOD_PERMISSION_DENIED'})
  manifest.permissions.mainAssets=[{slot:'props',kinds:['props']}]
  afterRead=()=>{enabled=false}
  await assert.rejects(read(request),{code:'MOD_PERMISSION_DENIED'});enabled=true
  afterRead=()=>{revision='changed'}
  await assert.rejects(read(request),{code:'MOD_SOURCE_STALE'})
})

test('core prop reader uses effective card assets and official revision-checked media reads',async()=>{
  const pack=await syntheticPack(),hash=Object.keys(pack.manifest.blobs).find(hash=>pack.manifest.blobs[hash].mime.startsWith('image/'))
  const ref={packId:pack.manifest.id,kind:'props',assetId:'potion'}
  const asset={id:ref.assetId,kind:'props',name:'Potion',enabled:true,media:hash}
  pack.manifest.assets.push(asset);pack.revision='r1'
  const view={snapshots:[pack],raw:{extensions:{dsh_tavern:cardExtension()}},globalEnabledPackIds:[],assetStatus:{[`${ref.packId}/props/potion`]:{available:true}},current:()=>true}
  let args
  const owner={apiVersion:2,async readMedia(input){args=input;return {bytes:new Uint8Array([1,2]),descriptor:pack.manifest.blobs[hash]}}}
  const media=createModCoreMedia({readChat:async()=>({cardPath:'card'}),snapshot:async()=>view,service:()=>owner})
  const value=await media.describe({gameId:'game'},ref)
  assert.deepEqual(await media.read(value),{mime:pack.manifest.blobs[hash].mime,data:'AQI='})
  assert.deepEqual(args,{packId:ref.packId,hash,expectedRevision:'r1'})
  const other=Object.keys(pack.manifest.blobs).find(value=>value!==hash && pack.manifest.blobs[value].mime.startsWith('image/'))
  delete asset.media
  asset.variants={default:'alternate',entries:[{id:'base',name:'Base',content:{media:hash}},{id:'alternate',name:'Alternate',content:{media:other}}]}
  const selected=await media.describe({gameId:'game'},ref)
  assert.equal(selected.hash,other)
  await media.read(selected)
  assert.deepEqual(args,{packId:ref.packId,hash:other,expectedRevision:'r1'})
  asset.enabled=false
  await assert.rejects(media.describe({gameId:'game'},ref),{code:'MOD_PERMISSION_DENIED'})
})
