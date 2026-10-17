// private fork: assert the CLI v1 receipt; persisted record diagnostics retain domain codes.
import test from 'node:test'
import assert from 'node:assert/strict'
import {performanceFixture,performanceRef} from './helpers/performance-director-fixture.mjs'
import {officialPhonePack,PHONE_PACK_ID} from './fixtures/source-widget/fork-build-phone-widget.mjs'
import {buildAssetPackRequest,createAssetPackTransaction,readAssetPackRecord,assetPackStateAt} from '../tavern-plugin/lib/domain/stage-asset-pack-director.js'
import {assetPackDigest} from '../tavern-plugin/lib/domain/stage-asset-pack-catalogue.js'
import registry from '../tavern-plugin/packages/dsh-presentation-protocol/src/director-commands.cjs'
import {reduceAssetPackOperation} from '../tavern-plugin/lib/domain/stage-asset-pack-tools.js'
import {defaultAssetEngineSettings,validateAssetEngineSettings} from '../tavern-plugin/lib/domain/asset-engine-settings.js'
const ref={...performanceRef('clock'),kind:'widgets'}
const command=(name,args={})=>({op:'widget.clock.'+name,ref,...args})
const call=(ops,at=1,through=8,sequence=1)=>({sequence,through,done:through===8,beats:[{at,ops}]})
test('v3 named set/patch/clear share one full-ref instance; repeated set does not renew lifetime',async()=>{
 const f=await performanceFixture(),p=f.prepare(),tx=f.transaction(p)
 assert.equal(p.binding.commandSpecVersion,registry.version)
 assert.equal(tx.submit(call([command('set',{label:'First'})],1,1)).ok,true)
 assert.equal(tx.submit(call([command('update',{label:'Second'}),command('set',{label:'Second'})],2,8,2)).ok,true)
 const record=tx.effect(),widget=Object.values(record.end.widgets)[0]
 assert.deepEqual(widget.ref,ref);assert.deepEqual(widget.state,{label:'Second'});assert.equal(widget.bornStoryTime,0)
 assert.equal(record.entries.at(-1).ops.length,1)
 const next=f.prepare({record}),clear=f.transaction(next)
 assert.equal(clear.submit(call([command('clear'),command('clear')])).ok,true)
 assert.deepEqual(clear.effect().end.widgets,{})
})
test('invalid/obsolete ops soft-drop while valid siblings and snapshots survive; tools stay static',async()=>{
 const f=await performanceFixture(),p=f.prepare(),tx=f.transaction(p)
 const result=tx.submit(call([{op:'widget.show',widgetId:'old',ref,props:{label:'Old'}},command('update',{label:'Unset'}),command('set',{label:42}),{op:'weather.set',weather:'rain'}]))
 assert.equal(result.errors.length,3);tx.finish();assert.equal(tx.effect().end.weather,'rain')
 const empty=structuredClone(p);empty.context.catalogue.candidates.widgets=[];empty.units=[]
 assert.deepEqual(buildAssetPackRequest(p).tools,buildAssetPackRequest(empty).tools) // private fork: installed grammar is static; turn admission is validated at execution.
 assert.doesNotMatch(JSON.stringify(buildAssetPackRequest(p).tools),/widget\.show|phone\.mark|propsSchema/)
 assert.equal(registry.describe(p.context,'widget.clock.set',ref)[0].args.properties.label.type,'string')
})
test('history snapshots remain authoritative; unknown fields and obsolete widget ops never execute',async()=>{
 const f=await performanceFixture(),p=f.prepare(),tx=f.transaction(p)
 tx.submit(call([{op:'weather.set',weather:'rain'}]));const record=structuredClone(tx.effect())
 record.binding.commandSpecVersion=2
 for(const state of [record.baseline,record.end,...record.entries.map(e=>e.state)]) {state.widgetState={old:true};state.phone={old:true};state.widgets={old:{type:ref,props:{label:'Old'},slot:'corner-right',lifetime:{until:'explicit'},bornStoryTime:0}}}
 record.entries[0].ops.push({op:'widget.show',widgetId:'old',ref,props:{label:'Old'}},{op:'phone.mark',contact:'actor',side:'in'})
 record.digest=assetPackDigest({binding:record.binding,baseline:record.baseline,entries:record.entries,end:record.end})
 const before=structuredClone(record),checked=readAssetPackRecord(record)
 // private fork: the wire body stays authenticated; only projected widgets/ops are filtered.
 assert.deepEqual(checked,record)
 assert.equal(checked.entries[0].ops.map(op=>registry.recordOperation(op,checked.binding)).filter(Boolean).length,1)
 const projected=assetPackStateAt(checked,1)
 assert.equal(projected.weather,'rain')
 assert.deepEqual(projected.widgets,{})
 assert.equal(projected.widgetState,undefined);assert.equal(projected.phone,undefined)
 assert.deepEqual(record,before)
 record.digest='tampered';assert.throws(()=>readAssetPackRecord(record),/digest/)
})
test('phone pack marks only existing source dialogue and source effects do not spend state-widget caps',async()=>{
 const f=await performanceFixture(),phone=await officialPhonePack()
 phone.revision='phone-r1';f.input.snapshots.push(phone)
 f.input.raw.extensions.dsh_tavern.assetBindings.boundPackIds.push(PHONE_PACK_ID)
 f.input.assetStatus[PHONE_PACK_ID+'/widgets/phone']={available:true}
 f.input.units[0]={kind:'line',alias:'actor',text:'Existing source.'}
 f.input.engine.actionCaps={widget:0}
 const p=f.prepare(),tx=f.transaction(p),mark={op:'widget.testphone.mark',ref:{packId:PHONE_PACK_ID,kind:'widgets',assetId:'phone'},contact:p.context.speakerActors.actor,side:'in'} // private fork: derive the current key without rewriting source units.
 assert.equal(tx.submit(call([mark])).ok,true)
 assert.deepEqual(tx.effect().end.widgets,{})
 const invalid=f.transaction(p);assert.equal(invalid.submit(call([{...mark,text:'invented'}])).errors.length,1)
 assert.equal(registry.recordOperation(mark).op,'widget.source')
 assert.equal(registry.recordOperation({op:'phone.mark'}),null)
})
test('full refs distinguish identical namespaces; missing refs repair without executing a guessed target',async()=>{
 const f=await performanceFixture(),p=structuredClone(f.prepare()),other=structuredClone(p.context.catalogue.candidates.widgets[0])
 other.ref.assetId='other-clock';other.widget.commands[0].params.properties.label.maxLength=2
 p.context.catalogue.candidates.widgets.push(other)
 const a=reduceAssetPackOperation(p.baseline,command('set',{label:'Clock'}),p.context,{at:1}).state
 assert.equal(Object.keys(a.widgets).length,1)
 assert.throws(()=>reduceAssetPackOperation(a,{...command('set',{label:'Clock'}),ref:other.ref},p.context,{at:1}))
 const b=reduceAssetPackOperation(a,{...command('set',{label:'Hi'}),ref:other.ref},p.context,{at:1}).state
 assert.equal(Object.keys(b.widgets).length,2)
 const tx=f.transaction(p),missing=command('set',{label:'Clock'});delete missing.ref
 const receipt=tx.submit(call([missing]))
 assert.equal(receipt.errors[0].command,'widget.clock.set');assert.equal(receipt.errors[0].retryable,true)
 assert.deepEqual(tx.savepoint().state.state.widgets,{})
})
// private fork: package presentation never enters director catalogue, help or tools.
test('ten presentation declarations add exactly zero director bytes',async()=>{
 const f=await performanceFixture(),p=structuredClone(f.prepare()),base=p.context.catalogue.candidates.widgets[0]
 p.context.catalogue.candidates.widgets=Array.from({length:10},(_,i)=>({...structuredClone(base),ref:{...base.ref,assetId:i?'clock-'+i:base.ref.assetId}}))
 const before=buildAssetPackRequest(p),help=registry.describe(p.context,'widget.clock.set')
 for(const [i,candidate] of p.context.catalogue.candidates.widgets.entries()) candidate.widget.presentation={open:{width:280+i,height:180,minWidth:200,minHeight:100,anchor:'corner-right'},compact:{width:240,height:80,minWidth:200,minHeight:44,anchor:'top-center'},notifications:'changes'}
 const after=buildAssetPackRequest(p)
 assert.equal(after.inputBytes,before.inputBytes);assert.equal(JSON.stringify(after.tools),JSON.stringify(before.tools));assert.equal(after.system,before.system);assert.equal(JSON.stringify(after.messages),JSON.stringify(before.messages))
 assert.deepEqual(registry.describe(p.context,'widget.clock.set'),help)
})
// private fork: variable sharing is renderer-only, never a director capability.
test('variable read/write declarations add exactly zero director input, tool and help bytes',async()=>{
 const f=await performanceFixture(),p=structuredClone(f.prepare()),before=buildAssetPackRequest(p),help=registry.describe(p.context,'widget.clock.set')
 for(const candidate of p.context.catalogue.candidates.widgets) candidate.widget.variables={reads:{balance:{source:'mvu',path:'/balance'}},writes:{balance:{source:'mvu',path:'/balance',scope:'exact',ops:['delta']}}}
 const after=buildAssetPackRequest(p)
 assert.equal(after.inputBytes,before.inputBytes);assert.equal(JSON.stringify(after.tools),JSON.stringify(before.tools));assert.equal(after.system,before.system);assert.equal(JSON.stringify(after.messages),JSON.stringify(before.messages))
 assert.deepEqual(registry.describe(p.context,'widget.clock.set'),help)
})
test('private attachments add zero model bytes; module disable removes widget help; retired dimensions stay inert',async()=>{
 const f=await performanceFixture(),p=structuredClone(f.prepare()),before=buildAssetPackRequest(p)
 p.context.catalogue.candidates.widgets[0].widget.assets=Object.fromEntries(Array.from({length:10},(_,i)=>['private'+i,{kind:'sfx',path:'assets/'+i+'.wav'}]))
 const after=buildAssetPackRequest(p)
 assert.equal(JSON.stringify(before.tools),JSON.stringify(after.tools));assert.equal(before.system,after.system)
 assert.equal(JSON.stringify(before.messages),JSON.stringify(after.messages))
 const settings=defaultAssetEngineSettings();settings.dimensions.phone=true
 assert.equal(validateAssetEngineSettings(settings).dimensions.phone,undefined)
 assert.equal(settings.dimensions.phone,true)
 p.context.dimensions.widgets=false
 assert.equal(registry.selected(p.context).some(item=>item.name.startsWith('widget.')),false)
})
