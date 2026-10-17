import {fixtureCli,fixtureImport} from './helpers/generated-image-fixture.mjs'
const runCli=fixtureCli(generationFixtureRunCli)
const importImage=fixtureImport(generationFixtureImport)
import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import os from 'node:os'
import {randomUUID} from 'node:crypto'
import {mkdtemp,rm,readFile,writeFile,cp} from 'node:fs/promises'
import {runCli as generationFixtureRunCli} from '../bin/dsh-assets.mjs'
import {dryRun,syntheticImage} from '../tools/dsh-assets/dry-run.mjs'
import {readNativeSnapshot} from '../tools/dsh-assets/baseline.mjs'
import {compileSetteiDelivery} from '../tools/dsh-assets/settei-install.mjs'
import {loadProject,preparePrompt,importImage as generationFixtureImport,acceptProduction,reviewProduction,hash,slotAccepted,productionProgress,prerequisites} from '../tavern-plugin/lib/domain/asset-production-project.js'
import {createAssetPackService} from '../tavern-plugin/packages/dsh-asset-library/lib/pack-v2/service.js'

import {verifyBytes,sealPack} from '../tavern-plugin/packages/dsh-asset-library/lib/pack-v2/validation.js'
import {trimAuthoringImages} from '../tavern-plugin/packages/dsh-asset-library/lib/pack-v2/image-closure.js'

