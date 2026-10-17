import assert from 'node:assert/strict'
import test from 'node:test'
import { initialStageState, createStageTransaction, replayStage, applyStageEffect, stageDigest, normalizeStageBudget, resolveStageAppearance, captureStageTarget, readStageBaseline, buildStageUpdateTool } from '../tavern-plugin/lib/domain/stage-incremental.js'
import { createStoryTimeline } from '../tavern-plugin/lib/domain/story-timeline.js'
import { createBackgroundTaskCoordinator } from '../tavern-plugin/lib/domain/background-task-coordinator.js'

const catalog = { actors: { soyo: { defaultVariant: 'uniform', variants: ['uniform', 'casual', 'performance'] }, anon: { defaultVariant: 'uniform', variants: ['uniform'] } }, scene: ['room', 'stage'], music: ['song'] }
const target = { branchId: 'branch', revision: 2, sourceKey: 'reply-2' }
const op = (kind, actor, value) => ({ op: kind, ...(actor ? { actor } : {}), ...(value ? { value } : {}) })
const batch = (sequence, through, ops = [], done = false, at = through) => ({ sequence, through, done, beats: ops.length ? [{ at, ops }] : [] })
const fixture = (extra = {}) => createStageTransaction({ catalog, target, units: 4, ...extra })

function dressed() {
  const state = initialStageState(catalog)
  state.scene = 'room'; state.music = 'song'; state.cast = ['soyo']; state.actors.soyo.variant = 'performance'
  return state
}

test('omission and empty completion retain ALL previous state, without P1 repetition', () => {
  const baseline = dressed(), tx = fixture({ baseline })
  assert.equal(tx.submit(batch(1, 4, [], true)).ok, true)
  assert.deepEqual(tx.effect().entries, [])
  assert.deepEqual(tx.effect().end, baseline)
  assert.deepEqual(baseline, dressed(), 'caller state never mutated')
})

test('same identity supports outfit and major performance variants; exit is not reset', () => {
  const tx = fixture()
  assert.equal(tx.submit(batch(1, 1, [op('actor.enter', 'soyo'), op('actor.variant', 'soyo', 'performance')])).ok, true)
  assert.equal(tx.submit(batch(2, 2, [op('actor.exit', 'soyo')])).ok, true)
  assert.equal(tx.inspect().state.actors.soyo.variant, 'performance')
  assert.equal(tx.submit(batch(3, 4, [op('actor.enter', 'soyo')], true)).ok, true)
  assert.deepEqual(tx.effect().end.cast, ['soyo'])
  assert.equal(tx.effect().end.actors.soyo.variant, 'performance')
  assert.equal(tx.effect().end.actors.anon.variant, 'uniform')
})

test('explicit actor reset, clear cast, stop sound and global reset have distinct scopes', () => {
  const tx = fixture({ baseline: dressed() })
  tx.submit(batch(1, 1, [op('cast.clear')]))
  assert.equal(tx.inspect().state.actors.soyo.variant, 'performance')
  tx.submit(batch(2, 2, [op('actor.reset', 'soyo'), op('music.stop')]))
  assert.equal(tx.inspect().state.actors.soyo.variant, 'uniform')
  assert.equal(tx.inspect().state.music, null)
  assert.equal(tx.inspect().state.scene, 'room')
  tx.submit(batch(3, 4, [op('stage.reset')], true))
  assert.deepEqual(tx.effect().end, initialStageState(catalog))
})

test('equal state writes are normalized away while intentional one-shots remain', () => {
  const tx = fixture({ baseline: dressed() })
  const response = tx.submit(batch(1, 4, [op('actor.variant', 'soyo', 'performance'), op('music.set', null, 'song'), op('act', 'soyo', 'bow'), op('act', 'soyo', 'bow')], true))
  assert.equal(response.omittedNoops, 2)
  assert.equal(response.acceptedOperations, 2)
  assert.deepEqual(tx.effect().entries[0].ops.map(item => item.op), ['act', 'act'])
  assert.deepEqual(replayStage(tx.effect(), catalog), dressed())
})

test('invalid batch rolls back valid siblings; correction replaces only rejected batch', () => {
  const tx = fixture()
  tx.submit(batch(1, 1, [op('actor.enter', 'soyo')]))
  const before = tx.inspect()
  const bad = tx.submit(batch(2, 2, [op('actor.variant', 'soyo', 'casual'), op('music.set', null, 'invented')]))
  assert.equal(bad.ok, false); assert.equal(bad.error.path, 'beats[0].ops[1].value')
  assert.equal(tx.inspect().nextSequence, 2)
  assert.deepEqual(tx.inspect().state, before.state)
  assert.deepEqual(tx.inspect().entries, before.entries)
  assert.equal(tx.submit(batch(2, 4, [op('actor.variant', 'soyo', 'casual')], true)).ok, true)
  assert.equal(tx.effect().end.actors.soyo.variant, 'casual')
})

test('batch replay is idempotent and conflicting reuse is rejected, including after finish', () => {
  const tx = fixture(), args = batch(1, 4, [op('actor.enter', 'soyo'), op('act', 'soyo', 'bow')], true)
  tx.submit(args)
  assert.equal(tx.submit(structuredClone(args)).duplicate, true)
  assert.equal(tx.inspect().calls, 1)
  assert.equal(tx.effect().entries[0].ops.length, 2)
  assert.equal(tx.submit(batch(1, 4, [], true)).ok, false)
  assert.equal(tx.submit(batch(2, 4, [], true)).ok, false)
})

