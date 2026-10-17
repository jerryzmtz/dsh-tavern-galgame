// private fork (entry cleanup, owner 2026-10): offline harness for the pack entry editor — the 物品 hero picture, no 优先级,
// and the list lamp dot's 蓝灯 / 绿灯 / 关闭 menu. Chromium renders the real factory source and the live stylesheet; packs are
// read read-only from the live pack folders and every write stays in page memory.
// Usage: node tests/harness/entry-cleanup.mjs [outDir] [--size=desktop|375] [--theme=dark|light]
import { readFile, readdir, mkdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { browserReactScript } from '../fixtures/browser-react.mjs'
import { forkThemeCss } from '../helpers/fork-theme-css.mjs'
import { stageSource, THEMES } from './card-centric-stage.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const args = process.argv.slice(2), option = name => args.find(a => a.startsWith('--' + name + '='))?.split('=').slice(1).join('=')
const outDir = args.find(a => !a.startsWith('--')) || path.join(root, '.tmp/entry-cleanup')
const LIVE = process.env.DSH_TEST_PACKS_ROOT
const ITEMS = '中国现代都市通用物品'
const exists = file => stat(file).then(() => true, () => false)
const client = file => readFile(path.join(root, 'tavern-plugin/src/client', file), 'utf8')
const readJson = async file => JSON.parse(await readFile(file, 'utf8'))

async function snapshot(id) {
  const dir = LIVE + '/' + id, manifest = await readJson(dir + '/manifest.json'), figures = {}, sprites = {}, skins = {}, widgets = {}
  for (const figureId of manifest.figures || []) if (await exists(dir + '/figures/' + figureId + '.json')) figures[figureId] = await readJson(dir + '/figures/' + figureId + '.json')
  for (const [key, rel] of Object.entries(manifest.sprites || {})) if (await exists(dir + '/' + rel)) sprites[key] = await readJson(dir + '/' + rel)
  for (const asset of manifest.assets) if (['skins', 'widgets'].includes(asset.kind) && await exists(dir + '/bundles/' + asset.bundleKey + '/' + asset.entry)) (asset.kind === 'skins' ? skins : widgets)[asset.id] = await readJson(dir + '/bundles/' + asset.bundleKey + '/' + asset.entry)
  delete manifest.files
  return { manifest, figures, sprites, skins, widgets, revision: 'r1' }
}

function pageSetup({ packs }) {
  const h = React.createElement, clone = v => JSON.parse(JSON.stringify(v)), wait = ms => new Promise(r => setTimeout(r, ms))
  const byId = id => packs.find(p => p.manifest.id === id); let rev = 1
  window.calls = []
  window.binding = {
    service: { apiVersion: 2, capabilities: ['packs', 'figures'], subscribe: () => () => {},
      listPackSummaries: async () => packs.map(clone), getPackSnapshot: async ({ packId }) => { await wait(20); return clone(byId(packId)) },
      patchPack: async ({ packId, expectedRevision, patch }) => { const p = byId(packId); if (expectedRevision !== p.revision) throw Object.assign(new Error('changed'), { code: 'REVISION_CONFLICT' })
        Object.assign(p.manifest, clone(patch || {})); window.calls.push(['patchPack', clone(patch)]); p.revision = 'r' + (++rev); return { status: 'ok', snapshot: clone(p) } } },
    rpc: async method => { throw new Error('mock: ' + method) },
    previewMedia: async ({ packId, hash }) => ({ url: '/media/' + packId + '/' + hash, release() {} }),
    globalEnabledPackIds: [], loadSettings: async () => {}, onSettings: () => () => {}, download() {}
  }
  window.views = createForkAssetPackUI(React, { VoicePicker: () => null, AvatarImage: ForkPackImage, HelpTip: ForkHelpTip })
  window.root = ReactDOM.createRoot(document.getElementById('panel'))
  window.openPack = (packId, kind) => window.root.render(h(window.views.PackModal, { key: Math.random(), binding: window.binding, packId, initial: { kind }, packs: packs.map(clone), onClose() {} }))
}

export async function run() {
  const { chromium } = await import('playwright')
  let { source, picker, playback } = await stageSource()
  source = await client('fork-settings-ui.js') + '\n' + source.split('// @include fork-asset-pack-cg-ui.js').join(await client('fork-asset-pack-cg-ui.js'))
  const css = await forkThemeCss()
  const ids = (await readdir(LIVE)).filter(name => /^[0-9a-f-]{36}$/.test(name))
  const packs = []; for (const id of ids) if (await exists(LIVE + '/' + id + '/manifest.json')) packs.push(await snapshot(id))
  const items = packs.find(p => p.manifest.name === ITEMS)
  // One pack per kind for the hero sweep (the first pack that has entries of that kind).
  const kinds = ['items', 'backgrounds', 'cg', 'music', 'sfx', 'ambience', 'looks', 'skins', 'widgets', 'directions']
  const sweep = kinds.map(kind => [kind, (kind === 'items' ? items : packs.find(p => p.manifest.assets.some(a => a.kind === kind)))?.manifest.id]).filter(([, id]) => id)
  await mkdir(outDir, { recursive: true })
  const sizes = option('size') ? option('size').split(',') : ['desktop', '375'], themes = option('theme') ? [option('theme')] : ['dark']
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  const shots = [], errors = [], metrics = [], listings = new Map()
  const mediaFile = async (id, hash) => {
    const dir = LIVE + '/' + id + '/media/'
    if (!listings.has(dir)) listings.set(dir, readdir(dir).then(names => new Map(names.map(n => [n.split('.')[0], n]))).catch(() => new Map()))
    const hit = (await listings.get(dir)).get(hash); return hit ? dir + hit : null
  }
  try {
    for (const theme of themes) for (const size of sizes) {
      const viewport = size === '375' ? { width: 375, height: 812 } : { width: 1280, height: 860 }
      const page = await browser.newPage({ viewport, deviceScaleFactor: size === '375' ? 2 : 1 })
      const where = theme + '/' + size
      page.on('pageerror', e => errors.push(where + ': ' + e.message))
      page.on('console', m => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) errors.push(where + ' console: ' + m.text()) })
      await page.route('http://127.0.0.1:47933/**', async route => {
        const p = decodeURIComponent(new URL(route.request().url()).pathname), media = p.match(/^\/media\/([0-9a-f-]{36})\/([0-9a-f]{64})$/)
        if (media) { const file = await mediaFile(media[1], media[2]); return file ? route.fulfill({ contentType: /\.webp$/.test(file) ? 'image/webp' : /\.png$/.test(file) ? 'image/png' : /\.jpe?g$/.test(file) ? 'image/jpeg' : 'audio/mpeg', body: await readFile(file) }) : route.fulfill({ status: 404, body: 'nf' }) }
        return route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"></head><body><div id="panel"></div></body></html>' })
      })
      await page.goto('http://127.0.0.1:47933/')
      await page.addStyleTag({ content: css + `html, body { margin: 0; } body { ${THEMES[theme]} background: var(--page); font-family: "Microsoft YaHei UI", "PingFang SC", sans-serif; }` })
      await page.evaluate(context => { document.body.dataset.fkContext = context }, 'chat-' + theme)
      await page.addScriptTag({ content: await browserReactScript() + ';window.React=modules.react;window.ReactDOM={...modules["react-dom"],...modules["react-dom/client"]};' + playback + source + picker })
      await page.evaluate(pageSetup, { packs })
      const shot = async name => { const file = path.join(outDir, `${name}-${theme}-${size}.png`); await page.waitForTimeout(600); await page.screenshot({ path: file }); shots.push(file) }
      const open = async (id, kind) => { await page.evaluate(([id, kind]) => window.openPack(id, kind), [id, kind]); await page.getByRole('dialog').waitFor(); await page.waitForTimeout(900) }
      const detail = async name => { if (size !== '375') return; await page.locator('.ap-items .ap-item-main', name ? { hasText: name } : {}).first().click(); await page.waitForTimeout(700) }
      // The 物品 pack may be absent from the live folders (it moved to a mod); then steps 1–2 are skipped.
      if (items) {
      // 1. 物品: 钱包 selected — the hero is its picture; no 优先级; the note reads 备注.
      await open(items.manifest.id, 'items')
      if (size !== '375') await page.locator('.ap-items .ap-item-main', { hasText: '钱包' }).first().click()
      else await detail('钱包')
      await page.waitForTimeout(900)
      const hero = await page.evaluate(() => { const img = document.querySelector('.ap-item-hero img'); return { hero: !!document.querySelector('.ap-item-hero'), glyph: !!document.querySelector('.ap-pack-right .ap-hero-glyph'), loaded: !!img && img.complete && img.naturalWidth > 0, text: document.querySelector('.ap-pack-right')?.innerText || '' } })
      metrics.push({ where, step: 'items-hero', hero: hero.hero, glyph: hero.glyph, loaded: hero.loaded, priority: /优先级/.test(hero.text), note: /备注/.test(hero.text), situation: /适用情景/.test(hero.text) })
      if (!hero.hero || hero.glyph || !hero.loaded) errors.push(where + ': 钱包 hero is not its picture ' + JSON.stringify(hero).slice(0, 200))
      if (/优先级|适用情景/.test(hero.text)) errors.push(where + ': item detail still shows 优先级 / 适用情景')
      await shot('01-item-hero')
      // 2. The lamp dot of another row opens the menu without selecting that row.
      if (size === '375') { await page.locator('.ap-subhead-back, .ap-back').first().click().catch(() => {}); await page.waitForTimeout(400) }
      const selectedBefore = await page.locator('.ap-item[aria-selected=true] .ap-item-name').first().innerText().catch(() => '')
      const row = page.locator('.ap-items .ap-item').nth(2), rowName = await row.locator('.ap-item-name').innerText()
      const box = await row.locator('button.ap-item-lamp').boundingBox()
      metrics.push({ where, step: 'lamp-target', w: box && Math.round(box.width), h: box && Math.round(box.height) })
      await row.locator('button.ap-item-lamp').click(); await page.waitForTimeout(400)
      const menu = await page.locator('.ap-lamp-pop [role=menuitemradio]').allInnerTexts()
      if (menu.join('|') !== '蓝灯|绿灯|关闭') errors.push(where + ': lamp menu ' + menu.join('|'))
      await shot('02-lamp-menu')
      await page.locator('.ap-lamp-pop [role=menuitemradio][data-mode=constant]').click(); await page.waitForTimeout(600)
      const after = await page.evaluate(name => ({ calls: window.calls.length, mode: [...document.querySelectorAll('.ap-item')].find(li => li.querySelector('.ap-item-name')?.textContent === name)?.querySelector('button.ap-item-lamp')?.dataset.mode, selected: document.querySelector('.ap-item[aria-selected=true] .ap-item-name')?.textContent || '', detail: !!document.querySelector('.ap-pack-cols[data-detail]') }), rowName)
      metrics.push({ where, step: 'lamp-set', row: rowName, selectedBefore, ...after })
      if (after.mode !== 'constant' || !after.calls) errors.push(where + ': lamp choice not written ' + JSON.stringify(after))
      if (size !== '375' && after.selected !== selectedBefore) errors.push(where + ': lamp click selected the row')
      if (after.detail) errors.push(where + ': lamp click opened the entry on a phone')
      // Keyboard: Enter opens, ArrowDown walks, Escape closes back to the dot.
      await row.locator('button.ap-item-lamp').focus(); await page.keyboard.press('Enter'); await page.waitForTimeout(250)
      const kb = await page.locator('.ap-lamp-pop').count(); await page.keyboard.press('Escape'); await page.waitForTimeout(250)
      const kbClosed = await page.locator('.ap-lamp-pop').count(), focus = await page.evaluate(() => document.activeElement?.className || '')
      metrics.push({ where, step: 'lamp-keys', opened: kb, closed: !kbClosed, focus })
      await shot('03-lamp-set')
      }
      // 3. Every other kind: the hero matches the list (picture / player / skin sample / glyph) and no 优先级.
      for (const [kind, id] of sweep.filter(([k]) => k !== 'items')) {
        await open(id, kind); await detail()
        const state = await page.evaluate(() => { const pane = document.querySelector('.ap-pack-right'); return { img: !!pane?.querySelector('.ap-hero img, .ap-cg-hero img, .ap-cg-preview img, img.ap-hero'), player: !!pane?.querySelector('.ap-player'), skin: !!pane?.querySelector('.ap-skin-sample'), glyph: !!pane?.querySelector('.ap-hero-glyph'), priority: /优先级/.test(pane?.innerText || ''), lamps: document.querySelectorAll('.ap-items button.ap-item-lamp').length, rows: document.querySelectorAll('.ap-items .ap-item').length } })
        metrics.push({ where, step: 'kind', kind, ...state })
        if (state.priority) errors.push(where + ' ' + kind + ': 优先级 shown')
        if (['backgrounds', 'cg'].includes(kind) && !state.img) errors.push(where + ' ' + kind + ': no picture hero')
        if (kind !== 'skins' && state.rows && state.lamps !== state.rows) errors.push(where + ' ' + kind + ': ' + state.lamps + ' lamp menus for ' + state.rows + ' rows')
        if (['items', 'cg', 'backgrounds', 'widgets', 'music', 'sfx', 'ambience', 'looks', 'skins'].includes(kind)) await shot('04-' + kind)
      }
      await page.close()
    }
  } finally { await browser.close() }
  return { shots, errors, metrics }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const { shots, errors, metrics } = await run()
  console.log(shots.length + ' screenshots -> ' + outDir)
  for (const m of metrics) console.log(JSON.stringify(m))
  if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1 }
}
