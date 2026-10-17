import {fixtureCli} from './helpers/generated-image-fixture.mjs'
const runCli=fixtureCli(generationFixtureRunCli)
import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {runCli as generationFixtureRunCli,help} from '../bin/dsh-assets.mjs'
import {encodeAssetRgba} from '../tavern-plugin/lib/domain/asset-image-processing.js'
import {measureMouthOpening} from '../tavern-plugin/lib/domain/asset-production-quality.js'
import {checkAvatarFraming,AVATAR_FRAMING_SPEC,avatarFramingSummary} from '../tavern-plugin/lib/domain/avatar-framing.js'
import spec from '../calibration/spec.json' with {type:'json'}
import {orderMouthFrames,hash} from '../tavern-plugin/lib/domain/asset-production-project.js'
function mouth(opening,dark=0) {
  const width=40,height=32,data=new Uint8ClampedArray(Array.from({length:width*height},()=>[255,225,210,255]).flat())
  for(let y=7;y<7+opening;y++)for(let x=10;x<30;x++)data.set([255,125,170,255],(y*width+x)*4)
  for(let y=7;y<7+dark;y++)data.set([30,10,10,255],(y*width+20)*4)
  return encodeAssetRgba({width,height,data})
}
test('pink aperture is monotonic despite non-monotonic dark pixels; explicit file order never reorders',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'quality130-'));t.after(()=>rm(root,{recursive:true,force:true}))
  const paths=[]
  for(const [i,h]of [1,6,12,18].entries()){const file=path.join(root,i+'.png');await writeFile(file,mouth(h,[0,6,11,5][i]));paths.push(file)}
  assert.deepEqual(await Promise.all(paths.map(async file=>measureMouthOpening(await readFile(file)).opening)),[1,6,12,18])
  const list=path.join(root,'files.json');await writeFile(list,JSON.stringify([paths[0],paths[3],paths[1],paths[2]]))
  const explicit=await runCli(['order-mouth','--files',list,'--order','closed,small,mid,open'])
  assert.deepEqual(explicit.frames.map(f=>f.sourceIndex),[0,1,2,3]);assert.equal(explicit.monotonic,false)
  assert.ok(explicit.warnings.some(w=>w.code==='MOUTH_ORDER_DISAGREES'&&w.symbol==='\u26a0'))
  assert.deepEqual((await runCli(['order-mouth','--files',list])).frames.map(f=>f.sourceIndex),[0,2,3,1])
  const p={slots:{}},labels=['closed','small','mid','open']
  for(const [i,f]of [paths[0],paths[3],paths[1],paths[2]].entries()) {const id='hero/daily/mouth/calm/'+labels[i],bytes=await readFile(f);p.slots[id]={id,kind:'mouth',character:'hero',outfit:'daily',emotion:'calm',frame:labels[i],version:1,artifact:{hash:hash(bytes),path:path.basename(f)}}}
  const before=Object.values(p.slots).map(s=>s.artifact.hash)
  await orderMouthFrames(p,root,Object.values(p.slots)[0],{order:'closed,small,mid,open'})
  await orderMouthFrames(p,root,Object.values(p.slots)[0])
  assert.deepEqual(Object.values(p.slots).map(s=>s.artifact.hash),before)
  assert.deepEqual(await readFile(paths[3]),mouth(18,5))
})
test('check-avatar reports alpha-derived numbers, rejects 56%/zero headroom and never changes pixels',async t=>{
  const data=new Uint8ClampedArray(100*100*4)
  for(let y=10;y<100;y++)for(let x=15;x<85;x++)data.set([200,150,130,255],(y*100+x)*4)
  const bytes=encodeAssetRgba({width:100,height:100,data}),good=checkAvatarFraming(bytes,{headRect:[15,10,70,70]})
  assert.equal(good.pass,true);assert.equal(good.metrics.headHeightRatio,0.7);assert.equal(good.metrics.topMarginRatio,0.1)
  assert.equal(checkAvatarFraming(bytes,{headRect:[15,10,70,56]}).pass,false)
  const clipped=new Uint8ClampedArray(data);for(let y=0;y<70;y++)clipped.set([255,255,255,255],y*100*4)
  const bad=checkAvatarFraming(encodeAssetRgba({width:100,height:100,data:clipped}),{headRect:[15,10,70,56]})
  assert.equal(bad.spec.minSideHairMarginRatio,0);assert.ok(bad.warnings.some(w=>w.code==='AVATAR_HEADROOM'))
  const root=await mkdtemp(path.join(os.tmpdir(),'avatar130-'));t.after(()=>rm(root,{recursive:true,force:true}))
  const file=path.join(root,'candidate.png'),geometry=path.join(root,'geometry.json');await writeFile(file,bytes);await writeFile(geometry,JSON.stringify({headRect:[15,10,70,70]}))
  const result=await runCli(['check-avatar','--file',file,'--geometry',geometry]);assert.equal(result.pass,true);assert.equal(result.modified,false);assert.equal(result.installReady,false)
  assert.deepEqual(await readFile(file),bytes)
})
test('measured main-crown ROI excludes tall ahoge and headwear without relaxing head height',()=>{
  const data=new Uint8ClampedArray(100*100*4)
  for(let y=10;y<100;y++)for(let x=15;x<85;x++)data.set([200,150,130,255],(y*100+x)*4)
  for(const width of [1,40]) {
    const pixels=new Uint8ClampedArray(data)
    for(let y=3;y<10;y++)for(let x=50-Math.floor(width/2);x<50+Math.ceil(width/2);x++)pixels.set([80,70,60,255],(y*100+x)*4)
    const bytes=encodeAssetRgba({width:100,height:100,data:pixels})
    const result=checkAvatarFraming(bytes,{headRect:[15,10,70,70]})
    assert.equal(result.pass,true)
    assert.equal(result.headBBox.y,10)
    assert.equal(result.metrics.headHeightRatio,0.7)
    assert.equal(result.metrics.topMarginRatio,0.03)
    assert.equal(checkAvatarFraming(bytes,{headRect:[15,3,70,77]}).pass,false)
    for(const height of [64,76])assert.equal(checkAvatarFraming(bytes,{headRect:[15,10,70,height]}).pass,false)
    assert.equal(checkAvatarFraming(bytes).pass,false)
  }
})
test('avatar checker, help and shipped documentation use the one calibrated spec without drift',async()=>{
  assert.equal(AVATAR_FRAMING_SPEC,spec,'checker must load the shipped spec object, not a duplicate literal')
  assert.ok(help('check-avatar').includes(avatarFramingSummary()))
  for(const file of ['.pi/skills/dsh-assets/references/avatar.md','tools/dsh-assets/CHANGES-1.3.md','tools/dsh-assets/CHANGES-1.3.1.md','docs/fork/asset-cli-contract.md']) {
    const text=await readFile(new URL('../'+file,import.meta.url),'utf8')
    const match=text.match(/<!-- avatar-framing-spec: calibration\/spec.json -->\s*```json\s*([\s\S]*?)\s*```\s*<!-- \/avatar-framing-spec -->/)
    assert.ok(match,file+' must quote the authoritative shipped spec')
    assert.deepEqual(JSON.parse(match[1]),spec,file+' thresholds disagree with checker')
    assert.doesNotMatch(text,/(?:顶部|headroom)\s*8[–-]16%|侧发各[≥]?5%|side hair >=5%/,file+' retains superseded thresholds')
  }
  const width=100,height=100,data=new Uint8ClampedArray(width*height*4)
  for(let y=3;y<100;y++)for(let x=y<73?0:20;x<(y<73?100:80);x++)data.set([220,180,155,255],(y*width+x)*4)
  const bytes=encodeAssetRgba({width,height,data}),checked=checkAvatarFraming(bytes,{headRect:[0,3,100,70]})
  assert.equal(checked.spec,spec);assert.equal(checked.pass,true,'3% headroom and edge contact are calibrated, not rejected by old 8%/5% gates')
  assert.equal(checkAvatarFraming(bytes,{headRect:[0,3,100,76]}).pass,false,'head height gate must not loosen with the margin fix')
})
test('1.3.0 approved avatar calibration stays valid in 1.3.1 without changing the 65-75% head gate',async()=>{
  const file=new URL('../calibration/dafeiyu-claude-calm.png',import.meta.url),geometry=JSON.parse(await readFile(new URL('../calibration/geometry.json',import.meta.url)))
  const bytes=await readFile(file),result=checkAvatarFraming(bytes,geometry)
  assert.equal(result.pass,true);assert.equal(result.metrics.headHeightRatio,425/610);assert.equal(result.metrics.topMarginRatio,14/610)
  assert.equal(checkAvatarFraming(bytes,{headRect:[0,105,813,342]}).pass,false)
})

