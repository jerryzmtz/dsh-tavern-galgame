import test from 'node:test'
import assert from 'node:assert/strict'
import {createForegroundCapabilities,foregroundCapabilityEpoch,foregroundCapabilityEntries,foregroundCapabilityInjection} from '../tavern-plugin/lib/domain/foreground-capabilities.js'
import {normalizeBubbleConfig} from '../tavern-plugin/lib/domain/dialogue-bubbles.js'
import {defaultJudgeConfig,validateJudgeConfig} from '../tavern-plugin/lib/domain/engine-judge.js'
import {projectWorldBookTemplates} from '../tavern-plugin/lib/domain/worldbook-recall.js'
import {createForegroundWorldbook} from '../tavern-plugin/lib/domain/foreground-worldbook.js'

const ref={packId:'pack_figure',figureId:'figure_guest'}
const character={alias:'actor_guest',name:'Guest',ref,recall:{mode:'constant'},emotions:[{id:'calm',label:'Calm'}]}
const config=()=>normalizeBubbleConfig({enabled:true,characters:[character],injection:{extra:'Player {{user}}'}})
const book=()=>({view:{displayName:'Book',entries:[
  {ref:'normal',enabled:true,constant:true,content:'World {{user}}',primaryKeys:[],secondaryKeys:[]},
  {ref:'old-format',enabled:true,constant:true,content:'OLD GENERATED TEXT',rawEntry:{extensions:{dsh_tavern_helper_extra:{forkDialogueBubbles:{version:1}}}}}
]}})
const runtime={render:async text=>({ok:true,text})}
const project=(chat,worldBook)=>projectWorldBookTemplates({chat,worldBook,runtime,includeConstants:true,card:{name:'Card'}})
const start=turn=>({type:'turn/start',data:{turn}})
function compact(id,error) {return [
  {type:'compaction/summary',data:{compactionId:id}},
  {type:'user/message',surfaceOp:{op:'replace'},data:{source:{compactionId:id}}},
  {type:'compaction/end',data:{compactionId:id,...(error?{error}: {})}},
]}

test('explicit correction refreshes frozen prose with CAS while normal preview remains read-only',async()=>{
  let live=config(),writes=0
  const chat={id:'correction-chat',sessionId:'correction-session',mode:'story',cardPath:'cards/test.json',messages:[]}
  const owner=createForegroundCapabilities({session:()=>({events:[start(1)]}),readConfig:async()=>live,render:project,
    save:async(_chat,snapshot,options)=>{if(options)assert.deepEqual(options.expected,chat.foregroundCapabilities);writes++;chat.foregroundCapabilities=structuredClone(snapshot)}})
  await owner.project(chat,book())
  const old=await owner.preview(chat)
  live.characters[0].emotions[0].guidance='A corrected mood note.'
  assert.deepEqual(await owner.preview(chat),old)
  await assert.rejects(owner.refresh(chat,[]),{code:'REVISION_CONFLICT'})
  assert.equal(writes,1)
  const next=await owner.refresh(chat,old)
  assert.match(JSON.stringify(next),/A corrected mood note/)
  assert.equal(writes,2)
  assert.deepEqual(await owner.preview(chat),next)
  assert.deepEqual(await owner.refresh(chat,next),next)
  assert.equal(writes,2,'replaying an explicit correction is a write-free noop')
})

