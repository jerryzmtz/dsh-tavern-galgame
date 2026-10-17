// private fork: Madoka turn 127 (200 pages, 15 bindings, 107 frozen frames).
import test from 'node:test'
import assert from 'node:assert/strict'
import {fixture,answer} from './helpers/stage-director-harness.mjs'
import {harness,drain,fixtureScale} from './helpers/stage-resource-harness.mjs'
import {assetPackDigest} from '../tavern-plugin/lib/domain/stage-asset-pack-catalogue.js'
import {createStagePlayback,stagePlaybackFrame,validateStagePlayback,stagePlaybackWriter,stagePlaybackFrames} from '../tavern-plugin/lib/domain/stage-playback.js'
import {readStageProjection} from '../tavern-plugin/lib/domain/stage-projection.js'
import {assertJson} from '../tavern-plugin/packages/dsh-presentation-protocol/src/asset-pack-json.js'

async function directed(t) {
  const f=await fixture(request=>request.onToolCall({name:'stage_update',arguments:answer}))
  t.after(()=>f.dispose())
  await f.director.get(f.read());await f.director.drain()
  const direction=await f.director.get(f.read(),1,null,{readOnly:true})
  const consumer=await f.assets.consumer(f.read(),'http://localhost')
  const options={at:1,expectedDirectionToken:direction.token,readDirection:()=>direction,readConsumer:()=>consumer,
    readSettings:()=>f.engineSettings.read(),revision:()=>f.assets.revision}
  return {f,direction,consumer,options}
}

test('long performance turn freezes selected figure views within the unchanged JSON budget',async t=>{
  const {direction,consumer}=await directed(t)
  const character=structuredClone(await consumer.presentation.materialize(await consumer.presentation.character('actor',{actor:{outfitKey:'casual'}}),{descriptors:true}))
  // Each emotion carries mouth geometry and resource maps, as in the installed pack.
  for(let i=0;i<40;i++) {
    const id='unused-'+i
    // private fork: adversarial extra native entries must not inflate frozen selected views.
    character.manifest.emotions[id]={src:id+'.png'}
    character.outfit.sprite.assets[id+'.png']='a'.repeat(64)
    character.outfit.sprite.anatomy ||= {}
    character.outfit.sprite.anatomy[id]={head:{x:0.5,y:0.2},mouth:{x:0.5,y:0.3},eyes:{left:{x:0.4,y:0.2},right:{x:0.6,y:0.2}}}
  }
  const characters=Array.from({length:15},(_,i)=>({...character,alias:'actor-'+i}))
  const raw=createStagePlayback(direction),compact=createStagePlayback(direction)
  const value={characters,avatars:characters,scene:{},audio:{}}, append=stagePlaybackWriter(compact)
  for(let i=0;i<107;i++) {
    const key=assetPackDigest({page:i})
    raw.frames[key]=value
    append(key,stagePlaybackFrame(value))
  }
  assert.throws(()=>assertJson(raw),{code:'LIMIT_EXCEEDED'})
  assert.doesNotThrow(()=>validateStagePlayback(compact,direction))
  const frame=Object.values(stagePlaybackFrames(compact))[0]
  // private fork: resource payload is shared, not just trimmed per frame.
  const bytes=value=>Buffer.byteLength(JSON.stringify(value))
  assert.ok(bytes(compact)<500000)
  assert.ok(bytes(compact)<bytes(raw)/10)
  const nodeBytes=bytes(compact.nodes),nodeCount=compact.nodes.length
  for(let i=107;i<1000;i++) append(assetPackDigest({page:i}),stagePlaybackFrame(value))
  assert.equal(compact.nodes.length,nodeCount)
  assert.equal(bytes(compact.nodes),nodeBytes,'unchanged frames add no resource/state payload')
  assert.equal(JSON.stringify(frame).includes('unused-'),false)
  assert.equal(Object.keys(character.manifest.emotions).length,41,'authoring documents are not mutated')
  const frozen=await consumer.presentation.frozen({characters:frame.characters})
  assert.equal(frozen.characters[0].avatar,character.avatar)
  assert.deepEqual(frozen.characters[0].avatarCrop,character.avatarCrop)
})

