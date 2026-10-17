// private fork: sprite/avatar variant labels use the owner term chafen.
// private fork: 舞台设置 r2 (owner review 2026-10) — the real panel in a host-shaped side pane (fixed-height scrolling
// pane), advanced mode, with the real 全局设置 rows (ForkBubbleSettingsTab, embedded) and the real 调试 view
// (ForkStageDebug → ForkDirectorInput) over an in-page mock (synthetic art, no live data). Shoots 1600×900 (the side
// pane) and 375 in dark/light; without --before it also checks the r2 behaviour (lamp menu, skin picker + search,
// one switch per sound row, toggle chips, heading order, plain debug names, no native controls).
// Usage: node tests/harness/card-stage-settings-r2.mjs [outDir] [--before]
import { readFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { browserReactScript } from '../fixtures/browser-react.mjs'
import { forkThemeCss } from '../helpers/fork-theme-css.mjs'
import { stageSource, pageSetup, THEMES } from './card-centric-stage.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const args = process.argv.slice(2), before = args.includes('--before')
const outDir = args.find(a => !a.startsWith('--')) || path.join(root, '.tmp/card-stage-settings-r2')
const client = file => readFile(path.join(root, 'tavern-plugin/src/client', file), 'utf8')
const between = (text, start, end) => { const a = text.indexOf(start); if (a < 0) throw new Error('missing ' + start); const b = end ? text.indexOf(end, a) : text.length; return text.slice(a, b < 0 ? text.length : b) }

// The settings pieces production renders inside the panel (outside the asset-pack factory).
async function hostPieces() {
  const modes = await client('fork-bubble-modes.js'), presets = await client('fork-bubble-presets.js'), bubbles = await client('fork-bubbles.js')
  const launcher = await client('fork-asset-launcher.js'), modal = await client('fork-modal.js')
  return [await client('fork-settings-ui.js'), between(modal, 'const FORK_MODAL_COMPACT'),
    between(modes, 'const FORK_TEXT_LANGUAGES', '// 高级 → 差分'), between(presets, 'function forkBubbleSaveQueue', 'function forkBubbleTemplateMissing'),
    await client('fork-asset-catalogue.js'), await client('fork-bubble-modals.js'),
    between(bubbles, 'function ForkBubbleSettingsTab'), between(launcher, 'function ForkStageDebug', 'function ForkTavernStageTab')].join('\n;\n')
}

// In-page: skins, lamps, the director preview and the real global / debug renderers.
function r2Setup({ manySkins }) {
  const h = React.createElement, PACK = '11111111-1111-4111-8111-111111111111', GENERAL = '22222222-2222-4222-8222-222222222222'
  const skin = (id, label, bg, fg, accent, border, radius) => ({ schema: 'dsh.skin/1', id, label, textbox: { paint: { bg, fg, fgMuted: border, accent, border }, shape: { radius } }, ui: { bg, fg, fgMuted: border, accent, border, radius } })
  const skins = { salt: skin('salt', '海盐奶油', '#fdfaf3', '#2f3d55', '#4f86d0', '#c9d6e8', 14), deep: skin('deep', '深海夜灯', '#0b1426', '#dce8ff', '#5fc4ff', '#2a4a78', 8) }
  if (manySkins) for (const [i, label] of ['樱花信笺', '旧书店', '夏夜祭', '雪国列车', '星屑', '茶室', '霓虹街', '黄昏教室', '雨夜'].entries()) skins['extra' + i] = skin('extra' + i, label, `hsl(${i * 40} 40% ${i % 2 ? 18 : 92}%)`, i % 2 ? '#f2f2f2' : '#222222', `hsl(${i * 40 + 20} 70% 50%)`, `hsl(${i * 40} 30% 55%)`, 6 + i)
  const decorate = pack => {
    if (pack.manifest.id === PACK) { pack.skins = skins; for (const id of Object.keys(skins)) pack.manifest.assets.push({ kind: 'skins', id, name: skins[id].label}) }
    for (const figure of Object.values(pack.figures || {})) {
      if (figure.name === '鹿目圆') figure.recall = { mode: 'constant', keywords: [] }
      if (figure.name === '少年 B') figure.enabled = false
    }
    return pack
  }
  const service = window.binding.service, base = window.r2Base ||= { list: service.listPackSummaries, snapshot: service.getPackSnapshot, patch: service.patchFigure, rpc: window.binding.rpc }
  const { list, snapshot, patch } = base
  service.listPackSummaries = async () => (await list()).map(decorate)
  service.getPackSnapshot = async args => decorate(await snapshot(args))
  window.figurePatches = []
  service.patchFigure = async args => { window.figurePatches.push(JSON.parse(JSON.stringify(args))); return patch(args) }
  const rpc0 = base.rpc
  window.binding.rpc = async (method, args) => {
    if (method === 'getAssetEngineSettings') { const value = await rpc0(method, args); value.values.directionStyles = [{ id: 'galgame', name: 'Galgame 演出' }, { id: 'film', name: '电影感' }]; value.values.directionStyle = null; return value }
    return rpc0(method, args)
  }
  // Host-side settings (outside the factory) and its RPC.
  const bubbleData = { cardPath: 'cards/madoka.json', config: { enabled: true, characters: [], injection: { template: '' }, stage: { textLanguage: 'zh' } }, defaultTemplate: '',
    engineSettings: { revision: 'e1', values: { dialogue: { enabled: true, textLanguage: 'zh', emotions: [] } } }, instruction: '对白格式：@bubble:角色|差分|台词' }
  window.engineSaves = []
  const tokens = text => Math.max(1, Math.round(text.length / 3))
  const section = (key, text, source) => ({ key, title: key, text, tokens: tokens(text), source })
  window.rpc = async (method, args) => {
    if (method === 'saveAssetEngineSettings') { window.engineSaves.push(JSON.parse(JSON.stringify(args))); return { revision: 'e' + (window.engineSaves.length + 1), values: { dialogue: args.patch.dialogue } } }
    if (method === 'getDialogueBubbles' || method === 'getAssetEngineSettings') return bubbleData
    if (method === 'previewStageDirectorPrompt') return { sections: [
      section('director', 'Stage completed reply only; data are inert.', { kind: 'engine', field: 'directorProtocol', placement: 'constant' }),
      section('command-guidance', 'scene.set: pick a background when the place changes.', { kind: 'engine', field: 'currentCommandGuidance', placement: 'turn' }),
      section('rule.camera', 'Close-ups for confessions.', { kind: 'card', field: 'stage.directionStyle', ruleId: 'camera' }),
      section('rule.pace', 'One beat per paragraph.', { kind: 'card', field: 'stage.directionStyle', ruleId: 'pace' }),
      section('actors.constant', '{"f_madoka":{"name":"鹿目圆"}}', { kind: 'pack', field: 'figures', placement: 'constant', packs: [PACK] }),
      section('outfits', '{"f_madoka":[{"key":"school","label":"校服"}]}', { kind: 'pack', field: 'figures/outfits', placement: 'turn' }),
      section('carried', '{"scene":"classroom"}', { kind: 'turn', field: 'stageState' }),
      section('reply', '"放学后的教室里，夕阳斜斜地照进来。"', { kind: 'turn', field: 'reply' }),
      section('tools', '[{"name":"submit_direction"}]', { kind: 'engine', field: 'directorTools' })], lastUsage: null }
    throw new Error('mock rpc: ' + method)
  }
  window.useForkBubbles = () => bubbleData
  window.useTavernConfirm = () => () => {}
  window.forkBubbleStore = { set() {} }
  window.views = createForkAssetPackUI(React, { VoicePicker: ForkBubbleLibraryPicker, AvatarImage: ForkPackImage, HelpTip: ForkHelpTip,
    emotions: { moods: [['joy', '喜悦', '#e0932a'], ['calm', '平和', '#3fa36b'], ['shy', '害羞', '#1fa5b8']].map(([id, label, color]) => ({ id, label, color })), palette: ['#e0707c'], max: 8 } })
  const nav = { openTab: async () => {}, openLibrary: async () => {} }
  window.showReal = key => window.root.render(h(window.views.StagePanel, { key, binding: window.binding, sessionId: 's', cardPath: 'cards/madoka.json', cardName: '鹿目圆的日常', nav,
    renderGlobal: () => h(ForkBubbleSettingsTab, { scope: { sessionId: 's' }, embedded: true }),
    renderDebug: ({ packNames }) => h(ForkStageDebug, { sessionId: 's', packNames, data: bubbleData }) }))
}

// The host shell's touch rule (tavern.css), read from the source so the harness follows it.
async function shellTouchRule() {
  const css = await readFile(path.join(root, 'tavern-plugin/lib/client-assets/tavern.css'), 'utf8')
  const rule = 'body.dsh-tavern-shell-active :is([data-sidebar-right-panel]) :is(button, summary, select) { min-height: 40px; }'
  if (!css.includes(rule) || !css.includes('@media (max-width: 1023px), (pointer: coarse) {')) throw new Error('tavern.css touch rule moved; update the harness')
  return '@media (max-width: 1023px), (pointer: coarse) { ' + rule + ' }'
}

export async function run() {
  const { chromium } = await import('playwright')
  const shellTouch = await shellTouchRule()
  const { source, picker, playback } = await stageSource()
  const pieces = await hostPieces(), css = await forkThemeCss()
  await mkdir(outDir, { recursive: true })
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  const shots = [], errors = [], report = []
  const check = (ok, message) => { if (!ok) errors.push(message) }
  try {
    for (const [theme, tokens] of Object.entries(THEMES)) for (const [size, viewport, pane] of [['1600x900', { width: 1600, height: 900 }, 720], ['375', { width: 375, height: 812 }, 0]]) {
      const page = await browser.newPage({ viewport, deviceScaleFactor: size === '375' ? 2 : 1 })
      const tag = theme + '/' + size
      page.on('pageerror', e => errors.push(tag + ': ' + e.message))
      // The pane is the host's right sidebar (body.dsh-tavern-shell-active [data-sidebar-right-panel]), so the shell's touch
      // rule from tavern.css applies at 375 as it does on a phone.
      await page.route('http://stage.test/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"></head><body class="dsh-tavern-shell-active"><div class="host"><main class="chat"></main><section class="pane" data-sidebar-right-panel><div id="panel"></div></section></div></body></html>' }))
      await page.goto('http://stage.test/')
      await page.addStyleTag({ content: css + `
        html, body { margin: 0; height: 100%; } body { ${tokens} background: var(--page); font-family: "Microsoft YaHei UI", "PingFang SC", sans-serif; }
        .host { display: flex; height: 100vh; } .chat { flex: 1; background: var(--page); }
        .pane { width: ${pane ? pane + 'px' : '100%'}; flex: none; height: 100%; overflow: auto; border-left: 1px solid var(--fork-hairline); background: ${theme === 'dark' ? '#0b0b0c' : '#d4d8de'}; }
        #panel { display: flex; flex-direction: column; min-height: 100%; }
        ${pane ? '' : '.chat { display: none; }'}
        ${shellTouch}` })
      await page.evaluate(context => { document.body.dataset.fkContext = context }, 'chat-' + theme)
      // Production ReactDOM has createPortal: menus float in the top layer as in the host.
      await page.addScriptTag({ content: await browserReactScript() + ';window.React=modules.react;window.ReactDOM={...modules["react-dom/client"],createPortal:modules["react-dom"].createPortal};' + playback + source + picker + '\n;\n' + pieces + '\n;window.ForkBubbleSettingsTab=ForkBubbleSettingsTab;window.ForkStageDebug=ForkStageDebug;window.ForkHelpTip=ForkHelpTip;' })
      await page.evaluate(pageSetup)
      const start = async manySkins => {
        await page.evaluate(many => { window.scenario('main') }, manySkins)
        await page.evaluate(r2Setup, { manySkins })
        await page.evaluate(() => window.showReal('r2' + Math.random()))
        await page.getByText('本卡读音词典').waitFor(); await page.waitForTimeout(500)
      }
      const shot = async name => { const file = path.join(outDir, `${name}-${theme}-${size}.png`); await page.waitForTimeout(250); await page.locator('.pane').screenshot({ path: file }); shots.push(file) }
      const scrollTo = async (heading, offset = 12) => page.evaluate(([text, offset]) => { const pane = document.querySelector('.pane'), el = [...document.querySelectorAll('.ap-section-head h3')].find(n => n.textContent.startsWith(text)); pane.scrollTop += el.getBoundingClientRect().top - offset }, [heading, offset])
      const saved = () => page.getByText('已保存', { exact: true }).waitFor()
      const lastPatch = () => page.evaluate(() => window.calls.filter(([m]) => m === 'saveCardAssetBindings').at(-1)?.[1].patch)

      await start(false)
      await shot('01-top')
      await scrollTo('人物'); await shot('02-cast')
      await scrollTo('演出规则'); await shot('03-direction')
      await scrollTo('BGM'); await shot('04-audio-skin')
      await scrollTo('调试'); await shot('06-debug')
      await scrollTo('全局设置', 140); await shot('07-global')
      if (!before) {
        // 1. Heading order: title → count → 「?」; no accent bar.
        const order = await page.evaluate(() => [...document.querySelectorAll('.ap-stage-page .ap-section-head h3')].map(h3 => { const kids = [...h3.childNodes].map(n => n.nodeType === 3 ? 'text' : n.classList?.contains('ap-section-meta') ? 'meta' : n.querySelector?.('button[aria-label$="说明"]') || n.matches?.('.fork-help-tip, .ap-help-anchor') ? 'help' : 'other'); return { title: h3.textContent, kids, bar: getComputedStyle(h3, '::before').content } }))
        for (const row of order) {
          check(!row.kids.includes('help') || row.kids.indexOf('help') === row.kids.length - 1, tag + ': 「?」 not last in ' + row.title + ' ' + row.kids)
          check(row.bar === 'none' || row.bar === 'normal', tag + ': accent bar on ' + row.title)
        }
        // Round marks stay round under the shell's touch rule (375): the 「?」 and the figure lamps are not stretched.
        const marks = await page.evaluate(() => [...document.querySelectorAll('.ap-stage-page .ap-section-head h3 button, .ap-cast-lamp')].map(b => { const r = b.getBoundingClientRect(); return [b.className, Math.round(r.width), Math.round(r.height)] }))
        check(marks.length && marks.every(([, w, h]) => h === w), tag + ': stretched round marks ' + JSON.stringify(marks.filter(([, w, h]) => h !== w)))
        // 6. No native controls in the page (switches are the panel's role=switch inputs).
        const native = await page.evaluate(() => [...document.querySelectorAll('.ap-stage-page select, .ap-stage-page input[type=checkbox]:not([role=switch])')].map(n => n.outerHTML.slice(0, 80)))
        check(!native.length, tag + ': native controls ' + native.join(' | '))
        // 3. One switch per sound row, no scope chip; off stores false, on removes the override.
        const audio = page.locator('.ap-section', { has: page.getByRole('heading', { name: /^BGM 与音效/ }) })
        check(await audio.locator('.ap-state-tag').count() === 0, tag + ': sound rows still carry a scope chip')
        check(await audio.getByRole('switch').count() === 3, tag + ': three sound switches')
        await audio.getByRole('switch', { name: '环境音' }).click(); await saved()
        check((await lastPatch())?.stage?.ambience === false, tag + ': 环境音 off saves stage.ambience=false')
        await audio.getByRole('switch', { name: '环境音' }).click(); await page.waitForFunction(() => !Object.hasOwn(window.calls.filter(([m]) => m === 'saveCardAssetBindings').at(-1)[1].patch.stage, 'ambience'))
        // 4. Skin picker: mini previews, saves stage.defaultSkin.
        const trigger = page.getByRole('button', { name: /^默认舞台皮肤：/ })
        check(await trigger.locator('.fork-gal-config-theme-art').count() === 1, tag + ': trigger shows the current skin preview')
        await trigger.click(); await page.getByRole('menuitemradio', { name: '深海夜灯' }).waitFor()
        check(await page.locator('.ap-skin-option .fork-gal-config-theme-art').count() === 7, tag + ': every option has a preview')
        check(await page.locator('.ap-skin-menu input[type=search]').count() === 0, tag + ': no search for a short list')
        // The menu opens at the trigger's left edge, at least as wide as the trigger (the CONFIG select).
        const fit = await page.evaluate(() => { const m = document.querySelector('.ap-skin-menu').closest('.ap-popover').getBoundingClientRect(), t = document.querySelector('.ap-skin-trigger').getBoundingClientRect(); return Math.abs(m.left - t.left) <= 1 && m.width >= t.width - 1 })
        check(fit, tag + ': skin menu is not aligned with its trigger')
        await shot('05-skin-menu')
        await page.getByRole('menuitemradio', { name: '深海夜灯' }).click(); await saved()
        const skinPatch = await lastPatch()
        check(JSON.stringify(skinPatch?.stage?.defaultSkin) === JSON.stringify({ packId: '11111111-1111-4111-8111-111111111111', kind: 'skins', assetId: 'deep' }), tag + ': defaultSkin saved ' + JSON.stringify(skinPatch?.stage?.defaultSkin))
        check(await page.getByRole('button', { name: '默认舞台皮肤：深海夜灯' }).count() === 1, tag + ': trigger follows the saved skin')
        await page.getByRole('button', { name: '默认舞台皮肤：深海夜灯' }).click(); await page.getByRole('menuitemradio', { name: '经典' }).click(); await saved()
        check((await lastPatch())?.stage?.defaultSkin === 'classic', tag + ': built-in skin saved as its id')
        // private fork (global only, owner 2026-10): no director command chips on a card (舞台引擎 › 可用演出 only).
        check(await page.locator('.ap-stage .ap-dim-chip').count() === 0, tag + ': no card command chips')
        // 2. Lamp dot menu on the figure tile.
        await scrollTo('人物')
        const lamps = page.locator('.ap-cast-lamp')
        check(await lamps.count() === await page.locator('.ap-cast > li').count(), tag + ': one lamp per figure')
        const boxes = await page.evaluate(() => [...document.querySelectorAll('.ap-cast > li')].map(li => { const a = li.getBoundingClientRect(), b = li.querySelector('.ap-cast-lamp').getBoundingClientRect(); return b.left >= a.left && b.right <= a.right && b.top >= a.top && b.bottom <= a.bottom }))
        check(boxes.every(Boolean), tag + ': every lamp sits on its own tile')
        await page.getByRole('button', { name: '少女 A 人物灯：绿灯，更改' }).click(); await page.getByRole('menuitemradio', { name: '蓝灯' }).waitFor()
        await shot('02b-cast-lamp-menu')
        await page.getByRole('menuitemradio', { name: '蓝灯' }).click()
        await page.waitForFunction(() => window.figurePatches.length > 0)
        check((await page.evaluate(() => window.figurePatches.at(-1).patch.recall?.mode)) === 'constant', tag + ': lamp menu saves the recall mode')
        // 5. Global: the panel's switch and plain wording; saves the engine fallback.
        await scrollTo('全局设置', 140)
        const global = page.getByRole('switch', { name: '没有舞台设置的卡也用气泡' })
        check(await global.count() === 1, tag + ': global bubble switch is the panel switch')
        check(await page.locator('.ap-stage-page .dsh-tavern-settings-switch').count() === 0, tag + ': no foreign switch style')
        await global.click(); await page.waitForFunction(() => window.engineSaves.length > 0)
        check((await page.evaluate(() => window.engineSaves.at(-1).patch.dialogue.enabled)) === false, tag + ': global switch saves dialogue.enabled')
        // 6. Debug names.
        const debug = await page.evaluate(() => document.querySelector('.fork-stage-debug')?.innerText || '')
        for (const name of ['导演指引', '常驻人物', '服装', '演出规则 1', '演出规则 2']) check(debug.includes(name), tag + ': debug lacks ' + name)
        for (const key of ['command-guidance', 'actors.constant', 'outfits', 'rule.camera']) check(!debug.includes(key), tag + ': debug shows ' + key)
        // 调试 has one hairline under its head, and 对白格式注入 folds with the panel chevron (no browser triangle).
        const debugLook = await page.evaluate(() => ({ line: getComputedStyle(document.querySelector('.ap-debug .fork-stage-debug > .fork-bubble-section')).borderTopWidth,
          summary: getComputedStyle(document.querySelector('.fork-stage-injection > summary')).display }))
        check(debugLook.line === '0px', tag + ': debug draws a second hairline')
        check(debugLook.summary === 'flex', tag + ': injection keeps the native disclosure marker')
        // Long skin lists get a search box.
        await start(true); await scrollTo('BGM')
        await page.getByRole('button', { name: /^默认舞台皮肤：/ }).click()
        const search = page.locator('.ap-skin-menu input[type=search]')
        check(await search.count() === 1, tag + ': search box for a long list')
        await search.fill('夜'); await page.waitForTimeout(150)
        const names = await page.locator('.ap-skin-option').allInnerTexts()
        check(names.length === 3 && names.every(n => n.includes('夜')), tag + ': search filters ' + names.join(','))
        await shot('05b-skin-search')
      }
      await page.close()
    }
  } finally { await browser.close() }
  return { shots, errors, report }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const { shots, errors, report } = await run()
  if (report.length) console.log(report.join('\n'))
  console.log(shots.length + ' screenshots → ' + outDir)
  if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1 }
}
