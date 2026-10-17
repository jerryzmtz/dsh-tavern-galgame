import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
const source = await readFile(new URL('../tavern-plugin/src/client/fork-gal-stage.js', import.meta.url), 'utf8')
const api = {}
vm.runInNewContext(source.slice(source.indexOf('function forkGalReadThrough('), source.indexOf('function forkGalSubtitleCache(')), api)
const readThrough = { turn: 5, page: 8, textDigest: 'current' }
const next = { turn: 5, page: 3, textDigest: 'current' }
const event = (now, deltaY = 120, patch = {}) => ({ now, deltaY, deltaMode: 0, typed: true, readThrough, next, ...patch })
const decide = api.forkGalWheelDecision

test('wheel read notch: 120px emits exactly one page, five 24px events emit one, never queued repeats', () => {
  let result = decide(null, event(0)); assert.equal(result.action, 'advance-read')
  result = decide(result.state, event(220, 1)); assert.equal(result.action, 'none')
  let state = null, actions = []
  for (let i = 0; i < 5; i++) { const r = decide(state, event(i * 20, 24)); state = r.state; actions.push(r.action) }
  assert.equal(actions.filter(a => a === 'advance-read').length, 1)
  assert.equal(decide(null, event(0, 1200)).action, 'advance-read')
})
test('wheel fast spin of ten notches in 300ms advances at most two read pages', () => {
  let state = null, count = 0
  for (let i = 0; i < 10; i++) { const r = decide(state, event(i * 30)); state = r.state; if (r.action === 'advance-read') count++ }
  assert.equal(count, 2)
  assert.equal(decide(state, event(500, 1)).action, 'none', 'throttled notches are consumed, not queued')
})
test('wheel normalises LINE/PAGE modes and ignores zero or non-finite deltas', () => {
  assert.equal(decide(null, event(0, 3, { deltaMode: 1 })).action, 'advance-read')
  assert.equal(decide(null, event(0, 1, { deltaMode: 2 })).action, 'advance-read')
  assert.equal(decide(null, event(0, 0)).action, 'none')
  assert.equal(decide(null, event(0, NaN)).action, 'none')
})
test('wheel unread gesture: first notch finishes typing, only a new gesture can advance', () => {
  const unread = { turn: 5, page: 9, textDigest: 'current' }
  let r = decide(null, event(0, 120, { next: unread, typed: false })); assert.equal(r.action, 'finish')
  r = decide(r.state, event(100, 120, { next: unread })); assert.equal(r.action, 'none')
  r = decide(r.state, event(390, 120, { next: unread })); assert.equal(r.action, 'none', 'idle is measured from the last wheel event')
  r = decide(r.state, event(690, 120, { next: unread })); assert.equal(r.action, 'advance')
  r = decide(r.state, event(900, 120, { next: unread })); assert.equal(r.action, 'none', 'no auto-chain to the next unread page')
})
test('wheel trackpad unread stream has a single action even when read state changes after typing', () => {
  let state = null, actions = []
  for (let i = 0; i < 50; i++) {
    const r = decide(state, event(i * 20, 24, { readThrough: i < 5 ? null : readThrough, typed: i >= 5 })); state = r.state
    if (r.action !== 'none') actions.push(r.action)
  }
  assert.deepEqual(actions, ['finish'])
})
test('wheel can cross a read turn boundary; an unread/new-revision turn gets one gesture action', () => {
  assert.equal(decide(null, event(0, 120, { next: { turn: 4, page: 99, textDigest: 'old' } })).action, 'advance-read')
  assert.equal(decide(null, event(0, 120, { next: { turn: 5, page: 0, textDigest: 'current' } })).action, 'advance-read')
  assert.equal(decide(null, event(0, 120, { next: { turn: 6, page: 0, textDigest: 'new' } })).action, 'advance')
  assert.equal(decide(null, event(0, 120, { next: { ...next, textDigest: 'edited' } })).action, 'advance')
  // private fork: upward wheel opens the backlog without moving the reading cursor.
  assert.equal(decide(null, event(0, -1)).action, 'none')
  assert.equal(decide(null, event(0, -120)).action, 'backlog')
  assert.equal(decide(null, event(0, -3, {deltaMode:1})).action, 'backlog')
  assert.equal(decide(null, event(0, -1, {deltaMode:2})).action, 'backlog')
})
test('read high-water is monotonic, revision-aware, per-session and persisted with the bookmark', () => {
  const data = new Map(), timers = [], storage = { getItem: key => data.get(key), setItem: (key, value) => data.set(key, value) }
  const writer = api.forkGalPositionWriter('a', storage, fn => { timers.push(fn); return timers.length }, () => {})
  writer.markRead(readThrough); writer.markRead(next)
  assert.equal(writer.readThrough.page, 8)
  writer.write({ turn: 3, page: 0, textDigest: 'backtracking', latestSeenTurn: 5 }); writer.flush()
  const saved = JSON.parse(data.get('fork-stage-position:a'))
  assert.equal(saved.page, 0); assert.equal(saved.readThrough.page, 8)
  const restored = api.forkGalPositionWriter('a', storage, () => 1, () => {})
  assert.equal(restored.readThrough.page, 8)
  assert.equal(api.forkGalPositionWriter('other', storage, () => 1, () => {}).readThrough, null)
  restored.markRead({ turn: 5, page: 1, textDigest: 'edited' }); assert.equal(restored.readThrough.page, 1)
  assert.equal(api.forkGalReadThrough({ turn: 'bad', page: -1 }, null), null)
})
