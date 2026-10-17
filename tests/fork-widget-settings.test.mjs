import {tmpdir as publicTmpdir} from 'node:os';
import {join as publicJoin} from 'node:path';
// private fork: pack-only cards do not persist empty retired character tables.
// private fork: settings are sparse card/pack data, never history or a new variable source.
import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile,mkdtemp} from 'node:fs/promises'
import contract from '../tavern-plugin/src/client/fork-widget-contracts.cjs'
import theme from '../tavern-plugin/src/client/fork-widget-theme.cjs'
import {validateCardVariableBindings} from '../tavern-plugin/lib/domain/card-variable-bindings.js'
import {createCardAssetBoundary,cardAssetWorkspaceRevision} from '../tavern-plugin/lib/fork-card-asset-bindings.js'
import {createCardBundleAdapter} from '../tavern-plugin/lib/fork-card-bundle.js'
import {readCardAssetExtension} from '../tavern-plugin/lib/domain/card-asset-bindings.js'
import {createWidgetVariableService} from '../tavern-plugin/lib/domain/widget-variable-service.js'
import {projectWidgetSettingBindings} from '../tavern-plugin/lib/domain/widget-variables.js'
import {widgetChatFixture} from './fixtures/widget-variable-chat.mjs'
import {syntheticPack,OTHER_PACK_ID} from './fixtures/asset-packs/pack.mjs'
import {officialPhonePack,writePhonePack,PHONE_PACK_ID} from './fixtures/source-widget/fork-build-phone-widget.mjs'
import {createAssetPackService} from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/service.js'
import {copyPackItems} from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/copy-items.js'
import {sealPack,verifyBytes} from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/validation.js'
const phone=JSON.parse(await readFile(new URL('./fixtures/source-widget/widget.json',import.meta.url),'utf8'))
const ref={packId:PHONE_PACK_ID,kind:'widgets',assetId:'phone'}, image={...ref,kind:'backgrounds',assetId:'wallpaper'}
const resolve=(defaults={},override={},projected={})=>contract.forkWidgetResolveSettings(phone,defaults,override,projected)
const validate=value=>contract.forkValidateWidgetDocument(value)
test('six closed setting types, defaults, dictionary, legacy rejection and malicious declarations',()=>{
 assert.deepEqual(validate(phone),phone)
 const edits=[v=>v.optionsSchema={},v=>v.settingsSchema.fields.push(v.settingsSchema.fields[0]),v=>v.settingsSchema.fields[0].key='constructor',v=>v.settingsSchema.fields[0].maxLength=257,v=>v.settingsSchema.fields[0].unknown=true,v=>v.settingsSchema.fields[0].default=9,
  v=>v.settingsSchema.fields[0].label='missing',v=>v.i18n.messages['zh-CN']['clock.label']='字'.repeat(81),v=>v.settingsSchema.fields[0].directorVisible=true,
  v=>v.settingsSchema.fields[2].step=0,v=>v.settingsSchema.fields[2].step=.0001,v=>v.settingsSchema.fields[2].default=81,v=>v.settingsSchema.fields[2].unit='px',
  v=>v.settingsSchema.fields[3].choices[1].value='island',v=>v.settingsSchema.fields[3].choices[1].value='url(x)',v=>v.settingsSchema.fields[4].default='url(https://bad)',v=>v.settingsSchema.fields[4].stageToken='shadow',v=>v.settingsSchema.fields[4].bindable=false,v=>v.settingsSchema.fields[7].default=image]
 for(const edit of edits){const value=structuredClone(phone);edit(value);assert.throws(()=>validate(value),{code:'INVALID_WIDGET'})}
 for(const [key,value] of [['statusBar','false'],['battery',Infinity],['battery',81],['cutout','unknown'],['wallpaper','https://example.org'],['clockText',{}],['wallpaper',{...image,path:'private.js'}]])assert.throws(()=>contract.forkValidateWidgetSettingValues(phone,{[key]:value}))
 const empty=structuredClone(phone);delete empty.settingsSchema;delete empty.i18n;assert.deepEqual(resolve().settings.clockText,'09:41');assert.ok(validate(empty))
 const large=structuredClone(phone);large.settingsSchema.fields=Array.from({length:20},(_,i)=>({key:'text'+i,type:'text',label:'clock.label',maxLength:256,default:'x'.repeat(256)}));assert.throws(()=>validate(large))
})
// private fork: appearances are pack-only; bindings have no per-card literal fallback.
test('shared defaults retain false, empty and null; variable projection falls back to pack defaults',()=>{
 const result=resolve({clockText:'',statusBar:false,wallpaper:null,accentColor:'#AABBCC'})
 assert.equal(result.settings.clockText,'');assert.equal(result.settings.statusBar,false);assert.equal(result.settings.wallpaper,null);assert.equal(result.settings.accentColor,'#aabbcc')
 const binding={bindings:{clockText:{source:'mvu',path:'/time'}},bindingSources:{clockText:'auto'}}
 assert.equal(resolve({clockText:'shared'},binding).settings.clockText,'shared')
 assert.equal(resolve({},binding,{clockText:{status:'ready',value:20}}).settings.clockText,'20')
 assert.equal(resolve({},binding,{clockText:{status:'ready',value:{private:1}}}).settings.clockText,'09:41')
 assert.equal(resolve({},binding,{clockText:{status:'ready',value:{private:1}}}).diagnostics.clockText,'type-mismatch')
 assert.equal(resolve({},binding,{clockText:{status:'ready',value:'字'.repeat(30)}}).diagnostics.clockText,'truncated')
 assert.equal(resolve({},binding).sources.clockText,'auto')
})
test('card variable mapping identities, paths and budgets are closed',()=>{
 const row={target:{kind:'widgets',ref,slot:'clockText'},variable:{source:'mvu',path:'/time'}}
 assert.ok(validateCardVariableBindings({version:1,entries:[row]}))
 assert.throws(()=>validateCardVariableBindings({version:1,entries:[row,row]}))
 for(const path of ['', '/constructor/x','/$secret','/__hidden','/a[0]','/'+Array(9).fill('x').join('/'),'/'+ '字'.repeat(86),'/~2'])assert.throws(()=>contract.forkValidateWidgetSettingBindings({clockText:{source:'mvu',path}},phone))
 assert.throws(()=>contract.forkValidateWidgetSettingBindings({accentColor:{source:'mvu',path:'/color'}},phone))
 assert.throws(()=>contract.forkValidateWidgetSettingBindings({clockText:{source:'script',path:'/time'}},phone))
 assert.throws(()=>contract.forkValidateWidgetSettingBindings({clockText:{source:'mvu',path:'/time',fallback:'fixed'}},phone))
})
test('card boundary uses one complete CAS write; a failed or stale save does not publish settings',async()=>{
 let workspace={raw:{extensions:{dsh_tavern:{schemaVersion:1,stage:{},assetBindings:{boundPackIds:[]}}}}},writes=0,fail=false
 const boundary=createCardAssetBoundary({ctx:{get:name=>name==='assetLibrary'?{getPackSnapshot:async()=>({manifest:{id:PHONE_PACK_ID,assets:[{kind:'widgets',id:'phone'}]},widgets:{phone}})}:null},listCards:async()=>[{path:'synthetic'}],readWorkspace:async()=>workspace,
  updateCard:async(_path,_patch,_none,operations,revision)=>{if(fail)throw new Error('disk failure');assert.equal(revision,cardAssetWorkspaceRevision(workspace));writes++;workspace={raw:{extensions:{dsh_tavern:operations[0].value}}}}})
 const before=await boundary.snapshot('synthetic'),patch={variableBindings:{version:1,entries:[{target:{kind:'widgets',ref,slot:'clockText'},variable:{source:'mvu',path:'/time'}}]}}
 const saved=await boundary.update({path:'synthetic',patch,expectedRevision:before.revision});assert.equal(writes,1);assert.deepEqual(saved.extension.assetBindings.boundPackIds,[]);assert.deepEqual(saved.extension.stage,before.extension.stage)
 await assert.rejects(boundary.update({path:'synthetic',patch,expectedRevision:before.revision}),{code:'REVISION_CONFLICT'})
 fail=true;await assert.rejects(boundary.update({path:'synthetic',patch,expectedRevision:saved.revision}),/disk failure/);assert.equal(writes,1)
})
test('binding and business reads share the native read point before/end page, pending and selected swipe',async t=>{
 const h=await widgetChatFixture(t),authorize=h.config.authorize,settings={document:phone,defaults:{clockText:'fixed'},override:{bindings:{clockText:{source:'mvu',path:'/balance'}}}}
 const service=createWidgetVariableService({...h.config,authorize:async input=>({...await authorize(input),settings})});t.after(()=>service.dispose())
 await h.mutate(chat=>chat.messages.push({role:'user',turn:2,text:'next'},{role:'assistant',turn:2,text:'two pages',swipeId:0,variables:[{...h.variables,stat_data:{balance:40}},{...h.variables,stat_data:{balance:80}}],mvu:{receipt:{status:'updated'}}}))
 const read=(page,viewEpoch)=>service.read({...h.input,turn:2,page:{index:page},viewEpoch})
 assert.equal((await read(0,2)).settings.clockText,'20');const end=await read(1,3);assert.equal(end.settings.clockText,String(end.values.balance.value));assert.equal(end.settings.clockText,'40');assert.deepEqual(end.settingsFeedback.clockText,{value:'40',source:'author',status:'ready',bindingSource:'mvu',snapshot:end.snapshot});assert.doesNotMatch(JSON.stringify(end.settingsFeedback),/\/balance/)
 await h.mutate(chat=>{chat.messages[2].swipeId=1});assert.equal((await read(1,4)).settings.clockText,'80')
 await h.mutate(chat=>{chat.messages[2].mvu.pending=true});assert.equal((await read(1,5)).settings.clockText,'20');assert.equal(h.dispatches(),0)
 // private fork: generic resolver supports list paths for every consumer.
 const sources={mvu:{available:true,value:{list:['first']}}};assert.deepEqual(projectWidgetSettingBindings({clockText:{source:'mvu',path:'/list/0'}},sources,new Map()).clockText,{status:'ready',value:'first'})
})
test('Helper setting feedback is explicitly live-only and falls back before the final page or in history',async t=>{
 const h=await widgetChatFixture(t),settings={document:phone,defaults:{clockText:'fixed'},override:{bindings:{clockText:{source:'helper-chat',path:'/clock'}}}};
 await h.mutate(chat=>{chat.variables={clock:'LIVE'}});const service=createWidgetVariableService({...h.config,authorize:async input=>({...await h.config.authorize(input),settings})});t.after(()=>service.dispose());
 const value=await service.read({...h.input,viewEpoch:2});assert.equal(value.settings.clockText,'LIVE');assert.deepEqual(value.settingsFeedback.clockText.snapshot,{kind:'live-only',turn:1});
 for(const [viewEpoch,extra] of [[3,{page:{index:0}}],[4,{live:false}]]){const result=await service.read({...h.input,viewEpoch,...extra});assert.equal(result.settings.clockText,'fixed');assert.equal(result.settingsFeedback.clockText.status,'unavailable');assert.deepEqual(result.settingsFeedback.clockText.snapshot,{kind:'unavailable',turn:null})}
 assert.equal(h.dispatches(),0)
})
test('stage theme has nine tokens, authored-only layers, contrast protection and deterministic colour sampling',()=>{
 const skin={textbox:{paint:{bg:'#222222',fg:'#ffffff',accent:'#ff0000'},shape:{radius:3}},font:{body:'body',name:'heading'}}
 const result=theme.forkWidgetComposeTheme({derived:{surface:'#113344',border:'#123456'},skin,background:{surface:'#ffffff',radius:20},font:id=>id+', serif'})
 assert.equal(Object.keys(result.theme).length,9);assert.equal(result.theme.surface,'#ffffff');assert.equal(result.theme.accent,'#ff0000');assert.equal(result.theme.border,'#123456');assert.equal(result.theme.radius,20);assert.equal(result.theme.fontFamily,'body, serif');assert.ok(result.corrected.includes('surfaceText'))
 for(const [a,b] of [['surfaceText','surface'],['muted','surface'],['accentText','accent']])assert.ok(theme.forkWidgetThemeContrast(result.theme[a],result.theme[b])>=4.5)
 for(const value of [{shadow:'x'},{accent:'red'},{fontFamily:'url(font.woff)'},{radius:41},{surface:null}])assert.throws(()=>theme.forkValidateStageTheme(value))
 const pixels=new Uint8ClampedArray([200,80,40,255,200,80,40,255,0,0,0,255,255,255,255,0]);const sample=theme.forkWidgetAnalysePixels(pixels)
 assert.deepEqual(sample,theme.forkWidgetAnalysePixels(pixels));assert.deepEqual(theme.forkWidgetAnalysePixels(new Uint8ClampedArray(16)),null)
 assert.notDeepEqual(theme.forkWidgetDerivedTheme(sample,true),theme.forkWidgetDerivedTheme(sample,false))
})
test('real shared-default patch/import/export/copy keeps dictionaries, settings and CAS; does not mutate a card',async t=>{
 const root=await mkdtemp(publicJoin(publicTmpdir(), 'widget-settings-')),service=createAssetPackService({assetRoot:root+'/store'});t.after(()=>service.dispose())
 await writePhonePack(root+'/phone.zip');const inspection=await service.inspectImport({bytes:await readFile(root+'/phone.zip')});const installed=await service.applyImport({inspectionId:inspection.inspectionId,expectedRevision:null,decision:'install',acceptScriptRisk:true})
 const patch={assets:installed.snapshot.manifest.assets.map(asset=>({...asset,settingsDefaults:{clockText:'shared',sound:false}}))}
 const saved=await service.patchPack({packId:PHONE_PACK_ID,expectedRevision:installed.snapshot.revision,patch})
 assert.equal(saved.snapshot.widgets.phone.i18n.messages['zh-CN']['clock.label'],'状态栏文字')
 await assert.rejects(service.patchPack({packId:PHONE_PACK_ID,expectedRevision:installed.snapshot.revision,patch}),{code:'REVISION_CONFLICT'})
 await assert.rejects(service.patchPack({packId:PHONE_PACK_ID,expectedRevision:saved.snapshot.revision,patch:{assets:[{...patch.assets[0],settingsDefaults:{battery:81}}]}}))
 const exported=await service.exportPack({packId:PHONE_PACK_ID,expectedRevision:saved.snapshot.revision}),back=await service.inspectImport({bytes:exported.bytes})
 assert.deepEqual(back.incoming.manifest.assets[0].settingsDefaults,{clockText:'shared',sound:false})
 const copied=await service.copyItems({sourcePackId:PHONE_PACK_ID,itemRefs:[{kind:'widgets',id:'phone'}],target:{newPackName:'Settings copy'}})
 assert.deepEqual((await service.getPackSnapshot({packId:copied.packId})).manifest.assets[0].settingsDefaults,patch.assets[0].settingsDefaults)
})

