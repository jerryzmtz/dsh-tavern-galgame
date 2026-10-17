import {fixtureImport,fixtureReceipt} from './helpers/generated-image-fixture.mjs'
const importImage=fixtureImport(generationFixtureImport)
// private fork: legacy projects carry explicit declaration fixtures.
import {declaredProduction,legacyFixtureCli,legacyFixtureInit} from './helpers/legacy-production-fixture.mjs'
const initProject=(root,input,...args)=>legacyFixtureInit(rawInitProject,root,input,...args)
// private fork: portable 1.2 contract, synthetic inputs only.
import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,readFile,writeFile,cp,rm,mkdir} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {initProject as rawInitProject,importImage as generationFixtureImport,loadProject,registerProduction,projectStatus} from '../tavern-plugin/lib/domain/asset-production-project.js'
import {migrateProject,mergeProject} from '../tools/dsh-assets/project-ops.mjs'
import {removeProduction} from '../tools/dsh-assets/remove.mjs'
import {missingImages} from '../tools/dsh-assets/missing.mjs'
import {normalizeAvatar,extractEyeRegion,measureMouthOpening} from '../tavern-plugin/lib/domain/asset-production-quality.js'
import {encodeAssetRgba,decodeAssetRgba} from '../tavern-plugin/lib/domain/asset-image-processing.js'
import {syntheticImage} from '../tools/dsh-assets/dry-run.mjs'
const temp=()=>mkdtemp(path.join(os.tmpdir(),'asset120-'))

test('CG migration clears three named outfits and exclusions without hiding ordinary completed sprites',async t=>{
  const root=await temp();t.after(()=>rm(root,{recursive:true,force:true}))
  const outfits=['daily','miku-game-ssr1','rika-game-ssr1','cg-ranko-game-07','old-excluded']
  await initProject(root,{characters:[{key:'hero',outfits:outfits.map(key=>({key,emotions:['calm','joy'],eyesClosed:['joy']}))}]})
  const image=path.join(root,'input.png');await writeFile(image,syntheticImage())
  for(const outfit of outfits)for(const emotion of ['calm','joy'])await importImage(root,{slot:`hero/${outfit}/sprite/${emotion}`,file:image})
  await registerProduction(root,{slot:'hero/daily/sprite/calm'})
  const bytes=await readFile(path.join(root,(await loadProject(root)).slots['hero/daily/sprite/calm'].artifact.path))
  assert.deepEqual(bytes,syntheticImage())
  const p=await loadProject(root);p.characters[0].outfits.at(-1).status='excluded';p.slots['hero/old-excluded/sprite/calm'].note='discard';await writeFile(path.join(root,'project.json'),JSON.stringify(p))
  await migrateProject(root);const migrated=await loadProject(root)
  for(const slot of Object.values(migrated.slots))if(slot.outfit!=='daily'){assert.equal(slot.artifact,undefined);assert.equal(slot.raw,undefined);assert.equal(slot.note,undefined);assert.notEqual(slot.status,'excluded')}
  const inventory=await missingImages(root,{kind:'sprite'});assert.equal(inventory.total,8);assert.ok(inventory.slots.every(s=>s.outfit!=='daily'&&!('note' in s)))
  assert.equal((await migrateProject(root)).idempotent,true)
  assert.ok(!(await projectStatus(root)).nextActions.some(s=>s.slot==='hero/daily/avatar/joy'))
})

test('remove emits expected_version delta, merges deletion and rejects stale CAS; bytes are collected',async t=>{
  const root=await temp();t.after(()=>rm(root,{recursive:true,force:true}))
  const a=path.join(root,'a'),b=path.join(root,'b');await initProject(a,{characters:[{key:'hero',outfits:[{key:'daily',emotions:['calm']}]}]})
  const file=path.join(root,'input.png');await writeFile(file,syntheticImage());const slot='hero/daily/sprite/calm'
  await importImage(a,{slot,file});await cp(a,b,{recursive:true});const before=await loadProject(a),image=before.slots[slot].artifact.path
  const result=await removeProduction(a,{slot});assert.equal(result.updates[0].expected_version,1);assert.equal(result.updates[0].operation,'remove');assert.equal((await loadProject(a)).slots[slot].artifact,undefined)
  await assert.rejects(readFile(path.join(a,image)),{code:'ENOENT'})
  await mergeProject(b,{file:path.join(a,result.output),sourceRoot:a});assert.equal((await loadProject(b)).slots[slot].artifact,undefined);await assert.rejects(readFile(path.join(b,image)),{code:'ENOENT'})
  assert.equal((await mergeProject(b,{file:path.join(a,result.output),sourceRoot:a})).idempotent,true)
  await importImage(b,{slot,file});await assert.rejects(mergeProject(b,{file:path.join(a,result.output),sourceRoot:a}),{code:'CONFLICT'})
})

