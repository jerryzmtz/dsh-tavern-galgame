import test from 'node:test'
import assert from 'node:assert/strict'
import {createManager,attachProvider,IDLE_TIMEOUT_MS} from '../src/manager.js'
import {createTts} from '../../dsh-tts/src/service.js'
import {createReferenceProvider} from '../../dsh-tts/src/providers/reference-api.js'
import {pcmWav} from '../../dsh-tts/src/providers/audio.js'
import {hash} from '../../dsh-tts/src/core.js'
const tick=()=>new Promise(setImmediate)
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r});return {promise,resolve}}
const audio=pcmWav(Buffer.alloc(8820),44100)
function clock() {
  let now=0,id=0;const timers=new Map()
  return {setTimeout(fn,ms){timers.set(++id,{fn,at:now+ms});return id},clearTimeout(id){timers.delete(id)},
    async tick(ms){now+=ms;for(const [id,t] of [...timers])if(t.at<=now){timers.delete(id);t.fn()}await tick();await tick()},count:()=>timers.size}
}
function fixture(t,{warm,render}={}) {
  const idleClock=clock(),calls=[],handles=[];let spawns=0,stops=0
  const settings={providerId:'local',modelConfigPath:'fixture.json',readinessTimeoutMs:600000,autoStart:false}
  const connection={id:'local',url:'http://127.0.0.1:19001',key:'fixture-only',fetch:async(url)=>{
    calls.push(url)
    if(url.endsWith('/v1/synthesize')){await render?.promise;return new Response(audio)}
    return Response.json(url.endsWith('/v1/voices')?{voices:[]}:{state:'ready',revision:'v1',protocol:'dsh-tts-reference-v1',capabilities:{voiceKinds:['reference'],paid:false}})
  }}
  const manager=createManager({getSettings:()=>settings,connection:async()=>connection,idleClock,
    prepare:async()=>({provider:connection,argv:['fixture']}),probe:async()=>{await warm?.promise;return {state:'ready',voices:[]}},
    shutdown:async()=>{stops++},subprocess:{spawn(){spawns++;const exit=deferred();handles.push(exit);return {done:exit.promise,terminate:()=>exit.resolve(),waitForExit:()=>exit.promise}}}})
  const tts=createTts(),off=attachProvider(manager,tts)
  t.after(async()=>{warm?.resolve();render?.resolve();off();await manager.dispose();await tts.dispose()})
  const voice={schemaVersion:1,id:'voice',label:'Fixture',enabled:true,kind:'reference',languages:['ja'],params:{},references:[{sha256:hash(audio),transcript:'reference',language:'ja'}]}
  tts.registerVoiceSource({owner:'test',sourceId:'fixture',revision:'one',voices:[voice],bindings:{voice:'local'},readReference:async()=>audio})
  const grant=tts.grantConsumer({principal:'browser',source:'fixture',scope:'test'})
  return {manager,tts,grant,idleClock,calls,settings,input:{voice:{source:'fixture',id:'voice'},language:'ja',text:'first'},counts:()=>({spawns,stops}),spec:{text:'first',language:'ja',params:{},reference:{sha256:hash(audio),bytes:audio,promptText:'reference',promptLanguage:'ja'}}}
}
test('cold scoped request stays pending, starts once, releases after one idle hour and wakes again',async t=>{
  const warm=deferred(),f=fixture(t,{warm});f.manager.activate();await tick()
  assert.equal((await f.tts.listServices())[0].id,'local')
  assert.equal((await f.tts.health({serviceId:'local'}))[0].state,'configured')
  assert.deepEqual(await f.tts.listProviderCatalog({serviceId:'local'}),[])
  assert.deepEqual(f.counts(),{spawns:0,stops:0});assert.equal(f.calls.length,0)
  const job=f.tts.jobs.submit(f.input,{principal:'browser',scope:'test'});await tick()
  assert.equal(job.timeoutMs,725000);assert.equal(f.tts.jobs.poll(job.requestId,'browser').state,'running')
  assert.equal(f.counts().spawns,1);assert.equal(f.calls.length,0)
  warm.resolve();for(let i=0;i<20&&f.tts.jobs.poll(job.requestId,'browser').state==='running';i++)await tick()
  assert.equal(f.tts.jobs.poll(job.requestId,'browser').state,'ready')
  assert.equal(f.manager.status().state,'ready')
  await f.idleClock.tick(IDLE_TIMEOUT_MS-1);assert.equal(f.counts().stops,0)
  await f.idleClock.tick(1);assert.equal(f.counts().stops,1);assert.equal(f.manager.status().state,'stopped')
  assert.equal((await f.tts.listServices()).length,1)
  await f.tts.synthesize({...f.input,text:'second'},{grant:f.grant.grant})
  assert.equal(f.counts().spawns,2)
})
test('concurrent first local requests join startup; active requests cannot be idle-stopped',async t=>{
  const warm=deferred(),render=deferred(),f=fixture(t,{warm,render})
  const provider=createReferenceProvider(await f.manager.connection())
  const one=provider.synthesize(f.spec,{}),two=provider.synthesize({...f.spec,text:'second'},{})
  await tick();assert.equal(f.counts().spawns,1)
  warm.resolve();await tick();await f.idleClock.tick(IDLE_TIMEOUT_MS*2)
  assert.equal(f.counts().stops,0);assert.equal(f.idleClock.count(),0)
  render.resolve();await Promise.all([one,two]);assert.equal(f.idleClock.count(),1)
  await f.idleClock.tick(IDLE_TIMEOUT_MS);assert.equal(f.counts().stops,1)
})
test('every routed request including a cache hit resets idle; discovery does not',async t=>{
  const f=fixture(t);await tick();await f.tts.synthesize(f.input,{grant:f.grant.grant})
  await f.idleClock.tick(IDLE_TIMEOUT_MS-100)
  assert.equal((await f.tts.synthesize(f.input,{grant:f.grant.grant})).cacheHit,true)
  await f.idleClock.tick(100);assert.equal(f.counts().stops,0)
  await f.tts.listServices();await f.tts.health({serviceId:'local'})
  await f.idleClock.tick(IDLE_TIMEOUT_MS-100);assert.equal(f.counts().stops,1)
})
test('aborted cold request releases its lifecycle hold and settings changes fence stale connection',async t=>{
  const warm=deferred(),f=fixture(t,{warm}),provider=createReferenceProvider(await f.manager.connection()),abort=new AbortController()
  const pending=provider.synthesize(f.spec,{signal:abort.signal});const rejected=assert.rejects(pending,{code:'ABORTED'})
  await tick();abort.abort();warm.resolve();await rejected
  assert.equal(f.idleClock.count(),1);await f.idleClock.tick(IDLE_TIMEOUT_MS);assert.equal(f.counts().stops,1)
  f.settings.readinessTimeoutMs=1000
  await assert.rejects(provider.synthesize(f.spec,{}),{code:'REVISION_CONFLICT'})
  assert.equal(f.counts().spawns,1)
})
