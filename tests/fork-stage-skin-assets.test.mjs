// private fork: inert skins share pack integrity/media leasing; no installed user data.
import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,readFile,mkdir} from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {createRequire} from 'node:module'
import {syntheticPack,PACK_ID,cardExtension} from './fixtures/asset-packs/pack.mjs'
import {createAssetPackService} from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/service.js'
import {sealPack,jsonBytes,verifyBytes} from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/validation.js'
import {writeZip} from '../tavern-plugin/packages/dsh-asset-library/src/zip.js'
import {createAssetPackPresentation} from '../tavern-plugin/lib/domain/asset-pack-presentation.js'
import {initialAssetPackStage} from '../tavern-plugin/lib/domain/stage-asset-pack-tools.js'
const require=createRequire(import.meta.url)
const {validateStageSkin}=require('../tavern-plugin/packages/dsh-presentation-protocol/src/stage-skin.cjs')
const {stageSkinTokens,applyStageSkin,stageSkinReveal}=require('../tavern-plugin/src/client/fork-stage-skin.cjs')
const skin=()=>({schema:'dsh.skin/1',id:'paper',label:'Paper',textbox:{paint:{bg:'#ffffff',fg:'#111111',accent:'#003366',onAccent:'#ffffff'}},nameplate:{shape:'tag',paint:{bg:'#111111',fg:'#ffffff'}},font:{body:'neo-xihei-screen',name:'zhuque'},textFx:{reveal:'pop',stepFps:8}})
const ref={packId:PACK_ID,kind:'skins',assetId:'paper'}
function wav(ms) {
 const rate=8000,size=rate*2*ms/1000,bytes=Buffer.alloc(44+size)
 bytes.write('RIFF');bytes.writeUInt32LE(36+size,4);bytes.write('WAVEfmt ',8);bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);bytes.writeUInt32LE(rate,24);bytes.writeUInt32LE(rate*2,28);bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);bytes.write('data',36);bytes.writeUInt32LE(size,40);return bytes
}
async function packFixture({privateUse=false}={}){
 const pack=await syntheticPack();
 pack.manifest.assets.push({kind:'skins',id:'paper',name:'Paper',recall:{mode:'keyword',keywords:['dream']},directorNote:'Dream.',bundleKey:'paper',entry:'skin.json'})
 pack.manifest.bundles.paper={kind:'skin',entry:'skin.json',contentHash:'0'.repeat(64)}
 pack.files.set('bundles/paper/skin.json',jsonBytes({...skin(),...(privateUse?{license:{privateUse:true}}:{})})); await sealPack(pack.manifest,pack.files); return pack
}
test('the three skins frozen in witch-effects 9692a73e use the same standalone contract',async()=>{
 for(const id of ['oktavia','charlotte','charlotte-ii']) {
  const document=JSON.parse(await readFile(new URL(`./fixtures/stage-skins/${id}.json`,import.meta.url),'utf8'))
  assert.equal(validateStageSkin(document).id,id)
 }
 const legacy=skin();legacy.textStyle={size:24};assert.throws(()=>validateStageSkin(legacy),{code:'INVALID_SKIN'})
 const overlap=skin();overlap.textbox.frame={insets:[24,24,24,24],top:{pattern:'dots',colors:['#111111'],height:22,offset:20}}
 assert.throws(()=>validateStageSkin(overlap),{code:'SKIN_GEOMETRY'})
})
test('skin schema rejects code, opacity, CSS injection, traversal and unsafe contrast',()=>{
 assert.doesNotThrow(()=>validateStageSkin(skin()))
 const cases=[s=>s.code='evil()',s=>s.textbox.paint.bg='url(x)',s=>s.textbox.paint.opacity=0.5,s=>s.sfx={page:'../bad.wav'},s=>s.textbox.paint.fg='#eeeeee',s=>s.textFx.jitter=2,s=>s.font.body='url(file)']
 for(const change of cases){const s=skin();change(s);assert.throws(()=>validateStageSkin(s))}
})
test('skin importer checks closed bundle, identity, media dependencies and executable files',async()=>{
 const p=await packFixture(); assert.equal((await verifyBytes(p.manifest,p.files)).skins.paper.id,'paper')
 p.files.set('bundles/paper/evil.js',Buffer.from('alert(1)'));await sealPack(p.manifest,p.files)
 await assert.rejects(()=>verifyBytes(p.manifest,p.files),/Executable/)
 p.files.delete('bundles/paper/evil.js');p.files.set('bundles/paper/skin.json',jsonBytes({...skin(),sfx:{page:'missing.wav'}}));await sealPack(p.manifest,p.files)
 await assert.rejects(()=>verifyBytes(p.manifest,p.files),/Missing skin resource/)
 p.files.set('bundles/paper/skin.json',jsonBytes({...skin(),sfx:{page:'page.wav'}}));p.files.set('bundles/paper/page.wav',wav(1000));await sealPack(p.manifest,p.files)
 await assert.doesNotReject(()=>verifyBytes(p.manifest,p.files))
 p.files.set('bundles/paper/extra.wav',wav(1000));await sealPack(p.manifest,p.files);await assert.rejects(()=>verifyBytes(p.manifest,p.files),/undeclared/)
 p.files.delete('bundles/paper/extra.wav');p.files.set('bundles/paper/page.wav',wav(4000));await sealPack(p.manifest,p.files);await assert.rejects(()=>verifyBytes(p.manifest,p.files),/three seconds/)
})
test('skin publishes, resolves, serves hashed leases, projects descriptors and degrades when binding is denied',async t=>{
 const tmp=fileURLToPath(new URL('../.tmp/',import.meta.url)); await mkdir(tmp,{recursive:true})
 const root=await mkdtemp(path.join(tmp,'skin-pack-')),pack=await packFixture(),zip=path.join(root,'pack.zip')
 await writeZip(zip,[{path:'manifest.json',data:jsonBytes(pack.manifest)},...[...pack.files].map(([path,data])=>({path,data}))])
 const service=createAssetPackService({assetRoot:path.join(root,'assets'),authorizeLease:async()=>true});t.after(()=>service.dispose())
 const preview=await service.inspectImport({bytes:await readFile(zip)}),installed=await service.applyImport({inspectionId:preview.inspectionId,expectedRevision:null,decision:'install'})
 assert.equal(installed.snapshot.skins.paper.id,'paper');assert.equal((await service.getPackSnapshot({packId:PACK_ID})).skins.paper.id,'paper')
 const lease=await service.leaseBundle({packId:PACK_ID,bundleKey:'paper',origin:'http://localhost',scope:'test'});assert.ok(lease.url);assert.equal(lease.resources.length,1);await service.releaseLease(lease.ticket)
 const consumer=createAssetPackPresentation({raw:{extensions:{dsh_tavern:cardExtension()}},getService:()=>service,origin:'http://localhost',scope:'test'});t.after(()=>consumer.dispose())
 const state={...initialAssetPackStage({}),skin:{ref}},scene=await consumer.scene(state,{descriptors:true})
 assert.deepEqual(scene.skin.document,skin());assert.equal(scene.skin.url.resource,true);assert.equal(scene.skin.url.kind,'bundle');assert.equal(scene.skin.url.hash,pack.manifest.bundles.paper.contentHash)
 assert.equal((await consumer.scene(state,{descriptors:true,skinAllowed:false})).skin.document.id,'classic') // private fork: denied overrides restore the card default
 // Keep the isolated fixture files as evidence; never recursively delete a worktree.
})
test('private-use skin packs cannot leave the public export path',async t=>{
 const tmp=fileURLToPath(new URL('../.tmp/',import.meta.url));await mkdir(tmp,{recursive:true})
 const root=await mkdtemp(path.join(tmp,'private-skin-')),pack=await packFixture({privateUse:true}),zip=path.join(root,'private.zip')
 await writeZip(zip,[{path:'manifest.json',data:jsonBytes(pack.manifest)},...[...pack.files].map(([path,data])=>({path,data}))])
 const service=createAssetPackService({assetRoot:path.join(root,'assets')});t.after(()=>service.dispose())
 const preview=await service.inspectImport({bytes:await readFile(zip)}),installed=await service.applyImport({inspectionId:preview.inspectionId,expectedRevision:null,decision:'install'})
 await assert.rejects(()=>service.exportPack({packId:PACK_ID,expectedRevision:installed.snapshot.revision}),{code:'PRIVATE_ASSET_NOT_EXPORTABLE'})
})
test('skin apply restores exact prior properties and never writes font preferences or size',()=>{
 const properties=new Map([['--gal-skin-bg',['#222222','important']]]),attrs=new Map()
 const root={style:{getPropertyValue:k=>properties.get(k)?.[0]||'',getPropertyPriority:k=>properties.get(k)?.[1]||'',setProperty:(k,v,p='')=>properties.set(k,[v,p]),removeProperty:k=>properties.delete(k)},getAttribute:k=>attrs.get(k)??null,setAttribute:(k,v)=>attrs.set(k,v),removeAttribute:k=>attrs.delete(k)}
 const calls=[],fonts={resolve:(role,context)=>{calls.push({role,context});return {family:context.skin.body}}}
 const restore=applyStageSkin(root,skin(),fonts,'classic')
 // private fork (docs/fork/fonts.md): an ordinary skin's fonts follow the user's override; only the decorative title
 // face (and director-applied performance skins, `lead`) resolve skin-first.
 assert.equal(attrs.get('data-fk-skin'),'paper');assert.equal(properties.get('--gal-skin-bg')[0],'#ffffff')
 assert.deepEqual(calls.filter(c=>c.context.skinWins).map(c=>c.context.part),['title'])
 assert.ok(calls.every(c=>c.role==='stage' && c.context.skin.body===skin().font.body))
 calls.length=0;applyStageSkin(root,skin(),fonts,'classic',true)();assert.ok(calls.every(c=>c.context.skinWins),'a performance skin leads')
 assert.ok(Object.keys(stageSkinTokens(skin(),fonts)).every(k=>!k.includes('size')))
 restore();assert.deepEqual(properties,new Map([['--gal-skin-bg',['#222222','important']]]));assert.equal(attrs.size,0)
 assert.equal(stageSkinReveal(skin(),28,{reducedMotion:true}).kind,'type')
 assert.equal(stageSkinReveal({...skin(),photosensitive:true},28).kind,'type')
})

