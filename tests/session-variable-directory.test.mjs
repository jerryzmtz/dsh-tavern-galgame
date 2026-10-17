import test from 'node:test'
import assert from 'node:assert/strict'
import { sessionEvents } from '../tavern-plugin/lib/domain/session-events.js'
import { Session } from './fixtures/dsh-session-host.mjs'
import { ensureSessionVariableDirectory } from '../tavern-plugin/lib/domain/session-variable-directory.js'
import { ensureSessionStablePrefix, sessionStablePrefixSections, withCurrentWorldbook } from '../tavern-plugin/lib/domain/session-stable-prefix.js'

test('directory waits for initialization, joins fixed context once and survives subsequent values and worldbook projections', async () => {
  const session = Session.create('directory')
  await ensureSessionStablePrefix(session, '【常驻世界书】\n背景')
  const chat = { mode: 'story', messages: [] }
  assert.equal(ensureSessionVariableDirectory(session, chat), null)
  chat.messages.push({ swipeId: 1, variables: [{ stat_data: { wrong: 1 } }, { stat_data: { player: { hp: 9 }, inventory: ['secret'], $internal: true, 'a/b': false } }] })
  assert.ok(ensureSessionVariableDirectory(session, chat))
  const sections = sessionStablePrefixSections(session)
  const text = sections.find(section => section.name === 'tavern:variable-directory').text
  assert.match(text, /\/player\/hp/)
  assert.match(text, /\/a~1b/)
  assert.doesNotMatch(text, /secret|wrong|internal|"value"/)
  chat.messages[0].variables[1].stat_data = { changed: 12 }
  assert.equal(ensureSessionVariableDirectory(session, chat), null)
  assert.deepEqual(sessionStablePrefixSections(session), sections)
  const reopened = Session.create(session.id, sessionEvents(session), session.header)
  assert.equal(ensureSessionVariableDirectory(reopened, chat), null)
  assert.deepEqual(sessionStablePrefixSections(reopened), sections)
  assert.ok(withCurrentWorldbook(sections, '新世界书').some(section => section.text === text))
})
