import {tmpdir as publicTmpdir} from 'node:os';
import {join as publicJoin} from 'node:path';
// private fork: shared card mapping entry boundary, static guesses, read-only projection and copy RPC.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, mkdtemp } from 'node:fs/promises'
import { listCardVariableProviders, readCardVariableSources, validateCardVariableBindings } from '../tavern-plugin/lib/domain/card-variable-bindings.js'
import { validateCardAssetExtension } from '../tavern-plugin/lib/domain/card-asset-bindings.js'
import { createCardPreparation } from '../tavern-plugin/lib/domain/card-preparation.js'
import { createCardAssetBoundary } from '../tavern-plugin/lib/fork-card-asset-bindings.js'
import { createAssetPackPresentation } from '../tavern-plugin/lib/domain/asset-pack-presentation.js'
import { createAssetPackService } from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/service.js'
import { writePhonePack, PHONE_PACK_ID } from './fixtures/source-widget/fork-build-phone-widget.mjs'
import { defaultAssetEngineSettings } from '../tavern-plugin/lib/domain/asset-engine-settings.js'
import { analyzeVariableSchema, guessVariables } from '../tavern-plugin/lib/domain/variable-bindings/index.js'
import { widgetVariableSlots } from '../tavern-plugin/lib/domain/widget-variable-provider.js'
// private fork: exercise the generic engine with the widget provider's slot hints.
const guessCardClockVariable = raw => guessVariables(analyzeVariableSchema(raw),widgetVariableSlots(ref,phone)[0])[0]?.variable || null
const listWidgetVariableSlots = input => listCardVariableProviders(input)[0].slots
const phone = JSON.parse(await readFile(new URL('./fixtures/source-widget/widget.json',import.meta.url),'utf8'))
const ref = {packId:PHONE_PACK_ID,kind:'widgets',assetId:'phone'}, target = {kind:'widgets',ref,slot:'clockText'}
const variable = {source:'mvu',path:'/世界/时间'}
const book = content => ({character_book:{entries:[{comment:'[initvar]',content}]},extensions:{dsh_tavern:{schemaVersion:1,assetBindings:{boundPackIds:[PHONE_PACK_ID]},stage:{widgets:true}}}})
const pack = {manifest:{id:PHONE_PACK_ID,assets:[{id:'phone',kind:'widgets',enabled:true,settingsDefaults:{clockText:'fixed'}}]},widgets:{phone}}
function boundary(raw = book('世界:\n  时间: "12:30"'), service = {getPackSnapshot:async()=>pack}) {
  let workspace={raw},writes=0,fail=false
  const api=createCardAssetBoundary({ctx:{get:name=>name==='assetLibrary'?service:name==='assetPackSettings'?{read:()=>({values:{globalEnabledPackIds:[PHONE_PACK_ID]}})}:null},
    listCards:async()=>[{path:'card'}],readWorkspace:async()=>workspace,readVariableSources:async()=>({mvu:{available:true,value:{世界:{时间:'18:00'},manual:'21:00'}}}),
    updateCard:async(_p,_a,_b,ops)=>{if(fail)throw Error('disk');workspace={raw:{...workspace.raw,extensions:{dsh_tavern:ops[0].value}}};writes++}})
  return {api,get:()=>workspace,writes:()=>writes,fail:()=>{fail=true}}
}
test('retired widgets rejects even empty at import/write; variable targets are closed and safe',()=>{
  for(const widgets of [[],null,[{ref,enabled:false}]]) {
    const raw=book('');raw.extensions.dsh_tavern.assetBindings.widgets=widgets
    assert.throws(()=>validateCardAssetExtension(raw.extensions.dsh_tavern),{code:'UNKNOWN_FIELD'})
    assert.throws(()=>createCardPreparation().create({kind:'import',payload:raw}),{code:'UNKNOWN_FIELD'})
  }
  for(const row of [{target:{...target,kind:'Invalid Provider'},variable},{target,variable:{...variable,fallback:'x'}},{target,variable:{source:'mvu',path:'/constructor/x'}}]) assert.throws(()=>validateCardVariableBindings({version:1,entries:[row]}))
  assert.throws(()=>validateCardVariableBindings({version:1,entries:[{target,variable},{target,variable}]}),{code:'DUPLICATE_ID'})
})
test('static data-only guesses prefer world time, escape pointers and never evaluate schema scripts',()=>{
  assert.deepEqual(guessCardClockVariable(book('日期: today\n角色:\n  时间: later\n世界:\n  时间: now')),variable)
  assert.deepEqual(guessCardClockVariable(book('{"stat_data":{"a/b~c":{"time":"x"}}}')),{source:'mvu',path:'/a~1b~0c/time'})
  assert.deepEqual(guessCardClockVariable(book('{"properties":{"world":{"properties":{"time":{"type":"string"}}}}}')),{source:'mvu',path:'/world/time'})
  for(const content of ['z.object({时间: z.string()})','<% globalThis.executed = true %>\n时间: now','hello, not a schema','a: &loop { time: *loop }']) assert.equal(guessCardClockVariable(book(content)),null)
  assert.equal(globalThis.executed,undefined)
  const raw=book('');raw.first_mes='<initvar>\n世界:\n  时间: midnight\n</initvar>';assert.deepEqual(guessCardClockVariable(raw),variable)
})
test('author > auto > fixed default, status preserves missing values and no appearance or data mutation',()=>{
  const raw=book('世界:\n  时间: initial'),before=JSON.stringify(raw)
  const list=sources=>listWidgetVariableSlots({raw,packs:[pack],sources})[0]
  // private fork: provider metadata is retained by the generic resolver.
  const {candidates,...resolved}=list({mvu:{available:true,value:{世界:{时间:'CURRENT'}}}})
  assert.deepEqual(resolved,{target,instanceLabel:'',active:false,label:'状态栏文字',value:'CURRENT',source:'auto',variable,status:'ready',valueType:'string',default:'fixed',fieldMapping:null,guessHints:widgetVariableSlots(ref,phone)[0].guessHints})
  assert.equal(candidates.length,1);assert.deepEqual(candidates[0].variable,variable)
  assert.equal(candidates[0].value,'CURRENT');assert.ok(candidates[0].score>=65)
  assert.ok(candidates[0].reasons.some(row=>row.reason==='context'))
  assert.equal(list({}).value,'fixed');assert.equal(list({}).status,'unavailable');assert.equal(JSON.stringify(raw),before)
  raw.extensions.dsh_tavern.variableBindings={version:1,entries:[{target,variable:{source:'mvu',path:'/manual'}}]}
  assert.equal(list({mvu:{available:true,value:{manual:'AUTHOR'}}}).source,'author');assert.equal(list({mvu:{available:true,value:{manual:'AUTHOR'}}}).value,'AUTHOR')
  assert.equal(list({mvu:{available:true,value:{世界:{时间:'AUTO'}}}}).value,'fixed')
  assert.equal(list({mvu:{available:true,value:{世界:{时间:'AUTO'}}}}).status,'missing')
  const empty=book('');assert.equal(listWidgetVariableSlots({raw:empty,packs:[pack]})[0].source,'default')
})
test('RPC read/set/clear/list uses one CAS write, no implicit lamp, validates bindable and preserves other fields',async()=>{
  const raw=book('世界:\n  时间: initial');raw.extensions.dsh_tavern.assetBindings.boundPackIds=[]
  const h=boundary(raw),before=await h.api.readVariables({path:'card'})
  assert.deepEqual(before.variableBindings,{version:1,entries:[]})
  await assert.rejects(h.api.setVariable({path:'card',expectedRevision:before.revision,target:{...target,slot:'battery'},variable}))
  assert.equal(h.writes(),0)
  const saved=await h.api.setVariable({path:'card',expectedRevision:before.revision,target,variable:{source:'mvu',path:'/manual'}})
  assert.equal(h.writes(),1);assert.deepEqual(h.get().raw.extensions.dsh_tavern.assetBindings,{boundPackIds:[]})
  assert.equal((await h.api.listVariableSlots({path:'card',sessionId:'test'})).providers[0].slots[0].value,'21:00')
  await assert.rejects(h.api.clearVariable({path:'card',expectedRevision:before.revision,target}),{code:'REVISION_CONFLICT'})
  const cleared=await h.api.clearVariable({path:'card',expectedRevision:saved.revision,target})
  assert.equal((await h.api.listVariableSlots({path:'card',sessionId:'test'})).providers[0].slots[0].source,'auto')
  h.fail();await assert.rejects(h.api.setVariable({path:'card',expectedRevision:cleared.revision,target,variable}),/disk/);assert.equal(h.writes(),2)
  await assert.rejects(h.api.readVariables({path:'other'}),{code:'NOT_FOUND'})
})
test('bounded revision-pinned latest sources reject another card and inherit past pending settlement',async()=>{
  const messages=Array.from({length:24},(_,i)=>({role:'assistant',turn:i+1,swipeId:0,variables:[{stat_data:{time:String(i)}}]}));messages.at(-1).mvu={pending:true}
  const indexed={id:'chat',cardPath:'card',_storageRevision:7,messages},calls=[]
  const readWindow=async(_id,request)=>{calls.push(request);return {revision:7,from:request.before-1,chat:{messages:[messages[request.before-1]],variables:{clock:'LIVE'}}}}
  const sources=await readCardVariableSources({path:'card',indexed,readWindow})
  assert.equal(sources.mvu.value.time,'22');assert.equal(sources['helper-chat'].value.clock,'LIVE');assert.equal(calls.length,20);assert.ok(calls.every(row=>row.limit===1&&row.revision===7))
  await assert.rejects(readCardVariableSources({path:'other',indexed,readWindow}),{code:'NOT_FOUND'})
  delete messages.at(-1).mvu
  const running = await readCardVariableSources({path:'card',indexed,readWindow:async (...args) => {
    const page = await readWindow(...args)
    page.chat.timeline = {branchId:'branch',operations:{settling:{kind:'agent',role:'settlement',status:'running',basedOn:{branchId:'branch'}}}}
    return page
  }})
  assert.equal(running.mvu.value.time,'22')
})
test('real copy-to-card-pack preserves bundle/defaults, binds green and projects auto without changing source',async t=>{
  const root=await mkdtemp(publicJoin(publicTmpdir(), 'card-bindings-')),service=createAssetPackService({assetRoot:root+'/assets',authorizeLease:async()=>true});t.after(()=>service.dispose())
  await writePhonePack(root+'/phone.zip');const preview=await service.inspectImport({bytes:await readFile(root+'/phone.zip')});await service.applyImport({inspectionId:preview.inspectionId,decision:'install',expectedRevision:null,acceptScriptRisk:true})
  const source=await service.getPackSnapshot({packId:PHONE_PACK_ID}),h=boundary(book('世界:\n  时间: init'),service)
  const before=await h.api.snapshot('card'),result=await h.api.copyWidget({path:'card',expectedRevision:before.revision,ref,target:{newPackName:'Card own pack'}})
  const copied=await service.getPackSnapshot({packId:result.copy.packId})
  assert.ok(result.extension.assetBindings.boundPackIds.includes(copied.manifest.id));assert.deepEqual(copied.widgets.phone,source.widgets.phone);assert.deepEqual(await service.getPackSnapshot({packId:PHONE_PACK_ID}),source)
  const presentation=createAssetPackPresentation({raw:h.get().raw,getService:()=>service,origin:'http://localhost',scope:'test'});t.after(()=>presentation.dispose())
  const copiedRef = {...ref,packId:copied.manifest.id}
  const rows=await presentation.widgets({widgets:{}},{sourceRefs:[ref,copiedRef],engine:defaultAssetEngineSettings(),isCurrent:()=>true})
  // private fork: the card copy shadows the source in runtime and list RPC, not on other cards.
  assert.deepEqual(copied.manifest.assets.find(asset => asset.kind === 'widgets').extensions.dsh_tavern.copiedFrom,ref)
  assert.equal(rows.length,1)
  assert.deepEqual(rows[0].definition.ref,copiedRef)
  const slots = (await h.api.listVariableSlots({path:'card'})).providers[0].slots
  assert.equal(slots.find(slot => slot.target.ref.packId === PHONE_PACK_ID).active,false)
  assert.equal(slots.find(slot => slot.target.ref.packId === copied.manifest.id).active,true)
  assert.equal(slots.find(slot => slot.target.ref.packId === copied.manifest.id).instanceLabel,source.manifest.assets.find(asset => asset.kind === 'widgets').name)
  assert.deepEqual(rows[0].definition.settingsOverride,{bindings:{clockText:variable},bindingSources:{clockText:'auto'}})
  assert.equal(rows[0].definition.settings.clockText,'09:41')
  const blueRaw = book('');blueRaw.extensions.dsh_tavern.assetBindings.boundPackIds=[]
  const blue = createAssetPackPresentation({raw:blueRaw,getService:()=>service,getAllowedPackIds:()=>[PHONE_PACK_ID],origin:'http://localhost',scope:'blue'});t.after(()=>blue.dispose())
  assert.equal((await blue.widgets({widgets:{}},{sourceRefs:[ref],engine:defaultAssetEngineSettings(),isCurrent:()=>true})).length,1)
  blueRaw.extensions.dsh_tavern.stage.widgets=false;blue.rebind(blueRaw)
  assert.equal((await blue.widgets({widgets:{}},{sourceRefs:[ref],engine:defaultAssetEngineSettings(),isCurrent:()=>true})).length,0)
  h.fail();await assert.rejects(h.api.copyWidget({path:'card',expectedRevision:result.revision,ref,target:{newPackName:'Retained on conflict'}}),error=>!!error.copiedPack?.packId)
})
