import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'

import { forkSpriteManifest, forkSpriteAtlas, forkSpriteFrame, forkSpriteAssets, forkSpriteMapAssets } from '../tavern-plugin/src/client/fork-layered-sprite.cjs'

import { spriteFixture } from "./fixtures/fork-layered-sprite.mjs"
import { image } from "./fixtures/fork-mouth-rig.mjs"

const setId = 'approved-batch-' + 'x'.repeat(78)
function fixture(source = 'assets/set.webp') {
  const raw = spriteFixture()
  raw.mouthSets = { [setId]: { ...structuredClone(raw.mouthAtlas), src: source } }
  raw.states[3].mouthSet = setId
  raw.mouthSets[setId].frames.tense_a.y = 3
  raw.states[3].stage.mouthByFrame = { tense_a: { x: 2, y: 3, w: 2, h: 1 } }
  raw.reviewMetadata = { ignored: true }
  return raw
}

test('state set selects its own frames, defaults, closed aliases and anchors without changing shared states', () => {
  const raw = fixture()
  raw.mouthSets[setId].defaultFrames.i = 'tense_a'
  const pack = forkSpriteManifest(raw), state = pack.states[3]
  assert.equal(state.mouthSet, setId)
  assert.equal(forkSpriteAtlas(pack, state), pack.mouthSets[setId])
  assert.equal(forkSpriteAtlas(pack, pack.states[0]), pack.mouthAtlas)
  assert.equal(forkSpriteFrame(pack, state, 'a').rect.y, 3)
  assert.equal(forkSpriteFrame(pack, state, 'i').id, 'tense_a')
  assert.equal(forkSpriteFrame(pack, state, 'closed').id, 'closed_patch')
  assert.equal(forkSpriteFrame(pack, state, 'initial'), null)
  assert.equal(forkSpriteFrame(pack, state, 'idle'), null)
  assert.equal(forkSpriteFrame(pack, pack.states[0], 'i').id, 'i')
  assert.deepEqual(state.stage.mouthByFrame.tense_a, raw.states[3].stage.mouthByFrame.tense_a)
  assert.equal(pack.reviewMetadata, undefined)
  assert.deepEqual(forkSpriteManifest(pack), pack, 'normalized packs survive host revalidation')
  delete raw.mouthSets[setId].defaultFrames
  assert.equal(forkSpriteFrame(forkSpriteManifest(raw), state, 'i').id, 'i')
})

for (const [name, edit] of [
  ['missing set', raw => raw.states[3].mouthSet = 'missing'],
  ['invalid set reference', raw => raw.states[3].mouthSet = null],
  ['unsafe set ID', raw => raw.mouthSets.constructor = raw.mouthSets[setId]],
  ['overlong set ID', raw => raw.mouthSets['x'.repeat(161)] = raw.mouthSets[setId]],
  ['too many sets', raw => { for (let i = 0; i < 16; i++) raw.mouthSets['set_' + i] = raw.mouthSets[setId] }],
  ['non-object sets', raw => raw.mouthSets = []],
  ['out-of-bounds set rect', raw => raw.mouthSets[setId].frames.a.x = 8],
  ['fractional set rect', raw => raw.mouthSets[setId].frames.a.y = .5],
  ['overlapping set rect', raw => raw.mouthSets[setId].frames.i.x = 0],
  ['oversized set', raw => raw.mouthSets[setId].width = 4097],
  ['unsafe set source', raw => raw.mouthSets[setId].src = '../set.webp'],
  ['too many set frames', raw => { for (let i = 0; i < 250; i++) raw.mouthSets[setId].frames['extra_' + i] = { x: 0, y: 0, w: 1, h: 1 } }],
  ['shared-only vowel', raw => delete raw.mouthSets[setId].frames.o],
  ['shared-only mapped frame', raw => delete raw.mouthSets[setId].frames.tense_a],
  ['shared-only closed frame', raw => delete raw.mouthSets[setId].frames.closed_patch],
  ['shared-only anchor frame', raw => { raw.mouthAtlas.frames.shared = { x: 0, y: 2, w: 1, h: 1 }; raw.states[3].portrait.mouthByFrame = { shared: { x: 0, y: 0, w: 1, h: 1 } } }]
]) test('mouth sets reject ' + name, () => { const raw = fixture(); edit(raw); assert.throws(() => forkSpriteManifest(raw)) })

