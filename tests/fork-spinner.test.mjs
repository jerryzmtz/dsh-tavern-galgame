// private fork: the one shared loading indicator (owner 2026-10) — an iOS-style activity indicator (ForkSpinner,
// tavern-plugin/src/client/fork-spinner.js) used by every fork loading state, drawn only after 150 ms, centred in its
// host box whatever the box's padding, sized from the box, and never shifting layout.
import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'
import { assetRenderer, walk } from './fixtures/asset-editor-renderer.mjs'
import { forkSpinnerSource } from './helpers/fork-spinner.mjs'
import { forkThemeCss } from './helpers/fork-theme-css.mjs'

const client = name => readFileSync(new URL('../tavern-plugin/' + (name === 'fork-model-control.js' ? 'packages/dsh-tavern-ui/src/' : 'src/client/') + name, import.meta.url), 'utf8')
const theme = readFileSync(new URL('../tavern-plugin/lib/client-assets/fork-theme.css', import.meta.url), 'utf8')

function setup(t) {
  const r = assetRenderer(); t.after(() => r.dispose())
  const timers = new Map(); let now = 0, id = 0
  const context = { React: r.React, setTimeout(fn, ms) { timers.set(++id, { at: now + ms, fn }); return id }, clearTimeout: key => timers.delete(key) }
  vm.runInNewContext(forkSpinnerSource + ';this.ForkSpinner=ForkSpinner;this.delay=FORK_SPINNER_DELAY_MS;', context)
  return { r, context, timers, advance(ms) { now += ms; for (const [key, timer] of timers) if (timer.at <= now) { timers.delete(key); timer.fn() } } }
}
const wheel = tree => walk(tree).find(n => n.props.className === 'fork-spinner-wheel')

test('private fork: the spinner draws nothing for 149 ms and twelve spokes at 150 ms', async t => {
  const f = setup(t); assert.equal(f.context.delay, 150)
  let tree = f.r.render(f.context.ForkSpinner, { fill: true }); tree = await f.r.settle()
  assert.equal(tree, null, 'a fill spinner renders nothing (not even its overlay) before the delay')
  f.advance(149); tree = await f.r.settle(); assert.equal(tree, null)
  f.advance(1); tree = await f.r.settle()
  assert.equal(tree.props.className, 'fork-spinner is-fill'); assert.equal(tree.props['aria-hidden'], true)
  assert.equal(wheel(tree).children.length, 12); assert.ok(wheel(tree).children.every(n => n.type === 'i'))
})

test('private fork: inline spinners reserve their box from the first frame (no layout shift)', async t => {
  const f = setup(t)
  let tree = f.r.render(f.context.ForkSpinner, { className: 'fork-status-tab-spinner', label: '载入中' }); tree = await f.r.settle()
  assert.equal(tree.props.className, 'fork-spinner fork-status-tab-spinner'); assert.equal(wheel(tree), undefined)
  assert.equal(tree.props.role, 'status'); assert.equal(tree.props['aria-label'], '载入中'); assert.equal(tree.props['aria-hidden'], undefined)
  f.advance(150); tree = await f.r.settle(); assert.equal(wheel(tree).children.length, 12)
})

test('private fork: a load that ends inside 150 ms never shows it; one that ends later fades it out', async t => {
  const fast = setup(t)
  fast.r.render(fast.context.ForkSpinner, { fill: true }); await fast.r.settle(); assert.equal(fast.timers.size, 1)
  let tree = fast.r.render(fast.context.ForkSpinner, { fill: true, out: true }); tree = await fast.r.settle()
  assert.equal(fast.timers.size, 0, 'finishing cancels the delay'); fast.advance(1000); tree = await fast.r.settle(); assert.equal(tree, null)
  const slow = setup(t)
  slow.r.render(slow.context.ForkSpinner, { fill: true }); await slow.r.settle(); slow.advance(150)
  tree = slow.r.render(slow.context.ForkSpinner, { fill: true, out: true }); tree = await slow.r.settle()
  assert.equal(tree.props['data-out'], true); assert.equal(wheel(tree).children.length, 12)
})