test('empty sealed ranges and cross-batch chronological ordering are enforced', () => {
  const tx = fixture()
  tx.submit(batch(1, 2))
  assert.equal(tx.submit(batch(2, 3, [op('actor.enter', 'soyo')], false, 1)).ok, false)
  assert.equal(tx.submit(batch(3, 4, [], true)).ok, false)
  assert.equal(tx.submit(batch(2, 4, [op('actor.enter', 'soyo')], true, 3)).ok, true)
  assert.deepEqual(replayStage(tx.effect(), catalog, 2).cast, [])
  assert.deepEqual(replayStage(tx.effect(), catalog, 3).cast, ['soyo'])
})

test('finalization does not claim unexamined suffix and prefix is not authoritative', () => {
  const tx = fixture()
  assert.equal(tx.submit(batch(1, 2, [], true)).ok, false)
  tx.submit(batch(1, 2, [op('actor.variant', 'soyo', 'performance')]))
  assert.equal(tx.effect(), null)
  assert.equal(tx.effect({ allowPartial: true }).complete, false)
  assert.throws(() => applyStageEffect({ timeline: target, messages: [{ role: 'assistant' }] }, tx.effect({ allowPartial: true }), { messageId: 0, sourceKey: target.sourceKey }), /Incomplete/)
})

test('configurable total calls and per-call work limits fail closed with prior-state fallback', () => {
  assert.deepEqual(normalizeStageBudget({ maxToolCalls: 1000, maxBeatsPerCall: -2 }), { maxToolCalls: 64, maxBeatsPerCall: 8, maxOpsPerCall: 32 })
  const tx = fixture({ budget: { maxToolCalls: 2, maxOpsPerCall: 1 } })
  assert.equal(tx.submit(batch(1, 1, [op('actor.enter', 'soyo'), op('actor.enter', 'anon')])).ok, false)
  assert.equal(tx.submit(batch(1, 2, [op('actor.enter', 'soyo')])).ok, true)
  assert.equal(tx.terminal(), true)
  assert.equal(tx.effect(), null)
  assert.equal(tx.submit(batch(2, 4, [], true)).retryable, false)
})

test('unknown/foreign actor variants, invalid shapes and offstage events reject atomically', () => {
  for (const ops of [[op('actor.variant', 'anon', 'performance')], [op('actor.variant', 'unknown', 'uniform')], [op('act', 'soyo', 'bow')], [{ op: 'music.stop', value: 'song' }], [{ op: 'actor.enter', actor: 'soyo', hidden: true }]]) {
    const tx = fixture()
    assert.equal(tx.submit(batch(1, 4, ops, true)).ok, false)
    assert.deepEqual(tx.inspect().state, initialStageState(catalog))
  }
})

test('cancellation, stale target and cancelled duplicate acknowledgements cannot publish', () => {
  const controller = new AbortController(), tx = fixture({ signal: controller.signal })
  tx.submit(batch(1, 4, [op('actor.enter', 'soyo')], true)); controller.abort()
  assert.equal(tx.effect(), null)
  assert.equal(tx.submit(batch(1, 4, [op('actor.enter', 'soyo')], true)).ok, false)
  let current = true
  const second = fixture({ isCurrent: () => current })
  second.submit(batch(1, 4, [], true)); current = false
  assert.equal(second.effect(), null)
})

test('catalogue and target are frozen snapshots; later edits do not change a task', () => {
  const mutableCatalog = structuredClone(catalog), mutableTarget = { ...target }
  const tx = fixture({ catalog: mutableCatalog, target: mutableTarget })
  mutableCatalog.actors.soyo.variants.push('future'); mutableTarget.sourceKey = 'future'
  assert.equal(tx.submit(batch(1, 4, [op('actor.variant', 'soyo', 'future')], true)).ok, false)
  tx.submit(batch(1, 4, [], true))
  assert.equal(tx.effect().sourceKey, target.sourceKey)
  assert.deepEqual(replayStage(tx.effect(), mutableCatalog), tx.effect().end, 'historical semantic snapshot is independent of current catalogue edits')
})

test('one chunk and many chunks have identical state and ordered event log', () => {
  const operations = [[op('actor.enter', 'soyo')], [op('actor.variant', 'soyo', 'performance')], [op('actor.exit', 'soyo')], [op('actor.enter', 'soyo'), op('act', 'soyo', 'bow')]]
  const one = fixture(), many = fixture()
  one.submit({ sequence: 1, through: 4, done: true, beats: operations.map((ops, i) => ({ at: i + 1, ops })) })
  operations.forEach((ops, i) => many.submit(batch(i + 1, i + 1, ops, i === 3)))
  assert.deepEqual(one.effect().end, many.effect().end)
  assert.deepEqual(one.effect().entries, many.effect().entries)
})





