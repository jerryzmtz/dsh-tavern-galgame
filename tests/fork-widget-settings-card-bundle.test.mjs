import {tmpdir as publicTmpdir} from 'node:os';
import {join as publicJoin} from 'node:path';
// private fork: pack-only cards do not persist empty retired character tables.
// private fork: real multi-pack/card ZIP storage, frozen mappings, CAS and injected publication failures.
import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,readFile} from 'node:fs/promises'
import {createAssetPackService} from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/service.js'
import {createCardBundleAdapter} from '../tavern-plugin/lib/fork-card-bundle.js'
import {createCardPreparation} from '../tavern-plugin/lib/domain/card-preparation.js'
import {createAssetPackPresentation} from '../tavern-plugin/lib/domain/asset-pack-presentation.js'
import {defaultAssetEngineSettings} from '../tavern-plugin/lib/domain/asset-engine-settings.js'
import {writePhonePack,PHONE_PACK_ID} from './fixtures/source-widget/fork-build-phone-widget.mjs'
import {syntheticPack} from './fixtures/asset-packs/pack.mjs'
async function fixture(t){
 const root=await mkdtemp(publicJoin(publicTmpdir(), 'settings-card-zip-')),prep=createCardPreparation(),cards=new Map();let fault,failCard=false
 const adapter=createCardBundleAdapter({cardPreparation:prep,authorizeTarget:async key=>({cardId:key}),readWorkspace:async key=>structuredClone(cards.get(key)),writeWorkspace:async(key,value)=>{if(failCard)throw new Error('card-write');cards.set(key,structuredClone(value))},withCardLock:async(_key,task)=>task()})
 const service=createAssetPackService({assetRoot:root+'/assets',cardTransactions:adapter,authorizeLease:async()=>true,fault:async point=>{if(point===fault)throw new Error(point)}});t.after(()=>service.dispose())
 await writePhonePack(root+'/phone.zip');const inspected=await service.inspectImport({bytes:await readFile(root+'/phone.zip')});let phone=(await service.applyImport({inspectionId:inspected.inspectionId,expectedRevision:null,decision:'install',acceptScriptRisk:true})).snapshot
 let paper=(await service.createPack({name:'External paper',expectedRevision:null})).snapshot
 const art=await syntheticPack(),asset=art.manifest.assets[0].variants.entries[0].content,descriptor=art.manifest.blobs[asset.media]
 // private fork: install wallpaper media and its owning background in the same CAS.
 paper=(await service.patchPack({packId:paper.manifest.id,expectedRevision:paper.revision,patch:{blobs:{...paper.manifest.blobs,[asset.media]:descriptor},assets:[{kind:'backgrounds',id:'paper',name:'Paper',media:asset.media,enabled:true,recall:{mode:'constant',keywords:[]},directorNote:'',stageTheme:{accent:'#335577'}}]},fileUpdates:new Map([['media/'+asset.media+'.png',art.files.get('media/'+asset.media+'.png')]])})).snapshot
 const image={packId:paper.manifest.id,kind:'backgrounds',assetId:'paper'},ref={packId:PHONE_PACK_ID,kind:'widgets',assetId:'phone'}
 phone=(await service.patchPack({packId:PHONE_PACK_ID,expectedRevision:phone.revision,patch:{assets:[{...phone.manifest.assets[0],settingsDefaults:{clockText:'shared',wallpaper:image}}]}})).snapshot
 const raw={name:'Synthetic settings card',extensions:{dsh_tavern:{schemaVersion:1,stage:{widgets:true},assetBindings:{boundPackIds:[PHONE_PACK_ID,paper.manifest.id]},variableBindings:{version:1,entries:[{target:{kind:'widgets',ref,slot:'clockText'},variable:{source:'mvu',path:'/story/time'}}]}}}}
 cards.set('source',prep.create({kind:'import',payload:raw}))
 const exportCard=async packIds=>{const card=await adapter.snapshot({path:'source'});return service.exportCardBundle({path:'source',expectedRevision:card.revision,packIds:packIds || raw.extensions.dsh_tavern.assetBindings.boundPackIds})}
 const change=async()=>{for(const original of [phone,paper]){const pack=await service.getPackSnapshot({packId:original.manifest.id});await service.patchPack({packId:pack.manifest.id,expectedRevision:pack.revision,patch:{name:'local-'+pack.manifest.name,assets:pack.manifest.assets.map(asset=>asset.kind==='widgets'?{...asset,settingsDefaults:{clockText:'local'}}:{...asset,stageTheme:{accent:'#123456'}})}})}}
 const apply=async(service,bytes,decision='keep-both')=>{const preview=await service.inspectCardBundle({path:'target',bytes});return service.applyCardBundle({disableWidgets:false, /* private fork: preserve exported preference */ inspectionId:preview.inspectionId,expectedRevision:preview.expectedRevision,decisions:Object.fromEntries(preview.packs.map(pack=>[pack.packId,decision])),acceptScriptRisk:true})}
 return {root,prep,cards,raw,adapter,service,phone,paper,ref,image,exportCard,change,apply,setFault:value=>{fault=value},failCard:()=>{failCard=true}}
}
test('card ZIP installs schema/defaults/binding without materializing shared values; only-card preserves dormant refs',async t=>{
 const f=await fixture(t),zip=await f.exportCard(),target=createAssetPackService({assetRoot:f.root+'/empty',cardTransactions:f.adapter});t.after(()=>target.dispose())
 await f.apply(target,zip.bytes,'install');assert.deepEqual(f.cards.get('target').raw.extensions.dsh_tavern.assetBindings,f.raw.extensions.dsh_tavern.assetBindings)
 const imported=await target.getPackSnapshot({packId:PHONE_PACK_ID});assert.equal(imported.manifest.assets[0].settingsDefaults.clockText,'shared');assert.equal(imported.widgets.phone.i18n.messages['zh-CN']['clock.label'],'状态栏文字')
 const another=createAssetPackService({assetRoot:f.root+'/card-only',cardTransactions:f.adapter});t.after(()=>another.dispose());await f.apply(another,(await f.exportCard([])).bytes,'noop');assert.equal((await another.listPacks()).length,0);assert.deepEqual(f.cards.get('target').raw.extensions.dsh_tavern.variableBindings.entries,f.raw.extensions.dsh_tavern.variableBindings.entries)
})
test('multi-pack update restores shared defaults/theme, noop retains pack revisions and import diff exposes defaults',async t=>{
 const f=await fixture(t),bytes=(await f.exportCard()).bytes;await f.change();const preview=await f.service.inspectCardBundle({path:'target',bytes});const phone=preview.packs.find(pack=>pack.packId===PHONE_PACK_ID);assert.ok(phone.diff.assets.changed.some(value=>JSON.stringify(value).includes('phone')))
 await f.apply(f.service,bytes,'update');assert.equal((await f.service.getPackSnapshot({packId:PHONE_PACK_ID})).manifest.assets[0].settingsDefaults.clockText,'shared');const before=await f.service.listPacks();await f.apply(f.service,bytes,'noop');assert.deepEqual(await f.service.listPacks(),before)
})
test('multi-pack keep-both remaps root, wallpaper, defaults and bound packs, never paths or source card',async t=>{
 const f=await fixture(t);f.cards.set('source',f.prep.create({kind:'import',payload:f.raw}));const bytes=(await f.exportCard()).bytes,original=structuredClone(f.cards.get('source'));await f.change();const before=await f.service.listPacks(),result=await f.apply(f.service,bytes)
 const mapping=id=>result.mappings.find(row=>row.from===id).packId,bindings=f.cards.get('target').raw.extensions.dsh_tavern.assetBindings,row=f.cards.get('target').raw.extensions.dsh_tavern.variableBindings.entries[0]
 // private fork: keep-both names travel with the risk DTO, not an old-id UI lookup.
 assert.equal(row.enabled,undefined);assert.ok(result.widgetRisks.length);for(const risk of result.widgetRisks){assert.equal(risk.packName,f.phone.manifest.name);assert.equal(risk.widgetName,f.phone.manifest.assets[0].name)}
 assert.equal(row.target.ref.packId,mapping(PHONE_PACK_ID));assert.equal(row.variable.path,'/story/time');assert.deepEqual(bindings.boundPackIds,[mapping(PHONE_PACK_ID),mapping(f.paper.manifest.id)])
 const phone=await f.service.getPackSnapshot({packId:row.target.ref.packId}),paper=await f.service.getPackSnapshot({packId:mapping(f.paper.manifest.id)});assert.equal(phone.manifest.assets[0].settingsDefaults.wallpaper.packId,paper.manifest.id);assert.equal(phone.manifest.assets[0].settingsDefaults.clockText,'shared');assert.deepEqual(paper.manifest.assets[0].stageTheme,{accent:'#335577'})
 assert.deepEqual(f.cards.get('source'),original);for(const pack of before)assert.deepEqual(await f.service.getPackSnapshot({packId:pack.manifest.id}),pack)
})
for(const point of ['batch-pack-published','batch-local-published','batch-before-card','card-write'])test('settings multi-pack '+point+' failure publishes neither card nor half a remap',async t=>{
 const f=await fixture(t),bytes=(await f.exportCard()).bytes;await f.change();const before=await f.service.listPacks(),raw=structuredClone(f.cards.get('source'));if(point==='card-write')f.failCard();else f.setFault(point)
 await assert.rejects(f.apply(f.service,bytes));f.setFault(null);assert.deepEqual(await f.service.listPacks(),before);assert.equal(f.cards.has('target'),false);assert.deepEqual(f.cards.get('source'),raw)
})
// private fork: card import rejects retired overrides at entry; stale previews still fail CAS.
test('import rejects retired widget fields and refuses stale previews',async t=>{
 const f=await fixture(t),retired=structuredClone(f.raw);retired.extensions.dsh_tavern.assetBindings.widgets=[]
 assert.throws(()=>f.prep.create({kind:'import',payload:retired}),{code:'UNKNOWN_FIELD'})
 const bytes=(await f.exportCard()).bytes;await f.change()
 const preview=await f.service.inspectCardBundle({path:'target',bytes});await f.change();await assert.rejects(f.service.applyCardBundle({disableWidgets:false,inspectionId:preview.inspectionId,expectedRevision:preview.expectedRevision,decisions:Object.fromEntries(preview.packs.map(pack=>[pack.packId,'update'])),acceptScriptRisk:true}),{code:'REVISION_CONFLICT'})
})
// private fork: imported card mappings cannot turn appearance settings into variable slots.
test('card bundle validates bindable declarations before publishing packs or cards',async t=>{
 const f=await fixture(t);f.raw.extensions.dsh_tavern.variableBindings.entries[0].target.slot='battery';f.cards.set('source',f.prep.create({kind:'import',payload:f.raw}))
 const bytes=(await f.exportCard()).bytes;await f.change();const before=await f.service.listPacks()
 await assert.rejects(f.apply(f.service,bytes),/Slot unavailable/ /* private fork: generic registry declaration error */);assert.deepEqual(await f.service.listPacks(),before);assert.equal(f.cards.has('target'),false)
})
test('whole-pack export reports named external defaults, copy preserves external refs and failed copy is atomic',async t=>{
 const f=await fixture(t),out=await f.service.exportPack({packId:PHONE_PACK_ID,expectedRevision:f.phone.revision});assert.deepEqual(out.warnings,[{code:'external-widget-default',ref:f.image,widgetName:'手机',settingLabel:'壁纸',packName:'External paper',assetName:'Paper'}])
 const inspection=await f.service.inspectImport({bytes:out.bytes});assert.equal(inspection.incoming.manifest.assets.some(asset=>asset.kind==='backgrounds'),false)
 const copy=await f.service.copyItems({sourcePackId:PHONE_PACK_ID,itemRefs:[{kind:'widgets',id:'phone'}],target:{newPackName:'Copy'}}),pack=await f.service.getPackSnapshot({packId:copy.packId});assert.deepEqual(pack.manifest.assets[0].settingsDefaults.wallpaper,f.image);assert.equal(pack.manifest.assets.length,1)
 const before=await f.service.listPacks();f.setFault('pack-published');await assert.rejects(f.service.copyItems({sourcePackId:PHONE_PACK_ID,itemRefs:[{kind:'widgets',id:'phone'}],target:{newPackName:'Failed copy'}}));f.setFault(null);assert.deepEqual(await f.service.listPacks(),before)
})
test('image authorizer rejects unbound, disabled, deleted and cross-card refs without rewriting requested settings',async t=>{
 const f=await fixture(t),raw=structuredClone(f.raw);const consumer=createAssetPackPresentation({raw,getService:()=>f.service,origin:'http://localhost',scope:'settings-authority'});t.after(()=>consumer.dispose())
 const read=async()=> (await consumer.widgets({widgets:{}},{sourceRefs:[f.ref],engine:defaultAssetEngineSettings(),isCurrent:()=>true}))[0].definition
 assert.ok((await read()).settingAssets.wallpaper)
 raw.extensions.dsh_tavern.assetBindings.boundPackIds=[PHONE_PACK_ID];consumer.rebind(raw);assert.equal((await read()).settingsFeedback.wallpaper.status,'asset-unavailable')
 raw.extensions.dsh_tavern.assetBindings.boundPackIds.push(f.paper.manifest.id);consumer.rebind(raw);assert.ok((await read()).settingAssets.wallpaper)
 let paper=await f.service.getPackSnapshot({packId:f.paper.manifest.id});paper=(await f.service.patchPack({packId:paper.manifest.id,expectedRevision:paper.revision,patch:{assets:paper.manifest.assets.map(asset=>({...asset,enabled:false}))}})).snapshot;assert.equal((await read()).settingsFeedback.wallpaper.status,'asset-unavailable')
 await f.service.removePack({packId:paper.manifest.id,expectedRevision:paper.revision});assert.equal((await read()).settingAssets.wallpaper,null);assert.deepEqual(f.phone.manifest.assets[0].settingsDefaults.wallpaper,f.image)
 const phone=await f.service.getPackSnapshot({packId:PHONE_PACK_ID}),exported=await f.service.exportPack({packId:PHONE_PACK_ID,expectedRevision:phone.revision});assert.equal(exported.warnings[0].packName,null)
})


