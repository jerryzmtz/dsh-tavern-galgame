import test from 'node:test'
import assert from 'node:assert/strict'

test('多端输入、短窗口与标签边界', { skip: !process.env.TAVERN_BROWSER_TESTS, timeout: 90000 }, async t => {
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

  await t.test('手机和平板点击输入框即聚焦并收起候选', async () => {
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 900 }); await install(page); await nativeComposer(page)
      await page.locator('[contenteditable]').click()
      assert.equal(await page.locator('[contenteditable]').evaluate(el => el === document.activeElement), true)
      assert.equal(await page.locator('.dsh-tavern-question-option').count(), 0)
      await page.getByRole('button', { name: '展开行动列表', exact: true }).click()
      await page.locator('[contenteditable]').focus()
      assert.equal(await page.locator('.dsh-tavern-question-option').count(), 0)
    }
  })

  await t.test('180–300px 可视区的长草稿、候选与错误提示保持可访问，草稿不会丢失', async () => {
    await page.setViewportSize({ width: 390, height: 844 }); await install(page); await nativeComposer(page)
    const draft = ('很长的未发送草稿。'.repeat(30) + '\n').repeat(30)
    await page.locator('[contenteditable]').fill(draft)
    for (const height of [300, 220, 180]) {
      await viewport(page, { height, offsetTop: 30 }); await settle()
      const seat = await page.locator('[data-composer-seat]').boundingBox()
      assert.ok(seat.y >= 30 && seat.y + seat.height <= height + 31)
      await page.getByRole('button', { name: '发送', exact: true }).scrollIntoViewIfNeeded()
      const send = await page.getByRole('button', { name: '发送', exact: true }).boundingBox()
      assert.ok(send.y >= 30 && send.y + send.height <= height + 31, '发送按钮可见 ' + JSON.stringify({ height, send }))
      assert.ok((await page.locator('[contenteditable]').innerText()).includes('未发送草稿'))
      // 关闭键盘焦点后主动展开列表，短窗口应完整滚动，而不是把列表高度压成 0。
      await page.locator('[aria-label="会话列表"]').focus(); await settle()
      await page.getByRole('button', { name: '展开行动列表', exact: true }).click(); await settle()
      const sheet = await page.locator('.dsh-tavern-candidate-question').boundingBox()
      const header = await page.locator('header').boundingBox()
      assert.ok(sheet.y >= header.y + header.height && sheet.y + sheet.height <= 30 + height)
      await page.locator('.dsh-tavern-question-option').last().click()
      await page.getByRole('button', { name: '收起行动列表', exact: true }).click()
      await page.locator('[contenteditable]').focus()
    }
    await page.evaluate(() => {
      const error = document.createElement('div'); error.className = 'dsh-tavern-candidate-error-banner'
      error.textContent = '连接暂时不可用，请稍后重试。'.repeat(100)
      document.querySelector('[data-composer-card]').before(error)
    }); await settle()
    await page.getByRole('button', { name: '发送', exact: true }).scrollIntoViewIfNeeded()
    const error = await page.locator('.dsh-tavern-candidate-error-banner').boundingBox()
    assert.ok(error.height <= 36, '长错误内部滚动，不把发送区推出窗口')
    await viewport(page, { height: 844, offsetTop: 0 })
    assert.ok((await page.locator('[contenteditable]').innerText()).includes('未发送草稿'))
    assert.equal(await page.locator('html').evaluate(el => el.classList.contains('dsh-tavern-short-viewport')), false)
  })

  await t.test('宽屏触控设备跟随软键盘，鼠标桌面维持原布局和字号', async () => {
    for (const width of [1024, 1280, 1366]) {
      await page.setViewportSize({ width, height: 900 }); await install(page); await nativeComposer(page)
      await page.evaluate(() => {
        // 真宿主跨到宽屏后卸载 mobile-nav 标记，保留根插槽及 frame 类。
        const frame = document.querySelector('#frame'), root = document.createElement('div')
        root.dataset.slot = 'root'; root.style.display = 'contents'
        frame.before(root); root.append(frame); frame.classList.add('host_frame'); frame.removeAttribute('data-mobile-nav')
      })
      await viewport(page, { height: 450, offsetTop: 25 })
      const seat = await page.locator('[data-composer-seat]').boundingBox()
      assert.ok(seat.y + seat.height <= 476)
      const card = await page.locator('[data-composer-card]').boundingBox(), sheet = await page.locator('.dsh-tavern-candidate-question').boundingBox()
      assert.ok(sheet.x >= card.x && sheet.x + sheet.width <= card.x + card.width, '平板浮层不覆盖相邻侧栏')
      assert.equal(await page.locator('[contenteditable]').evaluate(el => getComputedStyle(el).fontSize), '16px')
      assert.equal(await page.locator('html').evaluate(el => el.classList.contains('dsh-tavern-coarse-play')), false, '触屏不强制手机抽屉布局')
      await nativeSettings(page)
      await page.waitForFunction(() => document.getAnimations().every(a => a.playState !== 'running'))
      const settings = await page.locator('[role="dialog"]').boundingBox()
      assert.ok(settings.y >= 25 && settings.y + settings.height <= 475)
    }
    const desktop = await browser.newPage({ viewport: { width: 1280, height: 900 }, hasTouch: false })
    await install(desktop); await nativeComposer(desktop)
    assert.equal(await desktop.locator('[contenteditable]').evaluate(el => getComputedStyle(el).fontSize), '14px')
    assert.equal(await desktop.locator('#frame').evaluate(el => getComputedStyle(el).position), 'static')
    await desktop.close()
  })

  assert.deepEqual(errors, [])
})