function lifecycle() {
  let count = 0, clock = 0
  const timeline = createStoryTimeline({ id: prefix => prefix + ++count, now: () => ++clock })
  let saved = timeline.apply({ chat: { id: 'chat', sessionId: 'parent', mode: 'story', messages: [] }, intent: { kind: 'ensure' } }).chat
  const store = { readChat: async () => structuredClone(saved), writeChat: async chat => { saved = structuredClone(chat) }, updateChat: async (_id, mutate) => { saved = mutate(structuredClone(saved)); return structuredClone(saved) } }
  const coordinator = createBackgroundTaskCoordinator({ store, timeline })
  function body(turn) {
    const before = structuredClone(saved)
    const started = timeline.apply({ chat: saved, intent: { kind: 'body.begin', turn, userText: 'continue' } })
    saved = timeline.complete({ chat: started.chat, operationId: started.value.operationId, basedOn: started.value.basedOn, outcome: { status: 'success' }, apply(chat) { chat.messages.push({ role: 'assistant', turn, text: 'reply ' + turn }) } }).chat
    return before
  }
  return { timeline, coordinator, store, body, read: () => structuredClone(saved), set: value => { saved = value } }
}

async function commitStage(f, variant = 'performance') {
  const task = await f.coordinator.begin(f.read(), 'settlement')
  await task.bindSession('resident')
  const current = f.read(), messageId = current.messages.length - 1
  const tx = fixture({ target: captureStageTarget(current, messageId), baseline: readStageBaseline(current, messageId, catalog) })
  tx.submit(batch(1, 4, [op('actor.enter', 'soyo'), op('actor.variant', 'soyo', variant)], true))
  const effect = tx.effect()
  const result = await task.commit({ stateChanged: false, participant: task.participant({ sessionId: 'resident', boundary: 20 + messageId }), apply(chat) { applyStageEffect(chat, effect, { catalog, isCurrent: tx.isCurrent }) } })
  return { task, tx, result }
}

test('actual coordinator commits stage with settlement and no extra story revision', async () => {
  const f = lifecycle(); f.body(1)
  const revision = f.read().timeline.revision
  const { result } = await commitStage(f)
  assert.equal(result.status, 'committed')
  assert.equal(f.read().timeline.revision, revision)
  assert.equal(f.read().messages[0].stageDirectionV1.end.actors.soyo.variant, 'performance')
  assert.equal(f.read().timeline.participants.background.sessionId, 'resident')
  const candidate = await f.coordinator.begin(f.read(), 'candidate')
  assert.equal(candidate.participantRequest.sessionId, 'resident', 'same upstream background participant')
})

test('actual coordinator rejects late results after later prose or edit', async () => {
  for (const change of ['next', 'edit']) {
    const f = lifecycle(); f.body(1)
    const task = await f.coordinator.begin(f.read(), 'settlement')
    if (change === 'next') f.body(2)
    else f.set(f.timeline.apply({ chat: f.read(), intent: { kind: 'body.edit', turn: 1, patch: { text: 'edited' } } }).chat)
    let applied = false
    const result = await task.commit({ stateChanged: false, apply() { applied = true } })
    assert.equal(result.status, 'stale'); assert.equal(applied, false)
  }
})

test('checkpoint rollback restores stage, creates branch, cancels pending tasks and rewinds shared session', async () => {
  const f = lifecycle(); f.body(1); await commitStage(f)
  const beforeSecond = f.body(2); await commitStage(f, 'casual')
  const pending = await f.coordinator.begin(f.read(), 'candidate')
  const oldBranch = f.read().timeline.branchId, oldRevision = f.read().timeline.revision
  f.set(f.timeline.apply({ chat: f.read(), intent: { kind: 'turn.rollback', beforeChat: beforeSecond } }).chat)
  assert.notEqual(f.read().timeline.branchId, oldBranch)
  assert.ok(f.read().timeline.revision > oldRevision)
  assert.equal(f.read().messages.at(-1).stageDirectionV1.end.actors.soyo.variant, 'performance')
  assert.equal(f.read().timeline.participants.background.status, 'needs-rewind')
  assert.equal((await pending.commit({ apply() { assert.fail('late branch must not apply') } })).status, 'stale')
})

test('actual coordinator failure/recovery leaves prose and previously committed stage intact', async () => {
  const f = lifecycle(); f.body(1); await commitStage(f)
  const baseline = f.read().messages[0].stageDirectionV1
  f.body(2)
  const task = await f.coordinator.begin(f.read(), 'settlement')
  await f.coordinator.recover(f.read(), { operationId: task.operationId })
  assert.equal((await task.commit({ apply() { assert.fail('interrupted task') } })).status, 'stale')
  assert.equal(f.read().messages.length, 2)
  assert.deepEqual(f.read().messages[0].stageDirectionV1, baseline)
  assert.equal(f.read().messages[1].stageDirectionV1, undefined)
})

test('actual coordinator refuses overlapping job; runner queuing alone is insufficient', async () => {
  const f = lifecycle(); f.body(1)
  await f.coordinator.begin(f.read(), 'settlement')
  await assert.rejects(f.coordinator.begin(f.read(), 'candidate'), error => error.code === 'BACKGROUND_BUSY')
})




