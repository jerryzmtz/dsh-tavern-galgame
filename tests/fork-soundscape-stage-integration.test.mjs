// private fork: exercise the mounted runtime consumer, not the retired stage-local lifecycle.
import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'
import { assembleTavernClient } from '../bin/build-tavern-client.mjs'
const read = name => readFile(new URL('../tavern-plugin/src/client/' + name, import.meta.url), 'utf8')
const [playerSource, uiSource, stageSource] = await Promise.all(['fork-stage-soundscape-player.cjs', 'fork-stage-ui.js', 'fork-gal-stage.js'].map(read))
const plan = (place = 'cafe') => ({ version: 1, warnings: [], layers: [
  ...(place ? [{ slot: 'place', identity: place, id: place, url: '/fixtures/' + place + '.ogg', gain: 1, lowpassHz: null }] : []),
  { slot: 'weather', identity: 'rain', id: 'rain', url: '/fixtures/rain.ogg', gain: 1, lowpassHz: null }
] })
const flush = async () => { await Promise.resolve(); await Promise.resolve() }
function harness() {
  const nodes = [], timers = new Map(), listeners = new Map(), events = [], slots = [], effects = []
  let tick = 0, serial = 0, cursor = 0, rejected = 0, shotsStopped = 0, voiceStopped = 0, session = 'a'
  const window = {
    addEventListener(key, fn) { if (!listeners.has(key)) listeners.set(key, new Set()); listeners.get(key).add(fn) },
    removeEventListener(key, fn) { listeners.get(key)?.delete(fn) }
  }
  const React = {
    useRef(value) { const i = cursor++; return slots[i] ||= { current: value } },
    useCallback(fn) { cursor++; return fn },
    useLayoutEffect(fn, deps) { const i = cursor++, old = slots[i]; if (!old || deps.some((v, n) => !Object.is(v, old.deps[n]))) effects.push(() => { old?.cleanup?.(); slots[i] = { deps, cleanup: fn() } }) }
  }
  class Audio {
    constructor(url = '') { this.src = url; this.volume = 0; this.paused = true; this.plays = 0; nodes.push(this) }
    play() { this.plays++; if (rejected > 0) { rejected--; return Promise.reject(new Error('NotAllowedError')) }; this.paused = false; return Promise.resolve() }
    pause() { this.paused = true }
    removeAttribute(key) { if (key === 'src') this.src = '' }
    load() {}
    addEventListener() {}
    removeEventListener() {}
  }
  const store = { getSnapshot: () => ({ accepted: { ambience: plan() } }), dispatch: value => events.push(value) }
  const context = vm.createContext({ React, window, Audio, URL, performance: { now: () => tick },
    setTimeout(fn) { timers.set(++serial, fn); return serial }, clearTimeout(id) { timers.delete(id) },
    forkStageAudio: { bind() {}, level(node, value) { if (value === undefined) return node.volume; node.volume = value }, filter() {}, release(node) { node.released = true }, get: () => ({ ambience: 1, muted: {} }) },
    forkStageSfx: { stop() { shotsStopped++ } }, forkVoicePlayer: { stop() { voiceStopped++ } }
  })
  vm.runInContext(playerSource + '\nconst forkStageConsumers = new Map();\n' + uiSource.slice(uiSource.indexOf('function useForkStageConsumers(')), context)
  const hook = vm.runInContext('useForkStageConsumers', context)
  const consumers = vm.runInContext('forkStageConsumers', context)
  return { nodes, window, events, consumers,
    mount(next = session) { session = next; cursor = 0; hook(session, store, () => {}); effects.splice(0).forEach(fn => fn()) },
    present(value, snap = true) { return consumers.get(session).present({ type: 'present', accepted: { ambience: value }, groups: ['ambience'], transition: snap ? 'snap' : 'smooth' }) },
    revoke() { return consumers.get(session).present({ type: 'revoke-presentation' }) },
    snapshot: () => window.forkSoundscapeDebug.snapshot(),
    live: () => nodes.filter(node => node.src),
    advance(ms) { tick += ms; const work = [...timers.values()]; timers.clear(); work.forEach(fn => fn()) },
    gesture() { for (const fn of listeners.get('pointerdown') || []) fn() },
    reject(n) { rejected = n },
    unmount() { slots.forEach(slot => slot?.cleanup?.()) },
    listenerCount: () => [...listeners.values()].reduce((n, set) => n + set.size, 0),
    stops: () => [shotsStopped, voiceStopped] }
}
test('runtime consumer keeps matching weather while place changes and explicit empty projection stops layers', async () => {
  const h = harness(); h.mount(); await flush()
  const rain = h.live().find(node => node.src.includes('rain'))
  assert.equal(h.live().length, 2)
  await h.present(plan(null)); assert.deepEqual(h.live(), [rain])
  await h.present(plan('station')); assert.equal(h.live().length, 2); assert.equal(rain.plays, 1)
  await h.present({ version: 1, layers: [], warnings: [] }); assert.equal(h.live().length, 0)
  h.unmount()
})
test('equivalent runtime projections retain audio; replacement acknowledges the actual fade settlement', async () => {
  const h = harness(); h.mount(); await flush()
  const original = h.live().slice()
  for (let i = 0; i < 8; i++) await h.present(plan())
  assert.deepEqual(h.live(), original); assert.ok(original.every(node => node.plays === 1))
  let settled = false
  const done = h.present(plan('station'), false).then(() => { settled = true })
  await flush(); assert.equal(settled, false); assert.equal(h.live().length, 3)
  h.advance(5000); await done
  assert.equal(h.live().length, 2); assert.equal(settled, true)
  h.unmount()
})
test('mounted gesture retries blocked audio and teardown releases listeners, debug and media', async () => {
  const h = harness(); h.reject(2); h.mount(); await flush()
  const nodes = h.live().slice()
  assert.equal(nodes.length, 2); assert.ok(nodes.every(node => node.paused && node.plays === 1))
  h.gesture(); await flush(); assert.ok(nodes.every(node => !node.paused && node.plays === 2))
  assert.equal(h.listenerCount(), 2)
  h.unmount()
  assert.equal(h.live().length, 0); assert.equal(h.listenerCount(), 0)
  assert.equal(h.window.forkSoundscapeDebug, undefined); assert.equal(h.consumers.size, 0)
  assert.ok(nodes.every(node => node.released && node.paused))
  assert.deepEqual(h.stops(), [1, 1])
  assert.deepEqual(h.events.map(event => event.opened), [true, false])
})
test('session replacement releases the old sink; revoke stops ambience without unrelated one-shot teardown', async () => {
  const h = harness(); h.mount(); const old = h.live().slice()
  h.mount('b'); assert.equal(h.consumers.has('a'), false); assert.ok(old.every(node => node.paused && node.released))
  const stops = h.stops(); h.revoke()
  assert.equal(h.live().length, 0); assert.deepEqual(h.stops(), stops)
  const foreign = {}; h.window.forkSoundscapeDebug = foreign; h.unmount()
  assert.equal(h.window.forkSoundscapeDebug, foreign)
})
test('production bundle has one audio consumer path and no retired publication lifecycle', async () => {
  assert.match(stageSource, /useForkStageConsumers\(sessionId,runtime.store/)
  const bundle = await assembleTavernClient()
  assert.doesNotThrow(() => new vm.Script(bundle))
  assert.doesNotMatch(bundle, /function (?:useForkStageSoundscape|forkCreateStageSoundscape|useForkGalPosition|forkGalHistoryEntries)\(/)
  assert.equal(bundle.split('function forkCreateSoundscapePlayer(').length - 1, 1)
  assert.doesNotMatch(uiSource.slice(uiSource.indexOf('function useForkStageConsumers(')), /visibilitychange|document\.hidden/)
})
