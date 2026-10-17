// private fork: offline protocol-port tests, not a mounted/native host E2E claim.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createStreamingParagraphs, createStreamingDirector } from '../tavern-plugin/lib/domain/stage-streaming-director.js'
import { stageParagraphs } from '../tavern-plugin/lib/domain/stage-paragraphs.js'

const units = (count, prefix = 'paragraph') => Array.from({length:count}, (_, i) => ({kind:'narration', text:`${prefix} ${i + 1}`}))
const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }
const deferred = () => {let resolve, reject; const promise = new Promise((a, b) => {resolve = a; reject = b}); return {resolve, reject, promise}}
const identity = {sessionId:'offline', branchId:'branch', bodyOperationId:'body', nativeTurn:2, generation:0}
const tools = [{name:'stage_update', parameters:{type:'object', properties:{through:{type:'integer', minimum:1, maximum:65536}}}}]
function validated(input, change = () => null) {
  let state = structuredClone(input.carried)
  return {results:input.paragraphs.map(paragraph => {
    const patch = change(paragraph)
    if (patch) state = {...state, ...patch}
    return {id:paragraph.id, at:paragraph.at, ops:patch ? [{op:'fake.validated.patch', patch}] : [], state:structuredClone(state)}
  })}
}
function setup(run, options = {}) {
  return createStreamingDirector({identity, baseline:{scene:'carried', outfit:'pajamas'}, system:'Fixed rules and catalogue', tools, run, ...options})
}

test('paragraph identity is prefix stable across token chunks; no quiet-period sealing', () => {
  const index = createStreamingParagraphs()
  let source = '', old = []
  for (const chunk of ['First', ' paragraph', '\n\nSecond', ' paragraph', '\n\nThird']) {
    source += chunk
    const {paragraphs, rewrite} = index.reconcile(stageParagraphs(source))
    assert.equal(rewrite, false)
    for (let i = 0; i < old.length; i++) assert.equal(paragraphs[i].id, old[i].id)
    for (let i = 0; i < paragraphs.length; i++) assert.equal(paragraphs[i].sealed, i < paragraphs.length - 1)
    old = paragraphs
  }
  const final = index.reconcile(stageParagraphs(source), true)
  assert.deepEqual(final.paragraphs.map(item => item.id), old.map(item => item.id))
  assert.ok(final.paragraphs.every(item => item.sealed))
})

test('ordered rewrite keeps duplicate paragraphs distinct and keeps unchanged middle/suffix IDs', () => {
  const index = createStreamingParagraphs()
  const input = ['A', 'B', 'B', 'C', 'D'].map(text => ({kind:'narration', text}))
  const old = index.reconcile(input).paragraphs
  const next = index.reconcile([{kind:'narration', text:'changed'}, ...input.slice(1)])
  assert.equal(next.rewrite, true)
  assert.notEqual(next.paragraphs[0].id, old[0].id)
  assert.deepEqual(next.paragraphs.slice(1).map(item => item.id), old.slice(1).map(item => item.id))
  assert.equal(new Set(next.paragraphs.map(item => item.id)).size, 5)
  const truncated = index.reconcile(input.slice(0, 1))
  assert.equal(truncated.rewrite, true)
  assert.notEqual(truncated.paragraphs[0].id, old[0].id, 'deleted IDs are never recycled')
})

test('one in-flight request coalesces fake story stream and emits append-only prefixes', async () => {
  const pending = [], published = []
  let active = 0, maximum = 0
  const director = setup(async input => {
    active++; maximum = Math.max(maximum, active)
    const call = deferred(); pending.push({input, ...call})
    try { await call.promise; return validated(input, paragraph => ({scene:paragraph.unit.text})) }
    finally {active--}
  }, {onChange:value => published.push(value)})
  director.update(units(7)); await tick()
  assert.equal(pending.length, 1)
  for (let n = 8; n <= 40; n++) director.update(units(n))
  await tick()
  assert.equal(pending.length, 1)
  assert.equal(director.snapshot().paragraphs.length, 40, 'text progresses before any direction')
  pending[0].resolve(); await tick()
  assert.equal(pending.length, 2)
  assert.equal(pending[1].input.paragraphs.length, 24)
  pending[1].resolve(); await tick()
  assert.equal(pending.length, 3)
  pending[2].resolve(); await tick()
  director.commit(units(40)); await tick()
  pending[3].resolve(); await director.drain()
  assert.equal(maximum, 1)
  assert.equal(director.snapshot().phase, 'settled')
  assert.equal(director.snapshot().through, 40)
  assert.ok(director.snapshot().calls <= Math.ceil(40 / 6) + 1)
  let prefix = []
  for (const value of published) {
    assert.deepEqual(value.entries.slice(0, prefix.length), prefix)
    prefix = value.entries
  }
})

