import assert from 'node:assert/strict'
import test from 'node:test'

import { createChatPersistence } from '../tavern-plugin/lib/domain/chat-persistence.js'
import { assertRegenerationSourceCurrent } from '../tavern-plugin/lib/domain/last-round-replacement.js'

test('重新生成允许状态栏捕获并发更新，但拒绝正文真的变化', function () {
  const originalChat = {
    id: 'chat-1', timeline: { branchId: 'branch-1', revision: 4 }, messages: [
      { role: 'user', text: '继续' },
      { role: 'assistant', turn: 4, text: '旧正文', sourceText: '旧正文', displayRuntime: { dom: '<p>旧状态栏</p>' } }
    ]
  }
  const displayCaptured = structuredClone(originalChat)
  displayCaptured.messages[1].displayRuntime = { dom: '<p>新状态栏</p>' }
  assert.doesNotThrow(function () {
    assertRegenerationSourceCurrent({ originalChat, currentChat: displayCaptured, assistantIndex: 1 })
  })

  const bodyChanged = structuredClone(displayCaptured)
  bodyChanged.messages[1].text = '另一项操作写入的正文'
  assert.throws(function () {
    assertRegenerationSourceCurrent({ originalChat, currentChat: bodyChanged, assistantIndex: 1 })
  }, function (error) {
    return error && error.code === 'DSH_TAVERN_REGEN_CONFLICT'
  })
})

test('状态栏捕获夹在重生成读写之间时，锁内提交不再产生 messages 假冲突', async function () {
  let stored = {
    id: 'chat-1', timeline: { branchId: 'branch-1', revision: 4 }, _storageRevision: 1, messages: [
      { role: 'user', text: '继续' },
      { role: 'assistant', turn: 4, text: '旧正文', sourceText: '旧正文', displayRuntime: { dom: '<p>旧状态栏</p>' } }
    ]
  }
  const store = {
    async read() { return structuredClone(stored) },
    async update(_chatId, updater) {
      const next = await updater(structuredClone(stored))
      if (next !== undefined) stored = structuredClone(next)
      return structuredClone(stored)
    },
    async remove() {}
  }
  const persistence = createChatPersistence({ store, now: function () { return 1000 } })
  const originalChat = await persistence.read('chat-1')
  await persistence.update('chat-1', function (current) {
    current.messages[1].displayRuntime = { dom: '<p>新状态栏</p>' }
    return current
  }, { source: 'display.capture' })

  await persistence.update('chat-1', function (current) {
    assertRegenerationSourceCurrent({ originalChat, currentChat: current, assistantIndex: 1 })
    current.messages = []
    current.regenInProgress = true
    return current
  }, { source: 'rollback.regen' })

  assert.deepEqual(stored.messages, [])
  assert.equal(stored.regenInProgress, true)
})
