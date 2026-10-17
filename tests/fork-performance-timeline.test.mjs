import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import {readFile} from 'node:fs/promises'
import {createRequire} from 'node:module'
import {harness,drain,fixtureScale} from './helpers/stage-resource-harness.mjs'
const require=createRequire(import.meta.url)
const {createPerformanceTimeline}=require('../fork/mods/performance/timeline.cjs')
const {createStageRuntimeState}=require('../tavern-plugin/src/client/fork-stage-runtime.cjs')
const {createStageRuntimeStore}=require('../tavern-plugin/src/client/fork-stage-runtime-store.cjs')
const {compilePerformance,performancePlan,performanceSustained}=require('../fork/mods/performance/state.cjs')
const foregroundSource=await readFile(new URL('../tavern-plugin/src/client/fork-foreground.js',import.meta.url),'utf8')
function clock() {
  let time=0,id=0; const jobs=new Map(),host=new EventTarget(),doc=new EventTarget()
  Object.assign(doc,{visibilityState:'visible',hasFocus:()=>true})
  Object.assign(host,{performance:{now:()=>time},console,setTimeout(fn,ms){const key=++id;jobs.set(key,{fn,at:time+ms});return key},clearTimeout(key){jobs.delete(key)}})
  host.requestAnimationFrame=fn=>host.setTimeout(fn,16);host.cancelAnimationFrame=host.clearTimeout
  vm.runInNewContext(foregroundSource,{window:host,document:doc})
  return {api:host.forkForeground,visible(value){doc.visibilityState=value?'visible':'hidden';doc.dispatchEvent(new Event('visibilitychange'))},advance(ms){const end=time+ms;for(;;){const job=[...jobs].sort((a,b)=>a[1].at-b[1].at)[0];if(!job||job[1].at>end)break;time=job[1].at;jobs.delete(job[0]);job[1].fn()}time=end}}
}
const ref=id=>({packId:'pack',kind:'music',assetId:id})
function fixture(overrides={},ready=true) {
  const f=clock(),source={sessionId:'s',sourceKey:'source',branchId:'branch',generation:1,turn:1,authorityEpoch:1}
  const token={source,instanceKey:['source','branch',1,0,0],phaseKey:[['source','branch',1,0,0],'source',0,0],visitId:1,playbackEpoch:1}
  const compiled=compilePerformance({bgm:{ref:ref('a')},timeline:{entry:{events:[{at:100,do:'flash',ms:100,color:'#ffffff'}]},turn:{onLevel:3,events:[{at:600,do:'bgm',ref:ref('b')}]},exit:{events:[]}}})
  const plan={...performancePlan(compiled,{phase:'entry',level:3}),...overrides}
  const state=createStageRuntimeState(); Object.assign(state,{source,playbackEpoch:1,cursor:{...state.cursor,visitId:1,anchor:{para:1,offset:0,paragraphId:'p'},firstPageEligible:true},performancePlayback:{token,mode:'start',layer:{skin:null,bgm:plan.bgm,look:null,ambience:null,widgets:{}}}})
  state.accepted.performance={...token,plan};state.ledger[JSON.stringify(['performance-phase',token.instanceKey,token.phaseKey])]={status:'pending',descriptor:{kind:'performance-phase'},lastCompletedCycle:-1}
  const effects=[],snaps=[]
  const store=createStageRuntimeStore({initialState:state,runEffect(intent,dispatch){effects.push({...intent,at:f.api.now()});if(ready && intent.type==='prepare-one-shot')dispatch({type:'ONE_SHOT_READY',token:intent.token})}})
  const timeline=createPerformanceTimeline({foreground:f.api,ledger:{due:e=>store.dispatch({type:'PERFORMANCE_EVENT_DUE',...e}),consumed:e=>store.dispatch({type:'PERFORMANCE_PHASE_CONSUMED',...e}),cycle:e=>store.dispatch({type:'PERFORMANCE_CYCLE_COMPLETED',...e})},sinks:{sustained:o=>snaps.push(performanceSustained(o.plan))},isCurrent:t=>JSON.stringify(t)===JSON.stringify(store.getSnapshot().performancePlayback?.token)})
  return {...f,token,plan,timeline,store,effects,snaps,start:()=>timeline.start({token,plan,handles:[]})}
}
test('production runner keeps a prepared timeline/BGM across refresh and cancels to sustained on stage close',async t=>{
  const {createForkBgm}=require('../tavern-plugin/src/client/fork-bgm-player.cjs')
  let bgm,playing=null; const calls=[],fades=[]
  const h=await harness(t,undefined,undefined,{music:()=>bgm})
  await h.direct()
  h.store.dispatch({type:'SESSION_INPUTS',settings:{config:{stage:{enabled:true,music:true}}}})
  bgm=createForkBgm({music:{get:()=>({identity:playing,current:playing,paused:false}),play(url,snap,id,options){playing=id;calls.push(id);fades.push(options?.fadeMs)},stop(){playing=null},pause(){},resume(){}},owner:()=>h.owner,session:()=>h.store,read:async()=>({tracks:[]}),authority:source=>JSON.stringify([source.sessionId,source.authorityEpoch])})
  bgm.activate('session');t.after(()=>bgm.dispose())
  const dep=(id,kind='music')=>({role:'required',ref:{packId:'performance-pack',kind,assetId:id},identity:id,url:{resource:true,kind:'media',ref:{packId:'performance-pack',kind,assetId:id},identity:id,hash:id,revision:'pack-1'}})
  const a=dep('a'),b=dep('b'),fx=dep('fx','sfx')
  const compiled=compilePerformance({bgm:{ref:a.ref,lock:true,fadeInMs:600},timeline:{entry:{events:[{at:100,do:'sfx',ref:fx.ref},{at:600,do:'bgm',ref:b.ref}]},exit:{events:[]}}})
  const plan=performancePlan(compiled,{phase:'entry',level:1})
  const value={scene:{},characters:[],avatars:[],widgets:[],state:{lighting:{},figureScale:fixtureScale},audio:{music:null,soundscape:null},performance:{ref:{packId:'performance-pack',kind:'performances',assetId:'show'},instanceKey:['s',0,0],phaseKey:['entry'],phase:'entry',plan,restore:{previous:null,directorRequest:null},dependencies:[a,b,fx],executionDependencies:[]}}
  h.setResponse(()=>({status:'ready',directionToken:h.store.getSnapshot().director.token,value:structuredClone(value)}));h.refresh();await drain()
  assert.equal(playing,'a');assert.equal(fades[0],600,'initial acquire uses authored fade, not the player default');h.clock.advance(100);await drain();assert.equal(h.plays.length,1)
  h.refresh();await drain();h.clock.advance(500);await drain();assert.equal(playing,'b');assert.equal(calls.filter(v=>v==='b').length,1)
  h.refresh();await drain();h.clock.advance(100);await drain();assert.equal(h.plays.length,1)
  h.store.dispatch({type:'STAGE_OPEN',opened:false});await drain();assert.equal(playing,'b')
  h.store.dispatch({type:'STAGE_OPEN',opened:true});await drain();h.clock.advance(1000);await drain()
  assert.equal(h.plays.length,1,'remount seeks without SFX replay');assert.equal(playing,'b')
})

