import test from 'node:test'
import assert from 'node:assert/strict'
import {createStageRuntimeHarness, runtimeSource as source, runtimePage as page,
  runtimeText as text, runtimeDirection as direction} from './helpers/stage-runtime-harness.mjs'

for (const phase of ['unknown', 'off', 'done', 'error']) {
  test('missed notification after ' + phase + ' still converges without remount/generation', () => {
    const h = createStageRuntimeHarness(), s = source()
    h.dispatch({type: 'SEND_ACK', source: s})
    h.replyRead(h.state.observation.flight, {revision: 1, phase})
    assert.equal(h.watches.size, 1)
    assert.equal(h.clock.size, 1)
    assert.equal(h.last('schedule-read').delay, phase === 'unknown' ? 700 : 5000)
    // No running notification, no wake at all: the reconciliation timer finds done.
    h.publish(s, direction(2, 1, {phase: 'done', complete: true}), {notify: false})
    h.clock.advance(h.last('schedule-read').delay)
    assert.equal(h.activeReads.length, 1)
    assert.equal(h.clock.size, 0)
    h.replyRead(h.state.observation.flight)
    assert.equal(h.state.director.phase, 'done')
    assert.equal(h.state.director.revision, 2)
    assert.equal(h.effects('watch-director').length, 1)
    assert.equal(h.last('read-director').sinceRevision, 1)
    assert.ok(h.effects('read-director').every(e => e.readOnly))
    h.dispose()
    assert.equal(h.clock.size, 0)
    assert.equal(h.watches.size, 0)
  })
}

test('off -> enabled/running -> prefix -> done, coalesced single-flight notifications and unchanged reads', () => {
  const h = createStageRuntimeHarness(), s = source()
  h.dispatch({type: 'SEND_ACK', source: s})
  const first = h.state.observation.flight
  for (let i = 0; i < 20; i++) h.dispatch({type: 'DIRECTOR_WAKE', source: s})
  assert.equal(h.activeReads.length, 1)
  assert.equal(h.effects('read-director').length, 1)
  h.replyRead(first, {revision: 1, phase: 'off'})
  assert.equal(h.activeReads.length, 1)
  assert.equal(h.effects('read-director').length, 2)
  h.replyRead(h.state.observation.flight, {revision: 2, phase: 'running'})
  assert.equal(h.last('schedule-read').delay, 700)
  h.publish(s, direction(3, 2))
  assert.equal(h.clock.size, 0)
  h.replyRead(h.state.observation.flight)
  assert.equal(h.state.director.phase, 'partial')
  h.publish(s, direction(4, 2, {phase: 'done', complete: true}))
  h.replyRead(h.state.observation.flight)
  const director = h.state.director
  h.clock.advance(5000)
  h.replyRead(h.state.observation.flight, null) // sinceRevision not modified
  assert.equal(h.state.director, director)
  assert.equal(h.activeReads.length, 0)
  assert.equal(h.clock.size, 1)
})

test('transport failures back off at 700..5000ms, stay read-only, and recover after reconnect', () => {
  const h = createStageRuntimeHarness(), s = source()
  h.dispatch({type: 'SEND_ACK', source: s})
  const delays = [700, 1400, 2800, 5000, 5000, 5000]
  for (const delay of delays) {
    h.dispatch({type: 'DIRECTOR_WAKE', source: s})
    h.failRead(h.state.observation.flight)
    assert.equal(h.last('schedule-read').delay, delay)
    assert.equal(h.clock.size, 1)
    assert.equal(h.activeReads.length, 0)
    h.clock.advance(delay)
    assert.equal(h.activeReads.length, 1)
  }
  h.dispatch({type: 'RECONCILE'})
  h.replyRead(h.state.observation.flight, direction(1, 1, {phase: 'done', complete: true}))
  // Dirty reconcile gets exactly one immediate follow-up.
  assert.equal(h.activeReads.length, 1)
  h.replyRead(h.state.observation.flight, null)
  assert.equal(h.state.pending.error, null)
  assert.equal(h.state.observation.failures, 0)
  assert.equal(h.last('schedule-read').delay, 5000)
})

