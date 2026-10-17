import {fixtureCli,admitSeededFixture} from './helpers/generated-image-fixture.mjs'
const runCli=fixtureCli(generationFixtureRunCli)
import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import os from 'node:os'
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises'
import {runCli as generationFixtureRunCli} from '../bin/dsh-assets.mjs'
import {initProject,loadProject,hash} from '../tavern-plugin/lib/domain/asset-production-project.js'
import {readNativeSnapshot} from '../tools/dsh-assets/baseline.mjs'
import {verifyBytes} from '../tavern-plugin/packages/dsh-asset-library/lib/pack-v2/validation.js'
import {decodeMedia} from '../tavern-plugin/packages/dsh-asset-library/lib/pack-v2/media.js'
import {selectPackFigure} from '../tavern-plugin/lib/domain/asset-pack-presentation.js'
import {createAssetPackService} from '../tavern-plugin/packages/dsh-asset-library/lib/pack-v2/service.js'
import playback from '../tavern-plugin/src/client/fork-pack-playback.cjs'
import {png} from './fixtures/asset-packs/pack.mjs'
const json=value=>JSON.stringify(value,null,2)+'\n'
async function fixture(t) {
  const root=await mkdtemp(path.join(os.tmpdir(),'accepted-install-'));t.after(()=>rm(root,{recursive:true,force:true}))
  const project=path.join(root,'project'),library=path.join(root,'library')
  await initProject(project,{name:'Sparse fixture',characters:['actor','identity','pending'].map(key=>({key,name:'Name '+key,identityAppearance:'Synthetic identity',emotions:[{id:'calm',label:'Calm'},{id:'sad',label:'Sad'}],outfits:['daily','pending'].map(key=>({key,label:'Label '+key,outfitAppearance:'Synthetic outfit'}))}))})
  const p=await loadProject(project);await mkdir(path.join(project,'fixtures'))
  for(const [i,s]of Object.values(p.slots).entries())if(['identity-settei','settei','sprite','avatar'].includes(s.kind)) {
    const bytes=png([i%255,80,100]),file='fixtures/'+i+'.png';await writeFile(path.join(project,file),bytes)
    s.version=1;s.raw=s.artifact={hash:hash(bytes),path:file,width:8,height:8}
  }
  for(const s of Object.values(p.slots))if(s.kind==='sprite')s.registered={anchorHash:p.slots[s.character+'/'+s.outfit+'/sprite/calm'].raw.hash,warnings:[]}
  await writeFile(path.join(project,'project.json'),json(await admitSeededFixture(p,project)))
  const accepted=['actor/identity-settei','actor/daily/settei','actor/daily/avatar/calm','identity/identity-settei']
  await runCli(['accept','--project',project,'--slot',accepted.join(','),'--reviewer','Synthetic test'])
  const args=(command,revision='null',extra=[])=>[command,'--project',project,'--scope','accepted','--library',library,'--expected-revision',revision,...extra]
  return {project,library,p,accepted,args}
}
test('accepted first install preserves UUIDs, reports exact sparse publish, verifies natively and extends without rebaseline',async t=>{
  const {project,library,p,accepted,args}=await fixture(t),actor=p.characters[0],identity=p.characters[1]
  const projectBytes=await readFile(path.join(project,'project.json'))
  const dry=await runCli(args('install','null',['--dry-run']))
  assert.deepEqual(dry.creates,{pack:p.id,figures:[actor.id,identity.id],outfits:[{figure:actor.id,key:'daily'}]})
  assert.deepEqual(new Set(dry.written),new Set(accepted))
  assert.deepEqual(new Set(dry.skipped.map(s=>s.slot)),new Set(Object.keys(p.slots).filter(id=>!accepted.includes(id))))
  assert.deepEqual(new Set(dry.fileWrites),new Set(['manifest.json','figures/'+actor.id+'.json','figures/'+identity.id+'.json',...accepted.map(id=>'media/'+p.slots[id].artifact.hash+'.png')]))
  const packed=await runCli(args('pack'));assert.equal(packed.contentHash,dry.contentHash)
  await assert.rejects(runCli(args('install','null',['--slots','actor/daily/avatar/calm','--confirm'])),/selection differs/)
  const installed=await runCli(args('install','null',['--confirm']))
  assert.equal(installed.id,p.id);assert.equal(installed.contentHash,packed.contentHash)
  const native=await readNativeSnapshot(library,p.id,{media:true})
  await verifyBytes(native.manifest,native.files,{decodeMedia})
  assert.deepEqual(native.manifest.figures,[actor.id,identity.id]);assert.equal(native.figures[identity.id].outfits.length,0)
  assert.equal(native.figures[actor.id].outfits.length,1)
  const outfit=native.figures[actor.id].outfits[0]
  assert.equal(outfit.key,'daily');assert.deepEqual(outfit.avatars,{calm:p.slots['actor/daily/avatar/calm'].artifact.hash});assert.equal(outfit.sprite,undefined)
  assert.deepEqual(native.manifest.sprites,{})
  assert.equal(Object.keys(native.manifest.blobs).length,accepted.length)
  const view=selectPackFigure(native.figures[actor.id],native.sprites,{outfitKey:'daily',emotion:'sad',appearance:'sprite'})
  assert.equal(view.spriteResolution.missing,true);assert.equal(view.avatar,outfit.avatars.calm);assert.equal(view.form,'avatar')
  const render=playback.packFigureRenderInputs({...view,alias:'actor',avatarUrl:'fixture.png',media:{avatar:{identity:view.avatar}}})
  assert.equal(render.stage,null);assert.equal(render.face.src,'fixture.png')
  await assert.rejects(runCli(args('install','null',['--confirm'])),/null requires/)
  const replay=await runCli(args('install',installed.revision,['--confirm']))
  assert.equal(replay.status,'noop');assert.deepEqual(replay.written,[]);assert.deepEqual(replay.fileWrites,[])
  assert.equal(replay.contentHash,installed.contentHash);assert.equal(replay.revision,installed.revision)
  assert.deepEqual(await readFile(path.join(project,'project.json')),projectBytes)
  await runCli(['accept','--project',project,'--slot','actor/daily/sprite/calm','--reviewer','Synthetic test'])
  const later=await runCli(args('pack',installed.revision));assert.deepEqual(later.written,['actor/daily/sprite/calm']);assert.deepEqual(later.creates,{pack:null,figures:[],outfits:[]})
  const update=await runCli(args('install',installed.revision,['--confirm']))
  const updated=await readNativeSnapshot(library,p.id,{media:true})
  await verifyBytes(updated.manifest,updated.files,{decodeMedia})
  assert.equal(update.contentHash,later.contentHash)
  const sprite=updated.figures[actor.id].outfits[0].sprite
  assert.deepEqual(updated.sprites[sprite.manifestKey].emotions,{calm:{src:'accepted/calm.png'}})
  assert.deepEqual(updated.figures[actor.id].outfits[0].avatars,outfit.avatars)
  assert.equal(Object.keys(updated.manifest.blobs).length,accepted.length+1)
  assert.equal((await runCli(args('install',update.revision,['--confirm']))).status,'noop')
  // A replacement retires only the old avatar; receipt, native trim and source folder agree.
  const next=await loadProject(project),slot=next.slots['actor/daily/avatar/calm'],bytes=png([240,230,220]),oldHash=slot.artifact.hash
  await writeFile(path.join(project,'fixtures/replacement.png'),bytes)
  slot.artifact={hash:hash(bytes),path:'fixtures/replacement.png',width:8,height:8};slot.version++
  await writeFile(path.join(project,'project.json'),json(next))
  await runCli(['accept','--project',project,'--slot',slot.id,'--reviewer','Synthetic test'])
  const replaced=await runCli(args('pack',update.revision))
  assert.deepEqual(replaced.fileRemovals,['media/'+oldHash+'.png'])
  await assert.rejects(readFile(path.join(project,'delivery/final-assets/pack-source/media/'+oldHash+'.png')),{code:'ENOENT'})
  const replacement=await runCli(args('install',update.revision,['--confirm']))
  assert.equal(replacement.contentHash,replaced.contentHash)
  const after=await readNativeSnapshot(library,p.id,{media:true});await verifyBytes(after.manifest,after.files,{decodeMedia})
  assert.equal(after.manifest.blobs[oldHash],undefined)
  // Unchanged source preserves local edits; a changed source conflicts instead of overwriting them.
  const service=createAssetPackService({assetRoot:library});t.after(()=>service.dispose())
  const localOutfits=structuredClone(after.figures[actor.id].outfits)
  localOutfits[0].avatars.calm=after.figures[actor.id].identitySettei.board
  const localFigure={...after.figures[actor.id],name:'Local owner name',outfits:localOutfits}
  const local=await service.patchPack({packId:p.id,expectedRevision:replacement.revision,patch:{},fileUpdates:new Map([['figures/'+actor.id+'.json',Buffer.from(json(localFigure))]])})
  const untouched=await runCli(args('pack',local.snapshot.revision));assert.deepEqual(untouched.written,[])
  assert.equal((await runCli(args('install',local.snapshot.revision,['--confirm']))).status,'noop')
  assert.equal((await readNativeSnapshot(library,p.id)).figures[actor.id].name,'Local owner name')
  const conflict=await loadProject(project);conflict.slots[slot.id].artifact=conflict.slots['actor/daily/settei'].artifact;conflict.slots[slot.id].version++
  await writeFile(path.join(project,'project.json'),json(conflict))
  await runCli(['accept','--project',project,'--slot',slot.id,'--reviewer','Synthetic test'])
  await assert.rejects(runCli(args('pack',local.snapshot.revision)),/conflicts with a local edit/)
})
test('accepted scopes reject stale approval, archive drift and existing-pack adoption',async t=>{
  const {project,library,p,args}=await fixture(t)
  const modified=await loadProject(project);modified.slots['actor/daily/avatar/calm'].acceptedVersion=0
  await writeFile(path.join(project,'project.json'),json(modified))
  const dry=await runCli(args('install','null',['--dry-run']))
  assert.ok(dry.skipped.find(s=>s.slot==='actor/daily/avatar/calm').reasons.includes('HUMAN_APPROVAL_REQUIRED'))
  const packed=await runCli(args('pack'))
  const bytes=await readFile(packed.output);await writeFile(packed.output,Buffer.from('not a zip'))
  await assert.rejects(runCli(args('install','null',['--confirm'])))
  await writeFile(packed.output,bytes)
  const installed=await runCli(args('install','null',['--confirm']))
  await rm(path.join(project,'sources/accepted-install.json'))
  // A receipt for exactly this publish recovers an interrupted baseline write.
  assert.equal((await runCli(args('install',installed.revision,['--confirm']))).status,'noop')
  await rm(path.join(project,'sources/accepted-install.json'));await rm(path.join(project,'delivery/accepted-export.json'))
  await assert.rejects(runCli(args('install',installed.revision,['--dry-run'])),/cannot adopt/)
  assert.equal((await readNativeSnapshot(library,p.id)).revision,installed.revision)
})

