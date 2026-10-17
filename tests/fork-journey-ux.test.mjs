// private fork (new-user journey 2026-10, output/journey/PROPOSALS.md §4): phased waiting text, first-run stage hints,
// silent transient conflicts and card ZIP upload progress.
import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { answer } from './helpers/stage-director-harness.mjs'
import { harness, drain } from './helpers/stage-resource-harness.mjs'

const require = createRequire(import.meta.url)
const { stageDiagnosticText, stageRuntimeErrorText, stageRuntimeIndicators, createStageRuntimeState } = require('../tavern-plugin/src/client/fork-stage-runtime.cjs')
const client = name => readFile(new URL('../tavern-plugin/src/client/' + name, import.meta.url), 'utf8')
const element = (type, props, ...children) => ({ type, props: props || {}, children: children.flat() })
const text = node => !node || typeof node !== 'object' ? (node === null || node === undefined || node === false ? '' : String(node)) : node.children.map(text).join('')

async function runtimeStatus() {
  const source = await client('fork-gal-stage.js')
  const context = { stageDiagnosticText, stageRuntimeErrorText, ForkSpinner: 'ForkSpinner', ForkIcon: 'ForkIcon', React: { createElement: element, Fragment: 'Fragment' } }
  const refusal = await readFile(new URL('../tavern-plugin/lib/domain/response-refusal.js', import.meta.url), 'utf8')
  vm.runInNewContext(refusal.replace(/export \{[^}]+\}/, '') + '\n' + await client('refusal-notice.js'), context)
  vm.runInNewContext(source.slice(source.indexOf('const FORK_GAL_DIAGNOSTIC_TEXT'), source.indexOf('// Name plate of the text box')), context)
  return { source, context }
}

test('the stage spinner reads 正在写正文… while the body streams, then 正在编排演出…', async () => {
  const state = createStageRuntimeState()
  state.pending = { ...state.pending, text: true }
  assert.equal(stageRuntimeIndicators(state).streaming, true)
  state.pending = { ...state.pending, text: false, director: true }
  assert.equal(stageRuntimeIndicators(state).streaming, false)
  assert.equal(stageRuntimeIndicators(state).spinner, true)
  const { context } = await runtimeStatus()
  assert.match(text(context.ForkGalRuntimeStatus({ busy: 'write' })), /^正在写正文…$/)
  assert.match(text(context.ForkGalRuntimeStatus({ busy: 'direct' })), /^正在编排演出…$/)
  assert.match(text(context.ForkGalRuntimeStatus({ busy: 'load' })), /^正在载入素材…$/)
})

test('next-action wait names the active settlement, not the body model or a director', async () => {
  const { source, context } = await runtimeStatus()
  for (const phase of ['pending', 'running']) {
    assert.match(context.forkGalAwaitingText({ role: 'settlement', phase }), /等待上一轮后台结算.*开始正文/)
  }
  for (const activity of [null, { role: 'settlement', phase: 'failed' }, { role: 'settlement', phase: 'idle' }, { role: 'director', phase: 'running' }]) {
    assert.equal(context.forkGalAwaitingText(activity), '正在书写下一幕')
  }
  assert.match(source, /awaitingText = forkGalAwaitingText\(regenerationActivity\.view\?\.activity\)/)
  assert.match(source, /"aria-label": awaitingText/)
  assert.match(source, /h\("span", null, awaitingText\)/)
})

test('provider-filtered body is named in the existing stage error surface, not presentation failure', async () => {
  const { context } = await runtimeStatus()
  const error = 'PI_AI_ERROR: Response incomplete: content_filter'
  const body = text(context.ForkGalRuntimeStatus({ error, bodyFailure: true }))
  assert.match(body, /正文模型被服务商内容审核拒绝/)
  assert.doesNotMatch(body, /演出暂不可用|正文不受影响/)
  assert.match(body, /修改输入后重新发送/)
  assert.match(text(context.ForkGalRuntimeStatus({ error, bodyFailure: false })), /演出暂不可用/)
  const transport = text(context.ForkGalRuntimeStatus({ error: 'Connection reset', bodyFailure: true }))
  assert.match(transport, /正文生成失败/)
  assert.doesNotMatch(transport, /内容审核拒绝|正文不受影响/)
  assert.match(text(context.ForkGalRuntimeStatus({ error: 'cancelled', bodyFailure: true })), /正文生成已停止/)
})

