// private fork (stuck-loading, live acceptance 2026-10-14 #1): the stage must never stay on 「仍在载入…」 because a
// projection names a direction the host no longer serves. Real reducer/store and real resource runner; only the
// host RPCs, the media owner and the clock are local fixtures.
import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {createFakeClock, runtimeSource, runtimePage, runtimeText} from './helpers/stage-runtime-harness.mjs'
const require = createRequire(import.meta.url)
const {createStageRuntimeStore} = require('../tavern-plugin/src/client/fork-stage-runtime-store.cjs')
const {createStageResourceRunner} = require('../tavern-plugin/src/client/fork-stage-resource-runner.cjs')

const drain = async () => {for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve))}
const pages = [runtimePage(1), runtimePage(2)]
const turn6 = runtimeSource({turn: 6, sourceKey: 'turn-6'})
const turn7 = runtimeSource({turn: 7, sourceKey: 'turn-7', generation: 2})
const token = (digest, extra = {}) => ({sourceKey: digest, branchId: 'branch-1', generation: 0, bindingKey: 'binding-' + digest, prefixRevision: 1, digest, ...extra})
const end6 = {phase: 'done', revision: 1, generation: 0, bindingKey: 'binding-end6', prefixRevision: 1, through: 2, complete: true,
  baseline: {}, entries: [], assetRevision: 1, token: token('end6')}
// The streaming director's prefix for the regenerated body: valid only while that body streams.
const streamPrefix = {phase: 'partial', revision: 1, generation: 0, bindingKey: 'binding-stream', prefixRevision: 1, through: 1, complete: false,
  baseline: {}, entries: [], assetRevision: 1, streaming: true, binding: {stream: {version: 1, operationId: 'op', epoch: 0}}, token: token('stream')}
// After the body is stopped the host serves no direction for the turn (no binding, no token).
const stopped = {phase: 'unknown', revision: 2, generation: 0, assetRevision: 1}

function stage() {
  const clock = createFakeClock(), served = new Map(), held = [], requests = []
  let director = streamPrefix, live = new Set(['end6', 'stream'])
  const presentation = scene => ({status: 'ready', value: {scene: {identity: scene}, state: {}, characters: [], avatars: [], widgets: [],
    audio: {music: null, soundscape: null}, performance: null}})
  const runner = createStageResourceRunner({clock, idle: async () => false,
    // Already prepared resources: the owner answers at once (warm cache).
    owner: {prepare: async value => ({value, descriptors: value, pins: [], release() {}}), isPrepared: () => true, revoke() {}, dispose() {}},
    visual: value => ({scene: value.scene, lighting: {}, figures: [], ruler: null}),
    read: args => {
      requests.push(args)
      const answer = () => live.has(args.expectedDirectionToken.digest)
        ? {...presentation(args.expectedDirectionToken.digest === 'end6' ? 'end-6' : 'stream-7'), directionToken: args.expectedDirectionToken}
        : {status: 'stale', directionToken: null}
      if (held.hold) return new Promise(resolve => held.push(() => resolve(answer())))
      return Promise.resolve(answer())
    }})
  const store = createStageRuntimeStore({runEffect(intent, dispatch, getSnapshot) {
    switch (intent.type) {
    case 'read-director': {
      const envelope = director
      queueMicrotask(() => dispatch({type: 'DIRECTOR_READ_RESULT', token: intent.token,
        envelope: envelope.revision > intent.sinceRevision ? envelope : null}))
      break
    }
    case 'schedule-read': served.set(intent.token.id, clock.setTimeout(() => dispatch({type: 'READ_TIMER', token: intent.token}), intent.delay)); break
    case 'cancel-timer': clock.clearTimeout(served.get(intent.token.id)); break
    case 'resolve-carry': queueMicrotask(() => dispatch({type: 'CARRY_RESULT', token: intent.token, carry: {source: turn6, envelope: end6}})); break
    case 'watch-director': case 'unwatch-director': case 'cancel-read': break
    default: runner.onEffect('session-1', intent, dispatch, getSnapshot)
    }
  }})
  return {clock, store, held, requests, runner,
    host(next) { director = next.director ?? director; if (next.live) live = new Set(next.live) },
    async settle(ms) {for (let at = 0; at < ms; at += 100) {clock.advance(100); await drain()}},
    // The stage's mount: STAGE_OPEN, then its bookmark restores the saved page.
    async enter(page) { store.dispatch({type: 'STAGE_OPEN', opened: true}); store.dispatch({type: 'PAGE', index: page}); await drain() },
    async leave() { store.dispatch({type: 'STAGE_OPEN', opened: false}); await drain() },
    // The regenerated body streams (its director streams a prefix), then the player stops it.
    async regenerate() {
      store.dispatch({type: 'SEND', source: turn7, text: runtimeText(1, pages, true)}); await drain()
    },
    async stop() {
      director = stopped; live = new Set(['end6'])
      store.dispatch({type: 'TEXT_RECONCILE', source: turn7, text: runtimeText(2, pages)})
      store.dispatch({type: 'SEND_CANCELLED', source: turn7}); await drain()
    },
    dispose() { store.dispose(); runner.dispose() }
  }
}
function settled(h, label) {
  const state = h.store.getSnapshot()
  assert.deepEqual({projection: state.pending.projection, resources: state.pending.resources}, {projection: false, resources: false}, label + ': pending settles')
  assert.equal(state.projection, null, label + ': no request is left outstanding')
  // An undirected (stopped) turn presents its baseline, the previous turn's end; it is never blank.
  assert.equal(state.accepted.scene?.identity, 'end-6', label + ': the baseline is shown')
  const before = h.requests.length
  return async () => { await h.settle(10000); assert.ok(h.requests.length - before <= 2, label + ': the runner does not keep asking for a dead direction') }
}

test('the stage settles when its direction is gone: first entry with ready resources, and enter / leave mid-load / re-enter', async () => {
  // First entry: the body was regenerated and stopped while the stage was closed; every resource is already prepared.
  const first = stage()
  try {
    await first.leave()
    await first.regenerate()
    await first.stop()
    await first.enter(1)
    await first.settle(3000)
    await settled(first, 'first entry')()
  } finally {first.dispose()}

  // Re-entry: enter during the regeneration, leave while the page is still loading, stop the body, come back.
  const again = stage()
  try {
    await again.enter(0)
    await again.regenerate()
    again.held.hold = true
    again.store.dispatch({type: 'PAGE', index: 1}); await again.settle(200)
    assert.equal(again.store.getSnapshot().pending.projection, true, 'the page is mid-load')
    await again.leave()
    await again.stop()
    again.held.hold = false
    again.held.splice(0).forEach(resolve => resolve())
    await again.enter(0)
    await again.settle(3000)
    await settled(again, 're-entry')()
    // A later page turn in the stopped turn keeps the carried baseline instead of asking for the dead stream again.
    again.store.dispatch({type: 'PAGE', index: 1}); await again.settle(2000)
    await settled(again, 'page turn')()
    // The carried predecessor was redirected meanwhile: its old token is answered stale. The request settles and
    // keeps what is on screen instead of re-asking for the dead token forever.
    again.host({live: ['end6-redirected']})
    again.store.dispatch({type: 'REFRESH_BEGIN', source: turn7}); await again.settle(2000)
    await settled(again, 'stale carry')()
  } finally {again.dispose()}
})