// All candidates and approvals are synthetic fixtures; no live data or owner decisions.
test('settei batches preserve 18 old figures, install exactly 7 of 23 additions, and reject rollback',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'settei-safety-'));t.after(()=>rm(root,{recursive:true,force:true}))
  const original=path.join(root,'original'),proof=await dryRun(original),library=path.join(original,'verification-library'),project=path.join(root,'source'),packId=proof.installed.id
  const service=createAssetPackService({assetRoot:library});t.after(()=>service.dispose())
  let native=await readNativeSnapshot(library,packId),seed=Object.values(native.figures)[0]
  for(let i=1;i<18;i++) {
    const result=await service.createFigure({packId,expectedRevision:native.revision,id:randomUUID(),figure:{...structuredClone(seed),name:'Original '+i,outfits:[]}})
    native=result.snapshot
  }
  await runCli(['baseline','--library',library,'--pack',packId,'--scope','settei','--project',project])
  const baseline=await readNativeSnapshot(library,packId,{media:true}),baselineProject=await loadProject(project)
  // Populate old source candidates with the exact baseline boards using the real authoring APIs.
  for(const c of baselineProject.characters) {
    const slot=c.key+'/identity-settei',source=baselineProject.baseline.sources.find(s=>s.slot===slot),plan=await preparePrompt(project,{slot})
    await importImage(project,{plan:plan.id,file:path.join(project,source.path)})
    await acceptProduction(project,{slot,reviewer:'synthetic fixture'})
  }
  const oldOnly=path.join(root,'old-only');await cp(project,oldOnly,{recursive:true})
  const input=path.join(root,'additions.json')
  await writeFile(input,JSON.stringify({characters:Array.from({length:23},(_,i)=>({key:'addition-'+i,name:'New figure '+i}))}))
  const added=await runCli(['add-figures','--project',project,'--input',input,'--expected-revision',String((await loadProject(project)).revision)])
  const image=path.join(root,'new.png');await writeFile(image,syntheticImage(193,128,{opaque:true}))
  // The other sixteen include an imported but unaccepted candidate: scope must isolate it too.
  for(const [i,row]of added.added.entries()) {
    if(i>7)break
    const plan=await preparePrompt(project,{slot:row.slot});await importImage(project,{plan:plan.id,file:image})
    if(i<7)await acceptProduction(project,{slot:row.slot,reviewer:'synthetic fixture'})
  }
  const projectBytes=await readFile(path.join(project,'project.json'))
  const newer=await service.patchFigure({packId,figureId:seed.id,expectedRevision:baseline.revision,patch:{name:'Local UI name'}})
  const before=await readNativeSnapshot(library,packId,{media:true})
  assert.notEqual(newer.snapshot.revision,baseline.revision)
  for(const id of baseline.manifest.figures)assert.deepEqual(before.figures[id].identitySettei,baseline.figures[id].identitySettei)
  const ids=added.added.slice(0,7).map(row=>row.id),figures=ids.join(',')
  await t.test('approved additions install across an old-figure identity change since baseline',async()=>{
    const changedLibrary=path.join(root,'old-figure-changed-library');await cp(library,changedLibrary,{recursive:true})
    const changedService=createAssetPackService({assetRoot:changedLibrary})
    try {
      const identity={...seed.identitySettei,palette:[{role:'local',hex:'#ABCDEF',zone:'hair'}],version:'b'.repeat(64)}
      const edited=await changedService.patchFigure({packId,figureId:seed.id,expectedRevision:before.revision,patch:{identitySettei:identity}})
      const localBefore=await readNativeSnapshot(changedLibrary,packId,{media:true})
      assert.notEqual(edited.snapshot.revision,baseline.revision)
      assert.notDeepEqual(localBefore.figures[seed.id].identitySettei,baseline.figures[seed.id].identitySettei)
      assert.deepEqual(localBefore.manifest.figures,baseline.manifest.figures)
      const scoped=['--project',project,'--library',changedLibrary,'--expected-revision',localBefore.revision,'--figures',figures]
      assert.deepEqual((await runCli(['pack',...scoped])).changedFigures,ids)
      assert.equal((await runCli(['install',...scoped,'--confirm'])).status,'updated')
      const localAfter=await readNativeSnapshot(changedLibrary,packId,{media:true})
      assert.equal(localAfter.manifest.figures.length,25)
      for(const [file,bytes]of localBefore.files)assert.deepEqual(localAfter.files.get(file),bytes,file)
      for(const id of ids)assert.equal(localAfter.figures[id].id,id)
      for(const row of added.added.slice(7))assert.equal(localAfter.figures[row.id],undefined)
      assert.deepEqual(await readFile(path.join(project,'project.json')),projectBytes)
    }finally{await changedService.dispose()}
  })
  const args=command=>[command,'--project',project,'--library',library,'--expected-revision',before.revision,'--figures',figures]
  const exported=await runCli(args('pack'));assert.deepEqual(exported.changedFigures,ids);assert.equal(exported.installReady,true)
  const preview=await runCli([...args('install'),'--dry-run']);assert.deepEqual(preview.changedFigures,ids)
  assert.equal((await readNativeSnapshot(library,packId)).revision,before.revision)
  await assert.rejects(runCli([...args('install').map(v=>v===before.revision?baseline.revision:v),'--confirm']),{code:'CONFLICT'})
  const installed=await runCli([...args('install'),'--confirm']),after=await readNativeSnapshot(library,packId,{media:true})
  assert.equal(installed.status,'updated');assert.equal(after.manifest.figures.length,25)
  for(const [file,bytes]of before.files)assert.deepEqual(after.files.get(file),bytes,file)
  for(const id of ids)assert.equal(after.figures[id].id,id)
  for(const row of added.added.slice(7))assert.equal(after.figures[row.id],undefined)
  assert.deepEqual(await readFile(path.join(project,'project.json')),projectBytes)
  const rerun=[...args('install').map(v=>v===before.revision?after.revision:v),'--confirm']
  assert.equal((await runCli(rerun.map(v=>v===figures?ids.map(id=>'f-'+id).reverse().join(','):v))).status,'noop')
  assert.equal((await readNativeSnapshot(library,packId)).revision,after.revision)
  await assert.rejects(runCli(rerun.map(v=>v===figures?ids[0]:v)),/selection differs/)
  await assert.rejects(compileSetteiDelivery(project,{library,expectedRevision:after.revision,figures:added.added[7].id}),/Unaccepted.*figure/)
  await assert.rejects(compileSetteiDelivery(project,{library,expectedRevision:after.revision,figures:added.added[8].id}),/Unaccepted.*figure/)
  await assert.rejects(compileSetteiDelivery(project,{library,expectedRevision:after.revision,figures:'missing-key'}),{code:'INVALID_ARGUMENT'})
  // A current local identity is never restored to an unchanged source baseline, even without scope.
  const changedIdentity={...seed.identitySettei,palette:[{role:'local',hex:'#ABCDEF',zone:'hair'}],version:'a'.repeat(64)}
  const local=await service.patchFigure({packId,figureId:seed.id,expectedRevision:after.revision,patch:{identitySettei:changedIdentity}})
  const unchanged=await compileSetteiDelivery(oldOnly,{library,expectedRevision:local.snapshot.revision})
  assert.deepEqual(unchanged.changedFigures,[])
  assert.equal(unchanged.manifest.contentHash,local.snapshot.manifest.contentHash)
  assert.deepEqual(unchanged.files.get('figures/'+seed.id+'.json'),(await readNativeSnapshot(library,packId,{media:true})).files.get('figures/'+seed.id+'.json'))
  const oldReview=await reviewProduction(oldOnly);await acceptProduction(oldOnly,{review:oldReview.hash,reviewer:'synthetic fixture'})
  const oldArgs=['--project',oldOnly,'--library',library,'--expected-revision',local.snapshot.revision]
  await runCli(['pack',...oldArgs])
  assert.equal((await runCli(['install',...oldArgs,'--confirm'])).status,'noop')
  assert.equal((await readNativeSnapshot(library,packId)).revision,local.snapshot.revision)
  // If both sides changed owned state, fresh library CAS alone cannot authorize overwriting it.
  const slot='f-'+seed.id+'/identity-settei',plan=await preparePrompt(oldOnly,{slot})
  await importImage(oldOnly,{plan:plan.id,file:image,replace:true});await acceptProduction(oldOnly,{slot,reviewer:'synthetic fixture'})
  await assert.rejects(compileSetteiDelivery(oldOnly,{library,expectedRevision:local.snapshot.revision}),error=>error.code==='CONFLICT'&&error.message.includes(seed.id))
  // Added UUID collisions must be identical, not merely have the same settei board.
  const collision=await service.patchFigure({packId,figureId:ids[0],expectedRevision:local.snapshot.revision,patch:{name:'Different local addition'}})
  await assert.rejects(compileSetteiDelivery(project,{library,expectedRevision:collision.snapshot.revision,figures:ids[0]}),error=>error.code==='CONFLICT'&&error.message.includes(ids[0]))
})


