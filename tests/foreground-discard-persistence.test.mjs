import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createChatPersistence } from '../tavern-plugin/lib/domain/chat-persistence.js'
import { createChatJournalStore } from '../tavern-plugin/lib/domain/chat-journal-store.js'
import { createTurnOrchestrator } from '../tavern-plugin/lib/domain/turn-orchestration.js'
import { createStoryTimeline } from '../tavern-plugin/lib/domain/story-timeline.js'
import { createForegroundFrameBuilder } from '../tavern-plugin/lib/domain/agent-input-frame.js'

for (const completed of [false, true]) test('失败清理在最新 journal 状态上执行，保留并发正文完成：' + completed, async t => {
  const root = await mkdtemp(join(tmpdir(), 'tavern-discard-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const persistence = createChatPersistence({ store: createChatJournalStore({ dataRoot: root }) })
  const timeline = createStoryTimeline()
  const begun = timeline.apply({ chat: { id: 'chat', mode: 'story', messages: [] }, intent: { kind: 'body.begin', turn: 1, userText: '走' } })
  await persistence.write(begun.chat)
  let race = true
  const turns = createTurnOrchestrator({ timeline, frameBuilder: createForegroundFrameBuilder(), store: {
    async chatForSession() {
      const stale = await persistence.read('chat')
      if (race) {
        race = false
        await persistence.update('chat', current => {
          current.hiddenDshErrorTurns = [8]
          return completed ? timeline.complete({ chat: current, operationId: begun.value.operationId, basedOn: begun.value.basedOn,
            outcome: { status: 'success' }, apply(draft) { draft.messages.push({ role: 'assistant', text: '已完成' }) } }).chat : current
        })
      }
      return stale
    },
    writeChat: persistence.write, updateChat: persistence.update
  } })
  assert.equal(await turns.discard({ sessionId: 's', turn: 1 }), !completed)
  assert.equal(await turns.discard({ sessionId: 's', turn: 1 }), false)
  const saved = await persistence.read('chat')
  assert.equal(saved.timeline.operations[begun.value.operationId].status, completed ? 'completed' : 'failed')
  assert.deepEqual(saved.hiddenDshErrorTurns, [8])
  assert.deepEqual(saved.messages, completed ? [{ role: 'assistant', text: '已完成' }] : [])
})
