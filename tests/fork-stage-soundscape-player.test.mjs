import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'
import { forkCreateSoundscapePlayer } from '../tavern-plugin/src/client/fork-stage-soundscape-player.cjs'

const layer = (slot, url, gain = 1, lowpassHz = null) => ({ slot, id: url, identity:'fixture:'+url, url, gain, lowpassHz }) // private fork: explicit content identity
const plan = (...layers) => ({ version: 1, layers, warnings: [] })
const flush = async () => { await Promise.resolve(); await Promise.resolve() }
function harness(mixerOverride) {
  const nodes = [], frames = new Map(), levels = new Map(), calls = [], plays = []
  let clock = 0, ticket = 0, maximum = 0
  class Audio {
    constructor() { this.src = ''; this.volume = 1; this.paused = true; this.events = new Map(); this.playCount = 0; this.loads = 0; nodes.push(this) }
    addEventListener(name, fn) { if (!this.events.has(name)) this.events.set(name, new Set()); this.events.get(name).add(fn) }
    removeEventListener(name, fn) { this.events.get(name)?.delete(fn) }
    fire(name) { for (const fn of this.events.get(name) || []) fn() }
    play() {
      this.playCount++; this.paused = false; this.fire('play')
      maximum = Math.max(maximum, nodes.filter(n => n.src).length)
      return plays.length ? plays.shift()(this) : Promise.resolve()
    }
    pause() { this.paused = true; this.fire('pause') }
    removeAttribute(name) { if (name === 'src') this.src = '' }
    load() { this.loads++ }
  }
  const prefs = { ambience: 0.25, muted: { ambience: true } }
  const mixer = mixerOverride || {
    bind(node, bus, url) { calls.push(['bind', node, bus, url]) },
    level(node, value) { if (value === undefined) return levels.get(node) ?? node.volume; levels.set(node, value); node.volume = value },
    filter(node, value) { calls.push(['filter', node, value]) },
    release(node) { calls.push(['release', node]) },
    wake() { calls.push(['wake']) },
    get() { return structuredClone(prefs) },
    setVolume() { assert.fail('must not change preferences') }, toggleMute() { assert.fail('must not change preferences') }
  }
  const player = forkCreateSoundscapePlayer({ Audio, mixer, now: () => clock,
    requestFrame: fn => { frames.set(++ticket, fn); return ticket }, cancelFrame: id => frames.delete(id) })
  return { player, nodes, frames, calls, plays, mixer, maximum: () => maximum,
    advance(ms) { clock += ms; const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn(clock)) } }
}

test('two loops share only the ambience bus; repeated plans do not rebind/replay/restart fades or change mute', async () => {
  const h = harness(), p = plan(layer('place', '/room.ogg', 0.8), layer('weather', '/rain.ogg', 0.6))
  const prefs = h.mixer.get()
  h.player.apply(p); h.advance(600); await flush()
  assert.equal(h.nodes.length, 2)
  assert.deepEqual(h.nodes.map(n => [n.loop, n.preload, n.volume]), [[true, 'auto', 0.4], [true, 'auto', 0.3]])
  h.player.apply(p); h.advance(600)
  assert.deepEqual(h.nodes.map(n => [n.playCount, n.volume]), [[1, 0.8], [1, 0.6]])
  assert.deepEqual(h.calls.filter(c => c[0] === 'bind').map(c => c[2]), ['ambience', 'ambience'])
  assert.deepEqual(h.mixer.get(), prefs)
  assert.equal(h.frames.size, 0)
})

