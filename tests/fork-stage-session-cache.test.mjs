// private fork: real session/index/reducer/director/resource owners, not a cache-only mock.
import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {performance} from 'node:perf_hooks'
import {fixture,answer} from './helpers/stage-director-harness.mjs'
import {sessionHarness,nativeNode} from './helpers/stage-session-harness.mjs'
import {createFakeClock} from './helpers/stage-runtime-harness.mjs'
import {readStageProjection} from '../tavern-plugin/lib/domain/stage-projection.js'
const require = createRequire(import.meta.url)
const {createStageDirectorSource} = require('../tavern-plugin/src/client/fork-stage-director-source.cjs')
const {createStageResourceRunner} = require('../tavern-plugin/src/client/fork-stage-resource-runner.cjs')
const {createStageResourceOwner} = require('../tavern-plugin/src/client/fork-stage-resources.cjs')
const {stageRuntimeIndicators} = require('../tavern-plugin/src/client/fork-stage-runtime.cjs')
const tick = () => new Promise(resolve => setImmediate(resolve))
async function until(check) {
  for(let i=0;i<500;i++) {if(check()) return; await tick()}
  assert.fail('session cache work did not settle')
}
async function cacheHarness(t,count=3) {
  const f = await fixture(request => request.onToolCall({name:'stage_update',arguments:answer}),{sessionId:'s'})
  for(let turn=1;turn<=count;turn++) {
    if(turn>1) f.appendReply(turn)
    await f.director.get(f.read(),turn); await f.director.drain()
  }
  const clock = createFakeClock(), calls = {direction:[],projection:[],bytes:0,decode:0}, notices=[],prefetched=new Set()
  let serial=0, presentAt=0
  const owner=createStageResourceOwner({service:f.services.get('assetLibrary'),avatarBitmap:async()=>null,
    urls:{createObjectURL:()=> 'blob:'+ ++serial,revokeObjectURL(){}},
    fetch:async()=>{calls.bytes++;return new Response('fixture pixels',{headers:{'content-type':'image/png'}})},
    decode:async()=>{calls.decode++;return {naturalWidth:16,naturalHeight:16}}})
  const resources=createStageResourceRunner({clock,owner,present:()=>{presentAt=performance.now()},read:async args=>{
    calls.projection.push(args)
    return readStageProjection({...args,readDirection:()=>f.director.get(f.read(),args.turn,null,{readOnly:true}),
      readConsumer:()=>f.assets.consumer(f.read(),'http://localhost'),readSettings:f.engineSettings.read,revision:()=>f.assets.revision})
  }})
  const read=async args=>{calls.direction.push(args);return f.director.get(f.read(),args.turn,null,args)}
  const director=createStageDirectorSource({clock,read,onEffect:resources.onEffect,
    watch:(source,wake)=>f.signals.subscribe(source.sessionId,'stage-direction',wake)})
  const h=sessionHarness({nodes:Array.from({length:count},(_,i)=>nativeNode(i+1,'Synthetic fixture.\n\nSynthetic dusk.')),
    view:{historyWindow:{revision:1},latestAssistantTurn:count},
    readHistory:(args,source,text)=>director.cached(source,text)||read(args),
    ownerOptions:{opened:false,runEffect:director.runEffect,primeHistory:director.prime,
      invalidateHistory(id){director.invalidate(id);resources.invalidate(id)},invalidatePresentation:resources.invalidate,
      async prefetchHistory(source,envelope){await resources.prefetch(source,envelope);prefetched.add(source.turn)}}})
  const store=h.owner.get('s'), indicator=store.select(stageRuntimeIndicators)
  const stop=indicator.subscribe(()=>notices.push(indicator.getSnapshot()))
  t.after(async()=>{stop();indicator.dispose();h.dispose();director.dispose();resources.dispose();await f.dispose()})
  await until(()=>h.state().director.complete&&!h.state().projection)
  return {...h,f,clock,calls,notices,prefetched,resources,director,resourceOwner:owner,store,
    counts:()=>[calls.direction.length,calls.projection.length,calls.bytes,calls.decode],
    open:()=>store.dispatch({type:'STAGE_OPEN',opened:true}),
    async visit(turn,index=0) {
      const started=performance.now();presentAt=0
      await h.owner.navigate('s',turn,index,turn===count)
      await until(()=>h.state().source.turn===turn&&!h.state().projection&&h.state().director.complete)
      return {acceptedMs:performance.now()-started,presentMs:presentAt?presentAt-started:0}
    }}
}

