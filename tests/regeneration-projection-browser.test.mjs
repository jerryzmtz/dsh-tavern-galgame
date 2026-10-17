import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright'

test('连续三次重生成期间局部挂载，再发送新输入：不串轮、不需刷新恢复', async () => {
  const source = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    await page.setContent('<main></main>')
    const result = await page.evaluate(source => {
      window.__ModuleLoader__ = { load(d) { window.client = d.factory(() => ({})) } }
      window.eval(source)
      const root = document.querySelector('main')
      const projection = client.createTurnHistoryProjection({ root: () => root, storage: () => ({ getItem: () => '{}' }) })
      function row(turn, kind, text) {
        const node = document.createElement('div')
        node.setAttribute('data-chat-flow-kind', kind)
        node.setAttribute('data-chat-turn', String(turn))
        node.textContent = text
        root.append(node)
        return node
      }
      const first = [row(2, 'user', '第一条输入'), row(2, 'assistant-step', '第一轮正文')]
      const input = row(3, 'user', '去花店看看')
      const old = row(3, 'assistant-step', '旧正文')
      const originalTail = row(3, 'turn-tail', '')
      const suppressed = [], previousBodies = []
      const checks = []
      let latest
      for (const turn of [4, 5, 6]) {
        // Native rows mount independently. Leave only the preceding body and
        // this replacement tail while its own input/context is not mounted.
        originalTail.remove(); input.remove(); old.remove()
        root.querySelectorAll('[data-chat-flow-kind="turn-tail"]').forEach(node => node.remove())
        const tail = row(turn, 'turn-tail', '')
        suppressed.push(turn)
        projection.apply('s', suppressed, { 3: turn })
        checks.push(first.every(node => getComputedStyle(node).display !== 'none'))
        tail.remove()
        root.append(input, old, originalTail)
        row(turn, 'context', '内部重新生成指令')
        latest = row(turn, 'assistant-step', '新正文' + turn)
        root.append(tail)
        projection.apply('s', suppressed, { 3: turn })
        checks.push(previousBodies.every(node => getComputedStyle(node).display === 'none'))
        previousBodies.push(latest)
        checks.push(getComputedStyle(input).display !== 'none' && getComputedStyle(old).display === 'none' && getComputedStyle(latest).display !== 'none')
      }
      const nextInput = row(7, 'user', '敲门问好')
      const nextBody = row(7, 'assistant-step', '有人开门')
      row(7, 'turn-tail', '')
      projection.apply('s', suppressed, { 3: 6 })
      checks.push([nextInput, nextBody, latest, input, ...first].every(node => getComputedStyle(node).display !== 'none'))
      return checks
    }, source)
    assert.ok(result.every(Boolean), JSON.stringify(result))
  } finally { await browser.close() }
})