test('late direction advances immutable logical snapshots; the real runtime owns read fences', async () => {
  const delay = deferred()
  const director = setup(async input => {await delay.promise; return validated(input, () => ({scene:'new scene'}))})
  director.update(units(7)); await tick()
  const visible = director.snapshot()
  assert.equal(visible.state.scene, 'carried')
  delay.resolve(); await director.drain()
  assert.equal(director.snapshot().state.scene, 'new scene', 'logical fold has advanced')
  // private fork: mounted tests now exercise the actual runtime fence and history.
  assert.equal(visible.state.scene, 'carried', 'old consumer snapshot is never mutated')
  assert.equal(director.snapshot().state.outfit, 'pajamas', 'omission carries persistent fields')
})

test('final rewrite redirects changed paragraph but reuses state-independent unchanged suffix', async () => {
  const calls = []
  const director = setup(async input => {calls.push(input); return validated(input)})
  director.update(units(13)); await director.drain()
  const before = director.snapshot()
  assert.equal(before.through, 12)
  const final = units(13); final[0] = {kind:'narration', text:'rewritten'}
  director.commit(final); await director.drain()
  assert.equal(director.snapshot().epoch, 1)
  assert.equal(director.snapshot().phase, 'settled')
  assert.deepEqual(director.snapshot().paragraphs.slice(1).map(item => item.id), before.paragraphs.slice(1).map(item => item.id))
  assert.deepEqual(calls.map(call => call.paragraphs.map(item => item.at)), [[1,2,3,4,5,6,7,8,9,10,11,12], [1], [13]])
  assert.equal(before.entries.length, 0, 'prior published snapshot was not mutated')
})

test('rewrite invalidates carried-dependent suffix rather than pasting old state', async () => {
  const calls = []
  const director = setup(async input => {
    calls.push(input)
    return validated(input, paragraph => paragraph.at === 1 ? {scene:paragraph.unit.text} : null)
  })
  director.update(units(13)); await director.drain()
  const before = director.snapshot(), oldEntry = before.entries[0]
  const final = units(13); final[0] = {kind:'narration', text:'changed scene'}
  director.commit(final); await director.drain()
  const result = director.snapshot()
  assert.equal(result.phase, 'settled')
  assert.equal(result.failure, null)
  assert.ok(result.calls <= result.budget)
  assert.equal(before.entries[0], oldEntry)
  assert.equal(before.entries[0].state.scene, 'paragraph 1', 'old sealed prefix remains unchanged')
  assert.equal(result.state.scene, 'changed scene')
  assert.ok(calls.slice(1).some(call => call.paragraphs.some(item => item.at > 1)), 'dependent suffix is redirected')
})

test('rewrite waits for an abort-ignoring provider and rejects its stale result', async () => {
  const pending = [], director = setup(async input => {
    const gate = deferred(); pending.push({input, ...gate}); await gate.promise
    return validated(input, () => ({scene:input.paragraphs[0].unit.text}))
  })
  director.update(units(7)); await tick()
  const final = units(7); final[0] = {kind:'narration', text:'new source'}
  director.commit(final); await tick()
  assert.equal(pending[0].input.signal.aborted, true)
  assert.equal(pending.length, 1)
  pending[0].resolve(); await tick()
  assert.equal(pending.length, 2)
  assert.equal(director.snapshot().entries.length, 0)
  pending[1].resolve(); await director.drain()
  assert.equal(director.snapshot().state.scene, 'new source')
  assert.equal(director.snapshot().calls, 2)
})

