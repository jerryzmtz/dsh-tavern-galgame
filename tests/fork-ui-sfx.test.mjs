// private fork (docs/fork/panel-ui-design.md「界面音效」): the stage's galgame UI cues (fork-ui-sfx.js) — cue mapping
// for delegated controls, rate limiting, the 界面音效 × 总音量 gain and mutes, playback through a fake Web Audio, the
// mixer layer, and the shipped project-owned candidate E files with their credits.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, stat } from 'node:fs/promises'
import vm from 'node:vm'
import { TAVERN_CLIENT_ASSET_PREFIX, TAVERN_UI_SFX_CUES, readTavernClientAsset } from '../tavern-plugin/lib/domain/tavern-client-assets.js'

const read = path => readFile(new URL('../tavern-plugin/' + path, import.meta.url), 'utf8')
const source = await read('src/client/fork-ui-sfx.js')
const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-9, message || actual + ' ≈ ' + expected)

function load(extra = {}) {
  const ctx = vm.createContext({ setTimeout, ...extra })
  vm.runInContext(source.slice(0, source.indexOf('const forkUiSfx =')) +
    ';this.api={FORK_UI_SFX_CUES,forkUiSfxGain,forkUiSfxAllow,forkUiSfxControlCue,forkUiSfxChangeCue,forkCreateUiSfx};', ctx)
  return ctx.api
}
const api = load()

// A minimal element: attributes, tag, and closest() over itself and its ancestors.
function el(tag, attrs = {}, parent = null, props = {}) {
  const node = { tagName: tag.toUpperCase(), parent, ...props,
    getAttribute: name => Object.hasOwn(attrs, name) ? String(attrs[name]) : null,
    hasAttribute: name => Object.hasOwn(attrs, name),
    closest(selector) {
      const tests = selector.split(',').map(part => part.trim())
      for (let at = node; at; at = at.parent) {
        if (tests.some(test => {
          const m = /^([a-z]*)(?:\[([a-z-]+)(?:=([a-z]+))?\])?(?::not.*)?$/.exec(test)
          if (!m) return false
          if (m[1] && at.tagName !== m[1].toUpperCase()) return false
          if (m[2] && (at.getAttribute(m[2]) === null || m[3] && at.getAttribute(m[2]) !== m[3])) return false
          return Boolean(m[1] || m[2])
        })) return at
      }
      return null
    } }
  return node
}

test('cue set matches the shipped files', () => {
  // private fork: the removed page cue must not return through either mapping.
  assert.deepEqual(Object.keys(api.FORK_UI_SFX_CUES), ['open', 'close', 'move', 'confirm', 'cancel', 'toggle', 'choice'])
  assert.deepEqual(Object.keys(api.FORK_UI_SFX_CUES), [...TAVERN_UI_SFX_CUES])
  assert.match(source, /const FORK_UI_SFX_BASE = "\/api\/dsh-tavern\/client-assets\/ui-sfx\/"/)
  assert.ok(TAVERN_CLIENT_ASSET_PREFIX + 'ui-sfx/' === '/api/dsh-tavern/client-assets/ui-sfx/')
})

