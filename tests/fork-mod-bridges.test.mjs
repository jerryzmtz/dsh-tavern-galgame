import {createModModelTasks} from '../tavern-plugin/lib/domain/mods/models.js'
import {createModSessionEvents} from '../tavern-plugin/lib/fork-mod-events.js'
import {createModStagePort} from '../tavern-plugin/lib/fork-mod-stage.js'
import {createModEventBus} from '../tavern-plugin/lib/domain/mods/events.js'
import {settledModTurns} from '../tavern-plugin/lib/domain/mods/settled-source.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import {createModRpc} from '../tavern-plugin/lib/fork-mod-rpc.js'
import {createModHostRuntime} from '../tavern-plugin/lib/fork-mod-runtime.js'
import {createBuiltinModRegistry} from '../tavern-plugin/lib/domain/mods/runtime.js'
import {createFirstPartyMods} from './fixtures/mods/core-mod-v2.mjs'
import {createModRegistry} from '../tavern-plugin/lib/domain/mods/registry.js'
import {createEngineJudge,validateJudgeConfig} from '../tavern-plugin/lib/domain/engine-judge.js'
import {createModJudge} from '../tavern-plugin/lib/domain/mods/judge.js'
import {createModAssets} from '../tavern-plugin/lib/domain/mods/assets.js'
import {createModVariables} from '../tavern-plugin/lib/domain/mods/variables.js'
import {createTavernScriptHostAdapter} from '../tavern-plugin/lib/domain/tavern-script-host-adapter.js'
import {createModVariablePort} from '../tavern-plugin/lib/fork-mod-variables.js'
import {createBuiltinModService,MOD_MANAGEMENT_METHODS} from '../tavern-plugin/lib/fork-mod-service.js'
import {widgetChatFixture,purchase,declarations as variableDeclarations} from './fixtures/widget-variable-chat.mjs'
import {applyMvuSettlementEffect} from '../tavern-plugin/lib/domain/mvu-settlement-effect.js'
const manifest=JSON.parse(await fs.readFile(new URL('./fixtures/mods/demo/manifest.json',import.meta.url)))

test('judge bridge adapts the real Map/null contract, preserves 0.6 and never bypasses permission or stale authority',async()=>{
  let current=true,calls=0,result=new Map([['fit',0.6]])
  const engineJudge={async judge(input){calls++;assert.equal(input.purpose,'mod:dsh.demo:recall');assert.equal(input.material,'Visible prose');return result}}
  const options={engineJudge,manifest,context:{modId:manifest.id},current:()=>current,timeoutMs:10}
  const judge=createModJudge(options),input={purpose:'recall',material:'Visible prose',questions:[{id:'fit',text:'Relevant?'}]}
  assert.deepEqual(await judge(input),{ok:true,value:{probabilities:{fit:0.6}}})
  result=null;assert.deepEqual((await judge(input)).value,{probabilities:null})
  result=new Map([['fit',NaN]]);assert.deepEqual((await judge(input)).value,{probabilities:null})
  const timeout=createModJudge({...options,engineJudge:{judge:()=>new Promise(()=>{})}})
  assert.deepEqual((await timeout(input)).value,{probabilities:null})
  const denied=createModJudge({...options,manifest:{...manifest,permissions:{stage:[]}}})
  assert.equal((await denied(input)).error.code,'MOD_PERMISSION_DENIED')
  assert.equal(calls,3)
  current=false;assert.equal((await judge(input)).error.code,'MOD_SOURCE_STALE');assert.equal(calls,3)
  current=true
  const stale=createModJudge({...options,engineJudge:{async judge(){current=false;return new Map([['fit',1]])}}})
  assert.equal((await stale(input)).error.code,'MOD_SOURCE_STALE')
  current=true
  const production=createEngineJudge({getConfig:()=>validateJudgeConfig({provider:'jev'}),credentials:()=>({resolve:async()=>({value:'offline-fixture'})}),fetch:async(url,request)=>{
    assert.equal(JSON.parse(request.body).state,input.material)
    return {ok:true,json:async()=>({answers:{fit:{type:'noul',noul:0.6}}})}
  }})
  assert.deepEqual((await createModJudge({...options,engineJudge:production})(input)).value,{probabilities:{fit:0.6}})
})

