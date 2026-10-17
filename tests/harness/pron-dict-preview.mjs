// private fork (docs/fork/reading-dictionary.md): offline preview of the global 读音词典 in the real 配音 page — the built
// dsh-tts client (lib/client.js) with the Tavern factory's ReadingsEditor provided as `ttsReadingsEditor`, every RPC mocked
// in the page (5,000 readings, two presets). Real Chromium clicks and keys; Event Timing + paint-after-input timings.
// No DSH process, no network, no synthesis. Usage: node tests/harness/pron-dict-preview.mjs [outDir]
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { browserReactScript } from '../fixtures/browser-react.mjs'
import { forkThemeCss } from '../helpers/fork-theme-css.mjs'
import { stageSource, THEMES } from './card-centric-stage.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const outDir = process.argv[2] || path.join(root, '.tmp/pron-dict-preview')
const COUNT = Number(process.env.PRON_DICT_COUNT || 5000)

// In-page control RPC: the same contract as dsh-tts (readingPresets / readingPreset / editReading / …), inference simplified.
function pageMock(count) {
  const infer = reading => /[\u3040-\u30ff]/.test(reading) ? ['ja', []] : /\p{Script=Han}/u.test(reading) ? ['zh', []] : ['en', ['LATIN_ASSUMED_EN']]
  const norm = input => { const forms = (Array.isArray(input.forms) ? input.forms : [input.forms]).flatMap(f => f.split(/[,，、]/)).map(f => f.trim()).filter(Boolean)
    if (!forms.length || !String(input.reading || '').trim()) throw Object.assign(new Error('INVALID_READINGS'), {code:'INVALID_READINGS'})
    const [language, warnings] = infer(input.reading.trim()), o = input.languageOverride
    return {forms, reading:input.reading.trim(), inferredLanguage:language, warnings, language:o || language, ...(o ? {languageOverride:o} : {})} }
  const kana = 'あいうえおかきくけこさしすせそたちつてとなにぬねの'
  const big = Array.from({length:count}, (_, i) => norm({forms:'語' + i + (i % 7 === 0 ? '，词' + i : ''), reading:kana[i % 25] + kana[(i * 7) % 25] + i}))
  if (count > 5) { big[3] = norm({forms:'見滝原，见泷原', reading:'みたきはら'}); big[4] = norm({forms:'QB', reading:'kyubei'}); big[5] = norm({forms:'上条', reading:'カミジョウ'}) }
  const state = window.__readings = {active:'default', presets:[{id:'default', name:'默认', revision:0, entries:big}, {id:'p-anime', name:'动画专名', revision:0, entries:[norm({forms:'鹿目', reading:'かなめ'})]}], calls:[]}
  const summary = () => ({active:state.active, presets:state.presets.map(p => ({id:p.id, name:p.name, count:p.entries.length, revision:p.revision}))})
  const find = id => state.presets.find(p => p.id === id) || (() => { throw Object.assign(new Error('PRESET_NOT_FOUND'), {code:'PRESET_NOT_FOUND'}) })()
  let seq = 0
  const methods = {
    readingPresets:() => summary(), readingPreset:a => { performance.mark('readings-data'); const p = find(a.id ?? state.active); return {id:p.id, name:p.name, revision:p.revision, entries:p.entries} },
    editReading:a => { const p = find(a.id); if (a.expectedRevision !== p.revision) throw new Error('REVISION_CONFLICT')
      const entries = p.entries.slice(), entry = a.op === 'remove' ? undefined : norm(a.entry)
      if (a.op === 'add') entries.push(entry); else if (a.op === 'set') entries[a.index] = entry; else entries.splice(a.index, 1)
      p.entries = entries; p.revision++; return {id:p.id, revision:p.revision, op:a.op, index:a.op === 'add' ? entries.length - 1 : a.index, count:entries.length, ...(entry ? {entry} : {})} },
    createReadingPreset:a => { const id = 'p-' + (++seq); state.presets.push({id, name:a.name, revision:0, entries:a.from ? find(a.from).entries : []}); state.active = id; return {...summary(), id} },
    renameReadingPreset:a => { find(a.id).name = a.name; return summary() },
    deleteReadingPreset:a => { state.presets = state.presets.filter(p => p.id !== a.id); if (state.active === a.id) state.active = state.presets[0].id; return summary() },
    setActiveReadingPreset:a => { find(a.id); state.active = a.id; return summary() },
    exportReadingPreset:a => { const p = find(a.id); return {version:1, kind:'dsh-tts-readings', name:p.name, entries:p.entries.map(e => ({forms:e.forms, reading:e.reading}))} },
    services:() => ({configured:[{id:'qwen', kind:'qwen', label:'通义千问', config:{region:'cn'}, revision:'r', secrets:{key:{configured:true, writable:true}}}], running:[]}),
    providerKinds:() => [], voicePresets:() => [], cache:() => ({bytes:38 * 1024 ** 2, count:412, maxBytes:1024 ** 3, maxAgeDays:30}),
  }
  const ok = value => ({ok:true, json:async () => JSON.parse(JSON.stringify(value))})
  window.fetch = async (url, options = {}) => {
    const {method, args} = JSON.parse(options.body || '{}'); state.calls.push({method, args, bytes:(options.body || '').length})
    try { return ok(methods[method] ? methods[method](args || {}) : {}) } catch (e) { return {ok:false, json:async () => ({error:e.code || e.message})} }
  }
  window.EventSource = class { constructor() { window.__events = this; setTimeout(() => this.onmessage?.({data:JSON.stringify({enabled:true})}), 0) } close() {} }
}

