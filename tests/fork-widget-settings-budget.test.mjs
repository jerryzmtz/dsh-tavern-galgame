// private fork: settings and background theme authoring add exactly zero default director bytes.
import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {syntheticPack,cardExtension} from './fixtures/asset-packs/pack.mjs'
import {prepareAssetPackDirector,buildAssetPackRequest} from '../tavern-plugin/lib/domain/stage-asset-pack-director.js'
import {defaultAssetEngineSettings} from '../tavern-plugin/lib/domain/asset-engine-settings.js'
import contract from '../tavern-plugin/src/client/fork-widget-contracts.cjs'
import {createCardAssetBoundary,cardAssetWorkspaceRevision} from '../tavern-plugin/lib/fork-card-asset-bindings.js'
import {createAssetPackPresentation} from '../tavern-plugin/lib/domain/asset-pack-presentation.js'
const phone=JSON.parse(await readFile(new URL('./fixtures/source-widget/widget.json',import.meta.url),'utf8'))
async function fixture(){
 const pack=await syntheticPack(),snapshots=[{...pack,figures:Object.values(pack.figures),revision:'r'}],assetStatus={}
 for(const asset of pack.manifest.assets)assetStatus[pack.manifest.id+'/'+asset.kind+'/'+asset.id]={available:true}
 return {snapshots,assetStatus,raw:{extensions:{dsh_tavern:cardExtension()}},cardRevision:'r',engine:defaultAssetEngineSettings(),target:{sourceKey:'reply',branchId:'branch',revision:1},units:['Synthetic unchanged stage.']}
}
const request=input=>buildAssetPackRequest(prepareAssetPackDirector(input),true,undefined,'',true)
test('phone settings, large dictionaries, card overrides and background tokens never enter model sections',async()=>{
 const input=await fixture(),before=request(input),pack=input.snapshots[0]
 for(const asset of pack.manifest.assets)if(asset.kind==='widgets'){
  const document=pack.widgets[asset.id];document.settingsSchema=structuredClone(phone.settingsSchema);document.i18n=structuredClone(phone.i18n)
  for(let i=0;i<100;i++)document.i18n.messages['zh-CN']['unused.'+i]='purely visual '+i
  asset.settingsDefaults={clockText:'shared',accentColor:'#123456'}
  input.raw.extensions.dsh_tavern.variableBindings={version:1,entries:[{target:{kind:'widgets',ref:{packId:pack.manifest.id,kind:'widgets',assetId:asset.id},slot:'clockText'},variable:{source:'mvu',path:'/private-time'}}]}
 }
 for(const asset of pack.manifest.assets)if(asset.kind==='backgrounds')asset.stageTheme={surface:'#fafafa',fontFamily:'test-font'}
 const after=request(input)
 for(const key of ['system','messages','tools','sections','inputBytes'])assert.deepEqual(after[key],before[key],key+' must have zero increment')
})
test('explicit visible settings enter only the frozen request tail, without changing tool schema or fixed prefix',async()=>{
 const input=await fixture(),before=request(input),pack=input.snapshots[0],asset=pack.manifest.assets.find(asset=>asset.kind==='widgets'),document=pack.widgets[asset.id]
 document.settingsSchema={fields:[{key:'unit',type:'text',maxLength:10,default:'metric',label:'unit',directorVisible:true}]};document.i18n={defaultLocale:'en',messages:{en:{unit:'Display unit'}}}
 const prepared=prepareAssetPackDirector(input);asset.settingsDefaults={unit:'changed'};const after=buildAssetPackRequest(prepared,true,undefined,'',true)
 assert.equal(after.system,before.system);assert.deepEqual(after.tools,before.tools)
 assert.match(JSON.stringify(after.messages),/metric/);assert.equal(JSON.parse(after.messages[0].content[0].text).catalogue.widgets.find(row=>row.settings).settings.unit,'metric')
 assert.ok(after.inputBytes>before.inputBytes)
})

// private fork: individually valid layers are not a valid inherited value by implication.
for (const visible of [true,false]) test('merged '+(visible?'742 B director-visible':'4 KiB full')+' settings fail CAS and isolate only the widget',async()=>{
 const input=await fixture(),pack=input.snapshots[0],asset=pack.manifest.assets.find(a=>a.kind==='widgets'),document=pack.widgets[asset.id]
 const fields=Array.from({length:visible?3:6},(_,i)=>({key:String.fromCharCode(97+i),type:'text',maxLength:visible?80:256,default:'',label:'label',...(visible?{directorVisible:true}:{})}))
 document.settingsSchema={fields};document.i18n={defaultLocale:'en',messages:{en:{label:'Text'}}}
 const value='字'.repeat(visible?80:256),split=visible?2:3
 asset.settingsDefaults=Object.fromEntries(fields.slice(0,split).map(f=>[f.key,value]))
 const ref={packId:pack.manifest.id,kind:'widgets',assetId:asset.id},settings=Object.fromEntries(fields.slice(split).map(f=>[f.key,value]))
 assert.ok(contract.forkValidateWidgetSettingValues(document,asset.settingsDefaults));assert.ok(contract.forkValidateWidgetSettingValues(document,settings))
 if(visible)assert.equal(contract.forkWidgetBytes({...asset.settingsDefaults,...settings}),742)
 // private fork: merged shared defaults, never retired per-card appearance layers.
 asset.settingsDefaults={...asset.settingsDefaults,...settings}
 assert.throws(()=>contract.forkWidgetResolveSettings(document,asset.settingsDefaults),visible?/512 B/:/4 KiB/)
 const before=JSON.stringify(input),prepared=prepareAssetPackDirector(input)
 assert.equal(prepared.context.catalogue.candidates.widgets.length,0)
 assert.ok(Object.values(prepared.context.actors).length); // private fork: fresh actors use ref-derived keys.
 assert.ok(prepared.context.catalogue.candidates.backgrounds.length)
 assert.ok(prepared.diagnostics.some(d=>d.code==='widget-settings-unavailable'&&d.ref.assetId===asset.id))
 assert.doesNotThrow(()=>buildAssetPackRequest(prepared));assert.equal(JSON.stringify(input),before)
 let leases=0
 const service={apiVersion:2,subscribe:()=>()=>{},getPackSnapshot:async()=>pack,resolveAssets:async({refs})=>refs.map(ref=>({ref,value:asset,revision:'r',diagnostics:[]})),leaseWidget:async()=>{leases++;throw Error('must not lease invalid settings')}}
 const presentation=createAssetPackPresentation({raw:input.raw,getService:()=>service,origin:'http://localhost',scope:'test'})
 try {assert.deepEqual(await presentation.widgets({widgets:{one:{ref,state:{label:'x'}}}},{engine:input.engine,isCurrent:()=>true,strict:true}),[]);assert.equal(leases,0)} finally {presentation.dispose()}
})
