// private fork (owner 2026-10 r2): 舞台设置 → BGM / 音效 / 环境音 each have one switch, and a switch takes effect at once.
// Before r2 the open stage only learnt of a change on the 60 s dialogue-settings poll, and 音效 / 环境音 were not in the
// settings it watches at all, so they changed only on the next turn ("seems not to work"). Synthetic data only.
import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'
import { cardExtension } from './fixtures/asset-packs/pack.mjs'
import { cardEngineSettings } from '../tavern-plugin/lib/domain/card-stage-settings.js'
import { defaultAssetEngineSettings } from '../tavern-plugin/lib/domain/asset-engine-settings.js'
import { cardBubbleConfig } from '../tavern-plugin/lib/fork-card-stage.js'

const client = name => readFile(new URL('../tavern-plugin/src/client/' + name, import.meta.url), 'utf8')
const between = (text, start, end) => { const a = text.indexOf(start), b = text.indexOf(end, a); assert.ok(a >= 0 && b > a, start); return text.slice(a, b) }

test('a sound switch changes the dialogue settings the open stage watches, and turns the director dimension off', () => {
  const engine = defaultAssetEngineSettings()
  const config = toggles => cardBubbleConfig({extensions:{dsh_tavern:cardExtension()}}, {...engine,stageToggles:{...engine.stageToggles,...toggles}}).stage
  const on = config({})
  assert.deepEqual([on.music, on.sfx, on.ambience], [true, true, true])
  for (const [key, dimension] of [['music', 'music'], ['sfx', 'sfx'], ['ambience', 'soundscape']]) {
    const off = config({[key]:false})
    assert.equal(off[key], false, key + ' reaches config.stage')
    assert.notEqual(JSON.stringify(off), JSON.stringify(on), key + ' changes the settings key')
    assert.equal(cardEngineSettings({...engine,stageToggles:{...engine.stageToggles,[key]:false}}, cardExtension()).dimensions[dimension], false, key + ' turns the director off')
  }
})

test('a card save from the workbench reloads the dialogue settings and re-projects the open stage', async () => {
  const launcher = await client('fork-asset-launcher.js'), calls = [], dispatched = []
  const source = {sessionId:'s', turn:3}
  const context = {
    rpc: async (method, args, sessionId) => { calls.push(['rpc', method, sessionId]); return {ok:method} },
    forkBubbleStore: {load: (id, renew) => calls.push(['load', id, renew])},
    forkStageSessions: {get: id => id === 's' ? {getSnapshot: () => ({source}), dispatch: event => dispatched.push(event)} : null}
  }
  vm.runInNewContext(between(launcher, 'function forkCardStageSaved', 'function ForkPackWorkbench') + ';this.make=forkWorkbenchRpc;', context)
  const rpc = context.make('s')
  assert.deepEqual(await rpc('getCardAssetBindings', {path:'cards/a.json'}), {ok:'getCardAssetBindings'})
  assert.deepEqual(calls, [['rpc', 'getCardAssetBindings', 's']], 'reads do not refresh anything')
  await rpc('saveCardAssetBindings', {path:'cards/a.json'})
  assert.deepEqual(calls.slice(1), [['rpc', 'saveCardAssetBindings', 's'], ['load', 's', true]])
  assert.deepEqual(JSON.parse(JSON.stringify(dispatched)), [{type:'REFRESH_BEGIN', source}])
  await context.make('')('saveCardAssetBindings', {})
  assert.equal(dispatched.length, 1, 'no session, no refresh')
})

test('a renewal supersedes a dialogue-settings read already in flight', async () => {
  const bubbles = await client('fork-bubbles.js'), pending = []
  const context = {rpc: () => new Promise(resolve => pending.push(resolve)), setInterval, clearInterval}
  vm.runInNewContext(between(bubbles, 'const forkBubbleStore', 'function useForkBubbles') + ';this.store=forkBubbleStore;', context)
  const store = context.store
  store.load('s')                       // the 60 s poll's read, sent before the save
  store.load('s')                       // a plain load while it is in flight sends nothing new
  assert.equal(pending.length, 1)
  store.load('s', true)                 // the save's renewal sends a fresh read
  assert.equal(pending.length, 2)
  pending[1]({config:{stage:{sfx:false}}})
  await new Promise(resolve => setImmediate(resolve))
  pending[0]({config:{stage:{}}})       // the older read lands last and must not win
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(store.get('s'), {config:{stage:{sfx:false}}})
})