test('asset bridge requires both declared identity and current card authorization, releases late revoked leases',async()=>{
  const ref={packId:'11111111-1111-4111-8111-111111111111',kind:'sfx',assetId:'chime'}
  const own={...manifest,permissions:{...manifest.permissions,mainAssets:[{slot:'sound',kinds:['sfx'],refs:[ref]}]}}
  let allowed=true,exists=true,calls=0,released=0,revokeInLease=false
  const assets=createModAssets({manifest:own,context:{modId:own.id,cardId:'card-a'},current:()=>true,authorized:async context=>context.cardId==='card-a' && allowed,
    service:{async resolveAssets({refs}){calls++;assert.deepEqual(refs,[ref]);return [{value:exists?{enabled:true,name:'Chime'}:null}]}},
    lease:async()=>{if(revokeInLease)allowed=false;return 'opaque-media-handle'},release:async handle=>{assert.equal(handle,'opaque-media-handle');released++}})
  const result=await assets.read({ref})
  assert.deepEqual(result.value.identity,ref);assert.equal(result.value.mediaHandle,'opaque-media-handle')
  assert.ok(Object.isFrozen(result.value.metadata))
  assert.equal((await assets.read({ref:{...ref,assetId:'other'}})).error.code,'MOD_PERMISSION_DENIED')
  allowed=false;assert.equal((await assets.read({ref})).error.code,'MOD_PERMISSION_DENIED');assert.equal(calls,1)
  allowed=true;exists=false;assert.deepEqual(await assets.read({ref}),{ok:true,value:null})
  exists=true;revokeInLease=true;assert.equal((await assets.read({ref})).error.code,'MOD_SOURCE_STALE');assert.equal(released,1)
})

test('variable facade reuses real isolated MVU execution, checks full write set and commits only the pinned baseline',async()=>{
  const context={modId:manifest.id,cardId:'card-a',gameId:'game-a',turn:1,source:{branchId:'branch',sourceKey:'source',generation:1,textVersion:'text-1'}}
  const chat={id:'game-a',sessionId:'session-a',_storageRevision:1,mode:'story',cardPath:'synthetic.json',mvu:{enabled:true,owner:'official'},timeline:{branchId:'branch',revision:3},messages:[{role:'assistant',turn:1,swipeId:0,text:'Synthetic prose',variables:[{stat_data:{sample:{value:1},privateValue:7},schema:{}}]}]}
  const receipts=new Map()
  let version='native-1',writes=0,violate=false,race=false,adapter
  adapter=createTavernScriptHostAdapter({resolveChat:async()=>chat,writeChat:async()=>assert.fail('Executor must not persist'),readCard:async()=>({name:'Synthetic card'}),worldBooks:{bound:async()=>null},scriptDispatch:{status:()=>({ready:true}),async dispatch(session,name,args,window,work){
    assert.equal(name,'DSH_VARIABLE_EDIT')
    await adapter.updateVariables('session-a',{type:'message',message_id:0},{stat_data:{sample:{value:2},privateValue:violate?8:7},schema:{}},0,work.eventId)
    return {handled:true}
  }}})
  const readTurn=async()=>({turn:1,revision:version,textVersion:'text-1',source:context.source,writable:true,snapshotKind:'exact',sources:{mvu:{available:true,value:structuredClone(chat.messages[0].variables[0].stat_data)}}})
  const variables=createModVariables({manifest,context,current:()=>true,readTurn,receipt:async({request})=>receipts.get(request.operationId),execute:async({declarations,operations})=>{
    const result=await adapter.editMvuVariables({operationId:'fixture-edit',sessionId:'session-a',messageId:0,swipeId:0,expectedLifecycleRevision:0,branchId:'branch',basedOnRevision:3,baseline:{revision:String(chat._storageRevision),value:structuredClone(chat.messages[0].variables[0])},declarations,operations})
    const draft=structuredClone(chat);applyMvuSettlementEffect(draft,result.effect)
    if(race)version='native-raced'
    return {after:draft.messages[0].variables[0].stat_data,effect:result.effect}
  },commit:async({baseRevision,effect,assertCurrent,request})=>{
    assertCurrent();if(baseRevision!==version)return null
    applyMvuSettlementEffect(chat,effect);writes++;version='native-'+(writes+1)
    const value={operationId:request.operationId,status:'committed',revision:version};receipts.set(request.operationId,value);return value
  }})
  const read=await variables.getTurn({turn:1})
  assert.deepEqual(read.value.values,{'sample-read':{status:'ready',value:{value:1}}})
  assert.equal((await variables.getTurn({turn:2})).error.code,'MOD_PERMISSION_DENIED')
  const request={operationId:'edit-1',baseRevision:read.value.revision,textVersion:read.value.textVersion,operations:[{writeId:'sample-write',suffix:'/value',op:'replace',value:2}]}
  violate=true
  assert.equal((await variables.patch({...request,operationId:'edit-bad'})).ok,false)
  assert.equal(writes,0);assert.equal(chat.messages[0].variables[0].stat_data.privateValue,7)
  violate=false;race=true
  assert.equal((await variables.patch({...request,operationId:'edit-race'})).error.code,'MOD_REVISION_CONFLICT')
  assert.equal(writes,0)
  race=false;version='native-1'
  const receipt=await variables.patch(request)
  assert.equal(receipt.value.status,'committed');assert.equal(writes,1)
  assert.deepEqual(await variables.patch(request),receipt);assert.equal(writes,1)
  assert.equal((await variables.patch({...request,operationId:'edit-stale'})).error.code,'MOD_REVISION_CONFLICT')
  assert.equal(chat.messages[0].variables[0].stat_data.sample.value,2)
  assert.equal(chat.messages[0].text,'Synthetic prose')
})


