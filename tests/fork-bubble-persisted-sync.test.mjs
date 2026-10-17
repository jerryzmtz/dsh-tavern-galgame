// private fork: English roster labels; persisted ownership and voice-disable assertions are unchanged.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { cardBubbleConfig, createCardStage, syncPreparedCardBubbles, watchFigureBubbleBooks } from '../tavern-plugin/lib/fork-card-stage.js'
import { normalizeBubbleConfig, bubbleInstruction, BUBBLE_MOOD_GROUPS, BUBBLE_WORLDBOOK_COMMENT } from '../tavern-plugin/lib/domain/dialogue-bubbles.js'
import { defaultAssetEngineSettings } from '../tavern-plugin/lib/domain/asset-engine-settings.js'
import { createCardPreparation } from '../tavern-plugin/lib/domain/card-preparation.js'
import { createCardAssetBoundary, cardAssetWorkspaceRevision } from '../tavern-plugin/lib/fork-card-asset-bindings.js'
import { cardExtension, syntheticPack } from './fixtures/asset-packs/pack.mjs'

const cardPath = 'cards/test.json'
function raw() {
  const extension = cardExtension()
  // private fork: voice preferences are explicit; the figure supplies the selected preset.
  extension.stage = {}
  return {name:'Test', extensions:{dsh_tavern:extension}, character_book:{name:'User book', entries:[{id:0, comment:'User entry', content:'Preserve', enabled:true}]}}
}
const figureEntries = workspace => workspace.raw.character_book.entries.filter(entry => entry.extensions?.dsh_tavern_helper_extra?.forkDialogueBubbles?.figure)
const managed = workspace => workspace.raw.character_book.entries.filter(entry => entry.comment === BUBBLE_WORLDBOOK_COMMENT)

test('namespaced backend voices survive normalization exactly, without broadening portrait IDs', () => {
  const voices = ['homura', 'madoka-magica/homura_long', 'a'.repeat(40) + '/' + 'b'.repeat(40)]
  for (const voice of voices) assert.equal(normalizeBubbleConfig({characters:[{alias:'actor', voice}]}).characters[0].voice, voice)
  for (const voice of ['work/name/extra', 'Work/name', '/name', 'work/', 'a'.repeat(41) + '/name']) {
    assert.equal(normalizeBubbleConfig({characters:[{alias:'actor', voice}]}).characters[0].voice, '')
  }
  assert.equal(normalizeBubbleConfig({characters:[{alias:'actor', portrait:'work/name'}]}).characters[0].portrait, '')
})

