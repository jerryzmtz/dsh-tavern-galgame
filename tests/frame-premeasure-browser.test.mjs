import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { chromium } from 'playwright'
import { browserReactScript } from './fixtures/browser-react.mjs'

const clientSource = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')

test('视口外从未显示过的卡片会先在后台量出真实高度，占位不再用 1200px 估计', { timeout: 60000 }, async t => {
  const browser = await chromium.launch({ headless: true })
  t.after(() => browser.close())
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('http://tavern.test/**', route => route.fulfill({ contentType: 'text/html', body: '<main id="root"></main>' }))
  await page.goto('http://tavern.test/')
  await page.addScriptTag({ content: await browserReactScript() })
  await page.addScriptTag({ content: `window.__ModuleLoader__={load(d){window.client=d.factory(name=>name==='react'?modules.react:{});}};` })
  await page.addScriptTag({ content: clientSource })
  await page.evaluate(() => {
    const React = modules.react, h = React.createElement
    // A long card document makes the generic estimate hit its 1200px cap.
    const content = '<!doctype html><html><body><p style="height:150px;margin:0">面板</p><!--' + 'x'.repeat(40000) + '--></body></html>'
    modules['react-dom/client'].createRoot(document.querySelector('#root')).render(h('div', null,
      h('div', { style: { height: '20000px' } }),
      h(client.TavernMessageFrame, { content, sessionId: 's', turn: 1, partIndex: 0, runtimeReporting: false })))
  })
  const reserved = () => page.evaluate(() => [...document.querySelectorAll('#root div')].at(-1).style.minHeight)
  assert.equal(await reserved(), '1200px')
  await page.waitForFunction(() => [...document.querySelectorAll('#root div')].at(-1).style.minHeight !== '1200px', null, { timeout: 15000 })
  const height = parseFloat(await reserved())
  assert.ok(height >= 140 && height <= 220, String(height))
  assert.equal(await page.evaluate(() => document.querySelectorAll('[data-tavern-measuring-frame], iframe').length), 0, '量完即关闭')
  assert.deepEqual(errors, [])
})
