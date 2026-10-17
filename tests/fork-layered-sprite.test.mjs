import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFile } from "node:fs/promises"

import { forkSpriteManifest, forkSpriteAssets, forkSpriteState, forkSpriteFrame, forkSpriteVoiceStep } from "../tavern-plugin/src/client/fork-layered-sprite.cjs"
import {normalizeStagePortraits} from '../tavern-plugin/lib/domain/stage-portraits.js'
import { mapPortraitAssets, collectPortraitAssets } from "../tavern-plugin/lib/domain/stage-portrait-rig.js"
import { validateStagePortraitIndex } from "../tavern-plugin/lib/domain/stage-portrait-pack.js"

import { spriteFixture, spriteIndex, storedZip } from './fixtures/fork-layered-sprite.mjs'
import { image, sha } from './fixtures/fork-mouth-rig.mjs'
const plain = x => JSON.parse(JSON.stringify(x))
const root = new URL('../', import.meta.url)
const src = name => readFile(new URL('tavern-plugin/src/client/' + name, root), 'utf8')
const shared = await src('fork-layered-sprite.cjs'), rendering = await src('fork-layered-sprite-render.js')

const context = { Blob, TextDecoder, TextEncoder, Uint8Array, DataView, Response, DecompressionStream, Map, Set }
vm.runInNewContext(shared + '\n' + rendering, context)
const file = bytes => ({ size: bytes.length, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) })
const groups = ['joy', 'anger', 'sad', 'anxious', 'calm', 'shy', 'disgust', 'love'].map(id => ({ id, label: id }))
const mockConvert = async () => ({sha, blob:new Blob([image])})

test('manifest preserves 11+ states, independent anchors, frame overrides, open base and closed aliases', () => {
  const m = forkSpriteManifest(spriteFixture())
  assert.equal(m.states.length, 11)
  assert.notDeepEqual(m.states[0].stage.mouth, m.states[0].portrait.mouth)
  assert.equal(forkSpriteFrame(m, m.states[3], 'a').id, 'tense_a')
  assert.equal(forkSpriteFrame(m, m.states[3], 'closed').id, 'closed_patch')
  assert.equal(forkSpriteFrame(m, m.states[3], 'initial'), null)
  assert.equal(forkSpriteFrame(m, m.states[3], 'idle'), null)
  assert.equal(forkSpriteFrame(m, m.states[0], 'closed'), null)
  assert.equal(forkSpriteFrame(m, m.states[0], 'invalid'), null)
  const v1 = spriteFixture(); v1.version = 1; v1.closedBehavior = 'restore-base except explicit surprise closed override'
  assert.equal(forkSpriteManifest(v1).closedBehavior, 'restore-base')
})
for (const [name, edit] of [
  ['version', m => m.version = 3], ['duplicate state', m => m.states[1].id = 'calm'], ['path traversal', m => m.states[0].stage.src = '../x.png'],
  ['external URL', m => m.mouthAtlas.src = 'https://evil.invalid/a.png'], ['unsafe path', m => m.states[0].portrait.src = 'C:\\a.png'],
  ['oversized canvas', m => m.mouthAtlas.width = 4097], ['overlap', m => m.mouthAtlas.frames.i.x = 0], ['missing vowel', m => delete m.mouthAtlas.frames.e],
  ['out of bounds', m => m.states[0].portrait.mouth.x = 8], ['nonfinite rect', m => m.states[0].stage.mouth.y = Infinity],
  ['open base without closed', m => { delete m.states[3].mouthFrames.closed; delete m.states[3].closedMouthFrame }],
  ['conflicting closed aliases', m => m.states[3].closedMouthFrame = 'a'], ['unknown frame', m => m.states[0].mouthFrames = { a: 'absent' }],
  ['mask URL', m => m.states[0].stage.mouthOcclusionMask = 'https://evil.invalid/m.png'], ['unknown per-frame anchor', m => m.states[0].stage.mouthByFrame = { absent: { x: 0, y: 0, w: 1, h: 1 } }]
]) test('rejects ' + name, () => { const m = spriteFixture(); edit(m); assert.throws(() => forkSpriteManifest(m)) })

test('state resolver prioritizes exact signature and aliases; both views use one selected ID', () => {
  const pack = forkSpriteManifest(spriteFixture()), model = { id: 'sp0000000000', spritePack: pack }
  assert.equal(forkSpriteState(pack, 'signature', 'calm').id, 'signature')
  assert.equal(forkSpriteState(pack, '状态 3').id, 'signature')
  assert.equal(forkSpriteState(pack, 'sad').id, 'sadness')
  assert.equal(forkSpriteState(pack, 'anxious').id, 'nervous')
  assert.equal(forkSpriteState(pack, 'unknown').id, 'calm')
  for (const state of pack.states) {
    assert.equal(context.forkSpriteBundle(model, state.id, 'stage').state.id, context.forkSpriteBundle(model, state.id, 'portrait').state.id)
  }
})
test('asset visitor projects all views, atlas and masks with a single explicit dependency closure', () => {
  const p = spriteIndex().portraits[0]; p.spritePack.states[0].stage.mouthOcclusionMask = sha
  assert.deepEqual(collectPortraitAssets(p), [sha])
  assert.equal(forkSpriteAssets(p.spritePack).size, 1)
  const projected = mapPortraitAssets(p, {}, id => '/asset/' + id)
  assert.equal(projected.spritePack.mouthAtlas.src, '/asset/' + sha)
  assert.equal(projected.spritePack.states[0].stage.mouthOcclusionMask, '/asset/' + sha)
  const mismatch = spriteFixture(); mismatch.states[0].stage.width = 9
  assert.throws(() => forkSpriteAssets(mismatch), /尺寸冲突/)
})

