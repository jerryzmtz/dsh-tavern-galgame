import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {createStageRuntimeHarness, runtimeSource, runtimePage, runtimeText, runtimeDirection, runtimeGroups} from './helpers/stage-runtime-harness.mjs'
const require = createRequire(import.meta.url)
const {stageRuntimeIndicators} = require('../tavern-plugin/src/client/fork-stage-runtime.cjs')
const {createStageSessionOwner} = require('../tavern-plugin/src/client/fork-stage-session.cjs')

// Stage acceptance 2026-10-13 (F2-F4): persistent state is carried, never "whatever was last viewed".
const pages = [runtimePage(1), runtimePage(2)]
const previousSource = runtimeSource({turn: 14, sourceKey: 'turn-14'})
const previous = runtimeDirection(5, 2, {phase: 'done', complete: true, bindingKey: 'binding-14', prefixRevision: 9, token: {digest: 'd14'}, assetRevision: 3})
const failed = {phase: 'error', revision: 7, generation: 0, error: 'Stage read point changed'}

function failedTurn(h, source = runtimeSource({turn: 15, sourceKey: 'turn-15'}), mode = 'history') {
  h.dispatch({type: mode === 'history' ? 'HISTORY_JUMP' : 'TURN_CHANGED', source, text: runtimeText(1, pages), anchor: pages[0].anchor})
  h.replyRead(h.state.observation.flight, failed)
  return source
}

test('a failed direction projects the predecessor end (its baseline), whatever was viewed before', () => {
  const h = createStageRuntimeHarness()
  try {
    const source = failedTurn(h)
    assert.equal(h.effects('project').length, 0, 'no prefix: nothing of this turn is projected')
    const request = h.last('resolve-carry')
    assert.deepEqual(request.token.source, source)
    h.dispatch({type: 'CARRY_RESULT', token: request.token, carry: {source: previousSource, envelope: previous}})
    const project = h.last('project')
    assert.equal(project.at, 2, 'folded at the predecessor end')
    assert.deepEqual(project.carry, {source: previousSource, token: previous.token, assetRevision: 3})
    assert.equal(project.transition, 'snap')
    assert.deepEqual(project.token.source, source, 'the request still belongs to the viewed turn')
    h.readyProjection(project.token, runtimeGroups('end-14'))
    assert.equal(h.state.accepted.scene.identity, 'end-14')
    // Paging inside the failed turn keeps projecting the same carried state.
    h.dispatch({type: 'PAGE', index: 1})
    assert.equal(h.last('project').at, 2)
    assert.equal(h.last('project').carry.source, previousSource)
    assert.equal(h.effects('prepare-one-shot').length, 0, 'a carry never replays one-shots')
  } finally {h.dispose()}
})

test('the same failed turn re-entered (history, live, refresh) resolves the same carry again', () => {
  for (const mode of ['history', 'live']) {
    const h = createStageRuntimeHarness()
    try {
      failedTurn(h, undefined, mode)
      assert.equal(h.effects('resolve-carry').length, 1)
      h.dispatch({type: 'CARRY_RESULT', token: h.last('resolve-carry').token, carry: {source: previousSource, envelope: previous}})
      h.dispatch({type: 'HISTORY_JUMP', source: previousSource, text: runtimeText(2, pages), anchor: pages[0].anchor})
      failedTurn(h, runtimeSource({turn: 15, sourceKey: 'turn-15', generation: 1}), mode)
      assert.equal(h.effects('resolve-carry').length, 2, 'a new visit resolves its baseline again, no stale carry')
    } finally {h.dispose()}
  }
})

