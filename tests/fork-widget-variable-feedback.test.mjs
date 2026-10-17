// private fork: selected-head edits supplement the existing bounded variable feedback.
import test from 'node:test'
import assert from 'node:assert/strict'
import { lastRoundVariableChanges } from '../tavern-plugin/lib/domain/foreground-variable-changes.js'
import { appendVariableChanges } from '../tavern-plugin/lib/hooks/request.js'
const message = stat_data => ({ role: 'assistant', swipeId: 0, variables: [{ stat_data }] })
const chat = messages => ({ mode: 'story', mvu: { enabled: true }, messages })
const edit = paths => ({ editedAfterSettlement: true, feedbackPaths: paths, records: [] })

test('pure deletion is fed back without inventing a remaining value', () => {
  const text = lastRoundVariableChanges(chat([message({ bag: { item: 1 }, other: 2 }), message({ bag: {}, other: 2 })]))
  assert.match(text, /\/bag\/item = （已删除）/)
  assert.doesNotMatch(text, /\/other/)
})

test('single opening snapshot includes user edit paths, deletion and final values', () => {
  const head = { ...message({ balance: 15, bag: {} }), variableEdits: [edit(['/balance', '/bag/item'])] }
  const text = lastRoundVariableChanges(chat([head]))
  assert.match(text, /用户组件操作后当前值.*\/balance = 15/)
  assert.match(text, /\/bag\/item = （已删除）/)
  assert.equal(lastRoundVariableChanges(chat([message({ balance: 15 })])), null)
})

test('head and swipe isolate feedback; repeated touches and restored values are deduplicated', () => {
  const head = { ...message({ balance: 20, bag: { item: 1 } }), variableEdits: [edit(['/balance', '/balance', '/bag/item', '/bag'])] }
  const text = lastRoundVariableChanges(chat([message({ balance: 20, bag: {} }), head]))
  assert.equal(text.split('/balance').length - 1, 1)
  assert.equal(text.split('/bag').length - 1, 1)
  assert.match(text, /用户组件操作后当前值.*\/balance = 20/)
  head.variables.push({ stat_data: { balance: 20, bag: {} } }); head.swipeId = 1
  assert.equal(lastRoundVariableChanges(chat([message({ balance: 20, bag: {} }), head])), null)
  const next = message({ balance: 20, bag: { item: 1 } })
  head.swipeId = 0
  assert.equal(lastRoundVariableChanges(chat([head, next])), null)
})

test('same first-step hook, retry and disabled feedback keep existing semantics', () => {
  const head = { ...message({ balance: 15 }), variableEdits: [edit(['/balance'])] }
  const current = chat([head]), decision = { kind: 'enter', messages: [] }, payload = { step: 1 }
  const first = appendVariableChanges({ chat: current, decision, payload })
  assert.equal(first.messages.length, 1)
  assert.equal(appendVariableChanges({ chat: current, decision: first, payload }).messages.length, 1)
  const retry = appendVariableChanges({ chat: current, decision, payload })
  assert.equal(retry.messages.length, 1)
  assert.deepEqual(retry.messages[0].content, first.messages[0].content)
  assert.equal(appendVariableChanges({ chat: { ...current, backgroundTasks: { variableFeedback: false } }, decision, payload }).messages.length, 0)
  assert.deepEqual(head.variableEdits[0].feedbackPaths, ['/balance'])
})

test('feedback budgets remain bounded and malformed/internal stored paths are not interpolated', () => {
  const data = Object.fromEntries(Array.from({ length: 64 }, (_, i) => ['field' + i, 'x'.repeat(200)]))
  const head = { ...message(data), variableEdits: [edit(Object.keys(data).map(key => '/' + key))] }
  const text = lastRoundVariableChanges(chat([head]))
  assert.ok(text.length < 6400)
  assert.match(text, /tavern_read_variables/)
  head.variableEdits = [edit(['/__private', '/constructor', '/a~2b'])]
  assert.equal(lastRoundVariableChanges(chat([head])), null)
  assert.doesNotThrow(() => lastRoundVariableChanges(chat([message({ '*': 1, '': 1 }), message({ '*': 2, '': 2 })])))
})