test('foreground capability bytes persist across turns/restarts; only successful compaction before a new turn refreshes them',async()=>{
  let live=config(),reads=0,writes=0
  const session={events:[start(1)]},chat={id:'chat-test',sessionId:'session-test',mode:'story',cardPath:'cards/test.json',macroState:{userName:'Alice'},messages:[]}
  const deps={session:()=>session,readConfig:async()=>{reads++;return live},render:project,save:async(_chat,snapshot)=>{writes++;chat.foregroundCapabilities=structuredClone(snapshot)}}
  let owner=createForegroundCapabilities(deps)
  const first=await owner.project(chat,book()),text=(await project(chat,first)).prefixContext
  const bytes=JSON.stringify(foregroundCapabilityInjection(chat.foregroundCapabilities))
  assert.match(text,/Player Alice/);assert.doesNotMatch(text,/OLD GENERATED/)
  assert.ok(text.indexOf('<dialogue_format>') < text.indexOf('<speaker_roster>'))
  assert.match(text, /Each entry is/)
  assert.deepEqual((await owner.preview(chat)).map(row=>row.key), ['format','figure'])
  live=normalizeBubbleConfig({...live,enabled:false});chat.macroState.userName='Bob';session.events.push(start(2))
  owner=createForegroundCapabilities(deps)
  const second=await owner.project(chat,book())
  assert.equal(JSON.stringify(foregroundCapabilityInjection(chat.foregroundCapabilities)),bytes)
  assert.match((await project(chat,second)).prefixContext,/World Bob/)
  assert.match((await project(chat,second)).prefixContext,/Player Alice/)
  assert.equal(reads,1);assert.equal(writes,1)
  session.events.push(...compact('failed','model failure'),start(3))
  await owner.project(chat,book());assert.equal(reads,1)
  session.events.push(...compact('ok'))
  await owner.project(chat,book());assert.equal(reads,1,'overflow compaction cannot change this turn')
  session.events.push(start(4))
  const refreshed=await owner.project(chat,book())
  assert.equal((await project(chat,refreshed)).prefixContext,'World Bob')
  assert.equal(reads,2);assert.equal(writes,2)
  assert.equal(foregroundCapabilityEpoch(session),'ok')
})

test('empty figures equal capabilities-off; green figures use common recall and saved judge, without a model call',()=>{
  const chat={messages:[],macroState:{userName:'Player'}},green=normalizeBubbleConfig({...config(),characters:[{...character,recall:{mode:'keyword'}}]})
  assert.deepEqual(foregroundCapabilityEntries(green,chat),[])
  assert.deepEqual(foregroundCapabilityEntries({...green,enabled:false},chat),[])
  assert.ok(foregroundCapabilityEntries(green,chat,{userText:'Guest arrives.'}).length>0)
  chat.messages=[{role:'assistant',text:'A quiet day.',stageDirectionAssetPacks:{stats:{judge:{probabilities:[['figure:pack_figure/figure_guest',.9]]}}}}]
  const judge=validateJudgeConfig({provider:'jev',threshold:.6,capPerKind:1})
  assert.ok(foregroundCapabilityEntries(green,chat,{judge}).length>0)
  assert.deepEqual(foregroundCapabilityEntries(green,chat,{judge:{...judge,threshold:.95}}),[])
  assert.deepEqual(foregroundCapabilityEntries(green,chat,{judge:defaultJudgeConfig()}),[],'unset does not reuse historical smart additions')
  assert.deepEqual(foregroundCapabilityEntries(green,chat,{judge:{...judge,enabled:false}}),[])
  assert.equal(foregroundCapabilityEpoch({events:[start(1),...compact('unfinished').slice(0,2),start(2)]}), '')
})

test('real foreground recall shares the frozen entries while prefilter sees live books, and failed rendering is not frozen',async()=>{
  const chat={id:'chat-test',sessionId:'session-test',mode:'story',macroState:{userName:'Alice'},messages:[]}
  let fail=true,writes=0
  const owner=createForegroundCapabilities({session:()=>({events:[start(1)]}),readConfig:async()=>config(),
    render:async(...args)=>fail?{renderedEntries:[],diagnostics:[{code:'template-failed'}]}:project(...args),save:async()=>{writes++}})
  await assert.rejects(owner.project(chat,book()),/projection failed/)
  assert.equal(writes,0);assert.equal(chat.foregroundCapabilities,undefined)
  fail=false
  const foreground=createForegroundWorldbook({bound:async(_path,_card,current,{purpose,userText})=>purpose==='generation'?owner.project(current,book(),{userText}):book(),runtime:async()=>runtime,globalVariables:async()=>({})})
  const result=await foreground({chat,card:{name:'Card'},userText:''})
  assert.equal(result.error,null)
  const entries=foregroundCapabilityInjection(chat.foregroundCapabilities)
  for(const entry of entries)assert.ok(result.renderedEntries.some(row=>row.text===entry.text))
  const background=await foreground({chat,card:{name:'Card'},userText:'',purpose:'prefilter'})
  assert.ok(background.renderedEntries.some(row=>row.text==='OLD GENERATED TEXT'))
  assert.equal(writes,1)
})

