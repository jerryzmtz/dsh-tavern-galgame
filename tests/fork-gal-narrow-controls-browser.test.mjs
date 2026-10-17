// Private fork (docs/fork/stage-reading-controls.md §2.4, owner 2026-10): on phones (≤ 480 px; checked at 375 × 812)
// the control row under the text box shows only 自动 / 跳过 / 履历 / ≡, each a ≥ 44 px touch target; 隐藏文本框,
// 上一页, 设置 and 返回主页面 are reachable in the ≡ system menu; the top bar's buttons are 44 px and never overlap the
// place / BGM line (one truncated line). Desktop keeps the full eight-control row. Renders the real
// forkGalControlIds / useForkGalNarrow, ForkGalHudLabels, ForkGalMenu and ForkIcon with production CSS.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { browserReactScript } from './fixtures/browser-react.mjs'
import { forkThemeCss } from './helpers/fork-theme-css.mjs'

const read = file => readFile(new URL('../' + file, import.meta.url), 'utf8')
const css = await forkThemeCss()
const stage = await read('tavern-plugin/src/client/fork-gal-stage.js')
const menu = await read('tavern-plugin/src/client/fork-gal-menu.js')
const settingsUI = await read('tavern-plugin/src/client/fork-settings-ui.js')
const icons = settingsUI.slice(settingsUI.indexOf('const FORK_ICON_PATHS'), settingsUI.indexOf('function ForkIcon'))
const iconExtras = stage.split('\n').filter(line => line.startsWith('if (typeof FORK_ICON_PATHS === "object"')).join('\n')
const forkIcon = settingsUI.slice(settingsUI.indexOf('function ForkIcon'), settingsUI.indexOf('// Foldable settings sections'))
const controls = stage.slice(stage.indexOf('const FORK_GAL_NARROW_QUERY'), stage.indexOf('// private fork: HUD change moments'))
const hud = stage.slice(stage.indexOf('function forkGalHudStep('), stage.indexOf('// Name plate of the text box'))

