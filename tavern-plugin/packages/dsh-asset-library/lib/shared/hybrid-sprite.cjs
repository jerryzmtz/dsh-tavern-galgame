// Pure projection of manifests already validated at ingress. No filesystem or hashing.
const HYBRID_GROUPS = Object.freeze(['underlay', 'pose', 'face', 'mouth', 'front'])
function resolveHybridSprite(manifest, emotion, {mouthFrame, blinkFrame} = {}) {
  const render = manifest.emotions[emotion]?.render
  const missing = []
  const fail = (kind, id, code, group) => missing.push({kind, id, code, ...(group ? {group} : {})})
  const unavailable = () => ({kind:'missing', available:false, missing})
  if (!render || render.kind === 'missing') { fail('emotion', emotion, 'MISSING_EMOTION'); return unavailable() }
  if (render.kind === 'whole') return {kind:'whole', available:true, legacy:render.legacy}
  const rig = manifest.rigs[render.rig]
  if (!rig) { fail('rig', render.rig, 'MISSING_RIG'); return unavailable() }
  const recipe = rig.recipes[render.recipe]
  if (!recipe) { fail('recipe', render.recipe, 'MISSING_RECIPE'); return unavailable() }
  const selection = {...recipe.selection}
  // Optional animation never borrows from another emotion or hides a missing rest face.
  for (const group of HYBRID_GROUPS) {
    const id = selection[group], part = rig.parts[id]
    if (id === 'none') continue
    if (!part) fail('part', id, 'MISSING_PART', group)
    else if (part.baseRevision !== rig.baseRevision) fail('part', id, 'STALE_PART', group)
  }
  if (missing.length) return unavailable()
  const current=id=>id&&rig.parts[id]?.baseRevision===rig.baseRevision
  const requestedMouth=recipe.mouthFrames?.[mouthFrame]
  const mouth=current(requestedMouth)?requestedMouth:['closed','a','i','u','e','o'].includes(mouthFrame)&&current(recipe.mouthFrames?.closed)?recipe.mouthFrames.closed:undefined
  for (const [group, id] of [['mouth', mouth], ['face', recipe.blinkFrames?.[blinkFrame]]]) {
    if (id && rig.parts[id]?.baseRevision === rig.baseRevision) selection[group] = id
  }
  const layers = rig.drawOrder.filter(group => selection[group] !== 'none').map(group => ({id:selection[group], ...rig.parts[selection[group]]}))
  return {kind:'parts', available:true, canvas:rig.canvas, drawOrder:rig.drawOrder, layers,
    revision:JSON.stringify([render.rig, rig.baseRevision, render.recipe, recipe.revision, layers.map(p => [p.id,p.revision])])}
}
function hybridMissing(manifest) {
  const emotions = [], slots = new Map()
  for (const emotion of Object.keys(manifest.emotions)) {
    const result = resolveHybridSprite(manifest, emotion)
    if (result.available) continue
    emotions.push({emotion, missing:result.missing})
    for (const item of result.missing) {
      const rig = manifest.emotions[emotion].render.rig
      const key = JSON.stringify([rig,item.kind,item.id,item.code])
      if (!slots.has(key)) slots.set(key, {...item, ...(rig ? {rig} : {}), emotions:[]})
      slots.get(key).emotions.push(emotion)
    }
  }
  return {emotions, slots:[...slots.values()]}
}
module.exports = {HYBRID_GROUPS, resolveHybridSprite, hybridMissing}
