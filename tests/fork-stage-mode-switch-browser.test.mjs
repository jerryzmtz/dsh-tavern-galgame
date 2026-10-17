// private fork (owner 2026-10, option A): 舞台设置 has no 「基础 | 高级」 switch any more. 「开场设置」 and 「提示词」 always end the
// page, folded by default, and open on click (提示词 reads its story / director preview only once opened). A stored mode from
// the old switch is ignored. Real panel + real prompts adapter (stage-panel-r5 mock), production CSS, a 380 px side pane and a
// 375 px phone.
import test from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { browserReactScript } from './fixtures/browser-react.mjs'
import { forkThemeCss } from './helpers/fork-theme-css.mjs'
import { stageSource, pageSetup, THEMES } from './harness/card-centric-stage.mjs'
import { hostPieces, r5Setup } from './harness/stage-panel-r5.mjs'

test('private fork: 舞台设置 has no 基础/高级 switch; 开场设置 and 提示词 end the page folded and open on click', async () => {
  const { source, picker, playback } = await stageSource()
  const pieces = await hostPieces(), css = await forkThemeCss()
  const browser = await chromium.launch({ headless: true })
  try {
    for (const [size, viewport, pane, stored] of [['sidebar', { width: 1280, height: 720 }, 380, 'advanced'], ['375', { width: 375, height: 812 }, 0, 'basic']]) {
      const page = await browser.newPage({ viewport }), errors = [], tag = size
      page.on('pageerror', e => errors.push(e.message))
      await page.route('http://stage.test/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"></head><body class="dsh-tavern-shell-active"><div class="host"><main class="chat"></main><section class="pane" data-sidebar-right-panel><div id="panel"></div></section></div></body></html>' }))
      await page.goto('http://stage.test/')
      await page.addStyleTag({ content: css + `
        html, body { margin: 0; height: 100%; } body { ${THEMES.light} background: var(--page); font-family: "Microsoft YaHei UI", sans-serif; }
        *, *::before, *::after { animation-duration: 0s !important; transition: none !important; }
        .host { display: flex; height: 100vh; } .chat { flex: 1; }
        .pane { width: ${pane ? pane + 'px' : '100%'}; flex: none; height: 100%; overflow: auto; container-type: inline-size; }
        #panel { display: flex; flex-direction: column; min-height: 100%; } ${pane ? '' : '.chat { display: none; }'}` })
      await page.addScriptTag({ content: await browserReactScript() + ';window.React=modules.react;window.ReactDOM={...modules["react-dom/client"],createPortal:modules["react-dom"].createPortal};' + playback + source + picker + '\n;\n' + pieces + '\n;window.forkStagePrompts=forkStagePrompts;window.ForkHelpTip=ForkHelpTip;' })
      await page.evaluate(pageSetup)
      // A mode stored by the old switch changes nothing.
      await page.evaluate(m => { localStorage.setItem('dsh-tavern:stage-panel-mode', m); window.scenario('main') }, stored)
      await page.evaluate(r5Setup)
      await page.evaluate(() => { const rpc = window.rpc; window.hostCalls = []; window.rpc = (method, ...rest) => { window.hostCalls.push(method); return rpc(method, ...rest) } })
      await page.evaluate(() => window.showReal('tail' + Math.random()))
      await page.locator('.ap-stage-page .ap-switch-name').first().waitFor(); await page.waitForTimeout(600)
      const stage = page.locator('.ap-stage-page')
      assert.equal(await page.getByRole('radiogroup', { name: '显示模式' }).count(), 0, tag + ': no 显示模式 switch')
      for (const name of ['基础', '高级']) assert.equal(await stage.getByRole('radio', { name, exact: true }).count(), 0, tag + ': no ' + name + ' radio')
      const titles = await page.locator('.ap-stage-page > section, .ap-stage-page > div > section').evaluateAll(nodes => nodes.map(n => (n.querySelector('.ap-section-title, .ap-opening-title')?.textContent || '').trim()))
      assert.deepEqual(titles.slice(-2), ['开场设置', '提示词'], tag + ': both end the page ' + JSON.stringify(titles))
      assert.ok(titles[0] === '基础设置', tag)
      const toggle = name => stage.locator('button.ap-opening-toggle, button.ap-section-toggle').filter({ hasText: name }).first()
      const prompts = page.locator('.ap-stage-page > .ap-prompt-section')
      // Folded: only the headings; 提示词 has not read the director preview.
      assert.equal(await toggle('开场设置').getAttribute('aria-expanded'), 'false', tag + ' 开场设置 folded')
      assert.equal(await toggle('提示词').getAttribute('aria-expanded'), 'false', tag + ' 提示词 folded')
      assert.equal(await page.locator('.ap-stage-page > .ap-opening-section > .ap-section-body').count(), 0, tag)
      assert.equal(await prompts.locator('.ap-section-body').isVisible(), false, tag)
      assert.equal(await page.evaluate(() => window.hostCalls.includes('previewStageDirectorPrompt')), false, tag + ': no director preview read while folded')
      // Click opens each; the heading keeps the focus; a second click folds again (remembered).
      await toggle('开场设置').click(); await page.waitForTimeout(300)
      assert.equal(await toggle('开场设置').getAttribute('aria-expanded'), 'true', tag)
      assert.equal(await page.locator('.ap-stage-page > .ap-opening-section > .ap-section-body').isVisible(), true, tag + ' 开场设置 body')
      await toggle('提示词').click(); await page.waitForTimeout(500)
      assert.equal(await toggle('提示词').getAttribute('aria-expanded'), 'true', tag)
      assert.equal(await prompts.locator('.ap-section-body').isVisible(), true, tag + ' 提示词 body')
      assert.match(await prompts.innerText(), /正文模型/, tag + ' 提示词 content')
      assert.equal(await page.evaluate(() => window.hostCalls.includes('previewStageDirectorPrompt')), true, tag + ': opening reads the director preview')
      assert.equal(await toggle('提示词').evaluate(n => n === document.activeElement), true, tag + ': focus stays on 提示词')
      assert.ok(await prompts.getByRole('button', { name: '重新读取提示词' }).count(), tag + ' refresh when open')
      await page.keyboard.press('Enter'); await page.waitForTimeout(300)
      assert.equal(await toggle('提示词').getAttribute('aria-expanded'), 'false', tag + ' Enter folds again')
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('dsh-tavern:stage-panel-folded'))['提示词']), true, tag + ' remembered')
      assert.deepEqual(errors, [], tag)
      await page.close()
    }
  } finally { await browser.close() }
})
