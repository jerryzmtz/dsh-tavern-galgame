import test from 'node:test'
import assert from 'node:assert/strict'
import {createModStageCorrections} from '../tavern-plugin/lib/domain/mods/stage-corrections.js'
import {createModStagePort} from '../tavern-plugin/lib/fork-mod-stage.js'
import {captureStageTarget} from '../tavern-plugin/lib/domain/stage-incremental.js'
import projection from '../tavern-plugin/src/client/fork-mod-projection.cjs'
import runtime from '../tavern-plugin/src/client/fork-stage-runtime.cjs'
import {correctionDouble} from './fixtures/mods/correction-double.js'
const {projectModPerformances}=projection
const {createStageRuntimeState,reduceStageRuntime}=runtime
const source={branchId:'branch',sourceKey:'source',generation:0,textVersion:'source'}
const base={modId:'test.mod',cardId:'card-a',gameId:'session',turn:1,source,readIds:['stock']}
function fixture() {
  let store,live=true,writes=0
  const logs=[],engine=createModStageCorrections({read:async()=>store,update:async(context,mutate,current)=>{
    assert.ok(current());const value=mutate(store);if(value){store=value;writes++}
  },log:value=>logs.push(value)})
  const current=()=>live
  const place=(key,name,action='gain',at=2)=>engine.place({...base,command:{key,at,commandId:'mark'}},{id:'one',kind:'test.stock',payload:{name,action},...(action==='show'?{}:{pairing:{readId:'stock',path:[name]}})},current)
  const settle=(revision='r1',before={potion:1},after={potion:4})=>engine.settlement(base,{source,turn:1,settlementRevision:revision,status:'ok',beforeRevision:'b',afterRevision:revision,before:{stock:before},after:{stock:after}},current)
  const correct=async(module=correctionDouble())=>{const pending=await engine.pending(base);if(pending)return module.settled(pending,{stage:{reviseAfterSettlement:args=>engine.reviseAfterSettlement({...base,settlementRevision:pending.settlementRevision},args,current)}})}
  return {engine,place,settle,correct,logs,current,get store(){return store},get writes(){return writes},revoke(){live=false}}
}

test('double covers marked+changed, marked+unchanged, unmarked+changed, display and duplicate/direction facts',async()=>{
  const h=fixture()
  await h.place('a','potion');await h.place('b','missing');await h.place('c','potion');await h.place('d','wrong','lose');await h.place('e','display','show')
  const original=JSON.stringify(h.store.performances)
  await h.settle('r1',{potion:1,wrong:1},{potion:4,wrong:2,unmarked:10});await h.correct()
  const shown=projectModPerformances(h.store)
  assert.deepEqual(shown.map(row=>[row.payload.name,row.payload.count]),[['potion',3],['display',undefined]])
  assert.equal(JSON.stringify(h.store.performances),original)
  assert.equal(projectModPerformances(h.store,{includeRemoved:true}).filter(row=>row.reconciliation==='removed').length,3)
  assert.equal(await h.engine.pending(base),null)
  const writes=h.writes;await h.settle('r1');await h.correct();assert.equal(h.writes,writes)
})

test('receipt first, split checkpoints, same-text new revision and restart use persisted intents without a hold',async()=>{
  const h=fixture();await h.settle()
  assert.equal(await h.engine.pending(base),null)
  await h.place('a','potion');assert.equal(projectModPerformances(h.store)[0].payload.count,undefined)
  await h.correct();assert.equal(projectModPerformances(h.store)[0].payload.count,3)
  await h.place('b','potion');await h.correct();assert.equal(projectModPerformances(h.store).length,1)
  await h.settle('r2',{potion:4},{potion:9});await h.correct();assert.equal(projectModPerformances(h.store)[0].payload.count,5)
  const restored=structuredClone(h.store)
  const restarted=createModStageCorrections({read:async()=>restored,update:async()=>assert.fail('Read recovery must not rewrite completed facts')})
  assert.equal(await restarted.pending(base),null)
  assert.equal(await restarted.pending({...base,source:{...source,generation:1}}),null)
})

