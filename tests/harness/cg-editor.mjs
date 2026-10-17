// private fork: offline harness for the CG entry editor (素材包 → CG). Chromium renders the real factory source and the
// live stylesheet; every pack is read read-only from the live pack folders and every write stays in page memory.
// Usage: node tests/harness/cg-editor.mjs [outDir] [--tag=before|after] [--size=desktop|375] [--theme=dark|light]
//   [--cg-ui=<file>] [--theme-css=<file>]   (an older fork-asset-pack-cg-ui.js / fork-theme.css, for before shots)
// private fork (D05, owner 2026-10): composition on the preview (frame drag / wheel / handle / keys, 电脑 · 手机 view, dialogue
// box) and the isolated motion preview (enter / 差分 cross-fade / pan / exit) on the stage's own CG consumer and painter.
import { readFile, readdir, mkdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { browserReactScript } from '../fixtures/browser-react.mjs'
import { forkThemeCss } from '../helpers/fork-theme-css.mjs'
import surfaces from '../../tavern-plugin/src/client/fork-surfaces.cjs'
import { stageSource, THEMES } from './card-centric-stage.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const args = process.argv.slice(2), option = name => args.find(a => a.startsWith('--' + name + '='))?.split('=').slice(1).join('=')
const outDir = args.find(a => !a.startsWith('--')) || path.join(root, '.tmp/cg-editor')
const LIVE = process.env.DSH_TEST_PACKS_ROOT
const DAFEIYU = '8eb406da-b0af-4070-9e67-8e056c5e9b2e'
const SYNTH = { wide: 'a'.repeat(64), tall: 'b'.repeat(64) }
const exists = file => stat(file).then(() => true, () => false)
const client = file => readFile(path.join(root, 'tavern-plugin/src/client', file), 'utf8')
const readJson = async file => JSON.parse(await readFile(file, 'utf8'))

async function snapshot(id) {
  const dir = LIVE + '/' + id, manifest = await readJson(dir + '/manifest.json'), figures = {}, sprites = {}
  for (const figureId of manifest.figures || []) if (await exists(dir + '/figures/' + figureId + '.json')) figures[figureId] = await readJson(dir + '/figures/' + figureId + '.json')
  for (const [key, rel] of Object.entries(manifest.sprites || {})) if (await exists(dir + '/' + rel)) sprites[key] = await readJson(dir + '/' + rel)
  delete manifest.files
  return { manifest, figures, sprites, revision: 'r1' }
}

async function pageSetup({ packs, synth }) {
  const h = React.createElement, clone = v => JSON.parse(JSON.stringify(v)), wait = ms => new Promise(r => setTimeout(r, ms))
  const byId = id => packs.find(p => p.manifest.id === id); let rev = 1
  const view = p => clone(p), objectUrls = new Map()
  // Two synthetic 差分 pictures (a second wide one and a tall one), drawn in the page.
  const draw = async (w, ht, hue, label) => {
    const c = document.createElement('canvas'); c.width = w; c.height = ht; const g = c.getContext('2d')
    const grad = g.createLinearGradient(0, 0, w, ht); grad.addColorStop(0, `hsl(${hue} 60% 70%)`); grad.addColorStop(1, `hsl(${hue + 50} 50% 30%)`)
    g.fillStyle = grad; g.fillRect(0, 0, w, ht)
    for (let i = 0; i < 12; i++) { g.strokeStyle = `hsl(${hue + i * 20} 70% 85% / .5)`; g.lineWidth = 6; g.strokeRect(i * w / 24, i * ht / 24, w - i * w / 12, ht - i * ht / 12) }
    g.fillStyle = '#fff'; g.font = `700 ${Math.round(Math.min(w, ht) / 6)}px sans-serif`; g.textAlign = 'center'; g.fillText(label, w / 2, ht / 2)
    return URL.createObjectURL(await new Promise(r => c.toBlob(r, 'image/png')))
  }
  objectUrls.set(synth.wide, await draw(1600, 900, 200, 'B')); objectUrls.set(synth.tall, await draw(900, 1600, 320, 'TALL'))
  window.calls = []; window.leases = { held: 0, released: 0 }
  const revoke = URL.revokeObjectURL.bind(URL); window.revoked = 0; URL.revokeObjectURL = url => { window.revoked++; revoke(url) }
  window.binding = {
    service: { apiVersion: 2, capabilities: ['packs', 'figures'], subscribe: () => () => {},
      listPackSummaries: async () => packs.map(view), getPackSnapshot: async ({ packId }) => { await wait(20); return view(byId(packId)) },
      patchPack: async ({ packId, patch }) => { const p = byId(packId); Object.assign(p.manifest, clone(patch || {})); window.calls.push(['patchPack', clone(patch)]); p.revision = 'r' + (++rev); return { status: 'ok', snapshot: view(p) } } },
    rpc: async method => { window.calls.push([method]); throw new Error('mock: ' + method) },
    previewMedia: async ({ packId, hash }) => { window.leases.held++; return { url: objectUrls.get(hash) || '/media/' + packId + '/' + hash, release() { window.leases.released++ } } },
    globalEnabledPackIds: [], loadSettings: async () => {}, onSettings: () => () => {}, download() {}
  }
  window.views = createForkAssetPackUI(React, { VoicePicker: () => null, AvatarImage: ForkPackImage, HelpTip: ForkHelpTip })
  window.root = ReactDOM.createRoot(document.getElementById('panel'))
  const ctx = { binding: window.binding, ext: { assetBindings: { boundPackIds: [] } }, packs: packs.map(view) }
  window.openCg = packId => window.root.render(h(window.views.PackModal, { key: Math.random(), binding: window.binding, packId, initial: { kind: 'cg' }, packs: packs.map(view), ctx, onClose() {} }))
}

export async function run() {
  const { chromium } = await import('playwright')
  let { source, picker, playback } = await stageSource()
  const cgUi = option('cg-ui') ? await readFile(option('cg-ui'), 'utf8') : await client('fork-asset-pack-cg-ui.js')
  source = source.split('// @include fork-asset-pack-cg-ui.js').join(cgUi)
  source = source.split('// @include-protocol asset-variant-table.cjs').join(await readFile(path.join(root, 'tavern-plugin/packages/dsh-presentation-protocol/src/asset-variant-table.cjs'), 'utf8'))
  // The stage's CG consumer and painter sit in the same bundle scope as the asset views (main.js); a foreground clock stub.
  const stage = await client('fork-cg-stage.js')
  const cg = (await client('fork-cg-consumer.cjs')) + '\n' + stage.slice(stage.indexOf('function forkCgPaintFrame'), stage.indexOf('// @include fork-cg-gallery.js'))
  const clock = 'var forkForeground={now:()=>performance.now(),requestAnimationFrame:f=>requestAnimationFrame(f),cancelAnimationFrame:i=>cancelAnimationFrame(i),isForeground:()=>true,media:n=>n};'
  source = clock + cg + '\n' + await client('fork-settings-ui.js') + '\n' + source
  const css = option('theme-css') ? await readFile(path.join(root, 'tavern-plugin/packages/dsh-tavern-ui/src/shell.css'), 'utf8') + '\n' + await readFile(option('theme-css'), 'utf8') + '\n' + surfaces.css() : await forkThemeCss()
  const ids = (await readdir(LIVE)).filter(name => /^[0-9a-f-]{36}$/.test(name))
  const packs = []; for (const id of ids) if (await exists(LIVE + '/' + id + '/manifest.json')) packs.push(await snapshot(id))
  // A second CG in memory only: the real picture, a second wide and a tall synthetic 差分, one focus (never written).
  const fish = packs.find(p => p.manifest.id === DAFEIYU), cgAsset = fish.manifest.assets.find(a => a.kind === 'cg')
  fish.manifest.blobs = { ...fish.manifest.blobs, [SYNTH.wide]: { ext: 'png', mime: 'image/png' }, [SYNTH.tall]: { ext: 'png', mime: 'image/png' } }
  fish.manifest.assets.push({ ...structuredClone(cgAsset), id: 'harness-many', name: 'CG·差分示例', directorNote: '大肥鱼在屏幕前一边扒饭一边看视频',
    recall: { mode: 'keyword', keywords: ['吃饭', '电脑'] },
    variants: { default: 'v0', entries: [['扒饭', '低头扒饭', cgAsset.variants.entries[0].content.media], ['换图', '抬头看屏幕', SYNTH.wide], ['竖图', '竖构图的差分', SYNTH.tall]].map(([name, description, media], i) => ({ id: 'v' + i, name, content: { description, media, focusHints: [{ key: 'face', label: '脸', x: 0.45, y: 0.35, zoom: 1.8 }] } })) } })
  await mkdir(outDir, { recursive: true })
  const tag = option('tag') || 'shot', sizes = option('size') ? option('size').split(',') : ['desktop', '375'], themes = option('theme') ? [option('theme')] : ['dark']
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio'] })
  const shots = [], errors = [], metrics = []
  const listings = new Map()
  const mediaFile = async (id, hash) => {
    const dir = LIVE + '/' + id + '/media/'
    if (!listings.has(dir)) listings.set(dir, readdir(dir).then(names => new Map(names.map(n => [n.split('.')[0], n]))).catch(() => new Map()))
    const hit = (await listings.get(dir)).get(hash); return hit ? dir + hit : null
  }
  try {
    for (const theme of themes) for (const size of sizes) {
      const viewport = size === '375' ? { width: 375, height: 812 } : { width: 1280, height: 860 }
      const page = await browser.newPage({ viewport, deviceScaleFactor: size === '375' ? 2 : 1, hasTouch: size === '375' })
      const where = theme + '/' + size
      page.on('pageerror', e => errors.push(where + ': ' + e.message))
      page.on('console', m => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errors.push(where + ' console: ' + m.text()) })
      await page.route('http://127.0.0.1:47932/**', async route => {
        const p = decodeURIComponent(new URL(route.request().url()).pathname), media = p.match(/^\/media\/([0-9a-f-]{36})\/([0-9a-f]{64})$/)
        if (media) { const file = await mediaFile(media[1], media[2]); return file ? route.fulfill({ contentType: /\.webp$/.test(file) ? 'image/webp' : /\.png$/.test(file) ? 'image/png' : /\.jpe?g$/.test(file) ? 'image/jpeg' : 'application/octet-stream', body: await readFile(file) }) : route.fulfill({ status: 404, body: 'nf' }) }
        if (p.startsWith('/api/')) return route.fulfill({ status: 404, body: 'nf' })
        return route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"></head><body><div id="panel"></div></body></html>' })
      })
      await page.goto('http://127.0.0.1:47932/')
      await page.addStyleTag({ content: css + `html, body { margin: 0; } body { ${THEMES[theme]} background: var(--page); font-family: "Microsoft YaHei UI", "PingFang SC", sans-serif; }` })
      await page.evaluate(context => { document.body.dataset.fkContext = context }, 'chat-' + theme)
      await page.addScriptTag({ content: await browserReactScript() + ';window.React=modules.react;window.ReactDOM={...modules["react-dom"],...modules["react-dom/client"]};' + playback + source + picker })
      await page.evaluate(pageSetup, { packs, synth: SYNTH })
      const shot = async (name, { wait = 500, mouse = true } = {}) => { const file = path.join(outDir, `${tag}-${name}-${theme}-${size}.png`); if (mouse) await page.mouse.move(viewport.width - 1, 0); await page.waitForTimeout(wait); await page.screenshot({ path: file }); shots.push(file) }
      const guard = async name => {
        const text = await page.locator('body').innerText()
        if (/[0-9a-f]{8}-[0-9a-f]{4}-/.test(text)) errors.push(where + ' ' + name + ': UUID visible')
        const natives = await page.locator('.ap-cg-editor select, .ap-cg-editor input[type=range], .ap-cg-editor input[type=checkbox], .ap-cg-editor input[type=number], .ap-cg-editor fieldset').count()
        if (natives) errors.push(where + ' ' + name + ': ' + natives + ' native controls')
        metrics.push({ where, name, ...(await page.evaluate(() => {
          const pane = document.querySelector('.ap-cg-editor'); if (!pane) return { pane: false }
          const r = pane.getBoundingClientRect(), wide = [...pane.querySelectorAll('*')].filter(el => el.getBoundingClientRect().right > r.right + 1 && getComputedStyle(el).position !== 'fixed' && !el.closest('.ap-cg-hero')).length
          const frame = document.querySelector('.ap-cg-frame'), small = [...pane.querySelectorAll('.ap-cg-hero-tools button, .ap-cg-frame-handle')].map(el => el.getBoundingClientRect()).filter(b => b.width && Math.min(b.width, b.height) < 30).length
          return { safe: !!document.querySelector('.ap-cg-safe'), overflow: wide, small, frame: frame?.getAttribute('aria-valuetext') || null, mode: document.querySelector('.ap-cg-hero')?.dataset.mode || null }
        })) })
      }
      const step = async (name, act, opts) => { try { await act(); await guard(name); await shot(name, opts) } catch (e) { metrics.push({ where, name, skipped: e.message.split('\n')[0] }) } }
      const scrollTop = () => page.evaluate(() => { const el = document.querySelector('.ap-pack-right'); if (el) el.scrollTop = 0; document.querySelector('.ap-cg-hero')?.scrollIntoView({ block: 'start' }) })
      await page.evaluate(id => window.openCg(id), DAFEIYU)
      await page.waitForTimeout(1500); if (!(await page.getByRole('dialog').count())) throw new Error('no dialog: ' + errors.join(' | '))
      await page.locator('.ap-items .ap-item-main', { hasText: 'CG·差分示例' }).click(); await page.waitForTimeout(900)
      await scrollTop(); await guard('01-open'); await shot('01-open', { wait: 900 })
      const hero = page.locator('.ap-cg-hero'), heroBox = async () => hero.boundingBox()
      await step('02-focus', async () => { await page.getByRole('button', { name: '脸', exact: true }).click({ timeout: 1500 }); await scrollTop() })
      await step('02b-focus-section', async () => { await page.evaluate(() => { const el = document.querySelector('.ap-pack-right'); if (el) el.scrollTop = el.scrollHeight; document.querySelector('.ap-cg-focus-detail')?.scrollIntoView({ block: 'end' }) }) })
      await scrollTop()
      // Composition: drag the frame, click elsewhere, wheel and the corner handle, then keys.
      await step('03-drag', async () => {
        const f = await page.locator('.ap-cg-frame').boundingBox({ timeout: 1500 }); if (!f) throw new Error('no frame')
        await page.mouse.move(f.x + f.width / 2, f.y + f.height / 2); await page.mouse.down(); await page.mouse.move(f.x + f.width / 2 + 60, f.y + f.height / 2 + 25, { steps: 8 }); await page.mouse.up()
      }, { mouse: false })
      await step('04-wheel', async () => { const b = await heroBox(); await page.mouse.move(b.x + b.width * 0.3, b.y + b.height * 0.4); await page.mouse.wheel(0, 240); await page.waitForTimeout(100) }, { mouse: false })
      await step('05-handle', async () => {
        const f = await page.locator('.ap-cg-frame-handle').boundingBox({ timeout: 1500 }); await page.mouse.move(f.x + f.width / 2, f.y + f.height / 2); await page.mouse.down(); await page.mouse.move(f.x - 40, f.y - 25, { steps: 6 }); await page.mouse.up()
      }, { mouse: false })
      await step('06-keys', async () => { await page.locator('.ap-cg-frame').focus({ timeout: 1500 }); for (const key of ['Shift+ArrowLeft', 'ArrowUp', '+']) await page.keyboard.press(key) }, { mouse: false })
      await step('07-phone-view', async () => { await page.getByRole('radio', { name: '手机' }).click({ timeout: 1500 }) })
      await step('08-tall', async () => { await page.getByRole('button', { name: '竖图', exact: true }).click({ timeout: 1500 }); await scrollTop() })
      await step('09-tall-pc', async () => { await page.getByRole('radio', { name: '电脑' }).click({ timeout: 1500 }); await page.getByRole('button', { name: '完整图', exact: true }).click({ timeout: 1500 }) })
      if (size === '375') await step('09b-touch-drag', async () => {
        await page.getByRole('button', { name: '脸', exact: true }).click({ timeout: 1500 }); await scrollTop()
        const f = await page.locator('.ap-cg-frame').boundingBox(), cdp = await page.context().newCDPSession(page), at = (x, y) => [{ x, y, id: 1 }]
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(f.x + f.width / 2, f.y + f.height / 2) })
        for (let i = 1; i <= 6; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at(f.x + f.width / 2 - i * 6, f.y + f.height / 2) })
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      }, { mouse: false })
      // Motion preview: enter, pan to 脸, cross-fade to 换图, exit (Esc), back to composition.
      await step('10-play-enter', async () => {
        await page.getByRole('button', { name: /^扒饭/ }).click({ timeout: 1500 }); await page.getByRole('button', { name: '完整图', exact: true }).click(); await scrollTop()
        await page.getByRole('button', { name: '预览动效' }).click({ timeout: 1500 }); await page.waitForTimeout(140)
      }, { wait: 0 })
      await step('11-play-full', async () => {}, { wait: 600 })
      await step('12-play-pan-mid', async () => { await page.getByRole('button', { name: '脸', exact: true }).click({ timeout: 1500 }); await scrollTop(); await page.waitForTimeout(1600) }, { wait: 0 })
      await step('13-play-pan-end', async () => {}, { wait: 2900 })
      await step('14-play-variant', async () => { await page.getByRole('button', { name: '换图', exact: true }).click({ timeout: 1500 }); await scrollTop(); await page.waitForTimeout(60) }, { wait: 0 })
      await step('15-play-variant-end', async () => {}, { wait: 500 })
      await step('16-play-exit', async () => { await page.getByRole('button', { name: '结束预览' }).focus({ timeout: 1500 }); await page.keyboard.press('Escape'); await page.waitForTimeout(90) }, { wait: 0 })
      await step('17-back', async () => {}, { wait: 600 })
      const after = await page.evaluate(() => ({ dialog: !!document.querySelector('[role=dialog]'), mode: document.querySelector('.ap-cg-hero')?.dataset.mode || null, stage: document.querySelectorAll('.ap-cg-hero .fork-cg-stage').length, calls: window.calls.map(c => c[0]), leases: window.leases, revoked: window.revoked, save: !!document.querySelector('.ap-cg-savebar') }))
      metrics.push({ where, name: 'after-motion', ...after })
      if (after.mode === 'compose' && after.stage) errors.push(where + ': motion surface left mounted')
      if (after.calls.some(m => m !== 'patchPack')) errors.push(where + ': preview called ' + after.calls.join(','))
      if (after.mode && !after.dialog) errors.push(where + ': Esc closed the pack window instead of the preview')
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
