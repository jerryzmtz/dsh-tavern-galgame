import {fixtureCli,fixtureImport} from './helpers/generated-image-fixture.mjs'
const runCli=fixtureCli(generationFixtureRunCli)
const importImage=fixtureImport(generationFixtureImport)
import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import os from 'node:os'
import {mkdtemp,rm,writeFile} from 'node:fs/promises'
import {runCli as generationFixtureRunCli} from '../bin/dsh-assets.mjs'
import {dryRun,syntheticImage} from '../tools/dsh-assets/dry-run.mjs'
import {loadProject,preparePrompt,importImage as generationFixtureImport,acceptProduction} from '../tavern-plugin/lib/domain/asset-production-project.js'
import {readNativeSnapshot} from '../tools/dsh-assets/baseline.mjs'
import {nativeImageInventory} from '../tools/dsh-assets/images-baseline.mjs'
import {createAssetPackService} from '../tavern-plugin/packages/dsh-asset-library/lib/pack-v2/service.js'
const json=x=>Buffer.from(JSON.stringify(x))
test('layered portraits are not avatars; accepted fills preserve portraits and replay',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'avatar-inventory-'));t.after(()=>rm(root,{recursive:true,force:true}))
  const author=path.join(root,'author');await dryRun(author)
  const p=await loadProject(author),library=path.join(author,'verification-library'),service=createAssetPackService({assetRoot:library});t.after(()=>service.dispose())
  const native=await readNativeSnapshot(library,p.id,{media:true}),figure=structuredClone(Object.values(native.figures)[0]),outfit=figure.outfits[0],key=outfit.sprite.manifestKey,src=native.sprites[key].emotions.calm.src
  const doc={version:2,kind:'layered-static-sprites',character:{id:'fixture',name:'Fixture'},closedBehavior:'restore-base',emotions:Object.fromEntries(figure.emotions.map(e=>[e.id,{stage:{src,width:128,height:192},portrait:{src,width:128,height:192}}]))}
  const real=outfit.avatars.sad;outfit.avatars={}
  const inventory=await nativeImageInventory({...native,figures:{[figure.id]:figure},sprites:{[key]:doc}},async()=>{},async h=>Boolean(h))
  assert.ok(inventory.filter(r=>r.kind==='avatar').every(r=>!r.present))
  outfit.avatars.sad=real
  outfit.sprite.assets={[src]:outfit.sprite.assets[src]}
  await service.patchPack({packId:p.id,expectedRevision:native.revision,fileUpdates:new Map([['figures/'+figure.id+'.json',json(figure)],[native.manifest.sprites[key],json(doc)]])})
  const before=await readNativeSnapshot(library,p.id,{media:true}),project=path.join(root,'baseline')
  const baseline=await runCli(['baseline','--scope','images','--library',library,'--pack',p.id,'--project',project])
  const q=await loadProject(project),prefix=q.characters[0].key+'/daily/',slot=prefix+'avatar/calm'
  assert.equal(q.slots[slot].version,0);assert.equal(q.slots[slot].installed,undefined)
  assert.equal(q.slots[prefix+'avatar/sad'].status,'baseline-installed')
  assert.ok(baseline.missing.some(r=>r.slot===slot&&r.expected_version===0))
  const plan=await preparePrompt(project,{slot}),image=path.join(root,'avatar.png');await writeFile(image,syntheticImage(128,128))
  await importImage(project,{plan:plan.id,file:image,geometry:{headRect:[32,12,64,90]}})
  await acceptProduction(project,{slot,reviewer:'synthetic fixture only'})
  const args=['--scope','accepted','--project',project,'--library',library,'--expected-revision',before.revision]
  assert.deepEqual((await runCli(['install',...args,'--dry-run'])).written,[slot])
  await runCli(['pack',...args]);await runCli(['install',...args,'--confirm'])
  const after=await readNativeSnapshot(library,p.id,{media:true})
  assert.equal(after.figures[figure.id].outfits[0].avatars.calm,(await loadProject(project)).slots[slot].artifact.hash)
  assert.deepEqual(after.figures[figure.id].outfits[0].sprite,outfit.sprite)
  assert.deepEqual(after.sprites[key],doc)
  assert.equal((await runCli(['install',...args.map(v=>v===before.revision?after.revision:v),'--confirm'])).status,'noop')
  const edited=structuredClone(after.figures[figure.id]);edited.outfits[0].avatars.calm=outfit.sprite.assets[src]
  await service.patchPack({packId:p.id,expectedRevision:after.revision,fileUpdates:new Map([['figures/'+figure.id+'.json',json(edited)]])})
  const conflict=await readNativeSnapshot(library,p.id,{media:true})
  await assert.rejects(runCli(['install',...args.map(v=>v===before.revision?conflict.revision:v),'--dry-run']),{code:'CONFLICT'})
})