test('gain and filter changes interpolate without replay, including bypass', async () => {
  const h = harness()
  h.player.apply(plan(layer('place', '/room', 0.8, 8000)), { snap: true }); await flush()
  h.player.apply(plan(layer('place', '/room', 0.2, 2000)))
  assert.equal(h.nodes[0].volume, 0.8)
  h.advance(600)
  assert.equal(h.nodes[0].volume, 0.5)
  assert.equal(h.calls.filter(c => c[0] === 'filter').at(-1)[2], 5000)
  h.player.apply(plan(layer('place', '/room', 0.4, null)))
  assert.equal(h.nodes[0].volume, 0.5, 'interrupt from actual envelope')
  h.advance(600)
  assert.equal(h.nodes[0].volume, 0.45)
  assert.equal(h.calls.filter(c => c[0] === 'filter').at(-1)[2], 14500)
  h.advance(600)
  assert.equal(h.nodes[0].volume, 0.4)
  assert.equal(h.calls.filter(c => c[0] === 'filter').at(-1)[2], null)
  assert.equal(h.nodes[0].playCount, 1)
  assert.equal(h.calls.filter(c => c[0] === 'bind').length, 1)
})

test('both slots crossfade at 1200ms, rapid replacements release outgoing and preserve current levels', () => {
  const h = harness()
  h.player.apply(plan(layer('place', '/a'), layer('weather', '/b')), { snap: true })
  h.player.apply(plan(layer('place', '/c'), layer('weather', '/d')))
  assert.equal(h.nodes.filter(n => n.src).length, 4)
  h.advance(300)
  assert.deepEqual(h.nodes.map(n => n.volume), [0.75, 0.75, 0.25, 0.25])
  h.player.apply(plan(layer('place', '/e'), layer('weather', '/f')))
  assert.deepEqual(h.nodes.slice(0, 2).map(n => [n.src, n.paused, n.loads]), [['', true, 1], ['', true, 1]])
  assert.deepEqual(h.nodes.slice(2).map(n => n.volume), [0.25, 0.25, 0, 0])
  h.advance(600)
  assert.deepEqual(h.nodes.slice(2).map(n => n.volume), [0.125, 0.125, 0.5, 0.5])
  h.advance(600)
  assert.equal(h.nodes.filter(n => n.src).length, 2)
  assert.equal(h.maximum(), 4)
  assert.equal(h.frames.size, 0)
})

test('empty plan fades to hush; stop/snap and unsupported version affect only owned nodes', () => {
  const h = harness(), outsider = { paused: false }
  h.player.apply(plan(layer('place', '/a')), { snap: true })
  h.player.apply(plan()); h.advance(600)
  assert.equal(h.nodes[0].volume, 0.5)
  h.player.apply(plan()); h.advance(600)
  assert.equal(h.nodes[0].src, '', 'unchanged hush does not extend fade')
  h.player.apply(plan(layer('weather', '/b')), { snap: true })
  h.player.apply({ version: 2, layers: [] }); h.advance(1200)
  assert.deepEqual(h.player.snapshot().warnings, ['unsupported-plan'])
  assert.equal(h.nodes[1].src, '')
  h.player.apply(plan(layer('place', '/c'))); h.player.apply(plan(), { snap: true })
  assert.equal(h.nodes[2].src, '')
  h.player.apply(plan(layer('place', '/d'))); h.player.stop()
  assert.equal(h.frames.size, 0)
  assert.ok(h.nodes.every(n => n.paused && !n.src))
  assert.equal(outsider.paused, false)
})

// private fork: resource identity, not canonical transport URL, detects duplicates.
test('rejects invalid plans and duplicate content identities without making requests', () => {
  const h = harness()
  const bad = [plan(layer('unknown', '/a')), plan(layer('place', '/a'), layer('place', '/b')),
    plan(layer('place', '/a'), {...layer('weather', '/renewed-a'),identity:'fixture:/a'}),
    ...['//host/a', 'javascript:alert(1)', 'data:audio/wav,a', 'file:///a', '/a\\b', 'https://user:pass@host/a', '/a\n', '/a#fragment', '', null].map(url => plan(layer('place', url))),
    plan(layer('place', '/a', NaN)), plan(layer('place', '/a', 2)), plan(layer('place', '/a', 1, -1)), { version: 1 }]
  for (const p of bad) { h.player.apply(p); assert.equal(h.player.snapshot().warnings.length, 1) }
  assert.equal(h.nodes.length, 0)
  assert.equal(h.calls.length, 0)
  h.player.apply(plan(layer('place', 'https://example.test/a.ogg')))
  assert.equal(h.nodes.length, 1)
})