test('mod management RPC requires host authorization, strict envelopes and CAS, never accepts executable manifests',async()=>{
  const library=createModRegistry({capabilities:['stage.place']})
  const rpc=createModRpc({library,authorize:({context})=>context?.host===true})
  assert.equal(rpc.install,undefined)
  await assert.rejects(rpc.setModScopes({changes:[],expectedRevision:'0'}),{code:'MOD_PERMISSION_DENIED'})
  await assert.rejects(rpc.listMods(),{code:'MOD_PERMISSION_DENIED'})
  assert.deepEqual(await rpc.listMods({}, {host:true}),{revision:'0',mods:[]})
  await library.install({manifest,expectedRevision:'0'})
  const input={modId:manifest.id,values:{caption:'Edited'},expectedRevision:library.snapshot().revision}
  await assert.rejects(rpc.saveModSettings({...input,arbitraryRpc:'patchChat'},{host:true}),{code:'UNKNOWN_FIELD'})
  assert.equal((await rpc.saveModSettings(input,{host:true})).values.caption,'Edited')
  await assert.rejects(rpc.saveModSettings(input,{host:true}),{code:'MOD_REVISION_CONFLICT'})
  await assert.rejects(rpc.inspectModImport({uploadId:'upload',url:'https://example.test'},{host:true}),{code:'MOD_API_UNSUPPORTED'})
  await assert.rejects(rpc.exportMod({modId:manifest.id,packIds:[],expectedRevision:library.snapshot().revision},{host:true}),{code:'MOD_RESOURCE_UNAVAILABLE'})
  const broken=createModRpc({library:{listMods(){throw Error('private filesystem path')}},authorize:()=>true})
  await assert.rejects(broken.listMods(),error=>error.code==='MOD_RUNTIME_FAILED' && !error.message.includes('private'))
})


test('host runtime composes first-party capabilities and real judge without exposing management or failed settlements',async()=>{
  const firstParty=await createFirstPartyMods()
  assert.equal(firstParty.catalogue()[0].id,'dsh.demo')
  const published=firstParty.manifest('dsh.demo')
  assert.equal(firstParty.inspect(published,firstParty.files(published.id)),published)
  const library=createModRegistry({capabilities:['stage.place']})
  await library.install({manifest,expectedRevision:'0'})
  await library.authorize({modId:manifest.id,allowed:true,expectedRevision:library.snapshot().revision})
  await library.setModScope({modId:manifest.id,scope:'global',expectedRevision:library.snapshot().revision})
  const files=new Map(await Promise.all(manifest.files.map(async file=>[file.path,await fs.readFile(new URL('./fixtures/mods/demo/'+file.path,import.meta.url))])))
  let settledCalls=0,judged
  const module={async prepare(input,host){
    assert.equal(host.install,undefined);assert.equal(host.patchChat,undefined)
    judged=await host.judge({purpose:'offline',material:'Visible text',questions:[{id:'fit',text:'Relevant?'}]})
    await host.prompt.sections({target:'director',sections:[{id:'marker-rule',text:'Prepared rule'}]})
    assert.equal((await host.settings.get({})).values.caption,'Demo')
    return {sections:[]}
  },command(input){return input.params},settled(input){settledCalls++;assert.deepEqual(input.before,{'sample-read':1});return []},dispose(){}}
  const builtins=createBuiltinModRegistry([{manifest,files,module}])
  const engineJudge=createEngineJudge({getConfig:()=>validateJudgeConfig({provider:'jev'}),credentials:()=>({resolve:async()=>({value:'offline-fixture'})}),fetch:async()=>({ok:true,json:async()=>({answers:{fit:{type:'noul',noul:0.6}}})})})
  const runtime=createModHostRuntime({library,builtins,engineJudge,sourceCurrent:()=>true,readText:async()=> 'Original rule'})
  const input={cardId:'card-a',gameId:'game-a',turn:1,source:{branchId:'branch',sourceKey:'source',generation:1,textVersion:'v1'},authorityEpoch:1,catalogueRevision:'c1'}
  const prepared=await runtime.prepare(input)
  assert.equal(judged.value.probabilities.fit,0.6)
  assert.equal(prepared.fragments.find(fragment=>fragment.type==='prompt').text,'Prepared rule')
  assert.deepEqual(await runtime.command(prepared,{modId:manifest.id,commandId:'mark',params:{label:'Marker'}}),{ok:true,value:{label:'Marker'}})
  assert.deepEqual(runtime.settled(prepared,{status:'error'}),[]);assert.deepEqual(runtime.settled(prepared,{status:'skipped'}),[])
  await Promise.all(runtime.settled(prepared,{source:input.source,turn:1,settlementRevision:'s1',beforeRevision:'v1',afterRevision:'v2',status:'ok',before:{'sample-read':1,secret:2},after:{'sample-read':3,secret:4}}))
  assert.equal(settledCalls,1)
  await library.authorize({modId:manifest.id,allowed:false,expectedRevision:library.snapshot().revision})
  await assert.rejects(runtime.command(prepared,{modId:manifest.id,commandId:'mark',params:{label:'Late'}}),{code:'MOD_SOURCE_STALE'})
  assert.equal(await runtime.prepare(input),null)
  runtime.dispose()
})


