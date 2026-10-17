import test from 'node:test'
import assert from 'node:assert/strict'
import {createFirstPartyMods} from '../tavern-plugin/lib/fork-mod-builtins.js'
import {createModRegistry} from '../tavern-plugin/lib/domain/mods/registry.js'
import {createModSessionEvents} from '../tavern-plugin/lib/fork-mod-events.js'
import {createModStagePort} from '../tavern-plugin/lib/fork-mod-stage.js'
import {createModModelTasks} from '../tavern-plugin/lib/domain/mods/models.js'
import {widgetChatFixture} from './fixtures/widget-variable-chat.mjs'
import {createModEventCatalogue} from '../tavern-plugin/lib/fork-mod-event-catalogue.js'
import {recallAssetPacks} from '../tavern-plugin/lib/domain/stage-asset-pack-catalogue.js'
import {assetRefKey} from '../tavern-plugin/packages/dsh-presentation-protocol/src/asset-packs.js'

const builtin=await createFirstPartyMods(),manifest=builtin.manifest('dsh.danmaku')
test('installed danmaku is off with nine validated ordinary audience entries',async()=>{
  const library=createModRegistry()
  await library.install({manifest,expectedRevision:'0'})
  assert.equal(library.active().length,0)
  assert.deepEqual(manifest.commands,[])
  assert.equal(builtin.assetPacks()[0].assets.length,9)
  assert.ok(builtin.assetPacks()[0].assets.every(row=>row.kind==='audience'&&row.content.nicknamePool.length))
})

test('ordinary audience admission obeys off, blue, hard-trigger and the shared judge result',async()=>{
  const pack=builtin.assetPacks()[0],asset={...pack.assets[0],recall:{mode:'keyword',keywords:['synthetic-match']}},ref={packId:pack.packId,kind:'audience',assetId:asset.id}
  const input={snapshots:[{revision:'1',manifest:{id:pack.packId,name:pack.name,contentHash:'0'.repeat(64),assets:[asset]}}],boundPackIds:[pack.packId],assetStatus:{[assetRefKey(ref)]:{available:true}},modAssetKinds:['audience']}
  assert.equal(recallAssetPacks({...input,modAssetKinds:[]}).candidates.audience.length,0)
  assert.equal(recallAssetPacks(input).candidates.audience.length,0)
  assert.equal(recallAssetPacks({...input,units:['synthetic-match']}).candidates.audience.length,1)
  assert.equal(recallAssetPacks({...input,judgeRecall:new Set([assetRefKey(ref)])}).candidates.audience.length,1)
  const f=await performanceFixture()
  f.input.raw.extensions.dsh_tavern.assetBindings.boundPackIds=[pack.packId]
  const eventCatalogue=createModEventCatalogue({snapshot:async()=>({...input,raw:f.input.raw,globalEnabledPackIds:[pack.packId],current:()=>true})})
  const value={head:{sessionId:'fixture',cardPath:'synthetic.json'},source:{sourceKey:'s'},units:[]}
  assert.equal((await eventCatalogue.read(value,[manifest]))[manifest.id].recalled.length,0)
  eventCatalogue.remember('fixture','s',recallAssetPacks({...input,judgeRecall:new Set([assetRefKey(ref)])}))
  assert.equal((await eventCatalogue.read(value,[manifest]))[manifest.id].recalled.length,1)
  asset.recall={mode:'constant'}
  assert.equal(recallAssetPacks(input).candidates.audience.length,1)
})

test('production event leases persist derived records, publish views, resume history without writes and revoke on lost admission',async t=>{
  const h=await widgetChatFixture(t),library=createModRegistry(),errors=[],signals=[],calls=[]
  await library.install({manifest,expectedRevision:'0'})
  await library.authorize({modId:manifest.id,allowed:true,expectedRevision:library.snapshot().revision})
  await library.setModScope({modId:manifest.id,scope:'global',expectedRevision:library.snapshot().revision})
  const pack=builtin.assetPacks()[0],asset=pack.assets[0],ref={packId:pack.packId,kind:'audience',assetId:asset.id}
  let admitted=true,writes=0,connected=true
  const stage=createModStagePort({readChat:()=>h.db.read('fixture'),readCard:async()=>({meta:{id:'card-a'}}),updateChat:async(id,mutate)=>{writes++;return h.db.update(id,mutate)}})
  const modelTasks=createModModelTasks({select:async()=>({provider:'fake',model:'offline'}),run:async input=>{calls.push(input);return {output:JSON.stringify({memory:'Synthetic opening only'})}}})
  const events=createModSessionEvents({library,builtins:builtin,...h.config,source:stage.source,presentation:stage.presentation,
    variables:()=>({}),epoch:()=>1,connected:()=>connected,readCard:async()=>({meta:{id:'card-a'}}),modelTasks,
    modelStatus:async()=>({audience:{selection:'follow-foreground',provider:'fake',model:'offline',label:'Offline',available:true}}),
    catalogues:async()=>({[manifest.id]:{packs:[{id:pack.packId,scope:'library',entries:admitted?[{...asset,ref}]:[]}],recalled:admitted?[ref]:[]}}),
    publishView:id=>signals.push(id),onError:error=>errors.push(error)})
  t.after(()=>{events.dispose();modelTasks.dispose()})
  events.presentation('fixture',{event:'stage.entered',active:true,mode:'live',turn:1})
  await events.idle();await new Promise(resolve=>setTimeout(resolve,180));await events.idle()
  assert.deepEqual(errors,[])
  assert.equal(calls.length,1)
  assert.ok(!JSON.stringify(calls[0].messages).includes('nicknamePool'))
  assert.equal(events.views('fixture').views[0].view.active,true)
  assert.ok(signals.length)
  const chat=await h.db.read('fixture'),saved=chat.messages.find(row=>row.role==='assistant').modPresentations[manifest.id]
  assert.equal(saved.rows[0].record.type,'memory')
  const before=writes
  events.presentation('fixture',{event:'activity.changed',active:true,mode:'history',turn:1})
  await events.idle()
  assert.equal(writes,before)
  assert.equal(calls.length,1)
  admitted=false;events.refresh();await events.idle()
  assert.deepEqual(events.views('fixture').views,[])
  connected=false;events.disconnected(['fixture']);await events.idle()
  assert.deepEqual(errors,[])
})

