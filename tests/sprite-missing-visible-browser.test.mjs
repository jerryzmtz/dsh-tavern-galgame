// private fork (owner rule 「可以有 fallback，不能静默掩盖缺图」): the missing-image states are visible in the real UI.
// 1. Stage: the existing top-right warning stack gains 「差分缺图，已临时显示平和 ▸详情」 (详情 lists figure · outfit ·
//    requested 差分 → what was shown); a sprite outfit with no image at all stands in as a small avatar portrait.
// 2. 舞台设置 → 人物: a figure with missing 立绘 差分 carries 「缺 N」 on its face; clicking opens it in the editor (dashed tiles).
// Production CSS (fork-theme.css). Screenshots: $env:MISSING_VISIBLE_SHOTS='./output/missing-visible'.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'
import { browserReactScript } from './fixtures/browser-react.mjs'
import { forkThemeCss } from './helpers/fork-theme-css.mjs'
import { stageSource, pageSetup, THEMES } from './harness/card-centric-stage.mjs'
import { hostPieces, r5Setup } from './harness/stage-panel-r5.mjs'

const read = file => readFile(new URL('../' + file, import.meta.url), 'utf8')
const css = await forkThemeCss()
const shots = process.env.MISSING_VISIBLE_SHOTS || ''
const stage = await read('tavern-plugin/src/client/fork-gal-stage.js')
const runtime = await read('tavern-plugin/src/client/fork-stage-runtime.cjs')
const notices = stage.slice(stage.indexOf('const FORK_GAL_DIAGNOSTIC_TEXT'), stage.indexOf('// private fork: HUD change moments'))
const helpers = runtime.slice(runtime.indexOf('function stageRuntimeErrorText'), runtime.indexOf('\n}\n', runtime.indexOf('function stageDiagnosticText')) + 3)
const square = (hue) => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="hsl(${hue} 50% 86%)"/><circle cx="128" cy="120" r="92" fill="hsl(${hue} 55% 42%)"/><ellipse cx="128" cy="150" rx="64" ry="70" fill="#f3d7c6"/></svg>`)}`
const scene = `data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="9"><linearGradient id="g" x2="0" y2="1"><stop offset="0" stop-color="#9fc4e8"/><stop offset="1" stop-color="#5a6b7c"/></linearGradient><rect width="16" height="9" fill="url(#g)"/></svg>')}`

