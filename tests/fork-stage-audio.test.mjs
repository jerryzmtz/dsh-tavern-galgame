// private fork: ordinary pack sources are authoring inputs, not runtime defaults.
import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import path from 'node:path'
import fs from 'node:fs'
import { createHash } from 'node:crypto'
import { readFile, mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { createStageAudio, measureAudioFile, resolveAudioFfmpeg, validLoudness } from '../tavern-plugin/lib/fork-stage-audio.js'

import { createProfileDataStore } from '../tavern-plugin/lib/profile-data-store.js'
const math = await readFile(new URL('../tavern-plugin/src/client/fork-stage-audio-math.js', import.meta.url), 'utf8')
const mixer = await readFile(new URL('../tavern-plugin/src/client/fork-stage-audio.js', import.meta.url), 'utf8')
const api = vm.runInNewContext(math + '\n({gain:forkAudioGain,measure:forkMeasureLoudness,duck:forkAudioDuck,envelope:forkAudioEnvelope})')

test('layer targets, true peak headroom, invalid metadata and silence', () => {
  assert.ok(Math.abs(api.gain('music', { lufs: -10, peak: 0, v: 1 }) - 10 ** (-13 / 20)) < 1e-12)
  assert.equal(api.gain('voice', { lufs: -20, peak: -1, v: 1 }), 1)
  assert.ok(api.gain('music', { lufs: -30, peak: -12, v: 1 }) > 1)
  assert.equal(api.gain('sfx', { lufs: -100, peak: -100, v: 1 }), 0)
  assert.ok(api.gain('ambience', null) < 0.13)
  assert.equal(validLoudness({ lufs: NaN, peak: -1, v: 1 }), false)
  for (const layer of ['voice', 'music', 'sfx', 'ambience']) for (const peak of [-20, -1, 0, 2]) {
    const gain = api.gain(layer, { lufs: -30, peak, v: 1 })
    assert.ok(peak + 20 * Math.log10(gain) <= -1 + 1e-10)
  }
})
test('BS.1770 mono 1 kHz RMS -20 dBFS; stereo adds 3 LU; absolute/relative gate', () => {
  const rate = 48000, sine = Float32Array.from({ length: rate }, (_, i) => Math.SQRT2 * 0.1 * Math.sin(2 * Math.PI * 1000 * i / rate))
  const mono = api.measure([sine], rate), stereo = api.measure([sine, sine], rate)
  assert.ok(Math.abs(mono.lufs + 20) < 0.05, String(mono.lufs))
  assert.ok(Math.abs(stereo.lufs - mono.lufs - 3.0103) < 0.001)
  assert.equal(api.measure([new Float32Array(rate)], rate).lufs, -100)
  const withSilence = new Float32Array(rate * 5); withSilence.set(sine, rate * 2)
  assert.ok(Math.abs(api.measure([withSilence], rate).lufs - mono.lufs) < 1.6)
  assert.throws(() => api.measure([], rate))
})
test('ducking has 150ms attack, 400ms release, layer-specific depth and interruptible envelope', () => {
  const music = api.duck('music', true), ambience = api.duck('ambience', true)
  assert.ok(Math.abs(20 * Math.log10(music) + 4) < 1e-12)
  assert.ok(Math.abs(20 * Math.log10(ambience) + 3) < 1e-12)
  assert.equal(api.envelope(1, music, 0.15, true), music)
  const halfway = api.envelope(1, music, 0.075, true)
  assert.equal(halfway, (1 + music) / 2)
  assert.equal(api.envelope(halfway, 1, 0.4, false), 1)
  assert.equal(api.duck('sfx', true), 1)
})
test('preferences migrate compensating old levels exactly once, defaults all .8, preserve later choices', () => {
  const values = new Map([['fork-stage-music', '{"volume":0.15}'], ['fork-stage-sfx', '{"volume":0.35}']])
  const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) }
  const prefs = vm.runInNewContext(mixer.slice(0, mixer.indexOf('const forkStageAudio =')) + ';forkAudioPreferences', {})
  const first = prefs(storage)
  for (const key of ['master', 'voice', 'music', 'sfx', 'ambience']) assert.equal(first[key], 0.8)
  assert.equal(JSON.parse(values.get('fork-stage-music')).volume, 0.8)
  storage.setItem('fork-stage-audio', JSON.stringify({ ...first, music: 0.33 }))
  assert.equal(prefs(storage).music, 0.33)
})
test('content SHA cache deduplicates, limits parallel work, validates paths, never changes asset bytes', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'stage-audio-')); t.after(() => rm(root, { recursive: true, force: true }))
  const store = createProfileDataStore({ dataRoot: root }), folder = path.join(root, 'card-assets/a/music')
  await mkdir(folder, { recursive: true }); await writeFile(path.join(folder, 'a.wav'), 'not decoded by the fake meter')
  // private fork: authorization belongs to the media owner; no old raw path reader.
  const urlsToFiles = new Map(), url = '/api/dsh-asset-library/v1/media?ticket=a'; let count = 0
  urlsToFiles.set(url, path.join(folder, 'a.wav'))
  const readMedia = async url => { if (!urlsToFiles.has(url)) throw new Error('revoked'); return new Response(await readFile(urlsToFiles.get(url)), {headers:{'content-type':'audio/wav'}}) }
  const service = createStageAudio({ dataRoot: root, store, readMedia, measure: async () => { count++; await new Promise(resolve => setTimeout(resolve, 5)); return { lufs: -19, peak: -3, v: 1 } } })
  const answers = await Promise.all([service.inspect({ url }), service.inspect({ url })])
  assert.equal(count, 1); assert.deepEqual(answers[0], answers[1])
  const decorated = await service.decorate({ tracks: [{ url }] }); assert.equal(decorated.tracks[0].loudness.lufs, -19)
  assert.equal((await service.inspect({ url })).loudness.lufs, -19); assert.equal(count, 1)
  assert.equal(await readFile(path.join(folder, 'a.wav'), 'utf8'), 'not decoded by the fake meter')
  await assert.rejects(service.inspect({ url: '/api/dsh-tavern/card-assets/a/music/../../secret.wav' }))
  await assert.rejects(service.inspect({ url: 'https://example.org/a.wav' }))
  const fallback = createStageAudio({ dataRoot: root, store, readMedia, measure: async () => null })
  await writeFile(path.join(folder, 'b.wav'), 'second'); const b = url + '-b'; urlsToFiles.set(b, path.join(folder, 'b.wav'))
  const missing = await fallback.inspect({ url: b }); assert.equal(missing.loudness, null)
  await assert.rejects(fallback.inspect({ url: b, sha: missing.sha, loudness: { lufs: 99, peak: 0, v: 1 } }))
  await assert.rejects(fallback.inspect({ url: b, sha: 'old-content', loudness: { lufs: -22, peak: -3, v: 1 } }))
  assert.equal((await fallback.inspect({ url: b, sha: missing.sha, loudness: { lufs: -22, peak: -3, v: 1 } })).loudness.lufs, -22)
  let active = 0, maximum = 0
  const bounded = createStageAudio({ dataRoot: root, store, readMedia, measure: async () => {
    active++; maximum = Math.max(maximum, active)
    await new Promise(resolve => setTimeout(resolve, 10)); active--
    return { lufs: -20, peak: -2, v: 1 }
  } })
  const urls = []
  for (let i = 0; i < 5; i++) { await writeFile(path.join(folder, 'parallel-' + i + '.wav'), 'distinct-' + i); urls.push(url + '-' + i); urlsToFiles.set(url + '-' + i, path.join(folder, 'parallel-' + i + '.wav')) }
  await Promise.all(urls.map(url => bounded.inspect({ url })))
  assert.equal(maximum, 2)
})
test('opaque media listings verify bytes before reusing loudness; inspection rejects replaced content', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'stage-audio-address-')); t.after(() => rm(root, { recursive: true, force: true }))
  const store = createProfileDataStore({ dataRoot: root }), folder = path.join(root, 'card-assets/a/music')
  const bytes = Buffer.from('addressed audio'), sha = createHash('sha256').update(bytes).digest('hex')
  const loudness = { lufs: -19, peak: -3, v: 1 }, file = path.join(folder, sha + '.ogg')
  await mkdir(folder, { recursive: true }); await writeFile(file, bytes)
  await store.writeJson('cache/stage-audio/' + sha + '.json', loudness)
  // private fork: never infer an asset hash from an opaque lease URL.
  let reads = 0, measures = 0
  const readMedia = async () => { reads++; return new Response(await readFile(file), {headers:{'content-type':'audio/ogg'}}) }
  const service = createStageAudio({ dataRoot: root, store, readMedia, measure: async () => { measures++; return null } })
  const url = '/api/dsh-asset-library/v1/media?ticket=addressed'
  const result = await service.decorate({ tracks: [{ url }] })
  assert.deepEqual(result.tracks[0], { url, audioSha: sha, loudness })
  assert.equal(reads, 1); assert.equal(measures, 0)
  // A manually overwritten addressed file must not poison the verified identity/write path.
  await writeFile(file, 'externally replaced audio')
  await assert.rejects(service.inspect({ url, sha, loudness }), /Audio changed during analysis/)
  assert.equal(reads, 2)
  assert.deepEqual(await store.readJson('cache/stage-audio/' + sha + '.json'), loudness)
  const inspected = await service.inspect({ url })
  assert.notEqual(inspected.sha, sha)
  assert.equal((await service.decorate({ tracks: [{ url }] })).tracks[0].audioSha, inspected.sha)
})
test('opaque media cache misses and invalid entries hash bytes; unauthorized leases stay undecorated', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'stage-audio-miss-')); t.after(() => rm(root, { recursive: true, force: true }))
  const store = createProfileDataStore({ dataRoot: root }), folder = path.join(root, 'card-assets/a/music')
  await mkdir(folder, { recursive: true })
  const bytes = Buffer.from('actual content'), sha = createHash('sha256').update(bytes).digest('hex')
  const loudness = { lufs: -21, peak: -4, v: 1 }
  await store.writeJson('cache/stage-audio/' + sha + '.json', loudness)
  await store.writeJson('cache/stage-audio/' + 'b'.repeat(64) + '.json', { lufs: 99, peak: 0, v: 1 })
  const names = ['a'.repeat(64) + '.ogg', 'b'.repeat(64) + '.ogg', 'legacy.wav']
  for (const name of names) await writeFile(path.join(folder, name), bytes)
  // private fork: only explicitly issued test leases can resolve bytes.
  const base = '/api/dsh-asset-library/v1/media?ticket='
  const allowed = new Map(names.map((name, i) => [base + i, path.join(folder, name)]))
  const readMedia = async url => { if (!allowed.has(url)) throw new Error('revoked'); return new Response(await readFile(allowed.get(url)), {headers:{'content-type':'audio/ogg'}}) }
  const service = createStageAudio({ dataRoot: root, store, readMedia, measure: async () => { throw new Error('unexpected measurement') } })
  const result = await service.decorate({ sounds: names.map((_, i) => ({ url: base + i })) })
  for (const item of result.sounds) { assert.equal(item.audioSha, sha); assert.deepEqual(item.loudness, loudness) }
  for (const url of [base + sha + '.ogg', base + '../../' + sha + '.ogg', 'https://example.org/' + sha + '.ogg']) {
    assert.deepEqual((await service.decorate({ tracks: [{ url }] })).tracks[0], { url })
  }
})