test('error/skip and failed or unresolved script retain initial performances; stale receipt/authority/foreign ID reject atomically',async()=>{
  const h=fixture();await h.place('a','potion')
  const before=JSON.stringify(h.store)
  for(const status of ['error','skipped'])await h.engine.settlement(base,{status},h.current)
  assert.equal(JSON.stringify(h.store),before);assert.equal(h.logs.length,2)
  await h.settle()
  await assert.rejects(h.correct({settled(){throw new Error('script failure')}}),/script failure/)
  assert.equal(projectModPerformances(h.store)[0].reconciliation,'pending')
  let release;const pending=h.correct(correctionDouble({wait:()=>new Promise(resolve=>{release=resolve})}))
  await new Promise(resolve=>setImmediate(resolve))
  assert.equal(projectModPerformances(h.store)[0].reconciliation,'pending')
  await h.settle('r2');release();await assert.rejects(pending,{code:'MOD_SOURCE_STALE'})
  const original=JSON.stringify(h.store)
  await assert.rejects(h.engine.reviseAfterSettlement({...base,settlementRevision:'r2'},{settlementRevision:'r2',revisions:[{performanceId:'foreign',expectedRevision:0,action:'remove',reason:'x'}]},h.current),{code:'MOD_PERMISSION_DENIED'})
  assert.equal(JSON.stringify(h.store),original)
  h.revoke();await assert.rejects(h.correct(),{code:'ERR_ASSERTION'})
})

function player() {
  const source={sessionId:'session',authorityEpoch:0,branchId:'branch',turn:1,sourceKey:'source',generation:0}
  const pages=[1,2,3].map(para=>({anchor:{paragraphId:'p'+para,para,offset:0}}))
  let state=createStageRuntimeState(),effects=[]
  const send=event=>{const value=reduceStageRuntime(state,event);state=value.state;effects=value.effects;return effects}
  send({type:'SEND',source,text:{revision:1,streaming:false,hasReadableText:true,pages}})
  const envelope=(rows,revision)=>({phase:'done',revision,generation:0,bindingKey:'binding',prefixRevision:1,through:3,complete:true,baseline:{},entries:[],modCorrectionRevision:revision,modPerformances:rows})
  return {send,source,envelope,pages,get state(){return state},get effects(){return effects}}
}

test('unplayed descriptors correct before play; pending prepare updates/deletes; played ledger never emits a correction one-shot',async()=>{
  const h=fixture();await h.place('a','potion');await h.place('b','missing', 'gain',3)
  const p=player()
  p.send({type:'DIRECTOR_SNAPSHOT',source:p.source,envelope:p.envelope(projectModPerformances(h.store),1)})
  p.send({type:'PAGE',index:1})
  const shot=p.effects.find(row=>row.type==='prepare-one-shot');assert.ok(shot)
  await h.settle();await h.correct()
  p.send({type:'DIRECTOR_SNAPSHOT',source:p.source,envelope:p.envelope(projectModPerformances(h.store),2)})
  assert.ok(!p.effects.some(row=>row.type==='prepare-one-shot'))
  p.send({type:'ONE_SHOT_READY',token:shot.token})
  assert.equal(p.effects.find(row=>row.type==='play-one-shot').descriptor.performance.payload.count,3)
  await h.settle('r2',{potion:4},{potion:8});await h.correct()
  p.send({type:'DIRECTOR_SNAPSHOT',source:p.source,envelope:p.envelope(projectModPerformances(h.store),3)})
  assert.ok(!p.effects.some(row=>row.type==='prepare-one-shot' || row.type==='play-one-shot'))
  assert.equal(p.state.director.modPerformances[0].payload.count,4)
  p.send({type:'PAGE',index:2});assert.ok(!p.effects.some(row=>row.type==='prepare-one-shot'))
  const history=player();history.send({type:'HISTORY_JUMP',source:history.source,text:{revision:1,streaming:false,hasReadableText:true,pages:history.pages},anchor:history.pages[1].anchor})
  history.send({type:'DIRECTOR_SNAPSHOT',source:history.source,envelope:history.envelope(projectModPerformances(h.store),1)})
  const historicalShot=history.effects.find(row=>row.type==='prepare-one-shot');
  assert.equal(historicalShot,undefined,'History never plays one-shot presentations, including corrected items');
  assert.equal(history.state.director.modPerformances[0].payload.count,4,'Corrected history remains readable');
  history.send({type:'PAGE',index:0});history.send({type:'PAGE',index:1});
  assert.ok(!history.effects.some(row=>row.type==='prepare-one-shot' || row.type==='play-one-shot'),'Consumed history cards stay consumed');
})

