import {randomUUID} from 'node:crypto'
import {check} from '../asset-packs/common.js'
import {spriteResourcePaths} from '../asset-packs/sprite.js'
import {jsonBytes} from './validation.js'
import {trimAuthoringImages} from './image-closure.js'

// A custom declaration and all its figure-owned uses retire in the same publication.
export function removeFigureEmotion(manifest, files, before, figureId, emotionId) {
  const original = before.figures[figureId]
  check(original, '$.figureId', 'Figure missing', 'ASSET_UNAVAILABLE')
  check(original.emotions?.some(row => row.id === emotionId), '$.emotionId', 'Difference missing', 'ASSET_UNAVAILABLE')
  const figure = structuredClone(original), rewritten = new Map()
  figure.emotions = figure.emotions.filter(row => row.id !== emotionId)
  if (figure.voice?.emotionVariants) delete figure.voice.emotionVariants[emotionId]
  for (const outfit of figure.outfits) {
    if(outfit.defaultEmotion===emotionId) delete outfit.defaultEmotion
    if(outfit.fallbackEmotions) outfit.fallbackEmotions=outfit.fallbackEmotions.filter(id=>id!==emotionId && id!==(outfit.defaultEmotion ?? figure.emotions[0]?.id))
    // private fork (gen-ui r12): a stand-in, a default prompt or a record of the retired 差分 goes with it.
    if(outfit.fallbackTo) { outfit.fallbackTo=Object.fromEntries(Object.entries(outfit.fallbackTo).filter(([id,use])=>use!==emotionId && outfit.fallbackEmotions?.includes(id))); if(!Object.keys(outfit.fallbackTo).length) delete outfit.fallbackTo }
    if(outfit.genPrompts) { for(const map of Object.values(outfit.genPrompts)) delete map[emotionId]; for(const kind of Object.keys(outfit.genPrompts)) if(!Object.keys(outfit.genPrompts[kind]).length) delete outfit.genPrompts[kind]; if(!Object.keys(outfit.genPrompts).length) delete outfit.genPrompts }
    if(outfit.genRecords) { outfit.genRecords=outfit.genRecords.filter(row=>row.emotionId!==emotionId); if(!outfit.genRecords.length) delete outfit.genRecords }
    if (outfit.avatars) delete outfit.avatars[emotionId]
    if (outfit.live2d?.emotionMap) delete outfit.live2d.emotionMap[emotionId]
    if (outfit.spine?.emotionMap) delete outfit.spine.emotionMap[emotionId]
    if (!outfit.sprite) continue
    const oldKey = outfit.sprite.manifestKey
    if (!Object.hasOwn(before.sprites[oldKey].emotions, emotionId)) continue
    if (!rewritten.has(oldKey)) {
      const sprite = structuredClone(before.sprites[oldKey])
      delete sprite.emotions[emotionId]
      const entries = Object.values(sprite.emotions)
      if (!entries.length) rewritten.set(oldKey, null)
      else {
        const sets = new Set(entries.flatMap(entry => [entry.mouthSet, entry.binding?.mouth?.set]).filter(key => key !== undefined))
        for (const library of [sprite.mouthSets, sprite.rig?.mouthSets]) if (library) for (const key of Object.keys(library)) if (!sets.has(key)) delete library[key]
        if (sprite.mouthSets && !Object.keys(sprite.mouthSets).length) delete sprite.mouthSets
        if (sprite.rig && !Object.keys(sprite.rig.mouthSets).length) delete sprite.rig
        if (sprite.mouthAtlas && entries.every(entry => entry.mouthSet !== undefined)) delete sprite.mouthAtlas
        // Other figures may share a manifest; never rewrite their vocabulary or renderer.
        const shared = Object.values(before.figures).some(other => other.id !== figureId && other.outfits.some(o => o.sprite?.manifestKey === oldKey))
        const key = shared ? 'sprite-' + randomUUID() : oldKey
        manifest.sprites[key] ||= 'sprites/' + key + '/manifest.json'
        files.set(manifest.sprites[key], jsonBytes(sprite))
        rewritten.set(oldKey, {key, resources:new Set(spriteResourcePaths(sprite))})
      }
    }
    const next = rewritten.get(oldKey)
    if (!next) { delete outfit.sprite; continue }
    outfit.sprite.manifestKey = next.key
    outfit.sprite.assets = Object.fromEntries(Object.entries(outfit.sprite.assets).filter(([resource]) => next.resources.has(resource)))
    for (const key of ['avatarCrop','avatarCropAuto','anatomy']) if (outfit.sprite[key]) delete outfit.sprite[key][emotionId]
  }
  files.set('figures/' + figureId + '.json', jsonBytes(figure))
  trimAuthoringImages(manifest, files, before.figures)
}
