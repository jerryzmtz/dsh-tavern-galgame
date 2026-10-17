import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { JSDOM } from 'jsdom'
const css = await readFile(new URL('../tavern-plugin/lib/client-assets/tavern.css', import.meta.url), 'utf8')
test('隐藏注入和思考时保留正文、工具、错误，关闭后恢复原有折叠状态', () => {
  const dom = new JSDOM(`<style>${css.slice(css.indexOf('/* Presentation only:'))}</style><body>
    <div id="context" data-chat-flow-kind="context">注入内容</div>
    <div id="folded" data-chat-flow-kind="context" hidden>已折叠注入</div>
    <div id="thinking" data-chat-flow-kind="turn-process"><button data-turn-process-tool-calls="0" data-turn-process-subagents="0">已思考</button></div>
    <div id="tools" data-chat-flow-kind="turn-process"><button data-turn-process-tool-calls="1" data-turn-process-subagents="0">工具执行</button></div>
    <div id="answer" data-chat-flow-kind="assistant-step"><details id="reasoning" class="dsh-tavern-assistant-reasoning">思考内容</details><p>正文</p></div>
    <div id="error" data-chat-flow-kind="turn-error">错误</div></body>`)
  const {document} = dom.window, before = document.body.innerHTML
  const display = id => dom.window.getComputedStyle(document.getElementById(id)).display
  document.documentElement.classList.add('dsh-tavern-hide-process')
  for (const id of ['context', 'thinking', 'reasoning']) assert.equal(display(id), 'none')
  for (const id of ['answer', 'tools', 'error']) assert.notEqual(display(id), 'none')
  document.documentElement.classList.remove('dsh-tavern-hide-process')
  for (const id of ['context', 'thinking', 'reasoning']) assert.notEqual(display(id), 'none')
  assert.equal(display('folded'), 'none')
  assert.equal(document.body.innerHTML, before)
  dom.window.close()
})
