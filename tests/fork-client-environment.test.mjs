import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { webcrypto } from 'node:crypto'
import { readFileSync } from 'node:fs'

const source = name => readFileSync(new URL('../tavern-plugin/src/client/' + name, import.meta.url), 'utf8')

test('widget boundary is lazy, stable across renders, and still catches rendering failures', () => {
  const react = {}
  const context = vm.createContext({ React: react })
  vm.runInContext(source('fork-gal-widgets.js'), context)
  react.Component = class { constructor(props) { this.props = props } }
  const Boundary = vm.runInContext('getForkWidgetBoundary()', context)
  assert.equal(vm.runInContext('getForkWidgetBoundary()', context), Boundary)
  let errors = 0
  const instance = new Boundary({ children: 'content', onError() { errors++ } })
  assert.equal(instance.render(), 'content')
  instance.state = Boundary.getDerivedStateFromError()
  instance.componentDidCatch()
  assert.equal(instance.render(), null)
  assert.equal(errors, 1)
  assert.equal(vm.runInContext('forkWidgetRuntime.errors', context), 1)
})

test('audio mixer uses defaults when the localStorage getter throws', () => {
  const context = vm.createContext({})
  vm.runInContext('Object.defineProperty(globalThis, "localStorage", { get() { throw new Error("SecurityError") } })', context)
  vm.runInContext(source('fork-stage-audio.js'), context)
  assert.equal(vm.runInContext('forkStageAudio.get().master', context), 0.8)
  vm.runInContext('forkStageAudio.setVolume("master", 0.4)', context)
  assert.equal(vm.runInContext('forkStageAudio.get().master', context), 0.4)
})

test('fork global listeners are effect-owned, idempotent and removable across reinstall', async () => {
  const events = new Map(), timers = new Map(), calls = []
  let next = 0, resumed = 0
  const window = {
    crypto: webcrypto,
    addEventListener(type, fn) { if (!events.has(type)) events.set(type, new Set()); events.get(type).add(fn) },
    removeEventListener(type, fn) { events.get(type)?.delete(fn); if (!events.get(type)?.size) events.delete(type) },
    setTimeout(fn) { timers.set(++next, fn); return next }, clearTimeout(id) { timers.delete(id) },
    AudioContext: class {
      state = 'suspended'
      createGain() { return { gain: { value: 0 }, connect() {} } }
      resume() { resumed++; return Promise.resolve() }
    }
  }
  const context = vm.createContext({ window, console, TextEncoder, rpc(method, args) { calls.push({ method, args }); return Promise.resolve({ ok: true, applied: args?.ops.length || 0, values: {} }) } })
  vm.runInContext(source('fork-frame-storage.js') + source('fork-stage-audio-math.js') + source('fork-stage-audio.js'), context)
  assert.equal(events.size, 0, 'loading exports must not install listeners or schedule RPC')
  assert.equal(timers.size, 0)
  for (let cycle = 0; cycle < 2; cycle++) {
    const stopStorage = vm.runInContext('installForkFrameStorageBridge(window)', context)
    const stopAudio = vm.runInContext('forkStageAudio.install(window)', context)
    vm.runInContext('installForkFrameStorageBridge(window); forkStageAudio.install(window)', context)
    assert.equal(events.size, 3)
    assert.equal(events.get('message').size, 1)
    assert.equal(events.get('pointerdown').size, 1)
    vm.runInContext('forkStageAudio.wake()', context)
    const before = resumed
    for (const fn of events.get('pointerdown')) fn()
    assert.equal(resumed, before + 1)
    const receive = [...events.get('message')][0]
    receive({ source: {}, data: { type: 'dsh-tavern-frame-storage', op: 'set', key: 'denied', value: 'x' } })
    const storage = vm.runInContext('forkFrameStorage', context)
    const capability = storage.capability({ cardPath: 'card', sessionId: 'session' }, window)
    const frame = { contentWindow: { parent: window }, addEventListener() {}, removeEventListener() {} }
    storage.register(frame, capability)
    receive({ source: frame.contentWindow, data: { type: 'dsh-tavern-frame-storage', token: capability.token, namespace: capability.namespace, op: 'set', key: capability.namespace + 'theme', value: 'light' } })
    assert.equal(storage.snapshot(capability.namespace).denied, undefined)
    assert.equal(storage.snapshot(capability.namespace).theme, 'light')
    await stopStorage(); stopAudio(); await stopStorage(); stopAudio()
    assert.equal(events.size, 0)
    assert.equal(timers.size, 0)
    assert.equal(window.__dshForkFrameStorage, undefined)
    assert.equal(calls.filter(call => call.method === 'updateFrameStorage').length, cycle + 1, 'disposal flushes pending writes')
  }
  assert.equal(calls.filter(call => call.method === 'updateFrameStorage').length, 2)
  const template = source('main.js')
  assert.match(template, /ctx\.effect\(\(\) => installForkFrameStorageBridge\(window\)/)
  assert.match(template, /ctx\.effect\(\(\) => forkStageAudio\.install\(window\)/)
})