test('URL transfers between slots cannot overlap themselves; both directions stay bounded', () => {
  const h = harness()
  h.player.apply(plan(layer('place', '/a'), layer('weather', '/b')), { snap: true })
  h.player.apply(plan(layer('place', '/b'), layer('weather', '/a')))
  assert.deepEqual(h.nodes.filter(n => n.src).map(n => n.src).sort(), ['/a', '/b'])
  h.advance(600)
  h.player.apply(plan(layer('weather', '/b')))
  assert.equal(h.nodes.filter(n => n.src === '/b').length, 1)
  h.advance(1200)
  assert.equal(h.nodes.filter(n => n.src).length, 1)
  assert.ok(h.maximum() <= 4)
})

test('play rejections, synchronous throws and media errors are visible and retryable on apply/resume', async () => {
  const h = harness(), p = plan(layer('place', '/a'))
  h.plays.push(() => Promise.reject(new Error('secret raw exception')))
  h.player.apply(p); await flush()
  assert.equal(h.player.snapshot().slots.place.current.error, 'play-rejected')
  assert.ok(!JSON.stringify(h.player.snapshot()).includes('secret'))
  h.plays.push(() => { throw new Error('blocked') })
  h.player.apply(p)
  assert.equal(h.nodes[0].playCount, 2)
  assert.equal(h.player.snapshot().slots.place.current.error, 'play-rejected')
  h.player.resume(); await flush()
  assert.equal(h.nodes[0].playCount, 3)
  assert.equal(h.player.snapshot().slots.place.current.status, 'playing')
  assert.equal(h.player.snapshot().slots.place.current.error, null)
  h.nodes[0].fire('error')
  assert.equal(h.player.snapshot().slots.place.current.error, 'media-error')
  h.player.apply(p); await flush()
  assert.equal(h.nodes[0].playCount, 4)
  assert.equal(h.nodes.length, 1)
})

test('pending play cannot restart newer slots, mutate disposed snapshots or retain engine listeners', async () => {
  const h = harness(); let complete, reject
  h.plays.push(node => new Promise(resolve => { complete = () => { node.paused = false; resolve() } }))
  h.player.apply(plan(layer('place', '/a')))
  h.player.apply(plan(layer('place', '/a')))
  assert.equal(h.nodes[0].playCount, 1, 'do not retry still-pending play')
  h.plays.push(() => new Promise((_, fail) => { reject = fail }))
  h.player.apply(plan(layer('place', '/b')), { snap: true })
  complete(); await flush()
  assert.equal(h.nodes[0].paused, true)
  assert.equal(h.player.snapshot().slots.place.current.url, '/b')
  h.player.dispose()
  reject(new Error('late failure')); await flush()
  assert.equal(h.frames.size, 0)
  assert.ok(h.nodes.every(n => n.paused && !n.src && [...n.events.values()].every(set => set.size === 0)))
  assert.equal(h.calls.filter(c => c[0] === 'release').length, 2)
  const final = h.player.snapshot()
  h.player.apply(plan(layer('weather', '/c'))); h.player.resume(); h.player.dispose()
  assert.deepEqual(h.player.snapshot(), final)
  assert.equal(final.disposed, true)
  assert.throws(() => { final.slots.place.current = {} }, TypeError)
  assert.throws(() => { final.warnings.push('changed') }, TypeError)
})

test('pending success after dispose is paused again and cannot revive audio', async () => {
  const h = harness(); let complete
  h.plays.push(node => new Promise(resolve => { complete = () => { node.paused = false; resolve() } }))
  h.player.apply(plan(layer('place', '/a')))
  h.player.dispose(); complete(); await flush()
  assert.equal(h.nodes[0].paused, true)
  assert.equal(h.nodes[0].src, '')
  assert.equal(h.nodes[0].loads, 2)
  assert.equal(h.calls.filter(c => c[0] === 'release').length, 1)
})

