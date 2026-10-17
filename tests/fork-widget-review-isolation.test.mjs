import {tmpdir as publicTmpdir} from 'node:os';
import {join as publicJoin} from 'node:path';
// private fork: retired optional widgets must not poison mixed packs or unrelated imports.
import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,readFile} from 'node:fs/promises'
import {syntheticPack,cardExtension,PACK_ID,FIGURE_ID} from './fixtures/asset-packs/pack.mjs'
import {createPackStorage} from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/storage.js'
import {createAssetPackService} from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/service.js'
import {writeZip} from '../tavern-plugin/packages/dsh-asset-library/src/zip.js'
import {PACK_LIMITS} from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/validation.js'
import {computeBundleHash,computeContentHash,sha256,validatePackManifest} from '../tavern-plugin/packages/dsh-asset-library/src/asset-packs/index.js'
import {createAssetRuntime} from '../tavern-plugin/lib/fork-asset-runtime.js'
import {defaultAssetEngineSettings} from '../tavern-plugin/lib/domain/asset-engine-settings.js'
import {writePhonePack,PHONE_PACK_ID} from './fixtures/source-widget/fork-build-phone-widget.mjs'

for (const format of ['props-schema','html-entry','old-document']) test('installed '+format+' is unavailable only on that item',async t=>{
 const root=await mkdtemp(publicJoin(publicTmpdir(), 'widget-isolation-')),pack=await syntheticPack()
 const asset={...pack.manifest.assets.find(a=>a.kind==='widgets'),id:'retired',name:'Retired optional widget',bundleKey:'retired'}
 const entry=format==='html-entry'?'index.html':'widget.json'
 asset.entry=entry
 if(format==='props-schema')Object.assign(asset,{propsSchema:{type:'object'},caps:{active:1},samples:[]})
 pack.manifest.assets.push(asset)
 pack.files.set('bundles/retired/'+entry,Buffer.from(format==='html-entry'?'<p>Never execute this</p>':JSON.stringify({format:'dsh.widget/1',view:{entry:'index.html'}})))
 const file={path:'bundles/retired/'+entry,size:pack.files.get('bundles/retired/'+entry).length,sha256:await sha256(pack.files.get('bundles/retired/'+entry))}
 pack.manifest.files.push(file)
 pack.manifest.bundles.retired={kind:'widget',entry,contentHash:await computeBundleHash([{...file,path:entry}])}
 pack.manifest.contentHash=await computeContentHash(pack.manifest)
 if(format!=='old-document')assert.throws(()=>validatePackManifest(pack.manifest))
 const original=structuredClone(pack.manifest),storage=createPackStorage({assetRoot:root+'/store',limits:PACK_LIMITS})
 await storage.publish(PACK_ID,pack,{revision:'installed-old',retired:[]})
 const service=createAssetPackService({assetRoot:root+'/store'});t.after(()=>service.dispose())
 const snapshot=await service.getPackSnapshot({packId:PACK_ID})
 assert.equal(snapshot.diagnostics.length,1);assert.equal(snapshot.diagnostics[0].ref.assetId,'retired')
 assert.equal(snapshot.diagnostics[0].name,'Retired optional widget');assert.equal(snapshot.widgets.retired,undefined)
 assert.ok(snapshot.widgets.clock);assert.ok(snapshot.figures[FIGURE_ID]);assert.equal(snapshot.manifest.assets.length,original.assets.length-1)
 assert.deepEqual((await service.listPacks())[0],snapshot)
 const refs=['retired','clock'].map(assetId=>({packId:PACK_ID,kind:'widgets',assetId}))
 const resolved=await service.resolveAssets({refs})
 assert.equal(resolved[0].value,null);assert.ok(resolved[0].diagnostics.length);assert.ok(resolved[1].value)
 const ext=cardExtension();ext.stage={};ext.assetBindings.boundPackIds=[PACK_ID]
 const runtime=createAssetRuntime({ctx:{get:name=>name==='assetLibrary'?service:null,inject(){}},readWorkspace:async()=>({raw:{extensions:{dsh_tavern:ext}}}),engineSettings:{read:()=>({values:defaultAssetEngineSettings(),revision:'r'}),subscribe:()=>()=>{}}})
 t.after(()=>runtime.dispose());const stage=await runtime.snapshot('synthetic')
 assert.ok(stage.snapshots[0].figures[FIGURE_ID]);assert.ok(stage.assetStatus[PACK_ID+'/backgrounds/classroom'].available)
 await writePhonePack(root+'/phone.zip')
 const inspection=await service.inspectImport({bytes:await readFile(root+'/phone.zip')})
 const installed=await service.applyImport({inspectionId:inspection.inspectionId,expectedRevision:null,decision:'install',acceptScriptRisk:true})
 assert.equal(installed.snapshot.manifest.id,PHONE_PACK_ID)
 assert.deepEqual(JSON.parse(await readFile(root+'/store/packs/'+PACK_ID+'/manifest.json','utf8')),original,'read projection must never migrate installed bytes')
 const replacement=await syntheticPack()
 await writeZip(root+'/replacement.zip',[{path:'manifest.json',data:Buffer.from(JSON.stringify(replacement.manifest))},...[...replacement.files].map(([path,data])=>({path,data}))])
 const update=await service.inspectImport({bytes:await readFile(root+'/replacement.zip')})
 assert.ok(update.choices.includes('update'))
 const saved=await service.applyImport({inspectionId:update.inspectionId,expectedRevision:'installed-old',decision:'update',acceptScriptRisk:true})
 assert.equal(saved.snapshot.diagnostics,undefined);assert.ok(saved.snapshot.widgets.clock)
})
