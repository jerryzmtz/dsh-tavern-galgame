import assert from 'node:assert/strict'
import test from 'node:test'

import { lastSubmittedPosture } from '../tavern-plugin/lib/domain/posture-submission.js'
import { Session } from './fixtures/dsh-session-host.mjs'

test('后台历史中最近一次可见的姿势提交作为已知姿势', () => {
  const session = Session.create('posture-known')
  assert.equal(lastSubmittedPosture(session), '')
  assert.equal(lastSubmittedPosture(undefined), '')
  const submit = (posture, args = { posture }) => session.append('assistant/message', { turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'tool-call', id: posture, name: 'posture_submit', arguments: args }] } }, { surfaceOp: 'append' })
  submit('她站在门边。')
  submit('她坐回椅子上。', JSON.stringify({ posture: ' 她坐回椅子上。 ' }))
  assert.equal(lastSubmittedPosture(session), '她坐回椅子上。')
  // A summary that replaces the calls hides them from the visible history.
  const nodes = session.surface.nodes
  session.append('user/message', { id: 'summary', role: 'user', content: [{ type: 'text', text: '摘要' }], source: { kind: 'plugin', plugin: 'compact' } }, {
    sourceEventSeqs: [...nodes], surfaceOp: { op: 'replace', startSeq: nodes[0], endSeq: nodes.at(-1) }
  })
  assert.equal(lastSubmittedPosture(session), '')
})
