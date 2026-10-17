// private fork: AR-001/004 isolated frame realms and fault-injected RPC/storage.
import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'
import { webcrypto } from 'node:crypto'
import { createFrameStorage } from '../tavern-plugin/lib/domain/frame-storage.js'

const source = readFileSync(new URL('../tavern-plugin/src/client/fork-frame-storage.js', import.meta.url), 'utf8')
const tick = () => new Promise(resolve => setImmediate(resolve))
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
function events(target = {}) {
  const listeners = new Map()
  return Object.assign(target, {
    addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn) },
    removeEventListener(type, fn) { listeners.get(type)?.delete(fn) },
    fire(type, data = {}) { for (const fn of [...listeners.get(type) || []]) fn(data) }
  })
}
function fixture(intercept, initial = {}) {
  let saved = structuredClone(initial), timerId = 0
  const timers = new Map(), calls = [], warnings = []
  const server = createFrameStorage({ readJson: async () => structuredClone(saved), updateJson: async (_, fn) => { const next = fn(structuredClone(saved)); saved = next; return next } })
  const window = events({ crypto: webcrypto, setTimeout(fn) { timers.set(++timerId, fn); return timerId }, clearTimeout(id) { timers.delete(id) } })
  const context = vm.createContext({ window, TextEncoder, Uint8Array, console: { warn: (...args) => warnings.push(args) },
    rpc: async (method, args) => {
      if (method === 'getFrameStorage') return { values: await server.read() }
      calls.push(structuredClone(args.ops))
      if (intercept) return intercept(args.ops, server, calls.length)
      return server.update(args.ops)
    } })
  vm.runInContext(source, context)
  const storage = vm.runInContext('forkFrameStorage', context)
  const stop = vm.runInContext('installForkFrameStorageBridge(window)', context)
  function frame(card = 'card-a', session = 'session-a', opaque = true) {
    const capability = storage.capability({ cardPath: card, sessionId: session }, window)
    const child = events(), parent = { postMessage(data) { window.fire('message', { source: child, origin: opaque ? 'null' : 'https://host', data }) } }
    // Opaque realms cannot touch the host's storage or capability registry.
    if (opaque) Object.defineProperty(parent, '__dshForkFrameStorage', { get() { throw new Error('SecurityError') } })
    child.parent = parent
    child.postMessage = data => child.fire('message', { source: parent, data })
    const element = events({ contentWindow: child })
    const revoke = storage.register(element, capability)
    const realm = vm.createContext({ window: child, TextEncoder, console })
    realm.capability = capability
    vm.runInContext('(' + vm.runInContext('forkInstallFrameStorage.toString()', context) + ')(capability)', realm)
    return { element, child, capability, revoke, storage: child.localStorage, realm }
  }
  return { server, storage, window, timers, calls, warnings, frame, stop }
}

test('AR-001 opaque card shim writes, widget forgery and cross-card keys cannot enqueue', async () => {
  const f = fixture(); await f.storage.load()
  const card = f.frame(), other = f.frame('card-b')
  card.storage.setItem('theme', 'light')
  const forged = { type: 'dsh-tavern-frame-storage', token: card.capability.token, namespace: card.capability.namespace, op: 'set', key: card.capability.namespace + 'forged', value: 'bad' }
  assert.equal(f.storage.receive({ source: { parent: f.window }, origin: 'null', data: forged }), false, 'even stolen tokens are bound to a registered window')
  assert.equal(f.storage.receive({ source: card.child, data: { ...forged, token: 'guessed' } }), false)
  assert.equal(f.storage.receive({ source: card.child, data: { ...forged, key: other.capability.namespace + 'theme' } }), false)
  assert.equal(f.storage.receive({ source: card.child, data: { ...forged, namespace: other.capability.namespace } }), false)
  await f.storage.flush()
  assert.deepEqual(await f.server.read(), { [card.capability.namespace + 'theme']: 'light' })
  await f.stop()
})