const math = await readFile(new URL('../tavern-plugin/src/client/fork-stage-audio-math.js', import.meta.url), 'utf8')
const mixerSource = await readFile(new URL('../tavern-plugin/src/client/fork-stage-audio.js', import.meta.url), 'utf8')
function realMixerHarness({ contextAvailable = true, automate = true } = {}) {
  const sources = new WeakSet(), gains = [], filters = [], storage = new Map(); let ctx
  const param = value => ({ value, calls: [], cancelScheduledValues(t) { this.calls.push(['cancel', t]) },
    setTargetAtTime(v, t, c) { this.value = v; this.calls.push(['target', v, t, c]) },
    setValueAtTime(v) { this.value = v }, linearRampToValueAtTime(v) { this.value = v } })
  const graph = () => ({ links: [], disconnects: 0, connect(to) { assert.ok(!this.links.includes(to), 'no duplicate connection'); this.links.push(to) }, disconnect() { this.disconnects++; this.links = [] } })
  class Context {
    constructor() { ctx = this; this.currentTime = 2; this.state = 'running'; this.sampleRate = 48000; this.destination = {} }
    createGain() { const node = { ...graph(), gain: param(1) }; gains.push(node); return node }
    createMediaElementSource(node) { assert.equal(sources.has(node), false); sources.add(node); return graph() }
    createAnalyser() { return graph() }
    createBiquadFilter() { const node = { ...graph(), frequency: automate ? param(350) : { value: 350 }, Q: param(1) }; filters.push(node); return node }
  }
  const audio = vm.runInNewContext(math + mixerSource + ';forkStageAudio', {
    window: contextAvailable ? { AudioContext: Context } : {},
    localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    rpc: async () => { throw new Error('not measured') }
  })
  const node = () => ({ volume: 1, paused: false, events: new Map(),
    addEventListener(name, fn) { if (!this.events.has(name)) this.events.set(name, new Set()); this.events.get(name).add(fn) },
    removeEventListener(name, fn) { this.events.get(name)?.delete(fn) },
    fire(name) { for (const fn of this.events.get(name) || []) fn() } })
  return { audio, node, gains, filters, ctx: () => ctx }
}

test('optional lowpass is inert until used, reuses source/analyser and preserves gain, bus and envelopes', () => {
  for (const analyserFirst of [false, true]) {
    const h = realMixerHarness(), node = h.node(), record = h.audio.bind(node, 'ambience', '/a')
    const source = record.source, gain = record.gain, bus = gain.links[0]
    h.audio.level(node, 0.4); const norm = gain.gain.value
    assert.deepEqual(source.links, [gain]); assert.equal(h.filters.length, 0)
    assert.equal(h.audio.filter(node, null), true); assert.equal(h.filters.length, 0)
    if (analyserFirst) h.audio.analyser(node)
    assert.equal(h.audio.filter(node, 3200), true)
    const filter = h.filters[0]
    assert.equal(filter.type, 'lowpass'); assert.equal(filter.Q.value, 0)
    assert.deepEqual(filter.frequency.calls.at(-1), ['target', 3200, 2, 0.05])
    h.audio.analyser(node)
    assert.deepEqual(source.links, [record.analyser]); assert.deepEqual(record.analyser.links, [filter]); assert.deepEqual(filter.links, [gain])
    h.audio.filter(node, 1600); h.audio.filter(node, 1600)
    assert.equal(h.filters.length, 1); assert.equal(record.source, source)
    assert.equal(record.gain, gain); assert.equal(gain.gain.value, norm); assert.deepEqual(gain.links, [bus])
    assert.equal(h.audio.level(node), 0.4); assert.equal(node.volume, 0.4)
    h.audio.toggleMute('ambience'); h.audio.voice(true)
    assert.equal(bus.gain.value, 0); assert.equal(h.audio.get().muted.ambience, true)
    h.audio.filter(node, 0); h.audio.filter(node, null)
    assert.deepEqual(record.analyser.links, [gain]); assert.deepEqual(filter.links, [])
    h.audio.filter(node, 1200)
    assert.deepEqual(record.analyser.links, [filter]); assert.deepEqual(filter.links, [gain]); assert.equal(h.filters.length, 1)
    assert.equal(h.audio.get().muted.ambience, true)
    assert.equal(bus.gain.value, 0)
    h.audio.bind(node, 'music', '/a')
    assert.notEqual(gain.links[0], bus)
    assert.deepEqual(record.analyser.links, [filter])
  }
})

