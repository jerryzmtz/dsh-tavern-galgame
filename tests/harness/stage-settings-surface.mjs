// private fork (rename-mod, owner 2026-10): the user-facing widget term is 模组 (display text only; ids stay widgets).
// private fork: 舞台设置 inside a host-shaped tab (fixed-height scrolling pane > flex-column tab host > .ap-ui), the
// layout the live sidebar uses. Checks that the panel's base paint covers the whole scrolled page (one surface) and
// shoots the 模组 / 配音 action affordances in light/dark. Usage: node tests/harness/stage-settings-surface.mjs [outDir]
// `--before` re-applies the shrinkable panel to reproduce the owner's split background.
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { browserReactScript } from '../fixtures/browser-react.mjs'
import { forkThemeCss } from '../helpers/fork-theme-css.mjs'
import { stageSource, pageSetup, THEMES } from './card-centric-stage.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const args = process.argv.slice(2), before = args.includes('--before')
const outDir = args.find(a => !a.startsWith('--')) || path.join(root, '.tmp/stage-settings-surface')

export async function run() {
  const { chromium } = await import('playwright')
  const { source, picker, playback } = await stageSource()
  const css = await forkThemeCss()
  await mkdir(outDir, { recursive: true })
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  const shots = [], errors = [], report = []
  try {
    for (const [theme, tokens] of Object.entries(THEMES)) {
      const page = await browser.newPage({ viewport: { width: 1100, height: 760 } })
      page.on('pageerror', e => errors.push(theme + ': ' + e.message))
      await page.route('http://stage.test/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"></head><body><div class="host"><main class="chat"></main><section class="pane"><div id="panel"></div></section></div></body></html>' }))
      await page.goto('http://stage.test/')
      // The pane frame is a translucent host paint (as live: rgba(21,21,23,.19)); anything the panel does not cover shows it.
      await page.addStyleTag({ content: css + `
        html, body { margin: 0; height: 100%; } body { ${tokens} background: var(--page); font-family: "Microsoft YaHei UI", "PingFang SC", sans-serif; }
        .host { display: flex; height: 100vh; } .chat { flex: 1; background: var(--page); }
        .pane { width: 520px; flex: none; height: 100%; overflow: auto; border-left: 1px solid var(--fork-hairline); background: ${theme === 'dark' ? '#0b0b0c' : '#d4d8de'}; }
        #panel { display: flex; flex-direction: column; height: 100%; min-height: 0; }
        ${before ? '.ap-ui { flex-shrink: 1; }' : ''}` })
      await page.evaluate(context => { document.body.dataset.fkContext = context }, 'chat-' + theme)
      await page.addScriptTag({ content: await browserReactScript() + ';window.React=modules.react;window.ReactDOM=modules["react-dom/client"];' + playback + source + picker })
      await page.evaluate(pageSetup)
      const start = async (tts) => {
        await page.evaluate(t => {
          window.scenario('main')
          if (t === 'empty') window.binding.tts = { ...window.binding.tts, listVoices: async () => [{ id: 'x/y', label: 'Y', state: 'error' }] }
          window.show('main' + t + Math.random())
        }, tts)
        await page.getByText('本卡读音词典').waitFor(); await page.waitForTimeout(400)
      }
      const shot = async name => { const file = path.join(outDir, `${name}-${theme}${before ? '-before' : ''}.png`); await page.locator('.pane').screenshot({ path: file }); shots.push(file) }
      const scrollTo = async heading => page.evaluate(text => { const pane = document.querySelector('.pane'), el = [...document.querySelectorAll('.ap-section-head h3')].find(n => n.textContent.startsWith(text)); pane.scrollTop += el.getBoundingClientRect().top - 140 }, heading)

      await start('ok')
      const m = await page.evaluate(() => {
        const pane = document.querySelector('.pane'), ui = document.querySelector('.ap-ui'), last = [...ui.querySelectorAll('.ap-section')].pop()
        return { pane: pane.clientHeight, scroll: pane.scrollHeight, ui: Math.round(ui.getBoundingClientRect().height), uiScroll: ui.scrollHeight, lastBottom: Math.round(last.getBoundingClientRect().bottom - ui.getBoundingClientRect().top), bg: getComputedStyle(ui).backgroundColor }
      })
      report.push(theme + ': ' + JSON.stringify(m))
      if (!before && (m.ui < m.uiScroll || m.ui < m.lastBottom)) errors.push(theme + ': panel paint ends at ' + m.ui + 'px but the page is ' + m.uiScroll + 'px')
      // No section carries its own paint: every section resolves to a transparent background over the one panel surface.
      const painted = await page.evaluate(() => [...document.querySelectorAll('.ap-ui .ap-section, .ap-ui .ap-card, .ap-ui .ap-section-body, .ap-ui .ap-switch-row')].filter(el => { const cs = getComputedStyle(el); return cs.backgroundColor !== 'rgba(0, 0, 0, 0)' || cs.backgroundImage !== 'none' }).map(el => el.className))
      if (painted.length) errors.push(theme + ': painted containers ' + painted.join(', '))
      await shot('01-top')
      await scrollTo('演出规则'); await shot('02-direction-to-widgets')
      await scrollTo('模组'); await shot('03-widgets-audio-openings')
      await page.evaluate(() => { const p = document.querySelector('.pane'); p.scrollTop = p.scrollHeight }); await shot('04-bottom')
      const widget = page.locator('.ap-switch-row', { has: page.getByRole('switch', { name: '模组' }) })
      if (!(await widget.getByRole('switch').isDisabled())) errors.push(theme + ': widget switch should be disabled')
      if (!(await widget.getByRole('img', { name: '全局组件执行未开启' }).count())) errors.push(theme + ': widget warning mark missing')
      if (!(await widget.getByRole('button', { name: /引擎设置/ }).count())) errors.push(theme + ': engine chip missing')
      const greys = await page.evaluate(() => [...document.querySelectorAll('.ap-ui .ap-hint-line')].map(el => getComputedStyle(el).color + ' vs ' + getComputedStyle(document.querySelector('.ap-ui')).color))
      report.push(theme + ' hint ink: ' + greys.join('; '))
      await widget.getByRole('button', { name: /引擎设置/ }).click(); await page.getByRole('button', { name: '‹ 舞台设置' }).waitFor()
      await page.getByRole('button', { name: '‹ 舞台设置' }).click()
      await start('empty'); await page.evaluate(() => { document.querySelector('.pane').scrollTop = 0 }); await page.getByRole('img', { name: '没有可用的语音服务' }).waitFor(); await shot('05-voice-empty')
      await page.close()
    }
  } finally { await browser.close() }
  return { shots, errors, report }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const { shots, errors, report } = await run()
  console.log(report.join('\n'))
  console.log(shots.length + ' screenshots → ' + outDir)
  if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1 }
}