test('JS loudness agrees with ffmpeg EBU R128 on three built-in assets within 0.5 LU', { timeout: 180000 }, async t => {
  if (!(await import('node:fs')).existsSync(new URL('../assets/packs/general-sfx/sfx/door-open.ogg', import.meta.url))) return t.skip('Private authored audio assets are not distributed')
  const ffmpeg = await resolveAudioFfmpeg(); if (!ffmpeg) return t.skip('ffmpeg unavailable')
  const base = new URL('../assets/packs/', import.meta.url) // private fork: split authored audio packs
  for (const relative of ['general-sfx/sfx/door-open.ogg', 'jp-general/sfx/amb-rain.ogg', 'jp-general/sfx/amb-rain-window.ogg']) {
    const file = (await import('node:url')).fileURLToPath(new URL(relative, base))
    const count = relative === 'general-sfx/sfx/door-open.ogg' ? 1 : 2
    const raw = execFileSync(ffmpeg, ['-v', 'error', '-i', file, '-ar', '48000', '-ac', String(count), '-f', 'f32le', '-'], { maxBuffer: 100 * 1024 * 1024, windowsHide: true })
    const samples = new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4), channels = Array.from({ length: count }, () => new Float32Array(samples.length / count))
    for (let i = 0; i < samples.length; i++) channels[i % count][Math.floor(i / count)] = samples[i]
    const js = api.measure(channels, 48000), ff = await measureAudioFile(file)
    t.diagnostic(relative + ': JS ' + js.lufs.toFixed(3) + ', ffmpeg ' + ff.lufs + ', delta ' + (js.lufs - ff.lufs).toFixed(3) + ' LU; JS peak ' + js.peak.toFixed(3) + ', ffmpeg peak ' + ff.peak)
    assert.ok(Math.abs(js.lufs - ff.lufs) <= 0.5)
    assert.ok(js.peak >= ff.peak - 0.05 && js.peak - ff.peak < 0.5, 'conservative true peak estimate')
  }
})