test('missing performance model falls back visually without changing persisted variant or actor identity', () => {
  const state = dressed(), actor = { ...catalog.actors.soyo, bindings: { uniform: 'layered-uniform', performance: 'live2d-bass' } }
  const missing = resolveStageAppearance(state.actors.soyo, actor, new Set(['layered-uniform']))
  assert.deepEqual({ model: missing.model, requested: missing.requested, effective: missing.effective, degraded: missing.degraded }, { model: 'layered-uniform', requested: 'performance', effective: 'uniform', degraded: true })
  assert.match(missing.warning, /显式重置/)
  assert.equal(state.actors.soyo.variant, 'performance')
  assert.deepEqual(state.cast, ['soyo'])
  assert.equal(resolveStageAppearance(state.actors.soyo, actor, new Set(['layered-uniform', 'live2d-bass'])).effective, 'performance')
  assert.equal(resolveStageAppearance(state.actors.soyo, actor, new Set()).model, null)
})

test('review regression: caller-supplied key/index cannot authorize an unrelated message', () => {
  const tx = fixture(); tx.submit(batch(1, 4, [], true))
  const chat = { timeline: { branchId: target.branchId, revision: target.revision }, messages: [{ role: 'assistant', text: 'unrelated old prose' }] }
  assert.throws(() => applyStageEffect(chat, tx.effect(), { messageId: 0, sourceKey: target.sourceKey, catalog, isCurrent: tx.isCurrent }), /identity/)
  assert.equal(chat.messages[0].stageDirectionV1, undefined)
})

test('review regression: authoritative target content, message index, swipe and prefix bind commit', () => {
  const f = lifecycle(); f.body(1); f.body(2)
  const before = f.read(), bound = captureStageTarget(before, 1)
  const tx = fixture({ target: bound, baseline: readStageBaseline(before, 1, catalog) }); tx.submit(batch(1, 4, [], true))
  for (const change of [chat => { chat.messages[1].text = 'edited without revision' }, chat => { chat.messages[1].swipeId = 1 }, chat => { chat.messages[0].text = 'changed ancestor' }, chat => { chat.messages.reverse() }, chat => { chat.id = 'other-chat' }, chat => { delete chat.timeline.revision }]) {
    const chat = structuredClone(before); change(chat)
    assert.throws(() => applyStageEffect(chat, tx.effect(), { catalog, isCurrent: tx.isCurrent }), /binding|identity|Stale/)
    assert.ok(chat.messages.every(message => !message.stageDirectionV1))
  }
  const wrongIndex = tx.effect(); wrongIndex.messageId = 0
  assert.throws(() => applyStageEffect(structuredClone(before), wrongIndex, { catalog, isCurrent: tx.isCurrent }), /binding/)
  assert.throws(() => applyStageEffect(structuredClone(before), tx.effect(), { catalog }), /owner/)
  const valid = structuredClone(before)
  applyStageEffect(valid, tx.effect(), { catalog, isCurrent: tx.isCurrent })
  assert.equal(valid.messages[0].stageDirectionV1, undefined)
  assert.equal(valid.messages[1].stageDirectionV1.sourceKey, bound.sourceKey)
})

test('review regression: apply reads authoritative predecessor instead of trusting detached baseline', async () => {
  const f = lifecycle(); f.body(1); await commitStage(f, 'performance'); f.body(2)
  const chat = f.read(), tx = fixture({ target: captureStageTarget(chat, 1), baseline: readStageBaseline(chat, 1, catalog) })
  tx.submit(batch(1, 4, [], true))
  const changed = fixture({ target: captureStageTarget(chat, 0), baseline: initialStageState(catalog) })
  changed.submit(batch(1, 4, [op('actor.enter', 'soyo'), op('actor.variant', 'soyo', 'casual')], true))
  chat.messages[0].stageDirectionV1 = changed.effect()
  assert.throws(() => applyStageEffect(chat, tx.effect(), { catalog, isCurrent: tx.isCurrent }), /baseline changed/)
  assert.equal(chat.messages[1].stageDirectionV1, undefined)
})

test('review regression: detached effect cannot commit after cancellation while waiting in actual coordinator queue', async () => {
  const f = lifecycle(); f.body(1)
  const task = await f.coordinator.begin(f.read(), 'settlement')
  const controller = new AbortController(), current = f.read()
  const tx = fixture({ target: captureStageTarget(current, 0), baseline: readStageBaseline(current, 0, catalog), signal: controller.signal })
  tx.submit(batch(1, 4, [op('actor.enter', 'soyo')], true))
  const detached = tx.effect()
  let release, entered
  const started = new Promise(resolve => { entered = resolve })
  const blocking = f.coordinator.exclusive('chat', () => new Promise(resolve => { release = resolve; entered() }))
  await started
  const pending = task.commit({ stateChanged: false, apply(chat) { applyStageEffect(chat, detached, { catalog, isCurrent: tx.isCurrent }) } })
  controller.abort(); release(); await blocking
  await assert.rejects(pending, /owner cancelled/)
  assert.equal(f.read().messages[0].stageDirectionV1, undefined)
})

test('review regression: historical replay survives unrelated additions, renames and unavailable current assets', () => {
  const tx = fixture({ baseline: dressed() }); tx.submit(batch(1, 4, [op('actor.reset', 'soyo')], true))
  const future = structuredClone(catalog)
  future.music.push('new-song'); future.actors.soyo.defaultVariant = 'casual'; future.actors.soyo.variants = ['casual']
  assert.deepEqual(replayStage(tx.effect(), future), tx.effect().end)
  assert.equal(replayStage(tx.effect(), { actors: {}, scene: [], music: [], ambience: [] }).actors.soyo.variant, 'uniform')
  const corrupt = tx.effect(); corrupt.catalogSnapshot.actors.soyo.defaultVariant = 'casual'
  assert.throws(() => replayStage(corrupt), /snapshot mismatch/)
})