test('control cues: tabs confirm, radios / switches / pressed toggles toggle, explicit data-ui-sfx wins, the rest are silent', () => {
  const cue = api.forkUiSfxControlCue
  assert.equal(cue(el('button', { role: 'tab', 'aria-selected': 'false' })), 'confirm')
  assert.equal(cue(el('button', { role: 'tab', 'aria-selected': 'true' })), null, 'the open tab again is silent')
  assert.equal(cue(el('button', { role: 'radio', 'aria-checked': 'false' })), 'toggle')
  assert.equal(cue(el('button', { role: 'radio', 'aria-checked': 'true' })), null, 'the chosen option again is silent')
  assert.equal(cue(el('button', { role: 'switch', 'aria-checked': 'true' })), 'toggle', 'a switch always toggles')
  assert.equal(cue(el('button', { 'aria-pressed': 'false' })), 'toggle', 'mute buttons')
  assert.equal(cue(el('button', { 'data-ui-sfx': 'cancel' })), 'cancel')
  assert.equal(cue(el('button', { 'data-ui-sfx': '' })), null)
  assert.equal(cue(el('button', { 'data-ui-sfx': 'boom' })), null, 'unknown names are ignored')
  assert.equal(cue(el('button')), null, 'plain buttons (▶ previews, transport) stay silent')
  assert.equal(cue(el('button', { role: 'tab', 'aria-selected': 'false' }, null, { disabled: true })), null)
  assert.equal(cue(el('button', { 'aria-pressed': 'true', 'aria-disabled': 'true' })), null)
  assert.equal(cue(el('span', {}, el('button', { role: 'radio', 'aria-checked': 'false' }))), 'toggle', 'a click on a child of the control')
  assert.equal(cue(el('input', { type: 'radio' })), null, 'native inputs are left to change')
  assert.equal(cue(null), null)
  const change = api.forkUiSfxChangeCue
  assert.equal(change(el('input', {}, null, { type: 'range' })), 'toggle', 'slider release')
  assert.equal(change(el('input', {}, null, { type: 'checkbox' })), 'toggle')
  assert.equal(change(el('input', {}, null, { type: 'radio' })), 'toggle')
  assert.equal(change(el('input', {}, null, { type: 'search' })), null)
  assert.equal(change(el('textarea')), null)
  assert.equal(change(el('input', {}, null, { type: 'range', disabled: true })), null)
  // private fork (UI standard phase 2 batch 4): the shared ForkSlider track (role=slider) fires change on release.
  assert.equal(change(el('div', { role: 'slider' })), 'toggle', 'shared slider release')
  assert.equal(change(el('div', { role: 'slider', 'aria-disabled': 'true' })), null)
})

test('rate limit: a cue inside its own interval drops, the first cue of a gesture wins, hover never stacks on a click', () => {
  const gate = { at: {} }
  const allow = (cue, t) => api.forkUiSfxAllow(gate, cue, t)
  assert.equal(allow('move', 0), true)
  assert.equal(allow('move', 40), false, 'hover throttled')
  assert.equal(allow('move', 80), true)
  assert.equal(allow('confirm', 90), true, 'a click right after a hover still sounds')
  assert.equal(allow('open', 100), false, 'menu 「设置」: confirm wins over CONFIG opening in the same gesture')
  assert.equal(allow('move', 200), false, 'a hover just after a click is dropped')
  assert.equal(allow('move', 250), true)
  assert.equal(allow('toggle', 300), true)
  assert.equal(allow('toggle', 330), false)
  assert.equal(allow('toggle', 370), true)
  assert.equal(allow('choice', 1000), true)
  assert.equal(allow('choice', 1300), false, 'choices appearing chime at most once in 600 ms')
  assert.equal(allow('nope', 5000), false)
})

test('gain: 界面音效 × 总音量 × the cue level; silent when either is muted or zero', () => {
  const gain = (prefs, cue = 'confirm') => api.forkUiSfxGain({ muted: {}, ...prefs }, cue)
  near(gain({ master: 0.8, ui: 0.5 }), 0.1)
  near(gain({ master: 0.8, ui: 0.5 }, 'move'), 0.1 * api.FORK_UI_SFX_CUES.move[0])
  assert.equal(gain({ master: 0, ui: 0.5 }), 0)
  assert.equal(gain({ master: 0.8, ui: 0 }), 0)
  assert.equal(gain({ master: 0.8, ui: 0.5, muted: { master: true } }), 0)
  assert.equal(gain({ master: 0.8, ui: 0.5, muted: { ui: true } }), 0)
  near(gain({ master: 0.8, ui: 0.5, muted: { sfx: true, music: true } }), 0.1, 'other layers do not matter')
  assert.equal(gain({ master: 3, ui: 2 }), 0.25, 'clamped')
  assert.equal(gain({ master: 0.8, ui: 0.5 }, 'nope'), 0)
  assert.equal(api.forkUiSfxGain(null, 'open'), 0)
})

function fakeAudio() {
  const log = { contexts: 0, resumed: 0, started: [], fetched: [] }
  class Buffer { constructor(name) { this.name = name } }
  class Offline { decodeAudioData(bytes) { return Promise.resolve(new Buffer(bytes.name)) } }
  class Context {
    constructor() { log.contexts++; this.state = 'suspended'; this.destination = {} }
    resume() { log.resumed++; this.state = 'running'; return Promise.resolve() }
    createGain() { return { gain: { value: 1 }, connect() {}, disconnect() {} } }
    createBufferSource() {
      const source = { connect() {}, disconnect() {}, start() { log.started.push({ cue: source.buffer.name, gain: source.level }) } }
      return source
    }
  }
  // Record the gain the source is routed through.
  const proto = Context.prototype, create = proto.createBufferSource
  proto.createBufferSource = function () {
    const source = create.call(this)
    source.connect = node => { source.level = node.gain.value }
    return source
  }
  const fetch = async url => { log.fetched.push(url); return { ok: !url.includes('missing'), arrayBuffer: async () => ({ name: url.split('/').pop().replace('.ogg', '') }) } }
  return { log, Context, Offline, fetch }
}

