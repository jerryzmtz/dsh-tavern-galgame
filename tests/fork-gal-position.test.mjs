// private fork: position writes belong to the session-runtime consumer, not the retired publication hook.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const source = await readFile(new URL('../tavern-plugin/src/client/fork-gal-stage.js', import.meta.url), 'utf8')
const ui = await readFile(new URL('../tavern-plugin/src/client/fork-stage-ui.js', import.meta.url), 'utf8')
const code = source.slice(source.indexOf('// Hash text only'), source.indexOf('function forkGalSubtitleCache(')) + '\n' +
  ui.slice(ui.indexOf('function useForkStagePosition('), ui.indexOf('function forkStageVoiceHandle('))
function harness(storage = new Map()) {
  const slots = [], effects = [], timers = new Map(), listeners = new Map(), navigation = [], progress = []
  let cursor = 0, serial = 0, result
  const changed = (a, b) => !a || b.some((v, i) => !Object.is(v, a[i]))
  const React = {
    useMemo(fn, deps) { const i = cursor++; if (changed(slots[i]?.deps, deps)) slots[i] = { deps, value: fn() }; return slots[i].value },
    useEffect(fn, deps) { const i = cursor++; if (changed(slots[i]?.deps, deps)) effects.push(() => { slots[i]?.cleanup?.(); slots[i] = { deps, cleanup: fn() } }) }
  }
  const pages = ['Opening.', 'Middle.', 'Saved text.', 'Ending.'].map((text, i) => ({ text, anchor: { para: i + 1, offset: 0 } }))
  const state = { session: 'neuro', restored: false, parts: [{ text: pages.map(p => p.text).join('\n\n') }], pages,
    runtime: { source: { turn: 13 }, latestSource: { turn: 13 }, text: { streaming: false }, cursor: { anchor: pages[2].anchor }, store: { dispatch: value => progress.push(value) } } }
  const env = { React, localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    setTimeout: fn => { timers.set(++serial, fn); return serial }, clearTimeout: id => timers.delete(id),
    sameAnchor: (a, b) => a?.para === b?.para && a?.offset === b?.offset,
    forkStageSessions: { owner: { navigate: (...args) => navigation.push(args) } },
    window: { addEventListener: (key, fn) => listeners.set(key, fn), removeEventListener: key => listeners.delete(key) } }
  vm.runInNewContext(code, env)
  return { state, env, storage, timers, navigation, progress,
    render() { cursor = 0; result = env.useForkStagePosition(state.session, state.runtime, state.parts, state.pages, { restored: state.restored, onSelect() { state.restored = true } }); effects.splice(0).forEach(fn => fn()); return result[0] },
    select: page => result[1](page), markRead: () => result[3].markRead(),
    flush: () => listeners.get('pagehide')(), unmount: () => slots.forEach(slot => slot?.cleanup?.()) }
}
const key = 'fork-stage-position:neuro'
test('cold and streaming runtime inputs cannot overwrite the durable bookmark before stage restore', () => {
  const original = JSON.stringify({ turn: 13, page: 2 }), h = harness(new Map([[key, original]]))
  h.render(); h.flush(); assert.equal(h.storage.get(key), original)
  h.state.restored = true; h.state.runtime.text.streaming = true
  h.render(); h.flush(); assert.equal(h.storage.get(key), original)
  h.state.runtime.text.streaming = false
  assert.equal(h.render(), 2); h.flush()
  assert.equal(JSON.parse(h.storage.get(key)).page, 2)
  assert.deepEqual(JSON.parse(h.storage.get(key)).anchor, { para: 3, offset: 0 })
  h.unmount()
})
test('runtime navigation owns selection and read progress, while writes remain throttled', () => {
  const h = harness(); h.state.restored = true; h.render()
  h.select(3)
  assert.deepEqual(h.navigation, [['neuro', 13, 3, true]])
  h.state.runtime.cursor.anchor = h.state.pages[3].anchor; h.render(); h.markRead()
  assert.equal(h.timers.size, 1)
  h.flush()
  const saved = JSON.parse(h.storage.get(key))
  assert.equal(saved.page, 3); assert.equal(saved.readThrough.page, 3)
  assert.equal(h.progress[0].type, 'READ_PROGRESS')
  assert.equal(h.progress[0].readThrough, 'Ending.'.length)
  h.unmount()
})
test('interrupted loading discards pending writes; session switch keeps separate storage keys', () => {
  const h = harness(); h.state.restored = true; h.render()
  h.state.runtime.text.streaming = true; h.render(); h.flush()
  assert.equal(h.storage.has(key), false)
  h.state.runtime.text.streaming = false; h.render(); h.flush()
  h.state.session = 'other'; h.state.runtime.cursor.anchor = h.state.pages[0].anchor
  h.render(); h.flush()
  assert.equal(JSON.parse(h.storage.get(key)).page, 2)
  assert.equal(JSON.parse(h.storage.get('fork-stage-position:other')).page, 0)
  h.unmount()
})
test('shared restore helpers preserve paragraph anchors through pagination and ignore voice readiness', () => {
  const h = harness(), digest = h.env.forkGalTextDigest(h.state.parts)
  const saved = { turn: 13, page: 1, textDigest: digest, anchor: { para: 1, offset: 14 } }
  const pages = [{ para: 1, text: 'First ' }, { para: 1, text: 'sentence.' }, { para: 1, text: 'Saved sentence.' }]
  const value = h.env.forkGalRestorePosition(saved, 13, pages.length, digest, pages)
  assert.equal(value.page, 2)
  assert.equal(h.env.forkGalTextDigest([{ ...h.state.parts[0], voices: { ready: true } }]), digest)
})
