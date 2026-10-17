import test from 'node:test'
import assert from 'node:assert/strict'
import {fixture} from './helpers/stage-director-harness.mjs'
import {widgetChatFixture} from './fixtures/widget-variable-chat.mjs'
import {createStageDirector} from '../tavern-plugin/lib/domain/stage-director.js'
import {createBackgroundTaskCoordinator} from '../tavern-plugin/lib/domain/background-task-coordinator.js'
import {createFirstPartyMods} from '../tavern-plugin/lib/fork-mod-builtins.js'
import {prepareAssetPackDirector,createAssetPackTransaction} from '../tavern-plugin/lib/domain/stage-asset-pack-director.js'
import {syntheticPack,cardExtension} from './fixtures/asset-packs/pack.mjs'
import {configure} from '../fork/mods/items/runtime.js'
import {createModConfigHost,createModConfigStageReader} from '../tavern-plugin/lib/fork-mod-config-host.js'
import {createAssetPackService} from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/service.js'
import {createCardPreparation} from '../tavern-plugin/lib/domain/card-preparation.js'
import {defaultAssetEngineSettings} from '../tavern-plugin/lib/domain/asset-engine-settings.js'

// The paid D6 task failed before a model request. Production uses the narrow checkpoint reader.
test('D6 prepare failure survives native checkpoint projection and director restart',async t=>{
  const h=await widgetChatFixture(t),assets=await fixture(()=>assert.fail('No model request'))
  t.after(()=>assets.dispose())
  await h.mutate(chat=>{delete chat.messages[0].greeting})
  const tasks=createBackgroundTaskCoordinator({timeline:h.timeline,parallelRoles:['stage-director'],store:{
    readChat:h.db.read,writeChat:h.db.write,updateChat:h.db.update,readSlice:h.db.readSlice,
    readSettlementCheckpoint:h.db.readSettlementCheckpoint,patchChat:h.db.patch}})
  const deps={assets:assets.assets,foreground:async()=>{throw Object.assign(new Error('Forced D6 prepare exception'),{code:'PREPARE_TEST'})},
    beginTask:chat=>tasks.begin(chat,'stage-director'),runAgent:()=>assert.fail('No model request')}
  let director=createStageDirector(deps)
  t.after(()=>director.dispose())
  await director.get(await h.db.read('fixture'),1);await director.drain()
  const saved=await h.db.read('fixture')
  assert.equal(Object.values(saved.timeline.operations).at(-1).status,'failed')
  assert.equal(saved.messages[0].stageDirectionAssetPacksFailure?.error,'Forced D6 prepare exception')
  assert.equal(saved.messages[0].stageDirectionAssetPacksFailure.code,'PREPARE_TEST')
  await director.dispose();director=createStageDirector(deps)
  const restarted=await director.get(saved,1,null,{readOnly:true})
  assert.equal(restarted.status,'error');assert.equal(restarted.error,'Forced D6 prepare exception')
})