test('first-run hints: the sound line and the real shortcut list ride the notice stack', async () => {
  const { source, context } = await runtimeStatus()
  const tree = context.ForkGalRuntimeStatus({ hints: { keys: true, sound: true } })
  const rendered = text(tree)
  assert.match(rendered, /点任意处开启声音/)
  for (const pair of ['A自动', '按住 Ctrl跳过', 'H隐藏', 'L履历', 'Esc菜单', 'F12回聊天']) assert.ok(rendered.includes(pair), pair)
  assert.equal(JSON.stringify(tree).includes('"role":"dialog"'), false, 'no modal')
  assert.equal(text(context.ForkGalRuntimeStatus({ hints: { keys: false, sound: false } })), '')
  // Every listed key is a real binding of the stage.
  // private fork (reading controls): letter keys are matched case-insensitively through `letter`.
  for (const pattern of [/letter === "a"\) \{ if \(!auto\) setSkipping\(false\); setAuto/, /event\.key !== "Control"/, /letter === "h"\) setHidden/,
    /letter === "l"\) \{ event\.preventDefault\(\); openBacklog/, /openMenu\(false\)/, /event\.key !== "F12"/]) assert.match(source, pattern)
  // 「已看过」 lives in the persisted frame storage, not the page origin's localStorage.
  const hook = source.slice(source.indexOf('function useForkGalFirstRunHints'), source.indexOf('// The stage\'s real key bindings'))
  assert.match(hook, /store\.markSeen\(FORK_GAL_KEYS_HINT\)/)
  assert.doesNotMatch(hook, /localStorage/)
})

test('frame storage keeps 「已看过」 host-only, acknowledged through updateFrameStorage', async () => {
  const source = await client('fork-frame-storage.js'), calls = []
  const timers = []
  const window = { setTimeout: fn => { timers.push(fn); return timers.length }, clearTimeout() {} }
  const context = { window, TextEncoder, rpc: async (method, args) => { calls.push([method, args]); return method === 'getFrameStorage' ? { values: {} } : { ok: true, applied: args.ops.length } } }
  vm.runInNewContext(source + '\nthis.store = forkFrameStorage;', context)
  const store = context.store
  await store.load()
  assert.equal(store.loaded(), true)
  assert.equal(store.seen('stage-shortcuts'), false)
  store.start(); store.markSeen('stage-shortcuts'); store.markSeen('stage-shortcuts')
  assert.equal(store.seen('stage-shortcuts'), true)
  await store.flush()
  const writes = calls.filter(([method]) => method === 'updateFrameStorage').flatMap(([, args]) => args.ops)
  assert.deepEqual(JSON.parse(JSON.stringify(writes)), [{ op: 'set', key: 'dsh-ui-seen:stage-shortcuts', value: '1' }])
  assert.equal(Object.keys(store.capability({ sessionId: 's', cardPath: 'c' }, { crypto: globalThis.crypto }).seed).length, 0, 'no card frame sees it')
})

test('BGM refused by the autoplay policy is flagged until a later play starts', async () => {
  const source = await client('fork-stage-music.js')
  let allow = false
  class FakeAudio { constructor() { this.paused = true } play() { if (!allow) return Promise.reject(Object.assign(new Error('autoplay'), { name: 'NotAllowedError' })); this.paused = false; return Promise.resolve() } pause() { this.paused = true } removeAttribute() {} }
  const context = { Audio: FakeAudio,
    forkStageAudio: { level: () => 0, bind() {}, get: () => ({ music: 1, muted: {} }), subscribe: () => () => {} },
    forkForeground: { setTimeout: () => 0, clearTimeout() {}, now: () => 0 } }
  vm.runInNewContext(source + '\nthis.music = forkStageMusic;', context)
  const changes = []
  context.music.subscribeBlocked(() => changes.push(context.music.blocked()))
  context.music.play('/song.mp3', true, 'song')
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(context.music.blocked(), true)
  allow = true; context.music.resume()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(context.music.blocked(), false)
  assert.ok(changes.includes(true) && changes.at(-1) === false)
})

test('a play deferred in the background and refused later still flags the BGM as blocked', async () => {
  const source = await client('fork-stage-music.js')
  class FakeAudio extends EventTarget { constructor() { super(); this.paused = true } play() { return Promise.resolve() } pause() { this.paused = true } removeAttribute() {} }
  const context = { Audio: FakeAudio, Event,
    forkStageAudio: { level: () => 0, bind() {}, get: () => ({ music: 1, muted: {} }), subscribe: () => () => {} },
    forkForeground: { setTimeout: () => 0, clearTimeout() {}, now: () => 0 } }
  vm.runInNewContext(source + '\nthis.music = forkStageMusic;', context)
  const node = []
  const play = FakeAudio.prototype.play
  FakeAudio.prototype.play = function () { node.push(this); return play.call(this) }
  context.music.play('/song.mp3', true, 'song')
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(context.music.blocked(), false, 'a deferred (background) play is not a refusal yet')
  node[0].dispatchEvent(new Event('fork-play-blocked'))
  assert.equal(context.music.blocked(), true)
  node[0].dispatchEvent(new Event('playing'))
  assert.equal(context.music.blocked(), false)
  const foreground = await client('fork-foreground.js')
  assert.match(foreground, /error\.name === 'NotAllowedError'\) node\.dispatchEvent\(new Event\('fork-play-blocked'\)\)/)
})

