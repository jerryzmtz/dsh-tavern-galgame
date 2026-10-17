// private fork (B2b O07): the inherited bottom workbench starts collapsed on a phone and stays openable.
import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import {readFileSync} from 'node:fs'

const source = readFileSync(new URL('../tavern-plugin/src/client/modules/sidebar-start.js', import.meta.url), 'utf8')
const flush = () => new Promise(resolve => setTimeout(resolve, 5))

function setup({width, bottomOpen = true, gestureAgo = Infinity}) {
  let state = {bottomOpen, bottomSplits: {kind: 'leaf', tabs: [{id: 'dsh-tavern:bubbles'}]}}
  const listeners = new Set(), clicks = []
  const sidebar = {
    getSnapshot: () => ({sessionId: 's', state}),
    subscribeState(listener) { listeners.add(listener); return () => listeners.delete(listener) }
  }
  // The panel's own collapse button toggles the store, like dsh-better-sidebar's bottomClose.
  const close = {click() { clicks.push(Date.now()); state = {...state, bottomOpen: !state.bottomOpen}; listeners.forEach(fn => fn()) }}
  const list = {getSnapshot: () => ({current: 's'}), subscribe: () => () => {}}
  const context = vm.createContext({React: {}, queueMicrotask, setTimeout, clearTimeout, Date,
    document: {querySelector: selector => selector === '[data-dsh-bottom-panel] > button' ? close : null}})
  vm.runInContext(source + '\n;globalThis.__api = {tavernPhoneBottomGuard, tavernBottomPanel};', context)
  const view = {matchMedia: query => ({matches: width <= Number(/max-width: (\d+)px/.exec(query)[1])}), setTimeout, clearTimeout}
  const stop = context.__api.tavernPhoneBottomGuard({betterSidebar: sidebar, sessions: {list}}, view, () => Date.now() - gestureAgo)
  return {stop, clicks, sidebar, api: context.__api, open: () => state.bottomOpen}
}

test('a phone collapses an inherited open bottom workbench at load; the desktop keeps it', async () => {
  const phone = setup({width: 375})
  await flush()
  assert.equal(phone.open(), false, 'collapsed before the reader sees it')
  assert.equal(phone.clicks.length, 1)
  assert.equal(phone.api.tavernBottomPanel.tabs(phone.sidebar), 1, 'its tabs stay; only the panel folds')
  assert.equal(phone.api.tavernBottomPanel.toggle(), true, 'the ⋯ menu entry opens it again')
  phone.stop()
  const desktop = setup({width: 1920})
  await flush()
  assert.equal(desktop.open(), true)
  assert.equal(desktop.clicks.length, 0)
  desktop.stop()
})

test('a bottom workbench opened by a tap on the phone stays open', async () => {
  const phone = setup({width: 375, gestureAgo: 100})
  await flush()
  assert.equal(phone.open(), true)
  assert.equal(phone.clicks.length, 0)
  phone.stop()
})