function mixerHarness() {
  const params = [], sources = new WeakSet(); let context;
  const param = () => { const value = { value: 1, calls: [], cancelScheduledValues(t) { this.calls.push(['cancel', t]) }, setTargetAtTime(v, t, c) { this.value = v; this.calls.push(['target', v, t, c]) }, setValueAtTime(v, t) { this.value = v; this.calls.push(['set', v, t]) }, linearRampToValueAtTime(v, t) { this.calls.push(['ramp', v, t]) } }; params.push(value); return value }
  const graph = () => ({ gain: param(), links: [], connect(to) { this.links.push(to) }, disconnect() { this.links = [] } })
  class Context {
    constructor() { context = this; this.currentTime = 0; this.state = 'running'; this.destination = {} }
    createGain() { return graph() }
    createMediaElementSource(node) { assert.equal(sources.has(node), false, 'one source per element'); sources.add(node); return graph() }
    createAnalyser() { return { ...graph(), fftSize: 1024, getFloatTimeDomainData() {} } }
    resume() { return Promise.resolve() }
  }
  const storage = new Map(), ctx = { window: { AudioContext: Context, addEventListener() {} }, localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) }, rpc: async () => { throw new Error('not expected') } }
  const mixerApi = vm.runInNewContext(math + mixer + ';forkStageAudio', ctx)
  const node = () => ({ volume: 1, events: {}, addEventListener(name, fn) { this.events[name] = fn } })
  return { api: mixerApi, params, node, context: () => context, sandbox: ctx }
}
test('mixer shares sources with lip sync, keeps envelopes separate from gain, switches preview layers and controls master', () => {
  const h = mixerHarness(), node = h.node()
  h.api.register([{ url: '/a', loudness: { lufs: -30, peak: -12, v: 1 } }])
  const record = h.api.bind(node, 'music', '/a')
  assert.ok(record.gain.gain.value > 1); h.api.level(node, 0.25)
  assert.equal(node.volume, 0.25); assert.equal(h.api.level(node), 0.25)
  assert.equal(h.api.bind(node, 'music', '/a'), record)
  assert.equal(h.api.analyser(node), h.api.analyser(node))
  assert.equal(record.source.links.length, 1)
  assert.equal(record.source.links[0], record.analyser)
  const originalBus = record.gain.links[0]
  h.api.bind(node, 'ambience', '/a')
  assert.notEqual(record.gain.links[0], originalBus)
  h.api.setVolume('master', 0); assert.equal(h.params[0].value, 0)
  h.api.setVolume('sfx', 0.2); assert.equal(h.api.get().ambience, 0.8)
  h.api.toggleMute('ambience'); assert.equal(h.api.get().muted.ambience, true)
})
// private fork: authored balance belongs to a cue, not the shared media URL cache.
test('SFX mixer keeps authored gains independent for shared media and retains performance attenuation', () => {
  const h=mixerHarness(), loudness={v:1,lufs:-20,peak:-12}
  const a=h.node(), b=h.node()
  const boosted=h.api.bind(a,'sfx','/same',{gainDb:6,loudness})
  const plain=h.api.bind(b,'sfx','/same',{gainDb:0,loudness})
  assert.ok(Math.abs(20*Math.log10(boosted.gain.gain.value)-6)<1e-10)
  assert.equal(plain.gain.gain.value,1)
  h.api.level(a,10**(-3/20))
  assert.ok(Math.abs(20*Math.log10(a.volume*boosted.gain.gain.value)-3)<1e-10)
  h.api.setVolume('sfx',0.4)
  assert.equal(plain.gain.gain.value,1)
  assert.ok(Math.abs(20*Math.log10(boosted.gain.gain.value)-6)<1e-10)
})
// private fork (audio editor): an entry's authored 音量 is a per-entry gain on every layer; a reused element takes the
// volume of its new track and trim() retunes a playing one.
test('entry volume multiplies the normalized gain for BGM, SFX and ambience', () => {
  const h=mixerHarness(), loudness={v:1,lufs:-20,peak:-12}
  const sfx=h.api.bind(h.node(),'sfx','/s',{gainDb:0,loudness,volume:0.5})
  assert.equal(sfx.gain.gain.value,0.5)
  h.api.register([{url:'/m',loudness:{v:1,lufs:-23,peak:-12}},{url:'/n',loudness:{v:1,lufs:-23,peak:-12}},{url:'/a',loudness:{v:1,lufs:-28,peak:-12}}])
  const node=h.node(), music=h.api.bind(node,'music','/m',{volume:0.25})
  assert.equal(music.gain.gain.value,0.25)
  h.api.bind(node,'music','/n',{volume:0.75}); assert.equal(music.gain.gain.value,0.75)
  h.api.bind(node,'music','/n'); assert.equal(music.gain.gain.value,1,'no authored volume is full level')
  const ambience=h.api.bind(h.node(),'ambience','/a',{volume:0.4}); assert.ok(Math.abs(ambience.gain.gain.value-0.4)<1e-12)
  h.api.trim(ambience.node,0.9); assert.ok(Math.abs(ambience.gain.gain.value-0.9)<1e-12)
})
test('one-shot completion, failure and cancellation release the mixer graph and listeners', async () => {
  const h=mixerHarness(), records=[], elements=[]
  const bind=h.api.bind
  h.api.bind=(...args)=>{const record=bind(...args);records.push(record);return record}
  class Audio extends EventTarget {
    constructor(url) {super();this.src=url;this.volume=1;this.paused=true;this.handlers=new Set();elements.push(this)}
    addEventListener(type,fn,options) {super.addEventListener(type,fn,options);this.handlers.add(fn)}
    removeEventListener(type,fn) {super.removeEventListener(type,fn);this.handlers.delete(fn)}
    play() {this.paused=false;this.dispatchEvent(new Event('play'));return this.src==='/rejected' ? Promise.reject(new Error('blocked')) : Promise.resolve()}
    pause() {this.paused=true;this.dispatchEvent(new Event('pause'))}
    removeAttribute() {this.src=''}
  }
  h.sandbox.Audio=Audio
  const player=vm.runInNewContext(await readFile(new URL('../tavern-plugin/src/client/fork-stage-sfx.js',import.meta.url),'utf8')+';forkStageSfx',h.sandbox)
  for(const reason of ['ended','error','stop','token','rejected']) {
    const completion=player.play('/'+reason,'identity',null,reason)
    const element=elements.at(-1), record=records.at(-1)
    assert.equal(record.source.links.length,1)
    if(reason==='stop') player.stop()
    else if(reason==='token') player.stopToken(reason)
    else if(reason!=='rejected') element.dispatchEvent(new Event(reason))
    await completion
    assert.equal(record.released,true,reason)
    assert.equal(record.source.links.length,0,reason)
    assert.equal(record.gain.links.length,0,reason)
    assert.equal(element.handlers.size,0,reason)
  }
})

