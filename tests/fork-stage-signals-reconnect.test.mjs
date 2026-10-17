// private fork (O09): the stage session binding against the real dsh-tavern-remote signal service.
// The real service calls onConnect synchronously when a stream is already connected (every 履历 jump,
// stage re-entry or remount re-subscribes) and again on every reconnect snapshot. The old fixture's
// `subscribe: () => () => {}` never connected, so `this.get is not a function` only showed on a real host.
import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { setImmediate } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'
import { createControllableBinding } from './helpers/stage-runtime-harness.mjs'
import { nativeBinding, nativeNode, textHelpers } from './helpers/stage-session-harness.mjs'

const read = name => readFileSync(new URL('../tavern-plugin/src/client/' + name, import.meta.url), 'utf8')
const remoteRequire = createRequire(new URL('../tavern-plugin/packages/dsh-tavern-remote/package.json', import.meta.url))
let real
try {
  real = {
    cordis: await import(pathToFileURL(remoteRequire.resolve('@deepseek-ai/cordis')).href),
    gatewaySource: await readFile(remoteRequire.resolve('@deepseek-ai/dsh-api-gateway/client'), 'utf8'),
  }
} catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND') throw error
  real = { missing: 'real Gateway dependencies unavailable: ' + error.message }
}
const flush = async () => { for (let i = 0; i < 5; i++) await setImmediate() }

function followQueue(ids, abortSignal) {
  const pending = []
  let waiting
  const settle = result => {
    if (!waiting) { pending.push(result); return }
    const current = waiting
    waiting = undefined
    current.resolve(result)
  }
  abortSignal.addEventListener('abort', () => settle({ done: true }), { once: true })
  return {
    ids: Array.from(ids), signal: abortSignal,
    send(value) { settle({ value, done: false }) },
    [Symbol.asyncIterator]() { return this },
    next() {
      if (abortSignal.aborted) return Promise.resolve({ done: true })
      if (pending.length) return Promise.resolve(pending.shift())
      return new Promise(resolve => { waiting = { resolve } })
    },
    return() { settle({ done: true }); return Promise.resolve({ done: true }) },
  }
}

// The shipped remote client bundle on the shipped Gateway, as the host mounts it.
async function realSignals(t) {
  let descriptor, service
  const follows = []
  const sandbox = { AbortController, AbortSignal, Error, setTimeout, clearTimeout,
    window: { __ModuleLoader__: { load(value) { descriptor = value } } } }
  vm.runInNewContext(real.gatewaySource, sandbox)
  const gateway = descriptor.factory(() => real.cordis)
  vm.runInNewContext(await readFile(new URL('../tavern-plugin/packages/dsh-tavern-remote/lib/client.js', import.meta.url), 'utf8'), sandbox)
  const client = descriptor.factory(() => gateway)
  const connection = { generation: { getSnapshot: () => 1, subscribe: () => () => {} } }
  const dispose = await client.apply({
    remote: { async $mount() { return async () => {} }, $stream: options => new gateway.RemoteStream(connection, options) },
    get: () => ({ follow(ids, abortSignal) { const queue = followQueue(ids, abortSignal); follows.push(queue); return queue } }),
    provide(_name, value) { service = value },
  })
  t.after(dispose)
  return { service, follows, latest: () => follows[follows.length - 1] }
}

function bindingContext(signals, calls, errors) {
  const binding = nativeBinding([nativeNode(1, 'Before')]), list = createControllableBinding({ current: 's', byId: { s: {} } })
  const view = createControllableBinding({ view: { mode: 'story', chatId: 'c', card: { path: 'card' } } })
  const settings = createControllableBinding({ cardPath: 'card', config: { enabled: true } })
  const pref = createControllableBinding({ value: 'prefs' }), helpers = textHelpers()
  const ui = { binding: () => ({ target: () => binding.chat }) }
  const context = { AbortController, setTimeout, clearTimeout,
    forkForeground: { now: () => 0, setTimeout, clearTimeout },
    forkAvatarCache: { select() {}, revision() {}, get() {} },
    forkVoicePlayer: { cancelPrefetch() {}, handle() { return { prefetch() {} } } },
    forkBgm: { activate() {}, invalidate() {}, kick() {} },
    rpc: async (method, args) => { calls.push([method, args?.event]); return method === 'getStageDirection' ? { phase: 'off', revision: calls.length } : {} },
    tavernSessionSignals: signals,
    console: { warn: (...args) => errors.push(args.map(String).join(' ')), error: (...args) => errors.push(args.map(String).join(' ')), log() {} },
    window: {}, module: { exports: {} },
    document: { hidden: false, addEventListener() {}, removeEventListener() {} },
    ...helpers.api,
    liveTavernView: { select: () => view, invalidate() {} },
    tavernCoordination: { getSnapshot: () => ({ view: { runtimeGeneration: 'host' } }), subscribe: () => () => {} },
    forkBubbleStore: { get: settings.getSnapshot, subscribe: settings.subscribe, load() {}, watch: () => () => {} },
    forkStageReading: { get: pref.getSnapshot, subscribe: pref.subscribe },
    forkStageFilm: { get: () => false, subscribe: pref.subscribe },
    forkStageAudio: { get: () => ({ master: .8 }), subscribe: pref.subscribe },
    resolveConversationChatBinding: (conversation, value) => conversation.binding(value).target('chat') }
  context.ctx = { sessions: { list, binding: id => id === 's' ? binding : undefined }, get: name => name === 'uiConversation' ? ui : undefined }
  // Production sources, as bundled: method shorthands run with whatever receiver the caller gives them.
  const source = read('fork-stage-session-binding.js')
    .replace(/^\/\/ @include-mod (.+)$/gm, (_all, name) => readFileSync(new URL('../fork/mods/' + name, import.meta.url), 'utf8'))
    .replace(/^\/\/ @include-protocol (.+)$/gm, (_all, name) => readFileSync(new URL('../tavern-plugin/packages/dsh-presentation-protocol/src/' + name, import.meta.url), 'utf8'))
    .replace(/^\/\/ @include (.+)$/gm, (_all, name) => read(name))
  vm.runInNewContext(source + '\nglobalThis.forkStageSessions = forkStageSessions;', context)
  return context
}