test('review regression: commit verifies current referenced catalogue while unrelated additions remain harmless', () => {
  const f = lifecycle(); f.body(1)
  const before = f.read(), tx = fixture({ target: captureStageTarget(before, 0) })
  tx.submit(batch(1, 4, [op('actor.enter', 'soyo'), op('actor.variant', 'soyo', 'performance'), op('music.set', null, 'song')], true))
  const compatible = structuredClone(catalog); compatible.music.push('unrelated')
  assert.doesNotThrow(() => applyStageEffect(structuredClone(before), tx.effect(), { catalog: compatible, isCurrent: tx.isCurrent }))
  for (const change of [c => { c.music = [] }, c => { c.actors.soyo.variants = ['uniform'] }, c => { delete c.actors.soyo }]) {
    const current = structuredClone(catalog); change(current)
    assert.throws(() => applyStageEffect(structuredClone(before), tx.effect(), { catalog: current, isCurrent: tx.isCurrent }), /catalogue changed/)
  }
  assert.throws(() => applyStageEffect(structuredClone(before), tx.effect(), { isCurrent: tx.isCurrent }), /catalogue required/)
})

test('review regression: adding actor extends baseline without resetting existing variants or needing global reset', () => {
  const old = dressed(), next = structuredClone(catalog)
  next.actors.rana = { defaultVariant: 'uniform', variants: ['uniform'] }
  const tx = fixture({ baseline: old, catalog: next })
  const result = tx.submit(batch(1, 4, [op('actor.enter', 'rana')], true))
  assert.equal(result.ok, true)
  assert.deepEqual(tx.effect().end.cast, ['soyo', 'rana'])
  assert.equal(tx.effect().end.actors.soyo.variant, 'performance')
  assert.equal(tx.effect().end.actors.rana.variant, 'uniform')
  assert.equal(old.actors.rana, undefined)
  assert.deepEqual(replayStage(tx.effect()), tx.effect().end)
  const noop = fixture({ baseline: old, catalog: next })
  noop.submit(batch(1, 4, [op('actor.reset', 'rana')], true))
  assert.deepEqual(replayStage(noop.effect()), noop.effect().end, 'default initialization is in the frozen baseline, not a hidden discarded operation')
})



test('review regression: actor/op/value coercion cannot create non-string state', () => {
  for (const actor of [['soyo'], { toString: () => 'soyo' }, 1, null, true]) {
    const tx = fixture()
    const result = tx.submit(batch(1, 4, [{ op: 'actor.enter', actor }], true))
    assert.equal(result.ok, false)
    assert.equal(result.error.path, 'beats[0].ops[0].actor')
    assert.deepEqual(tx.inspect().state.cast, [])
  }
  for (const raw of [{ op: ['actor.enter'], actor: 'soyo' }, { op: 'actor.variant', actor: 'soyo', value: ['uniform'] }]) {
    const tx = fixture(); assert.equal(tx.submit(batch(1, 4, [raw], true)).ok, false)
    assert.deepEqual(tx.inspect().state, initialStageState(catalog))
  }
})


test('review regression: accepted no-ops retain semantic dependencies without redundant playback entries', () => {
  for (const kind of ['actor.reset', 'actor.variant', 'stage.reset']) {
    const f = lifecycle(); f.body(1)
    const before = f.read(), frozen = structuredClone(catalog)
    frozen.actors.soyo.bindings = { uniform: 'original-model', casual: 'casual-model' }
    const tx = fixture({ target: captureStageTarget(before, 0), catalog: frozen })
    const operation = kind === 'stage.reset' ? op(kind) : op(kind, 'soyo', kind === 'actor.variant' ? 'uniform' : undefined)
    const receipt = tx.submit(batch(1, 4, [operation], true))
    assert.equal(receipt.omittedNoops, 1)
    assert.deepEqual(tx.effect().entries, [])
    assert.equal(tx.effect().semanticDependencies.length, 1)
    const current = structuredClone(frozen)
    if (kind === 'actor.variant') current.actors.soyo.bindings.uniform = 'different-model'
    else current.actors.soyo.defaultVariant = 'casual'
    assert.throws(() => applyStageEffect(structuredClone(before), tx.effect(), { catalog: current, isCurrent: tx.isCurrent }), /changed/)
  }
  const tx = fixture()
  assert.equal(tx.submit(batch(1, 1, [op('actor.reset', 'soyo'), op('music.set', null, 'invented')])).ok, false)
  tx.submit(batch(1, 4, [], true))
  assert.deepEqual(tx.effect().semanticDependencies, [], 'atomic batch rejection must discard its dependency set too')
})