test('settei replacement trims its unique old board and approved-only candidates migrate only on accept',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'settei-trim-'));t.after(()=>rm(root,{recursive:true,force:true}))
  const original=path.join(root,'original'),proof=await dryRun(original),library=path.join(original,'verification-library'),project=path.join(root,'source'),packId=proof.installed.id
  const service=createAssetPackService({assetRoot:library});t.after(()=>service.dispose())
  const initial=await readNativeSnapshot(library,packId,{media:true}),figure=structuredClone(Object.values(initial.figures)[0])
  const bytes=syntheticImage(197,131,{opaque:true}),digest=hash(bytes),oldFile='media/'+digest+'.png'
  figure.identitySettei.board=digest
  await service.patchPack({packId,expectedRevision:initial.revision,patch:{blobs:{...initial.manifest.blobs,[digest]:{ext:'png',mime:'image/png',size:bytes.length}}},fileUpdates:new Map([[oldFile,bytes],['figures/'+figure.id+'.json',Buffer.from(JSON.stringify(figure))]])})
  const before=await readNativeSnapshot(library,packId,{media:true})
  await runCli(['baseline','--project',project,'--scope','settei','--library',library,'--pack',packId])
  const p=await loadProject(project),slot=p.characters[0].key+'/identity-settei',image=path.join(root,'candidate.png')
  await writeFile(image,syntheticImage(199,133,{opaque:true}))
  const plan=await preparePrompt(project,{slot});await importImage(project,{plan:plan.id,file:image})
  const legacy=await loadProject(project);legacy.slots[slot].approved=legacy.slots[slot].artifact.hash
  const file=path.join(project,'project.json');await writeFile(file,JSON.stringify(legacy))
  const options={library,expectedRevision:before.revision,figures:figure.id},legacyBytes=await readFile(file)
  assert.equal(slotAccepted(legacy.slots[slot]),false)
  assert.ok(productionProgress(legacy).pending.find(row=>row.slot===slot).reasons.includes('HUMAN_APPROVAL_REQUIRED'))
  const outfit=Object.values(legacy.slots).find(s=>s.kind==='settei')
  assert.ok(prerequisites(legacy,outfit).includes('IDENTITY_SETTEI_REQUIRED'))
  await assert.rejects(compileSetteiDelivery(project,options),/Unaccepted settei slot/)
  assert.deepEqual(await readFile(file),legacyBytes)
  assert.equal((await acceptProduction(project,{slot,reviewer:'Synthetic fixture'})).idempotent,false)
  const compiled=await compileSetteiDelivery(project,options)
  assert.equal(compiled.manifest.blobs[digest],undefined);assert.equal(compiled.files.has(oldFile),false)
  await verifyBytes(compiled.manifest,compiled.files)
  const simulatedManifest=structuredClone(compiled.manifest),simulatedFiles=new Map(compiled.files)
  simulatedManifest.blobs[digest]=before.manifest.blobs[digest];simulatedFiles.set(oldFile,bytes)
  trimAuthoringImages(simulatedManifest,simulatedFiles,before.figures)
  const simulated=await sealPack(simulatedManifest,simulatedFiles,before)
  const args=revision=>['--project',project,'--library',library,'--expected-revision',revision,'--figures',figure.id]
  const exported=await runCli(['pack',...args(before.revision)]),receiptFile=path.join(project,'delivery/settei-export.json'),receipt=await readFile(receiptFile)
  assert.equal(JSON.parse(receipt).contentHash,simulated.manifest.contentHash)
  assert.equal((await runCli(['install',...args(before.revision),'--dry-run'])).contentHash,exported.contentHash)
  const installed=await runCli(['install',...args(before.revision),'--confirm'])
  assert.equal(installed.contentHash,exported.contentHash)
  const after=await readNativeSnapshot(library,packId,{media:true});await verifyBytes(after.manifest,after.files)
  assert.equal(after.files.has(oldFile),false)
  const replay=await runCli(['install',...args(after.revision),'--confirm'])
  assert.equal(replay.status,'noop');assert.equal(replay.revision,after.revision);assert.deepEqual(await readFile(receiptFile),receipt)
})

