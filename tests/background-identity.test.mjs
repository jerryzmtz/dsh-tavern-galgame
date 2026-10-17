import test from 'node:test'
import assert from 'node:assert/strict'
import { referencedBackgroundSessionIds } from '../tavern-plugin/lib/domain/background-identity.js'

test('只从后台账本采集历史，不把运行中的新会话或生图任务归为历史', () => {
  const chat = { timeline: { checkpoints: [{ participants: { background: { sessionId: 'checkpoint' } } }], operations: {
    done: { kind: 'agent', role: 'candidate', status: 'completed', startedSessionId: 'done' },
    live: { kind: 'agent', role: 'settlement', status: 'running', startedSessionId: 'live' },
    image: { kind: 'agent', role: 'image', status: 'completed', startedSessionId: 'image' }
  } } }
  assert.deepEqual(referencedBackgroundSessionIds(chat), ['checkpoint', 'done'])
})