for(const phase of ['read','write']) test('optional playback '+phase+' budget cannot blank first-load stage',async t=>{
  const {options}=await directed(t),before=await readStageProjection(options)
  const overflow=()=>{throw Object.assign(Error('JSON complexity limit'),{code:'LIMIT_EXCEEDED'})}
  const result=await readStageProjection({...options,readPlayback:phase==='read'?overflow:()=>null,writePlayback:overflow})
  assert.equal(result.status,'ready')
  assert.deepEqual(result.value.characters,before.value.characters)
  assert.deepEqual(result.value.scene,before.value.scene)
  assert.deepEqual(result.value.audio,before.value.audio)
  assert.ok(result.value.diagnostics.includes('playback-snapshot-limit'))
  assert.deepEqual(result.directionToken,options.expectedDirectionToken)
  const stale=await readStageProjection({...options,readPlayback:()=>null,writePlayback:()=>{throw Object.assign(Error('source changed'),{code:'REVISION_CONFLICT'})}})
  assert.equal(stale.status,'stale','the optional boundary never bypasses source CAS')
})

test('skin resolution failure preserves background and lighting without changing requested state',async t=>{
  const {f,consumer}=await directed(t),presentation=consumer.presentation
  const ref={packId:presentation.extension.assetBindings.boundPackIds[0],kind:'skins',assetId:'broken'}
  const state={scene:{background:answer.beats[0].ops[0].background,timeOfDay:'day'},lighting:{},skin:{ref}}
  const resolve=f.services.get('assetLibrary').resolveAssets
  f.services.get('assetLibrary').resolveAssets=async args=>{
    if(args.refs.some(r=>r.kind==='skins'))throw Object.assign(Error('skin document unavailable'),{code:'ASSET_UNAVAILABLE'})
    return resolve(args)
  }
  const result=await presentation.scene(state,{descriptors:true})
  assert.ok(result.backgroundUrl.resource)
  assert.equal(result.skin,null)
  assert.ok(result.diagnostics.includes('skin-unavailable:ASSET_UNAVAILABLE'))
  assert.deepEqual(state.skin,{ref})
})

for(const capability of ['skin','overlay']) test('failed '+capability+' bytes/chunk cannot withhold background or figures',async t=>{
  const h=await harness(t,answer,undefined,{preparePerformance:async()=>{if(capability==='overlay')throw Error('overlay chunk unavailable')}})
  await h.direct()
  const ref=(kind,id)=>({packId:'pack',kind,assetId:id})
  const media=(kind,id)=>({resource:true,kind:'media',ref:ref(kind,id),identity:id,hash:id,revision:'pack-1'})
  const skin={url:media('skins','broken-skin')},figure={alias:'actor',url:media('figures','actor')}
  h.rejectBytes(url=>url.includes('broken-skin'))
  h.setResponse({status:'ready',directionToken:h.store.getSnapshot().director.token,value:{
    state:{lighting:{},figureScale:fixtureScale},scene:{backgroundUrl:media('backgrounds','room'),...(capability==='skin'?{skin}:{})},
    characters:[figure],avatars:[],widgets:[],audio:{music:null,soundscape:null},
    performance:capability==='overlay'?{phase:'entry',instanceKey:['show'],phaseKey:['entry'],plan:{events:[]},dependencies:[],executionDependencies:[]}:null
  }})
  h.refresh();await drain()
  const accepted=h.store.getSnapshot().accepted
  assert.ok(accepted.scene.backgroundUrl.startsWith('blob:'))
  assert.ok(accepted.figures[0].url.startsWith('blob:'))
  if(capability==='skin')assert.equal(accepted.scene.skin,null)
  else assert.equal(accepted.performance,null)
})
