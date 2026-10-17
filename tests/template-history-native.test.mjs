import assert from 'node:assert/strict'
import test from 'node:test'
import { createInitializationNative } from './fixtures/conversation-initialization-native.mjs'
import { prepareTemplateHistory, synchronizeTemplateHistory } from '../tavern-plugin/lib/domain/template-history.js'

test('模板永久改写用户和回复，恢复磁盘后真实 Agent 不再收到旧正文', { skip: !process.env.DSH_BOOT_MODULE }, async t => {
  const h = await createInitializationNative(process.env.DSH_BOOT_MODULE)
  t.after(() => h.dispose())
  await h.importHistory({ ...h.input, operationId: 'template-edit-native', text: [{chat_metadata:{}},{is_user:false,mes:'开场'},{is_user:true,mes:'旧行动'},{is_user:false,mes:'旧回复'}].map(JSON.stringify).join('\n') })
  const before = await h.open().ensureOpening(h.input.sessionId)
  const after = structuredClone(before)
  after.messages.find(message => message.role === 'user').text = '新行动'
  after.messages.at(-1).text = '新回复'
  prepareTemplateHistory(h.target.session, before, after)
  assert.equal(after.messages.filter(message => message.templateHistoryEdit).length, 2)
  await h.persistence.write(after)
  await synchronizeTemplateHistory(h.target.session, after, () => h.checkpoint())
  const count = h.target.session.surface.nodes.length
  await synchronizeTemplateHistory(h.target.session, after, () => h.checkpoint())
  assert.equal(h.target.session.surface.nodes.length, count)
  await h.restoreDetached()
  await h.continueWithAgent()
  const texts = h.requests[0].messages.flatMap(message => message.content.filter(block => block.type === 'text').map(block => block.text))
  assert(texts.includes('新行动')); assert(texts.includes('新回复'))
  assert(!texts.some(text => text.includes('旧行动') || text.includes('旧回复')))
})

import { Session } from './fixtures/dsh-session-host.mjs'
import { createScopedMessages } from '../tavern-plugin/lib/domain/scoped-messages.js'

test('局部历史按最近楼层对齐原生消息面，与完整历史标记同一条输入', async () => {
  const build = () => {
    const session = Session.create('template-window')
    const messages = []
    for (let turn = 1; turn <= 6; turn++) {
      session.append('user/message', { id: 'u' + turn, role: 'user', content: [{ type: 'text', text: '继续' }] }, { surfaceOp: 'append' })
      session.append('assistant/message', { turn, message: { id: 'a' + turn, role: 'assistant', content: [{ type: 'text', text: '回复' + turn }] } }, { surfaceOp: 'append' })
      messages.push({ role: 'user', text: turn === 6 ? '继续（模板渲染）' : '继续', ...(turn === 6 ? { templateInputSource: '继续' } : {}) },
        { role: 'assistant', text: '回复' + turn, turn })
    }
    return { session, messages }
  }
  const full = build(), windowed = build()
  await synchronizeTemplateHistory(full.session, { messages: full.messages }, async () => {})
  const from = 8
  const scoped = createScopedMessages(windowed.messages.length, windowed.messages.slice(from).map((row, index) => [from + index, row]))
  await synchronizeTemplateHistory(windowed.session, { messages: scoped }, async () => {})
  const edit = full.messages[10].templateHistoryEdit
  assert.ok(edit)
  assert.equal(scoped[10].templateHistoryEdit.seq, edit.seq)
  assert.equal(full.messages.filter(row => row.templateHistoryEdit).length, 1)
  const texts = session => session.deriveMessages().flatMap(message => message.content.filter(block => block.type === 'text').map(block => block.text))
  assert.deepEqual(texts(windowed.session), texts(full.session))
  assert.ok(texts(full.session).includes('继续（模板渲染）'))
})

test('压缩检查点不会被模板同步改写成玩家原文；已被改写的恢复为摘要（#202）', async () => {
  const session = Session.create('template-compact')
  const seqs = []
  for (let turn = 1; turn <= 3; turn++) {
    seqs.push(session.append('user/message', { id: 'u' + turn, role: 'user', content: [{ type: 'text', text: '行动' + turn }] }, { surfaceOp: 'append' }))
    seqs.push(session.append('assistant/message', { turn, message: { id: 'a' + turn, role: 'assistant', content: [{ type: 'text', text: '回复' + turn }] } }, { surfaceOp: 'append' }))
  }
  const seqOf = value => typeof value === 'number' ? value : value.seq
  const checkpoint = { id: 'compact-1', role: 'user', content: [{ type: 'text', text: '【摘要】前两轮' }], source: { kind: 'plugin', plugin: 'compact', compactionId: 'c1' } }
  session.append('user/message', checkpoint, { surfaceOp: { op: 'replace', startSeq: seqOf(seqs[0]), endSeq: seqOf(seqs[3]) }, sourceEventSeqs: seqs.slice(0, 4).map(seqOf) })
  // The chat row rendered from full history still says the player text, while its template source matches the summary.
  const messages = [
    { role: 'user', text: '行动1', templateInputSource: '【摘要】前两轮' }, { role: 'assistant', text: '回复1', turn: 1 },
    { role: 'user', text: '行动2' }, { role: 'assistant', text: '回复2', turn: 2 },
    { role: 'user', text: '行动3' }, { role: 'assistant', text: '回复3', turn: 3 }
  ]
  const texts = () => session.deriveMessages().flatMap(message => message.content.filter(block => block.type === 'text').map(block => block.text))
  await synchronizeTemplateHistory(session, { messages }, async () => {})
  assert.ok(texts().includes('【摘要】前两轮'))
  assert.ok(!texts().includes('行动1'))

  // A session already damaged by the old sync: two chained overwrites of the checkpoint.
  let at = session.surface.nodes[0]
  for (const n of [1, 2]) {
    const event = session.append('user/message', { ...checkpoint, id: 'tavern-template-edit:' + n, content: [{ type: 'text', text: '行动1' }] },
      { surfaceOp: { op: 'replace', startSeq: at, endSeq: at }, sourceEventSeqs: [at] })
    at = seqOf(event)
  }
  assert.ok(texts().includes('行动1'))
  await synchronizeTemplateHistory(session, { messages }, async () => {})
  assert.ok(texts().includes('【摘要】前两轮'))
  assert.ok(!texts().includes('行动1'))
})
