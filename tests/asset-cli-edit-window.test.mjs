import {fixtureImport} from './helpers/generated-image-fixture.mjs'
const importImage=fixtureImport(generationFixtureImport)
import test from 'node:test'
import assert from 'node:assert/strict'
import {chooseEditWindow,cropEditWindow,extractWindowPatch} from '../tools/dsh-assets/edit-window.mjs'
import {decodeAssetRgba,encodeAssetRgba} from '../tavern-plugin/lib/domain/asset-image-processing.js'
import {extractProductionPatch} from '../tavern-plugin/lib/domain/asset-production-images.js'
const geometry={headRect:[450,80,400,400],eyeRect:[480,200,330,60],browBottom:180,hairBottom:180},rect=[590,360,80,40]
const source={width:1313,height:1198,slot:'figure/default/sprite/anxious',version:'native-revision',hash:'source-hash'}
function pixels(width,height) {
  const data=new Uint8ClampedArray(width*height*4)
  for(let i=0;i<data.length;i+=4)data.set([180,(i/4)%251,90,255],i)
  return {width,height,data}
}
test('odd source selects a producible 1:1 window containing measured ROI and margin, bound to source identity',()=>{
  for(const kind of ['blink','mouth']) {
    const w=chooseEditWindow(source,kind,{geometry,rect}),roi=kind==='blink'?geometry.eyeRect:rect
    assert.equal(w.width,1536);assert.equal(w.height,1024)
    assert.deepEqual(w.source,{slot:source.slot,version:source.version,hash:source.hash})
    assert.ok(w.x<=roi[0]-32&&w.y<=roi[1]-32&&w.x+w.width>=roi[0]+roi[2]+32&&w.y+w.height>=roi[1]+roi[3]+32)
  }
})
test('portrait sources prefer portrait padding and square windows are never selected',()=>{
  for(const [width,height]of [[1198,1313],[1312,1199],[900,900],[1700,1700]]) {
    const w=chooseEditWindow({...source,width,height},'blink',{geometry})
    assert.ok(['1024x1536','1536x1024'].includes(w.width+'x'+w.height))
    if(width===1198)assert.equal(w.width,1024)
  }
})
test('crop and full-source paste-back preserve every RGBA byte outside blink or mouth ROI, including padding',()=>{
  const original=pixels(source.width,source.height),base=encodeAssetRgba(original)
  for(const kind of ['blink','mouth']) {
    const window=chooseEditWindow(source,kind,{geometry,rect}),crop=decodeAssetRgba(cropEditWindow(base,window))
    assert.ok(window.x<0)
    assert.deepEqual([...crop.data.slice(0,4)],[0,0,0,0])
    const sx=Math.max(window.x,0),sy=Math.max(window.y,0),at=((sy-window.y)*crop.width+sx-window.x)*4
    assert.deepEqual(crop.data.slice(at,at+4),original.data.slice((sy*source.width+sx)*4,(sy*source.width+sx)*4+4))
    for(let i=0;i<crop.data.length;i+=4)crop.data.set([20,30,40,255],i)
    const result=extractWindowPatch(base,encodeAssetRgba(crop),kind,window),patch=decodeAssetRgba(result.bytes),[x,y,w,h]=result.rect,output=new Uint8ClampedArray(original.data)
    for(let row=0;row<h;row++)output.set(patch.data.subarray(row*w*4,(row+1)*w*4),((row+y)*source.width+x)*4)
    assert.deepEqual(result.rect,kind==='blink'?geometry.eyeRect:rect)
    for(let row=0;row<source.height;row++) {
      const start=row*source.width*4,end=start+source.width*4
      if(row<y||row>=y+h)assert.deepEqual(output.subarray(start,end),original.data.subarray(start,end))
      else {assert.deepEqual(output.subarray(start,start+x*4),original.data.subarray(start,start+x*4));assert.deepEqual(output.subarray(start+(x+w)*4,end),original.data.subarray(start+(x+w)*4,end))}
    }
  }
})
test('explicit mouth matte removes regenerated skin drift, retains lip pixels and source alpha without a rectangular seam',()=>{
  const base=pixels(80,60),edit=pixels(80,60),rect=[10,10,60,40]
  for(let i=0;i<edit.data.length;i+=4)edit.data.set([195,120,105,253],i)
  const geometry={mouthMask:{core:[[[30,25],[50,25],[50,35],[30,35]]],feather:4}}
  const patch=decodeAssetRgba(extractProductionPatch(encodeAssetRgba(base),encodeAssetRgba(edit),'mouth',rect,geometry).bytes)
  const at=(x,y)=>Array.from(patch.data.slice(((y-10)*60+x-10)*4,((y-10)*60+x-10)*4+4))
  const original=(x,y)=>Array.from(base.data.slice((y*80+x)*4,(y*80+x)*4+4))
  assert.deepEqual(at(10,10),original(10,10));assert.deepEqual(at(69,49),original(69,49))
  assert.deepEqual(at(40,30),[195,120,105,255])
  assert.ok(at(28,30)[0]>180&&at(28,30)[0]<195)
  for(let x=10;x<70;x++)for(const y of [10,11,48,49])assert.deepEqual(at(x,y),original(x,y))
  const bad={mouthMask:{core:[[[11,11],[30,11],[30,30]]],feather:4}}
  assert.throws(()=>extractProductionPatch(encodeAssetRgba(base),encodeAssetRgba(edit),'mouth',rect,bad),/widen the rect/)
})
test('mouth matte accepts old near-opaque skin without changing source alpha or permitting holes',()=>{
  const base=pixels(80,60),edit=pixels(80,60),rect=[10,10,60,40]
  for(let i=0;i<base.data.length;i+=4){base.data[i+3]=252+(i/4)%3;edit.data.set([195,120,105,255],i)}
  const geometry={mouthMask:{core:[[[30,20],[50,20],[50,40],[30,40]]],feather:3}}
  const patch=decodeAssetRgba(extractProductionPatch(encodeAssetRgba(base),encodeAssetRgba(edit),'mouth',rect,geometry).bytes)
  for(let y=0;y<40;y++)for(let x=0;x<60;x++)assert.equal(patch.data[(y*60+x)*4+3],base.data[((y+10)*80+x+10)*4+3])
  assert.deepEqual(Array.from(patch.data.slice(0,4)),Array.from(base.data.slice((10*80+10)*4,(10*80+10)*4+4)))
  assert.deepEqual(Array.from(patch.data.slice((20*60+30)*4,(20*60+30)*4+3)),[195,120,105])
  base.data[(30*80+40)*4+3]=249
  assert.throws(()=>extractProductionPatch(encodeAssetRgba(base),encodeAssetRgba(edit),'mouth',rect,geometry),/near-opaque/)
})
test('mouth matte uses full-source geometry identically through a padded edit window',()=>{
  const base=encodeAssetRgba(pixels(source.width,source.height)),edit=pixels(source.width,source.height)
  for(let i=0;i<edit.data.length;i+=4)edit.data.set([195,120,105,255],i)
  const geometry={mouthMask:{core:[[[610,372],[645,372],[645,385],[610,385]]],feather:3}}
  const window=chooseEditWindow(source,'mouth',{rect,geometry}),candidate=encodeAssetRgba(edit)
  const full=extractProductionPatch(base,candidate,'mouth',rect,geometry),cropped=extractWindowPatch(base,cropEditWindow(candidate,window),'mouth',window)
  assert.deepEqual(cropped.rect,rect);assert.deepEqual(cropped.bytes,full.bytes)
  assert.deepEqual(window.geometry,geometry)
})
test('wrong candidate canvas is rejected with exact required dimensions and no resampling',()=>{
  const base=encodeAssetRgba(pixels(source.width,source.height)),wrong=encodeAssetRgba(pixels(1254,1254))
  for(const kind of ['blink','mouth'])assert.throws(()=>extractWindowPatch(base,wrong,kind,chooseEditWindow(source,kind,{geometry,rect})),/exactly 1536x1024; received 1254x1254.*never resize/)
})
test('all producible source canvases keep the original plan path without requiring new geometry',()=>{
  for(const [width,height]of [[1024,1024],[1024,1536],[1536,1024],[1254,1254]])for(const kind of ['blink','mouth'])assert.equal(chooseEditWindow({...source,width,height},kind),null)
})


