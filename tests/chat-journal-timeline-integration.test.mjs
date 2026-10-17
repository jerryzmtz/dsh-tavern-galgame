import { createBackgroundTaskCoordinator } from '../tavern-plugin/lib/domain/background-task-coordinator.js'
import { createMvuSettlementEffect, applyMvuSettlementEffect } from '../tavern-plugin/lib/domain/mvu-settlement-effect.js'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { createChatPersistence } from '../tavern-plugin/lib/domain/chat-persistence.js'
import { createChatJournalStore } from '../tavern-plugin/lib/domain/chat-journal-store.js'
import { createStoryTimeline } from '../tavern-plugin/lib/domain/story-timeline.js'

test('正文 checkpoint 使用 revision cursor，并从 journal 历史完成回退', async function (t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-tavern-journal-timeline-'))
  t.after(async function () { await rm(root, { recursive: true, force: true }) })
  let sequence = 0
  const records = createChatJournalStore({ dataRoot: root, frameLimit: 1000 })
  const persistence = createChatPersistence({ store: records, now: () => 1000 })
  const timeline = createStoryTimeline({ id(prefix) { sequence++; return prefix + '-' + sequence }, now: () => 2000 + sequence })

  let chat = {
    id: 'chat-1', mode: 'story', messages: [], posture: '门外', candidates: null,
    scriptState: null, settleStatus: 'idle', settleError: null, lastSettle: null
  }
  chat = await persistence.write(chat, { source: 'chat.create' })
  assert.equal(chat._storageRevision, 1)

  const begun = timeline.apply({ chat, intent: { kind: 'body.begin', turn: 1, userText: '开门' } })
  chat = await persistence.write(begun.chat, { source: 'foreground.prepare' })
  const completed = timeline.complete({
    chat,
    operationId: begun.value.operationId,
    basedOn: begun.value.basedOn,
    outcome: { status: 'success' },
    apply(draft) {
      draft.messages.push({ role: 'user', text: '开门' }, { role: 'assistant', text: '门开了' })
      draft.posture = '门内'
    }
  })
  chat = await persistence.write(completed.chat, { source: 'foreground.commit' })
  const settlement = timeline.apply({ chat, intent: { kind: 'agent.begin', role: 'settlement' } })
  chat = await persistence.write(settlement.chat, { source: 'background.settlement.begin' })
  const settled = timeline.complete({
    chat,
    operationId: settlement.value.operationId,
    basedOn: settlement.value.basedOn,
    outcome: { status: 'success' }
  })
  chat = await persistence.write(settled.chat, { source: 'background.settlement.commit' })

  const checkpoint = chat.timeline.checkpoints[0]
  const bodyOperation = chat.timeline.operations[begun.value.operationId]
  assert.equal(checkpoint.beforeRevision, 1)
  assert.equal(bodyOperation.beforeRevision, 1)
  assert.equal(Object.hasOwn(checkpoint, 'before'), false)
  assert.equal(Object.hasOwn(bodyOperation, 'before'), false)

  const historical = await persistence.readRevision(chat.id, checkpoint.beforeRevision)
  const rolled = timeline.apply({ chat, intent: { kind: 'turn.rollback', beforeChat: historical } })
  chat = await persistence.write(rolled.chat, { source: 'rollback' })

  assert.deepEqual(chat.messages, [])
  assert.equal(chat.posture, '门外')
  assert.equal(chat.timeline.revision, 2)
  assert.equal(chat.timeline.checkpoints.length, 0)

  const journal = await readFile(path.join(root, 'chats/chat-1/journals/000000000002-open.jsonl'), 'utf8')
  assert.match(journal, /"source":"foreground.prepare"/)
  assert.match(journal, /"source":"foreground.commit"/)
  assert.match(journal, /"source":"rollback"/)
  assert.doesNotMatch(journal, /"before":\{/)
})

test('MVU 保存点经真实 journal 重开后恢复，变量与完成回执在同一次提交持久化', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tavern-mvu-delivery-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const open = () => createChatPersistence({ store: createChatJournalStore({ dataRoot: root }) })
  let db = open()
  const timeline = createStoryTimeline()
  const tasks = () => createBackgroundTaskCoordinator({ timeline,
    store: { readChat: id => db.read(id), writeChat: (chat, meta) => db.write(chat, meta), updateChat: (id, fn, meta) => db.update(id, fn, meta) } })
  let coordinator = tasks()
  let chat = { id: 'c', sessionId: 's', mode: 'story', messages: [] }
  const body = timeline.apply({ chat, intent: { kind: 'body.begin', turn: 1 } })
  chat = timeline.complete({ chat: body.chat, operationId: body.value.operationId, basedOn: body.value.basedOn,
    outcome: { status: 'success' }, apply(draft) {
      draft.messages.push({ role: 'assistant', text: '正文', swipeId: 0, variables: [{ hp: 10 }], mvu: { pending: true } })
    } }).chat
  await db.write(chat)
  const task = await coordinator.begin(await db.read('c'), 'settlement')
  const before = await db.read('c'), after = structuredClone(before)
  after.messages[0].variables[0].hp = 9
  const effect = createMvuSettlementEffect({ operationId: task.operationId, chatId: 'c', sessionId: 's',
    branchId: task.basedOn.branchId, basedOnRevision: task.basedOn.revision,
    expectedLifecycleRevision: 0, messageId: 0, swipeId: 0, before, after })
  await task.checkpoint(draft => {
    draft.messages[0].mvu.pendingSubmission = { operations: [{ op: 'delta', path: '/hp', value: -1 }] }
    draft.messages[0].mvu.delivery = { version: 1, operationId: task.operationId, branchId: task.basedOn.branchId,
      revision: task.basedOn.revision, lifecycleRevision: 0, swipeId: 0, prepared: { effect } }
  })
  db = open(); coordinator = tasks()
  assert.equal((await db.read('c')).messages[0].variables[0].hp, 10)
  await coordinator.recover(await db.read('c'))
  const resumed = await coordinator.begin(await db.read('c'), 'settlement')
  const apply = draft => {
    applyMvuSettlementEffect(draft, draft.messages[0].mvu.delivery.prepared.effect)
    draft.messages[0].mvu = { pending: false, receipt: { status: 'updated' } }
  }
  await resumed.commit({ stateChanged: true, apply })
  db = open()
  const committed = await db.read('c')
  assert.equal(committed.messages[0].variables[0].hp, 9)
  assert.equal(committed.messages[0].mvu.receipt.status, 'updated')
  assert.equal(committed.messages[0].mvu.delivery, undefined)
  await resumed.commit({ stateChanged: true, apply })
  assert.equal((await db.read('c')).messages[0].variables[0].hp, 9)
})
