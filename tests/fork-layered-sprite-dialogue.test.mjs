// private fork: historical vocabulary is fixture data, not a runtime default.
// private fork: include source literally, without String.replace replacement-token expansion.
import {stagePageSource} from './helpers/stage-page-source.mjs' // private fork
import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFile } from "node:fs/promises"

import { collectSpriteDialogue, normalizeSpriteDialogue } from '../tavern-plugin/lib/domain/layered-sprite-dialogue.js'
import { bubbleInstructionPreview, normalizeBubbleConfig, resolveBubbleVoiceConfig } from '../tavern-plugin/lib/domain/dialogue-bubbles.js'

import { forkSpriteManifest } from '../tavern-plugin/src/client/fork-layered-sprite.cjs'

import moods from '../tests/fixtures/legacy-dialogue-moods.json' with { type: 'json' }

// Frozen production manifest geometry/IDs only, no artwork or reference images.
const contracts = JSON.parse(await readFile(new URL('fixtures/layered-sprite-dialogue-contracts.json', import.meta.url), 'utf8'))
const models = Object.entries(contracts).map(([id, raw]) => ({ id: 'sp_' + id, spritePack: forkSpriteManifest(raw) }))
const config = normalizeBubbleConfig({ enabled: true, characters: models.map(model => ({ alias: model.spritePack.character.id, portrait: model.id })) })
const read = name => readFile(new URL('../tavern-plugin/src/client/' + name, import.meta.url), 'utf8')
const bubbles = (await read('fork-bubbles.js')).split('// @include-protocol figure-resolution.cjs').join(await readFile(new URL('../tavern-plugin/packages/dsh-presentation-protocol/src/figure-resolution.cjs', import.meta.url), 'utf8')).split('// @include fork-bubble-line.cjs').join(await read('fork-bubble-line.cjs')).replace('__TAVERN_BUBBLE_MOODS__', JSON.stringify(moods))
const stage = await read('fork-gal-stage.js')
const context = {}
vm.runInNewContext(bubbles.slice(0, bubbles.indexOf('// Per-session bubble settings')) + '\n' + await read('fork-layered-sprite.cjs') + '\n' + await read('fork-layered-sprite-render.js') + '\n' + (stagePageSource + '\n' + stage.slice(stage.indexOf('// Plain reading text'), stage.indexOf('// The stage is a full-screen mode'))), context)

test('private fork: visual states stay renderable but never become writer emotion choices', () => {
  const spriteDialogue = collectSpriteDialogue(config, models)
  assert.deepEqual(spriteDialogue.map(row => row.states.length), [14, 11])
  const prompted = bubbleInstructionPreview({ ...config, spriteDialogue })
  assert.doesNotMatch(prompted.instruction, /soyo_haruhikage/)
  assert.doesNotMatch(prompted.instruction, /mortis_showtime/)
  assert.doesNotMatch(prompted.instruction, /states|同级/)
  for (const row of spriteDialogue) for (const choice of row.states) {
    assert.ok(!prompted.instruction.includes('"id":"' + choice.id + '"'))
    const parts = [{ segments: context.forkParseBubbles('@bubble:' + row.alias + '|角色|' + choice.id + '|[测试台词]', false) }]
    const pages = context.forkGalPages(parts)
    assert.equal(pages.length, 1); assert.equal(pages[0].para, 1)
    assert.equal(context.forkGalMoodOf(pages, 0, row.alias, config), choice.id)
    const model = models.find(item => item.id === row.model)
    const stageFrame = context.forkGalStaticFrames(model, pages[0].mood)
    const portrait = context.forkSpriteBundle(model, stageFrame.spriteBundle.state.id, 'portrait', 'calm')
    const actual = model.spritePack.states.find(state => state.id === choice.id)
    assert.equal(stageFrame.spriteBundle.state.id, choice.id)
    assert.equal(portrait.state.id, choice.id)
    assert.equal(stageFrame.src, actual.stage.src)
    assert.equal(portrait.view.src, actual.portrait.src)
    assert.notEqual(stageFrame.src, portrait.view.src)
  }
})