test('mod variable port commits through the real native Timeline and isolated executor without baseline digests',async t=>{
  const h=await widgetChatFixture(t),context={modId:manifest.id,modRevision:'release-1',gameId:'fixture',cardId:'card-a',turn:1,source:{branchId:(await h.db.read('fixture')).timeline.branchId,sourceKey:'source',generation:0,textVersion:'text-1'}}
  const own={...manifest,permissions:{...manifest.permissions,variables:Object.fromEntries(Object.entries(variableDeclarations).map(([mode,rows])=>[mode,Object.entries(rows).map(([id,row])=>({id,...row}))]))}}
  let loseAck=false,commits=0
  const port=createModVariablePort({...h.config,sourceCurrent:()=>true,patch:async(...args)=>{commits++;const saved=await h.config.patch(...args);if(loseAck && args[3].source==='mods.variables.commit'){loseAck=false;throw new Error('Lost committed acknowledgement')}return saved},execute:input=>{assert.equal(input.baselineDigest,undefined);assert.equal(Object.isFrozen(input.baseline),true);return h.config.execute(input)}})
  const variables=createModVariables({...port,manifest:own,context,current:()=>true})
  const before=await variables.getTurn({turn:1});assert.equal(before.ok,true)
  const request={operationId:'purchase',baseRevision:before.value.revision,textVersion:'text-1',operations:purchase}
  const result=await variables.patch(request)
  assert.equal(commits,1,'one atomic publication includes effect and receipt')
  const reopened=createModVariables({...createModVariablePort({...h.config,sourceCurrent:()=>true}),manifest:own,context,current:()=>true})
  assert.deepEqual(await reopened.patch(request),result,'receipt survives facade and owner recreation')
  assert.equal((await reopened.patch({...request,operations:[]})).error.code,'MOD_REVISION_CONFLICT')
  assert.equal(h.dispatches(),1)
  assert.equal(result.value?.status,'committed',JSON.stringify(result))
  const saved=await h.db.read('fixture'),operation=Object.values(saved.timeline.operations).find(row=>row.kind==='variables.edit')
  assert.equal(operation.baselineDigest,undefined);assert.equal(typeof operation.baselineRevision,'string');assert.equal(operation.status,'completed')
  assert.deepEqual(operation.mod,{id:manifest.id,revision:'release-1'})
  assert.deepEqual(saved.messages[0].variables[0].stat_data,{balance:15,bag:{seed:1}})
  assert.equal(saved.messages[0].text,'Synthetic opening')
  const second=await variables.getTurn({turn:1});loseAck=true
  assert.equal((await variables.patch({operationId:'again',baseRevision:second.value.revision,textVersion:'text-1',operations:[{writeId:'balance',op:'delta',value:-2}]})).value?.status,'committed')
  assert.equal((await h.db.read('fixture')).messages[0].variables[0].stat_data.balance,13)
  const unchanged=await variables.getTurn({})
  const noop={operationId:'noop',baseRevision:unchanged.value.revision,textVersion:'text-1',operations:[{writeId:'balance',op:'replace',value:13}]}
  const noopReceipt=await variables.patch(noop)
  assert.equal(noopReceipt.value?.status,'unchanged')
  assert.equal(commits,3)
  assert.deepEqual(await reopened.patch(noop),noopReceipt)
  const read=await variables.getTurn({turn:1})
  await h.mutate(chat=>{chat.messages[0].variables[0].schema.changed=true})
  const stale=await variables.patch({operationId:'stale',baseRevision:read.value.revision,textVersion:'text-1',operations:purchase})
  assert.equal(stale.error.code,'MOD_REVISION_CONFLICT');assert.equal(h.dispatches(),3)
  await h.mutate(chat=>{for(let n=0;n<90;n++)chat.timeline.operations['old-'+n]={id:'old-'+n,kind:'agent',status:'completed',createdAt:Date.now()+n}})
  await h.db.update('fixture',chat=>h.timeline.apply({chat,intent:{kind:'body.begin',turn:2,userText:'Next'}}).chat)
  assert.deepEqual(await reopened.patch(request),result,'operation trimming preserves current-source receipts')
  assert.equal(h.dispatches(),3)
})