test('native derived writer keeps director bytes and updatedAt; re-generation/branch/card changes reject at the write gate',async()=>{
  let chat={id:'chat',sessionId:'session',cardPath:'card',updatedAt:12,timeline:{branchId:'branch',revision:1},messages:[{role:'assistant',turn:1,text:'Body',stageDirectionAssetPacks:{digest:'original',binding:{target:{predecessorDigest:'prior'}},entries:[]}}]}
  const canonical=JSON.stringify(chat.messages[0].stageDirectionAssetPacks),target=captureStageTarget(chat,0)
  let cardId='card-a'
  const port=createModStagePort({readChat:async()=>structuredClone(chat),readCard:async()=>({meta:{id:cardId}}),updateChat:async(id,mutate,metadata)=>{
    assert.deepEqual(metadata,{source:'mod-corrections',touchUpdatedAt:false});const value=await mutate(structuredClone(chat));if(value)chat=value
  },publish(){}})
  const engine=createModStageCorrections(port),context={...base,source:{...source,sourceKey:target.sourceKey,textVersion:target.sourceKey},command:{key:'a',at:1,commandId:'mark'}}
  await engine.place(context,{id:'one',kind:'test',payload:{}},()=>true)
  assert.equal(JSON.stringify(chat.messages[0].stageDirectionAssetPacks),canonical);assert.equal(chat.updatedAt,12)
  chat.messages[0].stageDirectionGeneration=1
  await assert.rejects(engine.place(context,{id:'two',kind:'test',payload:{}},()=>true),{code:'MOD_SOURCE_STALE'})
  chat.messages[0].stageDirectionGeneration=0;cardId='other'
  await assert.rejects(engine.place(context,{id:'two',kind:'test',payload:{}},()=>true),{code:'MOD_SOURCE_STALE'})
  cardId='card-a';chat.timeline.branchId='other'
  await assert.rejects(engine.place(context,{id:'two',kind:'test',payload:{}},()=>true),{code:'MOD_SOURCE_STALE'})
})


