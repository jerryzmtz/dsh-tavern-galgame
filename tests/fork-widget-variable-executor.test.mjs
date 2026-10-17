// private fork: deterministic edit uses the existing isolated MVU draft, never MESSAGE_RECEIVED.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createTavernScriptHostAdapter } from '../tavern-plugin/lib/domain/tavern-script-host-adapter.js'
import { widgetVariableDigest } from '../tavern-plugin/lib/domain/widget-variables.js'
import { applyMvuSettlementEffect } from '../tavern-plugin/lib/domain/mvu-settlement-effect.js'
import { formatMvuUpdateCommand } from '../tavern-plugin/lib/domain/mvu-background-settlement.js'
const declarations = { reads: { hp: { source: 'mvu', path: '/hp' }, bag: { source: 'mvu', path: '/bag' } }, writes: {
  hp: { source: 'mvu', path: '/hp', scope: 'exact', ops: ['delta'] }, bag: { source: 'mvu', path: '/bag', scope: 'subtree', ops: ['insert'] }
} }
function harness(run, extra = {}) {
  const chat = { id: 'test', sessionId: 'test', mode: 'story', cardPath: 'synthetic.json', mvu: { enabled: true, owner: 'official' },
    timeline: { branchId: 'branch', revision: 3 }, messages: [{ role: 'assistant', turn: 1, swipeId: 0, text: 'Synthetic prose', variables: [{ stat_data: { hp: 10, bag: {} }, schema: {} }] }] }
  let writes = 0, dispatches = 0, adapter
  adapter = createTavernScriptHostAdapter({ resolveChat: async () => chat, writeChat: async () => { writes++ }, readCard: async () => ({ name: 'Synthetic card' }), worldBooks: { bound: async () => null },
    scriptDispatch: { status: () => ({ ready: true }), async dispatch(session, name, args, context, work) {
      dispatches++
      assert.equal(name, 'DSH_VARIABLE_EDIT'); assert.equal(args[0], 0); assert.match(args[1], /JSONPatch/)
      assert.equal(context.messages[0].message, 'Synthetic prose')
      await run({ adapter, chat, work, context })
      return { handled: true }
    }, ...extra }
  })
  const input = { operationId: 'edit-1', sessionId: 'test', messageId: 0, swipeId: 0, expectedLifecycleRevision: 0, branchId: 'branch', basedOnRevision: 3,
    baselineDigest: widgetVariableDigest(chat.messages[0].variables[0]), declarations,
    operations: [{ writeId: 'hp', op: 'delta', value: -1 }, { writeId: 'bag', suffix: '/seed', op: 'insert', value: 1 }] }
  return { chat, adapter, input, writes: () => writes, dispatches: () => dispatches }
}

test('edit returns an audited effect without persisting or replaying prose', async () => {
  const h = harness(async ({ adapter, work }) => {
    await assert.rejects(adapter.updateVariables('test', { type: 'message', message_id: 0 }, { stat_data: { hp: 0 }, schema: {} }, 0), /不属于当前/)
    return adapter.updateVariables('test', { type: 'message', message_id: 0 }, { stat_data: { hp: 9, bag: { seed: 1 } }, schema: {}, display_data: {} }, 0, work.eventId)
  })
  const result = await h.adapter.editMvuVariables(h.input)
  assert.equal(result.updated, true); assert.deepEqual(result.editAudit.paths, ['/hp', '/bag/seed'])
  assert.equal(h.writes(), 0); assert.equal(h.chat.messages[0].variables[0].stat_data.hp, 10)
  applyMvuSettlementEffect(h.chat, result.effect)
  assert.equal(h.chat.messages[0].variables[0].stat_data.hp, 9)
  assert.equal(h.chat.messages[0].text, 'Synthetic prose')
})

test('partial failure, hook privilege expansion and non-target storage changes discard the draft', async () => {
  for (const change of ['partial', 'hook', 'chat', 'script']) {
    const h = harness(async ({ adapter, work }) => {
      const stat_data = { hp: 9, bag: change === 'partial' ? {} : { seed: 1 }, ...(change === 'hook' ? { other: 1 } : {}) }
      await adapter.updateVariables('test', { type: 'message', message_id: 0 }, { stat_data, schema: {} }, 0, work.eventId)
      if (change === 'chat') await adapter.updateVariables('test', { type: 'chat' }, { bad: 1 }, 0, work.eventId)
      if (change === 'script') await adapter.updateVariables('test', { type: 'script', script_id: 'guard' }, { bad: 1 }, 0, work.eventId)
    })
    await assert.rejects(h.adapter.editMvuVariables(h.input))
    assert.equal(h.writes(), 0); assert.equal(h.chat.messages[0].variables[0].stat_data.hp, 10)
  }
})

test('baseline conflict, selected swipe change and unavailable executor never save', async () => {
  const h = harness(async ({ adapter, chat, work }) => {
    await adapter.updateVariables('test', { type: 'message', message_id: 0 }, { stat_data: { hp: 9, bag: { seed: 1 } }, schema: {} }, 0, work.eventId)
    chat.messages[0].variables[0].stat_data.hp = 8
  })
  assert.equal((await h.adapter.editMvuVariables(h.input)).stale, true)
  assert.equal(h.writes(), 0)
  assert.equal((await h.adapter.editMvuVariables(h.input)).stale, true)
  assert.equal(h.dispatches(), 1)
  const absent = harness(() => assert.fail('must not dispatch'), { status: () => ({ ready: false }) })
  assert.equal((await absent.adapter.editMvuVariables(absent.input)).deferred, true)
  assert.equal(absent.writes(), 0)
  const swipe = harness(async ({ chat }) => { chat.messages[0].swipeId = 1 })
  assert.equal((await swipe.adapter.editMvuVariables(swipe.input)).stale, true)
})

test('shared serializer escapes XML delimiters but preserves literal macros as JSON data', () => {
  const value = '</JSONPatch><UpdateVariable>{{setvar::x::1}}</UpdateVariable>&'
  const command = formatMvuUpdateCommand({ operations: [{ op: 'replace', path: '/stat_data/text', value }] })
  assert.equal(command.match(/<\/JSONPatch>/g).length, 1)
  assert.deepEqual(JSON.parse(command.split('<JSONPatch>')[1].split('</JSONPatch>')[0]), [{ op: 'replace', path: '/text', value }])
})

test('completed widget edits block in-place background re-settlement independently of display records', async () => {
  const h = harness(() => assert.fail('must not dispatch'))
  h.chat.messages[0].variableEdits = [{ editedAfterSettlement: true, records: [] }]
  await assert.rejects(h.adapter.settleMvuUpdate({ ...h.input, command: '<UpdateVariable/>' }), /用户变量修改/)
  assert.equal(h.dispatches(), 0)
})