test('real mixer automation attacks/releases without jumps on interrupted voice lines', () => {
  const h = mixerHarness(); h.api.bind(h.node(), 'music', '/a'); h.api.voice(true)
  // private fork: one foreground fade gain follows the master bus.
  const musicDuck = h.params[5], ambienceDuck = h.params[9]
  assert.deepEqual(musicDuck.calls.at(-1), ['ramp', api.duck('music', true), 0.15])
  assert.deepEqual(ambienceDuck.calls.at(-1), ['ramp', api.duck('ambience', true), 0.15])
  h.context().currentTime = 0.075; h.api.voice(false)
  assert.deepEqual(musicDuck.calls.at(-2), ['set', (1 + api.duck('music', true)) / 2, 0.075])
  assert.deepEqual(musicDuck.calls.at(-1), ['ramp', 1, 0.47500000000000003])
})
test('ffmpeg short effects are padded to a complete 400 ms measurement block', async t => {
  if (!(await import('node:fs')).existsSync(new URL('../assets/packs/general-sfx/sfx/message-notification.ogg', import.meta.url))) return t.skip('Private authored audio is not distributed; synthetic measurements remain tested')
  if (!await resolveAudioFfmpeg()) return t.skip('ffmpeg unavailable')
  const value = await measureAudioFile(new URL('../assets/packs/general-sfx/sfx/message-notification.ogg', import.meta.url).pathname.replace(/^\/(\w:)/, '$1'))
  assert.ok(value && value.lufs > -30, JSON.stringify(value))
})