test('registered first-party runtime places immediately and only the matching settled callback can revise',async()=>{
  const [{createFirstPartyMods},{createModRegistry},{createBuiltinModRegistry},{createModHostRuntime}]=await Promise.all([
    import('./fixtures/mods/core-mod-v2.mjs'),import('../tavern-plugin/lib/domain/mods/registry.js'),
    import('../tavern-plugin/lib/domain/mods/runtime.js'),import('../tavern-plugin/lib/fork-mod-runtime.js')])
  const stock=await createFirstPartyMods(),manifest=structuredClone(stock.manifest('dsh.demo'))
  manifest.dependencies.capabilities=['stage.place','stage.reviseAfterSettlement']
  manifest.permissions.stage=['place','reviseAfterSettlement']
  manifest.permissions.variables.reads=[{id:'stock',source:'mvu',path:'/stock'}]
  manifest.permissions.variables.writes=[]
  const library=createModRegistry({capabilities:manifest.dependencies.capabilities})
  await library.install({manifest,expectedRevision:'0'})
  await library.authorize({modId:manifest.id,allowed:true,expectedRevision:library.snapshot().revision})
  await library.setModScope({modId:manifest.id,scope:'global',expectedRevision:library.snapshot().revision})
  const h=fixture(),double=correctionDouble(),builtins=createBuiltinModRegistry([{manifest,files:stock.files(manifest.id),module:{...double,
    command(input,host){return double.command({params:{id:'one',name:input.params.label,action:'gain'}},host)}}}])
  const host=createModHostRuntime({library,builtins,sourceCurrent:()=>true,readText:async()=> 'Fixture',stagePort:h.engine})
  const prepared=await host.prepare({cardId:'card-a',gameId:'session',turn:1,source,authorityEpoch:1,catalogueRevision:'1'})
  const result=await host.command(prepared,{modId:manifest.id,commandId:'mark',params:{label:'potion'}},{key:'0/0',at:2})
  assert.equal(result.ok,true,JSON.stringify(result));assert.equal(h.store.performances.length,1)
  const context={...base,modId:manifest.id}
  await h.engine.settlement(context,{source,turn:1,settlementRevision:'receipt',beforeRevision:'before',afterRevision:'after',status:'ok',before:{stock:{potion:1}},after:{stock:{potion:7}}},()=>true)
  const results=await Promise.all(host.settled(prepared,await h.engine.pending(context)))
  assert.equal(results[0].ok,true,JSON.stringify(results));assert.equal(projectModPerformances(h.store)[0].payload.count,6)
  host.dispose()
})

test('history rows use corrected text, omit deleted rows and leave no-mod backlog byte-identical',async()=>{
  const fs=await import('node:fs/promises'),vm=await import('node:vm')
  const code=await fs.readFile(new URL('../tavern-plugin/src/client/fork-gal-backlog.js',import.meta.url),'utf8')
  const context=vm.createContext({});vm.runInContext(code,context)
  const entries=[{type:'page',turn:1,page:0,para:1,text:'Body'}]
  assert.equal(context.forkStageModHistoryEntries(entries,null),entries)
  const history=[{turn:1,performances:[{id:'a',at:1,payload:{text:'Corrected count: 3'}}]}]
  const rows=context.forkStageModHistoryEntries(entries,history)
  assert.deepEqual(Array.from(rows,row=>row.text),['Body','Corrected count: 3'])
  assert.equal(context.forkStageModHistoryEntries(entries,[{turn:1,performances:[]}]),entries)
})


