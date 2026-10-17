import assert from 'node:assert/strict'
import test from 'node:test'

import { waitForWritableSession } from '../tavern-plugin/lib/domain/agent-readiness.js'

test('默认等待窗口允许 Agent 在两秒后完成注册', async () => {
  let elapsedMs = 0
  const readyAgent = { session: { id: 'session-slow' } }

  const target = await waitForWritableSession({
    registry: { get() { return elapsedMs >= 2100 ? readyAgent : undefined } },
    sessionId: 'session-slow',
    sleep: async function (ms) { elapsedMs += ms }
  })

  assert.equal(target.agent, readyAgent)
  assert.equal(target.session, readyAgent.session)
  assert.equal(elapsedMs, 2100)
})
