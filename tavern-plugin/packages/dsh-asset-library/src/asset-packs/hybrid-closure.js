// Pure runtime projection: drafts stay in authoring, missing references stay explicit.
export function clearHybridPreviews(manifest,rigId) {
  for(const {render:r}of Object.values(manifest.emotions))if(r.kind==='parts'&&(rigId===undefined||r.rig===rigId)){delete r.preview;delete r.previewRevision}
}
export function hybridRuntimeClosure(value) {
  if(value.kind!=='hybrid-face-sprites')return structuredClone(value)
  const result=structuredClone(value),rigs=new Map()
  for(const {render:r} of Object.values(result.emotions))if(r.kind==='parts') {
    if(!rigs.has(r.rig))rigs.set(r.rig,new Set())
    rigs.get(r.rig).add(r.recipe)
  }
  for(const [id,rig] of Object.entries(result.rigs)) {
    if(!rigs.has(id)){delete result.rigs[id];continue}
    const used=new Set()
    for(const [key,recipe] of Object.entries(rig.recipes)) {
      if(!rigs.get(id).has(key)){delete rig.recipes[key];continue}
      for(const part of [...Object.values(recipe.selection),...Object.values(recipe.mouthFrames||{}),...Object.values(recipe.blinkFrames||{})])if(part!=='none')used.add(part)
    }
    for(const key of Object.keys(rig.parts))if(!used.has(key))delete rig.parts[key]
  }
  return result
}
