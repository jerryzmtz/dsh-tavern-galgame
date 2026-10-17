import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { forkUiSfxStub } from './helpers/fork-ui-sfx-stub.mjs' // private fork: stage UI cues
import {readFileSync} from 'node:fs'

// In-memory fixtures only: execute the production listener and entry/exit paths.
const source = readFileSync(new URL('../tavern-plugin/src/client/fork-gal-stage.js', import.meta.url), 'utf8')
const entry = readFileSync(new URL('../tavern-plugin/src/client/fork-gal-entry.js', import.meta.url), 'utf8')
function fixture() {
  const listeners = new Map(), requests = []
  let current = 'card'
  const data = {card: {cardPath: 'cards/example', config: {enabled: true}}, disabled: {cardPath: 'cards/example', config: {enabled: false}}, ordinary: {}}
  const attributes = new Map()
  const document = {fullscreenElement: null, querySelectorAll: () => [], documentElement: {
    setAttribute(name, value) {attributes.set(name, value)}, removeAttribute(name) {attributes.delete(name)},
    requestFullscreen() {assert.ok(attributes.has('data-fork-gal-stage'), 'cover chat before fullscreen layout'); requests.push('enter'); document.fullscreenElement = {}; return Promise.resolve()}
  }, exitFullscreen() {requests.push('exit'); document.fullscreenElement = null; return Promise.resolve()}}
  const context = {document, window: {
    addEventListener(name, fn, capture) {assert.ok(!listeners.has(name)); listeners.set(name, {fn, capture})},
    removeEventListener(name, fn, capture) {assert.equal(listeners.get(name).fn, fn); assert.equal(listeners.get(name).capture, capture); listeners.delete(name)}
  }, ...forkUiSfxStub(), forkBubbleStore: {get: id => data[id]}, ctx: {sessions: {list: {getSnapshot: () => ({current})}}}}
  // Include the same entry dependency as the production stage, rather than stubbing its cover path.
  vm.runInNewContext(entry + '\n' + source.slice(source.indexOf('const forkGalActive ='), source.indexOf('function useForkGalOn')) + '\nthis.stop = forkGalStageShortcut(ctx); this.active = forkGalActive;', context)
  function key(extra = {}) {
    const event = {key: 'F12', prevented: false, stopped: false, preventDefault() {this.prevented = true}, stopPropagation() {this.stopped = true}, ...extra}
    listeners.get('keydown').fn(event)
    return event
  }
  return {context, listeners, requests, key, select: id => {current = id}, emit: name => listeners.get(name).fn()}
}

test('F12 enters/exits current card through fullscreen paths, regardless of editor focus', () => {
  const f = fixture()
  for (const target of [{tagName: 'INPUT'}, {tagName: 'TEXTAREA'}, {isContentEditable: true}]) {
    assert.equal(f.key({target}).prevented, true)
    assert.equal(f.context.active.get(), 'card')
    assert.equal(f.key({repeat: true}).prevented, true)
    assert.equal(f.context.active.get(), 'card')
    assert.equal(f.key({target}).stopped, true)
    assert.equal(f.context.active.get(), '')
  }
  assert.deepEqual(f.requests, ['enter', 'exit', 'enter', 'exit', 'enter', 'exit'])
  f.key()
  f.select('ordinary')
  assert.equal(f.key().prevented, false, 'an old stage cannot hijack a non-card session')
  f.select('card')
  f.key()
  assert.equal(f.context.active.get(), '')
  f.context.stop()
  assert.equal(f.listeners.size, 0)
})

test('plugin lifecycle owns the shortcut once', () => {
  const main = readFileSync(new URL('../tavern-plugin/src/client/main.js', import.meta.url), 'utf8')
  assert.equal(main.match(/ctx\.effect\(\(\) => forkGalStageShortcut\(ctx\)/g)?.length, 1)
})

test('IME, other keys and unavailable sessions never toggle or intercept', () => {
  const f = fixture()
  for (const extra of [{isComposing: true}, {keyCode: 229}, {key: 'F11'}]) assert.equal(f.key(extra).prevented, false)
  f.emit('compositionstart')
  assert.equal(f.key().prevented, false)
  f.emit('compositionend')
  for (const id of [null, 'ordinary', 'disabled']) {
    f.select(id)
    assert.equal(f.key().prevented, false)
  }
  assert.deepEqual(f.requests, [])
  f.select('card')
  f.emit('compositionstart'); f.emit('blur')
  assert.equal(f.key().prevented, true)
  f.context.stop()
})
