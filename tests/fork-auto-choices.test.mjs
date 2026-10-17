import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createForkAutoChoices } from '../tavern-plugin/lib/fork-auto-choices.js'
import { applyTavernSettingsPatch, presentTavernSettings } from '../tavern-plugin/lib/domain/tavern-settings.js'

function harness() {
  const timers = new Set(), calls = [], errors = []
  let settings = { candidateAutoGenerate: true }
  const state = { running: false, messageId: 'reply-1', chat: {
    id: 'chat', mode: 'story', timeline: { branchId: 'branch' },
    messages: [{ role: 'assistant', turn: 1, ts: 100, text: 'A completed reply' }]
  } }
  const background = { busy: false, role: '', phase: 'idle' }
  let fail = false
  const scheduler = createForkAutoChoices({
    read: async () => structuredClone(state), preferences: async () => settings,
    activity: () => background,
    submit: async args => { calls.push(args); if (fail) throw new Error('submit failed') },
    defer: callback => { timers.add(callback); return callback }, clear: callback => timers.delete(callback),
    report: (...args) => errors.push(args)
  })
  const event = { sessionId: 'game', messageId: 'reply-1', turn: 1, reason: 'completed' }
  async function tick() {
    const batch = [...timers]; timers.clear()
    for (const callback of batch) callback()
    await new Promise(resolve => setImmediate(resolve))
  }
  return { scheduler, state, background, calls, errors, timers, event, tick,
    enable(value) { settings = { candidateAutoGenerate: value } }, fail() { fail = true } }
}

test('only live completed replies qualify: no chat-open catch-up, streaming, failed or disabled reply', async () => {
  const h = harness()
  await h.tick()
  assert.equal(h.calls.length, 0, 'opening a chat is not a completion event')
  for (const reason of ['running', 'error', 'aborted']) await h.scheduler.completed({ ...h.event, reason })
  await h.tick()
  assert.equal(h.calls.length, 0)
  h.enable(false)
  await h.scheduler.completed(h.event)
  h.enable(true)
  await h.scheduler.completed(h.event)
  await h.tick()
  assert.equal(h.calls.length, 0, 'enabling later cannot replay a completion observed while off')
  h.state.messageId = 'reply-2'; h.state.chat.messages[0].turn = 2
  await h.scheduler.completed({ ...h.event, messageId: 'reply-2', turn: 2 })
  assert.equal(h.calls.length, 1, 'idle completion submits immediately, without a polling tick')
  assert.equal(h.timers.size, 0)
})

test('pending/running settlement, background activity and compaction wait, then submit once with the manual contract', async () => {
  for (const mode of ['story', 'script']) {
    const h = harness(); h.state.chat.mode = mode
    h.background.role = 'settlement'; h.background.phase = 'pending'
    await h.scheduler.completed(h.event)
    await h.tick()
    assert.equal(h.calls.length, 0, 'pending settlement blocks even with busy false')
    h.background.busy = true; h.background.phase = 'running'
    await h.tick()
    h.background.role = 'worldbook'
    await h.tick()
    h.background.busy = false; h.background.phase = 'idle'
    h.state.chat.contextCompaction = { operation: { status: 'running' } }
    await h.tick()
    assert.equal(h.calls.length, 0)
    h.state.chat.contextCompaction.operation.status = 'completed'
    await h.tick()
    await h.scheduler.completed(h.event)
    await h.tick()
    assert.equal(h.calls.length, 1)
    assert.deepEqual(h.calls[0], { sessionId: 'game', messageId: 'reply-1', kind: 'candidate', guidance: '', requestId: h.calls[0].requestId })
    assert.match(h.calls[0].requestId, /^auto-choices-[a-f0-9]{64}$/)
    assert.equal(h.timers.size, 0)
  }
})

test('completion fires immediately alongside the independent director, despite the foreground phase still running', async () => {
  const h = harness()
  h.state.running = true
  h.state.director = { status: 'running' }
  await h.scheduler.completed({ ...h.event, reason: 'max-tokens' })
  assert.equal(h.calls.length, 1)
  assert.equal(h.timers.size, 0)
})

test('compaction and regeneration defer the same eligible reply until they clear', async () => {
  for (const blocked of ['compaction', 'regen']) {
    const h = harness()
    if (blocked === 'compaction') h.state.chat.contextCompaction = { operation: { status: 'running' } }
    else h.state.chat.regenInProgress = true
    await h.scheduler.completed(h.event)
    assert.equal(h.calls.length, 0)
    await h.tick()
    assert.equal(h.calls.length, 0)
    h.state.chat.regenInProgress = false
    h.state.chat.contextCompaction = null
    await h.tick()
    assert.equal(h.calls.length, 1)
    await h.tick()
    assert.equal(h.calls.length, 1)
  }
})

test('existing candidate panels/tasks, including failed tasks, prevent automatic resubmission', async () => {
  for (const existing of ['panel', 'queued', 'running', 'succeeded', 'failed', 'cancelled']) {
    const h = harness()
    if (existing === 'panel') h.state.chat.candidates = { messageId: 'reply-1' }
    else h.state.chat.taskMailbox = { tasks: { task: { kind: 'candidate', status: existing, input: { messageId: 'reply-1' } } } }
    await h.scheduler.completed(h.event)
    await h.tick()
    assert.equal(h.calls.length, 0, existing)
    assert.equal(h.timers.size, 0)
  }
})

