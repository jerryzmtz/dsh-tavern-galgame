// private fork: reconstruction memoization is request-local, never director authority.
import test from 'node:test'
import assert from 'node:assert/strict'
import {fixture,answer} from './helpers/stage-director-harness.mjs'
import {readStageProjection} from '../tavern-plugin/lib/domain/stage-projection.js'
import {createStagePlayback,stagePlaybackFrame,stagePlaybackWriter,stagePlaybackFrames,validateStagePlayback} from '../tavern-plugin/lib/domain/stage-playback.js'
import {assetPackDigest} from '../tavern-plugin/lib/domain/stage-asset-pack-catalogue.js'
import {createAssetPackPresentation} from '../tavern-plugin/lib/domain/asset-pack-presentation.js'
import {cardExtension} from './fixtures/asset-packs/pack.mjs'

const key=id=>assetPackDigest({id})
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value)}return value}

test('projection writer memoizes owned DTOs without changing selected frame bytes or public mutable append',()=>{
  const data={nodes:[],frames:{}},reference={nodes:[],frames:{}},append=stagePlaybackWriter(data),plain=stagePlaybackWriter(reference)
  let visits=0
  const outfit={key:'uniform',get assets(){visits++;return {large:'a'.repeat(64)}}}
  const first=freeze({alias:'actor',outfit,state:{id:'calm'},figureScale:{hMax:180}})
  const second=freeze({...first,state:{id:'happy'}})
  visits=0
  for(let i=0;i<50;i++){
    const actor=i%3===1?second:first
    const value={state:{cast:['actor']},characters:[actor],avatars:[actor],scene:{timeOfDay:i%2?'day':'night',figureScale:{hMax:180}},audio:{music:null}}
    append.projection(key(i),value)
  }
  assert.equal(visits,2,'each selected figure is cleaned once in the reconstruction')
  for(let i=0;i<50;i++){
    const actor=i%3===1?second:first
    plain(key(i),stagePlaybackFrame({state:{cast:['actor']},characters:[actor],avatars:[actor],scene:{timeOfDay:i%2?'day':'night',figureScale:{hMax:180}},audio:{music:null}}))
  }
  assert.deepEqual(data,reference,'node ordering and serialized sidecar are unchanged')
  const mutable={characters:[],avatars:[],scene:{timeOfDay:'day'},audio:{}}
  append(key('before'),mutable);mutable.scene.timeOfDay='night';append(key('after'),mutable)
  const decoded=stagePlaybackFrames(data)
  assert.equal(decoded[key('before')].scene.timeOfDay,'day')
  assert.equal(decoded[key('after')].scene.timeOfDay,'night')
})

test('card extension snapshots are immutable and reused only until rebind',()=>{
  const ext=cardExtension(),raw={extensions:{dsh_tavern:ext}}
  const p=createAssetPackPresentation({raw,getService:()=>null})
  try{
    // private fork: card snapshots retain package permissions, not figure-owned names.
    const before=p.extension;assert.equal(p.extension,before);assert.ok(Object.isFrozen(before.assetBindings.boundPackIds))
    assert.throws(()=>{before.assetBindings.boundPackIds.length=0},TypeError)
    const next=structuredClone(raw);next.extensions.dsh_tavern.assetBindings.boundPackIds=[]
    p.rebind(next)
    assert.notEqual(p.extension,before);assert.deepEqual(p.extension.assetBindings.boundPackIds,[])
    assert.ok(before.assetBindings.boundPackIds.length)
  }finally{p.dispose()}
})

async function setup(t){
  // private fork: materialization caching needs an actually entered figure, not a recalled candidate.
  const {figureActorKey}=await import('../tavern-plugin/lib/domain/figure-catalogue.js')
  const {PACK_ID,FIGURE_ID}=await import('./fixtures/asset-packs/pack.mjs')
  const submitted=structuredClone(answer);submitted.through=40
  submitted.beats[0].ops.push({op:'cast.add',actor:figureActorKey({packId:PACK_ID,figureId:FIGURE_ID})})
  const f=await fixture(request=>request.onToolCall({name:'stage_update',arguments:submitted}));t.after(()=>f.dispose())
  // Different authored words resolve to the same fallback emotion, but remain distinct
  // semantic keys. This forces forty snapshots of the same selected character views.
  await f.store.updateChat('chat',chat=>{chat.messages[0].text=Array.from({length:40},(_,i)=>`@bubble:actor|Actor|unknown_${i}|[Fixture ${i}]`).join('\n\n');return chat})
  await f.director.get(f.read());await f.director.drain()
  const read=()=>f.director.get(f.read(),1,null,{readOnly:true}),direction=await read()
  assert.equal(direction.through,40)
  const consumer=await f.assets.consumer(f.read(),'http://localhost')
  const options={at:20,expectedDirectionToken:direction.token,readDirection:read,readConsumer:()=>consumer,readSettings:()=>f.engineSettings.read(),revision:()=>f.assets.revision,readPlayback:()=>null}
  return {f,direction,consumer,options}
}

test('reconstruction shares frozen character views within a request, not across requests or invalidation',async t=>{
  const {f,direction,consumer,options}=await setup(t),p=consumer.presentation,original=p.materialize
  let calls=0,saved
  p.materialize=async(...args)=>{calls++;return original(...args)}
  let reads=0
  const project=()=>readStageProjection({...options,readDirection:()=>{reads++;return options.readDirection()},writePlayback:async(d,value)=>saved=validateStagePlayback(value,d)})
  const first=await project();assert.equal(first.status,'ready',JSON.stringify(first.error))
  assert.ok(Object.keys(saved.frames).length>=40)
  assert.ok(calls<=6,'snapshot views plus uncached displayed frame: '+calls)
  // private fork: reuse the initial authority; keep both precommit and post-projection rechecks.
  assert.equal(reads,3,'one authority read, precommit recheck, and post-projection source check')
  const firstCalls=calls,firstBytes=JSON.stringify(saved),record=structuredClone(direction.record)
  const second=await project();assert.equal(second.status,'ready');assert.equal(calls,firstCalls*2,'new reconstruction materializes its own DTOs')
  assert.equal(JSON.stringify(saved),firstBytes);assert.deepEqual(second.value,first.value)
  f.changePack({revision:'republished'})
  const third=await project();assert.equal(third.status,'ready',JSON.stringify(third.error))
  assert.ok(calls>firstCalls*2);assert.deepEqual(direction.record,record)
  assert.equal(f.calls.length,1,'reconstruction makes no model calls')
})

test('a revision change during reconstruction rejects the whole candidate without writing',async t=>{
  const {f,consumer,options}=await setup(t),p=consumer.presentation,original=p.materialize
  let calls=0,writes=0
  p.materialize=async(...args)=>{const result=await original(...args);if(++calls===1)f.changePack({revision:'changed-mid-build'});return result}
  const result=await readStageProjection({...options,writePlayback:async(d,value)=>{writes++;return value}})
  assert.notEqual(result.status,'ready');assert.equal(writes,0)
})

test('a replaced director digest during reconstruction is rechecked before the write',async t=>{
  const {consumer,options,direction}=await setup(t),p=consumer.presentation,original=p.materialize
  let changed=false,writes=0
  p.materialize=async(...args)=>{const result=await original(...args);changed=true;return result}
  const latest={...direction,token:{...direction.token,digest:'f'.repeat(64)}}
  const result=await readStageProjection({...options,readDirection:()=>changed?latest:direction,writePlayback:async(d,value)=>{writes++;return value}})
  assert.equal(result.status,'stale');assert.equal(writes,0);assert.deepEqual(result.directionToken,latest.token)
})