test('production first-party service mounts management, revokes authority and dispatches only successful settlement facts',async t=>{
  const h=await widgetChatFixture(t),stock=await createFirstPartyMods(),own=stock.manifest('dsh.demo'),calls={prepare:0,command:0,settled:0},errors=[]
  let pause,started,release
  const builtin=createBuiltinModRegistry([{manifest:own,files:stock.files(own.id),module:{
    async prepare(context,host){calls.prepare++;assert.equal((await host.variables.getTurn({turn:1})).ok,true);if(pause){started();await pause}return {sections:[]}},
    command(){calls.command++;return []},settled(input){calls.settled++;assert.deepEqual(input.before,{'sample-read':1});assert.deepEqual(input.after,{'sample-read':2});return []},dispose(){}
  }}])
  let value={global:{enabledModIds:[],mods:{}},grants:{}},revision=0;const listeners=new Set()
  const settings={read:()=>({revision:String(revision),value:structuredClone(value)}),subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn)},
    async compareAndSwap(input){assert.equal(input.expectedRevision,String(revision));value=structuredClone(input.value);revision++;for(const fn of listeners)fn();return settings.read()}}
  const cards={list:async()=>[{cardId:'card-a',revision:'card-1',value:null}],read:async()=>({revision:'card-1',value:null}),compareAndSwap:()=>assert.fail('Global management must not write a card')}
  const workbenchAuthority=Object.freeze({})
  const service=createBuiltinModService({workbenchAuthority,root:h.root+'/mods',settings,cards,builtins:{...builtin,catalogue:()=>stock.catalogue().filter(row=>row.id===own.id)},readCard:async()=>({meta:{id:'card-a'}}),variables:h.config,onError:error=>errors.push(error)})
  t.after(()=>service.dispose())
  assert.ok(!MOD_MANAGEMENT_METHODS.some(method=>/Import|export/.test(method)))
  assert.throws(()=>service.call('listMods',{},{}),{code:'MOD_PERMISSION_DENIED'})
  const authority={origin:'https://offline.test'},chat=await h.db.read('fixture'),target={sourceKey:'source-a',branchId:chat.timeline.branchId}
  let list=await service.call('listMods',{},authority)
  assert.equal(list.mods.length,1);assert.equal(list.mods[0].scope,'off')
  assert.deepEqual(await service.call('listMods',{},workbenchAuthority),list)
  assert.equal((await service.call('getMod',{modId:own.id},workbenchAuthority)).manifest.id,own.id)
  // private fork: disabled mods still publish installed grammar for the stable tool cache, never active commands.
  const disabled=await service.prepare(chat,1,{target})
  assert.deepEqual(disabled.commands,[]);assert.ok(disabled.schemaCommands.length);assert.deepEqual(disabled.fragments,[]);assert.equal(calls.prepare,0)
  assert.equal(await service.isEnabled({modId:own.id,cardPath:chat.cardPath}),false)
  assert.deepEqual(disabled.enabledAssetKinds,[])
  let result=await service.call('authorizeMod',{modId:own.id,allowed:true,expectedRevision:list.revision},authority)
  result=await service.call('setModScope',{modId:own.id,scope:'global',expectedRevision:result.revision},authority)
  assert.equal(await service.isEnabled({modId:own.id,cardPath:chat.cardPath}),true)
  assert.equal(await service.isEnabled({modId:'dsh.performance',cardPath:chat.cardPath}),false)
  const preview=await service.prepare(chat,1,{target,preview:true});assert.equal(calls.prepare,0);assert.equal(preview.commands[0].op,own.commands[0].op)
  const prepared=await service.prepare(chat,1,{target});assert.equal(calls.prepare,1);assert.deepEqual((await service.prepare(chat,1,{target,preview:true})).fragments,prepared.fragments)
  assert.equal((await service.command(prepared,{modId:own.id,commandId:'mark',params:{label:'Live'}})).ok,true);assert.equal(calls.command,1)
  const settled={receipt:{status:'updated'},variables:{stat_data:{sample:2}}},mvuTarget={message:chat.messages[0],variables:{stat_data:{sample:1}}}
  await service.settled(chat,{...chat,_storageRevision:20},mvuTarget,{...settled,receipt:{status:'error'}})
  await service.settled(chat,{...chat,_storageRevision:20},mvuTarget,{...settled,receipt:{status:'skipped'}})
  await new Promise(resolve=>setTimeout(resolve,0));assert.equal(calls.settled,0)
  await service.settled(chat,{...chat,_storageRevision:20},mvuTarget,settled)
  await service.settled(chat,{...chat,_storageRevision:20},mvuTarget,settled)
  await new Promise(resolve=>setTimeout(resolve,0));assert.equal(calls.settled,1);assert.deepEqual(errors,[])
  pause=new Promise(resolve=>{release=resolve});const waiting=new Promise(resolve=>{started=resolve})
  const pending=service.prepare(chat,1,{target}),rejected=assert.rejects(pending,{code:'MOD_SOURCE_STALE'})
  await waiting
  await service.call('setModScope',{modId:own.id,scope:'off',expectedRevision:result.revision},authority)
  release();await rejected
  await assert.rejects(service.command(prepared,{modId:own.id,commandId:'mark',params:{label:'Stale'}}),{code:'MOD_SOURCE_STALE'})
  const revoked=await service.prepare(chat,1,{target})
  assert.deepEqual(revoked.commands,[]);assert.deepEqual(revoked.fragments,[]);assert.deepEqual(revoked.schemaCommands,disabled.schemaCommands)
})

