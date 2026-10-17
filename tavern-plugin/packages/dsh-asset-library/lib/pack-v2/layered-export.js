import {hybridRuntimeClosure} from '../asset-packs/hybrid-closure.js'
import {spriteResourcePaths} from '../asset-packs/sprite.js'
import {trimAuthoringImages} from './image-closure.js'
import {jsonBytes,sealPack} from './validation.js'
export async function layeredExport(pack) {
  const projected=new Map()
  for(const [key,sprite]of Object.entries(pack.sprites))if(sprite.kind==='hybrid-face-sprites') {
    const next=hybridRuntimeClosure(sprite)
    if(JSON.stringify(next)!==JSON.stringify(sprite))projected.set(key,next)
  }
  if(!projected.size)return pack
  const manifest=structuredClone(pack.manifest),files=new Map(pack.files),figures=structuredClone(pack.figures),sprites={...pack.sprites}
  for(const [key,next]of projected) {
    sprites[key]=next;files.set(manifest.sprites[key],jsonBytes(next));const used=new Set(spriteResourcePaths(next))
    for(const figure of Object.values(figures))for(const outfit of figure.outfits)if(outfit.sprite?.manifestKey===key) {
      outfit.sprite.assets=Object.fromEntries(Object.entries(outfit.sprite.assets).filter(([src])=>used.has(src)))
      files.set('figures/'+figure.id+'.json',jsonBytes(figure))
    }
  }
  trimAuthoringImages(manifest,files,figures);await sealPack(manifest,files,pack)
  return {...pack,manifest,files,figures,sprites}
}
