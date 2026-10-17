// private fork (section collapse, owner 2026-10): 舞台设置 first-level headings fold their sections — the r5 host-shaped
// pane and mock, desktop and 375 px, light and dark. Checks: every heading is a button with aria-expanded (expanded by
// default); Enter / Space fold; header actions (管理, 基础 / 高级, the refresh icon, (?)) never fold; the count and (?) stay
// visible when folded; the fold survives a reopening (localStorage dsh-tavern:stage-panel-folded).
// Usage: node tests/harness/section-collapse.mjs [outDir]
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { browserReactScript } from '../fixtures/browser-react.mjs'
import { forkThemeCss } from '../helpers/fork-theme-css.mjs'
import { stageSource, pageSetup, THEMES } from './card-centric-stage.mjs'
import { hostPieces, r5Setup } from './stage-panel-r5.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const outDir = process.argv.slice(2).find(a => !a.startsWith('--')) || path.join(root, '.tmp/section-collapse')

export async function run() {
  const { chromium } = await import('playwright')
  const { source, picker, playback } = await stageSource()
  const pieces = await hostPieces(), css = await forkThemeCss()
  await mkdir(outDir, { recursive: true })
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  const shots = [], errors = []
  const check = (ok, message) => { if (!ok) errors.push(message) }
  try {
    for (const [theme, tokens] of Object.entries(THEMES)) for (const [size, viewport, pane] of [['desktop', { width: 1600, height: 900 }, 720], ['375', { width: 375, height: 812 }, 0]]) {
      const page = await browser.newPage({ viewport, deviceScaleFactor: size === '375' ? 2 : 1 })
      const tag = theme + '/' + size
      page.on('pageerror', e => errors.push(tag + ': ' + e.message))
      await page.route('http://stage.test/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"></head><body class="dsh-tavern-shell-active"><div class="host"><main class="chat"></main><section class="pane" data-sidebar-right-panel><div id="panel"></div></section></div></body></html>' }))
      await page.goto('http://stage.test/')
      await page.addStyleTag({ content: css + `
        html, body { margin: 0; height: 100%; } body { ${tokens} background: var(--page); font-family: "Microsoft YaHei UI", "PingFang SC", sans-serif; }
        .host { display: flex; height: 100vh; } .chat { flex: 1; background: var(--page); }
        .pane { width: ${pane ? pane + 'px' : '100%'}; flex: none; height: 100%; overflow: auto; border-left: 1px solid var(--fork-hairline); background: ${theme === 'dark' ? '#0b0b0c' : '#d4d8de'}; container-type: inline-size; }
        #panel { display: flex; flex-direction: column; min-height: 100%; }
        ${pane ? '' : '.chat { display: none; }'}` })
      await page.evaluate(context => { document.body.dataset.fkContext = context }, 'chat-' + theme)
      await page.addScriptTag({ content: await browserReactScript() + ';window.React=modules.react;window.ReactDOM={...modules["react-dom/client"],createPortal:modules["react-dom"].createPortal};' + playback + source + picker + '\n;\n' + pieces + '\n;window.forkStagePrompts=forkStagePrompts;window.ForkHelpTip=ForkHelpTip;' })
      await page.evaluate(pageSetup)
      await page.evaluate(() => { localStorage.removeItem('dsh-tavern:stage-panel-folded'); window.scenario('main') })
      await page.evaluate(r5Setup)
      await page.evaluate(() => window.showReal('c' + Math.random()))
      await page.getByRole('heading', { name: /^人物/ }).waitFor(); await page.waitForTimeout(900)
      const shot = async name => { const file = path.join(outDir, `${name}-${theme}-${size}.png`); await page.waitForTimeout(250); await page.locator('.pane').screenshot({ path: file }); shots.push(file) }
      const step = async (name, fn) => { try { await fn() } catch (e) { errors.push(tag + ' ' + name + ': ' + e.message.split('\n')[0]) } }
      const toggle = title => page.locator('.ap-stage-page > .ap-section > .ap-section-head button.ap-section-toggle').filter({ hasText: new RegExp('^' + title) })
      const folded = title => toggle(title).getAttribute('aria-expanded').then(v => v === 'false')
      const sectionOf = title => page.locator('.ap-stage-page > .ap-section').filter({ has: page.locator('.ap-section-head button.ap-section-toggle').filter({ hasText: new RegExp('^' + title) }) })

      await step('defaults', async () => {
        await shot('01-expanded')
        const states = await page.locator('.ap-stage-page > .ap-section > .ap-section-head button.ap-section-toggle').evaluateAll(n => n.map(x => [x.textContent, x.getAttribute('aria-expanded')]))
        check(states.length >= 5 && states.every(([, v]) => v === 'true'), tag + ': not all expanded ' + JSON.stringify(states))
      })
      await step('actions do not fold', async () => {
        await sectionOf('素材包').locator('.ap-section-head').getByRole('button', { name: '管理' }).click(); await page.waitForTimeout(300)
        check(!(await folded('素材包')), tag + ': 管理 folded 素材包')
        await sectionOf('素材包').locator('.ap-section-head').getByRole('button', { name: '完成' }).click(); await page.waitForTimeout(300)
        const refresh = sectionOf('提示词').getByRole('button', { name: '重新读取提示词' })
        if (await refresh.count()) { await refresh.click(); await page.waitForTimeout(300); check(!(await folded('提示词')), tag + ': refresh folded 提示词') }
        const help = sectionOf('人物').locator('.ap-section-head h3 button').filter({ hasNotText: /人物/ }).first()
        if (await help.count()) { await help.click(); await page.waitForTimeout(200); check(!(await folded('人物')), tag + ': (?) folded 人物'); await page.keyboard.press('Escape') }
      })
      await step('keyboard and click fold', async () => {
        await toggle('素材包').focus(); await page.keyboard.press('Enter'); await page.waitForTimeout(200)
        check(await folded('素材包'), tag + ': Enter did not fold 素材包')
        check(await sectionOf('素材包').locator('.ap-section-body').isHidden(), tag + ': 素材包 body visible when folded')
        check(await sectionOf('素材包').locator('.ap-section-meta').isVisible(), tag + ': 素材包 count hidden when folded')
        check(await sectionOf('素材包').locator('.ap-section-head').getByRole('button', { name: '管理' }).isVisible(), tag + ': 管理 hidden when folded')
        await toggle('人物').focus(); await page.keyboard.press('Space'); await page.waitForTimeout(200)
        check(await folded('人物'), tag + ': Space did not fold 人物')
        await toggle('基础设置').click(); await page.waitForTimeout(200)
        check(await folded('基础设置'), tag + ': click did not fold 基础设置')
        await page.evaluate(() => { document.activeElement?.blur?.(); document.querySelector('.pane').scrollTop = 0 })
        await shot('02-folded')
        await toggle('人物').focus(); await page.waitForTimeout(100)
        await shot('03-focus')
        await page.evaluate(() => document.activeElement?.blur?.())
      })
      await step('remembered', async () => {
        await page.evaluate(() => window.showReal('c' + Math.random()))
        await page.getByRole('heading', { name: /^人物/ }).waitFor(); await page.waitForTimeout(600)
        check(await folded('素材包') && await folded('人物') && await folded('基础设置') && !(await folded('提示词')), tag + ': folds not remembered')
        const stored = await page.evaluate(() => localStorage.getItem('dsh-tavern:stage-panel-folded'))
        check(/"素材包":true/.test(stored), tag + ': storage ' + stored)
        for (const title of ['素材包', '人物', '基础设置']) await toggle(title).click()
        await page.waitForTimeout(200)
        check(!(await folded('素材包')) && !(await folded('人物')), tag + ': unfold failed')
      })
      await page.close()
    }
  } finally { await browser.close() }
  return { shots, errors }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const { shots, errors } = await run()
  console.log(shots.length + ' screenshots → ' + outDir)
  if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1 }
}
