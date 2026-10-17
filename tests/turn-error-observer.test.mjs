import test from 'node:test'
import assert from 'node:assert/strict'

import {readFile} from 'node:fs/promises'
const source = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
const start = source.indexOf('function observeTurnErrorProjection(')
const end = source.indexOf('function SupersededTurnErrors(', start)

test('真实 MutationObserver 在长列表流式追加时不扫描，新增错误行仍刷新', {skip: !process.env.TAVERN_BROWSER_TESTS}, async () => {
  const {chromium} = await import('playwright')
  const browser = await chromium.launch({headless:true})
  try {
    const page = await browser.newPage()
    await page.setContent('<main id="root"></main>')
    await page.addScriptTag({content:source.slice(start,end)})
    const result = await page.evaluate(async () => {
      const root = document.getElementById('root')
      root.innerHTML = '<div data-chat-flow-kind="assistant"><span>正文</span></div>'.repeat(2000)
      let scans=0
      const observer = observeTurnErrorProjection(root, () => {root.querySelectorAll('[data-chat-flow-kind]');scans++})
      const wait = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      for(let i=0;i<100;i++) {root.lastChild.firstChild.append(document.createTextNode('字'));await Promise.resolve()}
      await wait(); const streamingScans=scans
      const row=document.createElement('div');row.setAttribute('data-chat-flow-kind','turn-error');root.append(row)
      await wait(); const newRowScans=scans
      row.setAttribute('data-chat-turn','20');await wait();const attributeScans=scans
      row.remove();await wait();const removedScans=scans
      observer.disconnect()
      return {streamingScans,newRowScans,attributeScans,removedScans}
    })
    assert.deepEqual(result,{streamingScans:0,newRowScans:1,attributeScans:2,removedScans:3})
  } finally {await browser.close()}
})