// Mount: the Tavern factory provides the editor, the real dsh-tts bundle registers the 配音 tab; the page opens it advanced.
function pageBoot() {
  const views = createForkAssetPackUI(React, {VoicePicker:() => null, AvatarImage:p => React.createElement('img', p), emotions:{moods:[], max:8, upsert:list => list}})
  const services = new Map(), tabs = new Map()
  services.set('ttsReadingsEditor', {render:props => React.createElement(views.ReadingsEditor, props)})
  services.set('betterSidebar', {registerTab(tab) { tabs.set(tab.id, tab); return () => tabs.delete(tab.id) }, openTab() {}})
  const ctx = {provide(key, value) { services.set(key, value); return () => services.delete(key) }, get:key => services.get(key), effect(fn) { return fn() },
    inject(keys, fn) { if (keys.every(key => services.has(key))) fn(ctx) }, slots:{inject(_, fn) { fn() }, register() { return () => {} }}}
  for (const m of window.__modules) m.apply(ctx)
  localStorage.setItem('dsh-tts:panel-mode', 'advanced')
  window.__open = () => { performance.mark('open-start'); window.__root = ReactDOMClient.createRoot(document.getElementById('host')); window.__root.render(React.createElement(tabs.get('dsh-tts:voice').component)) }
}

// Time from an input event to the next frame (rAF + a macrotask ≈ after paint), for keydown / input / click on the page.
function pageTimers() {
  window.__timings = []
  const track = type => document.addEventListener(type, e => { const start = e.timeStamp
    requestAnimationFrame(() => setTimeout(() => window.__timings.push({type, target:e.target?.getAttribute?.('aria-label') || e.target?.className || '', ms:performance.now() - start}), 0)) }, true)
  for (const type of ['keydown', 'input', 'click']) track(type)
  window.__events = []
  try { new PerformanceObserver(list => { for (const e of list.getEntries()) window.__events.push({name:e.name, duration:e.duration}) }).observe({type:'event', durationThreshold:16, buffered:true}) } catch {}
}