test('private fork: the stage warning stack lists 差分 fallbacks and the stand-in portrait keeps the figure on stage', async () => {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
    const errors = []; page.on('pageerror', e => errors.push(e.message))
    await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${css}</style><style>
      html, body { margin: 0; background: #222; font-family: "Microsoft YaHei UI", "Noto Sans SC", sans-serif; }
      *, *::before, *::after { animation-duration: 0s !important; transition: none !important; }
      #root { position: relative; width: 1280px; height: 720px; overflow: hidden; background: url("${scene}") 50% 50% / cover; }</style></head>
      <body class="dsh-tavern-shell-active"><div class="fork-gal-stage" id="root" data-theme="classic" data-fk-context="stage-classic"><div id="ui"></div></div></body></html>`)
    await page.addScriptTag({ content: await browserReactScript() })
    await page.addScriptTag({ content: `
      const React = modules.react, ReactDOM = Object.assign({}, modules['react-dom'], modules['react-dom/client']);
      const directorCommands = { dimensions: { music: '音乐' } };
      function ForkSpinner() { return null; }
      function ForkPackImage({ identity, src, crop, avatar, originalSrc, cropOverflow, ...props }) { return React.createElement('img', { ...props, src }); }
      ${helpers}
      ${notices}
      const rows = [
        { key: 'a', alias: 'fish', figure: '大肥鱼', outfit: '女仆装', requested: 'joy', requestedLabel: '喜悦', shown: 'calm', shownLabel: '平和' },
        { key: 'b', alias: 'fish', figure: '大肥鱼', outfit: '女仆装', requested: 'shy', requestedLabel: '害羞', shown: 'calm', shownLabel: '平和' }];
      const standIn = { key: 'c', alias: 'cat', figure: '猫猫', outfit: '睡衣', requested: 'calm', requestedLabel: '平和', shown: '@avatar' };
      const root = ReactDOM.createRoot(document.getElementById('ui'));
      window.show = state => ReactDOM.flushSync(() => root.render(React.createElement(React.Fragment, null,
        state.standIn ? React.createElement(ForkGalStandIns, { members: [{ id: 'cat', x: 0.7 }], portraits: new Map([['cat', { identity: 'i', src: ${JSON.stringify(square(30))}, crop: null }]]), colorOf: () => '#e0932a' }) : null,
        React.createElement(ForkGalRuntimeStatus, { drops: state.drops ? [{ capability: 'music', code: 'REF_UNAVAILABLE', at: 3, message: 'x' }] : [], spriteFallbacks: state.standIn ? [...rows, standIn] : rows, nameOf: () => '' }))));
    ` })
    if (shots) await mkdir(shots, { recursive: true })
    await page.evaluate(() => window.show({ drops: true }))
    const chip = page.locator('.fork-gal-runtime-status[data-tone="error"]', { hasText: '差分缺图' })
    assert.equal(await chip.count(), 1, 'one deduped notice, beside the existing ones')
    assert.equal(await chip.locator('strong').textContent(), '差分缺图，已临时显示平和')
    assert.equal(await page.locator('.fork-gal-notices .fork-gal-runtime-status').count(), 2, 'shares the existing warning stack (漫符/音乐 notice above)')
    const box = await chip.boundingBox(); assert.ok(box.x > 640 && box.y < 200, 'top right, quiet: ' + JSON.stringify(box))
    if (shots) await page.screenshot({ path: path.join(shots, 'stage-chip-closed.png'), clip: { x: 760, y: 0, width: 520, height: 260 } })
    await chip.locator('summary').click()
    assert.equal(await chip.locator('code').textContent(), '大肥鱼 · 女仆装 · 喜悦 → 平和\n大肥鱼 · 女仆装 · 害羞 → 平和')
    if (shots) await page.screenshot({ path: path.join(shots, 'stage-chip-details.png'), clip: { x: 760, y: 0, width: 520, height: 260 } })
    await page.evaluate(() => window.show({ standIn: true }))
    assert.equal(await chip.locator('strong').textContent(), '差分缺图，已临时替代显示')
    await chip.locator('summary').click()
    assert.match(await chip.locator('code').textContent(), /猫猫 · 睡衣 · 平和 → 头像（小图）$/)
    const portrait = await page.locator('.fork-gal-standin').boundingBox()
    assert.ok(portrait && portrait.width >= 72 && portrait.width <= 140 && Math.abs(portrait.x + portrait.width / 2 - 0.7 * 1280) < 2, 'small portrait in the figure slot ' + JSON.stringify(portrait))
    assert.equal(await page.locator('.fork-gal-standin img').evaluate(img => img.complete && img.naturalWidth > 0), true)
    if (shots) await page.screenshot({ path: path.join(shots, 'stage-standin-avatar.png') })
    assert.deepEqual(errors, [])
  } finally { await browser.close() }
})

// The r5 mock's figures are old state-pool sprites; give them native own-image emotions with some 差分 missing.
function missingSetup() {
  const service = window.binding.service, list = service.listPackSummaries, snapshot = service.getPackSnapshot
  const keep = { '鹿目圆': ['default', 'joy'], '少女 A': ['default'], '少年 B': [] }
  // The mock shares one manifest key per pack; each figure gets its own native manifest.
  const native = pack => {
    const pool = JSON.parse(JSON.stringify(pack.sprites))
    for (const figure of Object.values(pack.figures)) for (const outfit of figure.outfits) {
      const old = pool[outfit.sprite?.manifestKey]
      if (!old?.states) continue
      const ids = keep[figure.name] || old.states.map(s => s.id), key = 'n-' + figure.id
      const { states, defaultState, ...rest } = old
      pack.sprites[key] = { ...rest, emotions: Object.fromEntries(states.filter(s => ids.includes(s.id)).map(s => [s.id === 'default' ? 'calm' : s.id, { stage: s.stage }])) }
      // 店员 C is complete: every 差分 has its own image.
      if (figure.name === '店员 C') for (const id of ['joy', 'shy']) pack.sprites[key].emotions[id] = pack.sprites[key].emotions.calm
      outfit.sprite = { ...outfit.sprite, manifestKey: key }
      // private fork: old in-memory samples now declare exactly their authored slots.
      outfit.emotions=Object.keys(pack.sprites[key].emotions)
      figure.emotions=[...new Map([...(figure.emotions||[]),...outfit.emotions.map(id=>({id,label:({calm:'平和',joy:'喜悦',shy:'害羞'})[id]||id}))].map(row=>[row.id,row])).values()]
    }
    return pack
  }
  service.listPackSummaries = async () => (await list()).map(native)
  service.getPackSnapshot = async a => native(await snapshot(a))
}

// private fork (missing-ui, owner 2026-10): 舞台设置 shows no 「缺 N」; the tile opens the figure, whose editor shows the gaps
// as dashed ✦ tiles (one language in 立绘 / 头像).
test('private fork: 舞台设置 carries no 「缺 N」; the figure editor lists only the declared 差分', async () => {
  const { source, picker, playback } = await stageSource()
  const pieces = await hostPieces()
  const browser = await chromium.launch({ headless: true })
  try {
    for (const [theme, tokens] of Object.entries(THEMES)) for (const [size, viewport, pane] of [['desktop', { width: 1600, height: 900 }, 720], ['375', { width: 375, height: 812 }, 0]]) {
      const page = await browser.newPage({ viewport, deviceScaleFactor: size === '375' ? 2 : 1 }), tag = theme + '/' + size
      const errors = []; page.on('pageerror', e => errors.push(e.message))
      await page.route('http://stage.test/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"></head><body class="dsh-tavern-shell-active"><div class="host"><main class="chat"></main><section class="pane" data-sidebar-right-panel><div id="panel"></div></section></div></body></html>' }))
      await page.goto('http://stage.test/')
      await page.addStyleTag({ content: css + `
        html, body { margin: 0; height: 100%; } body { ${tokens} background: var(--page); font-family: "Microsoft YaHei UI", "PingFang SC", sans-serif; }
        .host { display: flex; height: 100vh; } .chat { flex: 1; background: var(--page); }
        .pane { width: ${pane ? pane + 'px' : '100%'}; flex: none; height: 100%; overflow: auto; border-left: 1px solid var(--fork-hairline); background: ${theme === 'dark' ? '#0b0b0c' : '#d4d8de'}; container-type: inline-size; }
        #panel { display: flex; flex-direction: column; min-height: 100%; } ${pane ? '' : '.chat { display: none; }'}` })
      await page.evaluate(context => { document.body.dataset.fkContext = context }, 'chat-' + theme)
      await page.addScriptTag({ content: await browserReactScript() + ';window.React=modules.react;window.ReactDOM={...modules["react-dom/client"],createPortal:modules["react-dom"].createPortal};' + playback + source + picker + '\n;\n' + pieces + '\n;window.forkStagePrompts=forkStagePrompts;window.ForkHelpTip=ForkHelpTip;' })
      await page.evaluate(pageSetup)
      await page.evaluate(() => { window.scenario('main') })
      await page.evaluate(r5Setup)
      await page.evaluate(missingSetup)
      await page.evaluate(() => window.showReal('mv' + Math.random()))
      // private fork (stage setup wizard, owner 2026-10-15): 舞台设置 has no 人物 tiles any more; a figure opens from its pack row.
      await page.getByRole('button', { name: '打开 通用素材' }).waitFor(); await page.waitForTimeout(700)
      assert.equal(await page.locator('.ap-cast').count(), 0, tag + ' no 人物 section')
      assert.doesNotMatch(await page.locator('.ap-stage').innerText(), /缺 ?\d/, tag)
      // private fork (figure select, owner 2026-10): 少女 A's outfit declares only 平和 — her grid lists exactly that, no virtual
      // dashed 喜悦 / 害羞 (a dashed ✦ is a declared 差分 without its picture).
      await page.getByRole('button', { name: '打开 通用素材' }).click(); await page.waitForTimeout(600)
      await page.getByRole('option', { name: /少女 A/ }).click(); await page.waitForTimeout(900)
      await page.getByRole('radio', { name: '立绘', exact: true }).click().catch(() => {}); await page.waitForTimeout(300)
      const faces = await page.locator('.ap-face').evaluateAll(nodes => nodes.map(n => n.getAttribute('aria-label') + (n.dataset.missing ? ':missing' : '')))
      assert.deepEqual(faces, ['平和'], tag + ': exactly the declared 差分')
      assert.equal(await page.locator('.ap-face[data-missing] .ap-figure-silhouette, .ap-emotion-cell .ap-slot-upload').count(), 0, tag + ': no person icon, no per-tile upload')
      if (shots) await page.screenshot({ path: path.join(shots, `panel-editor-${theme}-${size}.png`) })
      assert.deepEqual(errors, [], tag)
      await page.close()
    }
  } finally { await browser.close() }
})
