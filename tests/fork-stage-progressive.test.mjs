// private fork: independent current-page groups exercise the production reducer, runner and pin owner.
import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {createFakeClock,runtimeSource,runtimePage,runtimeText,runtimeDirection} from './helpers/stage-runtime-harness.mjs'
const require=createRequire(import.meta.url)
const {createStageResourceOwner}=require('../tavern-plugin/src/client/fork-stage-resources.cjs')
const {createStageResourceRunner}=require('../tavern-plugin/src/client/fork-stage-resource-runner.cjs')
const {createStageRuntimeStore}=require('../tavern-plugin/src/client/fork-stage-runtime-store.cjs')
const {stageRuntimeIndicators}=require('../tavern-plugin/src/client/fork-stage-runtime.cjs')
const {packStageMembers}=require('../tavern-plugin/src/client/fork-pack-playback.cjs')
const tick=async()=>{for(let i=0;i<200;i++)await Promise.resolve()}
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r});return {promise,resolve}}
const descriptor=id=>({resource:true,kind:'media',identity:id,hash:id,revision:'one',ref:{packId:'fixture',kind:'backgrounds',assetId:id}})
function frame(at,cast=['left','right']) {
  return {state:{cast,actors:Object.fromEntries(cast.map(id=>[id,{}])),figureScale:{version:6,scene:0,hMax:180,rescales:0}},
    scene:{backgroundUrl:descriptor('bg-'+at),core:'/fixture-core.js'},characters:cast.map(alias=>({alias,url:descriptor(alias+'-'+at)})),avatars:[],widgets:[],audio:{music:null,soundscape:null,sfx:[]}}
}
function fixture(t,{frames=[frame(1),frame(2)],blocked=new Map(),fail=()=>false,handoff=()=>{},maxBytes}={}) {
  const clock=createFakeClock(),source=runtimeSource(),direction={digest:'fixture'},presents=[]
  const owner=createStageResourceOwner({maxBytes,service:{async leaseMedia({hash}){return {ticket:hash,revision:'one',url:hash}},releaseLease(){}},
    urls:{createObjectURL:()=>`blob:${++serial}`,revokeObjectURL(){}},fetch:async id=>{await blocked.get(id)?.promise;if(fail(id))throw Error('broken '+id);return new Response('bytes')}})
  let serial=0
  const runner=createStageResourceRunner({clock,owner,read:async args=>({status:'ready',directionToken:direction,value:frames[args.at-1]}),
    present:(_id,intent)=>{presents.push(intent);return handoff(intent)}})
  const store=createStageRuntimeStore({runEffect:(...args)=>runner.onEffect('session-1',...args)})
  store.dispatch({type:'TURN_CHANGED',source,text:runtimeText(1,frames.map((_,i)=>runtimePage(i+1)))})
  // Suppress lookahead in these ownership tests, without changing the current-page path.
  store.dispatch({type:'DIRECTOR_SNAPSHOT',source,envelope:runtimeDirection(1,1,{token:direction})})
  const page=()=>{store.dispatch({type:'DIRECTOR_SNAPSHOT',source,envelope:runtimeDirection(2,2,{token:direction})});store.dispatch({type:'PAGE',index:1})}
  t.after(()=>{store.dispose();runner.dispose()})
  return {store,owner,clock,presents,source,page}
}

test('background becomes accepted before either figure, and text never waits',async t=>{
  const left=deferred(),right=deferred(),h=fixture(t,{blocked:new Map([['left-1',left],['right-1',right]])})
  await tick()
  const state=h.store.getSnapshot()
  assert.ok(state.accepted.scene.backgroundUrl.startsWith('blob:'))
  assert.equal(state.accepted.figures,null)
  assert.equal(state.text.hasReadableText,true)
  assert.deepEqual(state.projection.outstanding,['figure:left','figure:right'])
  left.resolve();right.resolve();await tick()
  assert.equal(h.store.getSnapshot().projection,null)
})

test('figures enter independently in directed slots, regardless of order or background readiness',async t=>{
  const bg=deferred(),left=deferred(),h=fixture(t,{blocked:new Map([['bg-1',bg],['left-1',left]])})
  await tick()
  let accepted=h.store.getSnapshot().accepted
  assert.equal(accepted.scene,null)
  assert.equal(accepted.layout.core,'/fixture-core.js','a ready Live2D slot does not wait for background-owned core metadata')
  assert.deepEqual(accepted.figures.map(f=>f.alias),['right'])
  assert.equal(packStageMembers(accepted.layout.state).find(m=>m.id==='right').x,2/3)
  left.resolve();await tick()
  accepted=h.store.getSnapshot().accepted
  assert.deepEqual(accepted.figures.map(f=>f.alias),['left','right'])
  bg.resolve();await tick()
  assert.equal(h.store.getSnapshot().projection,null)
})

test('page change immediately cancels pending pins; accepted old groups survive until corresponding replacement',async t=>{
  const oldLeft=deferred(),newBg=deferred(),newRight=deferred()
  const h=fixture(t,{blocked:new Map([['left-1',oldLeft],['bg-2',newBg],['right-2',newRight]])})
  await tick()
  const old=h.store.getSnapshot().accepted,oldToken=old.provenanceByChannel.background.token.id
  h.page();await tick()
  let state=h.store.getSnapshot()
  assert.ok(state.projection.token.id>oldToken)
  assert.equal(state.accepted.scene,old.scene)
  assert.equal(state.accepted.figuresBySlot['figure:right'],old.figuresBySlot['figure:right'])
  assert.equal(h.owner.debug().resources.find(r=>r.identity==='left-1').pins.length,0)
  oldLeft.resolve();await tick()
  assert.notEqual(h.store.getSnapshot().accepted.figuresBySlot['figure:left']?.url,old.figuresBySlot['figure:left']?.url)
  assert.equal(h.owner.debug().resources.find(r=>r.identity==='left-1').pins.length,0,'late completion cannot pin or publish')
  newBg.resolve();newRight.resolve();await tick()
  assert.equal(h.store.getSnapshot().projection,null)
})