test('avatar scales once, measured head margins flag redo; blink ROI rejects hair/torso and absent changes',()=>{
  const image=decodeAssetRgba(syntheticImage(1254,1254)),data=image.data
  data.fill(0);for(let y=102;y<1254;y++)for(let x=200;x<1050;x++)data.set([140,120,100,255],(y*1254+x)*4)
  const bytes=encodeAssetRgba(image),g={headRect:[350,130,500,878]},result=normalizeAvatar(bytes,'1024x1024',g)
  assert.equal(result.resizeCount,1);assert.equal(decodeAssetRgba(result.bytes).width,1024);assert.equal(result.redo,false);assert.ok(result.warnings.some(w=>w.code==='AVATAR_SIZE_MISMATCH'))
  const second=normalizeAvatar(result.bytes,'1024x1024',{headRect:g.headRect.map(n=>n*1024/1254)});assert.equal(second.resizeCount,0);assert.deepEqual(second.bytes,result.bytes)
  assert.equal(normalizeAvatar(bytes,'1024x1024',{headRect:[350,0,500,650]}).redo,true)
  const base=syntheticImage(),edit=syntheticImage(128,192,{blink:true}),geometry={headRect:[32,12,64,80],eyeRect:[38,34,52,16],browBottom:34,hairBottom:34}
  assert.ok(extractEyeRegion(base,edit,geometry).rect[1]>=34)
  assert.throws(()=>extractEyeRegion(base,edit,{...geometry,eyeRect:[32,12,64,80]}),{code:'PRECONDITION'})
  assert.throws(()=>extractEyeRegion(base,base,geometry),{code:'PRECONDITION'})
  assert.throws(()=>extractEyeRegion(base,edit),{code:'PRECONDITION'})
})

test('mouth opening measurement follows the actual cavity rather than candidate label',()=>{
  const candidate=opening=>{const data=new Uint8ClampedArray(32*24*4);for(let y=0;y<24;y++)for(let x=0;x<32;x++)data.set([180,130,120,255],(y*32+x)*4);for(let y=8;y<8+opening;y++)for(let x=8;x<24;x++)data.set([20,10,10,255],(y*32+x)*4);return encodeAssetRgba({width:32,height:24,data})}
  assert.deepEqual([1,3,9,6].map(n=>measureMouthOpening(candidate(n)).opening),[1,3,9,6])
})

test('library reports Live2D expressions and character-wide custom emotions, never writes',async t=>{
  const root=await temp();t.after(()=>rm(root,{recursive:true,force:true}));const base=path.join(root,'packs','pack')
  await mkdir(path.join(base,'figures'),{recursive:true});await mkdir(path.join(base,'sprites'));await mkdir(path.join(base,'media'))
  const put=(file,obj)=>writeFile(path.join(base,file),JSON.stringify(obj))
  await put('manifest.json',{id:'pack',name:'fixture',figures:['live','static'],sprites:{daily:'sprites/daily.json'},blobs:{image:{ext:'png'}}})
  await put('figures/live.json',{id:'live',name:'Live',appearance:'live2d',emotions:[{id:'e-smile',label:'喜悦'}],outfits:[{key:'daily',live2d:{}}]})
  await put('figures/static.json',{id:'static',name:'Different Name',appearance:'sprite',emotions:[{id:'singing',label:'sing'}],outfits:[{key:'daily',sprite:{manifestKey:'daily',assets:{'own.png':'image'}}},{key:'other'}]})
  await put('sprites/daily.json',{emotions:{calm:{stage:{src:'own.png'},portrait:{src:'own.png'}},singing:{stage:{src:'own.png'}}}});await writeFile(path.join(base,'media/image.png'),syntheticImage())
  const before=await readFile(path.join(base,'manifest.json')),result=await missingImages(null,{library:root})
  assert.ok(result.slots.some(s=>s.figureId==='live'&&s.kind==='live2d'));assert.ok(result.slots.some(s=>s.outfit==='other'&&s.emotion==='singing'&&s.kind==='avatar'))
  assert.ok(!result.slots.some(s=>s.outfit==='daily'&&s.emotion==='calm'&&['avatar','sprite'].includes(s.kind)))
  assert.deepEqual(await readFile(path.join(base,'manifest.json')),before)
})

