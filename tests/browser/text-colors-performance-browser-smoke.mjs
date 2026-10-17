// Real browser regression for style-read reuse; timings are observations, not gates.
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { helperClient } from '../fixtures/helper-host-harness.mjs'

const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
  ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {})
try {
  const page = await browser.newPage()
  await page.setContent('<style>:root{color:#222}.dark{color:#ddd}</style><main id="prose"></main>')
  await page.evaluate(({ install, quotes }) => {
    const root = document.querySelector('#prose')
    root.innerHTML = Array.from({ length: 1000 }, () => '<p><span>旁白“<b>你好</b>朋友”</span><em>心想</em><span style="color:red">“保留”</span></p>').join('')
    window.original = root.innerHTML
    window.styleReads = 0
    const read = window.getComputedStyle
    window.getComputedStyle = (...args) => { window.styleReads++; return read(...args) }
    window.ranges = () => [...CSS.highlights.values()].flatMap(highlight => [...highlight].map(range => range.toString()))
    window.colors = new Function('return (' + install + ')')()(root, {}, new Function('return (' + quotes + ')')())
  }, { install: helperClient.installTavernTextColors.toString(), quotes: helperClient.findTavernQuoteRanges.toString() })
  await page.waitForFunction(() => window.ranges().length === 4000)
  const initial = await page.evaluate(() => ({ reads: window.styleReads, unchanged: document.querySelector('#prose').innerHTML === window.original, excluded: !window.ranges().includes('“保留”') }))
  assert.equal(initial.unchanged, true)
  assert.equal(initial.excluded, true)
  assert.ok(initial.reads <= 5000, `style reads should track elements, not repeated ancestor walks: ${initial.reads}`)
  await page.evaluate(() => document.querySelector('span[style]').removeAttribute('style'))
  await page.waitForFunction(() => window.ranges().includes('“保留”'))
  await page.evaluate(() => document.documentElement.className = 'dark')
  await page.waitForFunction(() => [...CSS.highlights].filter(([name]) => name.endsWith('-dark')).reduce((sum, [, value]) => sum + value.size, 0) === 4001)
  await page.evaluate(() => { document.querySelector('b').firstChild.data = '新对白'; })
  await page.waitForFunction(() => window.ranges().includes('新对白'))
  await page.evaluate(() => window.colors.setEnabled(false))
  assert.equal(await page.evaluate(() => window.ranges().length), 0)
  await page.evaluate(() => window.colors.setEnabled(true))
  await page.waitForFunction(() => window.ranges().length === 4001)
  await page.evaluate(() => { document.querySelector('b').textContent = '清理前的更新'; window.colors.dispose(); })
  await page.waitForTimeout(80)
  assert.equal(await page.evaluate(() => CSS.highlights.size), 0)
  console.log(`PASS: 1000 paragraphs, ${initial.reads} style reads; unchanged DOM, author colors, theme invalidation, streaming, toggle and disposal`)
} finally { await browser.close() }