test('P1 upgrades stored first-party declarations together before restoring unchanged grants',async t=>{
  const h=await widgetChatFixture(t),builtins=await createFirstPartyMods(),root=h.root+'/mods',mods={}
  const ids=builtins.catalogue().map(row=>row.id)
  for(const id of ids) {
    const old=structuredClone(builtins.manifest(id));old.schemaVersion=1;old.version='1.0.0'
    for(const field of ['compatibility','builtinAssets','admission'])delete old[field]
    for(const command of old.commands) {delete command.mode;if(command.replaces)command.replaces=[command.replaces]}
    mods[id]={manifest:old,releaseRevision:'old-'+id,packs:Object.fromEntries(old.defaultPacks.map(file=>{const pack=JSON.parse(builtins.file(id,file));return [pack.id,pack]})),origin:{builtinId:id}}
  }
  await fs.mkdir(root,{recursive:true})
  await fs.writeFile(root+'/state.json',JSON.stringify({schemaVersion:1,revision:'old',mods}))
  let value={global:{enabledModIds:ids,mods:{}},grants:Object.fromEntries(ids.map(id=>[id,'old-'+id]))},revision=0
  const listeners=new Set(),settings={read:()=>({revision:String(revision),value:structuredClone(value)}),subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn)},async compareAndSwap(input){assert.equal(input.expectedRevision,String(revision));value=structuredClone(input.value);revision++;for(const fn of listeners)fn();return settings.read()}}
  const service=createBuiltinModService({root,builtins,settings,cards:{list:async()=>[]},readCard:async()=>({meta:{id:'fixture-card'}}),variables:{},coreCommands:[{op:'item.play'},{dsl:{verb:'item'}}],stage:{read:async()=>undefined,update:()=>assert.fail('No stage writes')}})
  t.after(()=>service.dispose())
  const authority={origin:'https://offline.test'},list=await service.call('listMods',{},authority)
  assert.ok(list.mods.every(row=>row.authorized && row.effectiveEnabled))
  assert.deepEqual((await service.call('listMods',{},authority)),list)
  const upgraded=JSON.parse(await fs.readFile(root+'/state.json','utf8'))
  assert.ok(Object.values(upgraded.mods).every(row=>row.manifest.schemaVersion===2))
  assert.equal(upgraded.mods['dsh.items'].manifest.commands[0].replaces,'item.play')
  service.dispose()
  const production=await import('../tavern-plugin/lib/fork-mod-builtins.js')
  const shipped=await production.createFirstPartyMods()
  assert.equal(shipped.catalogue().some(row=>row.id==='dsh.demo'),false)
  const clean=createBuiltinModService({root,builtins:shipped,settings,cards:{list:async()=>[]},readCard:async()=>({meta:{id:'fixture-card'}}),variables:{},coreCommands:[{op:'item.play'},{dsl:{verb:'item'}}],stage:{read:async()=>undefined,update:()=>assert.fail('No stage writes')}})
  t.after(()=>clean.dispose())
  const cleanList=await clean.call('listMods',{},authority)
  assert.equal(cleanList.mods.some(row=>row.id==='dsh.demo'),false)
  const retired=JSON.parse(await fs.readFile(root+'/state.json','utf8'))
  assert.equal(retired.mods['dsh.demo'],undefined)
  assert.deepEqual(retired.mods['dsh.items'],upgraded.mods['dsh.items'])
})