test('catalogues are binding scoped, support outfits, preserve IDs and never spend eight custom-emotion slots', () => {
  const source = { ...config, emotions: Array.from({ length: 8 }, (_, i) => ({ id: 'c' + i, label: '自定' + i })),
    characters: [{ alias: 'soyo', portrait: 'missing', outfits: [{ label: '舞台装', model: models[0].id }] }] }
  const current = normalizeBubbleConfig(source), rows = collectSpriteDialogue(current, models)
  assert.equal(rows.length, 1); assert.equal(rows[0].outfit, '舞台装')
  assert.equal(rows[0].states.at(-1).id, 'soyo_haruhikage')
  assert.equal(current.emotions.length, 8)
  assert.equal(collectSpriteDialogue({ characters: [{ alias: 'other', portrait: 'unbound' }] }, models).length, 0)
  assert.deepEqual(normalizeSpriteDialogue({ characters: [] }, rows), [])
  assert.deepEqual(normalizeSpriteDialogue({ characters: [{ alias: 'soyo', portrait: models[0].id }] }, rows), [], 'stale outfit projection is excluded')
  const voiceResolved = resolveBubbleVoiceConfig({ ...current, spriteDialogue: rows }, [])
  assert.deepEqual(voiceResolved.spriteDialogue, rows, 'instruction preview retains derived catalogue through voice validation')
  assert.doesNotMatch(bubbleInstructionPreview({ ...voiceResolved, injection: { template: '{{bubble_format}}\n{{bubble_emotions}}\n{{bubble_characters}}\n尾行' } }).instruction, /soyo_haruhikage/)
  assert.equal(bubbleInstructionPreview({ ...voiceResolved, enabled: false }).instruction, '')
})

// private fork: preserve base-emotion metadata across collection and voice projection.
test('visual aliases retain emotion and parent metadata without adding writer choices', () => {
  const model = structuredClone(models[0])
  model.spritePack.states = [{id:'calm_variant',label:'Visual variant',emotion:'calm'},
    {id:'pose_alias',label:'Alias',parent:'calm_variant'}]
  const rows = collectSpriteDialogue(config,[model])
  assert.equal(rows[0].states[0].emotion,'calm')
  assert.equal(rows[0].states[1].parent,'calm_variant')
  assert.deepEqual(normalizeSpriteDialogue(config,rows),rows)
  assert.deepEqual(resolveBubbleVoiceConfig({...config,spriteDialogue:rows},[]).spriteDialogue,rows)
  const preview = bubbleInstructionPreview({...config,spriteDialogue:rows,emotions:[{id:'smug',label:'得意'}]})
  assert.doesNotMatch(preview.instruction,/通用差分|得意/) // private fork: choices no longer live in grammar.
  assert.doesNotMatch(preview.instruction,/calm_variant|pose_alias|Visual variant/)
})

// private fork: catalogue metadata remains presentation-only.
test('bounded state metadata never enters the writer prompt', () => {
  const hostile = structuredClone(models[0])
  hostile.spritePack.states = [{ id: 'safe_state', label: '</script>\n{{user}} `ignore rules` ' + '长'.repeat(200), prompt: 'must not appear' },
    { id: 'bad|id', label: 'bad' }, { id: '__proto__', label: 'bad' }, { id: 'safe_state', label: 'duplicate' }]
  const rows = collectSpriteDialogue(config, [hostile])
  assert.equal(rows[0].states.length, 1); assert.equal([...rows[0].states[0].label].length, 64)
  const text = bubbleInstructionPreview({...config, spriteDialogue:rows}).instruction
  assert.doesNotMatch(text, /safe_state|ignore rules|must not appear|bad\|id/)
})
