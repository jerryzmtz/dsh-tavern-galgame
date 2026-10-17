// private fork: synthetic timeline, leases and clock; no live media or TTS requests.
import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {readFile} from 'node:fs/promises'
import vm from 'node:vm'
import {createFakeClock,runtimeSource,runtimePage,runtimeText,runtimeDirection} from './helpers/stage-runtime-harness.mjs'
const require = createRequire(import.meta.url)
const {createStageResourceOwner} = require('../tavern-plugin/src/client/fork-stage-resources.cjs')
const {createStageResourceRunner} = require('../tavern-plugin/src/client/fork-stage-resource-runner.cjs')
const {createStageRuntimeStore} = require('../tavern-plugin/src/client/fork-stage-runtime-store.cjs')
const {stageRuntimeIndicators} = require('../tavern-plugin/src/client/fork-stage-runtime.cjs')
const tick = async () => {for(let i=0;i<300;i++) await Promise.resolve()}
const deferred = () => {let resolve;const promise=new Promise(r=>{resolve=r});return {promise,resolve}}
const descriptor = identity => ({resource:true,kind:'media',identity,hash:identity,revision:'v1',ref:{packId:'fixture',kind:'backgrounds',assetId:identity}})
const frame = (at, unique = false) => ({
  state:{figureScale:{version:6,scene:0,hMax:150,rescales:0},lighting:{}},
  scene:{backgroundUrl:descriptor(unique ? 'background-'+at : 'background')},
  characters:[{url:descriptor(unique ? 'expression-'+at : 'figure')}],avatars:[],widgets:[],
  audio:{music:{url:descriptor('music')},soundscape:{layers:[{url:descriptor('ambience')}]},sfx:[{url:descriptor('sfx-'+at)}]}
})
function fixture(t,{count=4,unique=false,blockBytes,blockRead,maxBytes,maxItems}={}) {
  const clock=createFakeClock(),source=runtimeSource(),token={digest:'fixture'},reads=[],leases=[],notices=[],presents=[]
  const owner=createStageResourceOwner({maxBytes,maxItems,service:{async leaseMedia({hash}){leases.push(hash);return {ticket:hash,revision:'v1',url:'/fixture/'+hash}},releaseLease(){}},
    urls:{createObjectURL:blob=>'blob:'+leases.length+':'+blob.size,revokeObjectURL(){}},
    fetch:async url=>{await blockBytes?.(url);return new Response('bytes')}})
  const runner=createStageResourceRunner({clock,owner,read:async args=>{reads.push(args);await blockRead?.(args);return {status:'ready',directionToken:token,value:frame(args.at,unique)}},present:(_id,intent)=>presents.push(intent)})
  const store=createStageRuntimeStore({runEffect:(...args)=>runner.onEffect('session-1',...args)})
  const selector=store.select(stageRuntimeIndicators,(a,b)=>a.loading===b.loading)
  const off=selector.subscribe(()=>notices.push(selector.getSnapshot().loading))
  t.after(()=>{off();selector.dispose();store.dispose();runner.dispose()})
  store.dispatch({type:'TURN_CHANGED',source,text:runtimeText(1,Array.from({length:count},(_,i)=>runtimePage(i+1)))})
  store.dispatch({type:'DIRECTOR_SNAPSHOT',source,envelope:runtimeDirection(1,count,{phase:'done',complete:true,token})})
  return {store,clock,owner,reads,leases,notices,presents,source,token,runner}
}

test('lookahead warms backgrounds/time variants, expressions, music, ambience and SFX before later page display',async t=>{
  const h=fixture(t,{unique:true});await tick()
  assert.deepEqual([...new Set(h.reads.map(x=>x.at))].sort(),[1,2,3,4])
  for(let at=1;at<=4;at++) assert.equal(h.owner.isPrepared(frame(at,true),JSON.stringify(['session-1',1])),true)
  const leases=h.leases.length,pins=h.owner.snapshot().pins
  assert.ok(pins>0)
  for(let index=1;index<4;index++) {h.store.dispatch({type:'PAGE',index});await tick();h.clock.advance(601)}
  assert.equal(h.leases.length,leases,'preloaded pages never issue another lease')
  assert.deepEqual(h.notices,[],'no loading state on warmed page transitions')
})

test('repeated identities and subtitle visits produce zero pending notices and no duplicate leases',async t=>{
  const h=fixture(t);await tick()
  const leases=h.leases.length
  for(const index of [1,2,1,0,3]) {h.store.dispatch({type:'PAGE',index});await tick();h.clock.advance(601)}
  assert.equal(h.leases.length,leases)
  assert.equal(h.leases.filter(x=>x==='background').length,1)
  assert.deepEqual(h.notices,[])
})

