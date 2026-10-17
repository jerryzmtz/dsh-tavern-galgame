// private fork (owner 2026-10 pack-chip): offline harness for the pack-row state chip (「⊕ 全局」 / 「✓ 本卡」 / 「○ 关闭」 ⌄).
// Chromium renders the real 素材库 (App with an open chat's card, so all three states appear) and the 舞台设置 管理 list in
// the shared pack modal; it measures every chip: the label is never clipped and the gap between label and chevron stays
// small (the chip sizes to its content). Synthetic data only, no live service.
// Usage: node tests/harness/pack-chip.mjs [outDir] [--prefix=before]
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { browserReactScript } from '../fixtures/browser-react.mjs'
import { forkThemeCss } from '../helpers/fork-theme-css.mjs'
import { stageSource, THEMES } from './card-centric-stage.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const args = process.argv.slice(2), option = (name, fallback) => args.find(a => a.startsWith('--' + name + '='))?.split('=').slice(1).join('=') || fallback

export function pageSetup() {
  const GLOBAL = '11111111-1111-4111-8111-111111111111', CARD = '22222222-2222-4222-8222-222222222222', OFF = '33333333-3333-4333-8333-333333333333', LONG = '44444444-4444-4444-8444-444444444444'
  const pack = (id, name, counts) => ({ manifest: { id, name, assets: Object.entries(counts).flatMap(([kind, n]) => Array.from({ length: n }, (_, i) => ({ kind, id: kind + i, name: kind + i, enabled: true, recall: { mode: 'keyword', keywords: [] }, directorNote: '' }))), figures: [] }, figures: {}, sprites: {}, revision: 'r1', installedAt: 1, updatedAt: 2 })
  const packs = [pack(GLOBAL, '通用素材', { backgrounds: 3, music: 2 }), pack(CARD, '见泷原的奇妙冒险素材', { backgrounds: 2 }), pack(OFF, '通用音效', { sfx: 4 }), pack(LONG, '一个名字非常非常非常非常非常非常长的素材包用来测试省略', { music: 1 })]
  const card = { schemaVersion: 1, assetBindings: { boundPackIds: [CARD] }, stage: { dialogue: true, voice: false, voiceLanguage: false, stage: true } }
  const clone = v => JSON.parse(JSON.stringify(v)), byId = id => packs.find(p => p.manifest.id === id)
  window.binding = {
    service: { apiVersion: 2, capabilities: ['packs', 'figures'], subscribe: () => () => {}, listPackSummaries: async () => clone(packs), getPackSnapshot: async ({ packId }) => clone(byId(packId)) },
    rpc: async method => {
      if (method === 'getCardAssetBindings') return { path: 'cards/c.json', revision: 'c1', extension: clone(card), effectiveStage: {} }
      if (method === 'getAssetEngineSettings') return { values: { dialogue: { textLanguage: 'zh', emotions: [] }, dimensions: {}, limits: {} }, revision: 'e1', writable: true }
      if (method === 'getAssetPackDependencies') return { available: true, count: 1, cards: [] }
      if (method === 'getCardOpeningScenes') return { lead: '', greetings: [], scenes: {} }
      throw new Error('mock: ' + method)
    },
    globalEnabledPackIds: [GLOBAL], setGlobalEnabled: async () => {}, loadSettings: async () => {}, onSettings: () => () => {},
    previewMedia: async () => ({ url: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=', release() {} }), download() {},
    tts: { listVoices: async () => [], subscribe: () => () => {}, synthesize: async () => ({}), audioUrl: () => '' }
  }
  const h = React.createElement
  const views = createForkAssetPackUI(React, { VoicePicker: ForkBubbleLibraryPicker, AvatarImage: ForkPackImage })
  const rootNode = ReactDOM.createRoot(document.getElementById('panel'))
  const nav = { take: () => null, subscribe: () => () => {}, openTab: async () => {}, openLibrary: async () => {} }
  window.showLibrary = () => rootNode.render(h(views.App, { enabled: true, binding: window.binding, nav, sessionId: 's', cardPath: 'cards/c.json', cardStamp: 1 }))
}

// Every visible chip: label overflow and how off-centre the label sits. private fork (UI standard chips, owner 2026-10):
// the chip is the text-only tag — no chevron, so `gap` is the difference between the left and right inner space.
const measure = page => page.evaluate(() => [...document.querySelectorAll('button.ap-state-tag')].filter(b => b.offsetParent).map(b => {
  const label = b.querySelector(':scope > span'), r = b.getBoundingClientRect()
  const range = document.createRange(); range.selectNodeContents(label); const text = range.getBoundingClientRect()
  return { state: b.dataset.state, text: label.textContent, width: Math.round(r.width), height: Math.round(r.height), gap: Math.round(Math.abs((text.left - r.left) - (r.right - text.right))),
    clipped: label.scrollWidth > label.clientWidth + 1 || text.right > r.right + 0.5 || r.right > b.parentElement.closest('.ap-pack-row').getBoundingClientRect().right + 0.5 }
}))

export async function run({ outDir = path.join(root, '.tmp/pack-chip'), prefix = '' } = {}) {
  const { chromium } = await import('playwright')
  const { source, picker, playback } = await stageSource()
  const css = await forkThemeCss()
  await mkdir(outDir, { recursive: true })
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  const shots = [], errors = [], results = {}
  // side = 900 px window with the docked side panel; 900 = the library filling the window (full-screen modal width);
  // 375 = phone.
  const sizes = [['side', { width: 900, height: 700 }, '420px'], ['900', { width: 900, height: 700 }, '100%'], ['375', { width: 375, height: 760 }, '100%']]
  try {
    for (const [theme, tokens] of Object.entries(THEMES)) for (const [size, viewport, panel] of sizes) {
      const tag = theme + '/' + size, page = await browser.newPage({ viewport, deviceScaleFactor: 2 })
      page.on('pageerror', e => errors.push(tag + ': ' + e.message))
      await page.route('http://chip.test/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"></head><body><div class="host"><main class="chat"></main><aside id="panel"></aside></div></body></html>' }))
      await page.goto('http://chip.test/')
      await page.addStyleTag({ content: css + `
        html, body { margin: 0; } body { ${tokens} background: var(--page); font-family: "Microsoft YaHei UI", "PingFang SC", sans-serif; }
        .host { display: flex; min-height: 100vh; } .chat { flex: 1; background: var(--page); }
        #panel { width: ${panel}; flex: none; border-left: 1px solid var(--fork-hairline); padding: 0 12px; box-sizing: border-box; background: var(--fork-surface); }` })
      await page.evaluate(context => { document.body.dataset.fkContext = context }, 'chat-' + theme)
      await page.addScriptTag({ content: await browserReactScript() + ';window.React=modules.react;window.ReactDOM={...modules["react-dom"],...modules["react-dom/client"]};' + playback + source + picker })
      await page.evaluate(pageSetup)
      await page.evaluate(() => window.showLibrary())
      await page.locator('button.ap-state-tag[data-state=card]').first().waitFor()
      await page.waitForTimeout(250)
      const chips = await measure(page); results[tag] = chips
      for (const c of chips) {
        if (c.clipped) errors.push(tag + ': label clipped (' + c.state + ')')
        if (c.gap > 12) errors.push(tag + ': ' + c.gap + 'px gap between label and chevron (' + c.state + ')')
      }
      const file = path.join(outDir, `${prefix}library-${theme}-${size}.png`); await page.screenshot({ path: file }); shots.push(file)
      await page.close()
    }
  } finally { await browser.close() }
  return { shots, errors, results }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const outDir = args.find(a => !a.startsWith('--'))
  const { shots, errors, results } = await run({ outDir, prefix: option('prefix', '') })
  for (const [tag, chips] of Object.entries(results)) console.log(tag, chips.map(c => `${c.state}:${c.width}px gap ${c.gap}${c.clipped ? ' CLIPPED' : ''}`).join(' | '))
  console.log(shots.length + ' screenshots → ' + (outDir || '.tmp/pack-chip'))
  if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1 }
}