test('private fork: narrow stage keeps four 44 px controls, the rest in ≡, and a non-overlapping top bar', { timeout: 60000 }, async () => {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 375, height: 812 }, hasTouch: true })
    const errors = []
    page.on('pageerror', error => errors.push(String(error)))
    await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${css}</style><style>
      html, body { margin: 0; } *, *::before, *::after { animation-duration: 0s !important; animation-delay: 0s !important; transition: none !important; }
      #root { position: fixed; inset: 0; overflow: hidden; background: #335; }</style></head>
      <body class="dsh-tavern-shell-active"><div class="fork-gal-stage" id="root" data-theme="classic" data-fk-context="stage-classic"></div></body></html>`)
    await page.addScriptTag({ content: await browserReactScript() })
    await page.addScriptTag({ content: `
      const React = modules.react, ReactDOM = Object.assign({}, modules['react-dom'], modules['react-dom/client']);
      const forkStageSessions = { get: () => null };
      const forkUiSfx = { play() { return true }, preload() {}, bind: () => () => {} };
      ${icons}
      ${iconExtras}
      ${forkIcon}
      ${controls}
      ${hud}
      ${menu}
      const ICONS = { config: 'gear', menu: 'menu' };
      function Stage() {
        const h = React.createElement, narrow = useForkGalNarrow();
        const [menuOpen, setMenu] = React.useState(false), [log, setLog] = React.useState([]);
        const act = name => () => { setMenu(false); setLog(list => list.concat(name)); };
        return h(React.Fragment, null,
          h('div', { className: 'fork-gal-topbar' },
            h('div', { className: 'fork-gal-topleft' },
              h('span', { className: 'fork-gal-history-indicator', 'data-historical': true }, '第 126 / 129 轮'),
              h(ForkGalHudLabels, { place: '见泷原中学·天台的长长走廊', track: { name: 'Sis puella magica! (Extended)' }, scope: 's', live: false, music: { ref: null, open: false, paused: false, toggle() {} } }),
              h('div', { className: 'fork-gal-mixer' }, h('button', { type: 'button', className: 'fork-gal-mixer-toggle', 'aria-label': '混音' }, h(ForkIcon, { name: 'speaker', size: 16 })))),
            h('div', { className: 'fork-gal-topright' },
              h('button', { type: 'button', className: 'fork-gal-film', 'aria-label': '电影模式' }, h(ForkIcon, { name: 'film', size: 16 })),
              h('button', { type: 'button', className: 'fork-gal-quality', 'data-quality': 'high', 'aria-label': '特效' }, h(ForkIcon, { name: 'sparkle', size: 16 })),
              h('button', { type: 'button', className: 'fork-gal-quit', 'aria-label': '返回主页面' }, h(ForkIcon, { name: 'close', size: 16 })))),
          h('div', { className: 'fork-gal-box', role: 'region' },
            h('div', { className: 'fork-gal-name' }, h('b', null, '【鹿目圆】')),
            h('div', { className: 'fork-gal-text' }, h('span', null, '他站在空荡荡的人行道上，听着那团光一点一点安静下来，睡着了。')),
            h('div', { className: 'fork-gal-meta' }, h('span', null, '169 / 173')),
            h('div', { className: 'fork-gal-controls', role: 'toolbar', 'data-compact': narrow || undefined },
              forkGalControlIds(narrow).map(id => h('button', { key: id, type: 'button', className: 'fork-gal-control' + (id === 'menu' ? ' fork-gal-menu-toggle' : ''), 'data-id': id, 'aria-label': id,
                onClick: id === 'menu' ? () => setMenu(true) : undefined }, h(ForkIcon, { name: ICONS[id] || id, size: 17 }))))),
          h('output', { id: 'log' }, log.join(',')),
          menuOpen ? h(ForkGalMenu, { sessionId: 's', historical: true, latestTurn: 129, narrow, backDisabled: false,
            onClose: () => setMenu(false), onBacklog: act('backlog'), onGallery: act('gallery'), onHide: act('hide'), onBack: act('back'),
            onConfig: act('config'), onLatest: act('latest'), onKeys: act('keys'), onLeave: act('leave') }) : null);
      }
      ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Stage));
    ` })
    await page.waitForSelector('.fork-gal-controls .fork-gal-control')
    await page.evaluate(() => document.fonts.ready)
    const rect = selector => page.$$eval(selector, els => els.map(el => { const r = el.getBoundingClientRect(); return { id: el.dataset.id || el.className, x: r.x, y: r.y, w: r.width, h: r.height, visible: r.width > 0 && getComputedStyle(el).visibility !== 'hidden' } }))
    const intersects = (a, b) => a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5

    // 1. Four primary controls, each ≥ 44 × 44, inside the text box, not overlapping each other or the page count.
    const row = await rect('.fork-gal-controls .fork-gal-control')
    assert.deepEqual(row.map(item => item.id), ['auto', 'skip', 'backlog', 'menu'])
    for (const item of row) assert.ok(item.visible && item.w >= 44 && item.h >= 44, 'touch target ' + JSON.stringify(item))
    for (let i = 1; i < row.length; i++) assert.ok(!intersects(row[i - 1], row[i]), 'controls overlap')
    const [box] = await rect('.fork-gal-box'), [meta] = await rect('.fork-gal-meta span')
    for (const item of row) assert.ok(item.x >= box.x && item.x + item.w <= box.x + box.w && item.y + item.h <= 812, 'on the box, on screen ' + JSON.stringify({ item, box }))
    // The whole 44 px target takes the tap, also the part under the box's lower edge.
    const hits = await page.$$eval('.fork-gal-controls .fork-gal-control', els => els.map(el => { const r = el.getBoundingClientRect(); return [[r.x + r.width / 2, r.y + 3], [r.x + r.width / 2, r.bottom - 3], [r.x + 3, r.y + r.height / 2], [r.x + r.width / 2, r.y + r.height / 2]].map(([x, y]) => { const hit = document.elementFromPoint(x, y); return el.contains(hit) || (hit ? hit.tagName + '.' + hit.className : 'none') }) }).map(list => list.every(item => item === true) || list.join(' | ')))
    assert.deepEqual(hits, [true, true, true, true])
    for (const item of row) assert.ok(!intersects(item, meta), 'page count readable ' + JSON.stringify({ item, meta }))
    const [text] = await rect('.fork-gal-text > span')
    for (const item of row) assert.ok(!intersects(item, text), 'controls clear the text ' + JSON.stringify({ item, text }))
    // A full page fills the text column down to the box's bottom padding (pages are cut to fit it): the controls may
    // reach into the last line box's empty half-leading, never into its glyphs.
    const column = await page.$eval('.fork-gal-text', text => {
      const box = text.closest('.fork-gal-box'), cs = getComputedStyle(text), size = parseFloat(cs.fontSize)
      const lineHeight = cs.lineHeight === 'normal' ? size * 1.2 : parseFloat(cs.lineHeight)
      return { inkBottom: box.getBoundingClientRect().bottom - parseFloat(getComputedStyle(box).paddingBottom) - (lineHeight - size) / 2 }
    })
    for (const item of row) assert.ok(item.y >= column.inkBottom, 'a full last line stays clear of the controls ' + JSON.stringify({ column, item }))

    // 2. The moved controls are reachable in ≡.
    await page.tap('[data-id="menu"]')
    await page.waitForSelector('.fork-gal-menu-item')
    const items = await page.$$eval('.fork-gal-menu-item', els => els.map(el => el.dataset.item))
    for (const id of ['hide', 'back', 'config', 'leave']) assert.ok(items.includes(id), id + ' in the menu: ' + items)
    for (const id of ['hide', 'back', 'config', 'leave']) {
      if (!await page.$('.fork-gal-menu-item')) { await page.tap('[data-id="menu"]'); await page.waitForSelector('.fork-gal-menu-item') }
      const [item] = await rect(`.fork-gal-menu-item[data-item="${id}"]`)
      assert.ok(item.visible && item.h >= 44, id + ' menu target ' + JSON.stringify(item))
      await page.tap(`.fork-gal-menu-item[data-item="${id}"]`)
    }
    assert.equal(await page.textContent('#log'), 'hide,back,config,leave')

    // 3. Top bar: 44 px buttons; no two top-bar pieces intersect; the place / BGM line truncates on one line.
    const top = await rect('.fork-gal-topbar :is(.fork-gal-history-indicator, .fork-gal-hud-line, .fork-gal-mixer-toggle, .fork-gal-film, .fork-gal-quality, .fork-gal-quit)')
    assert.equal(top.length, 6)
    for (const item of top.filter(item => /mixer-toggle|film|quality|quit/.test(item.id))) assert.ok(item.w >= 44 && item.h >= 44, 'top target ' + JSON.stringify(item))
    for (let i = 0; i < top.length; i++) for (let j = i + 1; j < top.length; j++) assert.ok(!intersects(top[i], top[j]), 'top bar overlap ' + JSON.stringify([top[i], top[j]]))
    for (const item of top) assert.ok(item.x >= 0 && item.x + item.w <= 375.5, 'inside the screen ' + JSON.stringify(item))
    const line = await page.$eval('.fork-gal-hud-line', el => ({ lines: new Set([...el.children].map(child => (r => Math.round(r.top + r.height / 2))(child.getBoundingClientRect()))).size,
      truncated: [...el.querySelectorAll('.fork-gal-place-name, .fork-gal-track-name')].some(child => child.scrollWidth > child.clientWidth) }))
    if (process.env.NARROW_SHOT) await page.screenshot({ path: process.env.NARROW_SHOT })
    assert.deepEqual(line, { lines: 1, truncated: true })
    const placeName = await rect('.fork-gal-place, .fork-gal-track')
    for (const item of placeName) for (const other of top.filter(item => /mixer-toggle|film|quality|quit|history/.test(item.id))) assert.ok(!intersects(item, other), 'label under a button ' + JSON.stringify([item, other]))

    // 4. Desktop unchanged: the full eight-control row at the old size, the HUD line is layout-neutral.
    await page.setViewportSize({ width: 1920, height: 1080 })
    await page.waitForFunction(() => document.querySelectorAll('.fork-gal-controls .fork-gal-control').length === 8)
    const wide = await rect('.fork-gal-controls .fork-gal-control')
    assert.deepEqual(wide.map(item => item.id), ['auto', 'skip', 'eye-off', 'chevron-left', 'backlog', 'config', 'menu', 'chat'])
    for (const item of wide) assert.equal(item.w, 28)
    assert.equal(await page.$eval('.fork-gal-hud-line', el => getComputedStyle(el).display), 'contents')
    assert.equal(await page.$eval('.fork-gal-quit', el => el.getBoundingClientRect().width), 30)
    assert.deepEqual(errors, [])
  } finally { await browser.close() }
})
