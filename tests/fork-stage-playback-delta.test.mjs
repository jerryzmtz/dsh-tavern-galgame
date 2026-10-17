// private fork: shared playback is derived data, never a new director/save protocol.
import test from 'node:test'
import assert from 'node:assert/strict'
import {fixture,answer} from './helpers/stage-director-harness.mjs'
import {assetPackDigest} from '../tavern-plugin/lib/domain/stage-asset-pack-catalogue.js'
import {readStageProjection} from '../tavern-plugin/lib/domain/stage-projection.js'
import {createStagePlayback,stagePlaybackWriter,stagePlaybackFrames,validateStagePlayback,saveStagePlayback} from '../tavern-plugin/lib/domain/stage-playback.js'

const bytes=value=>Buffer.byteLength(JSON.stringify(value))
const key=id=>assetPackDigest({id})
async function setup(t) {
  const f=await fixture(request=>request.onToolCall({name:'stage_update',arguments:answer}))
  t.after(()=>f.dispose())
  await f.director.get(f.read());await f.director.drain()
  const direction=await f.director.get(f.read(),1,null,{readOnly:true})
  return {f,direction}
}
const frame=()=>({characters:[{alias:'actor',state:{id:'calm'},outfit:{key:'uniform',assets:Object.fromEntries(Array.from({length:300},(_,i)=>['asset-'+i,String(i).padStart(64,'0')]))}}],avatars:[],scene:{timeOfDay:'day'},audio:{music:null}})

test('shared resource table grows only along changed paths and seeks exactly in any order',async t=>{
  const {direction}=await setup(t), data=createStagePlayback(direction), append=stagePlaybackWriter(data)
  const before=frame(), after=structuredClone(before)
  after.characters[0].state.id='happy'
  append(key(1),before)
  const count=data.nodes.length, payload=bytes(data.nodes), firstBytes=bytes(data)
  for(let i=0;i<1000;i++) append(key(1),structuredClone(before))
  assert.equal(bytes(data),firstBytes,'unchanged semantic frames are exactly flat')
  append(key(2),after)
  assert.equal(data.nodes.length-count,4,'only state, actor, cast array and frame root change')
  assert.ok(bytes(data.nodes)-payload<300,'large resource map is not copied')
  append(key(3),before)
  assert.equal(data.frames[key(3)],data.frames[key(1)],'returning to a state reuses its root')
  assert.doesNotThrow(()=>validateStagePlayback(data,direction))
  const decoded=stagePlaybackFrames(data)
  for(const [id,expected] of [[3,before],[2,after],[1,before],[2,after]]) assert.deepEqual(decoded[key(id)],expected)
  assert.equal(decoded[key(1)].characters[0].outfit,decoded[key(2)].characters[0].outfit)
  assert.equal(bytes(before),bytes(frame()),'input objects are not mutated')
})

test('concurrent candidates merge by content, not candidate-local numeric IDs',async t=>{
  const {f,direction}=await setup(t), chat=f.read(), left=createStagePlayback(direction), right=createStagePlayback(direction)
  const a=frame(), b=frame();b.scene.timeOfDay='night'
  stagePlaybackWriter(left)(key('left'),a)
  stagePlaybackWriter(right)(key('right'),b)
  assert.equal(left.frames[key('left')],right.frames[key('right')],'different trees can allocate the same IDs')
  saveStagePlayback(chat,1,direction,left)
  const saved=saveStagePlayback(chat,1,direction,right)
  assert.deepEqual(stagePlaybackFrames(saved),{[key('right')]:b,[key('left')]:a})
  assert.equal(saved.nodes.filter(node=>node?.['asset-299']).length,1)
  assert.deepEqual(saveStagePlayback(chat,1,direction,saved),saved)
  const overwrite=structuredClone(saved)
  stagePlaybackWriter(overwrite)(key('left'),b)
  assert.throws(()=>saveStagePlayback(chat,1,direction,overwrite),{code:'REVISION_CONFLICT'})
})

for(const huge of [false,true]) test('old '+(huge?'over-budget ':'')+'derived cache rebuilds from stored direction without model calls',async t=>{
  const {f,direction}=await setup(t), canonical=structuredClone(f.read().messages[0].stageDirectionAssetPacks)
  const old={version:1,source:createStagePlayback(direction).source,acceptedPrefix:direction.token,frames:huge?Array(500001).fill(null):{old:{missing:'media-unavailable-at-snapshot'}}}
  await f.store.updateChat('chat',chat=>{chat.messages[0].stagePlaybackV1=old;return chat})
  const calls=f.calls.length
  const read=()=>f.director.get(f.read(),1,null,{readOnly:true})
  const project=at=>readStageProjection({at,expectedDirectionToken:direction.token,readDirection:read,
    readConsumer:()=>f.assets.consumer(f.read(),'http://localhost'),readSettings:()=>f.engineSettings.read(),revision:()=>f.assets.revision,
    readPlayback:()=>f.read().messages[0].stagePlaybackV1,
    writePlayback:async(d,m)=>{let saved;await f.store.updateChat('chat',chat=>{saved=saveStagePlayback(chat,1,d,m);return chat});return saved}})
  for(const at of [2,1,2]) {
    const result=await project(at)
    assert.equal(result.status,'ready',JSON.stringify(result.error))
    assert.ok(!result.value.diagnostics.includes('playback-snapshot-limit'))
  }
  const saved=f.read().messages[0].stagePlaybackV1
  assert.equal(saved.version,2)
  assert.ok(saved.nodes.length>0)
  assert.deepEqual(f.read().messages[0].stageDirectionAssetPacks,canonical)
  assert.equal(f.calls.length,calls,'read-only reconstruction must never start/resume the director')
})

test('shared references retain JSON integrity and cannot amplify past the existing budget',async t=>{
  const {direction}=await setup(t), data=createStagePlayback(direction)
  stagePlaybackWriter(data)(key(1),frame())
  for(const ref of [-1,data.nodes.length,0.5]) {
    const bad=structuredClone(data);bad.nodes[0]={child:[ref]}
    assert.throws(()=>validateStagePlayback(bad,direction),{code:'REVISION_CONFLICT'})
  }
  const bad=structuredClone(data)
  bad.frames[key(1)]=bad.nodes.length
  assert.throws(()=>validateStagePlayback(bad,direction),{code:'REVISION_CONFLICT'})
  const amplified=createStagePlayback(direction)
  amplified.nodes=[{}]
  for(let i=1;i<20;i++) amplified.nodes.push({a:[i-1],b:[i-1]})
  amplified.frames[key(1)]=19
  assert.throws(()=>validateStagePlayback(amplified,direction),{code:'LIMIT_EXCEEDED'})
})