test('native body preview uses recall and actual prefix order without accepting, saving, or mutating the next epoch',async()=>{
  // private fork: a preview must not lock a keyword decision before the player sends the next request.
  const chat={id:'preview',sessionId:'preview-session',mode:'story',macroState:{userName:'Alice'},messages:[{role:'assistant',text:'Quiet.'}]}
  const green={...character,alias:'actor_green',name:'Green',ref:{packId:'pack_green',figureId:'figure_green'},recall:{mode:'keyword',keywords:['summon']}}
  let live=normalizeBubbleConfig({...config(),characters:[character,green]}),reads=0,writes=0
  const owner=createForegroundCapabilities({session:()=>null,readConfig:async()=>{reads++;return live},render:project,save:async()=>{writes++}})
  const before=JSON.stringify(chat),preview=await owner.preview(chat)
  const entries=foregroundCapabilityEntries(live,chat).map(({foregroundCapability,...entry})=>entry)
  const actual=await project(chat,{view:{entries}})
  assert.equal(preview.map(row=>row.text).join('\n\n'),actual.prefixContext)
  assert.doesNotMatch(preview.map(row=>row.text).join('\n\n'),/Green/)
  assert.equal(JSON.stringify(chat),before);assert.equal(writes,0)
  live=normalizeBubbleConfig({...live,enabled:false})
  const sent=await owner.project(chat,null)
  assert.deepEqual(sent.view.entries,[],'Preview must not freeze the prior live configuration')
  assert.equal(reads,2);assert.equal(writes,1)
})

test('native body preview retains rendered snapshot bytes, but a compaction preview cannot replace persistent history',async()=>{
  const session={events:[start(1)]},chat={id:'frozen-preview',sessionId:'frozen-preview-session',mode:'story',macroState:{userName:'Alice'},messages:[]}
  let live=config(),reads=0,writes=0
  const owner=createForegroundCapabilities({session:()=>session,readConfig:async()=>{reads++;return live},render:project,
    save:async(_chat,snapshot)=>{writes++;chat.foregroundCapabilities=structuredClone(snapshot)}})
  const accepted=await owner.project(chat,null),body=await project(chat,accepted)
  live=normalizeBubbleConfig({...live,enabled:false});chat.macroState.userName='Bob'
  const before=JSON.stringify(chat),preview=await owner.preview(chat)
  assert.equal(preview.map(row=>row.text).join('\n\n'),body.prefixContext)
  assert.match(preview.map(row=>row.text).join('\n\n'),/Player Alice/)
  assert.equal(reads,1);assert.equal(writes,1);assert.equal(JSON.stringify(chat),before)
  session.events.push(...compact('next'),start(2))
  assert.deepEqual(await owner.preview(chat),[])
  assert.equal(JSON.stringify(chat),before);assert.equal(writes,1)
  assert.equal((await owner.project(chat,null)).view.entries.length,0)
  assert.equal(writes,2)
})

test('body preview joins an already-started generation instead of compiling a competing epoch',async()=>{
  const chat={id:'concurrent',sessionId:'concurrent-session',mode:'story',macroState:{userName:'Alice'},messages:[]}
  let live=config(),reads=0,writes=0,release,started
  const barrier=new Promise(resolve=>{release=resolve}),ready=new Promise(resolve=>{started=resolve})
  const owner=createForegroundCapabilities({session:()=>null,readConfig:async()=>{reads++;return live},
    render:async(current,book)=>{if(reads===1 && !current.foregroundCapabilities){started();await barrier}return project(current,book)},
    save:async()=>{writes++}})
  const generation=owner.project(chat,null);await ready
  live=normalizeBubbleConfig({...live,enabled:false})
  const preview=owner.preview(chat);release()
  const [accepted,shown]=await Promise.all([generation,preview])
  assert.equal(shown.map(row=>row.text).join('\n\n'),(await project(chat,accepted)).prefixContext)
  assert.match(shown.map(row=>row.text).join('\n\n'),/Guest/)
  assert.equal(reads,1);assert.equal(writes,1)
})