test('card bundle admits mod pack scopes, preserves unrelated raw, and rejects retired card settings and switches',()=>{
 const adapter=createCardBundleAdapter({cardPreparation:createCardPreparation()})
 const packId='10000000-0000-4000-8000-000000000001'
 const modBindings={version:1,mods:{'dsh.demo':{boundPackIds:[packId],packSettings:{[packId]:{label:'Card override'}}}}}
 const raw={name:'Mod card',extensions:{untouched:{value:7},dsh_tavern:{modBindings}}}
 const admitted=adapter.inspectRaw(raw)
 assert.deepEqual(admitted.raw.extensions.dsh_tavern.modBindings,modBindings)
 assert.deepEqual(admitted.raw.extensions.untouched,{value:7})
 for(const change of [row=>row.enabled=true,row=>row.settings={},row=>row.bindings={image:{source:'mvu',path:'/image'}}]){
   const invalid=structuredClone(raw);change(invalid.extensions.dsh_tavern.modBindings.mods['dsh.demo'])
   assert.throws(()=>adapter.inspectRaw(invalid),{code:'UNKNOWN_FIELD'})
 }
 const duplicate=structuredClone(raw);duplicate.extensions.dsh_tavern.modBindings.mods['dsh.demo'].boundPackIds.push(packId)
 assert.throws(()=>adapter.inspectRaw(duplicate),{code:'MOD_API_UNSUPPORTED'})
 assert.deepEqual(adapter.inspectRaw({name:'No mods'}).raw.extensions?.dsh_tavern?.modBindings,undefined)
})