test('transient conflicts retry silently; only an exhausted retry budget warns, without 「正在重试」', async t => {
  const h = await harness(t, answer); await h.direct()
  const accepted = h.store.getSnapshot().accepted.scene
  h.setResponse({ status: 'pending', error: { code: 'REVISION_CONFLICT', message: 'Stage read point changed' } })
  h.refresh(); await drain()
  assert.equal(h.store.getSnapshot().pending.error, null, 'no ⚠ while retrying')
  h.clock.advance(700); await drain()
  assert.equal(h.store.getSnapshot().pending.error, null)
  h.setResponse(null); h.clock.advance(700); await drain()
  assert.equal(h.store.getSnapshot().pending.error, null, 'a retry that succeeds never warned')
  assert.equal(h.store.getSnapshot().accepted.scene.backgroundUrl, accepted.backgroundUrl)

  h.setResponse({ status: 'failed', error: { code: 'REVISION_CONFLICT', message: 'Stage read point changed' } })
  h.refresh(); await drain()
  for (let i = 0; i < 4; i++) { assert.equal(h.store.getSnapshot().pending.error, null); h.clock.advance(700); await drain() }
  h.clock.advance(700); await drain()
  const error = h.store.getSnapshot().pending.error
  assert.match(error, /^PROJECTION_FAILED: /)
  assert.doesNotMatch(stageDiagnosticText(error), /正在重试/)
  assert.match(stageDiagnosticText(error, true), /REVISION_CONFLICT: Stage read point changed/, 'the cause stays for the 调试视图')
})

test('a real projection failure still warns at once', async t => {
  const h = await harness(t, answer); await h.direct()
  h.setResponse({ status: 'failed', error: { code: 'PROJECTION_FAILED', message: 'authority is not defined' } })
  h.refresh(); await drain()
  assert.match(h.store.getSnapshot().pending.error, /^PROJECTION_FAILED: 舞台资源投影失败/)
})

test('a card ZIP upload with onProgress reports the bytes sent through XMLHttpRequest', async () => {
  const source = await client('fork-pack-transport.js'), sent = [], progress = []
  class FakeXhr {
    constructor() { this.upload = {}; this.headers = {} }
    open(method, url) { this.method = method; this.url = url }
    setRequestHeader(name, value) { this.headers[name] = value }
    send(body) {
      sent.push({ url: this.url, method: this.method, body, headers: this.headers })
      this.upload.onprogress({ lengthComputable: true, loaded: 50, total: 100 })
      this.upload.onprogress({ lengthComputable: true, loaded: 100, total: 100 })
      this.status = 200; this.responseText = JSON.stringify({ ticket: 't1' }); this.onload()
    }
    abort() {}
  }
  const controls = []
  const context = { AbortController, URL, Blob, Uint8Array, XMLHttpRequest: FakeXhr, DOMException, setTimeout, clearTimeout,
    fetch: async (path, options) => { controls.push(JSON.parse(options.body)); return Response.json({ inspectionId: 'i1' }) } }
  vm.runInNewContext(source, context)
  const transport = context.createForkPackTransport({ fetch: context.fetch })
  try {
    const file = new Blob([new Uint8Array(100)])
    const result = await transport.service.inspectCardBundle({ path: 'cards/a.json', bytes: file, onProgress: value => progress.push(value) })
    assert.equal(result.inspectionId, 'i1')
    assert.equal(sent.length, 1); assert.equal(sent[0].url, '/api/dsh-asset-library/v2/upload'); assert.equal(sent[0].body, file, 'the file goes up as it is')
    assert.deepEqual(progress.map(p => p.loaded), [50, 100])
    const inspect = controls.find(row => row.method === 'inspectCardBundle')
    assert.deepEqual(inspect.args, { path: 'cards/a.json', bytes: 't1' }, 'onProgress never reaches the host')
  } finally { transport.dispose() }
})

test('导入卡片 shows MB sent while reading', async () => {
  const source = await client('fork-asset-pack-ui.js')
  assert.match(source, /inspectCardBundle\(\{path,bytes:file,onProgress\}\)/)
  const mb = vm.runInNewContext(source.slice(source.indexOf('const cardUploadMb='), source.indexOf('\n', source.indexOf('const cardUploadMb='))) + ';cardUploadMb')
  assert.equal(mb(12 * 1048576 + 5, 205 * 1048576) + ' / ' + mb(205 * 1048576, 205 * 1048576), '12 / 205')
  assert.equal(mb(1.5 * 1048576, 4 * 1048576), '1.5')
})