import {mkdtemp,rm,readFile,writeFile,readdir} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {dryRun} from '../tools/dsh-assets/dry-run.mjs'
import {loadProject,preparePrompt,refreshPlan,importImage as generationFixtureImport,hash,projectStatus} from '../tavern-plugin/lib/domain/asset-production-project.js'
test('prepare checks source bytes; rejected imports write nothing; legacy requested refresh preserves history and ledger',async t=>{
  const temp=await mkdtemp(path.join(os.tmpdir(),'edit-window-')),root=path.join(temp,'project')
  t.after(()=>rm(temp,{recursive:true,force:true}))
  await dryRun(root)
  const file=path.join(root,'project.json'),p=await loadProject(root),id='fixture/daily/blink/calm',base=p.slots['fixture/daily/sprite/calm']
  const bytes=encodeAssetRgba(pixels(1313,1198)),sourcePath='images/'+hash(bytes)+'.png'
  await writeFile(path.join(root,sourcePath),bytes)
  base.artifact={...base.artifact,path:sourcePath,hash:hash(bytes),width:1313,height:1198}
  p.slots[id].sourceBinding={slot:base.id,version:base.version,hash:base.artifact.hash}
  p.blinkSources={[base.id]:{path:sourcePath,hash:hash(bytes),width:1313,height:1198,slot:base.id,version:base.version,nativeRevision:'fixture',mouth:null}}
  await writeFile(file,JSON.stringify(p))
  const tampered=pixels(1313,1198);tampered.data[0]++
  await writeFile(path.join(root,sourcePath),encodeAssetRgba(tampered))
  const before=await readFile(file)
  await assert.rejects(preparePrompt(root,{slot:id,geometry}),{code:'CONFLICT'})
  assert.deepEqual(await readFile(file),before)
  await writeFile(path.join(root,sourcePath),bytes)
  const plan=await preparePrompt(root,{slot:id,geometry})
  assert.equal(plan.output.size,'1536x1024')
  const wrong=path.join(temp,'wrong.png');await writeFile(wrong,encodeAssetRgba(pixels(1254,1254)))
  const files=await readdir(root,{recursive:true}),projectBytes=await readFile(file)
  await assert.rejects(importImage(root,{plan:plan.id,file:wrong,replace:true}),e=>e.code==='PRECONDITION'&&/exactly 1536x1024; received 1254x1254/.test(e.message)&&/--waiting-on exact-canvas/.test(e.nextAction)&&/do not replay.*resize/.test(e.nextAction))
  assert.deepEqual(await readdir(root,{recursive:true}),files)
  assert.deepEqual(await readFile(file),projectBytes)
  const pending=await loadProject(root)
  pending.plans['sibling-request']={...pending.plans[plan.id],id:'sibling-request',status:'requested'}
  await writeFile(file,JSON.stringify(pending))
  const pendingBytes=await readFile(file)
  await assert.rejects(refreshPlan(root,{plan:plan.id}),e=>e.code==='PRECONDITION'&&/sibling-request/.test(e.message))
  assert.deepEqual(await readFile(file),pendingBytes)
  delete pending.plans['sibling-request']
  await writeFile(file,JSON.stringify(pending))
  // Reconstruct persisted 1.3.31/32 plans and actual call bookkeeping, not a model mock.
  for(const status of ['prepared','unknown','invalid']) {
    const current=await loadProject(root),old=current.plans[plan.id]
    delete old.refreshedTo
    old.note='Edit at 1024x1024.'
    old.status=status;old.editWindow.width=1024;old.editWindow.height=1024;old.output.size='1024x1024'
    if(status!=='prepared')old.requestedAt='2026-10-12T00:00:00.000Z'
    current.generationLog=[{slot:id,status:'requested',timestamp:'2026-10-12T00:00:00.000Z',calls:1}]
    await writeFile(file,JSON.stringify(current))
    const ledger=Buffer.from('actual calls: 1\n');await writeFile(path.join(root,'budget-ledger.json'),ledger)
    const history=structuredClone(old),fresh=await refreshPlan(root,{plan:old.id,note:'Edit at 1536x1024.'}),after=await loadProject(root)
    assert.match(fresh.prompt,/1536x1024/)
    assert.doesNotMatch(fresh.prompt,/1024x1024/)
    assert.equal(fresh.note,'Edit at 1536x1024.')
    assert.equal(fresh.output.size,'1536x1024')
    assert.deepEqual(after.generationLog,current.generationLog)
    assert.deepEqual(await readFile(path.join(root,'budget-ledger.json')),ledger)
    assert.deepEqual(after.plans[old.id],{...history,status:status==='prepared'?'superseded':status,refreshedTo:fresh.id})
    assert.equal((await projectStatus(root,{slot:id})).slots[0].blocked.includes('REQUEST_OUTCOME_UNKNOWN'),false)
    await assert.rejects(refreshPlan(root,{plan:old.id}),{code:'CONFLICT'})
  }
})