test('optional lowpass handles fallback, invalid inputs and AudioParams without automation', () => {
  const fallback = realMixerHarness({ contextAvailable: false }), n = fallback.node()
  assert.equal(fallback.audio.filter(n, 1000), false, 'unbound is inert')
  fallback.audio.bind(n, 'ambience', '/a')
  assert.equal(fallback.audio.filter(n, 1000), false)
  const h = realMixerHarness({ automate: false }), node = h.node(), record = h.audio.bind(node, 'ambience', '/a')
  for (const value of [-1, Infinity, NaN, '1000']) assert.equal(h.audio.filter(node, value), false)
  assert.equal(h.filters.length, 0)
  h.audio.filter(node, 1)
  assert.equal(h.filters[0].frequency.value, 20)
  h.audio.filter(node, 100000)
  assert.equal(h.filters[0].frequency.value, 24000)
  h.audio.filter(node, 0)
  assert.deepEqual(record.source.links, [record.gain])
})

test('terminal mixer release disconnects the entire graph, removes only owned handlers and forbids revival', () => {
  const h = realMixerHarness(), node = h.node(), other = h.node()
  const record = h.audio.bind(node, 'ambience', '/a'), otherRecord = h.audio.bind(other, 'ambience', '/other')
  h.audio.analyser(node); h.audio.filter(node, 1800); h.audio.level(node, 0.6)
  h.audio.toggleMute('ambience')
  const prefs = h.audio.get(), bus = record.gain.links[0], normalization = record.gain.gain.value
  const stalePlay = [...node.events.get('play')][0]
  const observer = () => {}; node.addEventListener('play', observer)
  const graph = [record.source, record.analyser, record.filter, record.gain]
  const disconnects = graph.map(part => part.disconnects)
  h.audio.release(node)
  assert.equal(record.released, true)
  for (const [i, part] of graph.entries()) {
    assert.deepEqual(part.links, [])
    assert.equal(part.disconnects, disconnects[i] + 1)
  }
  assert.deepEqual([...node.events.get('play')], [observer])
  for (const event of ['pause', 'ended', 'error']) assert.equal(node.events.get(event).size, 0)
  assert.deepEqual(h.audio.get(), prefs)
  assert.equal(record.gain.gain.value, normalization)
  assert.deepEqual(otherRecord.gain.links, [bus], 'shared bus and other elements stay connected')
  const calls = record.gain.gain.calls.length
  stalePlay(); node.fire('play')
  h.audio.setVolume('master', h.audio.get().master)
  assert.equal(record.gain.gain.calls.length, calls, 'stale play does not reactivate normalization updates')
  assert.throws(() => h.audio.bind(node, 'ambience', '/new'), /Cannot bind a released audio element/)
  assert.equal(h.audio.analyser(node), null)
  assert.equal(h.audio.filter(node, 800), false)
  h.audio.level(node, 1)
  assert.equal(h.audio.level(node), 0.6)
  h.audio.release(node); h.audio.release(h.node())
  graph.forEach((part, i) => assert.equal(part.disconnects, disconnects[i] + 1, 'idempotent release'))
  assert.equal(h.filters.length, 1)
})