test('player: preloads every cue once, plays decoded buffers at the mixer gain, stays silent when muted', async () => {
  const audio = fakeAudio()
  let prefs = { master: 0.8, ui: 0.5, muted: {} }, clock = 0
  const sfx = api.forkCreateUiSfx({ AudioContext: audio.Context, OfflineAudioContext: audio.Offline, fetch: audio.fetch, prefs: () => prefs, now: () => clock })
  await sfx.preload(); await sfx.preload()
  assert.deepEqual(audio.log.fetched, TAVERN_UI_SFX_CUES.map(cue => '/api/dsh-tavern/client-assets/ui-sfx/' + cue + '.ogg'), 'fetched once each')
  assert.equal(audio.log.contexts, 0, 'no AudioContext before the first cue (always a gesture)')
  assert.equal(sfx.play('open'), true)
  assert.equal(audio.log.contexts, 1); assert.equal(audio.log.resumed, 1)
  assert.deepEqual(audio.log.started.map(item => item.cue), ['open']); near(audio.log.started[0].gain, 0.1 * 0.9)
  clock = 1000; prefs = { ...prefs, muted: { ui: true } }
  assert.equal(sfx.play('confirm'), false)
  prefs = { master: 0, ui: 0.5, muted: {} }
  assert.equal(sfx.play('confirm'), false, 'master volume 0 mutes the UI cues too')
  prefs = { master: 1, ui: 1, muted: {} }
  assert.equal(sfx.play('confirm'), true, 'a muted attempt does not consume the rate limit')
  assert.equal(audio.log.started.at(-1).gain, 0.25)
  assert.equal(audio.log.contexts, 1, 'one context for the page')
})

test('player: a cue before the files arrive plays once they decode (within 250 ms), never later', async () => {
  const audio = fakeAudio()
  let clock = 0
  const sfx = api.forkCreateUiSfx({ AudioContext: audio.Context, OfflineAudioContext: audio.Offline, fetch: audio.fetch, prefs: () => ({ master: 1, ui: 1, muted: {} }), now: () => clock })
  assert.equal(sfx.play('open'), true)
  await sfx.preload()
  assert.deepEqual(audio.log.started.map(item => item.cue), ['open'])
  const late = api.forkCreateUiSfx({ AudioContext: audio.Context, OfflineAudioContext: audio.Offline, fetch: async url => { clock += 400; return audio.fetch(url) }, prefs: () => ({ master: 1, ui: 1, muted: {} }), now: () => clock })
  late.play('close'); await late.preload()
  assert.deepEqual(audio.log.started.map(item => item.cue), ['open'], 'a stale cue is dropped')
  const none = api.forkCreateUiSfx({ prefs: () => ({ master: 1, ui: 1, muted: {} }), now: () => 0 })
  assert.equal(none.play('open'), false, 'no Web Audio: silently nothing')
  await none.preload()
})

test('delegation: bind listens for click and change in capture and plays after the control handled the event', async () => {
  const audio = fakeAudio()
  let clock = 0
  const sfx = api.forkCreateUiSfx({ AudioContext: audio.Context, OfflineAudioContext: audio.Offline, fetch: audio.fetch, prefs: () => ({ master: 1, ui: 1, muted: {} }), now: () => clock })
  await sfx.preload()
  const handlers = {}
  const node = { addEventListener: (type, fn, capture) => { assert.equal(capture, true); handlers[type] = fn }, removeEventListener: (type) => { delete handlers[type] } }
  const off = sfx.bind(node)
  handlers.click({ target: el('button', { role: 'tab', 'aria-selected': 'false' }) })
  assert.equal(audio.log.started.length, 0, 'deferred')
  await new Promise(resolve => setTimeout(resolve, 5))
  clock = 500
  handlers.change({ target: el('input', {}, null, { type: 'range' }) })
  await new Promise(resolve => setTimeout(resolve, 5))
  assert.deepEqual(audio.log.started.map(item => item.cue), ['confirm', 'toggle'])
  off()
  assert.deepEqual(Object.keys(handlers), [])
})