test('AR-001 unload, owner detach, and subsequent navigation revoke the old token', async () => {
  for (const kind of ['pagehide', 'detach', 'navigation']) {
    const f = fixture(); await f.storage.load(); const card = f.frame()
    card.element.fire('load')
    if (kind === 'pagehide') card.child.fire('pagehide')
    if (kind === 'detach') card.revoke()
    if (kind === 'navigation') card.element.fire('load')
    card.storage.setItem('stale', 'bad')
    await f.storage.flush()
    assert.deepEqual(await f.server.read(), {})
    await f.stop()
  }
})

test('AR-001 validates types and UTF-8 bytes, and limits a frame flood before enqueue', async () => {
  const f = fixture(); await f.storage.load(); const card = f.frame()
  const send = overrides => f.storage.receive({ source: card.child, data: { type: 'dsh-tavern-frame-storage', token: card.capability.token, namespace: card.capability.namespace, op: 'set', key: card.capability.namespace + 'flood', value: 'x', ...overrides } })
  for (const override of [{ op: 'bogus' }, { key: {} }, { value: {} }, { key: card.capability.namespace + '\u4e00'.repeat(171) }, { value: '\u4e00'.repeat(90000) }]) assert.equal(send(override), false)
  let accepted = 0
  for (let i = 0; i < 2200; i++) accepted += Number(send({}))
  assert.equal(accepted, 2048)
  await f.storage.flush()
  assert.equal(f.calls.flat().length, 1, 'same-kind same-key writes coalesce')
  await f.stop()
})

for (const count of [501, 1001]) test('AR-004 persists all ' + count + ' operations in acknowledged batches', async () => {
  const f = fixture(); await f.storage.load(); const card = f.frame()
  for (let i = 0; i < count; i++) card.storage.setItem('k' + i, String(i))
  assert.equal(await f.storage.flush(), true)
  assert.equal(Object.keys(await f.server.read()).length, count)
  assert.deepEqual(f.calls.map(ops => ops.length), count === 501 ? [500, 1] : [500, 500, 1])
  await f.stop()
})

test('AR-004 failed RPC retains the batch, retries before newer set/remove operations', async () => {
  const f = fixture((ops, server, attempt) => attempt === 1 ? Promise.reject(new Error('OFFLINE')) : server.update(ops))
  await f.storage.load(); const card = f.frame()
  card.storage.setItem('key', 'first')
  assert.equal(await f.storage.flush(), false)
  card.storage.removeItem('key'); card.storage.setItem('key', 'last')
  assert.equal(await f.storage.flush(), true)
  assert.deepEqual(f.calls[1].map(op => op.op), ['set', 'remove', 'set'])
  assert.equal((await f.server.read())[card.capability.namespace + 'key'], 'last')
  assert.equal(f.warnings.length, 1)
  await f.stop()
})

test('AR-004 serializes requests so adversarial response ordering cannot lose newer writes', async () => {
  const gate = deferred()
  const f = fixture(async (ops, server, attempt) => { if (attempt === 1) await gate.promise; return server.update(ops) })
  await f.storage.load(); const card = f.frame()
  card.storage.setItem('key', 'first')
  const first = f.storage.flush()
  card.storage.removeItem('key'); card.storage.setItem('key', 'newest')
  const second = f.storage.flush()
  assert.equal(first, second)
  assert.equal(f.calls.length, 1, 'a second RPC cannot overtake the unacknowledged first one')
  gate.resolve(); await second
  assert.equal(f.calls.length, 2)
  assert.equal((await f.server.read())[card.capability.namespace + 'key'], 'newest')
  await f.stop()
})