test('D2 DSL genre error matches JSON and admits repaired item at the original anchor',async()=>{
  const builtins=await createFirstPartyMods(),manifest=builtins.manifest('dsh.items')
  const ref={packId:'11111111-1111-4111-8111-111111111111',kind:'props',assetId:'umbrella'}
  const catalogue={packs:[{id:ref.packId,scope:'library',entries:[{id:ref.assetId,kind:'props',ref,name:'雨伞',enabled:true,category:'misc',media:'a'.repeat(64),recall:{mode:'constant'}}]}],recalled:[ref]}
  const command={...configure({manifest,catalogue,bindings:{inventory:{source:'mvu'}}}).commands[0],modId:manifest.id}
  const prepared=prepareAssetPackDirector({snapshots:[{...await syntheticPack(),revision:'1'}],raw:{extensions:{dsh_tavern:cardExtension()}},cardRevision:'1',
    engine:{widgetsEnabled:false},target:{sourceKey:'source',branchId:'branch',revision:1},units:Array.from({length:22},()=> 'Offline text.'),mods:{revision:'1',commands:[command],fragments:[]}})
  const submit=op=>({sequence:1,through:22,done:true,beats:[{at:20,ops:[op]}]})
  const json=createAssetPackTransaction({prepared,getCurrentBinding:()=>prepared.binding})
  const expected=json.submitModel(submit({op:command.op,action:'gain',name:'\u96e8\u4f1e',genre:'\u9053\u5177',force:false})).errors[0]
  const dsl=createAssetPackTransaction({prepared,getCurrentBinding:()=>prepared.binding})
  const first=dsl.submitModel(submit('item gain name="\u96e8\u4f1e" genre="\u9053\u5177"'))
  assert.deepEqual(first.errors[0],expected)
  assert.equal(first.retryable,true)
  assert.deepEqual(first.errors[0].choices,command.params.properties.genre.enum)
  const repaired=dsl.submitModel(submit('item gain name="\u96e8\u4f1e" genre="\u6742\u7269"'))
  assert.equal(repaired.ok,true,JSON.stringify(repaired));assert.equal(repaired.sealed,true)
  assert.equal(dsl.effect().entries[0].ops[0].params.genre,'\u6742\u7269')
})

test('director mod config pins variables and stage across unrelated background revisions',async t=>{
  const h=await widgetChatFixture(t),builtins=await createFirstPartyMods()
  const card=createCardPreparation().create({kind:'import',payload:{name:'Pinned card',extensions:{dsh_tavern:{schemaVersion:1,assetBindings:{boundPackIds:[]}}}}})
  const packs=createAssetPackService({assetRoot:h.root+'/packs'})
  t.after(()=>packs.dispose())
  const prepared=prepareAssetPackDirector({snapshots:[{...await syntheticPack(),revision:'1'}],raw:{extensions:{dsh_tavern:cardExtension()}},cardRevision:'1',
    engine:{widgetsEnabled:false},target:{sourceKey:'source',branchId:'branch',revision:1},units:['Text']})
  const transaction=createAssetPackTransaction({prepared,getCurrentBinding:()=>prepared.binding})
  assert.equal(transaction.submit({sequence:1,through:1,done:true,beats:[]}).ok,true)
  const record=transaction.effect()
  await h.mutate(chat=>{chat.variables={};chat.messages[0].stageDirectionAssetPacks=record;chat.messages[0].variables[0].stat_data.clock='08:10'})
  const pinned=await h.db.read('fixture'),revisions=[]
  let heads=0,advanced=false
  const readStage=createModConfigStageReader({readChat:()=>h.db.read('fixture'),readRevision:async(id,revision)=>{revisions.push(revision);return h.db.readRevision(id,revision)}})
  const host=createModConfigHost({root:h.root+'/config',manifests:builtins.catalogue().map(row=>builtins.manifest(row.id)),
    listCards:async()=>[{path:pinned.cardPath,workspace:card}],readCard:async()=>card,getAssetLibrary:()=>packs,
    readSession:async()=>{heads++;return h.db.readSessionState('fixture')},readWindow:async(...args)=>{
      if(!advanced){advanced=true;await h.mutate(chat=>{chat.variables.backgroundRevision=2;chat.messages[0].variables[0].stat_data.clock='10:30';delete chat.messages[0].stageDirectionAssetPacks})}
      return h.db.readWindow(...args)
    },readStage,getEngine:()=>({revision:'0',values:defaultAssetEngineSettings()}),invalidate(){}})
  await h.mutate(chat=>{chat.variables.backgroundRevision=1;chat.messages[0].variables[0].stat_data.clock='09:20'})
  const resolved=await host.resolved('dsh.phone',card,pinned)
  assert.equal(heads,0,'prepare must use its own Chat rather than a new session head')
  assert.equal(resolved.values.clockText,'08:10')
  assert.deepEqual(revisions,[pinned._storageRevision])
  assert.deepEqual(await readStage('fixture',pinned._storageRevision),record.baseline)
  assert.equal((await h.db.read('fixture')).messages[0].variables[0].stat_data.clock,'10:30')
})