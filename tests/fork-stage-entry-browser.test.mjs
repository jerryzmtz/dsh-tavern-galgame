// private fork (stage perf 2026-10): 「从这里进入舞台」 entries are plain children of their text blocks, not
// per-block React portals. Each portal container installed React's full delegated listener set (~131 listeners),
// ~240k on the 1,839-entry Madoka chat. Production transcript in headless Chrome; no network, no live host.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { chromium } from 'playwright'
import { browserReactScript } from './fixtures/browser-react.mjs'
import { transcriptSource } from './helpers/fork-transcript-perf-ui.mjs'
const read = name => fs.readFileSync(new URL('../tavern-plugin/src/client/' + name, import.meta.url), 'utf8')

test('chat stage entries: no per-block portal, button ends each block, one delegated click per markdown', { timeout: 60000 }, async () => {
  for (const file of ['fork-gal-chat-entry.js', 'fork-gal-history.js']) assert.doesNotMatch(read(file), /createPortal/, file)
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  try {
    const page = await browser.newPage()
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.route('**/*', route => route.abort())
    await page.setContent('<style>#transcript-scroll{z-index:0!important}</style>')
    const cdp = await page.context().newCDPSession(page)
    const listeners = async () => (await cdp.send('Memory.getDOMCounters')).jsEventListeners
    const empty = await listeners()
    await page.addScriptTag({ content: await browserReactScript() + '\nconst React=modules.react,ReactDOM={...modules["react-dom"],...modules["react-dom/client"]};\n' + transcriptSource(read) })
    await page.waitForTimeout(300)
    const result = await page.evaluate(async () => {
      const calls = []
      window.forkGalEnter = (...args) => calls.push(JSON.parse(JSON.stringify(args)))
      const buttons = [...document.querySelectorAll('#transcript .fork-stage-enter-here')]
      const shape = buttons.map(button => {
        const block = button.parentElement
        return { last: block.lastChild === button, bubble: block.classList.contains('fork-bubble-text'), para: block.closest('[data-fork-stage-para]')?.getAttribute('data-fork-stage-para'),
          turn: block.closest('[data-fork-stage-turn]')?.getAttribute('data-fork-stage-turn'), type: button.type, label: button.getAttribute('aria-label'), title: button.title, text: button.textContent }
      })
      const blocks = document.querySelectorAll('#transcript .fork-stage-paragraph').length
      const markdown = buttons.find(button => !button.parentElement.classList.contains('fork-bubble-text'))
      const bubble = buttons.find(button => button.parentElement.classList.contains('fork-bubble-text'))
      const parentClicks = []
      document.addEventListener('click', event => parentClicks.push(event.target.className), { once: false })
      markdown.click(); bubble.click()
      // Text changes under a mounted block: the button returns to the end of its block exactly once.
      const p = markdown.parentElement
      p.appendChild(document.createTextNode(' tail'))
      await new Promise(resolve => setTimeout(resolve, 50))
      const after = { last: p.lastChild?.classList?.contains('fork-stage-enter-here'), count: p.querySelectorAll(':scope > .fork-stage-enter-here').length }
      return { shape, blocks, calls, parentClicks, after,
        expected: [markdown, bubble].map(button => ({ turn: Number(button.parentElement.closest('[data-fork-stage-turn]').getAttribute('data-fork-stage-turn')), para: Number(button.parentElement.closest('[data-fork-stage-para]').getAttribute('data-fork-stage-para')) })) }
    })
    const mounted = await listeners() - empty
    assert.deepEqual(errors, [])
    assert.ok(result.shape.length > 1000, 'fixture renders a long transcript: ' + result.shape.length)
    assert.equal(result.shape.length, result.blocks, 'one entry per stage paragraph')
    assert.ok(result.shape.every(item => item.last && item.para && item.turn && item.type === 'button' && item.label === '从这里进入舞台' && item.title === '从这里进入舞台' && item.text === ''), 'icon-only button ends its own block')
    assert.ok(result.shape.some(item => item.bubble) && result.shape.some(item => !item.bubble))
    assert.deepEqual(result.calls, result.expected.map(target => ['offline', target]), 'markdown and bubble entries enter at their own paragraph')
    assert.deepEqual(result.parentClicks, [], 'entry clicks stop at the entry, as before')
    assert.deepEqual(result.after, { last: true, count: 1 })
    // Portals added ~131 listeners per entry; plain buttons add none of their own.
    assert.ok(mounted < result.shape.length * 3, `listeners ${mounted} for ${result.shape.length} entries`)
  } finally { await browser.close() }
})