test('session events use native settled Timeline disclosure and the message boundary without a fake Round',async t=>{
  const h=await widgetChatFixture(t),seen=[],errors=[]
  const own={...manifest,modelSlots:[{id:'audience',label:'观众',purpose:'已知剧情评论',default:'follow-foreground'}],permissions:{...manifest.permissions,source:['dialogue'],models:['audience']},subscriptions:[
    ...['player.input','generation.started','generation.ended','round.committed','settlement.completed'].map(event=>({event,delivery:'active'})),
    ...['activity.changed','mod.context.changed','session.disposed'].map(event=>({event,delivery:'lifecycle'}))]}
  const library=createModRegistry({capabilities:['stage.place']})
  await library.install({manifest:own,expectedRevision:'0'})
  await library.authorize({modId:own.id,allowed:true,expectedRevision:library.snapshot().revision})
  await library.setModScope({modId:own.id,scope:'global',expectedRevision:library.snapshot().revision})
  const files=new Map(await Promise.all(own.files.map(async file=>[file.path,await fs.readFile(new URL('./fixtures/mods/demo/'+file.path,import.meta.url))])))
  let window,state,closed,modelReply
  const calls=[],modelTasks=createModModelTasks({select:async()=>({provider:'fake',model:'offline'}),run:async input=>{calls.push(input);return {output:'Only settled facts'}}})
  t.after(()=>modelTasks.dispose())
  const builtins=createBuiltinModRegistry([{manifest:own,files,module:{prepare(){},command(){},settled(){},dispose(){},
    async event(event,host){
      seen.push(event)
      if(event.event==='mod.context.changed') {
        window=await host.request({requestId:'read',method:'host.source.window',args:{limit:20}})
        state=await host.request({requestId:'state',method:'host.variables.getTurn',args:{}})
        if(!modelReply)modelReply=await host.request({requestId:'audience',method:'host.models.request',args:{requestId:'batch',slotId:'audience',purpose:'React',input:{},maxOutputTokens:128}})
      }
      if(event.event==='session.disposed')closed=await host.request({requestId:'closed',method:'host.source.window',args:{}})
    }}}])
  const stage=createModStagePort({readChat:()=>h.db.read('fixture')})
  let events,connected=true
  const port=createModVariablePort({...h.config,sourceCurrent:(...args)=>events.sourceCurrent(...args)})
  events=createModSessionEvents({library,builtins,modelTasks,...h.config,source:stage.source,variables:()=>port,epoch:()=>1,connected:()=>connected,readCard:async()=>({meta:{id:'card-a'}}),onError:error=>errors.push(error)})
  t.after(()=>events.dispose())
  events.presentation('fixture',{event:'activity.changed',active:true,mode:'live',turn:1})
  await events.idle()
  assert.equal(modelReply.result.value.status,'queued')
  await new Promise(resolve=>setTimeout(resolve,180));await events.idle()
  assert.equal(calls.length,1)
  assert.ok(!JSON.stringify(calls[0].messages).includes('SECRET'))
  assert.equal(seen.at(-1).event,'model.completed')
  assert.equal(seen.at(-1).payload.output,'Only settled facts')
  assert.equal(window.result.value.context.settledTurn,1)
  assert.deepEqual(state.result.value.state,{balance:20,bag:{}})
  assert.equal(window.result.value.units[0].text,'Synthetic opening')
  const started=await h.db.update('fixture',chat=>h.timeline.apply({chat,intent:{kind:'body.begin',turn:2,userText:'Accepted input'}}).chat)
  events.observe(started);await events.idle()
  assert.deepEqual(seen.slice(-2).map(row=>row.event),['player.input','generation.started'])
  assert.equal(seen.at(-1).context.settledTurn,1)
  connected=false;events.disconnected(['fixture']);await events.idle()
  assert.equal(seen.at(-1).payload.reason,'transport')
  connected=true
  assert.equal((await port.readTurn({modId:own.id,cardId:'card-a',gameId:'fixture',turn:1,source:{branchId:started.timeline.branchId,sourceKey:'wrong',generation:0,textVersion:'wrong'},authorityEpoch:1,authority:library.authority(own.id,'card-a')},2).catch(error=>error.code)),'MOD_SOURCE_STALE')
  events.presentation('fixture',{event:'activity.changed',active:false,mode:'live',turn:1});await events.idle()
  const operation=Object.values(started.timeline.operations).find(row=>row.kind==='body')
  const completed=await h.db.update('fixture',chat=>h.timeline.complete({chat,operationId:operation.id,basedOn:operation.basedOn,outcome:{status:'success'},apply(draft){
    draft.preparedWorldBookContext='UNREVEALED WORLD SECRET'
    draft.messages.push({role:'user',text:'Accepted input'},{role:'assistant',turn:2,text:'<think>HIDDEN REASONING</think>Settled reply',sourceText:'<think>HIDDEN REASONING</think>Settled reply'})
  }}).chat)
  events.observe(completed);await events.idle()
  assert.ok(!seen.some(row=>row.event==='round.committed'),'paused active events are not replayed')
  events.presentation('fixture',{event:'activity.changed',active:true,mode:'live',turn:2});await events.idle()
  assert.equal(window.result.value.context.settledTurn,2)
  assert.deepEqual(window.result.value.inputs,[{turn:2,text:'Accepted input'}])
  assert.equal(window.result.value.units.at(-1).text,'Settled reply')
  assert.ok(!JSON.stringify(window).includes('SECRET') && !JSON.stringify(window).includes('REASONING'))
  events.settlement('fixture',{revision:String(completed._storageRevision),status:'unchanged',turn:2});await events.idle()
  assert.equal(seen.at(-1).event,'settlement.completed')
  events.presentation('fixture',{event:'session.disposed',active:false,mode:'live',turn:2});await events.idle()
  assert.equal(closed.result.error.code,'MOD_SOURCE_STALE')
  const closedSeq=seen.at(-1).seq
  await h.mutate(chat=>{chat.messages=[]})
  events.presentation('fixture',{event:'activity.changed',active:true,mode:'live',turn:0});await events.idle()
  assert.ok(seen.at(-1).seq>closedSeq)
  assert.equal(window.result.value.context.settledTurn,0)
  assert.deepEqual(window.result.value.units,[])
  assert.equal(state.result.error.code,'MOD_RESOURCE_UNAVAILABLE')
  assert.deepEqual(errors,[])
  const old={timeline:{branchId:'current',checkpoints:[],operations:{}},messages:Array.from({length:60},(_,id)=>({role:'assistant',turn:id+1}))}
  assert.ok(settledModTurns(old).has(2),'checkpoint retention does not erase old completed disclosure')
  old.timeline.operations.pending={kind:'body',turn:60,status:'running',basedOn:{branchId:'current'}}
  assert.ok(!settledModTurns(old).has(60))
})