for (const opaque of [false, true]) test('AR-004 clear is persisted and confined to card/session namespace (' + (opaque ? 'opaque' : 'same-origin') + ')', async () => {
  const f = fixture(); await f.storage.load(); const card = f.frame('a', 's', opaque), other = f.frame('b', 's', opaque)
  card.storage.setItem('keep?', 'no'); other.storage.setItem('keep', 'yes')
  card.storage.clear(); card.storage.setItem('after', 'new')
  await f.storage.flush(); card.revoke()
  const restarted = fixture(undefined, await f.server.read()); await restarted.storage.load()
  const reloaded = restarted.frame('a', 's', opaque)
  assert.equal(reloaded.storage.getItem('keep?'), null)
  assert.equal(reloaded.storage.getItem('after'), 'new')
  assert.equal((await f.server.read())[other.capability.namespace + 'keep'], 'yes')
  await restarted.stop(); await f.stop()
})

test('AR-004 pagehide flushes, and missing acknowledgement is not success', async () => {
  const f = fixture((ops, server, attempt) => attempt === 1 ? { values: {} } : server.update(ops))
  await f.storage.load(); const card = f.frame(); card.storage.setItem('key', 'value')
  f.window.fire('pagehide'); await tick()
  assert.equal(f.calls.length, 1)
  assert.equal(await f.storage.flush(), true)
  assert.equal(f.calls.length, 2)
  await f.stop()
})

test('AR-004 over-limit, invalid and quota-failed batches reject atomically', async () => {
  const f = fixture(), original = [{ op: 'set', key: 'existing', value: 'keep' }]
  await f.server.update(original)
  await assert.rejects(f.server.update(Array.from({ length: 501 }, (_, i) => ({ op: 'set', key: 'k' + i, value: 'x' }))), /500/)
  await assert.rejects(f.server.update([{ op: 'remove', key: 'existing' }, { op: 'bad', key: 'x' }]), /operation/)
  await assert.rejects(f.server.update([{ op: 'clear', namespace: '' }]), /namespace/)
  await assert.rejects(f.server.update(Array.from({ length: 10 }, (_, i) => ({ op: 'set', key: 'k' + i, value: 'x'.repeat(256 * 1024) }))), /2 MB/)
  assert.deepEqual(await f.server.read(), { existing: 'keep' })
  await f.stop()
})

test('AR-004 remove and clear before initial load do not resurrect persisted values', async () => {
  const f = fixture(), card = f.frame()
  await f.server.update([{ op: 'set', key: card.capability.namespace + 'old', value: 'old' }])
  card.storage.clear()
  await f.storage.load(); await f.storage.flush()
  assert.deepEqual(Object.keys(f.storage.snapshot(card.capability.namespace)), [])
  assert.deepEqual(await f.server.read(), {})
  await f.stop()
})


test('AR-004 quota rejection retains pending writes for recovery', async () => {
  const f = fixture(undefined, { occupied: 'x'.repeat(2 * 1024 * 1024 - 50) })
  await f.storage.load(); const card = f.frame()
  card.storage.setItem('pending', 'y'.repeat(100))
  assert.equal(await f.storage.flush(), false)
  assert.equal((await f.server.read())[card.capability.namespace + 'pending'], undefined)
  await f.server.update([{ op: 'remove', key: 'occupied' }])
  assert.equal(await f.storage.flush(), true)
  assert.equal((await f.server.read())[card.capability.namespace + 'pending'], 'y'.repeat(100))
  assert.equal(f.calls.length, 2)
  await f.stop()
})

test('AR-001 peers in one namespace observe updates without exposing another card', async () => {
  const f = fixture(); await f.storage.load()
  const a = f.frame('a', 's', false), peer = f.frame('a', 's'), other = f.frame('b', 's')
  a.storage.setItem('shared', 'value')
  assert.equal(peer.storage.getItem('shared'), 'value')
  assert.equal(other.storage.getItem('shared'), null)
  peer.storage.removeItem('shared')
  assert.equal(a.storage.getItem('shared'), null)
  a.storage.setItem('shared', 'again'); peer.storage.clear()
  assert.equal(a.storage.length, 0)
  await f.stop()
})
