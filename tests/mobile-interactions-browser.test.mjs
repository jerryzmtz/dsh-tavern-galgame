import test from 'node:test'
import assert from 'node:assert/strict'

test('移动端真实输入器、插槽和菜单回归', { skip: !process.env.TAVERN_BROWSER_TESTS, timeout: 90000 }, async t => {
  const { chromium } = await import('playwright')
  const { install, viewport, nativeComposer, mountClientAudit, nativeSettings } = await import('./fixtures/mobile-layout-browser.mjs')
  const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
    : process.platform === 'win32' ? { channel: 'msedge' } : {})
  t.after(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  const box = selector => page.locator(selector).boundingBox()

  await t.test('contenteditable 草稿在窄屏、横屏和键盘切换后保留，发送与模型入口不挤出屏幕', async () => {
    await install(page); await nativeComposer(page)
    await page.locator('[contenteditable]').fill('一段尚未发送的草稿\n第二行')
    await page.locator('.model_root').evaluate(root => {
      const menu = document.createElement('div'); menu.className = 'model_menu'; menu.role = 'menu'
      menu.innerHTML = Array.from({ length: 16 }, (_, i) => '<button role="menuitem">测试模型 ' + i + '</button>').join('')
      root.append(menu)
    })
    await page.addStyleTag({ content: '.model_menu button{display:block;width:100%}' })
    for (const size of [{ width: 320, height: 720 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
      await page.setViewportSize(size)
      await viewport(page, { ...size, offsetTop: 0 })
      assert.equal(await page.locator('[contenteditable]').evaluate(el => getComputedStyle(el).fontSize), '16px')
      const rects = await page.locator('[data-composer-card] button:not([role="menuitem"])').evaluateAll(es => es.map(el => {
        const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }
      }))
      for (const rect of rects) {
        assert.ok(rect.width >= 40 && rect.height >= 40, '输入工具触摸区域至少 40px')
        assert.ok(rect.x >= 0 && rect.x + rect.width <= size.width, '输入工具完整可见')
        assert.ok(Math.abs(rect.y - rects[0].y) <= 1, '发送与其余图标垂直对齐')
      }
      await viewport(page, { height: 280, offsetTop: 30 })
      const seat = await box('[data-composer-seat]')
      assert.ok(seat.y + seat.height <= 311, '键盘不会盖住输入工具')
      const menu = await box('.model_menu')
      assert.ok(menu.x >= 0 && menu.x + menu.width <= size.width, '模型菜单不伸出屏幕左侧')
      assert.ok(menu.y >= 30 && menu.y + menu.height <= 310, '短窗口模型菜单可覆盖内容区，但始终位于键盘上方')
      assert.match(await page.locator('[contenteditable]').innerText(), /尚未发送的草稿/)
      await viewport(page, { ...size, offsetTop: 0 })
    }
    await page.setViewportSize({ width: 1280, height: 900 }); await settle()
    assert.equal(await page.locator('[contenteditable]').evaluate(el => getComputedStyle(el).fontSize), '16px', '触屏平板横屏仍保留可输入字号')
  })

  await t.test('真实 utilities 插槽不重复展示日志，嵌套面板标签关闭和新增保持可触摸', async () => {
    await page.setViewportSize({ width: 320, height: 720 }); await install(page)
    await page.evaluate(() => {
      const utilities = document.querySelector('header [class*="_headerUtilities"]'), slot = document.createElement('div')
      slot.dataset.slot = 'conversation.session.header.utilities'; slot.style.display = 'contents'
      slot.append(...utilities.children); utilities.append(slot)
      const log = document.createElement('button'); log.id = 'duplicate-log'; log.textContent = 'Session 日志'; slot.prepend(log)
    }); await settle()
    assert.equal(await page.locator('#duplicate-log').isVisible(), false)
    assert.equal(await page.locator('.dsh-tavern-header-settings').isVisible(), true)
    await page.getByRole('button', { name: '资源面板', exact: true }).click(); await settle()
    for (const selector of ['[data-dockkit-add-tab]', '[data-dockkit-tab-close]', '[data-sidebar-right-toggle]', '[data-sidebar-right-mode]']) {
      const rect = await box(selector)
      assert.ok(rect.width >= 40 && rect.height >= 40 && rect.x >= 0 && rect.x + rect.width <= 320)
      assert.equal(await page.locator(selector).evaluate(el => { const r = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)) }), true)
    }
    await viewport(page, { height: 300, offsetTop: 20 }); await settle()
    const panel = await box('[data-sidebar-right-panel]')
    assert.equal(panel.y, 20); assert.equal(panel.height, 300)
    await page.getByRole('button', { name: '折叠资源面板' }).click()
    assert.equal(await page.locator('[data-sidebar-right-panel]').isVisible(), false)
  })

  await t.test('真实分组和行菜单随键盘高度、可视区偏移与横屏变化重定位并可关闭', async () => {
    await page.setViewportSize({ width: 320, height: 720 }); await install(page)
    await viewport(page, { height: 720, offsetTop: 0 }); await mountClientAudit(page, 'organization')
    for (const selector of ['.dsh-tavern-group-picker', '.dsh-tavern-card-row-menu']) {
      await page.locator(selector + ' > summary').click()
      const popup = page.locator(selector + ' [popover]')
      await page.waitForFunction(sel => document.querySelector(sel).matches(':popover-open'), selector + ' [popover]')
      for (const state of [{ width: 320, height: 320, offsetTop: 35 }, { width: 844, height: 220, offsetTop: 60 }, { width: 320, height: 720, offsetTop: 0 }]) {
        await page.setViewportSize({ width: state.width, height: 720 })
        await viewport(page, state); await settle()
        const rect = await popup.boundingBox()
        assert.ok(rect.x >= 0 && rect.x + rect.width <= state.width, '菜单左右不越界')
        assert.ok(rect.y >= state.offsetTop && rect.y + rect.height <= state.offsetTop + state.height, '键盘上方可以滚动访问所有分组 ' + JSON.stringify({ selector, state, rect }))
      }
      await popup.locator('button').first().focus(); await page.keyboard.press('Escape'); await settle()
      assert.equal(await page.locator(selector).getAttribute('open'), null)
    }
    await page.evaluate(() => window.auditReactRoot.unmount()); await viewport(page, { height: 280, offsetTop: 20 })
    assert.equal(await page.locator('[popover]').count(), 0, '卸载后不残留菜单')
  })


  await t.test('开场 iframe 预览与宿主全局设置在键盘上方可滚动，不受旧的桌面高度覆盖', async () => {
    await page.setViewportSize({ width: 320, height: 720 }); await install(page)
    await viewport(page, { height: 340, offsetTop: 30 })
    await page.evaluate(() => {
      const overlay = document.createElement('div'); overlay.className = 'dsh-tavern-picker-overlay'
      overlay.innerHTML = '<div class="dsh-tavern-card-picker"><div class="dsh-tavern-card-picker-head">开场预览<button class="dsh-tavern-btn">关闭</button></div><div class="dsh-tavern-greeting-preview"><div class="dsh-tavern-message-frame-slot"><iframe class="dsh-tavern-message-frame" title="开场" srcdoc="<p>开场文字</p>"></iframe></div></div><input placeholder="玩家名称"><div class="dsh-tavern-picker-foot"><button class="dsh-tavern-question-primary">开始新游戏</button></div></div>'
      document.body.append(overlay)
    }); await settle()
    const picker = await box('.dsh-tavern-card-picker'), preview = await box('.dsh-tavern-greeting-preview')
    assert.ok(picker.y >= 30 && picker.y + picker.height <= 370)
    assert.ok(preview.height <= 340 * .45 + 1)
    await page.locator('.dsh-tavern-question-primary').last().scrollIntoViewIfNeeded()
    const start = await page.locator('.dsh-tavern-question-primary').last().boundingBox()
    assert.ok(start.y >= 30 && start.y + start.height <= 370, '开场操作可以滚动到键盘上方')
    await page.locator('.dsh-tavern-picker-overlay').evaluate(el => el.remove())
    await nativeSettings(page); await settle()
    await page.waitForFunction(() => document.getAnimations().filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity).every(animation => animation.playState !== 'running'))
    const dialog = await box('[role="dialog"]')
    assert.ok(dialog.y >= 30 && dialog.y + dialog.height <= 370, '宿主全局设置采用相同可视高度 ' + JSON.stringify(dialog))
    assert.equal(await page.getByRole('textbox', { name: '筛选设置' }).evaluate(el => getComputedStyle(el).fontSize), '16px')
    assert.ok((await page.getByRole('button', { name: '关闭', exact: true }).boundingBox()).height >= 40)
  })

  assert.deepEqual(errors, [])
})