export async function run() {
  const { chromium } = await import('playwright')
  const { source } = await stageSource(), css = await forkThemeCss(), react = await browserReactScript()
  const tts = await readFile(path.join(root, 'tavern-plugin/packages/dsh-tts/lib/client.js'), 'utf8')
  await mkdir(outDir, { recursive: true })
  const browser = await chromium.launch({ channel:'chrome', headless:true })
  const shots = [], errors = [], perf = {}
  try {
    for (const [theme, tokens] of Object.entries(THEMES)) for (const [size, viewport] of [['desktop', {width:1280, height:1000}], ['375', {width:375, height:812}]]) {
      const page = await browser.newPage({ viewport, deviceScaleFactor:size === '375' ? 2 : 1 })
      page.on('pageerror', e => errors.push(theme + '/' + size + ': ' + e.message))
      await page.route('http://tts.test/**', route => route.fulfill({contentType:'text/html; charset=utf-8', body:'<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"></head><body><div class="frame"><main class="chat"></main><aside id="host"></aside></div></body></html>'}))
      await page.goto('http://tts.test/')
      await page.addStyleTag({ content:css + `
        html, body { margin: 0; } body { ${tokens} background: var(--page); font-family: "Microsoft YaHei UI", "PingFang SC", sans-serif;
          --dsw-alias-label-primary: var(--fork-ink); --dsw-alias-label-secondary: var(--fork-ink-2); --dsw-alias-label-tertiary: var(--fork-ink-3);
          --dsw-alias-border-l2: var(--fork-hairline); --dsw-alias-border-l3: var(--fork-hairline); --dsw-alias-brand-primary: var(--fork-accent);
          --dsw-alias-bg-layer-1: var(--fork-surface); --dsw-alias-bg-base: var(--fork-surface); --dsw-alias-interactive-bg-hover: var(--fork-hover); }
        .frame { display: flex; min-height: 100vh; } .chat { flex: 1; background: var(--page); }
        #host { width: ${size === '375' ? '100%' : '640px'}; flex: none; background: var(--fork-surface); border-left: 1px solid var(--fork-hairline); }
        ${size === '375' ? '.chat { display: none; }' : ''}` })
      await page.evaluate(context => { document.body.dataset.fkContext = context }, 'chat-' + theme)
      await page.addScriptTag({ content:react + ';window.React=modules.react;window.ReactDOMClient=modules["react-dom/client"];window.__modules=[];window.__ModuleLoader__={load(m){window.__modules.push(m.factory(()=>window.React))}};' })
      await page.evaluate(pageMock, COUNT)
      await page.addScriptTag({ content:source }); await page.addScriptTag({ content:tts })
      await page.evaluate(pageBoot); await page.evaluate(pageTimers)
      const t0 = Date.now(), profile = process.env.PRON_DICT_PROFILE && theme === 'light' && size === 'desktop' && await page.context().newCDPSession(page)
      if (profile) { await profile.send('Profiler.enable'); await profile.send('Profiler.setSamplingInterval', {interval:100}); await profile.send('Profiler.start') }
      // Open (cold: first mount in a fresh page) measured in the page: mount → the first frame after the rows exist. No
      // Playwright locator polls during the measurement (they force layout and would be counted).
      const openOnce = () => page.evaluate(() => new Promise(resolve => {
        if (window.__root) window.__root.unmount(); performance.clearMarks(); window.__open()
        const wait = () => { const row = document.querySelector('.fork-readings .ap-readings-track .ap-readings-row'); if (!row) return requestAnimationFrame(wait)
          requestAnimationFrame(() => setTimeout(() => { const now = performance.now(), m = n => performance.getEntriesByName(n)[0]?.startTime
            resolve({ms:now - m('open-start'), fromData:now - m('readings-data'), rows:document.querySelectorAll('.fork-readings .ap-readings-track .ap-readings-row').length,
              total:document.querySelector('.fork-readings .ap-readings').getAttribute('aria-rowcount')}) }, 0)) }
        wait() }))
      const open = await openOnce()
      if (profile) await writeFile(path.join(outDir, 'open.cpuprofile'), JSON.stringify((await profile.send('Profiler.stop')).profile))
      // Warm reopen (same page): what a user switching back to the 配音 tab sees.
      open.reopen = []
      for (let i = 0; i < 3; i++) open.reopen.push(await openOnce())
      if (process.env.PRON_DICT_OPEN_ONLY) { if (theme === 'light' && size === 'desktop') perf.open = open; await page.close(); continue }
      const section = page.locator('.fork-readings')
      await section.scrollIntoViewIfNeeded()
      const shot = async name => { const file = path.join(outDir, `after-${name}-${theme}-${size}.png`); await page.waitForTimeout(200); await section.screenshot({ path:file }); shots.push(file) }
      await shot('01-list')
      // Search: real typing, one key at a time.
      await page.evaluate(() => { window.__timings.length = 0; window.__events.length = 0 })
      const search = page.getByRole('searchbox', { name:'搜索读音' })
      await search.click(); await page.keyboard.type('4998', { delay:60 }); await page.waitForTimeout(150)
      const typing = await page.evaluate(() => ({timings:window.__timings.filter(t => t.type !== 'click'), events:window.__events.slice()}))
      await shot('02-search')
      // Edit a row: real click on the 读音, type, Enter (one editReading call with one row).
      await page.evaluate(() => { window.__timings.length = 0; window.__events.length = 0; window.__readings.calls.length = 0 })
      await page.getByLabel(/^读音 語4998/).click(); await page.keyboard.press('Control+A'); await page.keyboard.type('ごよん', { delay:60 }); await page.keyboard.press('Enter')
      await page.waitForFunction(() => window.__readings.calls.some(c => c.method === 'editReading'))
      await page.waitForTimeout(150)
      const editing = await page.evaluate(() => ({timings:window.__timings.slice(), events:window.__events.slice(), calls:window.__readings.calls.map(c => ({method:c.method, bytes:c.bytes}))}))
      await shot('03-edited')
      await search.fill(''); await page.waitForTimeout(100)
      // Scroll the window: rows stay mounted only in view.
      await page.locator('.fork-readings .ap-readings').evaluate(el => { el.scrollTop = 36 * 2500 }); await page.waitForTimeout(150)
      const mounted = await page.locator('.fork-readings .ap-readings-track .ap-readings-row').count()
      await shot('04-scrolled')
      // Preset menu ⋯ and the add line.
      await page.getByRole('button', { name:'预设操作' }).click(); await page.getByRole('menuitem', { name:'新建' }).waitFor(); await page.waitForTimeout(100)
      const menuFile = path.join(outDir, `after-05-menu-${theme}-${size}.png`); await page.screenshot({ path:menuFile }); shots.push(menuFile)
      await page.keyboard.press('Escape')
      await page.getByRole('button', { name:'预设：默认', exact:true }).click(); await page.getByRole('menuitemradio', { name:/动画专名/ }).click()
      await page.getByLabel('写法 鹿目', { exact:true }).waitFor()
      await page.getByRole('button', { name:'添加读音' }).click(); await page.keyboard.type('見滝原'); await page.keyboard.press('Enter'); await page.keyboard.type('みたきはら'); await page.keyboard.press('Enter')
      await page.getByLabel('写法 見滝原', { exact:true }).waitFor()
      await shot('06-other-preset-added')
      if (theme === 'light' && size === 'desktop') Object.assign(perf, {open:{...open, wallMs:Date.now() - t0}, typing, editing, mountedAfterScroll:mounted})
      await page.close()
    }
  } finally { await browser.close() }
  await writeFile(path.join(outDir, 'perf.json'), JSON.stringify({count:COUNT, ...perf, errors}, null, 2))
  if (process.env.PRON_DICT_OPEN_ONLY) return console.log(JSON.stringify(perf.open))
  console.log(JSON.stringify({shots:shots.length, errors, open:perf.open, typingMax:Math.max(...perf.typing.timings.map(t => t.ms)), editMax:Math.max(...perf.editing.timings.map(t => t.ms)), events:[...perf.typing.events, ...perf.editing.events], calls:perf.editing.calls, mounted:perf.mountedAfterScroll}, null, 1))
  if (errors.length) process.exitCode = 1
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) await run()