test('production service persists official receipts atomically and recovers corrections without replaying mod hooks',async t=>{
  const [{widgetChatFixture},{createFirstPartyMods},{createBuiltinModRegistry},{createBuiltinModService}]=await Promise.all([
    import('./fixtures/widget-variable-chat.mjs'),import('./fixtures/mods/core-mod-v2.mjs'),
    import('../tavern-plugin/lib/domain/mods/runtime.js'),import('../tavern-plugin/lib/fork-mod-service.js')])
  const h=await widgetChatFixture(t),stock=await createFirstPartyMods(),manifest=structuredClone(stock.manifest('dsh.demo'))
  manifest.dependencies.capabilities=['stage.place','stage.reviseAfterSettlement'];manifest.permissions.stage=['place','reviseAfterSettlement']
  manifest.permissions.variables={reads:[{id:'stock',source:'mvu',path:'/bag'}],writes:[]}
  const calls={prepare:0,command:0,settled:0},errors=[],events=[],double=correctionDouble()
  const builtin=createBuiltinModRegistry([{manifest,files:stock.files(manifest.id),module:{...double,
    prepare(){calls.prepare++;return null},command(input,host){calls.command++;return double.command({params:{id:'one',name:input.params.label,action:'gain'}},host)},
    settled(input,host){calls.settled++;return double.settled(input,host)}}}])
  let value={global:{enabledModIds:[],mods:{}},grants:{}},revision=0;const listeners=new Set()
  const settings={read:()=>({revision:String(revision),value:structuredClone(value)}),subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn)},
    async compareAndSwap(input){assert.equal(input.expectedRevision,String(revision));value=structuredClone(input.value);revision++;for(const fn of listeners)fn();return settings.read()}}
  const cards={list:async()=>[{cardId:'card-a',revision:'1',value:null}],read:async()=>({revision:'1',value:null})},readCard=async()=>({meta:{id:'card-a'}})
  const stage=createModStagePort({readChat:()=>h.db.read('fixture'),updateChat:h.db.update,readCard,publish(){}})
  const config={root:h.root+'/mods',settings,cards,readCard,stage,variables:h.config,builtins:{...builtin,catalogue:()=>stock.catalogue().filter(row=>row.id===manifest.id)},onError:error=>errors.push(error),onLog:event=>events.push(event)}
  let service=createBuiltinModService(config);t.after(()=>service.dispose())
  const authority={origin:'https://offline.test'}
  let result=await service.call('listMods',{},authority)
  result=await service.call('authorizeMod',{modId:manifest.id,allowed:true,expectedRevision:result.revision},authority)
  await service.call('setModScope',{modId:manifest.id,scope:'global',expectedRevision:result.revision},authority)
  const before=await h.db.read('fixture'),target=captureStageTarget(before,0),snapshot=await service.prepare(before,1,{target})
  const accepted={entries:[{at:1,ops:[{op:'mod.command',modId:manifest.id,commandId:'mark',params:{label:'potion'}}]}]}
  service.applied(snapshot,accepted);service.applied(snapshot,accepted)
  async function until(check){for(let i=0;i<100;i++){const chat=await h.db.read('fixture');if(check(chat))return chat;await new Promise(resolve=>setTimeout(resolve,10))}assert.fail('Timed out')}
  await until(chat=>chat.messages[0].modCorrections?.performances.length===1 && events.some(event=>event.kind==='mod-delivery' && event.phase==='persisted'))
  const delivered=events.filter(event=>event.kind==='mod-delivery')
  assert.deepEqual(delivered.map(event=>event.phase),['accepted','applied','persisted'])
  assert.ok(delivered.every(event=>event.key==='[0,0]' && event.modId===manifest.id && event.sourceKey===target.sourceKey && event.at===1))
  const mvuTarget={messageId:0,message:before.messages[0],variables:before.messages[0].variables[0]}
  const settled={receipt:{status:'updated'},variables:{...mvuTarget.variables,stat_data:{balance:20,bag:{potion:4}}}}
  const capture=await service.captureSettlement(before,mvuTarget,settled)
  await h.mutate(chat=>{chat.messages[0].variables[0]=settled.variables;capture(chat)})
  const durable=await h.db.read('fixture');assert.ok(durable.messages[0].modCorrections.settlements[manifest.id])
  assert.equal(durable.messages[0].modCorrections.performances[0].reconciliation,'pending')
  service.dispose();service=createBuiltinModService(config)
  service.recover(durable,1)
  const corrected=await until(chat=>projectModPerformances(chat.messages[0].modCorrections)[0]?.payload.count===4)
  const preview=await service.prepare(corrected,1,{target:captureStageTarget(corrected,0),preview:true})
  assert.ok(preview.fragments.length>0,'recovery must not poison read-only prompt preview cache')
  assert.deepEqual(calls,{prepare:1,command:1,settled:1});assert.deepEqual(errors,[])
  assert.equal(corrected.messages[0].text,before.messages[0].text)
  assert.equal(corrected.messages[0].variables[0].stat_data.bag.potion,4)
  service.invalidate();service.applied(snapshot,accepted)
  assert.deepEqual(events.filter(event=>event.kind==='mod-delivery').slice(-2).map(event=>event.phase),['accepted','skipped'])
  assert.equal(events.at(-1).error.code,'MOD_SOURCE_STALE')
  assert.deepEqual(calls,{prepare:1,command:1,settled:1})
})


