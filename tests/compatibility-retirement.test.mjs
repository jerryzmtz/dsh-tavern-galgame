import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import test from 'node:test'

const server = await readFile(new URL('../tavern-plugin/lib/index.js', import.meta.url), 'utf8')

const chats = [{ id: 'compat', sessionId: 'compat-session', requestMode: 'sillytavern' }, { id: 'native', sessionId: 'native-session', requestMode: 'dsh' }]

test('启动恢复包含兼容与普通会话', async () => {
  const calls = []
  const context = {
    recoverRegeneration: async () => {}, str: value => String(value || ''),
    chatPersistence: { readWindow: async id => ({ chat: { ...chats.find(chat => chat.id === id), bypassPlanId: 'plan' } }) },
    readChat: async id => chats.find(chat => chat.id === id),
    presetLibrary: { restoreChat: async chat => { calls.push(chat.id); return false } },
    syncChatSummary: async () => {},
    foregroundHandoff: { recover: async ids => { context.foreground = ids } },
    candidateTasks: { recover: async ids => { context.background = ids } },
    mvuSettlementReconciler: { scan() { assert.ok(context.foreground); assert.ok(context.background); context.scanned = true } }
  }
  const start = server.indexOf('async function recoverRuntimeHistory(')
  vm.runInNewContext(server.slice(start, server.indexOf('// ---------- 重新生成正文', start)) + '; this.recover = recoverRuntimeHistory;', context)
  await context.recover({ chats })
  assert.deepEqual(calls, ['compat', 'native'])
  assert.deepEqual(Array.from(context.foreground), ['compat', 'native'])
  assert.deepEqual(Array.from(context.background), ['compat', 'native'])
  assert.equal(context.scanned, true)
})