test('O09: connect, reconnect and 履历/remount re-subscription keep the real signal chain alive', { skip: real.missing }, async t => {
  const h = await realSignals(t), calls = [], errors = [], connects = []
  // Pass-through to the real service; only records that each stage onConnect returned.
  const signals = { subscribe: (sessionId, kind, listener, onError, onConnect) => h.service.subscribe(sessionId, kind, listener, onError,
    () => { connects.push(kind + ':enter'); onConnect(); connects.push(kind + ':ok') }) }
  // The chat side's own tavern-state listener (main.js) keeps the shared stream up while the stage remounts.
  const stopHost = h.service.subscribe('s', 'tavern-state', () => {})
  t.after(stopHost)
  const context = bindingContext(signals, calls, errors)
  let stop = context.forkStageSessions.start(context.ctx)
  t.after(() => stop?.())
  await flush()
  assert.deepEqual(h.latest().ids, ['s'], 'the stage follows its session')
  const activity = () => calls.filter(([method, event]) => method === 'notifyModPresentation' && event === 'activity.changed').length
  const reads = () => calls.filter(([method]) => method === 'getStageDirection').length
  // Reconnect path: the physical snapshot runs onConnect for both stage subscriptions. A throwing onConnect
  // failed the whole stream here, so every listener lost its snapshot and the service stayed disconnected.
  let before = activity()
  h.latest().send({ type: 'snapshot', signals: [] })
  await flush()
  assert.deepEqual(connects, ['stage-direction:enter', 'stage-direction:ok', 'tavern-state:enter', 'tavern-state:ok'])
  assert.deepEqual(errors, [])
  assert.equal(activity(), before + 2, 'each stage onConnect tells mods the stage activity')
  // 履历 return / stage remount while connected: onConnect runs synchronously inside subscribe → watch → runEffect → dispatch.
  stop(); stop = undefined; connects.length = 0
  before = activity()
  assert.doesNotThrow(() => { stop = context.forkStageSessions.start(context.ctx) })
  assert.deepEqual(connects, ['stage-direction:enter', 'stage-direction:ok', 'tavern-state:enter', 'tavern-state:ok'], 'synchronous onConnect on the connected stream')
  await flush()
  assert.deepEqual(errors, [])
  assert.ok(activity() >= before + 2, 'the synchronous onConnect reached the session owner')
  // The chain still observes the director after the re-subscription.
  const read = reads()
  h.latest().send({ type: 'delta', signal: { id: 'stage-direction:9', sessionId: 's', kind: 'stage-direction', version: 9 } })
  await flush()
  assert.ok(reads() > read, 'a director signal after remount wakes a read')
  assert.deepEqual(errors, [])
})
test('O09: entering the stage on an already-connected stream (the D08 stack) does not throw', { skip: real.missing }, async t => {
  const h = await realSignals(t), calls = [], errors = []
  const stopHost = h.service.subscribe('s', 'tavern-state', () => {})
  t.after(stopHost)
  await flush()
  h.latest().send({ type: 'snapshot', signals: [] })
  await flush()
  const context = bindingContext(h.service, calls, errors)
  let stop
  t.after(() => stop?.())
  // Real host: TypeError: this.get is not a function at onConnect ← subscribe ← watch ← runEffect ← dispatch.
  assert.doesNotThrow(() => { stop = context.forkStageSessions.start(context.ctx) })
  await flush()
  assert.deepEqual(errors, [])
  const read = calls.filter(([method]) => method === 'getStageDirection').length
  h.latest().send({ type: 'delta', signal: { id: 'stage-direction:3', sessionId: 's', kind: 'stage-direction', version: 3 } })
  await flush()
  assert.ok(calls.filter(([method]) => method === 'getStageDirection').length > read)
})