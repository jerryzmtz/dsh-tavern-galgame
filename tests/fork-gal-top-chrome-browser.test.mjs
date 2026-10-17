// Private fork (owner 2026-10, docs/fork/ui-design.md "舞台顶栏"): the stage top chrome - place, BGM chip, mixer, the
// history chip, the top-right buttons and the runtime notice - has no plates. Every control shares one height and
// icon size; at rest they are transparent and stay legible over any scene through a halo in the theme's HUD paint;
// only hover / keyboard focus draws a solid chip. Renders the real ForkGalHudLabels and ForkGalRuntimeStatus with
// production CSS (fork-theme.css + surface table) over a bright daytime and a dark night background in every theme.
// Screenshots: set TOP_CHROME_SHOTS to an isolated directory; TOP_CHROME_SHOTS_ONLY=1 skips asserts.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'
import { browserReactScript } from './fixtures/browser-react.mjs'
import { forkThemeCss } from './helpers/fork-theme-css.mjs'

const read = file => readFile(new URL('../' + file, import.meta.url), 'utf8')
const css = await forkThemeCss()
const stage = await read('tavern-plugin/src/client/fork-gal-stage.js')
const mixer = await read('tavern-plugin/src/client/fork-gal-mixer.js')
const runtime = await read('tavern-plugin/src/client/fork-stage-runtime.cjs')
const settingsUI = await read('tavern-plugin/src/client/fork-settings-ui.js')
const icons = settingsUI.slice(settingsUI.indexOf('const FORK_ICON_PATHS'), settingsUI.indexOf('function ForkIcon'))
// Icons the stage and mixer add to the shared table (film, speaker-low).
const iconExtras = [stage, mixer].flatMap(source => source.split('\n').filter(line => line.startsWith('if (typeof FORK_ICON_PATHS === "object"'))).join('\n')
const forkIcon = settingsUI.slice(settingsUI.indexOf('function ForkIcon'), settingsUI.indexOf('// Foldable settings sections'))
const hud = stage.slice(stage.indexOf('function forkGalHudStep('), stage.indexOf('// Name plate of the text box'))
const notices = stage.slice(stage.indexOf('const FORK_GAL_DIAGNOSTIC_TEXT'), stage.indexOf('// private fork: HUD change moments'))
const helpers = runtime.slice(runtime.indexOf('function stageRuntimeErrorText'), runtime.indexOf('\n}\n', runtime.indexOf('function stageDiagnosticText')) + 3)
// The icon sizes the stage really asks for (the markup below mirrors fork-gal-stage.js's top bar).
const size = (source, name) => Number(new RegExp('name: "' + name + '", size: (\\d+)').exec(source)?.[1])
const sizes = { film: size(stage, 'film'), sparkle: size(stage, 'sparkle'), close: size(stage, 'close'), music: size(stage, 'music'), mix: Number(/forkGalMixIcon\(level\), size: (\d+)/.exec(mixer)?.[1]) }
const bgs = { day: 'output/top-chrome/bg/day.webp', night: 'output/top-chrome/bg/night.webp' }
const bgData = {}
for (const [key, file] of Object.entries(bgs)) {
  try { bgData[key] = 'data:image/webp;base64,' + (await readFile(new URL('../' + file, import.meta.url))).toString('base64') } catch { bgData[key] = null }
}
// Flat fallbacks (and the worst cases for the contrast probe): white daylight, near-black night.
const flat = { day: '#ffffff', night: '#05040a', white: '#ffffff', black: '#000000' }
const shots = process.env.TOP_CHROME_SHOTS || ''
const shotsOnly = process.env.TOP_CHROME_SHOTS_ONLY === '1'
const themes = ['classic', 'gothic', 'magical', 'crt', 'aero'] // private fork: + crt (显像管), aero (千禧晴空)

test('private fork: the stage top bar uses one icon size for every control', () => {
  if (shotsOnly) return
  assert.deepEqual(Object.values(sizes), [16, 16, 16, 16, 16], JSON.stringify(sizes))
})