test('release works in fallback and with older fake elements that cannot remove listeners', () => {
  for (const contextAvailable of [false, true]) {
    const h = realMixerHarness({ contextAvailable }), node = h.node()
    delete node.removeEventListener
    const record = h.audio.bind(node, 'ambience', '/a')
    h.audio.release(node); h.audio.release(node)
    const before = node.volume, calls = record.gain?.gain.calls.length
    node.fire('play'); h.audio.setVolume('ambience', 0.2)
    assert.equal(node.volume, before)
    assert.equal(record.gain?.gain.calls.length, calls)
    assert.throws(() => h.audio.bind(node, 'voice', '/b'), /released audio element/)
  }
})

test('player disposal tears down real mixer graphs and late play completion cannot reconnect them', async () => {
  const real = realMixerHarness(), records = [], bind = real.audio.bind
  real.audio.bind = (...args) => { const record = bind(...args); records.push(record); return record }
  const h = harness(real.audio); let complete
  h.plays.push(node => new Promise(resolve => { complete = () => { node.paused = false; node.fire('play'); resolve() } }))
  h.player.apply(plan(layer('place', '/room', 0.6, 1800), layer('weather', '/rain', 0.4)), { snap: true })
  real.audio.analyser(h.nodes[0])
  const stalePlay = [...h.nodes[0].events.get('play')][0], prefs = real.audio.get()
  const parts = records.flatMap(record => [record.source, record.analyser, record.filter, record.gain].filter(Boolean))
  const calls = records.map(record => record.gain.gain.calls.length)
  h.player.dispose()
  parts.forEach(part => assert.deepEqual(part.links, []))
  assert.ok(h.nodes.every(node => [...node.events.values()].every(handlers => handlers.size === 0)))
  complete(); stalePlay(); await flush()
  assert.ok(h.nodes.every(node => node.paused && !node.src))
  assert.ok(records.every(record => record.released))
  assert.deepEqual(real.audio.get(), prefs, 'disposal preserves preferences')
  real.audio.setVolume('master', real.audio.get().master)
  records.forEach((record, i) => assert.equal(record.gain.gain.calls.length, calls[i]))
  parts.forEach(part => assert.deepEqual(part.links, []))
  assert.deepEqual(JSON.parse(JSON.stringify(real.audio.get())), { ...prefs, muted: { ...prefs.muted, master: false } })
  assert.equal(h.player.snapshot().disposed, true)
})

test('filter and release remain optional, diagnostics are detached and sanitize controls', () => {
  const h = harness()
  delete h.mixer.filter; delete h.mixer.release
  const p = plan({ ...layer('place', '/a', 0.5, 1000), id: 'room\u0000name' })
  p.warnings = ['warning\u0001text', { unsafe: true }]
  h.player.apply(p, { snap: true })
  const snapshot = h.player.snapshot()
  assert.equal(snapshot.slots.place.current.id, 'roomname')
  assert.deepEqual(snapshot.warnings, ['warningtext'])
  assert.equal(Object.hasOwn(snapshot.slots.place.current, 'node'), false)
  assert.throws(() => { snapshot.slots.place.current.level = 0 }, TypeError)
  p.layers[0].gain = 0.1
  assert.equal(h.player.snapshot().slots.place.current.gain, 0.5)
  h.player.stop()
  assert.equal(h.nodes[0].src, '')
  assert.equal(snapshot.slots.place.current.url, '/a')
})

test('factory source evaluates without CommonJS globals and has no construction side effects', async () => {
  const source = await readFile(new URL('../tavern-plugin/src/client/fork-stage-soundscape-player.cjs', import.meta.url), 'utf8')
  assert.equal(vm.runInNewContext(source + ';typeof forkCreateSoundscapePlayer'), 'function')
  const original = { live: true }, browser = { window: {}, module: { exports: original } }
  vm.runInNewContext(source, browser)
  assert.equal(browser.module.exports, original, 'browser bundle must not overwrite host exports')
})
