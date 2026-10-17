import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'
import { forkSpriteManifest, forkSpriteFrame, forkSpriteAssets, forkSpriteMapAssets } from '../tavern-plugin/src/client/fork-layered-sprite.cjs'
import { normalizeStagePortraits } from '../tavern-plugin/lib/domain/stage-portraits.js'
import { collectPortraitAssets, validatePortraitRigAssets } from '../tavern-plugin/lib/domain/stage-portrait-rig.js'
import { spriteFixture, spriteIndex } from './fixtures/fork-layered-sprite.mjs'
import { image, sha } from './fixtures/fork-mouth-rig.mjs'

function setOnly(source = 'assets/test.webp') {
  const raw = spriteFixture(source)
  raw.mouthSets = { approved: raw.mouthAtlas }
  delete raw.mouthAtlas
  for (const state of raw.states) state.mouthSet = 'approved'
  return raw
}

test('set-only packs support host revalidation, full asset closure and remapping', async () => {
  const pack = forkSpriteManifest(setOnly(sha), 'sha'), index = spriteIndex()
  index.portraits[0].spritePack = pack
  assert.equal(Object.hasOwn(pack, 'mouthAtlas'), false)
  assert.equal(forkSpriteFrame(pack, pack.states[3], 'a').id, 'tense_a')
  assert.deepEqual(normalizeStagePortraits(index).portraits[0].spritePack, pack)
  assert.deepEqual([...forkSpriteAssets(pack)], [[sha, [8, 8]]])
  assert.deepEqual(collectPortraitAssets(index.portraits[0]), [sha])
  assert.equal(forkSpriteMapAssets(pack, src => 'mapped/' + src).mouthSets.approved.src, 'mapped/' + sha)
  await validatePortraitRigAssets(index, async () => image)
  const raw = setOnly(); delete raw.states[0].mouthSet
  const staticPack = forkSpriteManifest(raw)
  assert.equal(forkSpriteFrame(staticPack, staticPack.states[0], 'a'), null)
  raw.states[0].mouthFrames = { a: 'a' }
  assert.throws(() => forkSpriteManifest(raw), 'Without an atlas no explicit frame may be referenced')
})

test('fractional view rectangles round x/y down and w/h up, clamp, and normalize idempotently', () => {
  const raw = spriteFixture()
  raw.states[0].stage.mouth = { x: 1.9, y: 2.8, w: 2.1, h: 1.2 }
  raw.states[0].portrait.mouthByFrame = { a: { x: 6.8, y: 7.2, w: 3.1, h: 2.1 } }
  const pack = forkSpriteManifest(raw)
  assert.deepEqual(pack.states[0].stage.mouth, { x: 1, y: 2, w: 3, h: 2 })
  assert.deepEqual(pack.states[0].portrait.mouthByFrame.a, { x: 6, y: 7, w: 2, h: 1 })
  assert.deepEqual(forkSpriteManifest(pack), pack)
})

for (const [name, edit] of [
  ['negative view origin', raw => raw.states[0].stage.mouth.x = -.1],
  ['NaN view extent', raw => raw.states[0].stage.mouth.w = NaN],
  ['infinite view origin', raw => raw.states[0].stage.mouth.y = Infinity],
  ['string view coordinate', raw => raw.states[0].stage.mouth.y = '2'],
  ['zero view extent', raw => raw.states[0].stage.mouth.h = 0],
  ['outside view origin', raw => raw.states[0].stage.mouth.x = 8],
  ['fractional atlas crop', raw => raw.mouthAtlas.frames.a.y = .5],
  ['missing kind', raw => delete raw.kind],
  ['wrong kind', raw => raw.kind = 'sprites'],
  ['missing closed behavior', raw => delete raw.closedBehavior],
  ['unknown explicit vowel', raw => raw.states[0].mouthFrames = { a: 'missing' }],
  ['unknown default vowel', raw => raw.mouthAtlas.defaultFrames.a = 'missing'],
  ['one missing view anchor', raw => delete raw.states[0].stage.mouth],
  ['static state with mapped frame', raw => { delete raw.states[0].stage.mouth; delete raw.states[0].portrait.mouth; raw.states[0].mouthFrames = { a: 'a' } }]
]) test('variants still reject ' + name, () => { const raw = spriteFixture(); edit(raw); assert.throws(() => forkSpriteManifest(raw)) })

function partial() {
  const raw = spriteFixture()
  raw.mouthAtlas.frames = { neutral: { x: 0, y: 0, w: 1, h: 1 }, custom_a: { x: 1, y: 0, w: 1, h: 1 } }
  raw.mouthAtlas.defaultFrames = {}
  raw.states = [raw.states[0]]
  raw.states[0].mouthFrames = { a: 'custom_a', closed: 'neutral' }
  return raw
}

test('partial vowels fall back to the state closed patch, or neutral base, never another vowel', () => {
  const raw = partial(), pack = forkSpriteManifest(raw), state = pack.states[0]
  assert.equal(forkSpriteFrame(pack, state, 'a').id, 'custom_a')
  for (const vowel of ['i', 'u', 'e', 'o']) assert.equal(forkSpriteFrame(pack, state, vowel).id, 'neutral')
  delete raw.states[0].mouthFrames.closed
  const neutral = forkSpriteManifest(raw)
  assert.equal(forkSpriteFrame(neutral, neutral.states[0], 'i'), null)
  assert.equal(forkSpriteFrame(neutral, neutral.states[0], 'a').id, 'custom_a')
  assert.equal(forkSpriteFrame(pack, state, 'initial'), null)
})

test('fully occluded static states omit both anchors and keep their immutable base during speech', async () => {
  const raw = partial()
  delete raw.states[0].mouthFrames
  delete raw.states[0].stage.mouth
  delete raw.states[0].portrait.mouth
  const pack = forkSpriteManifest(raw), state = pack.states[0]
  assert.deepEqual(forkSpriteManifest(pack), pack)
  for (const event of ['initial', 'idle', 'closed', 'a', 'i', 'u', 'e', 'o']) assert.equal(forkSpriteFrame(pack, state, event), null)
  const shared = await readFile(new URL('../tavern-plugin/src/client/fork-layered-sprite.cjs', import.meta.url), 'utf8')
  const render = await readFile(new URL('../tavern-plugin/src/client/fork-layered-sprite-render.js', import.meta.url), 'utf8')
  const context = {}, draws = [], base = { width: 8, height: 8 }
  vm.runInNewContext(shared + '\n' + render, context)
  const canvas = { width: 8, height: 8, getContext: () => ({ clearRect() {}, drawImage(...args) { draws.push(args) } }) }
  const bundle = context.forkSpriteBundle({ id: 'sprite', spritePack: pack }, 'calm')
  context.forkSpritePaint(canvas, bundle, new Map([['assets/test.webp', base]]), 'a')
  assert.deepEqual(draws, [[base, 0, 0]])
  const noAtlas = setOnly(); delete noAtlas.states[0].mouthSet
  const still = forkSpriteManifest(noAtlas)
  const stillBundle = context.forkSpriteBundle({ id: 'still', spritePack: still }, 'calm')
  assert.deepEqual(Array.from(context.forkSpriteUrls(stillBundle)), ['assets/test.webp'])
  context.forkSpritePaint(canvas, stillBundle, new Map([['assets/test.webp', base]]), 'a')
  assert.equal(draws.length, 2)
})