test('only cold current visual media shows a notice at 600ms; ready clears it immediately',async t=>{
  const bytes=deferred(),h=fixture(t,{blockBytes:url=>url.endsWith('/background')?bytes.promise:null})
  await tick();h.clock.advance(599);assert.deepEqual(h.notices,[])
  h.clock.advance(1);assert.deepEqual(h.notices,[true])
  bytes.resolve();await tick();assert.deepEqual(h.notices,[true,false])
})

test('slow projection RPC, background prefetch and music never show the blocking notice',async t=>{
  const read=deferred(),bytes=deferred(),h=fixture(t,{unique:true,blockRead:()=>read.promise,
    blockBytes:url=>url.endsWith('/background-2')||url.endsWith('/music')?bytes.promise:null})
  h.clock.advance(1500);assert.deepEqual(h.notices,[])
  read.resolve();await tick();h.clock.advance(1500)
  assert.deepEqual(h.notices,[])
  assert.ok(h.store.getSnapshot().accepted.scene)
  bytes.resolve();await tick();assert.deepEqual(h.notices,[])
})

test('warm reads are bounded to two workers and turn replacement releases warm pins, including late results',async t=>{
  const gate=deferred(),h=fixture(t,{count:10,unique:true,blockRead:args=>args.at>1?gate.promise:null})
  await tick();assert.equal(h.reads.length,3,'one foreground read and two warm workers')
  const pins=h.owner.snapshot().pins
  h.store.dispatch({type:'TURN_CHANGED',source:{...h.source,turn:2,sourceKey:'node-2'},text:runtimeText(1,[runtimePage(1)])})
  assert.ok(h.owner.snapshot().pins<pins,'old turn warm pins are released without dropping last-good')
  const after=h.owner.snapshot().pins
  gate.resolve();await tick();assert.equal(h.owner.snapshot().pins,after)
  assert.equal(h.reads.length,3,'cancelled workers cannot continue the old turn')
  assert.deepEqual(h.notices,[])
})

test('leaving a blocked page cancels its delayed notice',async t=>{
  const bytes=deferred(),h=fixture(t,{unique:true,blockBytes:url=>url.endsWith('/background-1')?bytes.promise:null})
  await tick();h.clock.advance(400);h.store.dispatch({type:'PAGE',index:1});await tick();h.clock.advance(600)
  assert.deepEqual(h.notices,[])
  bytes.resolve();await tick();assert.deepEqual(h.notices,[])
})

// private fork: exercise the current index-backed demand path, not the legacy window helper.
test('voice lookahead deduplicates the entire current and next turn',async()=>{
  const source=await readFile(new URL('../tavern-plugin/src/client/fork-stage-ui.js',import.meta.url),'utf8')
  const context={forkStageVoiceHandle:(_session,voice)=>voice,forkStageVoiceAvailable:()=>true} // private fork: one TTS lookup per window
  vm.runInNewContext(source.slice(source.indexOf('function forkStageVoiceWindowFromIndex('),source.indexOf('// The runner awaits'))+';this.windowFromIndex=forkStageVoiceWindowFromIndex;',context)
  const voice=id=>({owner:'session:stage',id})
  const pages=[...Array.from({length:12},()=>({voice:voice('current')})),{pending:true,voice:voice('partial')},{voice:voice('next')}]
  const later=Array.from({length:9},(_,n)=>({voice:voice('later-'+n),anchor:{paragraphId:'later-'+n}}))
  const index=new Map([[1,{text:{pages}}],[2,{text:{pages:later}}]])
  const handles=context.windowFromIndex('session',index,1,pages,0,{})
  // private fork: whole-turn prefetch, not the retired eight-clip window.
  assert.deepEqual(Array.from(handles,h=>h.id),['current','next','later-0','later-1','later-2','later-3','later-4','later-5','later-6','later-7','later-8'])
})