test('private fork: every fork loading state uses the shared ForkSpinner', () => {
  const main = client('main.js'), at = name => main.indexOf('// @include ' + name)
  assert.ok(at('fork-spinner.js') > 0 && at('fork-spinner.js') < at('fork-asset-pack-ui.js') && at('fork-spinner.js') < at('runtime/frame-document.js')
    && at('fork-spinner.js') < at('features/turn-history.js') && at('fork-spinner.js') < at('features/play-controls.js'), 'bundled once, before every user')
  const sites = {
    'fork-bubbles.js': /h\(ForkSpinner, \{ key: [^}]*fill: true \}\)/, // transcript avatars
    'fork-asset-pack-ui.js': /h\(ForkSpinner,\{key,fill:true\}\)[\s\S]*function Loading\(\)|function Loading\(\) \{ return h\('p',\{className:'ap-loading',role:'status'\},h\(ForkSpinner\)/, // thumbnails + loading lines
    'fork-live2d-preview.js': /h\(ForkSpinner, \{ key: [^}]*fill: true, className: "fork-live2d-preview-wait"/, // character modal Live2D card
    'fork-asset-pack-figure-ui.js': /shots\.status==='loading'\?h\(ForkSpinner,\{key:[^}]*fill:true\}\)/, // private fork: figure-owned emotion previews
    'fork-asset-pack-voice-ui.js': /state\?\.phase==='loading'\?h\(ForkSpinner,\{key:'go'\}\)/, // private fork (voice v4 P1): 试听 / saving / lists
    'fork-gal-stage.js': /h\(ForkSpinner, \{ className: 'fork-gal-runtime-spinner' \}\)/, // stage resource / direction notice
    'fork-voice.js': /h\(ForkSpinner,\{className:'fork-voice-spinner'\}\)/,
    // private fork: upstream SceneImagePending replaces the deleted composer image popover.
    'fork-status-panel.js': /h\(ForkSpinner, \{ className: "fork-status-tab-spinner" \}\)/,
    'fork-turn-actions.js': /h\(ForkSpinner, \{ className: "fork-compaction-dots" \}\)/,
    'fork-model-control.js': /h\(ForkSpinner, \{ className: "fork-model-pending", label: /,
    'fork-asset-pack-card-ui.js': /h\(ForkSpinner\)/,
    'fork-asset-pack-entry-ui.js': /h\(ForkSpinner,\{key:'loading'\}\)/ // private fork: stable loading key,
  }
  for (const [file, pattern] of Object.entries(sites)) assert.match(client(file), pattern, file)
  assert.match(client('fork-asset-pack-ui.js'), /h\(ForkSpinner,\{key,fill:true\}\)/)
  for (const file of [...Object.keys(sites), 'fork-gal-backlog.js'])
    assert.doesNotMatch(client(file), /ap-spinner|fork-image-pop-spinner|ap-thumb-loading|strokeDasharray: ?'42 16'|setTimeout\([^)]*, ?150\)/, file + ': no local spinner or local 150 ms timer')
  // Rotating rings are gone; only the toolbar busy ring (a button state) and the retry glyph turn.
  assert.deepEqual([...theme.matchAll(/@keyframes ([\w-]+) \{ to \{ transform: rotate/g)].map(m => m[1]).sort(), ['dsh-fork-busy-ring', 'dsh-fork-spin'])
  assert.doesNotMatch(theme, /\.ap-spinner|fork-image-pop-spinner|fork-selection-spin|fork-asset-spin|\bap-spin\b|fork-live2d-wait-out|\.ap-thumb-loading/)
  const built = readFileSync(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
  assert.equal(built.split('function ForkSpinner(').length, 2, 'the built client carries exactly one ForkSpinner')
})

test('private fork: iOS spokes, theme ink, 150 ms rule and reduced motion (slower, never frozen) in the stylesheet', () => {
  const rule = selector => { const i = theme.indexOf(selector + ' {'); assert.ok(i >= 0, selector); return theme.slice(i, theme.indexOf('}', i)) }
  assert.match(rule('.fork-spinner'), /--fork-spinner-period: 1s/)
  assert.match(rule('.fork-spinner.is-fill'), /top: 50%; left: 50%; translate: -50% -50%/)
  assert.match(rule('.fork-spinner.is-fill'), /width: clamp\(16px, 32%, var\(--fork-spinner-max, 40px\)\); height: clamp\(16px, 32%, var\(--fork-spinner-max, 40px\)\)/)
  assert.match(rule('.fork-spinner.is-fill'), /color: color-mix\(in srgb, var\(--fk-current-fg, var\(--fork-ink, CanvasText\)\) 66%, transparent\)/)
  assert.match(rule('.fork-spinner-wheel > i'), /rotate: calc\(var\(--fork-spinner-n\) \* 30deg\)/)
  assert.match(rule('.fork-spinner-wheel > i'), /animation: fork-spinner-spoke var\(--fork-spinner-period\) linear calc\(var\(--fork-spinner-period\) \* \(var\(--fork-spinner-n\) \/ 12 - 1\)\) infinite/)
  assert.match(theme, /@keyframes fork-spinner-spoke \{ from \{ opacity: 1; \} to \{ opacity: \.2; \} \}/)
  assert.match(theme, /@media \(prefers-reduced-motion: reduce\) and \(update: none\) \{ \.fork-spinner \{ --fork-spinner-period: 2\.4s; \} \}/)
  assert.match(rule('.fork-bubble-avatar'), /^\.fork-bubble-avatar \{ position: relative;/, 'the avatar plate is the spinner\'s positioned host')
})

test('private fork: Chromium geometry — centred in the padding box, 32% of the shorter side, min 16 px, no layout shift', async () => {
  const { chromium } = await import('playwright')
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 700 } })
    const spinner = (extra = '') => `<span class="fork-spinner is-fill${extra}" aria-hidden="true"><span class="fork-spinner-wheel">${'<i></i>'.repeat(12)}</span></span>`
    await page.setContent(`<style>${await forkThemeCss()} body{margin:0;padding:10px;display:flex;flex-wrap:wrap;gap:12px;align-items:flex-start}
      .host{box-sizing:border-box;background:#ddd}</style><body data-fk-context="chat-light">
      <span class="fork-bubble-avatar" id="avatar" style="font-size:15px;--bubble-color:#c66">${spinner()}</span>
      <span class="host ap-thumb" id="thumb" style="width:200px">${spinner()}</span>
      <div class="host" id="padded" style="position:relative;width:180px;height:120px;padding:40px 4px 0 60px;border:3px solid #999">${spinner()}</div>
      <div class="host" id="tiny" style="position:relative;width:20px;height:20px">${spinner()}</div>
      <div class="host" id="card" style="position:relative;width:300px;height:400px">${spinner(' fork-live2d-preview-wait')}</div>
      <p id="line" style="font-size:13px">x<span class="fork-spinner" id="empty" aria-hidden="true"></span><span class="fork-spinner" id="full" aria-hidden="true"><span class="fork-spinner-wheel">${'<i></i>'.repeat(12)}</span></span>y</p></body>`)
    const probe = await page.evaluate(() => Object.fromEntries(['avatar', 'thumb', 'padded', 'tiny', 'card'].map(id => {
      const host = document.getElementById(id), s = host.querySelector('.fork-spinner'), h = host.getBoundingClientRect(), r = s.getBoundingClientRect(), cs = getComputedStyle(host)
      const inner = { x: h.x + parseFloat(cs.borderLeftWidth), y: h.y + parseFloat(cs.borderTopWidth), w: host.clientWidth, h: host.clientHeight }
      const spokes = [...s.querySelectorAll('i')].map(i => getComputedStyle(i))
      return [id, { dx: r.x + r.width / 2 - (inner.x + inner.w / 2), dy: r.y + r.height / 2 - (inner.y + inner.h / 2), w: r.width, h: r.height, inner,
        visual: Math.min(r.width, r.height), rotate: spokes.map(x => x.rotate), names: [...new Set(spokes.map(x => x.animationName))],
        delays: spokes.map(x => x.animationDelay), color: getComputedStyle(s).color }]
    })))
    for (const [id, p] of Object.entries(probe)) {
      assert.ok(Math.abs(p.dx) < 0.51 && Math.abs(p.dy) < 0.51, id + ' centred in its padding box: ' + JSON.stringify(p))
      const max = id === 'card' ? 44 : 40, expected = Math.min(max, Math.max(16, 0.32 * Math.min(p.inner.w, p.inner.h)))
      assert.ok(Math.abs(p.visual - expected) < 0.6, id + ' size ' + p.visual + ' vs ' + expected)
      assert.ok(p.visual >= 16, id + ' never under 16px')
      assert.deepEqual(p.names, ['fork-spinner-spoke'])
      assert.deepEqual(p.rotate, Array.from({ length: 12 }, (_, i) => i * 30 + 'deg'))
      assert.equal(p.delays[0], '-1s'); assert.equal(p.delays[6], '-0.5s')
      assert.match(p.color, /color\(srgb [\d. ]+\/ 0\.66\)|rgba\(\d+, \d+, \d+, 0\.66\)/, id + ' theme ink at reduced strength: ' + p.color)
    }
    // 63px avatar plate (4.2em at 15px): ~20px wheel, i.e. within the owner's 28-36% band.
    assert.ok(probe.avatar.visual / probe.avatar.inner.w > 0.28 && probe.avatar.visual / probe.avatar.inner.w < 0.36, JSON.stringify(probe.avatar))
    const inline = await page.evaluate(() => ['empty', 'full'].map(id => { const r = document.getElementById(id).getBoundingClientRect(); return [r.width, r.height, r.y] }))
    assert.deepEqual(inline[0], inline[1], 'the reserved inline box is the drawn spinner box')
  } finally { await browser.close() }
})