test('set atlas closure includes unused sets, remaps sources and rejects conflicting dimensions', () => {
  const pack = forkSpriteManifest(fixture())
  pack.mouthSets.unused = { ...pack.mouthSets[setId], src: 'assets/unused.webp' }
  assert.deepEqual([...forkSpriteAssets(pack)], [['assets/test.webp', [8, 8]], ['assets/set.webp', [8, 8]], ['assets/unused.webp', [8, 8]]])
  const projected = forkSpriteMapAssets(pack, src => '/mapped/' + src)
  assert.equal(projected.mouthSets[setId].src, '/mapped/assets/set.webp')
  assert.equal(projected.mouthSets.unused.src, '/mapped/assets/unused.webp')
  assert.equal(forkSpriteAtlas(projected, projected.states[3]).src, '/mapped/assets/set.webp')
  pack.mouthSets.unused.src = pack.mouthAtlas.src
  pack.mouthSets.unused.width = 9
  assert.throws(() => forkSpriteAssets(pack), /尺寸冲突/)
})

// A valid extra RIFF chunk gives the synthetic set image its own content address.
const setImage = Buffer.concat([image, Buffer.from('JUNK'), Buffer.from([4, 0, 0, 0, 1, 2, 3, 4])])
setImage.writeUInt32LE(setImage.length - 8, 4)

test('renderer loads the selected atlas and isolates scaled patches per image, including closed frames', async () => {
  const shared = await readFile(new URL('../tavern-plugin/src/client/fork-layered-sprite.cjs', import.meta.url), 'utf8')
  const render = await readFile(new URL('../tavern-plugin/src/client/fork-layered-sprite-render.js', import.meta.url), 'utf8')
  const draws = [], patches = []
  const canvas = () => ({ width: 0, height: 0, getContext: () => ({ clearRect() {}, drawImage(...args) { draws.push(args) } }) })
  const context = { document: { createElement() { const patch = canvas(); patches.push(patch); return patch } } }
  vm.runInNewContext(shared + '\n' + render, context)
  const pack = forkSpriteManifest(fixture()), model = { id: 'sprite', spritePack: pack }
  const bundle = context.forkSpriteBundle(model, 'signature'), base = { width: 8, height: 8 }, atlas = { width: 8, height: 8 }
  const images = new Map([['assets/test.webp', base], ['assets/set.webp', atlas]]), out = canvas()
  assert.deepEqual(Array.from(context.forkSpriteUrls(bundle)), ['assets/test.webp', 'assets/set.webp'])
  context.forkSpritePaint(out, bundle, images, 'initial')
  assert.equal(patches.length, 0)
  context.forkSpritePaint(out, bundle, images, 'a')
  assert.deepEqual(draws.at(-2), [atlas, 6, 3, 1, 1, 0, 0, 1, 1], '1:1 isolation uses selected set image')
  assert.deepEqual(draws.at(-1), [patches[0], 0, 0, 1, 1, 2, 3, 2, 1], 'scaled patch uses per-frame anchor')
  context.forkSpritePaint(out, bundle, images, 'a')
  assert.equal(patches.length, 1, 'same set frame is cached')
  assert.equal(context.forkSpriteFramePatch(base, pack.mouthSets[setId].frames.tense_a) === patches[0], false, 'same rectangle in another image has a separate cache')
  context.forkSpritePaint(out, bundle, images, 'closed')
  assert.equal(draws.at(-2)[0], atlas)
  assert.equal(draws.at(-2)[1], 5)
  const changed = structuredClone(model); changed.spritePack.mouthSets[setId].src = 'assets/new.webp'
  assert.notEqual(context.forkSpriteBundle(changed, 'signature').revision, bundle.revision)
  images.set('assets/set.webp', { width: 9, height: 8 })
  assert.throws(() => context.forkSpritePaint(out, bundle, images, 'a'), /尺寸不匹配/)
})
