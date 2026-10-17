// Pixel-only edit canvases; all public geometry remains in full-source coordinates.
import {decodeAssetRgba,encodeAssetRgba} from '../../tavern-plugin/lib/domain/asset-image-processing.js'
import {extractEyeRegion} from '../../tavern-plugin/lib/domain/asset-production-quality.js'
import {extractProductionPatch} from '../../tavern-plugin/lib/domain/asset-production-images.js'
const sizes=[[1024,1536],[1536,1024]]
const nativeSizes=[[1024,1024],...sizes,[1254,1254]]
const fail=message=>{throw Object.assign(new Error(message),{code:'PRECONDITION'})}
export function chooseEditWindow(source,kind,{geometry,rect}={}) {
  if(nativeSizes.some(([w,h])=>source.width===w&&source.height===h))return null
  const regions=kind==='mouth'?[rect].filter(Boolean):[geometry?.headRect,geometry?.eyeRect].filter(Boolean)
  if(kind==='blink')for(const polygon of [...geometry?.eyeMasks||[],...geometry?.tearMasks||[]]) {
    const xs=polygon.map(p=>p[0]),ys=polygon.map(p=>p[1])
    regions.push([Math.min(...xs),Math.min(...ys),Math.max(...xs)-Math.min(...xs),Math.max(...ys)-Math.min(...ys)])
  }
  if(!regions.length||kind==='blink'&&(!geometry?.headRect||!geometry?.eyeRect&&!geometry?.eyeMasks))fail('Odd-size source: supply prompt/refresh-plan --geometry FILE for blink or --rect x,y,w,h for mouth, measured on the full source')
  for(const r of regions)if(!Array.isArray(r)||r.length!==4||!r.every(Number.isInteger)||r[0]<0||r[1]<0||r[2]<=0||r[3]<=0||r[0]+r[2]>source.width||r[1]+r[3]>source.height)fail('Edit ROI and head geometry must use integer pixels inside the full source')
  const margin=32,left=Math.min(...regions.map(r=>r[0]))-margin,top=Math.min(...regions.map(r=>r[1]))-margin,right=Math.max(...regions.map(r=>r[0]+r[2]))+margin,bottom=Math.max(...regions.map(r=>r[1]+r[3]))+margin
  // Minimize padding while keeping the complete measured region and margin inside.
  const origin=(lo,hi,size,extent)=>Math.max(hi-size,Math.min(lo,Math.max(Math.min(0,extent-size),Math.min(Math.max(0,extent-size),Math.floor((lo+hi-size)/2)))))
  const candidates=sizes.filter(([w,h])=>w>=right-left&&h>=bottom-top).map(([width,height])=>{
    const x=origin(left,right,width,source.width),y=origin(top,bottom,height,source.height)
    const overlap=Math.max(0,Math.min(source.width,x+width)-Math.max(0,x))*Math.max(0,Math.min(source.height,y+height)-Math.max(0,y))
    return {x,y,width,height,padding:width*height-overlap}
  }).sort((a,b)=>a.padding-b.padding)
  const size=candidates[0]
  if(!size)fail('Measured ROI plus 32px margin does not fit a supported model canvas; use a pixel-preserving full-source edit instead (never resize)')
  const {x,y,width,height}=size
  return {x,y,width,height,margin,source:{slot:source.slot,version:source.version,hash:source.hash},...(geometry?{geometry:structuredClone(geometry)}:{}),...(rect?{rect:[...rect]}:{})}
}
export function cropEditWindow(bytes,window) {
  const source=decodeAssetRgba(bytes),{x,y,width,height}=window,data=new Uint8ClampedArray(width*height*4)
  for(let row=Math.max(0,y);row<Math.min(source.height,y+height);row++) {
    const left=Math.max(0,x),right=Math.min(source.width,x+width)
    if(right>left)data.set(source.data.subarray((row*source.width+left)*4,(row*source.width+right)*4),((row-y)*width+left-x)*4)
  }
  return encodeAssetRgba({width,height,data})
}
export function extractWindowPatch(baseBytes,candidate,kind,window) {
  const image=decodeAssetRgba(candidate)
  if(image.width!==window.width||image.height!==window.height)fail(`Edit window requires exactly ${window.width}x${window.height}; received ${image.width}x${image.height}. Generate again using the plan crop reference and exact canvas; never resize/resample.`)
  const shift=r=>[r[0]-window.x,r[1]-window.y,r[2],r[3]],geometry=structuredClone(window.geometry)
  if(geometry) {
    for(const key of ['headRect','eyeRect'])if(geometry[key])geometry[key]=shift(geometry[key])
    for(const key of ['browBottom','hairBottom'])if(geometry[key]!==undefined)geometry[key]-=window.y
    for(const key of ['eyeMasks','tearMasks'])if(geometry[key])geometry[key]=geometry[key].map(p=>p.map(([x,y])=>[x-window.x,y-window.y]))
    if(geometry.mouthMask)geometry.mouthMask.core=geometry.mouthMask.core.map(p=>p.map(([x,y])=>[x-window.x,y-window.y]))
  }
  const base=cropEditWindow(baseBytes,window),result=kind==='blink'?extractEyeRegion(base,candidate,geometry):extractProductionPatch(base,candidate,kind,shift(window.rect),geometry)
  result.rect=[result.rect[0]+window.x,result.rect[1]+window.y,...result.rect.slice(2)]
  return result
}