test('CLI settei install accepts stored emotions without guidance',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'settei-guidance-'));t.after(()=>rm(root,{recursive:true,force:true}))
  const original=path.join(root,'original'),proof=await dryRun(original),library=path.join(original,'verification-library'),project=path.join(root,'source'),packId=proof.installed.id
  const service=createAssetPackService({assetRoot:library});t.after(()=>service.dispose())
  const initial=await readNativeSnapshot(library,packId),figure=structuredClone(Object.values(initial.figures)[0])
  for(const emotion of figure.emotions)delete emotion.guidance
  // A stored legacy avatar slot enters the import-side emotion normalization.
  figure.outfits[0].avatars.joy=Object.values(figure.outfits[0].avatars)[0]
  await service.patchFigure({packId,figureId:figure.id,expectedRevision:initial.revision,patch:{emotions:figure.emotions,outfits:figure.outfits}})
  const before=await readNativeSnapshot(library,packId)
  assert.ok(before.figures[figure.id].emotions.some(emotion=>!Object.hasOwn(emotion,'guidance')))
  await runCli(['baseline','--project',project,'--scope','settei','--library',library,'--pack',packId])
  const p=await loadProject(project),slot=p.characters[0].key+'/identity-settei',image=path.join(root,'candidate.png')
  await writeFile(image,syntheticImage(199,133,{opaque:true}))
  const plan=await preparePrompt(project,{slot});await importImage(project,{plan:plan.id,file:image})
  await acceptProduction(project,{slot,reviewer:'Synthetic fixture'})
  const args=['--project',project,'--library',library,'--expected-revision',before.revision,'--figures',figure.id]
  const exported=await runCli(['pack',...args])
  const installed=await runCli(['install',...args,'--confirm'])
  assert.equal(installed.status,'updated');assert.equal(installed.contentHash,exported.contentHash)
  const after=await readNativeSnapshot(library,packId)
  assert.notEqual(after.figures[figure.id].identitySettei.board,before.figures[figure.id].identitySettei.board)
  assert.equal(after.figures[figure.id].emotions.find(emotion=>emotion.id==='calm').guidance,'')
})
