import {fixtureCli} from './helpers/generated-image-fixture.mjs'
const runCli=fixtureCli(generationFixtureRunCli)
// private fork: legacy projects carry explicit declaration fixtures.
import {declaredProduction,legacyFixtureCli,legacyFixtureInit} from './helpers/legacy-production-fixture.mjs'
const initProject=(root,input,...args)=>legacyFixtureInit(rawInitProject,root,input,...args)
import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,writeFile,readFile,rm,cp,access} from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import {runCli as generationFixtureRunCli,VERSION,errorEnvelope} from '../bin/dsh-assets.mjs'
import {initProject as rawInitProject,loadProject,compileProduction,reviewProduction,contentFingerprint} from '../tavern-plugin/lib/domain/asset-production-project.js'
import {encodeAssetRgba} from '../tavern-plugin/lib/domain/asset-image-processing.js'
import {hybridRuntimeClosure} from '../tavern-plugin/packages/dsh-asset-library/lib/asset-packs/hybrid-closure.js'
import {layeredExport} from '../tavern-plugin/packages/dsh-asset-library/lib/pack-v2/layered-export.js'
import {createAssetPackService} from '../tavern-plugin/packages/dsh-asset-library/lib/pack-v2/service.js'
import {writeNativePack} from '../tavern-plugin/packages/dsh-asset-library/lib/pack-v2/pack-source.js'
const groups=['underlay','pose','face','mouth','front']
const manifest=()=>({kind:'hybrid-face-sprites',version:1,rigs:{maid:{canvas:[8,8],baseRevision:1,drawOrder:groups,parts:{},recipes:{calm:{revision:1,selection:{underlay:'base',pose:'none',face:'face',mouth:'none',front:'none'}}}}},emotions:{calm:{render:{kind:'parts',rig:'maid',recipe:'calm'}}}})
async function fixture(t) {
  const root=await mkdtemp(path.join(os.tmpdir(),'cli130-'));t.after(()=>rm(root,{recursive:true,force:true}))
  await initProject(root,{characters:[{key:'fish',outfits:[{key:'maid',emotions:['calm'],eyesClosed:['calm']},{key:'basin',emotions:['calm']}]}]})
  const json=async(name,v)=>{const f=path.join(root,name+'.json');await writeFile(f,JSON.stringify(v));return f}
  const file=path.join(root,'source.png');await writeFile(file,encodeAssetRgba({width:8,height:8,data:new Uint8ClampedArray(Array.from({length:64},()=>[80,120,160,255]).flat())}))
  const cli=(command,...args)=>runCli([command,'--project',root,...args])
  const scope=['--outfit','fish/maid','--rig','maid']
  const base=await cli('register-base',...scope,'--part','base','--file',file,'--manifest',await json('manifest',manifest()),'--expected-version','0')
  return {root,json,file,cli,scope,base}
}
test('1.3 authoring CAS, missing, preview, per-eye-compatible review, minimal pack and native export',async t=>{
  assert.match(VERSION,/^1\.3\.\d+$/)
  const {root,json,file,cli,scope,base}=await fixture(t)
  assert.equal(base.version,1);assert.equal(base.missing.slots[0].id,'face')
  assert.equal((await cli('missing','--kind','part')).total,1)
  const original=await readFile(path.join(root,'project.json'))
  const spec=await json('face',{group:'face',rect:[0,0,8,8]})
  await cli('register-part',...scope,'--part','face','--file',file,'--spec',spec,'--expected-version','1','--dry-run')
  assert.deepEqual(await readFile(path.join(root,'project.json')),original)
  await assert.rejects(cli('register-part',...scope,'--part','face','--file',file,'--spec',spec,'--expected-version','0'),{code:'CONFLICT'})
  await cli('register-part',...scope,'--part','face','--file',file,'--spec',spec,'--expected-version','1')
  const before=await loadProject(root),fingerprint=contentFingerprint(before)
  await cli('register-part',...scope,'--part','draft-steam','--file',file,'--spec',await json('steam',{group:'front',rect:[0,0,8,8]}),'--expected-version','2')
  assert.notEqual(contentFingerprint(await loadProject(root)),fingerprint)
  assert.equal((await cli('missing','--kind','part')).total,0)
  const preview=await cli('compose-preview','--outfit','fish/maid','--emotion','calm');await access(path.join(root,preview.output));assert.equal(preview.installReady,false)
  const reviewed=await reviewProduction(root);assert.ok(reviewed.hash)
  const review=JSON.parse(await readFile(path.join(root,'review-data.json')))
  assert.equal(review.characters[0].outfits[0].states[0].sprite.image.path,'previews/fish/maid/calm.png')
  const pack=await compileProduction(root),key='fish-maid',sprite=pack.sprites[key]
  assert.deepEqual(Object.keys(sprite.rigs.maid.parts).sort(),['base','face'])
  assert.equal(sprite.emotions.calm.render.preview,'baked-rest/calm.png')
  assert.equal(typeof sprite.emotions.calm.render.previewRevision,'string')
  assert.equal(pack.figures[pack.manifest.figures[0]].outfits.length,2)
  assert.equal([...pack.files.keys()].some(f=>f.includes('preview')||f.includes('draft')),false)
  const zip=path.join(root,'pack.zip');await writeNativePack(pack,zip)
  const service=createAssetPackService({assetRoot:path.join(root,'library')});t.after(()=>service.dispose())
  const inspected=await service.inspectImport({bytes:await readFile(zip)})
  assert.ok(inspected.choices.includes('install'))
  let installed=(await service.applyImport({inspectionId:inspected.inspectionId,expectedRevision:null,decision:'install'})).snapshot
  const figureId=pack.manifest.figures[0],serviceScope={packId:pack.manifest.id,figureId,outfitKey:'maid'}
  const part={...sprite.rigs.maid.parts.face,group:'front',src:'draft.png'}
  installed=(await service.registerLayeredPart({...serviceScope,expectedRevision:installed.revision,rigId:'maid',partId:'draft',part,bytes:await readFile(file)})).snapshot
  assert.ok(installed.sprites[key].rigs.maid.parts.draft)
  assert.equal(installed.sprites[key].emotions.calm.render.preview,undefined)
  const exported=await service.exportPack({packId:serviceScope.packId,expectedRevision:installed.revision}),reimport=await service.inspectImport({bytes:exported.bytes})
  assert.equal(reimport.incoming.sprites[key].rigs.maid.parts.draft,undefined)
  assert.ok((await service.getPackSnapshot({packId:serviceScope.packId})).sprites[key].rigs.maid.parts.draft)
  await cli('remove',...scope,'--part','base','--expected-version','3','--out','deltas/remove-base.json')
  assert.equal((await loadProject(root)).review,undefined)
  assert.equal((await cli('missing','--kind','base')).total,1)
  await assert.rejects(cli('compose-preview','--outfit','fish/maid','--emotion','calm'),{code:'MISSING_DEPENDENCY'})
  await cli('register-base',...scope,'--part','base','--file',file,'--expected-version','4')
  assert.equal((await cli('missing','--kind','part')).slots[0].code,'STALE_PART')
})
test('layered deletion deltas merge only one outfit and stale CAS never replaces another fill',async t=>{
  const {root,json,file,cli,scope}=await fixture(t)
  await cli('register-part',...scope,'--part','face','--file',file,'--spec',await json('face',{group:'face',rect:[0,0,8,8]}),'--expected-version','1')
  const receiver=root+'-receiver';await cp(root,receiver,{recursive:true});t.after(()=>rm(receiver,{recursive:true,force:true}))
  await cli('remove',...scope,'--part','face','--expected-version','2','--out','deltas/remove.json')
  const delta=path.join(root,'deltas/remove.json'),merge=(...extra)=>runCli(['merge','--project',receiver,'--file',delta,'--source-root',root,...extra])
  const before=await readFile(path.join(receiver,'project.json'));await merge('--dry-run');assert.deepEqual(await readFile(path.join(receiver,'project.json')),before)
  await merge();assert.equal((await merge()).idempotent,true)
  assert.equal((await loadProject(receiver)).characters[0].outfits[1].key,'basin')
  const changed=JSON.parse(await readFile(delta));changed.value.version++;await writeFile(delta,JSON.stringify(changed))
  await assert.rejects(merge(),{code:'CONFLICT'})
})
test('strict flags/spec, whole pack unchanged by runtime projection, missing closure references retained',async t=>{
  const {root,json,file,cli,scope}=await fixture(t)
  await assert.rejects(cli('register-part',...scope,'--part','face','--file',file,'--spec',await json('bad',{group:'face',rect:[0,0,8,8],surprise:1}),'--expected-version','1'),error=>{assert.equal(error.code,'UNKNOWN_FIELD');assert.equal(errorEnvelope(error).exit,2);return true})
  await assert.rejects(cli('compose-preview','--outfit','fish/maid','--emotion','calm','--auto-approve'),{code:'INVALID_ARGUMENT'})
  const missing=hybridRuntimeClosure(manifest());assert.equal(missing.rigs.maid.recipes.calm.selection.face,'face')
  const p={sprites:{old:{kind:'static-sprites',version:1,emotions:{calm:{src:'a.png'}}}}};assert.equal(await layeredExport(p),p)
  const first=await loadProject(root);assert.equal(first.layered['fish/maid'].version,1)
})