test('mixer: 界面音效 defaults to 50%, migrates saved UI gain once and has a row in the mixer', async () => {
  const mixer = await read('src/client/fork-stage-audio.js'), rows = await read('src/client/fork-gal-mixer.js')
  const prefs = vm.runInNewContext(mixer.slice(0, mixer.indexOf('const forkStageAudio =')) + ';forkAudioPreferences', {})
  const storage = saved => ({ getItem: () => saved === undefined ? null : JSON.stringify(saved), setItem() {} })
  assert.equal(prefs(storage({ v: 1, master: 0.8 })).ui, 0.5)
  assert.equal(prefs(storage({ v: 1, ui: 0.2 })).ui, 0.8)
  assert.equal(prefs(storage({ v: 1, ui: 0.5 })).ui, 1)
  assert.equal(prefs(storage({ v: 1, ui: 0 })).ui, 0)
  assert.equal(prefs(storage({ v: 1, ui: 7 })).ui, 1)
  assert.equal(prefs(storage()).ui, 0.5)
  assert.equal(prefs({ getItem() { throw Error('storage unavailable') } }).ui, 0.5)
  assert.equal(prefs({ getItem: () => '{invalid' }).ui, 0.5)
  const saved = { v: 1, ui: 0.3, muted: { ui: true } }
  const writes = []
  const loaded = prefs({ getItem: () => JSON.stringify(saved), setItem(...args) { writes.push(args) } })
  assert.equal(loaded.ui, 1)
  assert.equal(loaded.muted.ui, true)
  // private fork: migrate once atomically, retaining mutes and all other saved fields.
  assert.equal(writes.length, 1)
  const migrated = JSON.parse(writes[0][1])
  assert.equal(migrated.uiGainVersion, 1)
  assert.equal(prefs({ getItem: () => JSON.stringify(migrated), setItem(...args) { writes.push(args) } }).ui, 1)
  assert.equal(writes.length, 1, 'migration must run only once')
  const quiet = prefs(storage({ v: 1, ui: 0.2, master: 0.8 }))
  near(api.forkUiSfxGain(quiet, 'confirm'), 0.2 * 0.8) // private fork: old 20 = new 80.
  assert.equal(prefs(storage({ v: 1, ui: 0.2, uiGainVersion: 1 })).ui, 0.2)
  assert.match(rows, /\["ui", "界面音效"\]\];/)
  assert.match(rows, /const on = \["voice", "music", "sfx", "ambience"\]\.filter\(heard\)/, 'the speaker icon still speaks for the story sound only')
})