test('card mode, greetings and replacement replies never arm automatic choices', async () => {
  for (const change of [h => { h.state.chat.mode = 'card' },
    h => { h.state.chat.messages[0].greeting = true }, h => { h.state.chat.messages[0].text = '' },
    h => { h.state.chat.messages[0].turn = 0 }]) {
    const h = harness(); change(h)
    await h.scheduler.completed(h.event)
    await h.tick()
    assert.equal(h.calls.length, 0)
    assert.equal(h.timers.size, 0)
  }
})

test('switch off, edits, branches, newer messages and explicit cancellation consume pending eligibility', async () => {
  for (const change of [h => h.enable(false), h => { h.state.chat.messages[0].text = 'edited' },
    h => { h.state.chat.timeline.branchId = 'other' },
    h => { h.state.messageId = 'new-message' }, h => h.scheduler.cancel('game'), h => h.scheduler.cancelAll()]) {
    const h = harness()
    h.state.chat.contextCompaction = { operation: { status: 'running' } }
    await h.scheduler.completed(h.event)
    change(h)
    await h.tick()
    await h.scheduler.completed(h.event)
    await h.tick()
    assert.equal(h.calls.length, 0)
    assert.equal(h.timers.size, 0)
  }
})

test('duplicate concurrent completion, failed submission and disposal never retry or submit twice', async () => {
  const h = harness(); h.fail()
  await Promise.all([h.scheduler.completed(h.event), h.scheduler.completed(h.event)])
  await h.tick(); await h.tick()
  await h.scheduler.completed(h.event); await h.tick()
  assert.equal(h.calls.length, 1)
  assert.equal(h.errors.length, 1)
  const disposed = harness()
  disposed.state.chat.regenInProgress = true
  await disposed.scheduler.completed(disposed.event)
  disposed.scheduler.dispose()
  await disposed.tick()
  assert.equal(disposed.calls.length, 0)
  assert.equal(disposed.timers.size, 0)
})

test('cancellation during async eligibility reads cannot re-arm an old reply', async () => {
  let release
  const settings = new Promise(resolve => { release = resolve })
  const timers = []
  const scheduler = createForkAutoChoices({ preferences: () => settings, read: async () => ({}),
    activity: () => ({}), submit: () => assert.fail('cancelled reply submitted'), defer: callback => timers.push(callback) })
  const pending = scheduler.completed({ sessionId: 'game', messageId: 'reply', turn: 1, reason: 'completed' })
  scheduler.cancel('game')
  release({ candidateAutoGenerate: true })
  await pending
  assert.equal(timers.length, 0)
})

test('global preference is default-off, strictly boolean, persists through JSON and preserves dismissal/unrelated settings', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'tavern-auto-choices-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const file = join(directory, 'tavern-settings.json')
  assert.equal(presentTavernSettings({}).candidateAutoGenerate, false)
  assert.equal(presentTavernSettings({ candidateAutoGenerate: 'true' }).candidateAutoGenerate, false)
  assert.throws(() => applyTavernSettingsPatch({}, { candidateAutoGenerate: 'true' }))
  const original = { candidateDismissMode: 'after-send', custom: 7 }
  await writeFile(file, JSON.stringify(applyTavernSettingsPatch(original, { candidateAutoGenerate: true })))
  const restored = JSON.parse(await readFile(file, 'utf8'))
  assert.equal(presentTavernSettings(restored).candidateAutoGenerate, true)
  assert.equal(presentTavernSettings(restored).candidateDismissMode, 'after-send')
  assert.equal(restored.custom, 7)
  assert.equal(presentTavernSettings(applyTavernSettingsPatch(restored, { candidateAutoGenerate: false })).candidateAutoGenerate, false)
})

test('host integration uses live foreground lifecycle and the existing candidate path without stage dependencies', async () => {
  const host = await readFile(new URL('../tavern-plugin/lib/index.js', import.meta.url), 'utf8') + '\n' + await readFile(new URL('../tavern-plugin/lib/hooks/turn-lifecycle.js', import.meta.url), 'utf8')
  const module = await readFile(new URL('../tavern-plugin/lib/fork-auto-choices.js', import.meta.url), 'utf8')
  assert.match(host, /submit: args => candidateTasks\.submit\(args\)/)
  assert.match(host, /event\?\.type === 'turn\/start'.*forkAutoChoices\?\.cancel/)
  assert.match(host, /void forkAutoChoices\?\.completed\(/)
  // private fork: upstream timeline notifications require block-bodied RPC cases.
  for (const method of ['getBodyEdit', 'saveBodyEdit', 'regenBody']) assert.match(host, new RegExp("case '" + method + "': (?:\\{\\s*)?forkAutoChoices\\.cancel"))
  assert.doesNotMatch(module, /fork-gal-|fork-bubble|stageDirector|startLegacy/)
})