test('derived stale/missing animations clear without removing source parts or attempt history',async t=>{
  const {root,cli}=await fixture(t),p=await loadProject(root),source='fish/maid/sprite/calm'
  const id='fish/maid/mouth/calm/mid',blink='fish/maid/blink/calm'
  const binding={slot:source,version:1,hash:'a'.repeat(64)}
  p.slots[id]={id,character:'fish',outfit:'maid',kind:'mouth',emotion:'calm',frame:'mid',version:1,stale:true,sourceBinding:binding}
  p.slots[blink]={id:blink,character:'fish',outfit:'maid',kind:'blink',emotion:'calm',version:1,sourceBinding:binding}
  p.plans.failed={id:'failed',slot:id,status:'invalid',error:'visual failure'}
  p.generationLog=[{slot:id,status:'refused',message:'budget spent'}]
  const history=structuredClone(p.plans),log=structuredClone(p.generationLog),layered=JSON.stringify(p.layered),sourceSlot=JSON.stringify(p.slots[source])
  const media=await Promise.all(Object.values(p.layered['fish/maid'].assets).map(async a=>[a.path,await readFile(path.join(root,a.path))]))
  await writeFile(path.join(root,'project.json'),JSON.stringify(p))
  const before=await readFile(path.join(root,'project.json'))
  const dry=await cli('remove','--slot',id,'--dry-run');assert.equal(dry.updates[0].value.stale,undefined)
  assert.deepEqual(await readFile(path.join(root,'project.json')),before)
  await assert.rejects(cli('remove','--slot',source,'--dry-run'),{code:'PRECONDITION'})
  await cli('remove','--slot',id);await cli('remove','--slot',blink)
  const after=await loadProject(root)
  for(const slot of [id,blink]){assert.equal(after.slots[slot].artifact,undefined);assert.equal(after.slots[slot].stale,undefined);assert.equal(after.slots[slot].version,2);assert.deepEqual(after.slots[slot].sourceBinding,binding)}
  assert.equal(JSON.stringify(after.layered),layered);assert.equal(JSON.stringify(after.slots[source]),sourceSlot)
  assert.deepEqual(after.plans,history);assert.deepEqual(after.generationLog,log)
  for(const [file,bytes]of media)assert.deepEqual(await readFile(path.join(root,file)),bytes)
  await assert.rejects(cli('remove','--slot',source),{code:'PRECONDITION'})
})
