// private fork: legacy sample packs are converted in memory, never written back.
import {importFigureVariants} from '../../tavern-plugin/packages/dsh-asset-library/src/pack-v2/import-figure-variants.js'
// private fork: historical vocabulary is fixture data, not a runtime default.
// private fork (gen-tab redesign, owner 2026-10): offline screenshots of the figure editor's 生图 tab and the 编辑 tab's ✦
// entries, on real packs read read-only (大肥鱼, 辉夜 with seven outfits). Every write stays in page memory; generation
// RPCs are a page-memory fake that never leaves the page (no network, no paid call). Live2D is not loaded (the editor
// falls back to the 立绘 / silhouette), so the shots are about the generation surfaces, not the model.
// Usage: node tests/harness/gen-tab.mjs [outDir] [--size=1600x900,375] [--theme=light|dark] [--before]
import { readFile, readdir, mkdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { browserReactScript } from '../fixtures/browser-react.mjs'
import { forkThemeCss } from '../helpers/fork-theme-css.mjs'
import { stageSource, THEMES } from './card-centric-stage.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const args = process.argv.slice(2), option = name => args.find(a => a.startsWith('--' + name + '='))?.split('=').slice(1).join('=')
const outDir = args.find(a => !a.startsWith('--')) || path.join(root, '.tmp/gen-tab')
const before = args.includes('--before')
const LIVE = process.env.DSH_TEST_PACKS_ROOT
const FIGURES = [['dafeiyu', '8eb406da-b0af-4070-9e67-8e056c5e9b2e', '大肥鱼'], ['kaguya', '0f5613a4-ae7a-40e2-ba4a-17b4e7e9ce42', '辉夜']]
const exists = file => stat(file).then(() => true, () => false)
const client = file => readFile(path.join(root, 'tavern-plugin/src/client', file), 'utf8')
const readJson = async file => JSON.parse(await readFile(file, 'utf8'))

async function snapshot(id) {
  const dir = LIVE + '/' + id, manifest = await readJson(dir + '/manifest.json'), figures = {}, sprites = {}
  for (const figureId of manifest.figures || []) {
    const f = await readJson(dir + '/figures/' + figureId + '.json'); delete f.stageForm
    // Live2D is not rendered here: the outfits show their 立绘 / 头像 instead.
    for (const o of f.outfits || []) { delete o.live2d; if (o.avatars?.default) { o.avatars.calm ||= o.avatars.default; delete o.avatars.default } }
    if (f.appearance === 'live2d') f.appearance = 'sprite'
    figures[figureId] = f
  }
  for (const [key, rel] of Object.entries(manifest.sprites || {})) if (await exists(dir + '/' + rel)) sprites[key] = await readJson(dir + '/' + rel)
  delete manifest.files
  return { ...importFigureVariants(manifest,figures,sprites), sprites, revision: 'r1' }
}

function pageSetup({ packs, moods }) {
  const h = React.createElement, clone = v => JSON.parse(JSON.stringify(v)), wait = ms => new Promise(r => setTimeout(r, ms))
  const byId = id => packs.find(p => p.manifest.id === id); let rev = 1
  const bump = p => { p.revision = 'r' + (++rev); return { status: 'ok', snapshot: clone(p) } }
  window.calls = []
  window.binding = {
    service: { apiVersion: 2, capabilities: ['packs', 'figures'], subscribe: () => () => {},
      listPackSummaries: async () => packs.map(clone), getPackSnapshot: async ({ packId }) => { await wait(10); return clone(byId(packId)) },
      patchPack: async ({ packId, patch }) => { const p = byId(packId); Object.assign(p.manifest, clone(patch)); return bump(p) },
      patchFigure: async ({ packId, figureId, patch }) => { window.calls.push(['patchFigure', clone(patch)]); const p = byId(packId); p.figures[figureId] = { ...p.figures[figureId], ...clone(patch) }; for (const [k, v] of Object.entries(patch)) if (v === null) delete p.figures[figureId][k]; return bump(p) },
      setFigureAvatarCrop: async ({ packId }) => bump(byId(packId)) },
    rpc: async (method, a) => {
      window.calls.push([method, clone(a || {})]); await wait(20)
      if (method === 'listAssetCandidates') return { ok: true, data: [] }
      // Never generates: a request in the harness is recorded and refused.
      if (['prepareAssetGeneration', 'generateAssetCandidate'].includes(method)) throw Object.assign(new Error('（截图环境不生成图片）'), { code: 'HARNESS' })
      if (method === 'getAssetPackDependencies') return { available: true, packId: a.packId, count: 1, cards: [] }
      if (method === 'getAssetVoiceServices') return { services: [] }
      if (method === 'listFigureVoiceChoices') return { voices: [] }
      if (method === 'getAssetEngineSettings') return { values: { dialogue: { textLanguage: 'zh', emotions: [] }, directionStyle: 'galgame', directionStyles: [], dimensions: {}, widgetExecutionEnabled: false, dialogueThemes: [], catalogueCaps: {}, actionCaps: {}, limits: {}, widgetAuthorizations: {}, voiceServices: {} }, revision: 'e1', writable: true }
      throw new Error('mock: ' + method)
    },
    previewMedia: async ({ packId, hash }) => ({ url: '/media/' + packId + '/' + hash, release() {} }),
    globalEnabledPackIds: [], loadSettings: async () => {}, onSettings: () => () => {}, download() {}
  }
  window.views = createForkAssetPackUI(React, { VoicePicker: ForkBubbleLibraryPicker, AvatarImage: ForkPackImage, HelpTip: ForkHelpTip, emotions: { moods, palette: ['#e0707c', '#2fae9a'], max: 8 } })
  window.root = ReactDOM.createRoot(document.getElementById('panel'))
  window.openFigure = (packId, figureId) => window.root.render(h(window.views.PackModal, { key: packId + figureId + Math.random(), binding: window.binding, packId, initial: { kind: 'figures', figureId }, packs: packs.map(clone), onClose() {} }))
}

export async function run() {
  const { chromium } = await import('playwright')
  let { source, picker, playback } = await stageSource()
  source = await client('fork-settings-ui.js') + '\n' + source.replace('// @include fork-asset-pack-cg-ui.js', await client('fork-asset-pack-cg-ui.js'))
  const css = await forkThemeCss(), empty = await client('fork-stage-empty.js')
  const packs = await Promise.all(FIGURES.map(([, id]) => snapshot(id)))
  const moods = JSON.parse(await readFile(path.join(root, 'tests/fixtures/legacy-dialogue-moods.json'), 'utf8')).map(({ id, label, color }) => ({ id, label, color }))
  const figureOf = (packId, name) => { const p = packs.find(x => x.manifest.id === packId); return Object.keys(p.figures).find(id => p.figures[id].name === name) }
  await mkdir(outDir, { recursive: true })
  const sizes = option('size') ? option('size').split(',') : ['1600x900', '375'], themes = option('theme') ? [option('theme')] : Object.keys(THEMES)
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  const shots = [], errors = [], metrics = [], listings = new Map()
  const mediaFile = async (id, hash) => {
    const dir = LIVE + '/' + id + '/media/'
    if (!listings.has(dir)) listings.set(dir, readdir(dir).then(names => new Map(names.map(n => [n.split('.')[0], n]))))
    const hit = (await listings.get(dir)).get(hash); return hit ? dir + hit : null
  }
  try {
    for (const theme of themes) for (const size of sizes) {
      const custom = size.match(/^(\d+)x(\d+)$/), narrow = size === '375', viewport = narrow ? { width: 375, height: 812 } : { width: +custom[1], height: +custom[2] }
      const page = await browser.newPage({ viewport, deviceScaleFactor: narrow ? 2 : 1, reducedMotion: 'reduce' })
      const tag = theme + '/' + size
      page.on('pageerror', e => errors.push(tag + ': ' + e.message))
      page.on('console', m => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errors.push(tag + ' console: ' + m.text()) })
      await page.route('http://gen-tab.test/**', async route => {
        const p = decodeURIComponent(new URL(route.request().url()).pathname), media = p.match(/^\/media\/([0-9a-f-]{36})\/([0-9a-f]{64})$/)
        if (media) { const file = await mediaFile(media[1], media[2]); return file ? route.fulfill({ contentType: file.endsWith('.webp') ? 'image/webp' : 'image/png', body: await readFile(file) }) : route.fulfill({ status: 404, body: 'nf' }) }
        return route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"></head><body><div id="panel"></div></body></html>' })
      })
      await page.goto('http://gen-tab.test/')
      await page.addStyleTag({ content: css + `html, body { margin: 0; } body { ${THEMES[theme]} background: var(--page); font-family: "Microsoft YaHei UI", "PingFang SC", sans-serif; } #panel { min-height: 100vh; }` })
      await page.evaluate(context => { document.body.dataset.fkContext = context }, 'chat-' + theme)
      await page.addScriptTag({ content: await browserReactScript() + ';window.React=modules.react;window.ReactDOM={...modules["react-dom"],...modules["react-dom/client"]};' + playback + source + picker + '\n' + empty })
      await page.evaluate(pageSetup, { packs, moods })
      const dialog = () => page.getByRole('dialog').last()
      const name = n => (before ? 'before-' : 'after-') + n + '-' + theme + '-' + (narrow ? '375' : 'desktop') + '.png'
      const shot = async (n, wait = 500) => { const file = path.join(outDir, name(n)); await page.mouse.move(viewport.width - 1, 0); await page.waitForTimeout(wait); await page.screenshot({ path: file }); shots.push(file) }
      const settled = () => page.waitForFunction(() => [...document.querySelectorAll('.ap-gen-tab img, .ap-stand img, .ap-gen-outfit-menu img')].every(img => img.complete), null, { timeout: 15000 }).catch(() => errors.push(tag + ': images still loading'))
      const scroller = () => page.evaluate(() => { const el = [...document.querySelectorAll('.ap-figure-main, .ap-pack-right, .ap-figure-pane, [role=dialog] *')].find(e => /auto|scroll/.test(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight + 4); if (!el) return false; el.scrollTop = el.scrollHeight; return true })
      const guard = async where => {
        const text = await page.locator('body').innerText()
        if (/[0-9a-f]{8}-[0-9a-f]{4}-/.test(text)) errors.push(tag + ' ' + where + ': id visible')
        for (const p of ['只写外貌，不写年龄和身体数字', '例：深蓝水手服']) if (await page.locator(`[placeholder^="${p}"]`).count()) errors.push(tag + ' ' + where + ': helper placeholder ' + p)
        const natives = await page.locator('.ap-ui select, .ap-ui input[type=color], .ap-ui input[type=radio], .ap-ui input[type=range]').count()
        if (natives) errors.push(tag + ' ' + where + ': ' + natives + ' native controls')
      }
      const measure = async where => metrics.push({ tag, where, ...(await page.evaluate(() => {
        const tab = document.querySelector('.ap-gen-tab'); if (!tab) return { tab: false }
        const lines = [...tab.querySelectorAll('*')].filter(el => { const s = getComputedStyle(el); return ['Top', 'Bottom'].some(side => parseFloat(s['border' + side + 'Width']) > 0 && s['border' + side + 'Style'] === 'solid') && el.getBoundingClientRect().width > 120 }).length
        return { dividers: lines, height: Math.round(tab.scrollHeight), grids: tab.querySelectorAll('.ap-gen-grid').length, overflowX: tab.scrollWidth > tab.clientWidth + 1 }
      })) })
      try {
        for (const [key, packId, figure] of FIGURES) {
          await page.evaluate(([p, f]) => window.openFigure(p, f), [packId, figureOf(packId, figure)]); await dialog().locator('.ap-figure-pane').waitFor()
          await page.locator('[role=tab][data-tab=gen]').click(); await page.locator('.ap-gen-tab').waitFor(); await settled()
          await guard(key + '-gen'); await measure(key + '-gen'); await shot(key + '-gen')
          if (await scroller()) await shot(key + '-gen-end')
          if (!before && key === 'kaguya') {
            const trigger = page.locator('.ap-gen-outfit-pick > button').first()
            if (await trigger.count()) { await page.evaluate(() => { const el = document.querySelector('.ap-gen-outfit-pick'); el?.scrollIntoView({ block: 'start' }) }); await trigger.click(); await settled(); await shot('kaguya-outfit-menu')
              const search = page.getByRole('searchbox').or(page.locator('.ap-gen-outfit-menu input')).first()
              if (await search.count()) { await search.fill('服'); await shot('kaguya-outfit-search') }
              await page.keyboard.press('Escape') } else errors.push(tag + ': no outfit menu')
          }
          if (!before && key === 'dafeiyu') {
            // private fork (gen-ui r12): 编辑, the 立绘 view: a tile opens its menu (生成… / 上传 / 设置回退 ›, or 重画… / 改图… / 删除);
            // a layered 立绘 lists them unavailable with the reason under each.
            await page.locator('[role=tab][data-tab=edit]').click(); await page.locator('.ap-emotion-roster').waitFor()
            await page.getByRole('radio', { name: '立绘' }).first().click({ timeout: 3000 }).catch(() => {})
            await page.locator('.ap-emotion-roster .ap-face').nth(1).click({ button: 'right' }); await page.waitForTimeout(200)
            if (await page.locator('.ap-cell-menu').count()) { await shot('dafeiyu-edit-menu'); await page.keyboard.press('Escape') } else errors.push(tag + ': no tile menu')
            // 头像 view: the preview card's ✦ opens the generation dialog (nothing is sent until 生成).
            await page.getByRole('radio', { name: '头像' }).first().click({ timeout: 3000 }).catch(() => {})
            const tool = page.locator('.ap-preview-actions button[aria-label*="头像"][aria-label$="…"]').last()
            if (await tool.count()) { await page.evaluate(() => document.querySelector('.ap-figure-main, .ap-pack-right')?.scrollTo?.(0, 0)); await tool.click({ force: true }); await page.waitForTimeout(300)
              if (await page.locator('.ap-gen-dialog').count()) { await shot('dafeiyu-edit-card-dialog'); await page.keyboard.press('Escape') } else await shot('dafeiyu-edit-card-gate')
              const more = page.getByRole('button', { name: '头像 操作' }).first(); if (await more.count()) { await more.click(); await shot('dafeiyu-edit-batch-menu'); await page.keyboard.press('Escape') } }
            else errors.push(tag + ': no ✦ on the preview card')
          }
          if (narrow) await page.getByRole('button', { name: /^返回/ }).first().click().catch(() => {})
        }
      } catch (error) { errors.push(tag + ': ' + error.message.split('\n')[0]); await page.screenshot({ path: path.join(outDir, `debug-${theme}-${narrow ? '375' : 'desktop'}.png`) }) }
      const sent = await page.evaluate(() => window.calls.filter(([m]) => ['prepareAssetGeneration', 'generateAssetCandidate'].includes(m)).length)
      if (sent) errors.push(tag + ': ' + sent + ' generation calls')
      await page.close()
    }
  } finally { await browser.close() }
  return { shots, errors, metrics }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const { shots, errors, metrics } = await run()
  console.log(shots.length + ' screenshots → ' + outDir)
  for (const m of metrics) console.log(JSON.stringify(m))
  if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1 }
}
