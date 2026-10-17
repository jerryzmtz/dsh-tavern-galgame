import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createChatJournalStore } from '../tavern-plugin/lib/domain/chat-journal-store.js'
import { createChatPersistence } from '../tavern-plugin/lib/domain/chat-persistence.js'

// Tail splices keep the cached indexed history; the cached and reopened Chat must agree.
test('tail splices with row edits patch the cached history exactly as a fresh read sees it', async t => {
  const root = await mkdtemp(join(tmpdir(), 'tail-patch-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const open = () => createChatPersistence({ store: createChatJournalStore({ dataRoot: root, newConversations: true }) })
  const p = open()
  const rows = Array.from({ length: 10 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', text: 'r' + i, variables: [{ i }] }))
  let chat = await p.write({ id: 'c', sessionId: 's', mode: 'story', messages: rows }, { source: 'create' })
  await p.read('c')
  const cases = [
    [{ op: 'splice', path: ['messages'], index: 8, deleteCount: 2, items: [] }, { op: 'set', path: ['messages', 3], value: { role: 'assistant', text: '恢复' } }],
    [{ op: 'set', path: ['messages', 1, 'variables', 0, 'i'], value: 99 }, { op: 'splice', path: ['messages'], index: 8, deleteCount: 0, items: [{ role: 'user', text: 'u' }, { role: 'assistant', text: 'a' }] }],
    [{ op: 'splice', path: ['messages'], index: 6, deleteCount: 4, items: [{ role: 'user', text: '替换' }] }, { op: 'set', path: ['messages', 6, 'text'], value: '替换后改' }]
  ]
  let expected = structuredClone(rows)
  for (const changes of cases) {
    const revision = (await p.readSlice('c', [])).chat._storageRevision
    assert.ok(await p.patch('c', revision, changes, { source: 'test' }))
    for (const change of changes) {
      if (change.op === 'splice') expected.splice(change.index, change.deleteCount, ...structuredClone(change.items))
      else if (change.path.length === 2) expected[change.path[1]] = structuredClone(change.value)
      else { let target = expected[change.path[1]]; for (const key of change.path.slice(2, -1)) target = target[key]; target[change.path.at(-1)] = change.value }
    }
    assert.deepEqual((await p.read('c')).messages, expected)
    assert.deepEqual((await open().read('c')).messages, expected)
  }
})
