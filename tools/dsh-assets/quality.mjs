import path from 'node:path'
import {readFile} from 'node:fs/promises'
import {measureMouthOpening} from '../../tavern-plugin/lib/domain/asset-production-quality.js'
import {checkAvatarFraming} from '../../tavern-plugin/lib/domain/avatar-framing.js'
import {productionError} from '../../tavern-plugin/lib/domain/asset-production-project.js'
const json=async file=>JSON.parse(await readFile(file,'utf8'))
export async function checkAvatar({file,geometry,reference,referenceGeometry}) {
  const result=checkAvatarFraming(await readFile(file),geometry?await json(geometry):{})
  if(reference){if(!referenceGeometry)throw productionError('INVALID_ARGUMENT','--reference requires --reference-geometry');result.reference={file:reference,...checkAvatarFraming(await readFile(reference),await json(referenceGeometry))}}
  else if(referenceGeometry)throw productionError('INVALID_ARGUMENT','--reference-geometry requires --reference')
  return {file,...result,reviewOnly:true,installReady:false}
}
export async function orderMouth({files,order,geometry}) {
  const labels=['closed','small','mid','open'],names=await json(files)
  if(!Array.isArray(names)||names.length!==4||!names.every(s=>typeof s==='string'&&s.length)||new Set(names).size!==4)throw productionError('INVALID_ARGUMENT','--files JSON must list four distinct PNG paths in source order')
  if(order!==undefined&&order!==labels.join(','))throw productionError('INVALID_ARGUMENT','--order must be closed,small,mid,open')
  const settings=geometry?await json(geometry):{},rows=[]
  for(const [index,name]of names.entries()) {const file=path.resolve(path.dirname(path.resolve(files)),name);rows.push({file,sourceIndex:index,measurement:measureMouthOpening(await readFile(file),settings)})}
  const compare=(a,b)=>a.measurement.opening-b.measurement.opening||a.measurement.area-b.measurement.area,sorted=[...rows].sort(compare),warnings=rows.flatMap(r=>r.measurement.warnings),monotonic=rows.every((r,i)=>!i||compare(rows[i-1],r)<=0),confident=rows.every(r=>r.measurement.confident)
  if(order&&!monotonic)warnings.push({code:'MOUTH_ORDER_DISAGREES',severity:'warning',symbol:'\u26a0',message:'Explicit file order retained; measured aperture height/area disagrees. No silent reorder.'})
  if(!order&&confident&&!monotonic)warnings.push({code:'MOUTH_RELABELLED',severity:'warning',symbol:'\u26a0',message:'Output mapping sorted by skin-distance/lip-boundary aperture height then area; source files unchanged.'})
  if(rows.some((r,i)=>i&&compare(rows[i-1],r)===0))warnings.push({code:'MOUTH_OPENING_AMBIGUOUS',severity:'warning',symbol:'\u26a0',message:'Apertures tie; inspect mouth crop and skin reference manually.'})
  return {order:order||'automatic',monotonic,confident,frames:(order||!confident?rows:sorted).map((r,i)=>({frame:labels[i],...r})),warnings,modified:false}
}
