// private fork (rename-mod, owner 2026-10): the user-facing widget term is 模组 (display text only; ids stay widgets).
// private fork: offline harness for the widgets v3 front-end — 舞台设置 keeps only the 模组 switch; a widget's 素材库 entry
// shows the pack-level part (启用, 共享默认) then this card's part (本卡 switch, settings with field feedback chips, 恢复默认), card-export dependency warning and the 导入卡片 sheet's 模组 question.
// Reuses the 舞台设置 harness mock (no live data, no network). Usage: node tests/harness/widgets-v3-settings.mjs [outDir]
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { browserReactScript } from '../fixtures/browser-react.mjs'
import { forkThemeCss } from '../helpers/fork-theme-css.mjs'
import { stageSource, pageSetup, THEMES } from './card-centric-stage.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const outDir = process.argv[2] || path.join(root, '.tmp/widgets-v3-settings')
const phoneDocument = JSON.parse(await (await import('node:fs/promises')).readFile(path.join(root, 'tests/fixtures/source-widget/widget.json'), 'utf8'))

// Adds a phone pack (bound), a global-enabled widget pack and a stopped item on top of the 舞台设置 mock.
function widgetSetup(document) {
  const PHONE = '55555555-5555-4555-8555-555555555555', TOOLS = '66666666-6666-4666-8666-666666666666'
  const paper = (() => { const canvas = window.document.createElement('canvas'); canvas.width = 300; canvas.height = 400; const g = canvas.getContext('2d'); const grad = g.createLinearGradient(0, 0, 300, 400); grad.addColorStop(0, '#f6d5c6'); grad.addColorStop(1, '#9cc3e6'); g.fillStyle = grad; g.fillRect(0, 0, 300, 400); g.fillStyle = 'rgba(255,255,255,.5)'; for (let i = 0; i < 40; i++) { g.beginPath(); g.arc((i * 73) % 300, (i * 131) % 400, 3, 0, 7); g.fill() } return canvas.toDataURL() })()
  const night = (() => { const canvas = window.document.createElement('canvas'); canvas.width = 300; canvas.height = 400; const g = canvas.getContext('2d'); const grad = g.createLinearGradient(0, 0, 0, 400); grad.addColorStop(0, '#1d2b4f'); grad.addColorStop(1, '#5d4a7a'); g.fillStyle = grad; g.fillRect(0, 0, 300, 400); return canvas.toDataURL() })()
  const media = {hpaper: paper, hnight: night}
  const phone = {revision: 'p1', manifest: {id: PHONE, name: '通用模组', figures: [], blobs: {}, assets: [
    {kind: 'widgets', id: 'phone', name: '手机', enabled: true, recall: {mode: 'constant', keywords: []}, directorNote: '', settingsDefaults: {}},
    {kind: 'backgrounds', id: 'paper', name: '晴空信纸', enabled: true, recall: {mode: 'keyword', keywords: []}, directorNote: '', media: 'hpaper'},
    {kind: 'backgrounds', id: 'night', name: '夜色', enabled: true, recall: {mode: 'keyword', keywords: []}, directorNote: '', media: 'hnight'}]},
    figures: {}, sprites: {}, widgets: {phone: document}}
  const tools = {revision: 't1', manifest: {id: TOOLS, name: '社团模组', figures: [], blobs: {}, assets: [
    {kind: 'widgets', id: 'countdown', name: '倒计时', enabled: true, recall: {mode: 'keyword', keywords: []}, directorNote: ''},
    {kind: 'widgets', id: 'letter', name: '信笺', enabled: false, recall: {mode: 'keyword', keywords: []}, directorNote: ''}]},
    figures: {}, sprites: {}, widgets: {countdown: {format: 'dsh.widget/2'}, letter: {format: 'dsh.widget/2'}}}
  const service = window.binding.service, rpc = window.binding.rpc
  const extra = [phone, tools]
  service.listPackSummaries = (list => async () => [...await list(), ...JSON.parse(JSON.stringify(extra))])(service.listPackSummaries)
  service.getPackSnapshot = (get => async args => extra.find(p => p.manifest.id === args.packId) ? JSON.parse(JSON.stringify(extra.find(p => p.manifest.id === args.packId))) : get(args))(service.getPackSnapshot)
  service.patchPack = async ({packId, patch}) => { const p = extra.find(x => x.manifest.id === packId); Object.assign(p.manifest, patch); p.revision += '+'; return {status: 'ok', snapshot: JSON.parse(JSON.stringify(p))} }
  window.binding.previewMedia = (preview => async args => media[args.hash] ? {url: media[args.hash], release() {}} : preview(args))(window.binding.previewMedia)
  window.binding.globalEnabledPackIds = [...window.binding.globalEnabledPackIds, TOOLS]
  let seeded = false
  window.scenario = (scenario => name => { seeded = false; scenario(name) })(window.scenario)
  window.binding.rpc = async (method, args) => {
    if (method === 'getAssetEngineSettings') { const value = await rpc(method, args); value.values.dimensions = {music: true, sfx: true, ambience: false, widgets: true}; return value }
    if (method === 'saveCardAssetBindings' && !seeded) seeded = true
    const value = await rpc(method, args)
    if ((method === 'getCardAssetBindings' || method === 'saveCardAssetBindings') && value.extension) {
      const ext = value.extension
      if (!seeded) { seeded = true; ext.stage = {...ext.stage, music: true, sfx: false}; ext.assetBindings.widgets = [{ref: {packId: PHONE, kind: 'widgets', assetId: 'phone'}, settings: {accentColor: '#d86b7c', wallpaper: {packId: PHONE, kind: 'backgrounds', assetId: 'paper'}, battery: 65}, bindings: {clockText: {source: 'mvu', path: '/世界/时间'}}}]; await rpc('saveCardAssetBindings', {patch: {stage: ext.stage, assetBindings: ext.assetBindings}}) }
      if (!ext.assetBindings.boundPackIds.includes(PHONE)) ext.assetBindings.boundPackIds.push(PHONE)
      window.lastCard = ext
    }
    return value
  }
  const signature = () => { const row = window.lastCard?.assetBindings?.widgets?.[0]; return JSON.stringify([{}, row?.settings || {}, row?.bindings || {}]) }
  window.forkStageSessions = {owner: {getWidgetContext: () => ({settingsFeedback: {items: [{ref: {packId: PHONE, kind: 'widgets', assetId: 'phone'}, get signature() { return signature() },
    fields: {clockText: {value: '16:40', source: 'binding', status: 'ready', bindingSource: 'mvu', snapshot: {kind: 'exact', turn: 12}},
      wallpaper: {value: null, source: 'card', status: 'image-pixels'}, battery: {value: 65, source: 'card', status: 'ready'}}}],
    theme: {theme: {accent: '#e9c58f', surface: '#24302f', border: '#5d6b66'}, corrected: ['muted']}}})}}
  // private fork (card import r3): the 导入卡片 sheet of a card using the phone 模组 (files and values only under 详情).
  const scriptRisk = [{packId: PHONE, packName: '通用模组', widgetId: 'phone', widgetName: '手机', path: 'bundles/phone/index.js'}, {packId: PHONE, packName: '通用模组', widgetId: 'phone', widgetName: '手机', path: 'bundles/phone/index.html'},
    {packId: PHONE, packName: '通用模组', widgetId: 'phone', widgetName: '手机', path: 'bundles/phone/widget.json', variables: {reads: [{id: 'clock', source: 'mvu', path: '/世界/时间', includesChildren: true}, {id: 'wallet', source: 'mvu', path: '/主角/钱包', includesChildren: true}],
      writes: [{id: 'buy', source: 'mvu', path: '/主角/钱包/余额', ops: ['delta', 'replace'], scope: 'exact', includesChildren: false}]}}]
  window.cardImportFixture = () => {
    const raw = {spec: 'chara_card_v2', data: {name: '手机日记', extensions: {dsh_tavern: {stage: {stage: true, widgets: true}, assetBindings: {boundPackIds: [PHONE]}}}}}
    Object.assign(window.binding.service, {inspectCardBundle: async () => ({inspectionId: 'card-phone', expectedRevision: 'c1', packs: [], raw, currentRaw: raw}),
      previewCardBundleDecisions: async () => ({mappings: [], scriptRisk, cardWidgetRisks: [{packId: PHONE, packName: '通用模组', widgetId: 'phone', widgetName: '手机'}], raw}),
      applyCardBundle: async args => args.cancel ? {status: 'cancelled'} : {status: 'committed', mappings: []}})
    return {binding: window.binding, path: 'cards/phone.json', file: {name: '手机日记.zip', arrayBuffer: async () => new ArrayBuffer(1)}, onDone() {}, onClose() {}}
  }
}