import {createAssetPackService} from '../tavern-plugin/packages/dsh-asset-library/lib/pack-v2/service.js'
import {createBuiltinModService} from '../tavern-plugin/lib/fork-mod-service.js'
import {performanceFixture} from './helpers/performance-director-fixture.mjs'
import {prepareAssetPackDirector,buildAssetPackRequest} from '../tavern-plugin/lib/domain/stage-asset-pack-director.js'

test('builtin audience pack uses ordinary installation and preserves user edits',async t=>{
  const h=await widgetChatFixture(t),owner=createAssetPackService({assetRoot:h.root+'/assets'}),pack=builtin.assetPacks()[0]
  t.after(()=>owner.dispose())
  const first=await owner.ensureBuiltinPack(pack)
  assert.equal(first.status,'installed')
  assert.equal(first.snapshot.manifest.assets.length,9)
  const second=await owner.ensureBuiltinPack({...pack,name:'Must not replace the installed name'})
  assert.equal(second.status,'noop')
  assert.equal(second.snapshot.manifest.name,pack.name)
})

test('full installed registry and ordinary audience recall leave production prompt bytes unchanged off/on/empty',async t=>{
  const h=await widgetChatFixture(t),f=await performanceFixture(),listeners=new Set()
  let value={global:{enabledModIds:[],mods:{}},grants:{}},revision=0
  const settings={read:()=>({revision:String(revision),value:structuredClone(value)}),subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn)},async compareAndSwap(input){assert.equal(input.expectedRevision,String(revision));value=structuredClone(input.value);revision++;for(const fn of listeners)fn();return settings.read()}}
  const service=createBuiltinModService({root:h.root+'/mods',builtins:builtin,settings,cards:{list:async()=>[]},readCard:async()=>({meta:{id:'card-a'},raw:f.input.raw}),variables:{},stage:{read:async()=>undefined}})
  t.after(()=>service.dispose())
  const authority={origin:'https://offline.test'},chat={sessionId:'fixture',cardPath:'synthetic.json',messages:[{role:'assistant',turn:1,text:'Synthetic completed page'}]}
  const pack=builtin.assetPacks()[0],audience={...pack.assets[0],recall:{mode:'constant',keywords:[]}},ref={packId:pack.packId,kind:'audience',assetId:audience.id}
  const input={...f.input,snapshots:[...f.input.snapshots,{revision:'1',manifest:{id:pack.packId,name:pack.name,contentHash:'0'.repeat(64),assets:[audience]}}],globalEnabledPackIds:[pack.packId],assetStatus:{...f.input.assetStatus,[assetRefKey(ref)]:{available:true}}}
  let baseline
  const measures=[]
  for(const state of ['off','on','empty']) {
    if(state==='on') {
      let row=await service.call('getMod',{modId:manifest.id},authority)
      await service.call('authorizeMod',{modId:manifest.id,allowed:true,expectedRevision:row.revision},authority)
      row=await service.call('getMod',{modId:manifest.id},authority)
      await service.call('setModScope',{modId:manifest.id,scope:'global',expectedRevision:row.revision},authority)
    }
    if(state==='empty')audience.enabled=false
    let mods=await service.prepare(chat,1,{target:input.target,preview:true})
    let prepared=prepareAssetPackDirector({...input,mods,modPrompts:mods.fragments})
    mods=await service.prepare(chat,1,{target:input.target,preview:true,assetCatalogue:prepared.context.catalogue})
    prepared=prepareAssetPackDirector({...input,mods,modPrompts:mods.fragments})
    assert.equal(prepared.context.catalogue.candidates.audience.length,state==='on'?1:0)
    const request=buildAssetPackRequest(prepared,true,undefined,'',true)
    baseline ||= request
    for(const key of ['system','messages','tools','sections'])assert.deepEqual(request[key],baseline[key],state+':'+key)
    measures.push({state,systemBytes:Buffer.byteLength(request.system),messagesBytes:Buffer.byteLength(JSON.stringify(request.messages)),toolSchemaBytes:Buffer.byteLength(JSON.stringify(request.tools[0].parameters)),sectionBytes:Object.fromEntries(request.sections.map(row=>[row.key,row.bytes]))})
  }
  t.diagnostic(JSON.stringify({scope:'full installed production registry + core audience recall + director builders',measures}))
})
