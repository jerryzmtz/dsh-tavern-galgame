// Private fork (docs/fork/ui-design.md, "舞台界面主题变量"): every end-panel row of the galgame stage stays readable on
// its frosted glass in every registered dialogue-box theme, with and without the look UI filter, over the worst
// backdrop (pure white behind a dark palette, pure black behind a pale one; both are tried for every theme).
// Regression: the free-input editor is tagged by the dream skin as a "composer" and the fork's global opaque-composer
// rule painted it cream under the stage's light ink, so typed text vanished; the offline harness never set
// body.dsh-tavern-shell-active, so that rule was never exercised. This page does, with the skin marker and its layers.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { browserReactScript } from './fixtures/browser-react.mjs'
import { forkThemeCss } from './helpers/fork-theme-css.mjs'
import { forkTextAreaSource } from './helpers/fork-spinner.mjs'

const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8')
const css = await forkThemeCss()
const source = forkTextAreaSource + await read('tavern-plugin/src/client/fork-gal-choices.js') // private fork (UI standard phase 2 batch 16): ForkTextArea
const settingsUI = await read('tavern-plugin/src/client/fork-settings-ui.js')
const icons = settingsUI.slice(settingsUI.indexOf('const FORK_ICON_PATHS'), settingsUI.indexOf('function ForkIcon'))
// The theme registry the Config screen offers; a new theme is checked automatically. '' = no data-theme (defaults).
const registry = /FORK_STAGE_THEMES\s*=\s*\[([\s\S]*?)\];/.exec(await read('tavern-plugin/src/client/fork-stage-backgrounds.js'))
assert.ok(registry, 'FORK_STAGE_THEMES registry')
const themes = [...registry[1].matchAll(/\[\s*"([\w-]+)"/g)].map(match => match[1])
// A live night look (measured on the user's app): the UI colour matrix forkGalUiApplier writes.
const NIGHT = [0.847, 0.054, 0.006, 0, -0.004, 0.017, 0.905, 0.006, 0, -0.005, 0.019, 0.066, 0.919, 0, -0.003, 0, 0, 0, 1, 0]
// dsh-dream-skin's composer layers (lib/client.js): a white card, a cream frosted ::before and the liquid outline.
const skin = `[data-dsh-dream-skin-composer] { background: var(--dsw-specific-input-major); position: relative; isolation: isolate; }
@supports ((background: color-mix(in srgb, red 50%, transparent)) and (backdrop-filter: blur(1px))) { [data-dsh-dream-skin-composer] { background: transparent; } }
[data-dsh-dream-skin-composer]::before { content: ''; position: absolute; inset: 0; border-radius: inherit; background: color-mix(in srgb, var(--dsh-dream-skin-composer-base) calc(var(--dsh-dream-skin-composer-fill, 85%) * 1), transparent); backdrop-filter: blur(14px) saturate(1.6) brightness(1.08); }
html[data-dsh-material="liquid"] [data-dsh-dream-skin-composer] { outline: 1px solid rgba(255,255,255,0.12); outline-offset: -1px; }
:root { --dsh-dream-skin-composer-base: #f7f0f3; --dsh-dream-skin-composer-fill: 40%; --dsw-specific-input-major: #ffffff; }`
const html = `<!doctype html><html data-dsh-material="liquid"><head><meta charset="utf-8"><style>${css}</style><style>${skin}</style>
<style>html, body { margin: 0; height: 100%; overflow: hidden; } .fork-gal-mount { position: fixed; inset: 0; } #backdrop { position: absolute; inset: 0; }
.contrast-hide, .contrast-hide *, .contrast-hide::placeholder { color: transparent !important; -webkit-text-fill-color: transparent !important; text-shadow: none !important; caret-color: transparent !important; }
.contrast-hide svg { stroke: transparent !important; } textarea { caret-color: transparent !important; }
*, *::before, *::after { transition: none !important; animation-duration: 0s !important; animation-delay: 0s !important; }</style></head>
<body class="dsh-tavern-shell-active"><div class="fork-gal-mount"><div class="fork-gal-stage" id="root"><div id="backdrop"></div>
<svg class="fork-gal-look-defs" aria-hidden="true" width="0" height="0"><filter id="fork-gal-look-ui" color-interpolation-filters="sRGB" filterUnits="userSpaceOnUse" x="-640" y="-640" width="5200" height="3400"><feColorMatrix type="matrix" values="${NIGHT.join(' ')}"/></filter></svg>
<div id="ui"></div></div></div></body></html>`

// Page-side helpers: colour parsing, WCAG contrast, the look matrix and the glass composite over a given backdrop.
const pageHelpers = `
  window.NIGHT = ${JSON.stringify(NIGHT)};
  window.parseColors = text => [...String(text).matchAll(/color\\(srgb ([-\\d.e]+) ([-\\d.e]+) ([-\\d.e]+)(?: \\/ ([\\d.e]+))?\\)|rgba?\\(([\\d.]+),? ([\\d.]+),? ([\\d.]+)(?:,? \\/? ?([\\d.]+))?\\)/g)]
    .map(m => m[1] !== undefined ? { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] } : { r: m[5] / 255, g: m[6] / 255, b: m[7] / 255, a: m[8] === undefined ? 1 : +m[8] });
  const lin = c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  const clamp = v => Math.min(1, Math.max(0, v));
  window.lum = c => 0.2126 * lin(clamp(c.r)) + 0.7152 * lin(clamp(c.g)) + 0.0722 * lin(clamp(c.b));
  window.contrast = (x, y) => { const [a, b] = [lum(x), lum(y)].sort((p, q) => q - p); return (a + 0.05) / (b + 0.05) };
  window.grade = (c, look) => look ? { r: clamp(NIGHT[0] * c.r + NIGHT[1] * c.g + NIGHT[2] * c.b + NIGHT[4]), g: clamp(NIGHT[5] * c.r + NIGHT[6] * c.g + NIGHT[7] * c.b + NIGHT[9]), b: clamp(NIGHT[10] * c.r + NIGHT[11] * c.g + NIGHT[12] * c.b + NIGHT[14]), a: 1 } : c;
  window.over = (top, under) => ({ r: top.r * top.a + under.r * (1 - top.a), g: top.g * top.a + under.g * (1 - top.a), b: top.b * top.a + under.b * (1 - top.a), a: 1 });
  // backdrop-filter tone functions on a flat colour (blur is a no-op on a flat backdrop).
  window.tone = (c, filter) => {
    for (const [, fn, raw] of String(filter).matchAll(/(brightness|saturate|contrast)\\(([\\d.]+)(%?)\\)/g)) {
      const v = +raw;
      if (fn === 'brightness') c = { r: clamp(c.r * v), g: clamp(c.g * v), b: clamp(c.b * v), a: 1 };
      else if (fn === 'contrast') c = { r: clamp((c.r - .5) * v + .5), g: clamp((c.g - .5) * v + .5), b: clamp((c.b - .5) * v + .5), a: 1 };
      else c = { r: clamp((.213 + .787 * v) * c.r + (.715 - .715 * v) * c.g + (.072 - .072 * v) * c.b), g: clamp((.213 - .213 * v) * c.r + (.715 + .285 * v) * c.g + (.072 - .072 * v) * c.b), b: clamp((.213 - .213 * v) * c.r + (.715 - .715 * v) * c.g + (.072 + .928 * v) * c.b), a: 1 };
    }
    return c;
  };
  // Every colour the row's glass can show over a flat backdrop: toned backdrop, then background-color, then each
  // gradient stop (a gradient between stops composites to values between the stop composites).
  // Background layers are listed top first; each gradient layer contributes one of its stops.
  window.layers = text => { const out = []; let depth = 0, start = 0; for (let i = 0; i < text.length; i++) { const c = text[i]; if (c === '(') depth++; else if (c === ')') depth--; else if (c === ',' && !depth) { out.push(text.slice(start, i)); start = i + 1 } } out.push(text.slice(start)); return out.map(s => s.trim()).filter(s => s && s !== 'none') };
  window.glassColors = (row, backdrop) => {
    const cs = getComputedStyle(row);
    let colors = [over(parseColors(cs.backgroundColor)[0] || { r: 0, g: 0, b: 0, a: 0 }, tone(backdrop, cs.backdropFilter))];
    for (const layer of layers(cs.backgroundImage).reverse()) { const stops = parseColors(layer); if (stops.length) colors = colors.flatMap(under => stops.map(stop => over(stop, under))) }
    return colors;
  };
  window.textColor = (el, placeholder) => parseColors(getComputedStyle(el, placeholder ? '::placeholder' : null)[placeholder ? 'color' : 'webkitTextFillColor'] || getComputedStyle(el).color)[0];
  window.pixels = async b64 => { const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode(); const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const x = c.getContext('2d'); x.drawImage(img, 0, 0); const d = x.getImageData(0, 0, c.width, c.height).data; const out = []; for (let i = 0; i < d.length; i += 4) out.push({ r: d[i] / 255, g: d[i + 1] / 255, b: d[i + 2] / 255, a: 1 }); return out };
`

const componentScript = `
  const React = modules.react;
  const listeners = new Set();
  let panel = null, task = null;
  async function rpc() { return { settings: { candidateAutoGenerate: false } } }
  const useCandidatePanel = () => React.useSyncExternalStore(fn => { listeners.add(fn); return () => listeners.delete(fn) }, () => panel);
  const useTavernCoordination = () => ({ view: { task } });
  const latestTavernAssistantMessageId = () => 'm';
  const setCandidatePanel = value => { panel = value; listeners.forEach(fn => fn()) };
  const readyCandidatePanel = (sessionId, messageId, candidates) => ({ sessionId, messageId, phase: 'ready', choices: candidates.choices });
  const submitCandidateTask = async () => {};
  const liveTavernView = { invalidate() {} }, tavernCoordination = { invalidate() {} };
  const forkUiSfx = { play() {}, preload() {}, bind: () => () => {} }, useForkUiSfxControls = () => {}; // private fork: stage UI cues (fork-ui-sfx.js)
  ${icons}
  const ForkIcon = props => React.createElement('svg', { width: props.size, height: props.size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, 'aria-hidden': true }, React.createElement('path', { d: FORK_ICON_PATHS[props.name] || '' }));
  ${source}
  const ui = modules['react-dom/client'].createRoot(document.querySelector('#ui'));
  let key = 0;
  const phases = { off: null, ready: { phase: 'ready', choices: [{ type: 'action', text: '跟上去，问她今天到底怎么了。' }, { type: 'scene', text: '第二天放学后，在天台等她。' }] }, generating: { phase: 'loading', choices: [] }, failed: { phase: 'error', choices: [], error: 'x' } };
  // dsh-dream-skin nearestComposerCard: a visible textarea tags its nearest rounded ancestor (and never un-tags it).
  window.mark = () => { for (const anchor of document.querySelectorAll('textarea')) { for (const min of [8, 4]) { let node = anchor.parentElement, found = null; for (let hops = 0; node && hops < 6; hops++, node = node.parentElement) { const raw = getComputedStyle(node).borderTopLeftRadius, radius = raw.includes('%') ? 0 : parseFloat(raw) || 0; if (radius >= min) { if (node.offsetWidth > anchor.offsetWidth * 3) continue; found = node; break } } if (found) { found.setAttribute('data-dsh-dream-skin-composer', '1'); return } } } };
  // private fork (panel stability): one mounted panel with 重新生成正文 whose candidate state changes in place.
  window.mountStable = () => { panel = { sessionId: 's', messageId: 'm', ...phases.generating }; ui.render(React.createElement(ForkGalChoices, { key: 'stable', sessionId: 's', atEnd: true, onRegenerate: () => {}, useSession: select => select({ running: false }), useChat: () => 'm', executeSlash: async () => {} })) };
  window.setPanel = state => setCandidatePanel({ sessionId: 's', messageId: 'm', ...phases[state] });
  window.scenario = ({ theme, look, backdrop, state }) => {
    const root = document.querySelector('#root');
    if (theme) root.dataset.theme = theme; else delete root.dataset.theme;
    if (look) root.setAttribute('data-look-ui', ''); else root.removeAttribute('data-look-ui');
    document.querySelector('#backdrop').style.background = backdrop;
    panel = phases[state] && { sessionId: 's', messageId: 'm', ...phases[state] }; key++;
    ui.render(React.createElement(ForkGalChoices, { key, sessionId: 's', atEnd: true, useSession: select => select({ running: false }), useChat: () => 'm', executeSlash: async () => {} }));
  };
`

// Text targets per panel state: selector, minimum ratio, whether it sits directly on the row glass (composite check).
const targets = {
  off: [['.fork-gal-choice-main[data-action="generate"]', 4.5, false], ['.fork-gal-choice.is-free .fork-gal-choice-main', 4.5, true]],
  ready: [['.fork-gal-choice[data-type="action"] .fork-gal-choice-text', 4.5, true], ['.fork-gal-choice[data-type="scene"] .fork-gal-choice-text', 4.5, true]],
  generating: [['.fork-gal-choice.is-loading > span', 4.5, true]],
  failed: [['.fork-gal-choice.is-error > span', 4.5, true], ['.fork-gal-choice.is-error [data-action="retry"]', 4.5, true]],
  empty: [['.fork-gal-choice.is-editing textarea', 3, true, 'placeholder'], ['.fork-gal-choice-cancel', 4.5, true]],
  typed: [['.fork-gal-choice.is-editing textarea', 4.5, true], ['.fork-gal-choice-send', 4.5, false]],
}

// private fork (owner 2026-10): the wait line turning into choices and 自由输入 turning into its editor never move or
// re-mount the 自由输入 card (the list stands on its bottom line; the editor is the same card at the same height).
test('stage end panel: 自由输入 keeps its card and its place from generating to choices to its editor', { timeout: 30000 }, async t => {
  const browser = await chromium.launch({ headless: true })
  t.after(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.setContent(html)
  await page.addScriptTag({ content: await browserReactScript() })
  await page.addScriptTag({ content: pageHelpers + componentScript })
  await page.evaluate(() => { document.querySelector('#root').dataset.theme = 'classic'; mountStable() })
  await page.waitForSelector('.fork-gal-choices[data-state="generating"]')
  const free = () => page.evaluate(() => { const card = document.querySelector('.fork-gal-choice.is-free'), box = card.getBoundingClientRect(); card.dataset.seen ||= String(Math.random()); return { id: card.dataset.seen, top: box.top, height: box.height, animating: card.getAnimations().length > 0 } })
  await page.waitForTimeout(300)
  const generating = await free()
  await page.evaluate(() => setPanel('ready'))
  await page.waitForSelector('.fork-gal-choices[data-state="ready"]')
  const ready = await free()
  assert.equal(ready.id, generating.id, 'the same 自由输入 card')
  assert.ok(Math.abs(ready.top - generating.top) < 0.5, `choices arriving keep 自由输入 in place (${generating.top} → ${ready.top})`)
  await page.locator('.fork-gal-choice.is-free .fork-gal-choice-main').click()
  await page.mouse.move(1, 1)
  await page.waitForSelector('.fork-gal-choice.is-free.is-editing textarea')
  const editor = await free()
  assert.equal(editor.id, ready.id, 'the editor is the 自由输入 card itself')
  assert.equal(editor.animating, false, 'the editor does not wipe in again')
  assert.ok(Math.abs(editor.top - ready.top) < 1.5 && Math.abs(editor.height - ready.height) < 0.5, `opening the editor moves nothing (${ready.top}/${ready.height} → ${editor.top}/${editor.height})`)
  assert.deepEqual(errors, [])
})

test('stage end panel: every row keeps its ink readable on its glass over the worst backdrop, in every theme, with and without the look filter', { timeout: 110000 }, async t => {
  const browser = await chromium.launch({ headless: true })
  t.after(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 1000, height: 640 }, deviceScaleFactor: 1 })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.setContent(html)
  await page.addScriptTag({ content: await browserReactScript() })
  await page.addScriptTag({ content: pageHelpers + componentScript })
  const failures = [], seen = new Set()
  async function measure(label, [selector, min, onGlass, placeholder], look, backdropColor) {
    const el = page.locator(selector).first()
    await el.waitFor()
    // The text's own box: the text node range for labels, the content box for the textarea.
    const box = await el.evaluate((node, placeholder) => {
      let rect
      if (node.tagName === 'TEXTAREA') { const cs = getComputedStyle(node), r = node.getBoundingClientRect(); rect = { x: r.x + 2, y: r.y + parseFloat(cs.paddingTop), width: Math.min(r.width - 4, placeholder ? r.width - 4 : 260), height: parseFloat(cs.lineHeight) } }
      else { const range = document.createRange(); range.selectNodeContents(node); const r = range.getBoundingClientRect(); rect = { x: r.x, y: r.y, width: r.width, height: r.height } }
      return { x: Math.floor(rect.x) + 1, y: Math.floor(rect.y) + 1, width: Math.max(4, Math.floor(rect.width) - 2), height: Math.max(4, Math.floor(rect.height) - 2) }
    }, placeholder)
    const shown = (await page.screenshot({ clip: box })).toString('base64')
    await el.evaluate(node => node.classList.add('contrast-hide'))
    await page.waitForTimeout(30)
    const hidden = (await page.screenshot({ clip: box })).toString('base64')
    await el.evaluate(node => node.classList.remove('contrast-hide'))
    const result = await page.evaluate(async ({ selector, shown, hidden, placeholder, look, onGlass, backdropColor }) => {
      const node = document.querySelector(selector), raw = textColor(node, placeholder)
      if (!raw) throw new Error('no text colour for ' + selector + ': ' + getComputedStyle(node).color)
      const ink = grade(raw, look)
      const [fg, bg] = [await pixels(shown), await pixels(hidden)]
      // Background as actually rendered behind the text (1st percentile, skipping a stray anti-aliased pixel).
      const behind = bg.map(px => contrast(ink, px)).sort((a, b) => a - b)
      const rendered = behind[Math.floor(behind.length * 0.01)]
      // The drawn glyphs themselves reach the ink: the strongest text pixel against the background at that spot.
      let glyph = 0, changed = 0
      for (let i = 0; i < fg.length; i++) { const c = contrast(fg[i], bg[i]); if (c > 1.05) changed++; if (c > glyph) glyph = c }
      // Composite of the row's glass over the flat backdrop (token maths, independent of the pixels).
      const row = node.closest('.fork-gal-choice')
      const composite = onGlass ? Math.min(...glassColors(row, parseColors(backdropColor)[0]).map(c => contrast(ink, grade(c, look)))) : null
      const hex = c => '#' + [c.r, c.g, c.b].map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('')
      const detail = 'ink ' + hex(ink) + ' bg ' + hex(bg[Math.floor(bg.length / 2)]) + (onGlass ? ' glass ' + glassColors(row, parseColors(backdropColor)[0]).map(c => hex(grade(c, look))).join('/') : '')
      return { rendered, glyph, changed, composite, detail }
    }, { selector, shown, hidden, placeholder: Boolean(placeholder), look, onGlass, backdropColor })
    seen.add(label)
    if (process.env.CONTRAST_DEBUG) console.log(label, result.rendered.toFixed(2), result.glyph.toFixed(2), result.composite && result.composite.toFixed(2), result.detail)
    const bad = [['rendered background', result.rendered], ['drawn glyphs', result.glyph], ['glass composite', result.composite]].filter(([, value]) => value !== null && !(value >= min))
    if (!(result.changed > 20)) bad.push(['glyph pixels drawn', result.changed])
    for (const [what, value] of bad) failures.push(`${label}: ${what} ${typeof value === 'number' ? value.toFixed(2) : value} < ${min} (${result.detail})`)
  }
  for (const theme of ['', ...themes]) for (const look of [false, true]) for (const backdrop of ['rgb(255, 255, 255)', 'rgb(0, 0, 0)']) {
    const tag = `${theme || 'default'}/${look ? 'look' : 'no look'}/${backdrop === 'rgb(0, 0, 0)' ? 'black' : 'white'}`
    for (const state of ['off', 'ready', 'generating', 'failed']) {
      await page.evaluate(s => scenario(s), { theme, look, backdrop, state })
      await page.waitForSelector(`.fork-gal-choices[data-state="${state}"]`)
      await page.waitForTimeout(80)
      for (const target of targets[state]) await measure(`${tag} ${state} ${target[0]}`, target, look, backdrop)
    }
    await page.evaluate(s => scenario(s), { theme, look, backdrop, state: 'off' })
    await page.locator('.fork-gal-choice.is-free .fork-gal-choice-main').click()
    await page.mouse.move(1, 1)
    await page.waitForSelector('.fork-gal-choice.is-editing textarea')
    await page.evaluate(() => mark())
    assert.equal(await page.locator('.fork-gal-choice.is-editing').getAttribute('data-dsh-dream-skin-composer'), '1', 'the skin tags the editor as its composer')
    await page.waitForTimeout(80)
    for (const target of targets.empty) await measure(`${tag} editor-empty ${target[0]}`, target, look, backdrop)
    await page.locator('.fork-gal-choice.is-editing textarea').fill('我直接走过去，把伞递给她。')
    await page.waitForTimeout(200)
    for (const target of targets.typed) await measure(`${tag} editor-typed ${target[0]}`, target, look, backdrop)
    // private fork (ui-surfaces.md): the row is an opaque card — every paint stop solid, no backdrop blur; the look
    // filter still grades the row, never the list.
    const glass = await page.evaluate(() => { const row = document.querySelector('.fork-gal-choice.is-editing'), list = row.parentElement, cs = getComputedStyle(row); return { alphas: [...parseColors(cs.backgroundImage), ...parseColors(cs.backgroundColor)].map(c => c.a), blur: cs.backdropFilter, listFilter: getComputedStyle(list).filter, rowFilter: cs.filter } })
    if (!glass.alphas.slice(0, -1).every(a => a === 1)) failures.push(`${tag}: the editor row paint is translucent (alphas ${glass.alphas.join(', ')})`)
    if (glass.blur !== 'none') failures.push(`${tag}: the editor row blurs the scene (${glass.blur})`)
    if (glass.listFilter !== 'none') failures.push(`${tag}: the list is filtered (${glass.listFilter}); it would become the rows' backdrop root`)
    if (glass.rowFilter !== (look ? 'url("#fork-gal-look-ui")' : 'none')) failures.push(`${tag}: the look does not grade the row (${glass.rowFilter})`)
  }
  assert.deepEqual(failures, [])
  assert.equal(seen.size, (themes.length + 1) * 2 * 2 * Object.values(targets).flat().length, 'every theme × look × backdrop × row was measured')
  assert.deepEqual(errors, [])
})
