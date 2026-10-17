import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve, relative, dirname } from 'node:path'
import { JSDOM } from 'jsdom'
import { Context } from '@deepseek-ai/cordis'
import React from 'react'
import * as ReactDOM from 'react-dom'
import surfaces from '../tavern-plugin/src/client/fork-surfaces.cjs'
import { exerciseShell } from './fixtures/tavern-ui-cordis.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const packagePath = 'tavern-plugin/packages/dsh-tavern-ui/'
const read = name => readFileSync(resolve(root, name), 'utf8')
const publicRequire = createRequire(resolve(root, packagePath, 'package.json'))
const source = readFileSync(process.env.DSH_UI_CLIENT_UNDER_TEST || publicRequire.resolve('dsh-tavern-ui/client'), 'utf8')

function load(window, body = source) {
  let plugin
  window.__ModuleLoader__ = { load({ factory }) { plugin = factory(name => name === 'react' ? React : name === 'react-dom' ? ReactDOM : {}) } }
  window.eval(body)
  assert.equal(typeof plugin.apply, 'function', 'actual factory must return apply')
  return plugin
}

test('native services exercise every shell control under real Cordis consumer guards', { skip: !process.env.DSH_BOOT_MODULE }, async () => {
  await exerciseShell(source)
})

test('cold native directory rejects a consumer without remote.session even when the provider exists', { skip: !process.env.DSH_BOOT_MODULE }, async () => {
  await assert.rejects(exerciseShell(source.replace('"remote.session", ', '')), /cannot get property "remote\.session" without inject/)
})

test('both actual client factories return apply without replacing module.exports', () => {
  const dom = new JSDOM('<body></body>', { url: 'http://offline.test', runScripts: 'outside-only', pretendToBeVisual: true })
  try {
    load(dom.window)
    load(dom.window, read('tavern-plugin/lib/client.js'))
  } finally { dom.window.close() }
})

test('public shell entry uses real Cordis inject guards and unloads without disposing Tavern fonts', async () => {
  const dom = new JSDOM('<head><style data-plugin-css="dsh-tavern-plugin/features.css"></style></head><body></body>', { url: 'http://offline.test', runScripts: 'outside-only', pretendToBeVisual: true })
  const { window } = dom
  const caption = '\uff08\u7ea6 11725 tokens\uff09'
  const compaction = window.document.createElement('div')
  compaction.dataset.chatFlowKind = 'compaction'
  compaction.innerHTML = '<span class="_compactionSummary">' + caption + '</span>'
  window.document.body.appendChild(compaction)
  window.matchMedia = () => ({ addEventListener() {}, removeEventListener() {} })
  const ctx = new Context(), entries = new Map(), font = Object.freeze({ id: 'stage-face' })
  let provider
  await ctx.plugin({ name: 'offline-services', apply(scope) { provider = scope } }).await()
  let fontDisposals = 0
  const fonts = { list: async () => [font], get: () => font, ensureLoaded: async () => font, subscribe: () => () => {} }
  window.forkFonts = { dispose: () => fontDisposals++ }
  provider.provide('tavernFonts', fonts)
  provider.provide('tavernView', { getMode: () => 'play', getSessionId: () => 'session', subscribe: () => () => {} })
  provider.provide('tavernPresentation', {
    getFontPicker: () => () => null, getHelpTip: () => () => null, getSpinner: () => () => null,
    getSurfaceStyles: () => ({ context: 'chat-light', css: surfaces.css() }), getModelPricing: async () => ({ available: false })
  })
  provider.provide('slots', {
    inject(_name, fn) { return fn() },
    register(meta, component) {
      const key = [meta.name, meta.id || '', meta.priority || 0].join('|')
      assert.ok(!entries.has(key), 'duplicate slot ' + key)
      entries.set(key, { meta, component })
      return () => entries.delete(key)
    }
  })
  provider.provide('sessions', {})
  provider.provide('theme', { getTheme: () => ({ fontSize: 17 }), setFontSize() {} })
  provider.provide('modelDirectories', {})
  provider.provide('remote', {})
  let releaseRemote = provider.provide('remote.session', {})
  try {
    const plugin = load(window)
    assert.ok(plugin.inject.includes('tavernFonts'))
    for (let cycle = 0; cycle < 2; cycle++) {
      const fiber = ctx.plugin(plugin)
      await fiber.await()
      assert.ok(entries.size >= 8, 'shell actually activated')
      assert.equal(window.document.querySelectorAll('[data-plugin-css="dsh-tavern-ui/shell.css"]').length, 1)
      assert.equal(window.document.body.dataset.forkUiSize, 'standard')
      assert.ok(compaction.textContent.includes('11,725'))
      assert.equal(await ctx.get('tavernFonts').ensureLoaded('stage-face'), font)
      await releaseRemote()
      await fiber.await()
      assert.equal(entries.size, 0, 'losing required remote.session suspends UI')
      releaseRemote = provider.provide('remote.session', {})
      await fiber.await()
      assert.ok(entries.size >= 8, 'restoring remote.session reactivates UI')
      await fiber.dispose()
      assert.equal(entries.size, 0)
      assert.equal(compaction.textContent, caption)
      assert.equal(window.document.querySelectorAll('[data-plugin-css="dsh-tavern-ui/shell.css"], [data-fork-surfaces]').length, 0)
      assert.equal(window.document.body.hasAttribute('data-fork-ui-size'), false)
      assert.equal(window.document.body.hasAttribute('data-fk-context'), false)
      assert.equal(ctx.get('tavernFonts'), fonts)
      assert.equal(fontDisposals, 0)
    }
  } finally { await ctx.fiber.dispose(); window.close() }
})