test('real foreground clock: high entry precedes turn +600 once; hiding five minutes does not catch up',()=>{
  const f=fixture();f.start();f.advance(300);f.visible(false);f.advance(300000)
  assert.equal(f.effects.filter(e=>e.descriptor?.do==='bgm').length,0)
  f.visible(true);f.advance(499);assert.equal(f.effects.filter(e=>e.descriptor?.do==='bgm').length,0)
  f.advance(1);assert.equal(f.effects.filter(e=>e.descriptor?.do==='bgm').length,1)
  assert.equal(f.effects.find(e=>e.descriptor?.do==='bgm').at,800)
  f.start();f.advance(2000);assert.equal(f.effects.filter(e=>e.descriptor?.do==='bgm').length,1)
  f.timeline.dispose();assert.equal(f.api.state().timers,0)
})
test('pause reasons preserve remaining time and independent resume cannot wake another pause',()=>{
  const f=fixture();f.start();f.advance(50);f.timeline.pause('reader');f.timeline.pause('modal');f.advance(2000)
  f.timeline.resume('reader');f.advance(1000);assert.equal(f.effects.length,0)
  f.timeline.resume('modal');f.advance(49);assert.equal(f.effects.length,0);f.advance(1)
  assert.equal(f.effects[0].descriptor.do,'flash');f.timeline.dispose()
})
test('seek, skip and stale callbacks never replay entry/SFX; sustained uses the shared fold',()=>{
  const f=fixture();f.timeline.seek({token:f.token,plan:f.plan,handles:[],to:'sustained'});f.advance(5000)
  assert.deepEqual(f.snaps,[performanceSustained(f.plan)]);assert.equal(f.effects.filter(e=>e.type==='performance-event').length,0)
  f.start();f.store.dispatch({type:'SKIP_START'});f.advance(5000)
  assert.equal(f.effects.filter(e=>e.type==='performance-event').length,0);f.timeline.dispose()
})
test('positive/negative cue offsets and callback/preplanned keys consume once through the original ledger',()=>{
  const f=fixture({events:[{do:'cue',cueId:'early',ordinal:0,at:200},{do:'cue',cueId:'late',ordinal:1,at:300}],durationMs:500,sfxMap:{early:{ref:ref('sfx'),offsetMs:-100},late:{ref:ref('sfx'),offsetMs:100}}})
  f.start();f.advance(100);assert.equal(f.effects.filter(e=>e.type==='play-one-shot').length,1)
  f.advance(100);f.timeline.cue({token:f.token,cueId:'early',ordinal:0,cycle:0,atMs:200});f.advance(0)
  assert.equal(f.effects.filter(e=>e.type==='play-one-shot').length,1)
  f.advance(200);assert.equal(f.effects.filter(e=>e.type==='play-one-shot').length,2);f.timeline.dispose()
})
test('late performance one-shot readiness is skipped after the playback epoch changes',()=>{
  const f=fixture({events:[{do:'sfx',ref:ref('sfx'),block:'entry',ordinal:0,at:100}],durationMs:100},false)
  f.start();f.advance(100);const token=f.effects.find(e=>e.type==='prepare-one-shot').token
  f.store.dispatch({type:'SKIP_START'});f.store.dispatch({type:'ONE_SHOT_READY',token})
  assert.equal(f.store.getSnapshot().ledger[token.key].status,'skipped')
  assert.equal(f.effects.filter(e=>e.type==='play-one-shot').length,0);f.timeline.dispose()
})
test('replacement schedules finite retiring events before the new entry and seek ignores retirement',()=>{
  const f=fixture({events:[{at:0,do:'flash',block:'entry',ordinal:0,ms:100}],durationMs:100})
  f.timeline.start({token:f.token,plan:f.plan,retiring:{plan:{events:[{at:0,do:'shake',block:'exit',ordinal:0,ms:100}],durationMs:100}}})
  f.advance(0);assert.equal(f.effects[0].descriptor.do,'shake');assert.equal(f.effects[0].descriptor.retiring,true)
  f.advance(99);assert.equal(f.effects.filter(e=>e.type==='performance-event').length,1)
  f.advance(1);assert.equal(f.effects.filter(e=>e.type==='performance-event').at(-1).descriptor.do,'flash');f.timeline.dispose()
})
test('deterministic idle scheduling collapses old cycles in the existing ledger',()=>{
  const run=()=>{const f=fixture({events:[],durationMs:0,idleEvery:[3000,4000],idleEvents:[{at:0,do:'flash',ms:100,block:'idle',ordinal:0}]});f.start();f.advance(1000000);const times=f.effects.filter(e=>e.type==='performance-event').map(e=>e.at);assert.ok(times.length>200);assert.ok(Object.keys(f.store.getSnapshot().ledger).length<=2);f.timeline.dispose();return times}
  assert.deepEqual(run(),run())
})
