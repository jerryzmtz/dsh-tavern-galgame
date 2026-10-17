// private fork (pack row hit area, owner 2026-10): offline hit map of the pack rows. Chromium renders 闊槫床隶ｾ鄂ｮ 窶ｺ 邏譚仙桁
// (StagePanel, rows with previews) and the 邏譚仙ｺ・list (App with a card), samples points across every row and really clicks
// each one: green = opens the pack, blue = the state chip's menu, grey = another control of the row (not clicked), red =
// nothing. Then it shoots the row hover background and the keyboard focus ring. Synthetic data only, no live service.
// Usage: node tests/harness/pack-row-hit.mjs [outDir] [--prefix=before-]
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { browserReactScript } from '../fixtures/browser-react.mjs'
import { forkThemeCss } from '../helpers/fork-theme-css.mjs'
import { stageSource, pageSetup as stageSetup, THEMES } from './card-centric-stage.mjs'
import { hostPieces, r5Setup } from './stage-panel-r5.mjs'
import { pageSetup as librarySetup } from './pack-chip.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const args = process.argv.slice(2), option = (name, fallback) => args.find(a => a.startsWith('--' + name + '='))?.split('=').slice(1).join('=') || fallback

// Every row of the list: sample points, classify, click the ones that land on the row itself or its name / chip.
async function hitMap(page, rowSelector) {
  const rows = await page.locator(rowSelector).evaluateAll(nodes => nodes.map(n => { const r = n.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height } }))
  const points = []
  for (const r of rows) for (const fy of [0.2, 0.5, 0.8]) for (let x = r.x + 3; x < r.x + r.w - 2; x += 10) points.push({ x: Math.round(x), y: Math.round(r.y + r.h * fy) })
  const result = []
  for (const p of points) {
    const kind = await page.evaluate(({ x, y }) => {
      const el = document.elementFromPoint(x, y), row = el?.closest?.('.ap-pack-row, .ap-mod-row')
      if (!row) return 'none'
      const control = el.closest('button, a, input, label, [role=checkbox]')
      if (control && !control.matches('.ap-pack-name, .ap-state-tag, .fork-inline-trigger.is-link')) return 'other'
      return 'click'
    }, p)
    if (kind !== 'click') { result.push({ ...p, kind }); continue }
    const before = await page.evaluate(() => document.querySelectorAll('.ap-modal').length)
    await page.mouse.click(p.x, p.y); await page.waitForTimeout(60)
    // 模组库: a mod opens in place (the list gives way to its detail); window.restoreList brings the list back.
    if (await page.evaluate(sel => !document.querySelector(sel), rowSelector)) { result.push({ ...p, kind: 'open' }); await page.evaluate(() => window.restoreList()); await page.locator(rowSelector).first().waitFor(); continue }
    const after = await page.evaluate(() => ({ modals: document.querySelectorAll('.ap-modal').length, menu: [...document.querySelectorAll('[role=menu]')].some(m => m.offsetParent || m.getClientRects().length) }))
    const outcome = after.modals > before ? 'open' : after.menu ? 'menu' : 'none'
    result.push({ ...p, kind: outcome })
    if (outcome !== 'none') {
      for (let i = 0; i < 4; i++) {
        await page.keyboard.press('Escape'); await page.waitForTimeout(60)
        const left = await page.evaluate(n => document.querySelectorAll('.ap-modal').length > n || [...document.querySelectorAll('[role=menu]')].some(m => m.getClientRects().length), before)
        if (!left) break
      }
    }
  }
  await page.evaluate(points => {
    const layer = document.createElement('div'); layer.id = 'hit-layer'; layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:99999'
    const colors = { open: '#18b04a', menu: '#2f6cf0', other: '#8a8f99', none: '#e23b3b' }
    for (const p of points) { const d = document.createElement('i'); d.style.cssText = `position:absolute;left:${p.x - 3}px;top:${p.y - 3}px;width:6px;height:6px;border-radius:50%;background:${colors[p.kind]};opacity:.85`; layer.append(d) }
    document.body.append(layer)
  }, result)
  const count = kind => result.filter(p => p.kind === kind).length
  return { open: count('open'), menu: count('menu'), other: count('other'), none: count('none') }
}