// private fork: default skins never enter recorded stage state, and skin.off restores the card skin.
test('card default is projected without a director and survives temporary override/off without mutating history',async t=>{
 const tmp=fileURLToPath(new URL('../.tmp/',import.meta.url));await mkdir(tmp,{recursive:true})
 const root=await mkdtemp(path.join(tmp,'default-skin-')),pack=await packFixture(),zip=path.join(root,'pack.zip')
 await writeZip(zip,[{path:'manifest.json',data:jsonBytes(pack.manifest)},...[...pack.files].map(([path,data])=>({path,data}))])
 const service=createAssetPackService({assetRoot:path.join(root,'assets'),authorizeLease:async()=>true});t.after(()=>service.dispose())
 const preview=await service.inspectImport({bytes:await readFile(zip)});await service.applyImport({inspectionId:preview.inspectionId,expectedRevision:null,decision:'install'})
 const ext=cardExtension();ext.stage={...ext.stage,defaultSkin:ref}
 const consumer=createAssetPackPresentation({raw:{extensions:{dsh_tavern:ext}},getService:()=>service,origin:'http://localhost',scope:'test'});t.after(()=>consumer.dispose())
 const state=initialAssetPackStage({}),before=JSON.stringify(state)
 assert.equal((await consumer.scene(state,{descriptors:true})).skin.document.id,'paper')
 assert.equal(JSON.stringify(state),before)
 ext.stage.defaultSkin='magical';consumer.rebind({extensions:{dsh_tavern:ext}})
 assert.equal((await consumer.scene({...state,skin:{ref}},{descriptors:true})).skin.document.id,'paper')
 assert.equal((await consumer.scene({...state,skin:{ref:null}},{descriptors:true})).skin.document.id,'magical')
 assert.equal(JSON.stringify(state),before)
})
