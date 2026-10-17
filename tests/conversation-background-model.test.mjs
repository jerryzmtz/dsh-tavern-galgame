import { patchConversationBackground } from '../tavern-plugin/lib/domain/conversation-background.js'
import { normalizeBackgroundTasks } from '../tavern-plugin/lib/domain/tavern-settings.js'
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { configuredChatBackgroundModel, normalizeBackgroundModel, readBackgroundModelReasoning } from '../tavern-plugin/lib/domain/background-model-selection.js'

const source = await readFile(new URL('../tavern-plugin/lib/index.js', import.meta.url), 'utf8')
const cases = source.slice(source.indexOf("      case 'getConversationBackgroundModel':"), source.indexOf("      case 'getBackgroundModelReasoning':"))

test('本局模型保存保留并发更新的剧情，只修改所选游戏，允许恢复跟随前台', async () => {
  const chats = new Map([['one', { id: 'one', mode: 'story', messages: ['old'] }], ['two', { id: 'two', mode: 'story' }]])
  const invoke = new Function('chatForSession', 'str', 'groupOfMode', 'normalizeBackgroundModel', 'readBackgroundModelReasoning', 'llm', 'tavernModelCatalog', 'updateChat', 'tavernSettingsDocument', 'configuredChatBackgroundModel', 'patchConversationBackground', 'normalizeBackgroundTasks',
    'return async (method, args) => { switch(method) {' + cases + '} }')(
    async id => structuredClone(chats.get(id)), String, mode => mode === 'story' ? 'play' : 'card',
    normalizeBackgroundModel, readBackgroundModelReasoning,
    { resolveModelInfo: async () => ({ reasoning: { efforts: [{ id: 'high' }] } }) },
    async () => [{ provider: 'test', models: [{ id: 'new' }] }],
    async (id, mutation) => {
      const current = { ...chats.get(id), messages: ['old', 'concurrent update'] }
      const saved = mutation(current); chats.set(id, saved); return saved
    }, { backgroundModelRevision: 3 }, configuredChatBackgroundModel, patchConversationBackground, normalizeBackgroundTasks)
  const call = backgroundModel => invoke('setConversationBackgroundModel', { sessionId: 'one', backgroundModel })
  await call({ provider: 'test', model: 'new', reasoningEffort: 'high' })
  assert.deepEqual(chats.get('one').backgroundModelSelection, { provider: 'test', model: 'new', reasoningEffort: 'high' })
  assert.deepEqual(chats.get('one').messages, ['old', 'concurrent update'])
  assert.equal(chats.get('two').backgroundModelSelection, undefined)
  assert.equal(chats.get('one').backgroundConfigVersion, 1)
  await assert.rejects(call({ provider: 'test', model: 'new', reasoningEffort: 'invalid' }), /推理强度不可用/)
  assert.equal(chats.get('one').backgroundModelSelection.reasoningEffort, 'high')
  await call(null)
  assert.equal(chats.get('one').backgroundModelSelection, null)
  await assert.rejects(call({}), /配置无效/)
  await assert.rejects(invoke('setConversationBackgroundModel', { sessionId: 'missing', backgroundModel: null }), /游玩会话/)
})