test('wiring: stage-only call sites; the chat BGM placement stays silent', async () => {
  const menu = await read('src/client/fork-gal-menu.js'), stage = await read('src/client/fork-gal-stage.js'), bgm = await read('src/client/fork-bgm-player.js')
  const config = await read('src/client/fork-gal-config.js'), regenerate = await read('src/client/fork-gal-regenerate.js'), choices = await read('src/client/fork-gal-choices.js')
  const frame = await read('src/client/runtime/frame-document.js')
  assert.match(frame, /@include fork-stage-audio\.js\n\t\t\/\/ @include fork-ui-sfx\.js/)
  assert.match(menu, /forkUiSfx\.play\("open"\)/)
  assert.match(stage, /function openBacklog\(\) \{[^}]*forkUiSfx\.play\("open"\)/)
  assert.match(stage, /function closeBacklog\(\) \{ forkUiSfx\.play\("close"\)/)
  assert.match(stage, /function openConfig\(opener\) \{[^\n]*forkUiSfx\.play\("open"\)/)
  // private fork (stage setup wizard v2): entering may open 设置向导 instead; the sound plays only when the stage opens.
  assert.match(stage, /function forkGalOpen\(sessionId, target\) \{\n    forkUiSfx\.preload\(\); forkUiSfx\.play\("open"\)/)
  assert.match(stage, /function forkGalLeave\(\) \{\n    forkUiSfx\.play\("close"\)/)
  assert.match(config, /useForkUiSfxControls\(root\)/)
  assert.match(regenerate, /"data-ui-sfx": "cancel"/)
  assert.match(choices, /forkUiSfx\.play\("choice"\)/)
  const chat = bgm.slice(bgm.indexOf('function ForkBgmChat('))
  assert.doesNotMatch(chat, /forkUiSfx|useForkUiSfxControls/)
  assert.match(bgm.slice(bgm.indexOf('function ForkBgmStage('), bgm.indexOf('function ForkBgmChat(')), /useForkUiSfxControls\(panel, open\)/)
})

// private fork: navigation stays silent; only opening/closing its panel has a cue.
test('page navigation and backlog scrolling have no UI sound hooks', async () => {
  const stage = await read('src/client/fork-gal-stage.js')
  const backlog = await read('src/client/fork-gal-backlog.js')
  const navigation = stage.slice(stage.indexOf('    function go('), stage.indexOf('    function replay('))
  assert.ok(navigation.includes('function input(delta)'), 'covers shared text, wheel and keyboard navigation')
  assert.doesNotMatch(navigation, /forkUiSfx|useForkUiSfxControls|data-ui-sfx/)
  // private fork: stage and phone now share wheel(); inspect that handler, not the retired inline callback.
  const wheel = stage.slice(stage.indexOf('    function wheel(event) {'), stage.indexOf('    // Mixer and Config:'))
  assert.match(stage, /onWheel: wheel/, 'the stage uses the same wheel handler as widget forwarding')
  assert.ok(wheel.includes("decision.action === 'advance-read'"))
  assert.doesNotMatch(wheel, /forkUiSfx|useForkUiSfxControls|data-ui-sfx/)
  assert.doesNotMatch(backlog, /forkUiSfx|useForkUiSfxControls|data-ui-sfx/)
  assert.equal(api.forkUiSfxAllow({ at: {} }, 'page', 0), false)
  assert.equal(api.forkUiSfxControlCue(el('button', { 'data-ui-sfx': 'page' })), null)
  assert.equal(await readTavernClientAsset(TAVERN_CLIENT_ASSET_PREFIX + 'ui-sfx/page.ogg'), undefined)
  await assert.rejects(stat(new URL('../tavern-plugin/lib/client-assets/ui-sfx/page.ogg', import.meta.url)), { code: 'ENOENT' })
})

test('assets: seven candidate E Ogg Opus files served as audio/ogg, original synthesis credits name every source', async () => {
  const credits = await read('lib/client-assets/ui-sfx/CREDITS.md')
  assert.match(credits, /original, project-owned procedural synthesis/)
  assert.match(credits, /candidate E/)
  const expectedSizes = {open:20805,close:20301,move:6134,confirm:20765,cancel:18621,toggle:12198,choice:21471}
  let total = 0
  for (const cue of TAVERN_UI_SFX_CUES) {
    const url = new URL('../tavern-plugin/lib/client-assets/ui-sfx/' + cue + '.ogg', import.meta.url)
    const { size } = await stat(url)
    total += size
    assert.equal(size, expectedSizes[cue], cue + ' retains the audition encoding')
    const bytes = await readFile(url)
    assert.equal(bytes.subarray(0, 4).toString('latin1'), 'OggS')
    assert.ok(bytes.includes(Buffer.from('OpusHead')), cue + ' is Opus')
    assert.equal(bytes[bytes.indexOf(Buffer.from('OpusHead')) + 9], 1, 'mono')
    assert.match(credits, new RegExp('E/' + cue + '\\.ogg'))
    const served = await readTavernClientAsset(TAVERN_CLIENT_ASSET_PREFIX + 'ui-sfx/' + cue + '.ogg')
    assert.equal(served.mediaType, 'audio/ogg')
    assert.deepEqual(served.body, bytes)
  }
  assert.equal(total, 120295, 'all seven unmodified E candidates')
  assert.equal(await readTavernClientAsset(TAVERN_CLIENT_ASSET_PREFIX + 'ui-sfx/boom.ogg'), undefined)
  assert.equal(await readTavernClientAsset(TAVERN_CLIENT_ASSET_PREFIX + 'ui-sfx/CREDITS.md'), undefined)
  assert.equal(await readTavernClientAsset(TAVERN_CLIENT_ASSET_PREFIX + 'constructor'), undefined, 'no prototype lookups')
})