test('mouth relabel keeps exact pixels and source records',async t=>{
  const root=await temp();t.after(()=>rm(root,{recursive:true,force:true}))
  const {orderMouthFrames,hash}=await import('../tavern-plugin/lib/domain/asset-production-project.js')
  const p={slots:{}},frames=['closed','small','mid','open'],bytes=[]
  for(const [i,opening] of [1,3,9,6].entries()) {
    const data=new Uint8ClampedArray(32*24*4);for(let y=0;y<24;y++)for(let x=0;x<32;x++)data.set([180,130,120,255],(y*32+x)*4)
    for(let y=8;y<8+opening;y++)for(let x=8;x<24;x++)data.set([20,10,10,255],(y*32+x)*4)
    const image=encodeAssetRgba({width:32,height:24,data}),file=i+'.png';bytes.push(image);await writeFile(path.join(root,file),image)
    const id='hero/daily/mouth/calm/'+frames[i];p.slots[id]={id,kind:'mouth',character:'hero',outfit:'daily',emotion:'calm',frame:frames[i],version:1,artifact:{path:file,hash:hash(image)},provenance:{source:'candidate-'+frames[i]}}
  }
  const warnings=await orderMouthFrames(p,root,p.slots['hero/daily/mouth/calm/open'])
  assert.equal(warnings[0].code,'MOUTH_RELABELLED')
  const reordered=frames.map(frame=>p.slots['hero/daily/mouth/calm/'+frame])
  assert.deepEqual(reordered.map(s=>s.artifact.opening.opening),[1,3,6,9])
  assert.equal(reordered[3].provenance.source,'candidate-mid');assert.equal(reordered[3].provenance.source_slot,'hero/daily/mouth/calm/mid')
  assert.deepEqual(await readFile(path.join(root,reordered[3].artifact.path)),bytes[2])
})

test('settei larger than 6 MiB packs and installs unchanged; stage media still rejects it',async t=>{
  const root=await temp();t.after(()=>rm(root,{recursive:true,force:true}))
  const {dryRun}=await import('../tools/dsh-assets/dry-run.mjs')
  const {transaction,hash,packProduction,reviewProduction,acceptProduction}=await import('../tavern-plugin/lib/domain/asset-production-project.js')
  const {installProduction}=await import('../tools/dsh-assets/install.mjs')
  const {inspectMedia}=await import('../tavern-plugin/packages/dsh-asset-library/lib/pack-v2/validation.js')
  const project=path.join(root,'project');await dryRun(project)
  const data=new Uint8ClampedArray(1536*1536*4);let seed=123456789
  for(let i=0;i<data.length;i++){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;data[i]=seed&255}
  const bytes=encodeAssetRgba({width:1536,height:1536,data}),digest=hash(bytes),file='images/'+digest+'.png'
  assert.ok(bytes.length>6*1024**2);await writeFile(path.join(project,file),bytes)
  const generation=await fixtureReceipt(path.join(project,file))
  await transaction(project,p=>{const s=p.slots['fixture/daily/settei'];s.raw=s.artifact={path:file,hash:digest,width:1536,height:1536,warnings:[],generation};s.accepted=digest;for(const slot of Object.values(p.slots))slot.inputs=[]})
  await packProduction(project);const review=await reviewProduction(project);await acceptProduction(project,{review:review.hash,reviewer:'synthetic test'});await packProduction(project)
  const library=path.join(root,'installed');await installProduction(project,{library,expectedRevision:'null',confirm:true})
  assert.deepEqual(await readFile(path.join(project,file)),bytes)
  const id=(await loadProject(project)).id;assert.deepEqual(await readFile(path.join(library,'packs',id,'media',digest+'.png')),bytes)
  await assert.rejects(inspectMedia(bytes,{ext:'png',mime:'image/png',size:bytes.length}),{code:'LIMIT_EXCEEDED'})
})

test('wait metadata stays outside slots and user labels say 差分',async t=>{
 const root=await temp();t.after(()=>rm(root,{recursive:true,force:true}));await initProject(root,{name:'waiting',characters:[{key:'hero',name:'Hero',outfits:[{key:'daily',label:'Daily',emotions:['calm']}]}]})
 const {recordWaiting}=await import('../tools/dsh-assets/project-ops.mjs');const slot='hero/daily/sprite/calm'
 await recordWaiting(root,{slot,on:'owner',note:'measurement needed'});let p=await loadProject(root)
 assert.equal(p.workflowWaits[slot].reason,'measurement needed');assert.equal(p.slots[slot].waiting,undefined)
 await recordWaiting(root,{slot,clear:true});p=await loadProject(root);assert.equal(p.workflowWaits[slot],undefined)
 const {help}=await import('../bin/dsh-assets.mjs');assert.ok(help().includes('差分'));assert.ok(!help().includes('情绪'))
 const html=await readFile(new URL('../viewer/template.html',import.meta.url),'utf8');assert.ok(html.includes('等同差分立绘'));assert.ok(!html.includes('情绪'))
})
