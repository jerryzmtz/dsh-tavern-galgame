import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import vm from 'node:vm'
import {createFakeClock, createControllableBinding, createStageRuntimeHarness,
  runtimeSource as source, runtimePage as page, runtimeText as text,
  runtimeDirection as direction, runtimeGroups as groups} from './helpers/stage-runtime-harness.mjs'
const require = createRequire(import.meta.url)
const {createStageRuntimeStore, stageRuntimeShallowEqual} = require('../tavern-plugin/src/client/fork-stage-runtime-store.cjs')

test('selector equality preserves object reference and text chunks never notify accepted scene', () => {
  const store = createStageRuntimeStore(), s = source()
  const scene = store.select(state => state.accepted.scene)
  const textView = store.select(state => ({pages: state.text.pages, anchor: state.cursor.anchor}), stageRuntimeShallowEqual)
  let scenes = 0, texts = 0
  scene.subscribe(() => scenes++)
  const unsubscribe = textView.subscribe(() => texts++)
  const oldText = textView.getSnapshot()
  store.dispatch({type: 'SEND_ACK', source: s})
  assert.notEqual(textView.getSnapshot(), oldText)
  for (let revision = 1; revision <= 10; revision++) {
    store.dispatch({type: 'TEXT_APPEND', source: s, text: text(revision, [page(1)], true)})
  }
  assert.equal(scenes, 0)
  assert.equal(texts, 11)
  const snapshot = textView.getSnapshot()
  store.dispatch({type: 'READ_FAILED', source: s, error: 'network'})
  assert.equal(textView.getSnapshot(), snapshot)
  unsubscribe()
  store.dispatch({type: 'TEXT_APPEND', source: s, text: text(11, [page(1), page(2)])})
  assert.equal(texts, 11)
  scene.dispose(); textView.dispose(); store.dispose()
})

test('all selectors publish a coherent commit before listeners/effects, with reentrant dispatch queued', () => {
  const log = [], s = source()
  const store = createStageRuntimeStore({runEffect(intent, dispatch, getSnapshot) {
    if (intent.type === 'read-director') {
      log.push('effect:' + getSnapshot().source.generation)
      dispatch({type: 'DIRECTOR_READ_RESULT', token: intent.token, envelope: {revision: 1, phase: 'off'}})
    }
  }})
  const sourceView = store.select(state => state.source)
  const phaseView = store.select(state => state.director.phase)
  const textView = store.select(state => state.text.hasReadableText)
  sourceView.subscribe(() => {
    assert.equal(phaseView.getSnapshot(), 'unknown')
    log.push('source')
    store.dispatch({type: 'TEXT_APPEND', source: s, text: text(1, [page(1)])})
    assert.equal(textView.getSnapshot(), false)
  })
  textView.subscribe(() => log.push('text'))
  phaseView.subscribe(() => log.push('phase:' + phaseView.getSnapshot()))
  store.dispatch({type: 'SEND_ACK', source: s})
  assert.deepEqual(log, ['source', 'effect:1', 'text', 'phase:off'])
  assert.equal(store.getSnapshot().director.phase, 'off')
})

test('listener failure does not lose effect intents or leave publication half complete', () => {
  const effects = [], store = createStageRuntimeStore({runEffect: intent => effects.push(intent)})
  const a = store.select(state => state.source), b = store.select(state => state.source)
  let notified = false
  const unsubscribe = a.subscribe(() => { throw new Error('subscriber failure') })
  b.subscribe(() => { notified = true })
  assert.throws(() => store.dispatch({type: 'SEND_ACK', source: source()}), /subscriber failure/)
  assert.equal(notified, true)
  assert.ok(effects.some(e => e.type === 'read-director'))
  assert.equal(a.getSnapshot(), b.getSnapshot())
  unsubscribe()
  store.dispatch({type: 'SEND_ACK', source: source({generation: 2})})
  assert.equal(store.getSnapshot().source.generation, 2)
})

test('dispose is idempotent and late resource completions are released rather than resurrected', () => {
  const h = createStageRuntimeHarness(), s = source()
  h.dispatch({type: 'SEND_ACK', source: s, text: text(1, [page(1, 0, {voice: {identity: 'voice'}})])})
  const voice = h.last('prepare-one-shot').token
  h.replyRead(h.state.observation.flight, direction(1, 1))
  const projection = h.last('project').token
  h.dispose(); h.dispose()
  const state = h.state
  h.readyProjection(projection, groups())
  h.readyOneShot(voice)
  h.dispatch({type: 'SEND_ACK', source: source({generation: 2})})
  assert.equal(h.state, state)
  assert.equal(h.effects('release-presentation').length, 1)
  assert.equal(h.effects('release-projection').length, 1)
  assert.equal(h.effects('release-one-shot').length, 1)
  assert.equal(h.effects('present').length, 0)
  assert.equal(h.effects('play-one-shot').length, 0)
  assert.equal(h.clock.size, 0)
  assert.equal(h.activeReads.length, 0)
})

test('CJS helpers can be concatenated in browser without require or replacing plugin exports', () => {
  const root = new URL('../tavern-plugin/src/client/', import.meta.url)
  const code = ['fork-stage-runtime.cjs', 'fork-stage-runtime-store.cjs']
    .map(file => readFileSync(new URL(file, root), 'utf8')).join('\n')
  const context = vm.createContext({window: {}, module: {exports: {apply: 'plugin'}}})
  vm.runInContext(code + '\nglobalThis.store = createStageRuntimeStore();', context)
  assert.equal(context.module.exports.apply, 'plugin')
  assert.equal(context.store.getSnapshot().source, null)
})

test('fake clock orders same-time callbacks, cancellation and recursively scheduled timers deterministically', () => {
  const clock = createFakeClock(), calls = []
  clock.setTimeout(() => { calls.push(['a', clock.now]); clock.setTimeout(() => calls.push(['c', clock.now]), 0) }, 10)
  const cancelled = clock.setTimeout(() => calls.push('wrong'), 5)
  clock.setTimeout(() => calls.push(['b', clock.now]), 10)
  clock.clearTimeout(cancelled)
  clock.advance(9)
  assert.deepEqual(calls, [])
  clock.advance(1)
  assert.deepEqual(calls, [['a', 10], ['b', 10], ['c', 10]])
  assert.equal(clock.size, 0)
  assert.throws(() => clock.advance(-1), /Invalid advance/)
})

test('controllable bindings retain snapshots and unsubscribe cleanly for later adapter timelines', () => {
  const binding = createControllableBinding({revision: 1})
  const seen = []
  const unsubscribe = binding.subscribe(() => seen.push(binding.getSnapshot()))
  const next = {revision: 2}
  binding.publish(next)
  unsubscribe(); binding.publish({revision: 3})
  assert.deepEqual(seen, [next])
  assert.equal(binding.subscribers, 0)
})
