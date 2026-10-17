// private fork: historical vocabulary is fixture data, not a runtime default.
// private fork: include source literally, without String.replace replacement-token expansion.
import {stagePageSource} from './helpers/stage-page-source.mjs' // private fork
import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'
import moods from '../tests/fixtures/legacy-dialogue-moods.json' with { type: 'json' }
import { normalizeBubbleConfig, resolveBubbleMood, bubbleInstructionPreview } from '../tavern-plugin/lib/domain/dialogue-bubbles.js'

import { forkSpriteManifest, forkSpriteState } from '../tavern-plugin/src/client/fork-layered-sprite.cjs'
import { spriteFixture, storedZip } from './fixtures/fork-layered-sprite.mjs'
import { image, sha } from './fixtures/fork-mouth-rig.mjs'

const oldIds = ['joy', 'anger', 'sad', 'anxious', 'calm', 'shy', 'disgust', 'love']
const labels = ['喜悦', '愤怒', '悲伤', '紧张', '平和', '害羞', '嫌弃', '爱恋', '哭泣']
const read = name => readFile(new URL('../tavern-plugin/src/client/' + name, import.meta.url), 'utf8')
const bubbles = (await read('fork-bubbles.js')).split('// @include fork-bubble-line.cjs').join(await read('fork-bubble-line.cjs')).split('// @include-protocol figure-resolution.cjs').join(await readFile(new URL('../tavern-plugin/packages/dsh-presentation-protocol/src/figure-resolution.cjs',import.meta.url),'utf8')).replace('__TAVERN_BUBBLE_MOODS__', JSON.stringify(moods))
const stage = await read('fork-gal-stage.js')
const extra = bubbles.slice(bubbles.indexOf('function forkBubbleMediaDescriptor'), bubbles.indexOf('// Transcript images'))
const context = { Blob, TextDecoder, TextEncoder, Uint8Array, DataView, Response, DecompressionStream, Map, Set }
vm.runInNewContext(bubbles.slice(0, bubbles.indexOf('// Per-session bubble settings')) + '\n' + extra + '\n' + await read('fork-layered-sprite.cjs') + '\n' + await read('fork-layered-sprite-render.js') + '\n' + (stagePageSource + '\n' + stage.slice(stage.indexOf('// Plain reading text'), stage.indexOf('// The stage is a full-screen mode'))), context)

function pack(withCrying = false) {
  const raw = spriteFixture(), base = raw.states[0]
  raw.states = (withCrying ? moods : moods.slice(0, 8)).map(group => ({ ...structuredClone(base), id: group.id, label: group.label, emotion: group.id,
    stage: { ...base.stage, src: 'assets/' + group.id + '-stage.png' }, portrait: { ...base.portrait, src: 'assets/' + group.id + '-portrait.png' } }))
  return forkSpriteManifest(raw)
}

test('legacy crying aliases survive explicit declarations without an implicit vocabulary', () => {
  assert.deepEqual(moods.map(group => group.id), oldIds.concat('crying'))
  assert.deepEqual(moods.map(group => group.label), labels)
  assert.deepEqual(normalizeBubbleConfig({enabled:true}).moods,[]) // private fork
  const config = normalizeBubbleConfig({ enabled: true,emotions:moods.map(({id,label,words})=>({id,label,words:id==='crying'?words:''})) }) // private fork
  assert.equal(config.emotions.length, 9) // private fork
  assert.deepEqual(config.moods.map(group => group.id), oldIds.concat('crying'))
  assert.ok(config.moods.every(group => !group.builtin)) // private fork
  for (const value of ['crying', '哭泣', '流泪', '落泪']) {
    assert.equal(resolveBubbleMood(value, config).id, 'crying')
    assert.equal(context.forkBubbleMood(value, context.forkBubbleMoodList(config)).id, 'crying')
  }
  assert.equal(resolveBubbleMood('悲伤', config).id, 'sad')
  assert.equal(resolveBubbleMood('紧张', config).id, 'anxious')
  const prompt = bubbleInstructionPreview(config).instruction
  assert.doesNotMatch(prompt, /哭泣/) // private fork: an empty figure roster has no variant list.
  assert.doesNotMatch(prompt, /明显流泪|默认克制/) // private fork: only filled figure guidance enters the writer
  const custom = normalizeBubbleConfig({ emotions: Array.from({ length: 8 }, (_, i) => ({ id: 'c' + i, label: '自定' + i })) })
  assert.equal(custom.moods.length, 8, 'only supplied declarations exist') // private fork
})

test('new crying dialogue selects its own stage and portrait; old eight-state packs use their safe default', () => {
  // private fork: source alias differs from the canonical actor key.
  const config = {characters:[{alias:'f_hero',aliases:['hero'],name:'主角',ref:{packId:'pack',figureId:'hero'}}]}
  for (const withCrying of [false, true]) {
    const spritePack = pack(withCrying), model = { id: 'sp0000000000', kind: 'static', spritePack }
    for (const word of ['crying', '哭泣', '流泪']) {
      const pages = context.forkGalPages([{ segments: context.forkParseBubbles('@bubble:hero|主角|' + word + '|[测试台词]', false) }])
      assert.equal(pages.length, 1); assert.equal(pages[0].para, 1)
      const rawMood = context.forkGalMoodOf(pages, 0, 'f_hero', config)
      const fallback = context.forkBubbleMood(rawMood).id
      const selected = forkSpriteState(spritePack, rawMood, fallback)
      assert.equal(selected.id, withCrying ? 'crying' : 'calm')
      const figure = context.forkGalStaticFrames(model, selected.id)
      const face = context.forkSpriteBundle(model, figure.spriteBundle.state.id, 'portrait', fallback)
      assert.equal(figure.spriteBundle.state.id, selected.id)
      assert.equal(face.state.id, selected.id)
      assert.equal(figure.src, selected.stage.src)
      assert.equal(face.view.src, selected.portrait.src)
    }
    assert.equal(spritePack.states.length, withCrying ? 9 : 8)
    for (const id of oldIds) assert.equal(forkSpriteState(spritePack, id).id, id)
  }
  const legacy = { kind: 'static', images: { default: 'old-base.webp', sad: 'old-sad.webp', anxious: 'old-nervous.webp' }, talk: { default: 'old-talk.webp' } }
  assert.equal(context.forkGalStaticFrames(legacy, 'crying').src, 'old-base.webp')
  assert.equal(context.forkGalStaticFrames(legacy, 'crying').talkSrc, 'old-talk.webp')
  // private fork: transcript fallback uses pack descriptors, never legacy URLs.
  assert.equal(context.forkBubbleMediaDescriptor({avatarMedia:{default:'calm-descriptor',moods:{sad:'sad-descriptor'}}}, 'crying'), 'calm-descriptor')
})

// private fork: legacy image ZIP UI removed; complete pack ZIP validation is covered by asset-packs tests.