test('stop cancels queued/native calls without hiding streamed text or publishing late results', async () => {
  const gate = deferred(), calls = []
  const director = setup(async input => {calls.push(input); await gate.promise; return validated(input, () => ({scene:'stale'}))})
  director.update(units(7)); await tick(); director.cancel()
  assert.equal(calls[0].signal.aborted, true)
  gate.resolve(); await director.drain()
  assert.equal(director.snapshot().phase, 'cancelled')
  assert.equal(director.snapshot().paragraphs.length, 7)
  assert.equal(director.snapshot().entries.length, 0)
  director.commit(units(8)); await director.drain()
  assert.equal(calls.length, 1)
  const queued = setup(() => {throw new Error('must not start')})
  queued.update(units(7)); queued.cancel(); await queued.drain()
  assert.equal(queued.snapshot().calls, 0)
})

test('director errors are isolated; text and final commit remain readable with no automatic retry', async () => {
  let calls = 0
  const director = setup(async () => {calls++; throw new Error('offline provider failed')})
  director.update(units(7)); await director.drain()
  director.update(units(12)); director.commit(units(13)); await director.drain()
  const value = director.snapshot()
  assert.equal(calls, 1)
  assert.equal(value.phase, 'failed')
  assert.equal(value.committed, true)
  assert.equal(value.paragraphs.length, 13)
  assert.match(value.failure.message, /offline provider/)
  assert.equal(value.state.scene, 'carried')
})

test('misaligned adapter results fail atomically without publishing valid-looking siblings', async () => {
  const director = setup(async input => {
    const result = validated(input, () => ({scene:'not published'}))
    result.results.at(-1).id = 'foreign'
    return result
  })
  director.commit(units(6)); await director.drain()
  assert.equal(director.snapshot().phase, 'failed')
  assert.equal(director.snapshot().through, 0)
  assert.deepEqual(director.snapshot().entries, [])
})

test('fixed prefix/schema bytes never grow and volatile tail contains only new paragraphs', async t => {
  const requests = []
  const director = setup(async input => {requests.push(input.request); return validated(input)})
  for (let n = 7; n <= 31; n += 6) {director.update(units(n)); await director.drain()}
  director.commit(units(31)); await director.drain()
  const first = requests[0], ids = new Set()
  for (const request of requests) {
    assert.equal(request.system, first.system)
    assert.equal(JSON.stringify(request.tools), JSON.stringify(first.tools))
    const tail = JSON.parse(request.messages[0].content)
    assert.ok(tail.paragraphs.length <= 24)
    assert.deepEqual(Object.keys(tail), ['first', 'paragraphs', 'carried'])
    for (const item of tail.paragraphs) {assert.equal(ids.has(item.id), false); ids.add(item.id)}
    assert.deepEqual(tail.carried, {scene:'carried', outfit:'pajamas'})
  }
  assert.equal(ids.size, 31)
  const bytes = value => Buffer.byteLength(value)
  t.diagnostic(JSON.stringify({calls:requests.length, systemBytes:bytes(first.system), toolSchemaBytes:bytes(JSON.stringify(first.tools)), tailBytes:requests.map(r => bytes(r.messages[0].content))}))
})

test('call-count bound for 0..120 paragraphs and hard cap, including empty/short turns', async () => {
  for (const count of [...Array.from({length:121}, (_, n) => n), 250]) {
    let actual = 0
    const director = setup(async input => {actual++; return validated(input)})
    for (let n = 1; n <= count; n++) {director.update(units(n)); await director.drain()}
    director.commit(units(count)); await director.drain()
    const value = director.snapshot()
    assert.ok(actual <= Math.min(16, Math.ceil(count / 6) + 1), `count=${count}; actual=${actual}`)
    assert.equal(actual, value.calls)
    assert.equal(value.paragraphs.length, count)
    if (count <= 96) assert.equal(value.phase, 'settled')
    if (!count) assert.equal(actual, 0)
  }
})

test('budget is high-water based when final rewrite truncates an already billed reply', async () => {
  const director = setup(async input => validated(input))
  for (let n = 7; n <= 61; n += 6) {director.update(units(n)); await director.drain()}
  const calls = director.snapshot().calls
  director.commit([{kind:'narration', text:'short final reply'}]); await director.drain()
  const value = director.snapshot()
  assert.equal(value.highWater, 61)
  assert.ok(value.calls > Math.ceil(value.paragraphs.length / 6) + 1)
  assert.equal(value.calls, calls + 1)
  assert.ok(value.calls <= value.budget)
  assert.equal(value.phase, 'settled')
})