test('a stale carry answer and a later real prefix both win over the carry correctly', () => {
  const h = createStageRuntimeHarness()
  try {
    failedTurn(h)
    const old = h.last('resolve-carry').token
    h.dispatch({type: 'HISTORY_JUMP', source: runtimeSource({turn: 16, sourceKey: 'turn-16'}), text: runtimeText(2, pages), anchor: pages[0].anchor})
    h.dispatch({type: 'CARRY_RESULT', token: old, carry: {source: previousSource, envelope: previous}})
    assert.equal(h.state.carry, null)
    assert.equal(h.effects('project').length, 0)
    // A missing (undirected, settled) turn also carries; a later directed prefix replaces it.
    h.replyRead(h.state.observation.flight, {phase: 'unknown', revision: 2, generation: 0})
    h.dispatch({type: 'CARRY_RESULT', token: h.last('resolve-carry').token, carry: {source: previousSource, envelope: previous}})
    assert.ok(h.last('project').carry)
    h.dispatch({type: 'DIRECTOR_SNAPSHOT', source: h.state.source, envelope: runtimeDirection(3, 1, {phase: 'done', complete: true})})
    assert.equal(h.last('project').carry, undefined)
    assert.equal(h.last('project').at, 1)
  } finally {h.dispose()}
})

test('a streaming turn never resolves a carry before its text settles', () => {
  const h = createStageRuntimeHarness()
  try {
    const source = runtimeSource({turn: 20, sourceKey: 'turn-20'})
    h.dispatch({type: 'SEND', source, text: runtimeText(1, pages, true)})
    h.replyRead(h.state.observation.flight, {phase: 'unknown', revision: 1, generation: 0})
    assert.equal(h.effects('resolve-carry').length, 0)
  } finally {h.dispose()}
})

test('R10: the direction failure warns on every visit, after projection results and refreshes', () => {
  const h = createStageRuntimeHarness()
  try {
    failedTurn(h)
    assert.match(stageRuntimeIndicators(h.state).error, /Stage read point changed/)
    h.dispatch({type: 'CARRY_RESULT', token: h.last('resolve-carry').token, carry: {source: previousSource, envelope: previous}})
    h.readyProjection(h.last('project').token, runtimeGroups('end-14'))
    h.dispatch({type: 'REFRESH_BEGIN', source: h.state.source})
    assert.equal(h.state.pending.error, null)
    assert.match(stageRuntimeIndicators(h.state).error, /Stage read point changed/, 'clearing transient errors keeps the failure')
    h.dispatch({type: 'HISTORY_JUMP', source: previousSource, text: runtimeText(2, pages), anchor: pages[0].anchor})
    h.replyRead(h.state.observation.flight, previous)
    assert.equal(stageRuntimeIndicators(h.state).error, null)
    failedTurn(h, runtimeSource({turn: 15, sourceKey: 'turn-15'}))
    assert.match(stageRuntimeIndicators(h.state).error, /Stage read point changed/, 'returning shows it again')
    // A later successful direction replaces the failure text.
    h.dispatch({type: 'DIRECTOR_SNAPSHOT', source: h.state.source, envelope: runtimeDirection(9, 2, {phase: 'done', complete: true})})
    assert.equal(stageRuntimeIndicators(h.state).error, null)
  } finally {h.dispose()}
})

