import test from 'node:test'
import assert from 'node:assert/strict'

test('全屏顶部安全区与输入卡描边回归', { skip: !process.env.TAVERN_BROWSER_TESTS, timeout: 90000 }, async t => {
  const { chromium } = await import('playwright')
  const { install, nativeComposer, viewport } = await import('./fixtures/mobile-layout-browser.mjs')
  const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
    : process.platform === 'win32' ? { channel: 'msedge' } : {})
  t.after(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true })
  const cdp = await page.context().newCDPSession(page)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  const top = selector => page.locator(selector).evaluate(el => el.getBoundingClientRect().top)

  await t.test('手机与平板进入原生全屏后贴顶，侧栏显隐不改变主顶栏位置', async () => {
    for (const width of [390, 1024, 1280]) {
      await page.setViewportSize({ width, height: 900 }); await install(page)
      if (width >= 1024) await page.evaluate(() => {
        const frame = document.querySelector('#frame'), root = document.createElement('div')
        root.dataset.slot = 'root'; root.style.display = 'contents'
        frame.before(root); root.append(frame); frame.classList.add('host_frame'); frame.removeAttribute('data-mobile-nav')
      })
      await page.locator('[aria-label="全屏"]').evaluate(button => {
        button.onclick = () => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()
      })
      for (const inset of [28, 44]) {
        await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: inset, left: 12, right: 18, bottom: 0 } }); await settle()
        assert.equal(await top('header'), inset)
        await page.evaluate(() => document.documentElement.classList.add('dsh-tavern-play-fullscreen')); await settle()
        assert.equal(await top('header'), inset, '布局降级仍应避开浏览器安全区')
        await page.getByRole('button', { name: '全屏', exact: true }).click()
        await page.waitForFunction(() => document.fullscreenElement); await settle()
        assert.equal(await top('header'), 0)
        await page.getByRole('button', { name: '资源面板', exact: true }).click(); await settle()
        assert.equal(await top('[data-dockkit-strip]'), 0)
        assert.equal(await top('header'), 0)
        await page.getByRole('button', { name: '折叠资源面板' }).click(); await settle()
        await page.getByRole('button', { name: '全屏', exact: true }).click()
        await page.waitForFunction(() => !document.fullscreenElement); await settle()
        assert.equal(await top('header'), inset)
        await page.getByRole('button', { name: '资源面板', exact: true }).click(); await settle()
        assert.equal(await top('[data-dockkit-strip]'), inset)
        await page.getByRole('button', { name: '折叠资源面板' }).click(); await settle()
        await page.evaluate(() => document.documentElement.classList.remove('dsh-tavern-play-fullscreen'))
      }
    }
    await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: {} })
    await page.setViewportSize({ width: 390, height: 844 })
  })

  await t.test('行动项折叠后仍绘制完整上描边，键盘收放不裁掉输入框', async () => {
    await install(page); await nativeComposer(page)
    // 真实 InputBar 用外侧阴影描边；显眼颜色仅用于检查实际绘制像素，不改写 border 或容器布局。
    await page.addStyleTag({ content: ':root{--dsw-elevation-soft:0 0 0 1px rgb(200,0,0)}' })
    await page.locator('[contenteditable]').fill('尚未发送的草稿')
    assert.equal(await page.locator('.dsh-tavern-question-option').count(), 0)
    for (const height of [400, 300, 220, 180, 844]) {
      await viewport(page, { height, offsetTop: height === 844 ? 0 : 25 }); await settle()
      const card = await page.locator('[data-composer-card]').boundingBox()
      const seat = await page.locator('[data-composer-seat]').boundingBox()
      assert.ok(card.y - seat.y >= 3, '描边在滚动裁剪区内部')
      assert.ok(seat.y + seat.height <= (height === 844 ? 0 : 25) + height + 1)
      const clip = { x: Math.floor(card.x + card.width / 2) - 2, y: Math.floor(card.y) - 3, width: 4, height: 6 }
      const screenshot = await page.screenshot({ clip })
      // 浏览器自身解码截图，避免新增图像依赖；缺失上描边时这里没有红色像素。
      const painted = await page.evaluate(async base64 => {
        const image = new Image(); image.src = 'data:image/png;base64,' + base64; await image.decode()
        const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height
        const context = canvas.getContext('2d'); context.drawImage(image, 0, 0)
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
        for (let i = 0; i < pixels.length; i += 4) if (pixels[i] > 150 && pixels[i + 1] < 80 && pixels[i + 2] < 80) return true
        return false
      }, screenshot.toString('base64'))
      assert.equal(painted, true, height + 'px 可视区实际绘出上边框')
    }
    assert.equal(await page.locator('[contenteditable]').innerText(), '尚未发送的草稿')
  })
  assert.deepEqual(errors, [])
})