export async function mount(browser, { theme, tokens, viewport, surface }) {
  const { source, picker, playback } = await stageSource()
  const css = await forkThemeCss(), page = await browser.newPage({ viewport, deviceScaleFactor: 2 }), errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.route('http://hit.test/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"></head><body class="dsh-tavern-shell-active"><div class="host"><main class="chat"></main><section class="pane" data-sidebar-right-panel><div id="panel"></div></section></div></body></html>' }))
  await page.goto('http://hit.test/')
  const narrow = viewport.width < 600
  await page.addStyleTag({ content: css + `
    html, body { margin: 0; height: 100%; } body { ${tokens} background: var(--page); font-family: "Microsoft YaHei UI", "PingFang SC", sans-serif; }
    .host { display: flex; height: 100vh; } .chat { flex: 1; background: var(--page); ${narrow ? 'display: none;' : ''} }
    .pane { width: ${narrow ? '100%' : surface === 'stage' ? '720px' : '420px'}; flex: none; height: 100%; overflow: auto; border-left: 1px solid var(--fork-hairline); background: var(--fork-surface); container-type: inline-size; }
    #panel { display: flex; flex-direction: column; min-height: 100%; ${surface !== 'stage' ? 'padding: 0 12px; box-sizing: border-box;' : ''} }` })
  await page.evaluate(context => { document.body.dataset.fkContext = context }, 'chat-' + theme)
  if (surface === 'stage') {
    const pieces = await hostPieces()
    await page.addScriptTag({ content: await browserReactScript() + ';window.React=modules.react;window.ReactDOM={...modules["react-dom/client"],createPortal:modules["react-dom"].createPortal};' + playback + source + picker + '\n;\n' + pieces + '\n;window.forkStagePrompts=forkStagePrompts;window.ForkHelpTip=ForkHelpTip;' })
    await page.evaluate(stageSetup)
    await page.evaluate(() => { window.scenario('main') })
    await page.evaluate(r5Setup)
    // The fixture's entries carry no recall; the pack modal (opened here for real) needs one.
    await page.evaluate(() => { const s = window.binding.service, snap = s.getPackSnapshot
      s.getPackSnapshot = async a => { const p = await snap(a); for (const asset of p.manifest.assets) { asset.recall ||= { mode: 'keyword', keywords: [] }; asset.directorNote ??= '' } return p } })
    await page.evaluate(() => window.showReal('hit'))
    await page.locator('.ap-pack-section li.ap-pack-row').first().waitFor()
  } else {
    await page.addScriptTag({ content: await browserReactScript() + ';window.React=modules.react;window.ReactDOM={...modules["react-dom"],...modules["react-dom/client"]};' + playback + source + picker })
    await page.evaluate(librarySetup)
    await page.evaluate(() => window.showLibrary())
    await page.locator('button.ap-state-tag[data-state=card]').first().waitFor()
    if (surface === 'mods') {
      // 模组库 list: two installed mods (a mod's detail is not needed — opening is seen as the list giving way).
      await page.evaluate(() => { const h = React.createElement, views = createForkAssetPackUI(React, { VoicePicker: ForkBubbleLibraryPicker, AvatarImage: ForkPackImage })
        const rpc = async method => { if (method === 'listMods') return { revision: 'r1', mods: [{ id: 'phone', name: '手机', scope: 'global', authorized: true }, { id: 'items', name: '物品演出', scope: 'off', authorized: true }] }; throw Object.assign(new Error(method), { code: 'MOD_RESOURCE_UNAVAILABLE' }) }
        const node = document.createElement('div'); node.id = 'mods'; document.getElementById('panel').replaceChildren(node)
        const root = ReactDOM.createRoot(node); let n = 0; window.restoreList = () => root.render(h(views.ModLibrary, { key: ++n, rpc })); window.restoreList() })
      await page.locator('.ap-mod-row').first().waitFor()
    }
  }
  await page.waitForTimeout(700)
  return { page, errors }
}