test('real director dispatches sealed checkpoint markers before completion and never awaits correction promises',async t=>{
  const {fixture,deferred}=await import('./helpers/stage-director-harness.mjs')
  const sealed=deferred(),finish=deferred(),never=new Promise(()=>{}),applied=[]
  const command={modId:'dsh.demo',id:'mark',op:'mod.dsh.demo.mark',dsl:{verb:'demo',syntax:'demo mark label=<text>'},params:{type:'object',properties:{label:{type:'string',maxLength:80}},required:['label'],additionalProperties:false},persistence:'marker',caps:{perTurn:4,bytes:1024}}
  const mods={observe(){},enabled:async()=>true,prepare:async()=>({revision:'r1',commands:[command],fragments:[]}),applied(snapshot,effect){applied.push(effect);return never}}
  const h=await fixture(async request=>{
    const feedback=await request.onToolCall({name:'stage_update',arguments:{sequence:1,through:1,done:false,beats:[{at:1,ops:[{op:command.op,params:{label:'potion'}}]}]}})
    assert.equal(JSON.parse(feedback).ok,true)
    sealed.resolve();await finish.promise
    await request.onToolCall({name:'stage_update',arguments:{sequence:2,through:2,done:true,beats:[]}})
  },{mods});t.after(()=>h.dispose())
  await h.director.get(h.read(),1)
  await sealed.promise
  assert.equal(applied.length,1)
  assert.equal(applied[0].entries[0].ops[0].op,'mod.command')
  assert.equal(h.read().messages[0].stageDirectionAssetPacks,undefined)
  assert.ok(h.read().messages[0].stageDirectionAssetPacksDraft)
  finish.resolve();await h.director.drain()
  assert.equal(h.read().messages[0].stageDirectionAssetPacks.complete,true)
})

// private fork (B4, O42/O40): two same-beat commands, each waiting on a chat write slower than the module clock.
test('slow persistence keeps every accepted same-beat command: both gains are placed in order',async()=>{
  const {createBuiltinModRegistry,createModRuntime}=await import('../tavern-plugin/lib/domain/mods/runtime.js')
  const fs=await import('node:fs/promises')
  const manifest=JSON.parse(await fs.readFile(new URL('./fixtures/mods/demo/manifest.json',import.meta.url)))
  const files=new Map(await Promise.all(manifest.files.map(async file=>[file.path,await fs.readFile(new URL('./fixtures/mods/demo/'+file.path,import.meta.url))])))
  const demo=await import('./fixtures/mods/demo/runtime.js')
  const module={...demo,command:async({params},host)=>host.stage.place({id:'item',kind:'test.item',payload:{action:'gain',name:params.name}})}
  let store
  const engine=createModStageCorrections({read:async()=>store,update:async(context,mutate,current)=>{
    await new Promise(resolve=>setTimeout(resolve,60)) // the serialized writer is busy with a director checkpoint
    assert.ok(current());const value=mutate(store);if(value)store=value
  }})
  const runtime=createModRuntime({builtins:createBuiltinModRegistry([{manifest,files,module}]),current:()=>true,timeoutMs:15,
    createHost:(context,current)=>({stage:{place:args=>engine.place({...base,modId:context.modId,command:context.command},args,current)}})})
  for (const [ordinal,name] of ['猪脚饭','奶茶'].entries()) {
    const result=await runtime.invoke({modId:manifest.id,cardId:'card-a',gameId:'session',command:{key:JSON.stringify([1,ordinal]),at:2,commandId:'item'}},'command',{params:{name}})
    assert.equal(result.ok,true,JSON.stringify(result.error))
  }
  assert.deepEqual(projectModPerformances(store).map(row=>[row.at,row.payload.name]),[[2,'猪脚饭'],[2,'奶茶']])
  // The module's own time is still bounded.
  const stalled=createModRuntime({builtins:createBuiltinModRegistry([{manifest,files,module:{...demo,command:()=>new Promise(()=>{})}}]),current:()=>true,timeoutMs:15,createHost:()=>({})})
  assert.equal((await stalled.invoke({modId:manifest.id,cardId:'card-a',gameId:'session'},'command',{})).error.message,'Mod callback timed out')
})