export async function run() {
  const { chromium } = await import('playwright')
  const { source, picker, playback } = await stageSource()
  const css = await forkThemeCss()
  await mkdir(outDir, { recursive: true })
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  const shots = [], errors = []
  try {
    for (const [theme, tokens] of Object.entries(THEMES)) for (const [size, viewport] of [['desktop', { width: 1280, height: 900 }], ['375', { width: 375, height: 740 }]]) {
      const page = await browser.newPage({ viewport, deviceScaleFactor: size === '375' ? 2 : 1, colorScheme: theme })
      page.on('pageerror', e => errors.push(theme + '/' + size + ': ' + e.message))
      await page.route('http://stage.test/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"></head><body><div class="host"><main class="chat"></main><aside id="panel"></aside></div></body></html>' }))
      await page.goto('http://stage.test/')
      await page.addStyleTag({ content: css + `
        html, body { margin: 0; } body { ${tokens} background: var(--page); font-family: "Microsoft YaHei UI", "PingFang SC", sans-serif; }
        .host { display: flex; min-height: 100vh; } .chat { flex: 1; background: var(--page); }
        #panel { width: ${size === '375' ? '100%' : '560px'}; flex: none; border-left: 1px solid var(--fork-hairline); }
        ${size === '375' ? '.chat { display: none; }' : ''}` })
      await page.evaluate(context => { document.body.dataset.fkContext = context }, 'chat-' + theme)
      await page.addScriptTag({ content: await browserReactScript() + ';window.React=modules.react;window.ReactDOM=modules["react-dom/client"];' + playback + source + picker })
      await page.evaluate(pageSetup)
      await page.evaluate(widgetSetup, phoneDocument)
      const shot = async (name, full) => { const file = path.join(outDir, `${name}-${theme}-${size}.png`); await page.waitForTimeout(300); await page.screenshot({ path: file, fullPage: !!full }); shots.push(file) }
      const start = async (mode = 'basic') => { await page.evaluate(m => { window.scenario('main'); window.show('w' + m + Math.random()) }, mode); await page.locator('.ap-stage-page').first().waitFor() }
      // private fork (widgets-in-library): 舞台设置 keeps only the 模组 switch (with › to the library's 模组 tab).
      await start(); await page.getByRole('switch', { name: '模组', exact: true }).waitFor()
      if (await page.locator('.ap-widget-list, .ap-widget-row').count()) errors.push('widget list still in 舞台设置')
      await page.getByRole('switch', { name: '模组', exact: true }).scrollIntoViewIfNeeded(); await shot('01-panel-widgets-switch')
      await start('advanced'); await page.evaluate(() => [...document.querySelectorAll('.ap-section-head h3')].find(n => n.textContent.startsWith('卡片导出'))?.scrollIntoView({ block: 'center' }))
      await shot('02-export-dependency')
      // private fork (settings-polish r4): 附带素材包 is a multi-select of toggle chips (✓ when on, no rings).
      await page.getByRole('checkbox', { name: '通用模组' }).click()
      if (await page.getByRole('checkbox', { name: '通用模组' }).getAttribute('aria-checked') !== 'true') errors.push('export chip does not toggle')
      if (await page.locator('.ap-pack-pick .ap-check-mark').count()) errors.push('export chip still has a ring')
      await shot('02b-export-picked')
      // The 素材库 with the card open: 通用模组 › 模组 › 手机 — pack-level 启用 + 共享默认, then 本卡 (switch + settings).
      const library = async (cardPath, packId) => {
        await page.evaluate(([cardPath, packId]) => window.root.render(React.createElement('div', { key: Math.random(), className: 'ap-ui ap-library' }, React.createElement(window.views.Home, { binding: window.binding, open: { packId, kind: 'widgets' }, onOpen() {}, sessionId: 's', cardPath }))), [cardPath, packId])
        await page.getByRole('dialog').waitFor()
        if (size === '375') { await page.locator('.ap-items .ap-item-main').first().click() }
        await page.locator('.ap-widget-settings').first().waitFor()
      }
      const pane = () => page.locator('.ap-pack-right')
      await library('cards/madoka.json', '55555555-5555-4555-8555-555555555555')
      await page.getByRole('switch', { name: '本卡启用 手机' }).waitFor(); await shot('03-entry-top')
      await page.locator('.ap-widget-card').evaluate(node => node.scrollIntoView({ block: 'start' })); await shot('04-entry-card')
      await pane().evaluate(node => { node.scrollTop = node.scrollHeight }); await shot('05-entry-card-bottom')
      if (await page.locator('.ap-widget-settings select, .ap-widget-settings input[type=color], .ap-widget-settings input[type=range], .ap-widget-settings input[type=checkbox]').count()) errors.push('native control in widget settings')
      if (/55555555|clockText|settingsSchema/.test(await page.getByRole('dialog').innerText())) errors.push('internal id in widget entry')
      if (size === '375' && await pane().evaluate(node => node.scrollWidth > node.clientWidth + 1)) errors.push('widget entry overflows at 375')
      // Order: pack-level (共享默认) before the card's part.
      if (!(await page.evaluate(() => { const [shared, card] = [...document.querySelectorAll('.ap-widget-scope')]; return shared?.dataset.scope === 'shared' && card?.dataset.scope === 'card' }))) errors.push('global → card order broken')
      await page.getByRole('switch', { name: '本卡启用 手机' }).click(); await page.waitForFunction(() => window.lastCard?.assetBindings?.widgets?.[0]?.enabled === false)
      await page.locator('.ap-widget-card').evaluate(node => node.scrollIntoView({ block: 'start' })); await shot('06-entry-card-off')
      await page.getByRole('button', { name: '恢复默认', exact: true }).click(); await page.waitForFunction(() => { const row = window.lastCard?.assetBindings?.widgets?.[0]; return row && row.enabled === false && !row.settings && !row.bindings })
      await page.locator('.ap-widget-card').evaluate(node => node.scrollIntoView({ block: 'start' })); await shot('07-entry-card-reset')
      // A widget without settings (global pack): head + 本卡 switch only.
      await library('cards/madoka.json', '66666666-6666-4666-8666-666666666666'); await page.locator('.ap-widget-card').evaluate(node => node.scrollIntoView({ block: 'start' })); await shot('08-entry-no-settings')
      // No card open: only the pack-level part.
      await library(undefined, '55555555-5555-4555-8555-555555555555')
      if (await page.locator('.ap-widget-card').count()) errors.push('card part shown without a card')
      await pane().evaluate(node => { node.scrollTop = node.scrollHeight }); await shot('09-entry-no-card')
      // private fork (settings-polish r4): a pack-level colour row keeps swatch + 跟随舞台/自定义 on its title line; the palette
      // and hex field appear only for 自定义.
      const accent = page.locator('.ap-widget-setting[data-type=colour]').first()
      if (await accent.locator('.ap-widget-swatches').count()) errors.push('palette shown while following the stage')
      await accent.getByRole('button', { name: '自定义', exact: true }).click(); await accent.locator('.ap-widget-swatches').waitFor()
      if (!(await accent.evaluate(node => { const label = node.querySelector('.ap-widget-setting-label').getBoundingClientRect(), swatch = node.querySelector('.ap-widget-colour-head .ap-widget-swatch').getBoundingClientRect(); return swatch.top >= label.top - 1 && swatch.bottom <= label.bottom + 1 }))) errors.push('colour swatch not on the title line')
      await accent.evaluate(node => node.scrollIntoView({ block: 'center' })); await shot('10-entry-shared-custom-colour')
      await page.keyboard.press('Escape')
      await page.evaluate(() => window.root.render(React.createElement('div', { className: 'ap-ui' }, React.createElement(window.views.CardImportSheet, window.cardImportFixture()))))
      await page.getByRole('dialog').waitFor(); await page.getByRole('button', { name: '启用', exact: true }).waitFor(); await shot('07-card-import-widgets')
      // private fork (card import r3): the 模组 question starts on its safe answer; paths only under 详情.
      if (!(await page.waitForFunction(() => document.activeElement?.textContent === '不启用', null, { timeout: 2000 }).then(() => true, () => false))) errors.push('card import focus does not start on 不启用')
      if (/沙箱|读点|bundles\/|index\.js/.test(await page.getByRole('dialog').innerText())) errors.push('jargon or file path in the card import sheet')
      if (/55555555/.test(await page.getByRole('dialog').innerText())) errors.push('internal id in card import sheet')
      await page.close()
    }
  } finally { await browser.close() }
  return { shots, errors }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const { shots, errors } = await run()
  console.log(shots.length + ' screenshots → ' + outDir)
  if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1 }
}