test('navigation into a streamed latest turn stages its page; only this visit\'s own page is fenced', () => {
  const h = createStageRuntimeHarness()
  try {
    // Reader on a history page while the latest turn was streamed (F3).
    const latest = runtimeSource({turn: 18, sourceKey: 'turn-18'})
    h.dispatch({type: 'HISTORY_JUMP', source: previousSource, text: runtimeText(1, pages), anchor: pages[0].anchor})
    h.replyRead(h.state.observation.flight, previous)
    h.readyProjection(h.last('project').token, runtimeGroups('departure'))
    const stream = {version: 1, operationId: 'op', epoch: 0}
    // A SEND (or resume) pulls the historical cursor forward while the director streams.
    h.dispatch({type: 'SEND', source: latest, text: runtimeText(2, pages, true)})
    const before = h.effects('project').length
    h.replyRead(h.state.observation.flight, runtimeDirection(1, 1, {streaming: true, binding: {stream}}))
    assert.equal(h.effects('project').length, before + 1, 'the departure presentation is not "the page on screen"')
    h.readyProjection(h.last('project').token, runtimeGroups('turn-18'))
    assert.equal(h.state.accepted.scene.identity, 'turn-18')
    // From here on, late deltas of this live stream never restage the page already shown.
    h.dispatch({type: 'DIRECTOR_SNAPSHOT', source: latest, envelope: runtimeDirection(2, 2, {streaming: true, binding: {stream}})})
    assert.equal(h.effects('project').length, before + 1)
    // RESUME_LIVE from a history page of the streaming turn behaves the same.
    h.dispatch({type: 'HISTORY_JUMP', source: previousSource, text: runtimeText(3, pages), anchor: pages[0].anchor})
    h.dispatch({type: 'RESUME_LIVE', source: latest, text: runtimeText(4, pages, true), anchor: pages[0].anchor})
    const resumed = h.effects('project').length
    h.replyRead(h.state.observation.flight, runtimeDirection(3, 2, {streaming: true, binding: {stream}}))
    assert.equal(h.effects('project').length, resumed + 1)
  } finally {h.dispose()}
})

test('session owner resolves the nearest earlier complete direction, skipping failed and missing turns', async () => {
  const listeners = new Set(), sessionId = 'session-1'
  const row = turn => ({turn, nativeTurn: turn, parts: [], units: [], text: runtimeText(turn, pages)})
  const index = new Map([[13, row(13)], [14, row(14)], [15, row(15)], [16, row(16)]])
  const envelopes = {16: failed, 15: {phase: 'unknown', revision: 1}, 14: previous, 13: previous}
  const reads = [], dispatched = []
  const owner = createStageSessionOwner({
    sessions: {list: {getSnapshot: () => ({byId: {[sessionId]: {}}, current: sessionId}), subscribe: listener => {listeners.add(listener); return () => listeners.delete(listener)}},
      binding: () => ({session: {getSnapshot: () => ({running: false}), subscribe: () => () => {}}})},
    resolveChat: () => ({getSnapshot: () => ({nodes: new Map(), order: []}), subscribe: () => () => {}}),
    views: {select: () => ({getSnapshot: () => ({view: null}), subscribe: () => () => {}}), invalidate() {}},
    coordination: {getSnapshot: () => ({view: null}), subscribe: () => () => {}},
    settings: {get: () => ({}), load() {}, subscribe: () => () => {}},
    preferences: {get: () => ({}), subscribe: () => () => {}},
    storyTurn: (_view, turn) => turn,
    createIndex: () => ({reconcile: () => index, getSnapshot: () => index, clear() {}}),
    readHistory: async args => {reads.push(args.turn); return envelopes[args.turn]},
    primeHistory: async (_source, _text, value) => value,
    runEffect: (_id, intent) => dispatched.push(intent)
  })
  owner.start()
  try {
    const store = owner.get(sessionId)
    const source = {...store.getSnapshot().latestSource, turn: 17}
    store.dispatch({type: 'HISTORY_JUMP', source, text: runtimeText(1, pages), anchor: pages[0].anchor})
    store.dispatch({type: 'DIRECTOR_READ_RESULT', token: store.getSnapshot().observation.flight, envelope: failed})
    for (let i = 0; i < 20 && store.getSnapshot().carryRequest; i++) await new Promise(resolve => setTimeout(resolve, 0))
    assert.deepEqual(reads, [16, 15, 14], 'walks back only until a complete direction')
    assert.equal(store.getSnapshot().carry.source.turn, 14)
    assert.equal(store.getSnapshot().carry.envelope, previous)
    assert.equal(dispatched.filter(intent => intent.type === 'project').at(-1).carry.source.turn, 14)
  } finally {owner.dispose()}
})