test('match-reference uses measured final canvas, records deltas and leaves default framing strict',async t=>{
  const {normalizeAvatar}=await import('../tavern-plugin/lib/domain/asset-production-quality.js')
  const {loadProject,hash}=await import('../tavern-plugin/lib/domain/asset-production-project.js')
  const root=await mkdtemp(path.join(os.tmpdir(),'avatar-reference-'));t.after(()=>rm(root,{recursive:true,force:true}))
  const data=new Uint8ClampedArray(100*100*4)
  for(let y=10;y<100;y++)for(let x=15;x<85;x++)data.set([200,150,130,255],(y*100+x)*4)
  const bytes=encodeAssetRgba({width:100,height:100,data}),reference={bytes,geometry:{headRect:[15,10,70,54]},tolerance:0.03}
  const good=normalizeAvatar(bytes,'1024x1024',{headRect:[15,10,70,56]},reference)
  assert.equal(good.redo,false);assert.equal(good.qa.pass,true);assert.ok(good.qa.deltas.headHeight>0)
  const bad=normalizeAvatar(bytes,'1024x1024',{headRect:[15,10,70,60]},reference)
  assert.equal(bad.redo,true);assert.ok(bad.warnings.some(w=>w.code==='AVATAR_REFERENCE_DELTA'&&w.message.includes('px')))
  assert.equal(normalizeAvatar(bytes,'1024x1024',{headRect:[15,10,70,54]}).redo,true)
  const id='11111111-1111-4111-8111-111111111111',fid='22222222-2222-4222-8222-222222222222',key='f-'+fid,calm=key+'/daily/avatar/calm',joy=key+'/daily/avatar/joy',digest=hash(bytes)
  const p={schemaVersion:2,id,name:'Synthetic reference QA',revision:0,characters:[{key,id:fid,name:'Fixture',avatarFraming:{mode:'match-reference',reference:'installed-default',tolerance:0.03},emotions:[{id:'calm',label:'Calm'},{id:'joy',label:'Joy'}],outfits:[{key:'daily',label:'Daily',defaultEmotion:'calm',imageKinds:['avatar']}]}],assets:[],plans:{},reviews:[],slots:{},baseline:{scope:'images',packId:id,nativeRevision:'fixture-revision',contentHash:digest,uuidMap:[{key,id:fid,outfits:['daily']}],sources:[{slot:calm,hash:digest,path:'reference.png',nativePath:'media/reference.png'}]}}
  p.slots[calm]={id:calm,character:key,outfit:'daily',kind:'avatar',emotion:'calm',version:'fixture-revision',status:'baseline-installed',installed:{revision:'fixture-revision',hashes:[digest]},raw:{hash:digest,path:'reference.png',width:100,height:100},artifact:{hash:digest,path:'reference.png',width:100,height:100}}
  p.slots[joy]={id:joy,character:key,outfit:'daily',kind:'avatar',emotion:'joy',version:0}
  await writeFile(path.join(root,'project.json'),JSON.stringify(p));await writeFile(path.join(root,'reference.png'),bytes)
  const geo=path.join(root,'geometry.json');await writeFile(geo,JSON.stringify({headRect:[15,10,70,60],referenceHeadRect:[15,10,70,54]}))
  const args=['import','--project',root,'--file',path.join(root,'reference.png'),'--geometry',geo]
  const first=await runCli(['prompt','--project',root,'--slot',joy])
  await runCli([...args,'--plan',first.id])
  assert.ok(JSON.stringify(await runCli(['validate','--project',root])).includes('REDO_REQUIRED'))
  await writeFile(geo,JSON.stringify({headRect:[15,10,70,54],referenceHeadRect:[15,10,70,54],occlusion:'headwear'}))
  const second=await runCli(['prompt','--project',root,'--slot',joy])
  await runCli([...args,'--replace','--plan',second.id])
  const after=await loadProject(root)
  assert.equal(after.slots[joy].artifact.redo,false);assert.equal(after.slots[joy].artifact.qa.pass,true)
  assert.ok(after.slots[joy].artifact.warnings.some(w=>w.code==='AVATAR_OCCLUSION'))
  assert.ok(!JSON.stringify(await runCli(['status','--project',root])).includes('REDO_REQUIRED'))
  assert.equal((await runCli(['validate','--project',root])).valid,true)
  const review=await import('../tools/dsh-assets/review-data.mjs')
  assert.equal(review.buildReviewData(after).characters[0].outfits[0].states[1].avatar.provenance.occlusion,'headwear')
  const {contentFingerprint,reviewMatchesContent}=await import('../tavern-plugin/lib/domain/asset-production-project.js')
  const other={key:'f-33333333-3333-4333-8333-333333333333',id:'33333333-3333-4333-8333-333333333333',name:'Other',emotions:[],outfits:[]}
  after.characters.push(other);after.baseline.uuidMap.push({key:other.key,id:other.id,outfits:[]})
  after.review={contentHash:contentFingerprint(after),acceptedBy:'Existing reviewer'}
  after.slots[joy].approved=after.slots[joy].artifact.hash
  after.review.contentHash=contentFingerprint(after)
  await writeFile(path.join(root,'project.json'),JSON.stringify(after))
  const beforeBytes=await readFile(path.join(root,'project.json')),command=['figure-framing','--project',root,'--figure',fid,'--mode','default']
  const preview=await runCli([...command,'--dry-run'])
  assert.deepEqual(await readFile(path.join(root,'project.json')),beforeBytes)
  // A torn audit tail must not swallow the framing event or stale accepted review.
  await writeFile(path.join(root,'project-log.jsonl'),'{\"torn\":')
  const cleared=await runCli(command)
  assert.deepEqual(cleared.diff,preview.diff)
  const clearedProject=await loadProject(root),expected=structuredClone(after)
  delete expected.characters[0].avatarFraming;expected.revision++
  assert.deepEqual(clearedProject,expected)
  assert.equal(reviewMatchesContent(clearedProject),true)
  assert.ok(JSON.stringify(await runCli(['status','--project',root])).includes('AVATAR_QA_RECHECK_REQUIRED'))
  assert.ok(JSON.stringify(await runCli(['validate','--project',root])).includes('AVATAR_QA_RECHECK_REQUIRED'))
  const log=await readFile(path.join(root,'project-log.jsonl'))
  assert.equal((await runCli(command)).idempotent,true)
  assert.deepEqual(await readFile(path.join(root,'project-log.jsonl')),log)
  const setting=['figure-framing','--project',root,'--figure',fid,'--mode','match-reference']
  await assert.rejects(runCli([...setting,'--tolerance','0.04']),/schema violation/)
  await runCli(setting)
  const enabled=await loadProject(root)
  expected.characters[0].avatarFraming=after.characters[0].avatarFraming;expected.revision++
  assert.deepEqual(enabled,expected)
  assert.equal((await runCli(setting)).idempotent,true)
  assert.equal(reviewMatchesContent(enabled),true)
  assert.ok(!JSON.stringify(await runCli(['status','--project',root])).includes('AVATAR_QA_RECHECK_REQUIRED'))
  p.characters[0].avatarFraming.tolerance=1
  await writeFile(path.join(root,'project.json'),JSON.stringify(p))
  await assert.rejects(loadProject(root),/schema violation/)
})

