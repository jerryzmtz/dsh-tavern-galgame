import {check} from './common.js'
// Explicit conversion only. Ordinary reads never migrate or invent identities.
export function migrateFaceSprite(sprite, rigId, rig, recipes) {
  if (sprite.kind === 'hybrid-face-sprites') return {manifest:sprite,idempotent:true}
  check(['static-sprites','layered-static-sprites'].includes(sprite.kind),'$.kind','Only current whole sprites can migrate')
  for (const id of Object.keys(recipes)) check(Object.hasOwn(sprite.emotions,id),'$.emotions.'+id,'Migration cannot add a difference')
  const emotions={}
  for (const [id,entry] of Object.entries(sprite.emotions)) {
    if (Object.hasOwn(recipes,id)) {emotions[id]={render:{kind:'parts',rig:rigId,recipe:recipes[id]}};continue}
    const legacy=structuredClone(sprite);legacy.emotions={[id]:structuredClone(entry)}
    if (legacy.mouthSets) {
      legacy.mouthSets=Object.fromEntries(Object.entries(legacy.mouthSets).filter(([key])=>key===entry.mouthSet))
      if (!Object.keys(legacy.mouthSets).length) delete legacy.mouthSets
    }
    if (entry.mouthSet!==undefined) delete legacy.mouthAtlas
    if (legacy.rig) {
      legacy.rig.mouthSets=Object.fromEntries(Object.entries(legacy.rig.mouthSets).filter(([key])=>key===entry.binding?.mouth?.set))
      if (!Object.keys(legacy.rig.mouthSets).length) delete legacy.rig
    }
    emotions[id]={render:{kind:'whole',legacy}}
  }
  return {manifest:{kind:'hybrid-face-sprites',version:1,rigs:{[rigId]:structuredClone(rig)},emotions},idempotent:false}
}