test('review regression: reset bindings and operation-time appearances remain bound even when final variant differs', async () => {
  const f = lifecycle(); f.body(1)
  const first = f.read(), frozen = structuredClone(catalog)
  frozen.actors.soyo.bindings = { uniform: 'model1', performance: 'bass1' }
  const reset = fixture({ target: captureStageTarget(first, 0), catalog: frozen })
  reset.submit(batch(1, 4, [op('stage.reset')], true))
  const changedDefaultModel = structuredClone(frozen); changedDefaultModel.actors.soyo.bindings.uniform = 'model2'
  assert.throws(() => applyStageEffect(structuredClone(first), reset.effect(), { catalog: changedDefaultModel, isCurrent: reset.isCurrent }), /catalogue changed/)
  await commitStage(f, 'performance'); f.body(2)
  const before = f.read()
  for (const kind of ['actor.enter', 'act']) {
    const tx = fixture({ target: captureStageTarget(before, 1), catalog: frozen, baseline: readStageBaseline(before, 1, frozen) })
    tx.submit(batch(1, 4, [op(kind, 'soyo', kind === 'act' ? 'bow' : undefined), op('actor.reset', 'soyo')], true))
    assert.equal(tx.effect().end.actors.soyo.variant, 'uniform')
    const changedEarlyAppearance = structuredClone(frozen); changedEarlyAppearance.actors.soyo.bindings.performance = 'bass2'
    assert.throws(() => applyStageEffect(structuredClone(before), tx.effect(), { catalog: changedEarlyAppearance, isCurrent: tx.isCurrent }), /catalogue changed/)
  }
})


test('review hardening: a changed early effect invalidates stale intermediate baseline before another commit', async () => {
  const f = lifecycle(); f.body(1); await commitStage(f, 'performance'); f.body(2); await commitStage(f, 'casual'); f.body(3)
  const chat = f.read(), tx = fixture({ target: captureStageTarget(chat, 2), baseline: readStageBaseline(chat, 2, catalog) })
  tx.submit(batch(1, 4, [], true))
  const replacement = fixture({ target: captureStageTarget(chat, 0) })
  replacement.submit(batch(1, 4, [op('actor.enter', 'soyo')], true))
  chat.messages[0].stageDirectionV1 = replacement.effect()
  assert.throws(() => readStageBaseline(chat, 2, catalog), /predecessor baseline changed/)
  assert.throws(() => applyStageEffect(chat, tx.effect(), { catalog, isCurrent: tx.isCurrent }), /predecessor baseline changed/)
  assert.equal(chat.messages[2].stageDirectionV1, undefined)
})

// private fork: order-only placement removes persistent position/distance.
// Existing stage DSL persistent fields, beyond the original appearance prototype.
test('all persistent presentation fields carry without repetition across independent replies', () => {
  const full = { ...catalog, lighting: { time: ['night'], mood: ['warm'] } }
  const tx = fixture({ catalog: full })
  const response = tx.submit(batch(1, 4, [
    // private fork: manual ambience is retired; sound tags are the persistent soundscape field.
    op('scene.set', null, 'stage'), op('music.set', null, 'song'), op('actor.enter', 'soyo'),
    { op: 'stage.patch', value: { weather: 'rain', sound: ['empty', 'sealed'], lighting: { time: 'night', mood: 'warm' }, camera: { mode: 'close', actor: 'soyo' }, dof: 'soyo' } },
    { op: 'actor.patch', actor: 'soyo', value: { focus: 'normal', gaze: 'away', figureLight: 'glow' } },
    { op: 'widget.show', widgetId: 'letter', type: 'note', props: { body: 'Keep this safe.', title: 'Letter' } }
  ], true))
  assert.equal(response.ok, true)
  const complete = tx.effect(), next = fixture({ catalog: full, baseline: complete.end })
  next.submit(batch(1, 4, [], true))
  assert.deepEqual(next.effect().end, complete.end)
  assert.deepEqual(next.effect().entries, [])
  assert.equal(next.effect().end.widgets.letter.props.body, 'Keep this safe.')
  assert.deepEqual(next.effect().end.sound, ['empty', 'sealed'])
  assert.deepEqual(replayStage(complete), complete.end)
})

test('private fork: incremental sound tags validate, carry, reset on scene change, and retire ambience ops', () => {
  const tx = fixture()
  assert.equal(tx.submit(batch(1, 1, [op('scene.set', null, 'room'), { op: 'stage.patch', value: { sound: ['open'] } }])).ok, true)
  assert.deepEqual(tx.inspect().state.sound, ['open'])
  for (const sound of [['open', 'sealed'], ['loud'], 'open', ['empty', 'empty']]) {
    const rejected = tx.submit(batch(2, 2, [{ op: 'stage.patch', value: { sound } }]))
    assert.equal(rejected.ok, false); assert.match(rejected.error.path, /sound/)
  }
  const legacy = fixture().submit(batch(1, 4, [{ op: 'ambience.set', value: 'crowd' }], true))
  assert.equal(legacy.ok, false); assert.match(legacy.error.message, /Unknown operation/)
  const moved = fixture()
  assert.equal(moved.submit(batch(1, 4, [{ op: 'stage.patch', value: { sound: ['empty'] } }, op('scene.set', null, 'stage')], true)).ok, true)
  assert.deepEqual(moved.effect().end.sound, [], 'scene change restores scene-default tags')
  const schema = JSON.stringify(buildStageUpdateTool({ units: 4, catalog }).parameters)
  assert.doesNotMatch(schema, /ambience/); assert.match(schema, /"sound"/)
})

