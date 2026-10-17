// private fork: synthetic raster/lease fixtures; no live packs or filesystem media.
import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {readFile} from 'node:fs/promises'
import vm from 'node:vm'
import {syntheticPack,cardExtension,FIGURE_ID} from './fixtures/asset-packs/pack.mjs'
import {createAssetPackPresentation} from '../tavern-plugin/lib/domain/asset-pack-presentation.js'
const {createStageResourceOwner,stageAvatarBitmap,stageAvatarCap,getStageAvatarCrop} = createRequire(import.meta.url)('../tavern-plugin/src/client/fork-stage-resources.cjs')
const playback = await readFile(new URL('../tavern-plugin/src/client/fork-pack-playback.cjs',import.meta.url),'utf8')
const cacheSource = await readFile(new URL('../tavern-plugin/src/client/fork-avatar-cache.cjs',import.meta.url),'utf8')
const crop = {x:0.3,y:0.02,w:0.4,h:0.2}
const descriptor = {resource:true,kind:'media',identity:'figure:body',ref:{packId:'pack',figureId:'figure'},revision:'r1',hash:'body',crop}
function canvasFixture({fail=false}={}) {
  const draws=[],targets=[]
  const canvas=()=>{
    const context={drawImage:(...args)=>draws.push(args)}
    const target={getContext:()=>context,toBlob:fn=>fn(fail?null:new Blob(['crop'],{type:'image/png'}))}
    targets.push(target);return target
  }
  return {canvas,draws,targets}
}
function fixture({bitmap,block,fail=false,maxBytes}={}) {
  const images=[],revoked=[],blobs=new Map(),releases=[],raster=canvasFixture({fail})
  let serial=0
  const owner=createStageResourceOwner({maxBytes,
    service:{leaseMedia:async()=>({url:'/body',revision:'r1',ticket:++serial}),releaseLease:ticket=>releases.push(ticket)},
    fetch:async()=>new Response('compressed full sprite',{headers:{'content-type':'image/png'}}),
    urls:{createObjectURL:blob=>{const url='blob:test-'+(++serial);blobs.set(url,blob);return url},revokeObjectURL:url=>{revoked.push(url);blobs.delete(url)}},
    decode:async(_blob,url)=>{const image={width:2048,height:4096,src:url,closed:0,close(){this.closed++}};images.push(image);return image},
    avatarBitmap:async(image,value)=>{await block?.();return bitmap?bitmap(image,value):stageAvatarBitmap(image,value,raster.canvas,512)}
  })
  return {owner,images,revoked,blobs,releases,raster}
}
const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-8,`${actual} != ${expected}`)
test('presentation and frozen replay mark avatar resources without cropping stage textures',async()=>{
  const pack=await syntheticPack()
  const service={apiVersion:2,subscribe:()=>()=>{},getPackSnapshot:async()=>({...pack,revision:'r1'}),
    resolveFigures:async({refs})=>refs.map(ref=>({ref,value:pack.figures[ref.figureId],revision:'r1',diagnostics:[]}))}
  const presentation=createAssetPackPresentation({raw:{extensions:{dsh_tavern:cardExtension()}},getService:()=>service})
  try {
    const figure=await presentation.character('actor'),frame=await presentation.materialize(figure,{descriptors:true})
    assert.deepEqual(frame.avatarUrl.crop,frame.avatarCrop)
    assert.deepEqual(frame.media.avatar.url,frame.avatarUrl)
    assert.ok(Object.values(frame.spriteUrls).every(value=>!Object.hasOwn(value,'crop')))
    const replay=await presentation.frozen(frame)
    assert.deepEqual(replay.avatarUrl.crop,frame.avatarCrop)
    assert.deepEqual(replay.media.avatar.url,replay.avatarUrl)
    const dedicated={ref:frame.ref,avatarUrl:{...frame.avatarUrl},media:{avatar:frame.media.avatar}}
    delete dedicated.avatarUrl.crop
    const historical=await presentation.frozen(dedicated)
    assert.equal(historical.avatarUrl.crop,null)
    assert.equal(historical.media.avatar.url.crop,null)
    pack.figures[FIGURE_ID].outfits.unshift({key:'model-only',label:'Model',enabled:true,live2d:pack.figures[FIGURE_ID].outfits[1].live2d})
    presentation.refresh()
    const model=await presentation.materialize(await presentation.character('actor'),{descriptors:true})
    assert.ok(model.modelUrl)
    assert.ok(!Object.hasOwn(model.modelUrl,'crop'))
    assert.equal(model.avatarUrl,null,'Live2D-only outfit cannot borrow another outfit avatar')
    assert.equal(model.avatarCrop,null)
  } finally { presentation.dispose() }
})
test('cap covers the largest CSS face at DPR 1, 2 and 3; square avatars retain cap squared RGBA, not sprite bytes',async()=>{
  for(const dpr of [1,2,3]) assert.ok(stageAvatarCap(dpr)>=342.45*dpr)
  assert.equal(stageAvatarCap(1),512);assert.equal(stageAvatarCap(2),768)
  const h=fixture(),pin=await h.owner.acquire({...descriptor,crop:{x:0,y:0.75,w:0.5,h:0.25}},'session')
  const row=h.owner.debug().resources[0]
  assert.equal(row.decodedBytes,512*512*4)
  assert.equal(row.bytes,512*512*4+4)
  assert.equal(h.images[0].closed,1,'full decode closed before publishing')
  assert.equal(h.blobs.size,1,'only the derived blob remains')
  assert.equal(h.raster.targets[0].width,0,'canvas backing store released')
  assert.ok(h.revoked.includes(h.images[0].src))
  assert.deepEqual(getStageAvatarCrop(pin.handle.url),{x:0,y:0,w:1,h:1})
  h.owner.dispose();assert.equal(getStageAvatarCrop(pin.handle.url),undefined)
  assert.equal(h.owner.snapshot().bytes,0)
})
test('source region keeps all left overflow and the visible bottom letterbox with identical crop geometry',async()=>{
  const ctx={};vm.runInNewContext(playback,ctx)
  for(const crop of [{x:0.3,y:0.02,w:0.4,h:0.2},{x:0.25,y:0.1,w:0.5,h:0.15},{x:0.1,y:0.05,w:0.3,h:0.25}]) {
    const raster=canvasFixture(),image={width:2048,height:4096}
    const result=await stageAvatarBitmap(image,crop,raster.canvas,512)
    const args=raster.draws[0].slice(1),side=Math.max(image.width*crop.w,image.height*crop.h)
    near(args[0],0);near(args[1],image.height*crop.y)
    near(args[2],image.width*(crop.x+crop.w))
    near(args[3],Math.min(image.height-args[1],image.height*crop.h+(side-image.height*crop.h)/2+side/4))
    const before=ctx.forkPackCropStyle(crop,image.width,image.height,true)
    const after=ctx.forkPackCropStyle(result.crop,result.width,result.height,true)
    // Compare all original crop corners in square-relative screen coordinates.
    for(const [axis,dimension,offset] of [['x','width','left'],['y','height','top']]) {
      const extent=axis==='x'?'w':'h'
      near(parseFloat(before[offset])+parseFloat(before[dimension])*crop[axis],parseFloat(after[offset])+parseFloat(after[dimension])*result.crop[axis])
      near(parseFloat(before[dimension])*crop[extent],parseFloat(after[dimension])*result.crop[extent])
    }
    assert.match(after.clipPath,/^inset\(0% [^ ]+% 0% 0%\)$/)
    assert.ok(Math.abs(parseFloat(after.clipPath.split(' ')[1]))<0.2,'right cut only removes subpixel canvas rounding')
  }
})
test('dedicated non-crop avatars downscale aspect-preservingly without upscaling small images',async()=>{
  const raster=canvasFixture()
  for(const [width,height,outWidth,outHeight] of [[2048,1024,512,256],[64,96,64,96]]) {
    const result=await stageAvatarBitmap({width,height},null,raster.canvas,512)
    assert.equal(result.width,outWidth);assert.equal(result.height,outHeight)
    assert.deepEqual(result.crop,{x:0,y:0,w:1,h:1})
  }
})
test('dedicated avatar resources use the same owner cap and HTML-image fallback drops its full source',async()=>{
  const h=fixture({bitmap:async(image,crop)=>{
    delete image.close
    return stageAvatarBitmap(image,crop,canvasFixture().canvas,512)
  }})
  const pin=await h.owner.acquire({...descriptor,crop:null},'session')
  const row=h.owner.debug().resources[0]
  assert.equal(row.decodedBytes,256*512*4)
  assert.equal(row.bytes,256*512*4+4)
  assert.equal(h.images[0].src,'')
  assert.equal(h.blobs.size,1)
  assert.deepEqual(getStageAvatarCrop(pin.handle.url),{x:0,y:0,w:1,h:1})
  h.owner.dispose()
})
test('prefetch and source renewals reuse cropped bytes; stage sprite and differing crops stay independent',async()=>{
  const h=fixture(),{crop:ignored,...sprite}=descriptor
  const prepared=await h.owner.prepare({avatar:descriptor,duplicate:descriptor,stage:sprite},'session',{prefetch:true})
  assert.equal(prepared.value.avatar,prepared.value.duplicate)
  assert.notEqual(prepared.value.avatar,prepared.value.stage)
  assert.equal(h.owner.snapshot().items,2)
  assert.equal(h.images[0].closed,1);assert.equal(h.images[1].closed,0,'stage decode is still pinned')
  assert.ok(h.owner.isPrepared(descriptor,'session'))
  assert.ok(!h.owner.isPrepared({...descriptor,crop:{...crop,x:0.2}},'session'))
  const again=await h.owner.acquire(descriptor,'session')
  // private fork: retain both the stage decode and the derived avatar decode.
  assert.equal(again.handle.url,prepared.value.avatar);assert.equal(h.images.length,3)
  await h.owner.renew(descriptor.identity,'session');assert.equal(h.images.length,3)
  prepared.release();again.release()
  const revisit=await h.owner.acquire(descriptor,'session');revisit.release()
  assert.equal(h.images.length,3,'unpinned revisit does not re-decode the crop')
  const other=await h.owner.acquire({...descriptor,crop:{...crop,x:0.2}},'session')
  assert.notEqual(other.handle.url,again.handle.url)
  const rows=h.owner.debug().resources
  assert.equal(rows.find(row=>!row.avatar).decodedBytes,2048*4096*4)
  assert.ok(rows.filter(row=>row.avatar).every(row=>row.decodedBytes<3*1024**2))
  prepared.release();again.release();other.release();h.owner.dispose()
  assert.equal(h.images[1].closed,1)
  assert.equal(h.images[2].closed,1,'derived avatar decode is released at owner disposal')
})
test('encoding failure, budget rejection and late revocation release the full decode and temporary URL',async()=>{
  for(const options of [{fail:true},{maxBytes:30}]) {
    const h=fixture(options)
    await assert.rejects(h.owner.acquire(descriptor,'session'))
    assert.equal(h.images[0].closed,1);assert.equal(h.blobs.size,0)
    assert.equal(h.owner.snapshot().bytes,0)
  }
  let finish,started
  const ready=new Promise(resolve=>{started=resolve})
  const h=fixture({block:()=>{started();return new Promise(resolve=>{finish=resolve})}})
  const pending=h.owner.acquire(descriptor,'session');await ready
  h.owner.revoke({authority:true});finish()
  await assert.rejects(pending,/RESOURCE_REVOKED/)
  assert.equal(h.images[0].closed,1);assert.equal(h.blobs.size,0)
  assert.equal(h.owner.snapshot().bytes,0)
})
test('square cache consumes the remapped crop, while overflow renderer keeps the derived source',async()=>{
  const h=fixture(),pin=await h.owner.acquire(descriptor,'session'),remapped=getStageAvatarCrop(pin.handle.url)
  const raster=canvasFixture(),row=h.owner.debug().resources[0]
  const width=Math.ceil(2048*(crop.x+crop.w)*512/(2048*crop.w)),height=640
  assert.equal(row.decodedBytes,width*height*4)
  const ctx={getStageAvatarCrop,URL:{createObjectURL:()=> 'blob:thumb',revokeObjectURL(){}},
    React:{useRef:current=>({current}),useState:current=>[current,()=>{}],useEffect(){},useSyncExternalStore:(_s,get)=>get(),createElement:(type,props,...children)=>({type,props,children})}}
  vm.runInNewContext(cacheSource+'\n'+playback,ctx)
  const cache=ctx.createForkAvatarCache({canvas:raster.canvas,urls:ctx.URL})
  cache.select('session');cache.revision('pack','r1')
  const avatar={...descriptor,sessionId:'session'}
  await cache.prepare(avatar,pin.handle.url,64,2,{naturalWidth:width,naturalHeight:height})
  near(raster.draws[0][1],width*remapped.x)
  near(raster.draws[0][3],width*remapped.w)
  near(raster.draws[0][4],height*remapped.h)
  const image=ctx.ForkPackImage({src:pin.handle.url,identity:descriptor.identity,crop,avatar,cropOverflow:true})
  assert.equal(image.children[0].props.src,pin.handle.url)
  assert.deepEqual(JSON.parse(image.props['data-avatar-crop']),remapped)
  cache.clear();h.owner.dispose()
})