// private fork: foreground playback must complete even when a sealed turn cannot stay warm.
test('prefetch pressure never rejects current page resources and paging stays live',async t=>{
  const h=fixture(t,{count:20,unique:true,maxBytes:40,maxItems:8})
  await tick()
  for(const index of [0,1,8,19,0]) {
    h.store.dispatch({type:'PAGE',index});await tick()
    for(let i=0;i<3 && h.store.getSnapshot().projection;i++){h.clock.advance(700);await tick()}
    const state=h.store.getSnapshot()
    assert.equal(state.projection,null)
    assert.equal(state.pending.resources,false)
    assert.ok(state.accepted.scene.backgroundUrl.startsWith('blob:'))
    assert.ok(state.accepted.figures[0].url.startsWith('blob:'))
    assert.ok(!state.pending.error?.includes('RESOURCE_BUDGET'))
  }
  assert.ok(h.owner.snapshot().bytes<=40)
})

test('an impossible current page degrades, retries after handoff and never remains pending',async t=>{
  const h=fixture(t,{count:3,unique:true,maxBytes:5,maxItems:1})
  await tick();for(let i=0;i<4;i++){h.clock.advance(700);await tick()}
  const state=h.store.getSnapshot()
  assert.equal(state.projection,null)
  assert.equal(state.pending.resources,false)
  assert.equal(state.pending.projection,false)
  assert.ok(state.pending.error)
  assert.ok(h.owner.snapshot().bytes<=5)
  h.store.dispatch({type:'PAGE',index:1});await tick()
  for(let i=0;i<4;i++){h.clock.advance(700);await tick()}
  assert.equal(h.store.getSnapshot().projection,null)
  assert.equal(h.store.getSnapshot().pending.resources,false)
})

test('terminal byte failure clears both pending flags after bounded retry',async t=>{
  const h=fixture(t,{blockBytes:()=>{throw Error('offline fixture')}})
  await tick();h.clock.advance(700);await tick();h.clock.advance(700);await tick()
  assert.equal(h.store.getSnapshot().projection,null)
  assert.equal(h.store.getSnapshot().pending.resources,false)
  assert.equal(h.store.getSnapshot().pending.projection,false)
  assert.match(h.store.getSnapshot().pending.error,/offline fixture/)
})

test('background handoff releases outgoing pins before one bounded recovery fills figures',async t=>{
  const h=fixture(t,{count:2,unique:true,maxBytes:25,maxItems:5})
  await tick()
  h.store.dispatch({type:'PAGE',index:1});await tick()
  for(let i=0;i<3 && h.store.getSnapshot().projection;i++){h.clock.advance(700);await tick()}
  const state=h.store.getSnapshot()
  assert.equal(state.projection,null)
  assert.equal(state.pending.resources,false)
  assert.ok(state.accepted.scene.backgroundUrl.startsWith('blob:'))
  assert.equal(state.accepted.figures.length,1)
  assert.equal(state.pending.error,null)
  assert.ok(h.owner.snapshot().bytes<=25)
})
// private fork: cold foreground projection and visual bytes outrank whole-turn RPC/pin warming.
test('first page receives all foreground preparation before whole-turn preload starts', async t=>{
  const read=deferred(),bytes=deferred()
  const h=fixture(t,{unique:true,blockRead:args=>args.at===1?read.promise:null,
    blockBytes:url=>url.endsWith('/background-1')?bytes.promise:null})
  await tick()
  assert.deepEqual(h.reads.map(r=>r.at),[1])
  read.resolve();await tick()
  assert.deepEqual(h.reads.map(r=>r.at),[1])
  assert.ok(!h.leases.includes('sfx-1'),'no speculative current-page pins before presentation')
  bytes.resolve();await tick()
  assert.ok(h.store.getSnapshot().accepted.scene)
  assert.ok(h.reads.some(r=>r.at===2))
})

test('a large turn warms only a moving lookahead and adjacent history boundaries',async t=>{
  const h=fixture(t,{count:200,unique:true});await tick()
  assert.deepEqual([...new Set(h.reads.map(r=>r.at))].sort((a,b)=>a-b),[1,2,3,4])
  assert.equal(h.leases.includes('expression-200'),false,'offstage distant figure is not prepared up front')
  h.store.dispatch({type:'PAGE',index:1});await tick()
  assert.deepEqual([...new Set(h.reads.map(r=>r.at))].sort((a,b)=>a-b),[1,2,3,4,5])
  h.store.dispatch({type:'PAGE',index:99});await tick()
  assert.ok(h.store.getSnapshot().accepted.scene.backgroundUrl.startsWith('blob:'),'jump still loads its actual state')
  assert.ok(h.reads.some(r=>r.at===100))
  h.reads.length=0
  await h.runner.prefetch({...h.source,turn:2},{complete:true,token:h.token,through:200})
  assert.deepEqual([...new Set(h.reads.map(r=>r.at))].sort((a,b)=>a-b),[1,2,3,198,199,200])
})