test('private fork: stage top chrome has no plates, equal controls and legible halos on bright and dark scenes', async () => {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 980, height: 190 }, deviceScaleFactor: 2 })
    await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${css}</style><style>
      html, body { margin: 0; background: #777; font-family: "Microsoft YaHei UI", "Noto Sans SC", sans-serif; }
      #root { position: relative; width: 980px; height: 150px; overflow: hidden; background-size: cover; background-position: 50% 0; }
      *, *::before, *::after { animation-duration: 0s !important; animation-delay: 0s !important; transition: none !important; }
      .fork-gal-notices { top: 54px; }</style></head>
      <body class="dsh-tavern-shell-active"><div class="fork-gal-stage" id="root"><div id="ui"></div></div></body></html>`)
    await page.addScriptTag({ content: await browserReactScript() })
    await page.addScriptTag({ content: `
      const React = modules.react, ReactDOM = Object.assign({}, modules['react-dom'], modules['react-dom/client']);
      ${icons}
      ${iconExtras}
      ${forkIcon}
      ${helpers}
      ${hud}
      ${notices}
      const SIZES = ${JSON.stringify(sizes)};
      function TopChrome(p) {
        const h = React.createElement;
        return h(React.Fragment, null,
          h('div', { className: 'fork-gal-topbar' },
            h('div', { className: 'fork-gal-topleft' },
              h('span', { className: 'fork-gal-history-indicator', 'data-historical': p.history }, '第 3 / 5 轮'),
              h(ForkGalHudLabels, { place: '工业区·训练空地', track: { name: 'Postmeridie' }, scope: 's', live: false, music: { ref: null, open: false, paused: !!p.paused, toggle() {} } }),
              h('div', { className: 'fork-gal-mixer' }, h('button', { type: 'button', className: 'fork-gal-mixer-toggle', 'data-level': p.muted ? 'muted' : 'full', 'aria-label': '混音' },
                h(ForkIcon, { name: p.muted ? 'speaker-off' : 'speaker', size: SIZES.mix })))),
            h('div', { className: 'fork-gal-topright' },
              h('button', { type: 'button', className: 'fork-gal-film', 'aria-pressed': !!p.film, 'aria-label': '电影模式' }, h(ForkIcon, { name: 'film', size: SIZES.film })),
              h('button', { type: 'button', className: 'fork-gal-quality', 'data-quality': p.low ? 'low' : 'high', 'aria-label': '特效' }, h(ForkIcon, { name: 'sparkle', size: SIZES.sparkle })),
              h('button', { type: 'button', className: 'fork-gal-quit', 'aria-label': '返回主页面' }, h(ForkIcon, { name: 'close', size: SIZES.close })))),
          p.notice ? h(ForkGalRuntimeStatus, { error: 'director failed: upstream 502', diagnostics: [] }) : null);
      }
      const root = ReactDOM.createRoot(document.getElementById('ui'));
      window.show = (theme, bg, state) => {
        const stage = document.getElementById('root');
        stage.dataset.theme = theme; stage.dataset.fkContext = 'stage-' + theme;
        if (state.skin) stage.dataset.fkSkin = 'charlotte'; else delete stage.dataset.fkSkin;
        stage.style.background = bg.startsWith('data:') ? 'url(' + bg + ') 50% 0 / cover' : bg;
        ReactDOM.flushSync(() => root.render(React.createElement(TopChrome, state)));
      };
      window.box = el => { const r = el.getBoundingClientRect(); return { w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10 } };
      window.paint = el => { const cs = getComputedStyle(el); return { bg: cs.backgroundColor, image: cs.backgroundImage, shadow: cs.boxShadow } };
      window.parse = text => { const s = /color\\(srgb ([-\\d.e]+) ([-\\d.e]+) ([-\\d.e]+)(?: \\/ ([\\d.e]+))?\\)/.exec(text); if (s) return { r: +s[1], g: +s[2], b: +s[3], a: s[4] === undefined ? 1 : +s[4] }; const m = /rgba?\\(([\\d.]+),? ([\\d.]+),? ([\\d.]+)(?:,? \\/? ?([\\d.]+))?\\)/.exec(text); return m ? { r: m[1] / 255, g: m[2] / 255, b: m[3] / 255, a: m[4] === undefined ? 1 : +m[4] } : null };
      const lin = c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      window.lum = c => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
      window.contrast = (x, y) => { const [a, b] = [lum(x), lum(y)].sort((p, q) => q - p); return (a + 0.05) / (b + 0.05) };
      // Halo probe: glyph pixels are the ones closest to the control's ink; the halo is what sits 1 CSS px
      // (2 device px) outside them. Median contrast ink : halo over the given flat backdrop.
      window.halo = async (b64, ink) => {
        const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
        const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const x = c.getContext('2d'); x.drawImage(img, 0, 0);
        const d = x.getImageData(0, 0, c.width, c.height).data, W = c.width, H = c.height;
        const px = (i, j) => { const k = (j * W + i) * 4; return { r: d[k] / 255, g: d[k + 1] / 255, b: d[k + 2] / 255 } };
        const dist = (p, q) => Math.abs(p.r - q.r) + Math.abs(p.g - q.g) + Math.abs(p.b - q.b);
        const glyph = new Uint8Array(W * H); let count = 0;
        for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) if (dist(px(i, j), ink) < 0.12) { glyph[j * W + i] = 1; count++ }
        const ratios = [];
        for (let j = 2; j < H - 2; j++) for (let i = 2; i < W - 2; i++) if (glyph[j * W + i]) for (const [di, dj] of [[2, 0], [-2, 0], [0, 2], [0, -2], [2, 2], [-2, -2], [2, -2], [-2, 2]]) {
          const ii = i + di, jj = j + dj; if (glyph[jj * W + ii]) continue;
          if (dist(px(ii, jj), ink) < 0.6) continue; // anti-aliased edge, not yet the halo
          ratios.push(contrast(ink, px(ii, jj)));
        }
        ratios.sort((a, b) => a - b);
        return { glyph: count, samples: ratios.length, median: ratios[Math.floor(ratios.length / 2)] || 0, p25: ratios[Math.floor(ratios.length / 4)] || 0 };
      };
    ` })
    await page.mouse.move(970, 185)
    if (shots) await mkdir(shots, { recursive: true })
    const shoot = async name => { if (shots) await page.screenshot({ path: path.join(shots, name + '.png'), clip: { x: 0, y: 0, width: 980, height: 150 } }) }
    const controls = '.fork-gal-topbar :is(.fork-gal-place, .fork-gal-track, .fork-gal-mixer-toggle, .fork-gal-film, .fork-gal-quality, .fork-gal-quit, .fork-gal-history-indicator)'
    const plates = controls + ', .fork-gal-topbar, .fork-gal-topleft, .fork-gal-topright, .fork-gal-mixer, .fork-gal-notices, .fork-gal-runtime-status'

    for (const theme of themes) for (const bg of ['day', 'night']) for (const skin of [false, true]) {
      if (skin && theme !== 'classic') continue
      const tag = theme + (skin ? '-charlotte' : '') + '-' + bg
      await page.evaluate(([t, b, s]) => window.show(t, b, { history: true, notice: true, skin: s }), [theme, bgData[bg] || flat[bg], skin])
      await page.evaluate(() => document.fonts.ready)
      await shoot(tag + '-rest')
      await page.hover('.fork-gal-mixer-toggle'); await shoot(tag + '-hover-mixer')
      await page.mouse.move(970, 185)
      await page.evaluate(([t, b, s]) => window.show(t, b, { history: true, notice: false, skin: s, film: true, muted: true, low: true, paused: true }), [theme, bgData[bg] || flat[bg], skin])
      await shoot(tag + '-toggled')
      await page.focus('.fork-gal-quit'); await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Tab')
      await shoot(tag + '-focus-quit')
      await page.evaluate(() => document.activeElement && document.activeElement.blur())
      if (shotsOnly) continue

      await page.evaluate(([t, b, s]) => window.show(t, b, { history: true, notice: true, skin: s }), [theme, bgData[bg] || flat[bg], skin])
      // One height for every control; icon buttons are squares of that height; one icon size.
      const boxes = await page.$$eval(controls, els => els.map(el => ({ cls: el.className, ...window.box(el) })))
      assert.equal(boxes.length, 7, tag)
      const heights = new Set(boxes.map(b => b.h))
      assert.equal(heights.size, 1, tag + ' control heights ' + JSON.stringify(boxes))
      for (const b of boxes.filter(b => /mixer-toggle|film|quality|quit/.test(b.cls))) assert.equal(b.w, b.h, tag + ' square hit area ' + JSON.stringify(b))
      const iconSizes = await page.$$eval('.fork-gal-topbar .fork-icon', els => [...new Set(els.map(el => JSON.stringify(window.box(el))))])
      assert.equal(iconSizes.length, 1, tag + ' icon sizes ' + iconSizes)
      // No plates at rest: transparent backgrounds, no background images, no inset rings.
      const rest = await page.$$eval(plates, els => els.map(el => ({ cls: el.className, ...window.paint(el) })))
      for (const p of rest) {
        assert.equal(window_alpha(p.bg), 0, tag + ' background plate on ' + p.cls + ': ' + p.bg)
        assert.equal(p.image, 'none', tag + ' background image on ' + p.cls)
        assert.equal(p.shadow, 'none', tag + ' ring/shadow plate on ' + p.cls + ': ' + p.shadow)
      }
      // Hover and keyboard focus draw a solid chip; focus is visible.
      await page.hover('.fork-gal-mixer-toggle')
      const hovered = await page.$eval('.fork-gal-mixer-toggle', el => window.paint(el).bg)
      assert.equal(window_alpha(hovered), 1, tag + ' hover chip ' + hovered)
      await page.mouse.move(970, 185)
      await page.focus('.fork-gal-quit'); await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Tab')
      const focused = await page.$eval('.fork-gal-quit', el => { const cs = getComputedStyle(el); return { focus: el.matches(':focus-visible'), outline: cs.outlineStyle, bg: cs.backgroundColor } })
      assert.ok(focused.focus && focused.outline !== 'none' && window_alpha(focused.bg) === 1, tag + ' focus ' + JSON.stringify(focused))
      await page.evaluate(() => document.activeElement && document.activeElement.blur())
      // Toggled states are distinct without a plate.
      await page.evaluate(([t, b, s]) => window.show(t, b, { history: true, skin: s, film: true, muted: true }), [theme, bgData[bg] || flat[bg], skin])
      for (const sel of ['.fork-gal-film', '.fork-gal-mixer-toggle']) {
        const on = await page.$eval(sel, el => ({ ...window.paint(el), dot: getComputedStyle(el, '::before').content }))
        assert.equal(window_alpha(on.bg), 0, tag + ' toggled ' + sel + ' has no plate')
        assert.notEqual(on.dot, 'none', tag + ' toggled ' + sel + ' shows its marker')
      }
    }

    // Legibility: halo contrast over flat white, flat black and - the true worst case - a scene exactly the colour
    // of the ink itself (only the halo can separate the glyph there), in every theme, for icons and the warning.
    if (!shotsOnly) for (const theme of themes) for (const backdrop of ['white', 'black', 'ink']) {
      await page.evaluate(([t, b]) => window.show(t, b, { history: false, notice: true }), [theme, flat[backdrop] || '#777'])
      for (const sel of ['.fork-gal-mixer-toggle', '.fork-gal-quit', '.fork-gal-film', '.fork-gal-place-name', '.fork-gal-runtime-status strong']) {
        const el = await page.$(sel)
        if (backdrop === 'ink') await el.evaluate(e => { document.getElementById('root').style.background = getComputedStyle(e).color })
        const ink = await el.evaluate(e => window.parse(getComputedStyle(e).color))
        const b64 = (await el.screenshot()).toString('base64')
        const probe = await page.evaluate(([b, i]) => window.halo(b, i), [b64, ink])
        assert.ok(probe.glyph > 20 && probe.samples > 10, `${theme}/${backdrop} ${sel} probe ${JSON.stringify(probe)}`)
        if (process.env.TOP_CHROME_DEBUG) console.log(theme, backdrop, sel, JSON.stringify(probe))
        assert.ok(probe.median >= 3, `${theme}/${backdrop} ${sel} halo contrast ${JSON.stringify(probe)}`)
      }
    }
  } finally { await browser.close() }
})

function window_alpha(text) {
  const m = /rgba?\(([\d.]+),? ([\d.]+),? ([\d.]+)(?:,? \/? ?([\d.]+))?\)/.exec(text)
  return m ? (m[4] === undefined ? 1 : +m[4]) : (text === 'transparent' ? 0 : 1)
}
