import {check, shape, validateShortId, validateStateId} from '../asset-packs/common.js'
import {spriteResourcePaths} from '../asset-packs/sprite.js'
import {clearHybridPreviews} from '../asset-packs/hybrid-closure.js'
import {jsonBytes} from './validation.js'
export function layeredTarget(before, input) {
  const figure = structuredClone(before.figures[input.figureId])
  check(figure, '$.figureId', 'Figure missing', 'ASSET_UNAVAILABLE')
  const outfit = figure.outfits.find(o => o.key === input.outfitKey)
  check(outfit, '$.outfitKey', 'Outfit missing', 'ASSET_UNAVAILABLE')
  return {figure, outfit, sprite:structuredClone(before.sprites[outfit.sprite?.manifestKey])}
}
export function layeredInput(input, extra, required = extra) {
  const common = ['packId','expectedRevision','figureId','outfitKey']
  shape(input,[...common,...extra],[...common,...required],'$')
}
export function assertUnsharedLayered(before,input) {
  const key=before.figures[input.figureId]?.outfits.find(o=>o.key===input.outfitKey)?.sprite?.manifestKey
  if (key) check(!Object.values(before.figures).some(f=>f.outfits.some(o=>o.sprite?.manifestKey===key&&(f.id!==input.figureId||o.key!==input.outfitKey))),'$.outfitKey','Shared sprite must be explicitly separated before editing')
}
export function saveLayered(manifest, files, target, sprite, spriteKey, assets) {
  validateShortId(spriteKey)
  const used = new Set(spriteResourcePaths(sprite))
  target.outfit.sprite = {...target.outfit.sprite, manifestKey:spriteKey, assets:Object.fromEntries(Object.entries(assets).filter(([src]) => used.has(src)))}
  const file = `sprites/${spriteKey}/manifest.json`
  manifest.sprites[spriteKey] = file
  files.set(file,jsonBytes(sprite)); files.set(`figures/${target.figure.id}.json`,jsonBytes(target.figure))
}
export function editLayeredPart(manifest, files, before, input, remove = false) {
  assertUnsharedLayered(before,input)
  const target = layeredTarget(before,input), sprite = target.sprite
  check(sprite?.kind === 'hybrid-face-sprites','$.outfitKey','Layered outfit required')
  validateStateId(input.rigId); validateStateId(input.partId)
  const rig = sprite.rigs[input.rigId]
  check(rig,'$.rigId','Rig missing','ASSET_UNAVAILABLE')
  const previous = rig.parts[input.partId], assets = {...target.outfit.sprite.assets}
  if (remove) {
    check(previous,'$.partId','Part missing','ASSET_UNAVAILABLE')
    if (previous.group === 'underlay') rig.baseRevision++
    delete rig.parts[input.partId]
  } else {
    const part = structuredClone(input.part)
    check(part?.revision === (previous?.revision || 0)+1,'$.part.revision','Part version changed','REVISION_CONFLICT')
    if (previous) check(previous.group === part.group,'$.part.group','Cannot change part group')
    if (part.group === 'underlay' && previous) {
      check(part.baseRevision === rig.baseRevision+1,'$.part.baseRevision','Base version must increment','REVISION_CONFLICT')
      rig.baseRevision = part.baseRevision
    } else check(part.baseRevision === rig.baseRevision,'$.part.baseRevision','Base version changed','REVISION_CONFLICT')
    check(manifest.blobs[input.hash]?.ext === 'png','$.hash','Existing PNG blob required')
    for (const [rigId,otherRig] of Object.entries(sprite.rigs)) for (const [id,other] of Object.entries(otherRig.parts)) if (rigId !== input.rigId || id !== input.partId) check(other.src !== part.src,'$.part.src','Part paths must be distinct')
    for (const entry of Object.values(sprite.emotions)) if (entry.render.kind === 'whole') check(!spriteResourcePaths(entry.render.legacy).includes(part.src),'$.part.src','Part path is used by a whole image')
    rig.parts[input.partId] = part; assets[part.src] = input.hash
  }
  for (const recipe of Object.values(rig.recipes)) if ([...Object.values(recipe.selection),...Object.values(recipe.mouthFrames || {}),...Object.values(recipe.blinkFrames || {})].includes(input.partId)) recipe.revision++
  clearHybridPreviews(sprite,input.rigId)
  saveLayered(manifest,files,target,sprite,target.outfit.sprite.manifestKey,assets)
}