test('accepted outgoing pins survive handoff and disappear only after new background acknowledgement',async t=>{
  const bg=deferred(),ack=deferred()
  const h=fixture(t,{frames:[frame(1),frame(2,['left'])],blocked:new Map([['bg-2',bg]]),handoff:intent=>
    intent.groups?.includes('background')&&intent.token.anchor.para===2?ack.promise:undefined})
  await tick();h.page();await tick()
  assert.ok(h.store.getSnapshot().accepted.figuresBySlot['figure:right'])
  bg.resolve();await tick()
  assert.equal(h.store.getSnapshot().accepted.figuresBySlot['figure:right'],undefined)
  const resource=()=>h.owner.debug().resources.find(r=>r.identity==='right-1')
  assert.ok(resource().pins.some(p=>!p.prefetch))
  ack.resolve();await tick()
  assert.ok(!resource()?.pins.some(p=>!p.prefetch))
})

test('one figure failing exhausts only its group; other visuals remain accepted and warning survives',async t=>{
  const h=fixture(t,{fail:id=>id==='left-1'})
  await tick()
  const scene=h.store.getSnapshot().accepted.scene,right=h.store.getSnapshot().accepted.figuresBySlot['figure:right']
  h.clock.advance(700);await tick();h.clock.advance(700);await tick()
  const state=h.store.getSnapshot()
  assert.equal(state.projection,null)
  assert.equal(state.accepted.scene,scene)
  assert.equal(state.accepted.figuresBySlot['figure:right'],right)
  assert.match(state.pending.error,/broken left-1/)
  assert.equal(h.presents.filter(p=>p.groups.includes('figure:right')).length,1)
})

test('notice waits 600ms, follows only current outstanding visual groups and clears immediately',async t=>{
  const right=deferred(),h=fixture(t,{blocked:new Map([['right-1',right]])})
  await tick();h.clock.advance(599)
  assert.equal(stageRuntimeIndicators(h.store.getSnapshot()).loading,false)
  h.clock.advance(1)
  assert.equal(stageRuntimeIndicators(h.store.getSnapshot()).loading,true)
  right.resolve();await tick()
  assert.equal(stageRuntimeIndicators(h.store.getSnapshot()).loading,false)
})
// private fork: a semantic turn handoff is a fresh projection generation, not a presentation revoke.
test('accepted groups survive a turn handoff while old unaccepted work is cancelled',async t=>{
  const oldLeft=deferred(),newBg=deferred(),newRight=deferred(),frames=[frame(1),frame(2)]
  const h=fixture(t,{frames,blocked:new Map([['left-1',oldLeft],['bg-2',newBg],['right-2',newRight]])})
  await tick()
  const old=h.store.getSnapshot().accepted
  const source={...h.source,turn:2,sourceKey:'new-turn'}
  h.store.dispatch({type:'TURN_CHANGED',source,text:runtimeText(1,[runtimePage(1)])})
  assert.equal(h.store.getSnapshot().accepted,old)
  assert.equal(h.owner.debug().resources.find(r=>r.identity==='left-1').pins.length,0)
  frames[0]=frame(2)
  h.store.dispatch({type:'DIRECTOR_SNAPSHOT',source,envelope:runtimeDirection(1,1,{token:{digest:'fixture'}})})
  await tick()
  assert.equal(h.store.getSnapshot().accepted.scene,old.scene)
  assert.equal(h.store.getSnapshot().accepted.figuresBySlot['figure:right'],old.figuresBySlot['figure:right'])
  oldLeft.resolve();await tick()
  assert.equal(h.owner.debug().resources.find(r=>r.identity==='left-1').pins.length,0)
  newBg.resolve();newRight.resolve();await tick()
  assert.equal(h.store.getSnapshot().projection,null)
  assert.notEqual(h.store.getSnapshot().accepted.scene,old.scene)
})
// private fork: a broken renderer acknowledgement cannot turn a resource budget failure into an endless gate.
test('budget exhaustion is bounded even while an unrelated presentation acknowledgement is stalled',async t=>{
  const ack=deferred(),h=fixture(t,{maxBytes:5,handoff:()=>ack.promise})
  await tick();h.clock.advance(700);await tick();h.clock.advance(700);await tick()
  assert.equal(h.store.getSnapshot().projection,null)
  assert.ok(h.store.getSnapshot().accepted.scene)
  assert.match(h.store.getSnapshot().pending.error,/RESOURCE_BUDGET/)
  ack.resolve();await tick()
})

// private fork: a deleted element is a successful degraded projection, not a retry.
test('removed asset accepts unaffected elements once with a short stable notice',async t=>{
  const value=frame(1,['right']);value.scene.backgroundUrl=null;value.notice='部分素材已移除，已跳过'
  const h=fixture(t,{frames:[value]});await tick()
  const state=h.store.getSnapshot(),count=h.presents.length
  assert.equal(state.projection,null)
  assert.equal(state.accepted.scene.backgroundUrl,null)
  assert.ok(state.accepted.figuresBySlot['figure:right'].url.startsWith('blob:'))
  assert.equal(state.pending.error,value.notice)
  assert.equal(state.pending.resources,false)
  h.clock.advance(10000);await tick()
  assert.equal(h.presents.length,count)
  assert.equal(h.store.getSnapshot().pending.error,value.notice)
})