test('event queues preserve order without waiting for callbacks and discard paused or revoked deliveries',async()=>{
  const bus=createModEventBus(),context={modId:'dsh.demo'},received=[]
  let release,current=true
  const gate=new Promise(resolve=>{release=resolve})
  bus.subscribe({modId:'dsh.demo',subscriptions:[{event:'page.changed',delivery:'active'}],current:()=>current,
    async deliver(event){received.push(event.seq);if(received.length===1)await gate}})
  bus.activity(true,context,{})
  bus.publish({eventId:'one',event:'page.changed',context});bus.publish({eventId:'two',event:'page.changed',context})
  await Promise.resolve();assert.equal(received.length,1)
  bus.activity(false,context,{})
  release();await bus.idle();assert.equal(received.length,1)
  bus.activity(true,context,{})
  bus.publish({eventId:'three',event:'page.changed',context});current=false
  await bus.idle();assert.equal(received.length,1)
  current=true
  bus.publish({eventId:'four',event:'page.changed',context});bus.publish({eventId:'five',event:'page.changed',context})
  await bus.idle();assert.ok(received[1]<received[2])
})

test('P4 model channel freezes selections, limits global concurrency/rate and cancels old instances',async t=>{
  let at=10000,blocked=true,live=true,choice={provider:'fake',model:'first'}
  const calls=[],results=[],pending=[]
  const tasks=createModModelTasks({now:()=>at,concurrency:1,perMinute:2,select:async()=>choice,busy:()=>blocked,
    run:input=>{calls.push(input);return new Promise(resolve=>pending.push(resolve))}})
  t.after(()=>tasks.dispose())
  const request=(id,owner=id)=>({manifest:{id,modelSlots:[{id:'audience'}],permissions:{models:['audience']}},owner,sessionId:'session',current:()=>live,window:async()=>({units:[{text:'Settled only'}]}),prompts:async()=>[],deliver:value=>results.push(value)})
  const args={requestId:'one',slotId:'audience',purpose:'React',input:{},maxOutputTokens:256}
  const a=await tasks.request(request('dsh.a'),args),b=await tasks.request(request('dsh.b'),args)
  choice.model='changed'
  await assert.rejects(tasks.request(request('dsh.a','other-session'),args),{code:'MOD_RESOURCE_UNAVAILABLE'})
  await new Promise(resolve=>setTimeout(resolve,130));assert.equal(calls.length,0)
  blocked=false;await new Promise(resolve=>setTimeout(resolve,130));assert.equal(calls.length,1);assert.equal(calls[0].selection.model,'first')
  assert.throws(()=>tasks.cancel('foreign',{operationId:a.operationId}),{code:'MOD_PERMISSION_DENIED'})
  tasks.cancel('dsh.a',{operationId:a.operationId});assert.ok(calls[0].signal.aborted)
  pending.shift()({output:'late'});await new Promise(resolve=>setTimeout(resolve,130))
  assert.equal(calls.length,2);assert.equal(results.length,0)
  pending.shift()({output:'accepted'});await new Promise(resolve=>setTimeout(resolve,10));assert.equal(results[0].operationId,b.operationId)
  await assert.rejects(tasks.request(request('dsh.b'),args),{code:'MOD_RESOURCE_UNAVAILABLE'})
  at+=3000;await tasks.request(request('dsh.b'),args);live=false;tasks.invalidate()
  await new Promise(resolve=>setTimeout(resolve,130));assert.equal(calls.length,2)
  live=true;at+=3000;await assert.rejects(tasks.request(request('dsh.b'),args),{code:'MOD_RESOURCE_UNAVAILABLE'})
})
