import {fixtureCli,fixtureReceipt} from './helpers/generated-image-fixture.mjs'
const runCli=fixtureCli(generationFixtureRunCli)
// private fork: Dot's near-opaque skin and tear/lash overlap, isolated synthetic projects only.
import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {fileURLToPath} from 'node:url'
import {runCli as generationFixtureRunCli} from '../bin/dsh-assets.mjs'
import {loadProject,transaction} from '../tavern-plugin/lib/domain/asset-production-project.js'
import {extractEyeRegion} from '../tavern-plugin/lib/domain/asset-production-quality.js'
import {encodeAssetRgba,decodeAssetRgba} from '../tavern-plugin/lib/domain/asset-image-processing.js'
import {compositePatch} from '../tavern-plugin/lib/domain/sprite-blink-patch.js'
import {syntheticImage} from '../tools/dsh-assets/dry-run.mjs'
const polygon=(x,y,w,h)=>[[x,y],[x+w,y],[x+w,y+h],[x,y+h]]
const geometry={headRect:[32,12,64,80],eyeMasks:[polygon(38,34,24,14),polygon(68,34,24,14)],tearMasks:[polygon(43,38,4,28),polygon(80,38,4,28)]}
const at=(image,x,y)=>[...image.data.subarray((y*image.width+x)*4,(y*image.width+x)*4+4)]
function fixtureImages() {
  const base=decodeAssetRgba(syntheticImage()),edit=decodeAssetRgba(syntheticImage())
  for(let i=3;i<base.data.length;i+=4)if(base.data[i])base.data[i]=254
  for(const x of [43,80])for(let y=38;y<66;y++)for(let xx=x;xx<x+4;xx++)base.data.set([150,210,250,254],(y*base.width+xx)*4)
  edit.data.set(base.data)
  for(const x of [38,68])for(let y=34;y<48;y++)for(let xx=x;xx<x+24;xx++)edit.data.set(y===41?[25,15,35,253]:[225,180,155,253],(y*base.width+xx)*4)
  return {base,edit,baseBytes:encodeAssetRgba(base),editBytes:encodeAssetRgba(edit)}
}
test('254->253 skin retains original alpha; tears above overlapping lashes and outside masks remain byte exact',()=>{
  const {base,edit,baseBytes,editBytes}=fixtureImages(),before=new Uint8ClampedArray(base.data)
  const result=extractEyeRegion(baseBytes,editBytes,geometry),patch=decodeAssetRgba(result.bytes),composed=compositePatch(base,patch,result.rect,result.blend)
  assert.deepEqual(result.warnings.map(w=>w.code),['BLINK_ALPHA_RESTORED','BLINK_TEARS_PROTECTED','BLINK_TEAR_LOSS_PREVENTED'])
  assert.deepEqual(extractEyeRegion(baseBytes,editBytes,geometry),result)
  for(let y=0;y<base.height;y++)for(let x=0;x<base.width;x++) {
    const eye=y>=34&&y<48&&(x>=38&&x<62||x>=68&&x<92),tear=y>=38&&y<66&&(x>=43&&x<47||x>=80&&x<84)
    if(!eye||tear)assert.deepEqual(at(composed,x,y),at(base,x,y))
    else {
      assert.deepEqual(at(patch,x-result.rect[0],y-result.rect[1]),[...at(edit,x,y).slice(0,3),254])
      assert.deepEqual(at(composed,x,y),[...at(edit,x,y).slice(0,3),254],'replacement retains exact RGB and source alpha')
    }
  }
  assert.deepEqual(base.data,before)
})
test('opacity tolerance boundaries keep real holes rejected and warnings deterministic',()=>{
  for(const [original,candidate,allowed] of [[254,253,true],[255,250,true],[252,248,true],[249,245,true],[255,249,false],[254,0,false],[12,8,false]]) {
    const f=fixtureImages(),i=(35*f.base.width+40)*4+3;f.base.data[i]=original;f.edit.data[i]=candidate
    const run=()=>extractEyeRegion(encodeAssetRgba(f.base),encodeAssetRgba(f.edit),geometry)
    if(!allowed)assert.throws(run,{code:'PRECONDITION',message:'Blink mask cannot replace opaque skin with transparency'})
    else {const result=run();assert.equal(at(decodeAssetRgba(result.bytes),40-result.rect[0],35-result.rect[1])[3],original)}
  }
  const f=fixtureImages()
  assert.throws(()=>extractEyeRegion(f.baseBytes,f.editBytes,{...geometry,tearMasks:[polygon(-1,0,3,3)]}),{code:'PRECONDITION'})
  assert.throws(()=>extractEyeRegion(f.baseBytes,f.editBytes,{headRect:geometry.headRect,eyeRect:[38,34,52,14],tearMasks:geometry.tearMasks}),{code:'PRECONDITION'})
})
// private fork: names and tear handling are declared data, not ID semantics.
async function projectFixture(t) {
  const root=await mkdtemp(path.join(os.tmpdir(),'asset131-'));t.after(()=>rm(root,{recursive:true,force:true}))
  const project=path.join(root,'project'),file=path.join(root,'base.png'),candidate=path.join(root,'candidate.png'),geo=path.join(root,'geometry.json'),characters=path.join(root,'characters.json')
  const images=fixtureImages();await writeFile(file,images.baseBytes);await writeFile(candidate,images.editBytes);await writeFile(geo,JSON.stringify(geometry))
  await writeFile(characters,JSON.stringify({characters:[{key:'hero',emotions:[{id:'calm',label:'Rest'},{id:'crying',label:'Tears',protectTears:true}],outfits:[{key:'daily'}]}]}))
  const cli=(command,...args)=>runCli([command,'--project',project,...args])
  await cli('init','--characters',characters)
  for(const slot of ['hero/identity-settei','hero/daily/settei']) {
    const p=await cli('prompt','--slot',slot);await cli('import','--plan',p.id,'--file',file);await cli('accept','--slot',slot,'--reviewer','Synthetic fixture only')
  }
  for(const emotion of ['calm','crying']){await cli('import','--slot','hero/daily/sprite/'+emotion,'--file',file);await cli('register','--slot','hero/daily/sprite/'+emotion)}
  const slot='hero/daily/blink/crying',refs=path.join(root,'references.json');await writeFile(refs,JSON.stringify([{file,role:'Synthetic extra reference'}]))
  const plan=await cli('prompt','--slot',slot,'--note','Preserve tears','--references',refs)
  return {root,project,file,candidate,geo,images,cli,slot,plan}
}
test('avatar prompt and refresh replace old framing from an existing plan without a baseline',async t=>{
  const {project,cli}=await projectFixture(t)
  const plan=await cli('prompt','--slot','hero/daily/avatar/calm')
  assert.match(plan.prompt,/natural main hair crown/)
  assert.doesNotMatch(plan.prompt,/eyes about 45%|at least 8%/)
  await transaction(project,async p=>{
    p.plans[plan.id].prompt='Legacy framing: eyes about 45% from the top; at least 8% above the highest ornament.'
  })
  const refreshed=await cli('refresh-plan','--plan',plan.id)
  assert.match(refreshed.prompt,/natural main hair crown/)
  assert.match(refreshed.prompt,/65-75%/)
  assert.match(refreshed.prompt,/2-4%/)
  assert.doesNotMatch(refreshed.prompt,/eyes about 45%|at least 8%/)
  const p=await loadProject(project)
  assert.equal(p.baseline,undefined)
  assert.equal(p.plans[refreshed.id].prompt,refreshed.prompt)
  assert.equal(p.plans[plan.id].status,'superseded')
})
test('refresh rebinds stale dependencies, clears only explicitly resolved wait, keeps audit and enforces import CAS',async t=>{
  const f=await projectFixture(t),{project,cli,slot,plan}=f
  f.images.base.data[(70*128+60)*4]=123;await writeFile(f.file,encodeAssetRgba(f.images.base))
  await cli('import','--slot','hero/daily/sprite/crying','--file',f.file,'--replace')
  await cli('wait','--slot',slot,'--waiting-on','cli-1.3.1','--note','Blocked by alpha guard')
  const projectFile=path.join(project,'project.json'),before=await readFile(projectFile)
  await assert.rejects(cli('import','--plan',plan.id,'--file',f.candidate,'--geometry',f.geo),{code:'CONFLICT'})
  await assert.rejects(cli('refresh-plan','--plan',plan.id),e=>e.code==='PRECONDITION'&&e.message.includes('WAITING_EXTERNAL'))
  await assert.rejects(cli('refresh-plan','--plan',plan.id,'--clear-wait'),e=>e.code==='PRECONDITION'&&e.message.includes('SPRITE_REGISTRATION_REQUIRED'))
  assert.deepEqual(await readFile(projectFile),before,'failed refresh does not clear wait or change plans')
  await cli('register','--slot','hero/daily/sprite/crying')
  await cli('wait','--slot','hero/daily/sprite/crying','--waiting-on','human','--note','Unresolved dependency')
  const dependencyWait=await readFile(projectFile)
  await assert.rejects(cli('refresh-plan','--plan',plan.id,'--clear-wait'),e=>e.code==='PRECONDITION'&&e.message.includes('DEPENDENCY_WAITING'))
  assert.deepEqual(await readFile(projectFile),dependencyWait)
  await cli('wait','--slot','hero/daily/sprite/crying','--clear')
  const refreshed=await cli('refresh-plan','--plan',plan.id,'--clear-wait'),p=await loadProject(project)
  assert.notEqual(refreshed.id,plan.id);assert.notEqual(refreshed.dependencyHash,plan.dependencyHash)
  assert.equal(refreshed.note,plan.note);assert.deepEqual(refreshed.references.filter(r=>!r.slot),plan.references.filter(r=>!r.slot))
  assert.equal(refreshed.references.find(r=>r.slot==='hero/daily/sprite/crying').hash,p.slots['hero/daily/sprite/crying'].artifact.hash)
  assert.equal(p.plans[plan.id].status,'superseded');assert.equal(p.plans[plan.id].refreshedTo,refreshed.id)
  assert.equal(p.plans[refreshed.id].clearedWait.on,'cli-1.3.1');assert.equal(p.workflowWaits[slot],undefined)
  assert.equal(Object.values(p.plans).some(p=>p.requestedAt),false)
  assert.equal((await cli('status','--slot',slot)).nextActions[0].planId,refreshed.id)
  await assert.rejects(cli('import','--plan',plan.id,'--file',f.candidate,'--geometry',f.geo),{code:'CONFLICT'})
  await assert.rejects(cli('refresh-plan','--plan',plan.id),{code:'CONFLICT'})
  const entry=fileURLToPath(new URL('../bin/dsh-assets.mjs',import.meta.url))
  await fixtureReceipt(f.candidate,refreshed)
  const {stdout,stderr}=await promisify(execFile)(process.execPath,[entry,'import','--project',project,'--plan',refreshed.id,'--file',f.candidate,'--geometry',f.geo,'--json'])
  const imported=JSON.parse(stdout);assert.equal(stderr,'');assert.equal(imported.ok,true)
  assert.ok(imported.result.warnings.some(w=>w.code==='BLINK_ALPHA_RESTORED'&&w.symbol==='\u26a0'))
  assert.ok(imported.result.warnings.some(w=>w.code==='BLINK_TEAR_LOSS_PREVENTED'&&w.symbol==='\u26a0'))
  assert.equal((await cli('import','--plan',refreshed.id,'--file',f.candidate,'--geometry',f.geo)).idempotent,true)
  assert.equal((await cli('status')).installReady,false)
})
test('refresh fails loudly for unknown requests/flags; crying cannot silently omit tear protection',async t=>{
  const {cli,project,plan,candidate,geo}=await projectFixture(t)
  await assert.rejects(cli('refresh-plan','--plan',plan.id,'--retry'),{code:'INVALID_ARGUMENT'})
  await assert.rejects(cli('refresh-plan','--plan',plan.id,'--clear-wait'),{code:'PRECONDITION'})
  await writeFile(geo,JSON.stringify({headRect:geometry.headRect,eyeMasks:geometry.eyeMasks}))
  await assert.rejects(cli('import','--plan',plan.id,'--file',candidate,'--geometry',geo),e=>e.code==='PRECONDITION'&&e.message.includes('tearMasks'))
  await transaction(project,p=>{p.plans[plan.id].status='unknown'})
  const before=await readFile(path.join(project,'project.json'))
  await assert.rejects(cli('refresh-plan','--plan',plan.id),{code:'CONFLICT'})
  assert.deepEqual(await readFile(path.join(project,'project.json')),before)
  const entry=fileURLToPath(new URL('../bin/dsh-assets.mjs',import.meta.url))
  await assert.rejects(promisify(execFile)(process.execPath,[entry,'refresh-plan','--project',project,'--plan',plan.id,'--wat']),e=>e.code===2&&JSON.parse(e.stdout).error.retryable===false)
})

test('semi-transparent replacement edges are RGBA exact; legacy straight-alpha over stays unchanged',()=>{
  const image=data=>({width:4,height:1,data:new Uint8ClampedArray(data)});
  const base=image([253,253,255,253, 40,80,120,128, 10,20,30,64, 30,40,50,0]);
  const patch=image([47,0,0,253, 200,100,50,128, 200,200,200,0, 60,70,80,32]);
  const before=base.data.slice(),rect=[0,0,4,1];
  assert.deepEqual([...compositePatch(base,patch,rect,'replace').data],[47,0,0,253,200,100,50,128,10,20,30,64,60,70,80,32]);
  assert.deepEqual([...compositePatch(base,patch,rect).data],[49,2,2,255,147,93,73,192,10,20,30,64,60,70,80,32]);
  assert.deepEqual(base.data,before);
});
