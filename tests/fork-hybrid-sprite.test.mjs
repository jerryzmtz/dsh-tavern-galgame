import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,readFile} from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import {validateSpriteManifest,spriteResourcePaths} from '../tavern-plugin/packages/dsh-asset-library/src/asset-packs/sprite.js'
import contract from '../tavern-plugin/packages/dsh-asset-library/src/shared/hybrid-sprite.cjs'
import {createAssetPackService} from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/service.js'
import {writeZip} from '../tavern-plugin/packages/dsh-asset-library/src/zip.js'
import {jsonBytes} from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/validation.js'
import {migrateFaceSprite} from '../tavern-plugin/packages/dsh-asset-library/src/asset-packs/hybrid-migration.js'
import {figureOutfitEmotionRows} from '../tavern-plugin/packages/dsh-asset-library/src/asset-packs/figure-emotions.js'
import {composeHybridPreview} from '../tavern-plugin/lib/domain/hybrid-sprite-preview.js'
import {partAlphaBox} from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/part-bbox.js'
import {encodeAssetRgba,decodeAssetRgba} from '../tavern-plugin/lib/domain/asset-image-processing.js'
import {syntheticPack,PACK_ID,FIGURE_ID,png} from './fixtures/asset-packs/pack.mjs'
const part=(group,src)=>({group,src,rect:[0,0,8,8],bbox:[0,0,8,8],revision:1,baseRevision:1})
function fixture() {
  return {
    kind:'hybrid-face-sprites',version:1,
    rigs:{maid:{
      canvas:[8,8],baseRevision:1,drawOrder:[...contract.HYBRID_GROUPS],
      parts:{base:part('underlay','parts/base.png'),face:part('face','parts/face.png')},
      recipes:{calm:{revision:1,selection:{underlay:'base',pose:'none',face:'face',mouth:'none',front:'none'}}}
    }},
    emotions:{calm:{render:{kind:'parts',rig:'maid',recipe:'calm'}},joy:{render:{kind:'parts',rig:'maid',recipe:'calm'}}}
  }
}
test('strict five-group schema, whole closure, explicit missing and frozen optional frames',()=>{
  const m=fixture();assert.equal(validateSpriteManifest(m),m)
  assert.deepEqual(contract.resolveHybridSprite(m,'calm').layers.map(p=>p.group),['underlay','face'])
  for(const mutate of [m=>m.nope=true,m=>m.rigs.maid.nope=true,m=>m.rigs.maid.parts.face.nope=true,m=>m.rigs.maid.recipes.calm.selection.nope='none']) {
    const bad=fixture();mutate(bad);assert.throws(()=>validateSpriteManifest(bad),{code:'UNKNOWN_FIELD'})
  }
  const bad=fixture();bad.rigs.maid.parts.face.rect[0]=9;assert.throws(()=>validateSpriteManifest(bad))
  bad.rigs.maid.parts.face.rect=[0,0,8,8];bad.rigs.maid.recipes.calm.selection.face='base';assert.throws(()=>validateSpriteManifest(bad))
  m.rigs.maid.recipes.calm.blinkFrames={closed:'unavailable'}
  assert.deepEqual(contract.resolveHybridSprite(m,'calm',{blinkFrame:'closed'}).layers.map(p=>p.id),['base','face'])
  delete m.rigs.maid.parts.face;validateSpriteManifest(m)
  const missing=contract.hybridMissing(m);assert.equal(missing.slots.length,1);assert.deepEqual(missing.slots[0].emotions,['calm','joy'])
  assert.equal(contract.resolveHybridSprite(m,'calm').available,false)
  m.emotions.joy={render:{kind:'whole',legacy:{kind:'static-sprites',version:1,emotions:{joy:{src:'whole.png'}}}}}
  validateSpriteManifest(m);assert.equal(contract.resolveHybridSprite(m,'joy').kind,'whole')
  assert.deepEqual(spriteResourcePaths(m),['parts/base.png','whole.png'])
  m.emotions.joy.render.legacy.extra=1;assert.throws(()=>validateSpriteManifest(m),{code:'UNKNOWN_FIELD'})
})
test('each difference selects its own optional pose and front; clearRect removes old arm silhouette',async()=>{
  const m=fixture(),rig=m.rigs.maid
  rig.parts.face={...rig.parts.face,rect:[0,0,1,1],bbox:[0,0,1,1]}
  rig.parts.arms={...part('pose','arms.png'),rect:[0,6,2,2],bbox:[0,0,2,2],clearRect:[0,6,3,2]}
  rig.parts.steam={...part('front','steam.png'),rect:[7,7,1,1],bbox:[0,0,1,1]}
  rig.recipes.joy={revision:1,selection:{...rig.recipes.calm.selection,pose:'arms',front:'steam'}}
  m.emotions.joy.render.recipe='joy'
  validateSpriteManifest(m)
  assert.deepEqual(contract.resolveHybridSprite(m,'calm').layers.map(p=>p.group),['underlay','face'])
  assert.deepEqual(contract.resolveHybridSprite(m,'joy').layers.map(p=>p.group),['underlay','pose','face','front'])
  const solid=(w,h,rgba)=>encodeAssetRgba({width:w,height:h,data:new Uint8ClampedArray(Array.from({length:w*h},()=>rgba).flat())})
  const files={'parts/base.png':solid(8,8,[255,0,0,255]),'parts/face.png':solid(1,1,[1,2,3,255]),'arms.png':solid(2,2,[255,255,0,255]),'steam.png':solid(1,1,[0,0,255,255])}
  const calm=decodeAssetRgba((await composeHybridPreview(m,'calm',src=>files[src])).bytes),joy=decodeAssetRgba((await composeHybridPreview(m,'joy',src=>files[src])).bytes)
  const pixel=(image,x,y)=>[...image.data.subarray((y*8+x)*4,(y*8+x)*4+4)]
  assert.deepEqual(pixel(calm,2,6),[255,0,0,255]);assert.deepEqual(pixel(joy,2,6),[0,0,0,0])
  assert.deepEqual(pixel(joy,0,6),[255,255,0,255]);assert.deepEqual(pixel(joy,7,7),[0,0,255,255])
  delete rig.parts.arms
  assert.equal(contract.resolveHybridSprite(m,'calm').available,true)
  assert.equal(contract.resolveHybridSprite(m,'joy').missing[0].group,'pose')
  rig.parts.steam.clearRect=[8,8,1,1];assert.throws(()=>validateSpriteManifest(m))
})
test('explicit migration preserves whole mouth/blink, identities and catalogue; second migration is a noop',async()=>{
  const pack=await syntheticPack(),old=pack.sprites.school,rig=fixture().rigs.maid
  const before=structuredClone(old),result=migrateFaceSprite(old,'maid',rig,{calm:'calm'})
  validateSpriteManifest(result.manifest)
  assert.deepEqual(old,before)
  assert.deepEqual(result.manifest.emotions.crying.render.legacy.emotions.crying,old.emotions.crying)
  assert.deepEqual(result.manifest.emotions.crying.render.legacy.mouthSets,old.mouthSets)
  assert.equal(result.manifest.emotions.crying.render.legacy.mouthAtlas,undefined)
  const figure=pack.figures[FIGURE_ID],outfit=figure.outfits[0]
  assert.deepEqual(figureOutfitEmotionRows(figure,outfit,pack.sprites),figureOutfitEmotionRows(figure,outfit,{...pack.sprites,school:result.manifest}))
  assert.equal(migrateFaceSprite(result.manifest,'maid',rig,{}).manifest,result.manifest)
  const preview=await composeHybridPreview(result.manifest,'calm',()=>png([1,2,3]));assert.equal(preview.width,8)
  delete result.manifest.rigs.maid.parts.face
  await assert.rejects(composeHybridPreview(result.manifest,'calm',()=>png([1,2,3])),{code:'MISSING_DEPENDENCY'})
})
test('alpha bbox excludes alpha 8 and transparent RGB, includes 9',()=>{
  const data=new Uint8ClampedArray(3*3*4);data.fill(255);for(let i=3;i<data.length;i+=4)data[i]=8;data[(1*3+1)*4+3]=9
  assert.deepEqual(partAlphaBox(encodeAssetRgba({width:3,height:3,data})),[1,1,1,1])
})
test('service atomically registers, replaces and removes parts; CAS, stale base and roundtrip',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'hybrid-')),service=createAssetPackService({assetRoot:path.join(root,'library')})
  t.after(async()=>{await service.dispose();await rm(root,{recursive:true,force:true})})
  const pack=await syntheticPack(),archive=path.join(root,'pack.zip')
  await writeZip(archive,[{path:'manifest.json',data:jsonBytes(pack.manifest)},...[...pack.files].map(([path,data])=>({path,data}))])
  const inspection=await service.inspectImport({bytes:await readFile(archive)})
  let current=(await service.applyImport({inspectionId:inspection.inspectionId,expectedRevision:null,decision:'install'})).snapshot
  const scope={packId:PACK_ID,figureId:FIGURE_ID,outfitKey:'school'}
  const manifest=fixture();manifest.emotions.crying=manifest.emotions.joy;delete manifest.emotions.joy
  current=(await service.registerLayeredSprite({...scope,expectedRevision:current.revision,spriteKey:'school',manifest,assets:{},files:new Map([['parts/base.png',png([1,2,3])],['parts/face.png',png([4,5,6])]])})).snapshot
  assert.deepEqual(current.figures[FIGURE_ID].outfits[1],pack.figures[FIGURE_ID].outfits[1])
  assert.equal((await service.listLayeredMissing(scope)).slots.length,0)
  const revision=current.revision
  current=(await service.removeLayeredPart({...scope,expectedRevision:revision,rigId:'maid',partId:'face'})).snapshot
  await assert.rejects(service.removeLayeredPart({...scope,expectedRevision:revision,rigId:'maid',partId:'base'}),{code:'REVISION_CONFLICT'})
  assert.equal((await service.listLayeredMissing(scope)).emotions.length,2)
  assert.ok(current.sprites.school.rigs.maid.parts.base)
  current=(await service.registerLayeredPart({...scope,expectedRevision:current.revision,rigId:'maid',partId:'face',part:part('face','parts/face.png'),bytes:png([4,5,6])})).snapshot
  current=(await service.registerLayeredPart({...scope,expectedRevision:current.revision,rigId:'maid',partId:'base',part:{...part('underlay','parts/base.png'),revision:2,baseRevision:2},bytes:png([7,8,9])})).snapshot
  assert.equal((await service.listLayeredMissing(scope)).slots[0].code,'STALE_PART')
  const exported=await service.exportPack({packId:PACK_ID,expectedRevision:current.revision})
  const again=await service.inspectImport({bytes:exported.bytes});assert.deepEqual(again.choices,['noop','cancel'])
  await assert.rejects(service.registerLayeredPart({...scope,expectedRevision:current.revision,rigId:'maid',partId:'face',part:{...part('face','parts/face.png'),revision:2,baseRevision:2,bbox:[1,1,1,1]},bytes:png([9,8,7])}))
  assert.equal((await service.getPackSnapshot({packId:PACK_ID})).revision,current.revision)
  current=(await service.removeLayeredPart({...scope,expectedRevision:current.revision,rigId:'maid',partId:'base'})).snapshot
  assert.equal(current.sprites.school.rigs.maid.baseRevision,3)
  current=(await service.registerLayeredPart({...scope,expectedRevision:current.revision,rigId:'maid',partId:'base',part:{...part('underlay','parts/base.png'),baseRevision:3},bytes:png([3,2,1])})).snapshot
  assert.equal((await service.listLayeredMissing(scope)).slots[0].code,'STALE_PART')
})

test('rebuilding sprite schemas from source preserves shipped replacement fields', async () => {
  for (const name of ['hybrid-sprite.js', 'sprite.js']) {
    const base = '../tavern-plugin/packages/dsh-asset-library/'
    assert.equal(await readFile(new URL(base + 'src/asset-packs/' + name, import.meta.url), 'utf8'),
      await readFile(new URL(base + 'lib/asset-packs/' + name, import.meta.url), 'utf8'))
  }
})