test('browser fallback returns the content identity to host, updates playback and retains measurements across listings', async () => {
  const reports = [], nodes = [], storage = new Map(); let workers = 0
  const gain = () => ({ gain: { value: 1, cancelScheduledValues() {}, setTargetAtTime(value) { this.value = value } }, connect() {}, disconnect() {} })
  class Context {
    constructor() { this.state = 'running'; this.currentTime = 0; this.destination = {} }
    createGain() { const value = gain(); nodes.push(value); return value }
    createMediaElementSource() { return gain() }
    async decodeAudioData() { return { duration: 1, numberOfChannels: 1, sampleRate: 48000, getChannelData: () => new Float32Array(48000) } }
  }
  class Worker {
    constructor() { workers++ }
    postMessage() { queueMicrotask(() => this.onmessage({ data: { value: { lufs: -16, peak: -4, v: 1 } } })) }
    terminate() {}
  }
  const ctx = { window: { AudioContext: Context, addEventListener() {} }, Worker, Blob, URL, setTimeout, clearTimeout, queueMicrotask,
    localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    fetch: async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(16) }),
    rpc: async (method, args) => { reports.push({ method, args }); return { sha: 'abc', loudness: args.loudness || null } } }
  const audio = vm.runInNewContext(math + mixer + ';forkStageAudio', ctx)
  audio.register([{ url: '/asset' }])
  const record = audio.bind({ volume: 1, addEventListener() {} }, 'music', '/asset')
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(workers, 1); assert.equal(reports.length, 2)
  assert.equal(reports[1].args.sha, 'abc'); assert.equal(reports[1].args.loudness.lufs, -16)
  assert.ok(Math.abs(record.gain.gain.value - 10 ** (-7 / 20)) < 1e-10)
  audio.register([{ url: '/asset' }])
  assert.ok(Math.abs(record.gain.gain.value - 10 ** (-7 / 20)) < 1e-10)
  assert.equal(reports.length, 2)
  const voice = { volume: 1, addEventListener() {} }
  audio.prepareVoice(voice, new Blob([new Uint8Array(100)]))
  const voiceRecord = audio.bind(voice, 'voice', 'blob:voice')
  assert.equal(voiceRecord.gain.gain.value, 1, 'no speculative voice boost')
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.ok(Math.abs(voiceRecord.gain.gain.value - 10 ** (3 / 20)) < 1e-10, 'nominal voice level uses measured true-peak headroom')
})

