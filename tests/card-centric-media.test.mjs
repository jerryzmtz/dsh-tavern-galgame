// private fork: in-memory synthetic media only; no real card data or cleanup.
import test from 'node:test'
import assert from 'node:assert/strict'
import { syntheticPack, FIGURE_ID } from './fixtures/asset-packs/pack.mjs'
import { createSimpleSprite } from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/simple-sprite.js'
import { copyFigureAssets } from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/copy-figure.js'
import { sealPack, verifyBytes, PACK_LIMITS } from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/validation.js'

test('single uploaded PNG becomes a valid mouthless layered sprite; emotion images are optional', async () => {
  const pack = await syntheticPack()
  const hash = Object.keys(pack.manifest.blobs).find(hash => pack.manifest.blobs[hash].ext === 'png')
  const image = {hash,width:8,height:8}
  // private fork: missing calm is allowed; legacy default and invalid dimensions are rejected.
  const one = createSimpleSprite({images:{calm:image}}, pack.manifest.blobs)
  assert.equal(one.manifest.defaultState, undefined)
  assert.deepEqual(Object.keys(one.manifest.emotions), ['calm'])
  assert.equal(one.manifest.mouthAtlas, undefined)
  assert.equal(Object.keys(createSimpleSprite({images:{calm:image, joy:image}},pack.manifest.blobs).manifest.emotions).length,2)
  assert.doesNotThrow(() => createSimpleSprite({images:{joy:image}},pack.manifest.blobs))
  assert.throws(() => createSimpleSprite({images:{default:image}},pack.manifest.blobs))
  assert.throws(() => createSimpleSprite({images:{calm:{...image,width:0}}},pack.manifest.blobs))
})

test('copy one figure preserves sprites, mouths, avatars, Live2D and voice reference text', async () => {
  const source = await syntheticPack(), target = await syntheticPack()
  const original = structuredClone(source.manifest), figure = structuredClone(source.figures[FIGURE_ID])
  for (const [hash,descriptor] of Object.entries(target.manifest.blobs)) target.manifest.blobs[hash] = Object.fromEntries(Object.entries(descriptor).reverse())
  const copied = copyFigureAssets(source, FIGURE_ID, target.manifest, target.files)
  await sealPack(target.manifest,target.files)
  const verified = await verifyBytes(target.manifest,target.files,{limits:PACK_LIMITS})
  const next = verified.figures[copied.figureId]
  assert.notEqual(next.id,FIGURE_ID)
  assert.equal(next.outfits.length,2)
  assert.notEqual(next.outfits[0].sprite.manifestKey,figure.outfits[0].sprite.manifestKey)
  assert.deepEqual(verified.sprites[next.outfits[0].sprite.manifestKey],source.sprites.school)
  assert.deepEqual(next.outfits[0].avatars,figure.outfits[0].avatars)
  assert.notEqual(next.outfits[1].live2d.bundleKey,figure.outfits[1].live2d.bundleKey)
  // private fork: copy the embedded preset and its audio closure, not textFile indirection.
  assert.deepEqual(verified.manifest.voiceLibrary.voices[next.voice.voice],source.manifest.voiceLibrary.voices[figure.voice.voice])
  const hash=verified.manifest.voiceLibrary.voices[next.voice.voice].sources.fish.references[1].media
  assert.deepEqual(target.files.get(`media/${hash}.wav`),source.files.get(`media/${hash}.wav`))
  assert.deepEqual(source.manifest, original)
  assert.deepEqual(source.figures[FIGURE_ID],figure)
})

import { selectPackFigure } from '../tavern-plugin/lib/domain/asset-pack-presentation.js'
import { assertJson } from '../tavern-plugin/packages/dsh-presentation-protocol/src/asset-pack-json.js'
test('uploaded calm avatar wins over crop without requiring emotion sprites', async () => {
  const pack = await syntheticPack(), figure = pack.figures[FIGURE_ID], outfit = figure.outfits[0]
  outfit.avatars.calm = outfit.avatars.joy
  const selected = selectPackFigure(figure,pack.sprites,{emotion:'anger'})
  assert.equal(selected.avatar,outfit.avatars.calm)
  assert.equal(selected.avatarCrop,null)
  delete outfit.avatars
  const cropped = selectPackFigure(figure,pack.sprites,{emotion:'anger'})
  assert.equal(cropped.avatar,outfit.sprite.assets['assets/stage.png'])
  assert.deepEqual(cropped.avatarCrop,{x:0.3,y:0,w:0.4,h:0.21})
  const live = structuredClone(figure.outfits[1]); delete live.sprite
  live.avatars = {calm:pack.manifest.assets[0].variants.entries[0].content.media}
  const liveAvatar = selectPackFigure({...figure,outfits:[live]},pack.sprites,{emotion:'anger'})
  assert.equal(liveAvatar.avatar,live.avatars.calm)
  assert.doesNotThrow(() => assertJson(liveAvatar.avatarSource))
})