test('explicit reviewer warning acceptance unblocks avatar delivery and dependents without overriding hard failures',async t=>{
  const {project,args}=await fixture(t),id='actor/daily/avatar/calm'
  const {normalizeAvatar}=await import('../tavern-plugin/lib/domain/asset-production-quality.js')
  const {encodeAssetRgba}=await import('../tavern-plugin/lib/domain/asset-image-processing.js')
  const {prerequisites,productionRedoRequired}=await import('../tavern-plugin/lib/domain/asset-production-project.js')
  const data=new Uint8ClampedArray(100*100*4)
  for(let y=0;y<100;y++)for(let x=20;x<80;x++)data.set([90,110,130,255],(y*100+x)*4)
  const bytes=encodeAssetRgba({width:100,height:100,data})
  const measured=normalizeAvatar(bytes,'100x100',{headRect:[20,0,60,80]})
  const p=await loadProject(project),s=p.slots[id]
  await writeFile(path.join(project,'fixtures/avatar.png'),bytes)
  s.artifact={hash:hash(bytes),path:'fixtures/avatar.png',width:100,height:100,qa:measured.qa,redo:measured.redo,warnings:measured.warnings,geometry:measured.geometry}
  await writeFile(path.join(project,'project.json'),json(await admitSeededFixture(p,project)))
  const accept=['accept','--project',project,'--slot',id,'--reviewer','Synthetic owner']
  await runCli(accept)
  assert.ok((await runCli(args('install','null',['--dry-run']))).skipped.some(row=>row.slot===id&&row.reasons.includes('REDO_REQUIRED')))
  assert.ok(prerequisites(await loadProject(project),p.slots['actor/daily/avatar/sad']).includes('STALE_REFERENCES'))
  const accepted=await runCli([...accept,'--accept-warning','Owner accepts the framing'])
  assert.equal(accepted.warningAcceptance.reason,'Owner accepts the framing')
  assert.equal(accepted.warningAcceptance.reviewer,'Synthetic owner')
  const approved=await loadProject(project),a=approved.slots[id]
  assert.equal(a.artifact.redo,true);assert.equal(a.artifact.qa.pass,false)
  assert.deepEqual(a.artifact.qa,measured.qa)
  assert.equal(productionRedoRequired(a),false)
  assert.ok(!prerequisites(approved,approved.slots['actor/daily/avatar/sad']).includes('STALE_REFERENCES'))
  const before=await readFile(path.join(project,'project.json'))
  assert.equal((await runCli([...accept,'--accept-warning','Owner accepts the framing'])).idempotent,true)
  assert.deepEqual(await readFile(path.join(project,'project.json')),before)
  assert.ok((await runCli(args('install','null',['--dry-run']))).written.includes(id))
  await runCli(args('pack'))
  const installed=await runCli(args('install','null',['--confirm']))
  assert.ok(installed.written.includes(id))
  a.version++;assert.equal(productionRedoRequired(a),true);a.version--
  a.artifact.qa.warnings.push({code:'EMPTY_IMAGE',severity:'warning',message:'No visible pixels'})
  assert.equal(productionRedoRequired(a),true)
  await writeFile(path.join(project,'project.json'),json(approved))
  await assert.rejects(runCli([...accept,'--accept-warning','Cannot override integrity']),/Only measured avatar composition warnings/)
  a.artifact.qa=measured.qa;a.stale=true
  await writeFile(path.join(project,'project.json'),json(approved))
  await assert.rejects(runCli([...accept,'--accept-warning','Cannot override stale']),/stale or waiting/)
})