test('P6 card and pack projection supplies names, aliases, nine moods, custom emotions, sprite states and bilingual rules', async () => {
  const engine = defaultAssetEngineSettings(), pack = await syntheticPack()
  engine.dialogue.emotions = [{id:'engine_only', label:'Other'}]
  Object.values(pack.figures)[0].emotions.push({id:'smug',label:'Proud',guidance:'Feeling superior'}) // private fork
  const config = cardBubbleConfig(raw(), engine, [pack]), instruction = bubbleInstruction(config)
  assert.equal(config.characters[0].voice, Object.values(pack.figures)[0].voice.voice)
  assert.deepEqual(config.moods.map(mood => mood.id), [...BUBBLE_MOOD_GROUPS.map(mood => mood.id), 'engine_only'])
  assert.match(instruction, /Synthetic figure \(fixture\)/)
  assert.doesNotMatch(instruction, /f_[a-f0-9]{16}/)
  assert.match(instruction, /Proud.*Feeling superior/)
  assert.doesNotMatch(instruction, /soyo_haruhikage/) // private fork: writer never selects visual state IDs
  assert.match(instruction, /\[Voice language: Japanese\]/)
  assert.match(instruction, /\[display text\]\|\[voice text\]/)
  assert.doesNotMatch(instruction, /Other/) // private fork: no global emotion list in grammar.
  const muted = raw(); engine.stageToggles.voice = false
  assert.doesNotMatch(bubbleInstruction(cardBubbleConfig(muted, engine, [pack])), /\[Voice language: /)
})

test('managed entry is persisted, idempotent, updated on edits, and removed when disabled without touching user raw', async () => {
  const workspace = createCardPreparation().create({kind:'import', payload:raw()}), engine = defaultAssetEngineSettings(), pack = await syntheticPack()
  Object.values(pack.figures)[0].emotions=[{id:'joy',label:'喜悦',guidance:'Gentle'}] // private fork: only authored guidance creates a figure entry.
  const user = structuredClone(workspace.raw.character_book.entries[0])
  assert.equal((await syncPreparedCardBubbles(workspace, cardPath, engine, [pack])).changed, true)
  assert.equal(managed(workspace).length, 1)
  assert.doesNotMatch(managed(workspace)[0].content, /soyo_haruhikage/) // private fork
  // private fork: old managed entries containing visual-state instructions are replaced, not duplicated.
  managed(workspace)[0].content += '\ncalm_variant'
  assert.equal((await syncPreparedCardBubbles(workspace, cardPath, engine, [pack])).changed, true)
  assert.equal(managed(workspace).length, 1)
  assert.doesNotMatch(managed(workspace)[0].content, /calm_variant/)
  const once = structuredClone(workspace)
  assert.equal((await syncPreparedCardBubbles(workspace, cardPath, engine, [pack])).changed, false)
  assert.deepEqual(workspace, once)
  Object.values(pack.figures)[0].name = 'Renamed'
  engine.dialogue.injection.extra = 'New extra'
  await syncPreparedCardBubbles(workspace, cardPath, engine, [pack])
  assert.equal(managed(workspace).length, 1)
  assert.match(figureEntries(workspace)[0].content, /Renamed/)
  assert.match(managed(workspace)[0].content, /New extra/)
  // private fork (card-centric): a card with stage settings owns its bubble switch; the global one no longer applies.
  engine.dialogue.enabled = false
  await syncPreparedCardBubbles(workspace, cardPath, engine, [pack])
  assert.equal(managed(workspace).length, 1)
  engine.stageToggles = {...engine.stageToggles,dialogue:false,voice:false,stage:false}
  await syncPreparedCardBubbles(workspace, cardPath, engine, [pack])
  assert.deepEqual(workspace.raw.character_book.entries, [user])
})

test('offline pack projection retains cast names but never invents figure voice data', async () => {
  const reads = [], stage = createCardStage({profileData:{readJson:async path => {reads.push(path); return {raw:raw()}}},
    getEngine:defaultAssetEngineSettings, getAssetLibrary:() => ({getPackSnapshot:async () => {throw Error('offline')}})})
  const config = await stage.bubbles.read(cardPath)
  assert.deepEqual(config.characters,[]) // private fork: offline packs cannot invent a card cast.
  assert.deepEqual(config.spriteDialogue, [])
  assert.doesNotMatch(bubbleInstruction(config), /\[Voice language: Japanese\]/)
  assert.deepEqual(reads, ['resources/' + cardPath])
})

test('bindings save synchronizes before returning its new CAS token, but not after a rejected save', async () => {
  const prep = createCardPreparation(), engine = defaultAssetEngineSettings()
  let workspace = prep.create({kind:'import', payload:raw()}), calls = 0
  const boundary = createCardAssetBoundary({ctx:{get:() => null}, listCards:async () => [{path:cardPath}], readWorkspace:async () => workspace,
    updateCard:async (_path, patch, _revision, rawOperations) => {workspace = prep.update({kind:'card', card:workspace, patch, rawOperations}).card},
    syncBubbles:async path => {calls++; await syncPreparedCardBubbles(workspace, path, engine)}})
  const before = await boundary.snapshot(cardPath)
  const after = await boundary.update({path:cardPath, expectedRevision:before.revision, patch:{assetBindings:{boundPackIds:[]}}})
  assert.equal(calls, 1)
  assert.equal(managed(workspace).length, 1)
  assert.equal(after.revision, cardAssetWorkspaceRevision(workspace))
  await assert.rejects(boundary.update({path:cardPath, expectedRevision:before.revision, patch:{assetBindings:{boundPackIds:[]}}}), {code:'REVISION_CONFLICT'})
  assert.equal(calls, 1)
})

test('figure notifications refresh all dependent cards, remain idempotent and isolate failures', async () => {
  // private fork: no active chat is required for a card's managed entry to stay current.
  const engine = defaultAssetEngineSettings(), pack = await syntheticPack(), prep = createCardPreparation()
  const cards = new Map(['a','b','unbound'].map(name => ['cards/' + name + '.json',prep.create({kind:'import',payload:raw()})]))
  cards.get('cards/unbound.json').raw.extensions.dsh_tavern.assetBindings.boundPackIds = []
  let listener, stopped = false
  const calls = [], errors = []
  const watcher = watchFigureBubbleBooks({service:{subscribe(fn) {listener = fn; return () => {stopped = true}}},
    listCards:async () => ['cards/bad.json',...cards.keys()],
    readWorkspace:async path => {if (path === 'cards/bad.json') throw Error('unavailable'); return cards.get(path)},
    sync:async path => {calls.push(path); await syncPreparedCardBubbles(cards.get(path),path,engine,[pack])},
    onError:(error,path) => errors.push([error.message,path])})
  const event = {packId:pack.manifest.id,figures:pack.manifest.figures,revision:'r1'}
  Object.values(pack.figures)[0].emotions = [{id:'joy',label:'喜悦',guidance:'Gentle'}]
  listener(event); await watcher.drain()
  assert.deepEqual(calls,['cards/a.json','cards/b.json'])
  assert.deepEqual(errors,[['unavailable','cards/bad.json']])
  for (const path of calls) assert.match(figureEntries(cards.get(path))[0].content,/Gentle/)
  const once = structuredClone([...cards])
  listener(event); await watcher.drain()
  assert.deepEqual([...cards],once)
  Object.values(pack.figures)[0].emotions = [{id:'joy',label:'喜悦',guidance:'Brisk'}]
  listener({...event,revision:'r2'}); await watcher.drain()
  for (const path of new Set(calls)) assert.match(figureEntries(cards.get(path))[0].content,/Brisk/)
  assert.equal(managed(cards.get('cards/unbound.json')).length,0)
  watcher.dispose(); listener(event); await watcher.drain()
  assert.equal(stopped,true)
  assert.equal(calls.length,6)
})

test('production settings and bindings save paths retain persisted synchronization', async () => {
  const source = await readFile(new URL('../tavern-plugin/lib/index.js', import.meta.url), 'utf8')
  assert.match(source, /syncBubbles:path => dialogueBubbles.sync\(worldBooks, path\)/)
  assert.match(source, /watchFigureBubbleBooks\(\{service:child.get\('assetLibrary'\)/)
  assert.match(source, /case 'saveAssetEngineSettings':[\s\S]*?await dialogueBubbles.sync\(worldBooks, path\)/)
})