test('music and ambience crossfades survive rapid replacements, mute changes and stop without orphan audio', async () => {
  const h = mixerHarness(), elements = [], frames = new Map(); let now = 0, ticket = 0
  class Audio {
    constructor(src = '') { this.src = src; this.volume = 1; this.paused = true; this.events = {}; elements.push(this) }
    addEventListener(name, fn) { (this.events[name] ||= []).push(fn) }
    removeEventListener(name, fn) { this.events[name] = (this.events[name] || []).filter(listener => listener !== fn) }
    load() {}
    fire(name) { for (const fn of this.events[name] || []) fn() }
    play() { this.paused = false; this.fire('play'); return Promise.resolve() }
    pause() { if (!this.paused) { this.paused = true; this.fire('pause') } }
    removeAttribute(name) { if (name === 'src') this.src = '' }
  }
  // private fork: deterministic audio timers run independently of visual RAF.
  Object.assign(h.sandbox, { Audio, performance: { now: () => now }, setTimeout: fn => { frames.set(++ticket, fn); return ticket }, clearTimeout: id => frames.delete(id), requestAnimationFrame: fn => { frames.set(++ticket, fn); return ticket }, cancelAnimationFrame: id => frames.delete(id) })
  // private fork: isolate crossfade logic with an always-foreground presentation clock.
  h.sandbox.forkForeground = { now: () => now, setTimeout: h.sandbox.setTimeout, clearTimeout: h.sandbox.clearTimeout, media: node => node, context() {} }
  function advance(ms) { now += ms; const callbacks = [...frames.values()]; frames.clear(); for (const fn of callbacks) fn(now) }
  const music = await readFile(new URL('../tavern-plugin/src/client/fork-stage-music.js', import.meta.url), 'utf8')
  const sfx = await readFile(new URL('../tavern-plugin/src/client/fork-stage-sfx.js', import.meta.url), 'utf8')
  const players = vm.runInNewContext(music + sfx + ';({music:forkStageMusic,sfx:forkStageSfx})', h.sandbox)
  players.music.play('/a',false,'a'); advance(600)
  assert.equal(elements.find(node => node.src === '/a').volume, 0.5)
  players.music.play('/b',false,'b'); advance(600)
  assert.equal(elements.find(node => node.src === '/b').volume, 0.5)
  players.music.play('/c',false,'c'); advance(1200)
  assert.equal(elements.filter(node => !node.paused).length, 1)
  assert.equal(elements.find(node => node.src === '/c').volume, 1)
  // private fork: pinned content ignores ticket URLs even when the media node reports an error.
  const count = elements.length
  players.music.play('/c?renewed',false,'c');assert.equal(elements.length,count)
  elements.find(node => node.src === '/c').error = {code:2}
  players.music.play('/c?fresh',false,'c');advance(1200)
  assert.equal(elements.filter(node => !node.paused).length,1)
  assert.equal(elements.find(node => node.src === '/c').paused,false)
  assert.equal(elements.some(node => node.src === '/c?fresh'),false)
  players.music.toggleMute(); assert.equal(players.music.get().muted, true)
  players.music.setVolume(0.3); assert.equal(players.music.get().muted, false)
  const soundscapeSource = await readFile(new URL('../tavern-plugin/src/client/fork-stage-soundscape-player.cjs', import.meta.url), 'utf8')
  const createSoundscape = vm.runInNewContext(soundscapeSource + ';forkCreateSoundscapePlayer', { ...h.sandbox, URL })
  const ambience = createSoundscape({ Audio, mixer: h.api, now: () => now, requestFrame: h.sandbox.requestAnimationFrame, cancelFrame: h.sandbox.cancelAnimationFrame })
  const plan = id => ({ version: 1, layers: id ? [{ slot: 'weather', id, identity:id, url: '/' + id, gain: 1 }] : [] })
  ambience.apply(plan('rain')); advance(750); ambience.apply(plan('wind')); advance(200)
  ambience.apply(plan('')); advance(1200)
  assert.equal(elements.filter(node => !node.paused).length, 1, 'only music remains')
  ambience.apply(plan('rain')); advance(1500)
  players.sfx.play('/shot'); players.sfx.setVolume(0.2)
  assert.equal(h.api.get().ambience, 0.8, 'SFX slider does not change ambience')
  players.music.stop(); players.sfx.stop(); ambience.dispose(); advance(5000)
  assert.equal(elements.filter(node => !node.paused).length, 0)
})