test('host normalizer and pack validator reject malformed sprite metadata, missing bytes and tampered dimensions', async () => {
  const raw = spriteIndex(); await validateStagePortraitIndex(raw, async () => image)
  await assert.rejects(validateStagePortraitIndex(raw, async () => undefined), /Missing|corrupt/)
  raw.portraits[0].spritePack.states[0].portrait.mouth.x = 100
  assert.equal(normalizeStagePortraits(raw).portraits[0].spritePack, undefined)
  await assert.rejects(validateStagePortraitIndex(raw, async () => image), /Invalid sprite/)
  const v1 = spriteIndex(); v1.version = 1
  await assert.rejects(validateStagePortraitIndex(v1, async () => image), /require index v2/)
})
test('real audio amplitude only: silent typing, pause, mute, stop, replay, seek and new Audio reset', () => {
  let state = forkSpriteVoiceStep(null, null, 1, true, 0)
  assert.equal(state.event, 'initial', 'no synthetic speech')
  const audio = { currentTime: 1, paused: false, ended: false }
  state = forkSpriteVoiceStep(state, audio, .9, true, 100); assert.equal(state.event, 'a')
  state = forkSpriteVoiceStep(state, audio, .3, true, 110); assert.equal(state.event, 'a', 'hold')
  state = forkSpriteVoiceStep(state, audio, 0, true, 115); assert.equal(state.event, 'closed', 'silence wins')
  state = forkSpriteVoiceStep(state, audio, .9, true, 200); audio.paused = true
  state = forkSpriteVoiceStep(state, audio, .9, true, 205); assert.equal(state.event, 'closed')
  audio.paused = false; state = forkSpriteVoiceStep(state, audio, .9, false, 220); assert.equal(state.event, 'closed')
  state = forkSpriteVoiceStep(state, audio, .9, true, 310); assert.equal(state.event, 'a')
  state = forkSpriteVoiceStep(state, null, 0, false, 320); assert.equal(state.event, 'closed', 'stopped clip cannot reopen native open base')
  audio.currentTime = 0; state = forkSpriteVoiceStep(state, audio, .3, true, 330); assert.equal(state.event, 'i')
  state = forkSpriteVoiceStep(state, { currentTime: 0, paused: false }, .6, true, 340); assert.equal(state.event, 'e')
})
// private fork: old image ZIP UI removed; v2 pack transport tests cover binary import and complete closure.
test('integration keeps full dialogue, one cursor, existing static fallback and dedicated modules in build', async () => {
  const stage = await src('fork-gal-stage.js'), scene = await src('fork-gal-scene.js'), live = await src('fork-live2d.js')
  // private fork: P4 chooses one state for both render views; the stage uses that projection.
  assert.match(stage, /packFigureRenderInputs\(figure/); assert.match(stage, /portraits.get\(speaker\)/)
  // private fork: all themes use the same bottom-aligned face component.
  assert.match(stage, /faceMode !== "off" \? h\(ForkGalSide/)
  assert.match(scene, /forkSpriteTickScene\(entry, state.textures/)
  assert.match(scene, /forkSpriteClearScene\(entry\)/)
  assert.doesNotMatch(live, /saveStagePortrait|spriteImportLock/); assert.match(await src("fork-asset-launcher.js"), /createForkAssetPackBinding/) // private fork: v2 workbench owns previews
  assert.doesNotMatch(rendering, /forkSyntheticMouth|setPage|readState\.set/)
})

test('frozen Soyo, Mana, Tomori and Taki manifests share the production contract; initial never overlays closed', async () => {
  const contracts = JSON.parse(await readFile(new URL('fixtures/layered-sprite-contracts.json', import.meta.url), 'utf8'))
  assert.deepEqual(Object.fromEntries(Object.entries(contracts).map(([id, raw]) => [id, forkSpriteManifest(raw).states.length])), { soyo: 14, mana: 10, tomori: 11, taki: 11 })
  for (const raw of Object.values(contracts)) {
    const pack = forkSpriteManifest(raw)
    for (const s of pack.states) {
      assert.equal(forkSpriteFrame(pack, s, 'initial'), null)
      assert.equal(forkSpriteFrame(pack, s, 'idle'), null)
      if (s.mouthFrames.closed) assert.equal(forkSpriteFrame(pack, s, 'closed').id, s.mouthFrames.closed)
    }
  }
  const taki = forkSpriteManifest(contracts.taki)
  assert.ok(taki.states.filter(s => s.mouthFrames.closed && s.initialPhoneme === 'closed').length >= 2, 'closed alias does not imply a closed patch on initial entry')
})
