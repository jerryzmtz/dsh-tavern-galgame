import assert from 'node:assert/strict'
import test from 'node:test'

import { isCompatibilityConversationRequest } from '../tavern-plugin/lib/domain/compatibility-request.js'

test('兼容模式只替换正文请求，不接管会话标题等 DSH 辅助调用', () => {
  const staged = { turn: 2, step: 1 }
  const coordinates = { turn: 2, step: 1 }

  assert.equal(isCompatibilityConversationRequest({ sessionId: 'session-1' }, staged, coordinates), true)
  assert.equal(isCompatibilityConversationRequest({ sessionId: 'session-1', purpose: 'session-title' }, staged, coordinates), false)
  assert.equal(isCompatibilityConversationRequest({ sessionId: 'session-1', purpose: 'compaction' }, staged, coordinates), false)
  assert.equal(isCompatibilityConversationRequest({ sessionId: 'session-1' }, staged, { turn: 3, step: 1 }), false)
})