export async function run({ outDir = path.join(root, '.tmp/pack-row-hit'), prefix = '' } = {}) {
  const { chromium } = await import('playwright')
  await mkdir(outDir, { recursive: true })
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  const shots = [], errors = [], results = {}
  const layouts = [['stage', 'desktop', { width: 1280, height: 900 }], ['stage', '375', { width: 375, height: 812 }], ['library', 'side', { width: 900, height: 700 }], ['library', '375', { width: 375, height: 760 }], ['mods', 'side', { width: 900, height: 700 }]]
  try {
    for (const [surface, size, viewport] of layouts) {
      const theme = 'light', tag = surface + '/' + size
      const { page, errors: pageErrors } = await mount(browser, { theme, tokens: THEMES[theme], viewport, surface })
      const list = surface === 'stage' ? page.locator('.ap-pack-section') : surface === 'mods' ? page.locator('.ap-mod-library') : page.locator('.ap-pack-list').first()
      const rowSelector = surface === 'stage' ? '.ap-pack-section li.ap-pack-row' : surface === 'mods' ? '.ap-mod-row' : '.ap-pack-list li.ap-pack-row'
      await list.scrollIntoViewIfNeeded()
      results[tag] = await hitMap(page, rowSelector)
      const shot = async name => { const file = path.join(outDir, `${prefix}${surface}-${size}-${name}.png`); await list.screenshot({ path: file }); shots.push(file) }
      await shot('hitmap')
      await page.evaluate(() => document.getElementById('hit-layer')?.remove())
      // Hover: the pointer in the empty space between the previews and the chip.
      const row = page.locator(rowSelector).first(), box = await row.boundingBox(), chip = await row.locator('.ap-state-tag').boundingBox()
      await page.mouse.move(chip.x - 12, box.y + box.height / 2); await page.waitForTimeout(150)
      results[tag].hoverCursor = await page.evaluate(({ x, y }) => getComputedStyle(document.elementFromPoint(x, y)).cursor, { x: chip.x - 12, y: box.y + box.height / 2 })
      await shot('hover')
      // Keyboard: Tab onto the first row's name, then Enter must open it.
      await page.mouse.move(1, 1)
      await row.locator('.ap-pack-name, .fork-inline-trigger').first().evaluate(n => n.blur())
      await page.evaluate(sel => { const r = document.querySelector(sel); const prev = r.querySelector('.ap-pack-name, .fork-inline-trigger.is-link'); const marker = document.createElement('button'); marker.id = 'tab-start'; marker.style.cssText = 'position:fixed;left:-99px'; document.body.prepend(marker); marker.focus(); prev.dataset.target = '1' }, rowSelector)
      for (let i = 0; i < 40 && !(await page.evaluate(() => document.activeElement?.dataset?.target === '1')); i++) await page.keyboard.press('Tab')
      results[tag].focused = await page.evaluate(() => document.activeElement?.dataset?.target === '1')
      await shot('focus')
      const before = await page.evaluate(() => document.querySelectorAll('.ap-modal').length)
      await page.keyboard.press('Enter'); await page.waitForTimeout(150)
      results[tag].enterOpens = await page.evaluate(({ n, sel }) => document.querySelectorAll('.ap-modal').length > n || !document.querySelector(sel), { n: before, sel: rowSelector })
      await page.keyboard.press('Escape'); await page.waitForTimeout(100)
      for (const e of pageErrors) errors.push(tag + ': ' + e)
      await page.close()
    }
  } finally { await browser.close() }
  return { shots, errors, results }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const outDir = args.find(a => !a.startsWith('--'))
  const { shots, errors, results } = await run({ outDir, prefix: option('prefix', '') })
  for (const [tag, r] of Object.entries(results)) console.log(tag, JSON.stringify(r))
  console.log(shots.length + ' screenshots 竊・' + (outDir || '.tmp/pack-row-hit'))
  if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1 }
}