test('match-reference follows nonstandard bottom gap, shoulder width and neck; default remains strict',async()=>{
  const {normalizeAvatar}=await import('../tavern-plugin/lib/domain/asset-production-quality.js')
  const data=new Uint8ClampedArray(1024*1024*4)
  for(let y=0;y<800;y++)for(let x=0;x<400;x++)data.set([200,150,130,255],(y*1024+x)*4)
  const bytes=encodeAssetRgba({width:1024,height:1024,data}),geometry={headRect:[0,0,400,550]}
  const result=normalizeAvatar(bytes,'1024x1024',geometry,{bytes,geometry,tolerance:0.03})
  assert.equal(result.redo,false);assert.equal(result.qa.pass,true)
  assert.ok(Object.values(result.qa.deltas).every(n=>n===0))
  assert.ok(result.qa.metrics.bottomGap>0.02)
  assert.ok(normalizeAvatar(bytes,'1024x1024',geometry).warnings.some(w=>w.code==='AVATAR_NECK_SHOULDERS'))
  const changed=new Uint8ClampedArray(data)
  for(let y=800;y<900;y++)for(let x=0;x<400;x++)changed.set([200,150,130,255],(y*1024+x)*4)
  assert.equal(normalizeAvatar(encodeAssetRgba({width:1024,height:1024,data:changed}),'1024x1024',geometry,{bytes,geometry,tolerance:0.03}).redo,true)
})