test('new package consumers only use declared public entries, never its source includes', () => {
  const manifest = JSON.parse(read(packagePath + 'package.json'))
  const allowed = new Set(Object.values(manifest.exports).map(value => resolve(root, packagePath, value)))
  function walk(dir) {
    return readdirSync(dir, { withFileTypes: true }).filter(e => !['node_modules', '.git', 'tests'].includes(e.name)).flatMap(e => e.isDirectory() ? walk(resolve(dir, e.name)) : [resolve(dir, e.name)])
  }
  for (const file of [...walk(resolve(root, 'tavern-plugin')), ...walk(resolve(root, 'bin'))]) {
    if (!/\.[cm]?js$/.test(file) || file.startsWith(resolve(root, packagePath))) continue
    for (const [, spec] of readFileSync(file, 'utf8').matchAll(/(?:from\s*|import\s*\(|require\s*\()\s*['"]([^'"]+)['"]/g)) {
      const target = spec.startsWith('.') ? resolve(dirname(file), spec) : null
      if (target?.startsWith(resolve(root, packagePath))) assert.ok(allowed.has(target), relative(root, file) + ': ' + spec)
      if (spec.startsWith('dsh-tavern-ui/')) assert.ok(manifest.exports['./' + spec.slice('dsh-tavern-ui/'.length)], spec)
    }
    assert.doesNotMatch(readFileSync(file, 'utf8'), /@include[^\n]*dsh-tavern-ui\/src\//)
  }
  const dom = new JSDOM('<body></body>', { url: 'http://offline.test', runScripts: 'outside-only' })
  try {
    const declared = new Set(load(dom.window).inject)
    const lifecycle = new Set(['effect', 'on', 'inject', 'dispose'])
    for (const name of readdirSync(resolve(root, packagePath, 'src')).filter(name => name.endsWith('.js'))) {
      for (const [, service] of read(packagePath + 'src/' + name).replace(/^\s*\/\/.*$/gm, '').matchAll(/\b(?:ctx|scope)\.([a-zA-Z]+)/g)) {
        assert.ok(lifecycle.has(service) || declared.has(service), name + ': undeclared service ' + service)
      }
    }
    assert.ok(declared.has('remote.session'))
    assert.match(read(packagePath + 'src/fork-sidebar-nav.js'), /ctx\.inject\(\["sidebarRight", "sidebarRightTabs"\]/)
    assert.equal(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-model-selection'), true)
  } finally { dom.window.close() }
  assert.equal(JSON.parse(read('package.json')).devDependencies['dsh-tavern-ui'], undefined)
  assert.match(read('tavern-plugin/cordis.patch.yml'), /id: tavern-ui\s+name: \.\/packages\/dsh-tavern-ui\/lib\/index.js/)
  assert.match(read('plugin.patch.yml'), /id: tavern-ui\s+name: .*dsh-tavern-ui\/lib\/index.js/)
})


test('Tavern publishes one real font instance; UI has no preference or disposal authority', async () => {
  const dom = new JSDOM('<body><main class="fork-gal-stage" data-theme="gothic"></main></body>', { url: 'http://offline.test', runScripts: 'outside-only', pretendToBeVisual: true })
  const { window } = dom
  const ctx = new Context()
  ctx.provide('theme', { getTheme: () => ({ active: { id: 'light' } }) })
  ctx.provide('sessions', { list: { getSnapshot: () => ({ current: 's' }) } })
  window.eval('window.installFontOwner = function(ctx) { const rpc = async () => ({fonts:[{id:"neo-zhisong-screen",family:"Stage Test Font",files:[{format:"woff2",weight:400,style:"normal",url:"/api/dsh-tavern/fonts/neo-zhisong-screen/test.woff2"}]}]});' + read('tavern-plugin/src/client/fork-surfaces.cjs') + '\n' + read('tavern-plugin/packages/dsh-presentation-protocol/src/stage-skin.cjs') + '\n' + read('tavern-plugin/src/client/fork-fonts.js') + '\n' + read('tavern-plugin/src/client/tavern-presentation.js') + ';ctx.effect(()=>installForkFonts(ctx));installTavernPresentation(ctx);}')
  try {
    const owner = ctx.plugin({ inject: ['theme', 'sessions'], apply: window.installFontOwner })
    await owner.await()
    const service = ctx.get('tavernFonts'), instance = window.forkFonts
    assert.deepEqual(Object.keys(service).sort(), ['ensureLoaded', 'get', 'list', 'subscribe'])
    await service.list(); await service.ensureLoaded('neo-zhisong-screen')
    assert.equal(service.get('neo-zhisong-screen').family, 'Stage Test Font')
    assert.equal(window.document.querySelectorAll('[data-fork-font-faces]').length, 1)
    assert.match(window.document.querySelector('main').style.getPropertyValue('--gal-base-font'), /Stage Test Font/)
    assert.equal(ctx.get('tavernView').getSessionId(), 's')
    assert.equal(service.dispose, undefined)
    assert.equal(window.forkFonts, instance)
    await owner.dispose()
    assert.equal(ctx.get('tavernFonts'), undefined)
    assert.equal(window.forkFonts, undefined)
    assert.equal(window.document.querySelectorAll('[data-fork-font-faces]').length, 0)
  } finally { await ctx.fiber.dispose(); window.close() }
})

test('native DSH discovers the path-loaded shell client without a dependency link', { skip: !process.env.DSH_BOOT_MODULE }, async () => {
  const boot = await import(pathToFileURL(process.env.DSH_BOOT_MODULE).href)
  const modulesPath = resolve(dirname(process.env.DSH_BOOT_MODULE), '../../dsh-client-modules/lib/index.js')
  const { ClientModuleRegistry } = await import(pathToFileURL(modulesPath).href)
  const patch = resolve(root, 'tavern-plugin/cordis.patch.yml')
  const entries = boot.composeEntries([boot.loadOverlayPatches('test', patch)])
  const rows = entries.filter(entry => entry.id === 'tavern-ui')
  assert.equal(rows.length, 1)
  const registry = Object.create(ClientModuleRegistry.prototype)
  registry.ctx = { loader: {} }
  const found = registry.locatePkgJson(rows[0].name, pathToFileURL(patch).href)
  assert.equal(found.packageName, 'dsh-tavern-ui')
  assert.equal(found.path, resolve(root, packagePath, 'package.json'))
  const manifest = JSON.parse(readFileSync(found.path, 'utf8'))
  assert.equal(resolve(dirname(found.path), manifest.exports['./client']), publicRequire.resolve('dsh-tavern-ui/client'))
  const host = await import(pathToFileURL(resolve(dirname(found.path), manifest.exports['.'])).href)
  assert.equal(typeof host.apply, 'function')
  assert.deepEqual(host.inject, [], 'browser services must not block the stateless Host entry')
})
