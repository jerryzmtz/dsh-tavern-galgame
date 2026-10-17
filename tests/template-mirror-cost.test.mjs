import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import * as host from '../tavern-plugin/lib/vendor/st-prompt-template/host-build/host.js'
import { mountTemplateMessages } from '../tavern-plugin/lib/vendor/st-prompt-template/host-build/dom.js'

test('template mirror keeps a bounded window and on-demand historical targets without truncating chat', t => {
  const dom = new JSDOM('<div id="chat"></div>')
  const previous = globalThis.document
  globalThis.document = dom.window.document
  t.after(() => { globalThis.document = previous; host.disposeTemplateHost(); dom.window.close() })
  const chat = Array.from({length: 20000}, (_, i) => ({mes: 'row ' + i, is_system: true}))
  host.configureTemplateHost({sessionId:'mirror', chat, characters:[], chat_metadata:{}, extension_settings:{}, name1:'U', name2:'C'}, {}, {yaml:{}})
  const root = document.getElementById('chat')
  const get = Object.getOwnPropertyDescriptor(dom.window.Element.prototype, 'children').get
  let reads = 0
  Object.defineProperty(root, 'children', {get() { reads++; return get.call(this) }})
  mountTemplateMessages()
  assert.ok(reads <= 2, 'do not invalidate and reread a live collection per inserted row: ' + reads)
  const first = root.firstElementChild
  assert.equal(root.childElementCount, 200)
  assert.equal(chat.length, 20000)
  assert.equal(first.getAttribute('mesid'), '19800')
  assert.equal(root.lastElementChild.textContent.trim(), 'row 19999')
  chat.push({mes:'tail',is_system:true})
  mountTemplateMessages()
  assert.equal(root.children[0].getAttribute('mesid'), '19801')
  assert.equal(root.lastElementChild.getAttribute('mesid'), '20000')
  mountTemplateMessages({renderIndices:new Set([0, 1])})
  assert.equal(root.childElementCount, 202)
  assert.equal(root.firstElementChild.textContent.trim(), 'row 0')
  assert.equal(chat.length, 20001)
  const old = root.firstElementChild
  chat[0].mes = 'edited'; chat.length = 2
  mountTemplateMessages()
  assert.equal(root.childElementCount, 2)
  assert.equal(root.firstElementChild, old)
  assert.equal(old.textContent.trim(), 'edited')
})
