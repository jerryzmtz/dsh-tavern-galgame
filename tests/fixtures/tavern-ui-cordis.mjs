import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { JSDOM } from 'jsdom'
import * as Cordis from '@deepseek-ai/cordis'
import React from 'react'
import * as ReactDOM from 'react-dom'
import { createRoot } from 'react-dom/client'

// Real native directory/theme code; only the wire, persistence and slot carrier
// and snapshot store are offline fakes. Never replace modelDirectories with a POJO:
// Cordis rebinds a Service's ctx to its consumer, where nested guards must run.
const settle = async fn => { await fn(); await new Promise(resolve => setTimeout(resolve, 25)) }

export async function exerciseShell(body) {
  const host = resolve(dirname(process.env.DSH_BOOT_MODULE), '../..')
  const store = { createSnapshotStore(initial) {
    let snapshot = initial
    const listeners = new Set()
    const api = { getSnapshot: () => snapshot, subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) },
      set(next) { snapshot = next; for (const fn of listeners) fn() },
      update(change) { const next = { ...snapshot }; change(next); api.set(next) } }
    return api
  } }
  const dom = new JSDOM('<head></head><body><aside data-slot="sidebar"><div class="_logoRow"><button>Collapse</button></div></aside><main data-slot="main.conversation"></main></body>', { url: 'http://offline.test', runScripts: 'outside-only', pretendToBeVisual: true })
  const { window } = dom, { document } = window
  const globals = new Map()
  for (const [key, value] of Object.entries({ window, document, HTMLElement: window.HTMLElement, requestAnimationFrame: window.requestAnimationFrame.bind(window), IS_REACT_ACT_ENVIRONMENT: false })) {
    globals.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true })
  }
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
  window.HTMLElement.prototype.getBoundingClientRect = () => ({ x: 20, y: 100, left: 20, top: 100, right: 220, bottom: 140, width: 200, height: 40 })
  // JSDOM lacks Popover; retain its toggle/matches contract used by the control.
  const matches = window.HTMLElement.prototype.matches
  window.HTMLElement.prototype.matches = function (selector) { return selector === ':popover-open' ? !!this._open : matches.call(this, selector) }
  for (const [method, open] of [['showPopover', true], ['hidePopover', false]]) window.HTMLElement.prototype[method] = function () {
    if (!!this._open === open) return
    this._open = open
    const event = new window.Event('toggle'); event.newState = open ? 'open' : 'closed'; this.dispatchEvent(event)
  }
  const errors = []
  window.addEventListener('error', event => { errors.push(event.error); event.preventDefault() })
  window.console.error = (...args) => errors.push(new Error(args.join(' ')))
  const dependencies = { '@deepseek-ai/cordis': Cordis, '@deepseek-ai/dsh-client-store': store, react: React, 'react-dom': ReactDOM, 'react/jsx-runtime': await import('react/jsx-runtime'), '@deepseek-ai/dsh-client-ui-primitives': {} }
  function load(code) {
    let plugin
    window.__ModuleLoader__ = { load({ factory }) { plugin = factory(name => { assert.ok(name in dependencies, 'unexpected native import: ' + name); return dependencies[name] }) } }
    window.eval(code)
    return plugin
  }
  const native = name => load(readFileSync(resolve(host, name, 'lib/client.js'), 'utf8'))
  const ctx = new Cordis.Context(), roots = [], entries = new Map()
  const counts = { catalog: 0, selection: 0, pricing: 0, fontDisposals: 0 }
  const subscribers = new Set()
  let mode = 'play'
  const current = { provider: 'offline', model: 'model', reasoningEffort: 'low' }
  const projected = store.createSnapshotStore({ next: current })
  const preferences = store.createSnapshotStore({ value: { preference: 'light', fontSize: 17 } })
  let ui, sessionScope
  const render = async (name, id, props = {}) => {
    const entry = [...entries.values()].find(e => e.meta.name === name && (!id || e.meta.id === id))
    assert.ok(entry, 'missing control: ' + name + '/' + id)
    // Execute the actual slot callback before render, just as the native carrier
    // does. Missing nested service injection must fail here, not remain latent.
    const injected = entry.meta.inject?.(name === 'conversation.input.model' ? 'cold-session' : undefined) || {}
    const node = document.createElement('div'); document.querySelector('main').appendChild(node)
    const root = createRoot(node, { onUncaughtError: error => errors.push(error) }); roots.push(root)
    await settle(async () => { root.render(React.createElement(entry.component, { ...injected, ...props })); await new Promise(r => setTimeout(r, 25)) })
    return node
  }
  const click = async selector => {
    const node = document.querySelector(selector); assert.ok(node, 'missing selector: ' + selector)
    await settle(async () => { node.click(); await new Promise(r => setTimeout(r, 25)) })
    if (errors.length) throw errors[0]
  }
  const escape = () => settle(async () => { document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
  try {
    let provider
    await ctx.plugin({ name: 'offline-host-fixtures', apply(scope) { provider = scope } }).await()
    // The fake wire keeps dotted services independently guarded, like the real
    // remote namespace. Access goes through the consumer's Cordis Context.
    class Remote extends Cordis.Service {
      constructor(context) { super(context, 'remote') }
      $on() { return () => {} }
    }
    provider.provide('remote.session', {
      async modelCatalog() { counts.catalog++; return { ok: true, value: { default: current, routableProviders: ['offline'], failures: [], groups: [{ id: 'offline', models: [{ id: 'model', name: 'Offline Model', reasoning: { defaultEffort: 'low', efforts: [{ id: 'low' }, { id: 'high' }] } }] }] } } },
      async selectModel() { counts.selection++; throw new Error('read-only control test must not select a model') }
    })
    await ctx.plugin(Remote).await()
    sessionScope = ctx.extend()
    provider.provide('sessions', {
      list: store.createSnapshotStore({ current: 'cold-session' }),
      scope: () => sessionScope,
      binding: () => ({ session: { projections: { faceOf(name) { assert.equal(name, 'modelSelection'); return projected } } } }),
      subagentAddress: () => undefined
    })
    provider.provide('slots', {
      inject(_name, fn) { return fn() },
      register(meta, component) { const key = meta.name + '|' + (meta.id || ''); assert.ok(!entries.has(key)); entries.set(key, { meta, component }); return () => entries.delete(key) }
    })
    const { ThemeRuntime } = native('dsh-client-ui-theme')
    const theme = new ThemeRuntime(ctx, { subscribe: preferences.subscribe, getSnapshot: preferences.getSnapshot, set(key, value) { preferences.set({ value: { ...preferences.getSnapshot().value, [key]: value } }) } })
    provider.provide('theme', theme)
    const { ModelDirectoryResolver } = native('dsh-client-ui-model-selection')
    const models = ctx.plugin(ModelDirectoryResolver, { blockReason: () => 'offline unroutable' }); await models.await()
    provider.provide('tavernFonts', { list: async () => [], get() {}, ensureLoaded: async () => {}, subscribe: () => () => {} })
    window.forkFonts = { dispose() { counts.fontDisposals++ } }
    provider.provide('tavernView', { getSessionId: () => 'cold-session', getMode: () => mode, subscribe(_id, fn) { subscribers.add(fn); return () => subscribers.delete(fn) } })
    provider.provide('tavernPresentation', {
      getFontPicker: () => () => React.createElement('span', { 'data-font-picker': '' }), getHelpTip: () => () => null, getSpinner: () => () => null,
      getSurfaceStyles: () => ({ context: 'chat-light', css: '' }), async getModelPricing() { counts.pricing++; return { available: false } }
    })
    let activeTab = { id: 'guide-tab', kind: 'guide' }
    const guides = [{ kind: 'dsh-tavern:status', title: 'Status' }]
    const openTab = kind => { activeTab = { id: 'next-tab', kind } }
    provider.provide('sidebarRight', { active: () => activeTab, isExpanded: () => true, openTab })
    provider.provide('sidebarRightTabs', { guide: () => guides, subscribe: () => () => {} })
    const plugin = load(body)
    ui = ctx.plugin(plugin); await ui.await()
    assert.ok(entries.size > 0, 'UI must activate with required services')
    // This is a COLD directory: native model selection has not populated its
    // shared cache. A warm directory would hide the missing remote.session.
    await render('conversation.input.model')
    await click('.fork-model-trigger')
    assert.ok(document.querySelector('.fork-model-panel').matches(':popover-open'))
    assert.match(document.querySelector('.fork-model-trigger').textContent, /Offline Model/)
    await click('.fork-model-name')
    assert.equal(document.querySelectorAll('.fork-model-panel [role="option"]').length, 1)
    await escape(); await escape()
    assert.equal(document.querySelector('.fork-model-panel').matches(':popover-open'), false)
    const projectionReads = new Set(), pressure = { projectedTokens: 25, contextWindow: 100 }
    await render('conversation.input.right', 'dsh-fork-composer-metrics', {
      sessionId: 'cold-session', useProjection(name) { projectionReads.add(name); return name === 'contextPressure' ? pressure : undefined }, useSession: read => read({ running: false }), useChat: read => read({})
    })
    await click('.fork-metrics-trigger')
    assert.ok(document.querySelector('.fork-metrics-popover'))
    assert.equal(counts.pricing, 1)
    assert.deepEqual([...projectionReads].sort(), ['contextBreakdown', 'contextPressure', 'sessionStats', 'tokenUsage'])
    await escape(); assert.ok(document.querySelector('.fork-metrics-popover') === null)
    await render('tavern.sidebar.chrome', 'theme-menu')
    await click('.dsh-fork-theme-trigger'); assert.ok(document.querySelector('.dsh-fork-theme-menu'))
    await click('[data-builtin="dark"]')
    assert.equal(theme.getTheme().preference, 'dark')
    assert.equal(preferences.getSnapshot().value.preference, 'dark')
    await render('settings.dreamSkin.item', 'fork-appearance-modes')
    await render('settings.dreamSkin.item', 'fork-reading-font')
    assert.ok(document.querySelector('[data-font-picker]'))
    await render('settings.tavern.appearance', 'ui-size')
    await settle(async () => { const select = document.querySelector('select'); select.value = 'comfortable'; select.dispatchEvent(new window.Event('change', { bubbles: true })) })
    assert.equal(document.body.dataset.forkUiSize, 'comfortable')
    await render('sidebar.right.tab.guide', 'dsh-tavern:launcher-grid', { useTabInfo: () => ({ tab: { ...activeTab, actions: { openTab } } }) })
    await click('.fork-guide-tile'); assert.equal(activeTab.kind, 'dsh-tavern:status')
    await settle(async () => { window.dispatchEvent(new window.MouseEvent('mouseup', { button: 3, cancelable: true })) })
    assert.equal(activeTab.kind, 'guide')
    for (const [deltaY, expected] of [[-100, 18], [100, 17]]) {
      const event = new window.WheelEvent('wheel', { ctrlKey: true, deltaY, bubbles: true, cancelable: true })
      await settle(async () => { document.dispatchEvent(event); await new Promise(r => setTimeout(r, 35)) })
      assert.equal(event.defaultPrevented, true)
      assert.equal(theme.getTheme().fontSize, expected)
    }
    await render('conversation.session.header.utilities', 'dsh-fork-session-marker', { sessionId: 'cold-session' })
    assert.equal(document.querySelector('main').dataset.dshForkSession, 'play')
    await settle(async () => { mode = 'card'; for (const fn of subscribers) fn() })
    assert.equal(document.querySelector('main').dataset.dshForkSession, 'card')
    assert.equal(counts.catalog, 1)
    assert.equal(counts.selection, 0)
    assert.deepEqual(errors, [])
  } finally {
    try {
      await settle(async () => { for (const root of roots) root.unmount() })
      await ui?.dispose()
      assert.equal(entries.size, 0)
      assert.equal(subscribers.size, 0)
      assert.equal(document.querySelector('main').hasAttribute('data-dsh-fork-session'), false)
      assert.ok(document.querySelector('.dsh-fork-theme-dock') === null)
      assert.equal(counts.fontDisposals, 0)
      const wheel = new window.WheelEvent('wheel', { ctrlKey: true, deltaY: -100, cancelable: true })
      document.dispatchEvent(wheel); assert.equal(wheel.defaultPrevented, false)
    } finally {
      try { await ctx.fiber.dispose() } finally {
        window.close()
        for (const [key, descriptor] of globals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key] }
      }
    }
  }
}