test('opening warms only the adjacent boundary; real back/forward across visited turns has zero RPCs, decodes or notices',async t=>{
  const h=await cacheHarness(t)
  h.open()
  await until(()=>h.prefetched.has(2)&&!h.state().observation.flight)
  assert.equal(h.prefetched.has(1),false,'opening must not eagerly prepare two previous turns')
  const initial=h.counts()
  assert.equal(initial[0],3,'one current observation, open refresh, and only the adjacent hydration')
  const first=await h.visit(2,-1)
  await until(()=>h.prefetched.has(1)&&h.prefetched.has(3))
  const before=h.counts(), samples=[]
  for(const turn of [1,2,3,2,1,2,3,2,1,2,3]) samples.push(await h.visit(turn))
  assert.deepEqual(h.counts(),before,'direction/projection RPC, byte fetch and image decode counts stay unchanged')
  assert.equal(h.resourceOwner.debug().maxBytes,2*1024**3)
  assert.ok(h.notices.every(notice=>!notice.spinner&&!notice.loading))
  assert.ok(first.acceptedMs<100)
  assert.ok(samples.every(sample=>sample.acceptedMs<100))
  t.diagnostic(JSON.stringify({firstPrefetchedCrossing:first,revisitMaxMs:Math.max(...samples.map(s=>s.acceptedMs)),
    revisitMeanMs:samples.reduce((n,s)=>n+s.acceptedMs,0)/samples.length,countsBefore:before,countsAfter:h.counts(),
    resourceBytes:h.resourceOwner.snapshot().bytes}))
})

test('approaching a boundary hydrates its adjacent turn before crossing; source changes reject stale speculation',async t=>{
  const h=await cacheHarness(t,5)
  h.open();await until(()=>h.prefetched.has(4))
  assert.equal(h.state().textIndex.get(3).unloaded,true,'second previous turn stays cold until approached')
  assert.equal(h.state().textIndex.get(2).unloaded,true)
  await h.visit(4,0)
  await until(()=>h.prefetched.has(3))
  await h.visit(3,0)
  await until(()=>h.prefetched.has(2))
  const reads=h.calls.direction.filter(args=>args.turn===2).length
  const crossing=await h.visit(2,-1)
  assert.equal(h.calls.direction.filter(args=>args.turn===2).length,reads)
  assert.equal(h.notices.some(notice=>notice.spinner||notice.loading),false)
  assert.ok(crossing.acceptedMs<100)
  // private fork (B2b): a storage revision (reading progress, playback metadata) keeps loaded rows; a lifecycle change withdraws them.
  h.view({historyWindow:{revision:2}})
  assert.equal(h.state().textIndex.get(2).unloaded,false,'a storage revision keeps hydrated rows')
  h.view({tavernHelper:{lifecycleRevision:1}})
  assert.equal(h.state().textIndex.get(2).unloaded,true,'new history authority withdraws hydrated rows')
  t.diagnostic(JSON.stringify({adjacentPrefetchedCrossing:crossing,turn2DirectionReads:reads}))
})

test('pack refresh invalidates cached presentation inputs, while unchanged resource hashes still decode once',async t=>{
  const h=await cacheHarness(t)
  h.open();await until(()=>h.prefetched.has(2))
  await h.visit(2)
  const before=h.counts()
  h.store.dispatch({type:'REFRESH_BEGIN',source:h.state().source})
  await until(()=>!h.state().projection)
  assert.ok(h.counts()[1]>before[1])
  assert.equal(h.counts()[3],before[3])
})
