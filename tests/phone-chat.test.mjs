import assert from 'node:assert/strict'
import test from 'node:test'

import { createPhoneChat, projectPhoneChat } from '../tavern-plugin/lib/domain/phone-chat.js'

function fixture() {
  let chat = {
    id: 'chat-1', sessionId: 'session-1', cardPath: 'cards/a.json', cardName: '林岚', posture: '林岚正在书房看雨。',
    messages: [{ role: 'assistant', turn: 1, text: '林岚来到书房。' }],
    characterDesignDocument: { characters: [
      { name: '林岚', design: { personality: '克制安静' } },
      { name: '周宁', design: { identity: '朋友', speechStyle: '说话爽快' } }
    ] }
  }
  const card = { name: '林岚', description: '住在旧宅的青年。', personality: '寡言。' }
  const writes = []
  let serial = 0
  const store = {
    async chatForSession() { return structuredClone(chat) },
    async readCard() { return structuredClone(card) },
    async updateChat(_chatId, mutate, metadata) {
      chat = mutate(structuredClone(chat))
      writes.push(metadata)
      return structuredClone(chat)
    }
  }
  return { store, card, chat: function () { return structuredClone(chat) }, writes, id: function () { serial++; return 'id-' + serial } }
}

test('回复失败保留用户消息和可读错误，同一请求不会重复调用模型', async () => {
  const run = fixture()
  let calls = 0
  const service = createPhoneChat({
    store: run.store,
    selection: function () { return { provider: 'test', model: 'roleplay' } },
    runAgent: async function () { calls++; throw new Error('模型暂时不可用') },
    now: function () { return 200 },
    id: run.id
  })
  const input = { sessionId: 'session-1', contactId: encodeURIComponent('林岚'), requestId: 'same-request', text: '在吗？' }
  await assert.rejects(service.send(input), /模型暂时不可用/)
  await service.send(input)

  assert.equal(calls, 1)
  const message = projectPhoneChat(run.chat(), run.card).threads[0].messages[0]
  assert.equal(message.status, 'failed')
  assert.equal(message.error, '模型暂时不可用')
})