test('runner projects a carry from the predecessor turn under its token, with the turn-end close-up reset', async () => {
  const {createStageRuntimeStore} = require('../tavern-plugin/src/client/fork-stage-runtime-store.cjs')
  const {createStageResourceRunner} = require('../tavern-plugin/src/client/fork-stage-resource-runner.cjs')
  const {createStageResourceOwner} = require('../tavern-plugin/src/client/fork-stage-resources.cjs')
  const reads = [], cameras = []
  const owner = createStageResourceOwner({urls: {createObjectURL: () => 'blob:x', revokeObjectURL() {}}, service: {}, fetch: async () => new Response('{}')})
  const runner = createStageResourceRunner({owner, clock: {setTimeout: () => 0, clearTimeout() {}}, idle: async () => false,
    read: async args => {
      reads.push(args)
      return {status: 'ready', directionToken: previous.token, value: {state: {cast: [], camera: {mode: 'close', actor: 'a'}, figureScale: {version: 6, scene: 0, hMax: 150}},
        scene: {}, characters: [], avatars: [], audio: {music: null, soundscape: null}, widgets: []}}
    },
    visual: value => {cameras.push(value.state.camera); return {scene: {state: value.state}, lighting: null, figures: [], ruler: value.state.figureScale}}})
  const store = createStageRuntimeStore({runEffect: (intent, dispatch, getSnapshot) => runner.onEffect('session-1', intent, dispatch, getSnapshot)})
  try {
    const source = runtimeSource({turn: 15, sourceKey: 'turn-15'})
    store.dispatch({type: 'HISTORY_JUMP', source, text: runtimeText(1, pages), anchor: pages[0].anchor})
    store.dispatch({type: 'DIRECTOR_READ_RESULT', token: store.getSnapshot().observation.flight, envelope: failed})
    store.dispatch({type: 'CARRY_RESULT', token: store.getSnapshot().carryRequest, carry: {source: previousSource, envelope: previous}})
    for (let i = 0; i < 50 && store.getSnapshot().projection; i++) await new Promise(resolve => setTimeout(resolve, 0))
    assert.equal(reads.length, 1)
    assert.equal(reads[0].turn, 14)
    assert.equal(reads[0].at, 2)
    assert.deepEqual(reads[0].expectedDirectionToken, previous.token)
    assert.deepEqual(cameras, [{mode: 'reset', actor: null}])
    assert.equal(store.getSnapshot().projection, null)
    assert.deepEqual(store.getSnapshot().accepted.layout.state.camera, {mode: 'reset', actor: null})
  } finally {store.dispose(); runner.dispose()}
})

// private fork (B4, madoka-1 #11): a regeneration that fails mid-body (content filter) never leaves a blank stage.
// The director was read as missing while the body streamed; the failure itself must request the baseline carry.
test('a failed regeneration carries the last valid scene instead of a blank stage', () => {
  const h = createStageRuntimeHarness()
  try {
    const source = runtimeSource({turn: 12, sourceKey: 'turn-12'})
    h.dispatch({type: 'SEND', source, text: runtimeText(1, pages, true)})
    h.replyRead(h.state.observation.flight, {phase: 'unknown', revision: 1, generation: 0})
    assert.equal(h.effects('resolve-carry').length, 0, 'still writing: not yet undirected')
    h.dispatch({type: 'SEND_FAILED', source, error: 'content_filter'})
    const request = h.last('resolve-carry')
    assert.ok(request, 'the failure requests the baseline')
    h.dispatch({type: 'CARRY_RESULT', token: request.token, carry: {source: previousSource, envelope: previous}})
    h.readyProjection(h.last('project').token, runtimeGroups('end-11'))
    assert.equal(h.state.accepted.scene.identity, 'end-11')
    assert.ok(stageRuntimeIndicators(h.state).error, 'the failure is still shown')
  } finally { h.dispose?.() }
})