test('copy closure remaps same-pack wallpaper and preserves background theme; card mappings include both roots',async()=>{
 const source=await officialPhonePack(),art=await syntheticPack(),{variants,...identity}=art.manifest.assets[0],background={...identity,...variants.entries[0].content,id:'wallpaper',stageTheme:{accent:'#112233',radius:8},enabled:false}
 source.manifest.assets.push(background);source.manifest.assets[0].settingsDefaults={wallpaper:image};source.manifest.blobs[background.media]=art.manifest.blobs[background.media];source.files.set('media/'+background.media+'.png',art.files.get('media/'+background.media+'.png'));await sealPack(source.manifest,source.files)
 const verified=await verifyBytes(source.manifest,source.files),target=await officialPhonePack();target.manifest.id=OTHER_PACK_ID
 const copied=copyPackItems(verified,[{kind:'widgets',id:'phone'}],target.manifest,target.files,new Set());await sealPack(target.manifest,target.files);await verifyBytes(target.manifest,target.files)
 const widget=target.manifest.assets.find(asset=>asset.id===copied.find(row=>row.kind==='widgets').toId)
 assert.notEqual(widget.id,'phone');assert.deepEqual(widget.settingsDefaults.wallpaper,{...image,packId:OTHER_PACK_ID});assert.deepEqual(target.manifest.assets.find(asset=>asset.kind==='backgrounds').stageTheme,background.stageTheme);assert.equal(target.manifest.assets.find(asset=>asset.kind==='backgrounds').enabled,false)
 const raw={extensions:{dsh_tavern:{schemaVersion:1,assetBindings:{boundPackIds:[PHONE_PACK_ID]},variableBindings:{version:1,entries:[{target:{kind:'widgets',ref,slot:'clockText'},variable:{source:'mvu',path:'/time'}}]}}}}
 const adapter=createCardBundleAdapter({cardPreparation:{create:({payload})=>({raw:payload})}}),remapped=adapter.remapRaw(raw,[{from:PHONE_PACK_ID,packId:OTHER_PACK_ID,figures:{}}])
 assert.equal(remapped.extensions.dsh_tavern.variableBindings.entries[0].target.ref.packId,OTHER_PACK_ID);assert.equal(raw.extensions.dsh_tavern.variableBindings.entries[0].target.ref.packId,PHONE_PACK_ID)
})