test('hidden windows retain data reconciliation and closed converged stages keep their watch', () => {
  const h = createStageRuntimeHarness(), s = source()
  h.dispatch({type: 'SEND_ACK', source: s})
  h.replyRead(h.state.observation.flight, {revision: 1, phase: 'off'})
  // private fork: foreground policy sleeps presentation, not director data reads.
  h.dispatch({type: 'VISIBILITY', visible: false})
  assert.equal(h.clock.size, 1)
  h.clock.advance(5000)
  assert.equal(h.effects('read-director').length, 2)
  assert.equal(h.activeReads.length, 1)
  h.clock.advance(100000)
  assert.equal(h.effects('read-director').length, 2, 'hidden reconciliation stays single-flight')
  h.replyRead(h.state.observation.flight, {revision: 2, phase: 'off'})
  assert.equal(h.clock.size, 1)
  h.dispatch({type: 'VISIBILITY', visible: true})
  assert.equal(h.activeReads.length, 1)
  h.replyRead(h.state.observation.flight, null)
  h.dispatch({type: 'STAGE_OPEN', opened: false})
  assert.equal(h.clock.size, 0)
  assert.equal(h.watches.size, 1)
  h.publish(s, direction(3, 1))
  h.replyRead(h.state.observation.flight)
  assert.equal(h.state.director.phase, 'partial')
  assert.equal(h.clock.size, 1)
  h.dispatch({type: 'STAGE_OPEN', opened: true})
  assert.equal(h.activeReads.length, 1)
})

test('source replacement cancels timer/read; duplicate, out-of-order and regressing prefixes are ignored', () => {
  const h = createStageRuntimeHarness(), s = source()
  h.dispatch({type: 'SEND_ACK', source: s})
  const old = h.state.observation.flight
  const next = source({generation: 2})
  h.dispatch({type: 'SEND_ACK', source: next})
  const flight = h.state.observation.flight
  h.replyRead(old, direction(100, 6))
  assert.equal(h.state.observation.flight, flight)
  assert.equal(h.state.director.phase, 'unknown')
  h.dispatch({type: 'TEXT_APPEND', source: next, text: text(1, [page(1)], true)})
  h.replyRead(flight, direction(10, 4))
  const director = h.state.director, projected = h.effects('project').length
  for (const envelope of [direction(10, 4), direction(9, 4), direction(11, 3), direction(11, 5, {prefixRevision: 9})]) {
    h.dispatch({type: 'DIRECTOR_SNAPSHOT', source: next, envelope})
    assert.equal(h.state.director, director)
    assert.equal(h.effects('project').length, projected)
  }
  const timer = h.state.observation.timer
  h.dispatch({type: 'TURN_CHANGED', source: source({generation: 3})})
  h.dispatch({type: 'READ_TIMER', token: timer})
  assert.equal(h.activeReads.length, 1)
  assert.equal(h.clock.size, 0)
})

test('history reads once and only reconciles on wake; text finalization triggers live reconcile', () => {
  const h = createStageRuntimeHarness(), s = source()
  h.dispatch({type: 'HISTORY_JUMP', source: s, text: text(1, [page(1)])})
  h.replyRead(h.state.observation.flight, direction(1, 1, {complete: true, phase: 'done'}))
  h.clock.advance(100000)
  assert.equal(h.effects('read-director').length, 1)
  h.dispatch({type: 'DIRECTOR_WAKE', source: s})
  assert.equal(h.effects('read-director').length, 2)
  h.dispatch({type: 'RESUME_LIVE', source: s, text: text(2, [page(1)], true)})
  h.replyRead(h.state.observation.flight, {phase: 'unknown', revision: 1})
  h.dispatch({type: 'TEXT_APPEND', source: s, text: text(3, [page(1)])})
  assert.equal(h.activeReads.length, 1)
  assert.equal(h.clock.size, 0)
})

test('unchanged successful reconciliation clears only its transport error, not unrelated diagnostics', () => {
  const h = createStageRuntimeHarness(), s = source()
  h.dispatch({type: 'SEND_ACK', source: s})
  h.replyRead(h.state.observation.flight, {phase: 'off', revision: 1})
  h.clock.advance(5000)
  h.failRead(h.state.observation.flight, 'timeout')
  h.clock.advance(700)
  h.replyRead(h.state.observation.flight, null)
  assert.equal(h.state.pending.error, null)
  h.clock.advance(5000)
  h.failRead(h.state.observation.flight, 'timeout')
  h.dispatch({type: 'READ_FAILED', source: s, error: 'missing frozen resource'})
  h.clock.advance(700)
  h.replyRead(h.state.observation.flight, null)
  assert.equal(h.state.pending.error, 'missing frozen resource')
})
