import {directorPromptData} from './fixtures/asset-packs/prompt.mjs'
// private fork: synthetic card preferences; no live profile or filesystem fixtures.
import test from 'node:test'
import assert from 'node:assert/strict'
import { cardExtension } from './fixtures/asset-packs/pack.mjs'
import { cardAssetRawOperations, validateCardAssetExtension } from '../tavern-plugin/lib/domain/card-asset-bindings.js'
import { effectiveCardStage, cardEngineSettings } from '../tavern-plugin/lib/domain/card-stage-settings.js'
import { defaultAssetEngineSettings } from '../tavern-plugin/lib/domain/asset-engine-settings.js'
import { cardBubbleConfig } from '../tavern-plugin/lib/fork-card-stage.js'
import { createAssetPackSpeech } from '../tavern-plugin/lib/domain/asset-pack-speech.js'

test('new opt-ins inherit global toggles and bubbles gate stage', () => {
  const ext = cardExtension()
  const [operation] = cardAssetRawOperations({name:'New'}, {assetBindings:ext.assetBindings})
  assert.equal(operation.value.dsh_tavern.stage, undefined)
  assert.equal(effectiveCardStage(ext).stage, true)
  const engine = defaultAssetEngineSettings(); engine.stageToggles.dialogue = false
  assert.equal(effectiveCardStage(ext,engine).stage, false)
  const config = cardBubbleConfig({extensions:{dsh_tavern:ext}}, engine)
  assert.equal(config.enabled, false)
  assert.equal(config.stage.enabled, false)
})

test('stage schema rejects invalid values and dimensions; replacement restores inheritance', () => {
  const ext = cardExtension()
  for (const stage of [{voice:'yes'}, {dimensions:{unknown:true}}, {dimensions:{camera:1}}, {unknown:true}]) {
    assert.throws(() => validateCardAssetExtension({...ext, stage}))
  }
  const raw = {extensions:{dsh_tavern:{...ext, stage:{music:false}}}}
  const [operation] = cardAssetRawOperations(raw, {stage:{}})
  assert.deepEqual(operation.value.stage, {})
  assert.equal(effectiveCardStage(operation.value).music, true)
})

// private fork (global only, owner 2026-10, AGENTS rule 15): the director commands are global (舞台引擎 › 可用演出); a card's
// stored stage.dimensions (the retired per-card override) is ignored on read and is never rewritten.
test('private fork: a stored card stage.dimensions is ignored; the engine dimensions decide', () => {
  const engine = defaultAssetEngineSettings()
  const ext = {...cardExtension(), stage:{dimensions:{camera:false}, widgets:true}}
  Object.assign(engine.stageToggles,{music:false,sfx:false,ambience:false})
  const effective = cardEngineSettings(engine, ext)
  // private fork: v3 uses widget dimensions, not execution grants.
  assert.equal(Object.hasOwn(effective,'widgetExecutionEnabled'), false)
  assert.equal(effective.dimensions.widgets, true)
  assert.equal(effective.dimensions.music, false)
  assert.equal(effective.dimensions.soundscape, false)
  assert.equal(effective.dimensions.sfx, false)
  assert.equal(effective.dimensions.camera, true, 'the card override is not read')
  assert.equal(cardEngineSettings({...engine,dimensions:{...engine.dimensions,camera:false}},{...ext,stage:{dimensions:{camera:true}}}).dimensions.camera, false, 'nor can it re-enable a command')
  assert.throws(()=>validateCardAssetExtension({...ext,stage:{directionStyle:null}}),{code:'UNKNOWN_FIELD'})
  assert.equal(engine.dimensions.camera, true)
})

test('voice switch is enforced by speech backend before granting synthesis', async () => {
  const ext = {...cardExtension(), stage:{}}
  const engine = defaultAssetEngineSettings(); engine.stageToggles.voice = false
  // private fork: the card voice switch is checked before any figure resolution.
  const speech = createAssetPackSpeech({getEngine:() => engine,presentation:{extension:ext,resolveName:async()=>({status:'missing'}),subscribe:() => () => {}}, getTts:() => ({apiVersion:1,subscribe:() => () => {},listServiceVoices:() => {throw new Error('must not read voices')}}),scope:'test'})
  assert.deepEqual(await speech.open('actor'), {available:false,diagnostics:['voice-unbound']})
  speech.dispose()
})

// private fork: inspect the real runtime merge and generated closed tool schema.
import { fixture as directorFixture } from './helpers/stage-director-harness.mjs'
// private fork (global only): an old stage patch may carry the stored stage.dimensions through unchanged; a new or changed
// one is rejected (no write path), and nothing rewrites the stored value.
test('private fork: a stage patch cannot write card director commands, only carry the stored value', () => {
  const ext = {...cardExtension(), stage:{dimensions:{camera:false}, widgets:true}}
  const raw = {extensions:{dsh_tavern:ext}}
  const [kept] = cardAssetRawOperations(raw, {stage:{dimensions:{camera:false}, widgets:false}})
  assert.deepEqual(kept.value.stage, {dimensions:{camera:false}, widgets:false})
  assert.deepEqual(cardAssetRawOperations(raw, {stage:{widgets:false}})[0].value.stage, {widgets:false})
  assert.throws(() => cardAssetRawOperations(raw, {stage:{dimensions:{camera:true}}}), {code:'UNKNOWN_FIELD'})
  assert.throws(() => cardAssetRawOperations({extensions:{dsh_tavern:cardExtension()}}, {stage:{dimensions:{camera:false}}}), {code:'UNKNOWN_FIELD'})
})

test('director preview exposes truthful sources and honors granular global dimensions, not the card\'s', async () => {
  const defaults = defaultAssetEngineSettings()
  const f = await directorFixture(() => {},{engineValues:{stageToggles:{...defaults.stageToggles,music:false,ambience:false},dimensions:{...defaults.dimensions,'camera.close':false,acts:false}}})
  try {
    // A retired card override (camera off) is ignored: camera.set stays.
    f.workspace.raw.extensions.dsh_tavern.stage = {dimensions:{camera:false},widgets:false}
    const preview = await f.director.preview(f.read())
    assert.ok(preview.sections.length)
    assert.ok(preview.sections.every(section => section.source?.kind && Number.isFinite(section.tokens)))
    assert.ok(preview.sections.some(section => section.source.kind === 'pack' && section.source.packId))
    assert.ok(preview.sections.some(section => section.key === 'actors.constant' && section.source.kind === 'pack'))
    // private fork: installed tools are fixed grammar; allowedCommands owns turn admission.
    const names = directorPromptData(preview).allowedCommands
    assert.equal(names.includes('music.set'),false)
    for (const disabled of ['camera.close','soundscape.set','actor.act.play']) assert.equal(names.includes(disabled),false,disabled)
    assert.ok(names.includes('camera.set'), 'other camera commands remain available')
  } finally { await f.dispose() }
})