test('nested lighting/camera/widget partial updates retain unmentioned fields and explicit clears stay scoped', () => {
  const full = { ...catalog, lighting: { time: ['night'], mood: ['warm'] } }
  const tx = fixture({ catalog: full })
  tx.submit(batch(1, 1, [op('actor.enter', 'soyo'), { op: 'stage.patch', value: { lighting: { time: 'night', mood: 'warm' }, camera: { mode: 'close', actor: 'soyo' }, weather: 'rain' } }, { op: 'widget.show', widgetId: 'letter', type: 'note', props: { body: 'Original.', title: 'Keep title', style: 'letter' } }]))
  tx.submit(batch(2, 4, [{ op: 'stage.patch', value: { lighting: { mood: 'none' }, camera: { mode: 'wide' } } }, { op: 'widget.update', widgetId: 'letter', props: { body: 'Changed only.' } }], true))
  const end = tx.effect().end
  assert.deepEqual(end.lighting, { time: 'night', mood: 'none' })
  assert.equal(end.camera.actor, 'soyo'); assert.equal(end.weather, 'rain')
  assert.equal(end.widgets.letter.props.title, 'Keep title'); assert.equal(end.widgets.letter.props.style, 'letter')
  const reset = fixture({ catalog: full, baseline: end })
  reset.submit(batch(1, 4, [op('stage.reset')], true))
  assert.deepEqual(reset.effect().end, initialStageState(full))
})

test('widget lifecycle follows explicit boundary policy, never omission or wall-clock time', () => {
  const tx = fixture()
  tx.submit(batch(1, 1, [
    { op: 'widget.show', widgetId: 'lasting', type: 'note', props: { body: 'Persists' } },
    { op: 'widget.show', widgetId: 'short', type: 'note', props: { body: 'This turn only' }, lifetime: { until: 'turn-end' } },
    { op: 'widget.show', widgetId: 'clock', type: 'countdown', props: { remainingSeconds: 60 }, lifetime: { until: 'explicit', durationSeconds: 30 } }
  ]))
  tx.submit(batch(2, 4, [{ op: 'clock.advance', value: 30 }], true))
  const result = tx.effect()
  assert.deepEqual(Object.keys(result.end.widgets), ['lasting'])
  assert.deepEqual(Object.keys(replayStage(result, 1).widgets), ['lasting', 'short', 'clock'])
  assert.deepEqual(Object.keys(replayStage(result, 4).widgets), ['lasting', 'short'], 'paragraph view is before the explicit turn-end boundary')
  assert.deepEqual(replayStage(result), result.end)
})

test('all persistent-field operations remain atomic and deduplicate equal settings', () => {
  const tx = fixture()
  assert.equal(tx.submit(batch(1, 1, [{ op: 'stage.patch', value: { weather: 'rain' } }, { op: 'widget.show', widgetId: 'bad', type: 'note', props: { body: 5 } }])).ok, false)
  assert.equal(tx.inspect().state.weather, 'none')
  tx.submit(batch(1, 2, [{ op: 'stage.patch', value: { weather: 'rain' } }]))
  const response = tx.submit(batch(2, 4, [{ op: 'stage.patch', value: { weather: 'rain' } }, { op: 'actor.patch', actor: 'soyo', value: { gaze: 'viewer' } }], true))
  assert.equal(response.omittedNoops, 2)
  assert.equal(tx.effect().entries.length, 1)
  assert.equal(replayStage(tx.effect()).weather, 'rain')
})

test('declared parallel director/core operations share upstream commit and targeted recovery', async () => {
  for (const first of ['stage-director', 'settlement']) {
    const f = lifecycle(); f.body(1)
    const coordinator = createBackgroundTaskCoordinator({ store: f.store, timeline: f.timeline, parallelRoles: ['stage-director'] })
    const core = await coordinator.begin(f.read(), 'settlement')
    const director = await coordinator.begin(f.read(), 'stage-director')
    await core.checkpointMessage(0, (_chat, message) => { message.mvu = { pending: true, pendingSubmission: { operations: [] }, delivery: { marker: 'unchanged' } } })
    assert.equal(coordinator.activity(f.read()).role, 'settlement')
    const pending = { settlement: core, 'stage-director': director }
    const write = role => pending[role].commit({ stateChanged: false, participant: null, apply(chat) { chat.messages[0][role === 'settlement' ? 'postureReceipt' : 'directorReceipt'] = { ok: true } } })
    assert.equal((await write(first)).status, 'committed')
    assert.equal((await write(first === 'settlement' ? 'stage-director' : 'settlement')).status, 'committed')
    const message = f.read().messages[0]
    assert.ok(message.postureReceipt.ok && message.directorReceipt.ok)
    assert.deepEqual(message.mvu, { pending: true, pendingSubmission: { operations: [] }, delivery: { marker: 'unchanged' } })
    assert.equal(f.read().timeline.participants['stage-director'], undefined)
  }
  for (const cancelled of ['stage-director', 'settlement']) {
    const f = lifecycle(); f.body(1)
    const coordinator = createBackgroundTaskCoordinator({ store: f.store, timeline: f.timeline, parallelRoles: ['stage-director'] })
    const core = await coordinator.begin(f.read(), 'settlement'), stage = await coordinator.begin(f.read(), 'stage-director')
    const victim = cancelled === 'settlement' ? core : stage, sibling = cancelled === 'settlement' ? stage : core
    await coordinator.recover(f.read(), { operationId: victim.operationId })
    assert.equal(coordinator.operation(f.read(), victim.operationId).status, 'interrupted')
    assert.equal(coordinator.operation(f.read(), sibling.operationId).status, 'running')
    assert.equal((await victim.commit({ apply() { assert.fail('cancelled result must not apply') } })).status, 'stale')
    assert.equal((await sibling.commit({ stateChanged: false })).status, 'committed')
  }
})

