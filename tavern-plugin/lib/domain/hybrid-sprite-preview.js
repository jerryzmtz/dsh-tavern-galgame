import {spriteResourcePaths} from '../../packages/dsh-asset-library/lib/asset-packs/sprite.js'
import hybrid from '../../packages/dsh-asset-library/lib/shared/hybrid-sprite.cjs'
import {decodeAssetRgba,encodeAssetRgba} from './asset-image-processing.js'
export async function bakeHybridPreviews(manifest,readSource,prefix='baked-rest') {
  const files=new Map(),used=new Set([...Object.values(manifest.rigs).flatMap(rig=>Object.values(rig.parts).map(p=>p.src)),...Object.values(manifest.emotions).filter(e=>e.render.kind==='whole').flatMap(e=>spriteResourcePaths(e.render.legacy))])
  for(const [emotion,{render:r}]of Object.entries(manifest.emotions))if(r.kind==='parts') {
    delete r.preview;delete r.previewRevision
    if(!hybrid.resolveHybridSprite(manifest,emotion).available)continue
    const preview=await composeHybridPreview(manifest,emotion,readSource),src=prefix+'/'+emotion+'.png'
    if(used.has(src))throw Object.assign(new Error('Reserved rest-preview path is used by a part or whole image'),{code:'INVALID_ARGUMENT'})
    r.preview=src;r.previewRevision=preview.revision;files.set(src,preview.bytes)
  }
  return files
}
// Original-canvas source-over. Preview is evidence, never approval or a substitute for missing parts.
export async function composeHybridPreview(manifest,emotion,readSource,frames={}) {
  const render=hybrid.resolveHybridSprite(manifest,emotion,frames)
  if(!render.available)throw Object.assign(new Error('Layered difference is missing'),{code:'MISSING_DEPENDENCY',missing:render.missing})
  if(render.kind!=='parts')throw Object.assign(new Error('Select a layered difference'),{code:'INVALID_ARGUMENT'})
  const [width,height]=render.canvas,data=new Uint8ClampedArray(width*height*4)
  for(const part of render.layers) {
    const image=decodeAssetRgba(await readSource(part.src)),[dx,dy]=part.rect
    for (const rect of [part.clearRect,part.replaceRect].filter(Boolean)) {
      const [x,y,w,h]=rect
      for(let row=y;row<y+h;row++)data.fill(0,(row*width+x)*4,(row*width+x+w)*4)
    }
    for(let y=0;y<image.height;y++)for(let x=0;x<image.width;x++) {
      const s=(y*image.width+x)*4,d=((dy+y)*width+dx+x)*4,a=image.data[s+3]/255,b=data[d+3]/255,total=a+b*(1-a)
      if(!a)continue
      for(let c=0;c<3;c++)data[d+c]=Math.round((image.data[s+c]*a+data[d+c]*b*(1-a))/total)
      data[d+3]=Math.round(total*255)
    }
  }
  return {bytes:encodeAssetRgba({width,height,data}),revision:render.revision,width,height}
}