test('native media audio analysis uses revoked leases, bounded streams and disposable local analysis files', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'native-audio-'))
  t.after(() => rm(root, {recursive:true, force:true}))
  const bytes = Buffer.from('ID3' + 'native'.repeat(20)), store = createProfileDataStore({dataRoot:root})
  let enabled = true, measured = 0, temporary
  const audio = createStageAudio({dataRoot:root, store,
    readMedia:async () => { if (!enabled) throw new Error('revoked'); return new Response(bytes, {headers:{'content-type':'audio/mpeg'}}) },
    measure:async file => { temporary = file; measured++; assert.deepEqual(await readFile(file), bytes); return {lufs:-20, peak:-2, v:1} }
  })
  const result = await audio.inspect({url:'/api/dsh-asset-library/v1/media?ticket=lease'})
  assert.equal(result.sha, createHash('sha256').update(bytes).digest('hex'))
  assert.equal(result.loudness.lufs, -20)
  assert.equal(fs.existsSync(temporary), false)
  await audio.inspect({url:'/api/dsh-asset-library/v1/media?ticket=lease'})
  assert.equal(measured, 1)
  enabled = false
  await assert.rejects(audio.inspect({url:'/api/dsh-asset-library/v1/media?ticket=lease'}), /revoked/)
})