test('parallel director alone does not block core admission or report core failure/busy', async () => {
  const f = lifecycle(); f.body(1); await commitStage(f)
  const coordinator = createBackgroundTaskCoordinator({ store: f.store, timeline: f.timeline, parallelRoles: ['stage-director'] })
  const stage = await coordinator.begin(f.read(), 'stage-director')
  assert.equal(coordinator.activity(f.read()).busy, false)
  const candidate = await coordinator.begin(f.read(), 'candidate')
  await stage.fail()
  assert.equal(coordinator.activity(f.read()).role, 'candidate')
  assert.equal(coordinator.activity(f.read()).busy, true)
  await candidate.commit({ stateChanged: false })
  assert.notEqual(coordinator.activity(f.read()).phase, 'failed')
})


test('parallel policy preserves existing body-ID stop of deferred settlement without cancelling director', async () => {
  const f = lifecycle(); f.body(1)
  const coordinator = createBackgroundTaskCoordinator({ store: f.store, timeline: f.timeline, parallelRoles: ['stage-director'] })
  const core = await coordinator.begin(f.read(), 'settlement')
  await core.defer()
  const stage = await coordinator.begin(f.read(), 'stage-director')
  const pending = coordinator.activity(f.read())
  assert.equal(pending.phase, 'pending')
  assert.notEqual(pending.operationId, core.operationId, 'legacy Stop addresses the body operation')
  assert.equal((await coordinator.recover(f.read(), { operationId: pending.operationId })).status, 'recovered')
  assert.equal(coordinator.operation(f.read(), core.operationId).status, 'interrupted')
  assert.equal(coordinator.operation(f.read(), stage.operationId).status, 'running')
  assert.notEqual(coordinator.activity(f.read()).phase, 'pending')
})

test('parallel retries cannot evict a long-running/deferred core operation or its body binding', async () => {
  const f = lifecycle(); f.body(1)
  const coordinator = createBackgroundTaskCoordinator({ store: f.store, timeline: f.timeline, parallelRoles: ['stage-director'] })
  const core = await coordinator.begin(f.read(), 'settlement')
  await core.defer()
  const bodyId = f.read().timeline.operations[core.operationId].roundOperationId
  for (let i = 0; i < 90; i++) await coordinator.begin(f.read(), 'stage-director')
  assert.equal(f.read().timeline.operations[core.operationId].status, 'deferred')
  assert.equal(f.read().timeline.operations[bodyId].kind, 'body')
})


test('existing task savepoints can resume batches without repeating events or resetting budget', () => {
  const tx = fixture({ budget: { maxToolCalls: 4 } })
  const first = batch(1, 2, [op('actor.enter', 'soyo'), op('act', 'soyo', 'bow')])
  tx.submit(first)
  tx.submit(batch(2, 3, [op('music.set', null, 'invented')]))
  const checkpoint = tx.savepoint()
  const resumed = fixture({ budget: { maxToolCalls: 4 }, checkpoint })
  assert.equal(resumed.inspect().calls, 2)
  assert.equal(resumed.submit(first).duplicate, true)
  assert.equal(resumed.inspect().calls, 2)
  resumed.submit(batch(2, 4, [op('music.set', null, 'song')], true))
  assert.equal(resumed.effect().entries.flatMap(beat => beat.ops).filter(command => command.op === 'act').length, 1)
  assert.equal(resumed.inspect().calls, 3)
  assert.equal(fixture({ budget: { maxToolCalls: 4 }, checkpoint: resumed.savepoint() }).completed(), true)
  const corrupt = structuredClone(checkpoint); corrupt.state.calls = 0
  assert.throws(() => fixture({ budget: { maxToolCalls: 4 }, checkpoint: corrupt }), /savepoint/)
  assert.throws(() => fixture({ budget: { maxToolCalls: 4 }, checkpoint, target: { ...target, revision: 99 } }), /binding/)
})

// private fork: scene proposals were removed, but receipts committed before that still replay (live saves).
test('replay still applies a committed historical scene.propose; new submissions reject it', () => {
  const tx = fixture({ baseline: dressed() })
  assert.equal(tx.submit(batch(1, 4, [op('music.stop')], true)).ok, true)
  const effect = structuredClone(tx.effect())
  effect.entries[0].ops.unshift({ op: 'scene.propose', value: { name: '病房', description: 'hospital room' } })
  effect.end.scene = '病房' // the saved end state already included the proposed scene
  const replayed = replayStage(effect, catalog)
  assert.equal(replayed.scene, '病房')
  assert.equal(replayed.music, null)
  const fresh = fixture()
  assert.equal(fresh.submit(batch(1, 4, [{ op: 'scene.propose', value: { name: 'x', description: 'y' } }], true)).ok, false)
})
