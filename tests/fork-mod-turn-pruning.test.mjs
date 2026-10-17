import test from 'node:test'
import assert from 'node:assert/strict'
import {createFirstPartyMods} from '../tavern-plugin/lib/fork-mod-builtins.js'
import {createModRegistry} from '../tavern-plugin/lib/domain/mods/registry.js'
import {createModHostRuntime} from '../tavern-plugin/lib/fork-mod-runtime.js'
import {modAssetCatalogue,modJudgeQuestions} from '../tavern-plugin/lib/domain/mods/catalogue.js'
import {recallAssetPacks} from '../tavern-plugin/lib/domain/stage-asset-pack-catalogue.js'
import {assetRefKey} from '../tavern-plugin/packages/dsh-presentation-protocol/src/asset-packs.js'
import {prepareAssetPackDirector,buildAssetPackRequest} from '../tavern-plugin/lib/domain/stage-asset-pack-director.js'
import {syntheticPack,cardExtension} from './fixtures/asset-packs/pack.mjs'

const modId='dsh.items'
test('empty per-turn entries omit mod prose and admission but retain installed grammar; keyword and judge recall restore capability',async t=>{
  const builtins=await createFirstPartyMods(),manifest=builtins.manifest(modId),registry=createModRegistry({capabilities:['stage.place','stage.reviseAfterSettlement']})
  const source=await syntheticPack(),packId=source.manifest.id
  const entry={kind:'props',id:'book',name:'Book',enabled:true,category:'misc',directorNote:'',media:source.manifest.assets[0].variants.entries[0].content.media,recall:{mode:'keyword',keywords:['exact-recall-token']}}
  source.manifest.assets.push(entry)
  const installed=await registry.install({manifest,packs:[],expectedRevision:registry.snapshot().revision})
  const granted=await registry.authorize({modId,allowed:true,expectedRevision:installed.revision})
  await registry.setModScope({modId,scope:'global',expectedRevision:granted.revision})
  const runtime=createModHostRuntime({library:registry,builtins,sourceCurrent:()=>true,readText:async(id,name)=>builtins.file(id,name).toString('utf8')})
  t.after(()=>runtime.dispose())
  const ref={packId,kind:'props',assetId:entry.id},assetStatus={[assetRefKey(ref)]:{available:true}}
  const recall=(text,boundPackIds=[packId],judgeRecall)=>recallAssetPacks({snapshots:[{...source,revision:'r1'}],boundPackIds,units:[text],assetStatus,judgeRecall})
  const empty=modAssetCatalogue(manifest,recall('',[])),miss=modAssetCatalogue(manifest,recall('unrelated turn'))
  const keyword=modAssetCatalogue(manifest,recall('exact-recall-token')),judge=modAssetCatalogue(manifest,recall('unrelated turn',[packId],new Set([assetRefKey(ref)])))
  assert.deepEqual(keyword.recalled,[ref])
  assert.deepEqual(keyword.recalled,judge.recalled)
  assert.equal(modJudgeQuestions(manifest,empty).length,0)
  assert.equal(modJudgeQuestions(manifest,miss).length,0)
  assert.equal(modJudgeQuestions(manifest,keyword).length,0)
  const input={cardId:'card',gameId:'game',turn:1,source:{textVersion:'t1'},authorityEpoch:1,catalogueRevision:'1'}
  for(const catalogue of [empty,miss]) {
    assert.deepEqual(runtime.configure({...input,catalogues:{[modId]:catalogue}}),[])
    assert.equal(await runtime.prepare({...input,catalogues:{[modId]:catalogue}}),null)
  }
  const active=await runtime.prepare({...input,catalogues:{[modId]:keyword}})
  const schemaCommands=builtins.module(modId).commandSchema({manifest}).map(command=>({...command,modId}))
  assert.ok(active.commands.length && active.fragments.length)
  const base={snapshots:[{...source,revision:'r1'}],raw:{extensions:{dsh_tavern:cardExtension()}},cardRevision:'c1',engine:{widgetsEnabled:false},target:{sourceKey:'t1',branchId:'b1',revision:1},units:['Unrelated turn.']}
  for(const incremental of [false,true]) {
    const off=buildAssetPackRequest(prepareAssetPackDirector(base),incremental)
    const absent=buildAssetPackRequest(prepareAssetPackDirector({...base,mods:{revision:'1',commands:[],schemaCommands},modPrompts:[]}),incremental)
    // A newly installed replacement moves its core help into turn-local admission, not grammar.
    assert.notEqual(absent.system,off.system)
    assert.deepEqual(absent.messages,off.messages)
    assert.notEqual(JSON.stringify(absent.tools),JSON.stringify(off.tools))
    const on=buildAssetPackRequest(prepareAssetPackDirector({...base,mods:{...active,schemaCommands},modPrompts:active.fragments}),incremental)
    assert.deepEqual(on.tools,absent.tools)
    assert.ok(JSON.stringify(on.tools).includes('mod.dsh.items'))
    assert.equal(on.system,absent.system)
    assert.notEqual(JSON.stringify(on.messages),JSON.stringify(absent.messages))
  }
})

test('mod green entries share the native judge batch and replay its stored selection without another model call',async t=>{
  const {fixture}=await import('./helpers/stage-director-harness.mjs')
  const {createEngineJudge,validateJudgeConfig}=await import('../tavern-plugin/lib/domain/engine-judge.js')
  const config=validateJudgeConfig({provider:'jev'}),calls=[],preparations=[],id='mod:offline-entry'
  const judge=createEngineJudge({getConfig:()=>config,credentials:()=>({resolve:async()=>({value:'offline'})}),fetch:async(_url,options)=>{
    const body=JSON.parse(options.body);calls.push(body)
    return {ok:true,json:async()=>({answers:Object.fromEntries(Object.keys(body.questions).map(key=>[key,{type:'noul',noul:.9}]))})}
  }})
  const mods={observe(){},enabled:async()=>true,prepare:async(_chat,_turn,options)=>{
    preparations.push(options)
    return {revision:'r1',contexts:[],commands:[],fragments:[],judgeQuestions:[{id,kind:'mod:offline:item',text:'Offline eligible item?'}]}
  }}
  const h=await fixture(async request=>{await request.onToolCall({name:'stage_update',arguments:{sequence:1,through:2,done:true,beats:[]}})},{mods,judge,engineValues:{judge:config}})
  t.after(()=>h.dispose())
  await h.director.preview(h.read(),1)
  assert.equal(calls.length,0)
  await h.director.get(h.read(),1);await h.director.drain()
  assert.equal(calls.length,1)
  assert.ok(JSON.stringify(calls[0].questions).includes('Offline eligible item?'))
  assert.ok(preparations.some(row=>!row.preview && row.judgeRecall?.has(id)))
  const count=preparations.length
  await h.director.preview(h.read(),1)
  assert.equal(calls.length,1)
  assert.ok(preparations.slice(count).some(row=>row.preview && row.judgeRecall?.has(id)))
})
