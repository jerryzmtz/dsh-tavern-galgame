import test from 'node:test'
import assert from 'node:assert/strict'
import { Session } from './fixtures/dsh-session-host.mjs'
import { sessionEvents } from '../tavern-plugin/lib/domain/session-events.js'
import { appendHelperUserSessionContext } from '../tavern-plugin/lib/domain/helper-user-session-context.js'

test('custom opening text reaches the append-only native surface once, without starting a turn', () => {
  const session = Session.create('helper-opening')
  session.append('user/message', { id: 'prior', role: 'user', content: [{ type: 'text', text: 'prior' }], source: { kind: 'plugin', plugin: 'test' } }, { surfaceOp: 'append' })
  const chat = { id: 'chat', messages: [
    { role: 'assistant', text: 'opening' },
    { role: 'tavern-helper', tavernRole: 'user', sourceText: '姓名：测试。起始地点：城镇旅馆。' },
    { role: 'tavern-helper', tavernRole: 'user', text: 'hidden', tavernHidden: true },
    { role: 'tavern-helper', tavernRole: 'assistant', text: 'script display' }
  ] }
  const targets = [0, 1, 2, 3].map(messageId => ({ messageId }))
  assert.equal(appendHelperUserSessionContext(session, chat, targets), 1)
  const events = sessionEvents(session)
  assert.equal(session.deriveMessages().at(-1).content[0].text, chat.messages[1].sourceText)
  assert.equal(events[1].data.content[0].text, chat.messages[1].sourceText)
  assert.equal(events[1].surfaceOp, 'append')
  assert.equal(events[1].data.source.kind, 'plugin')
  assert.equal(appendHelperUserSessionContext(session, chat, targets), 0)
  assert.equal(sessionEvents(session).length, 2)
  assert.equal(events[0].data.id, 'prior')
})
