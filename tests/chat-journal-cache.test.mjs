import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createChatJournalStore } from '../tavern-plugin/lib/domain/chat-journal-store.js'

async function fixture(t, options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'journal-cache-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const store = createChatJournalStore({ dataRoot: root, ...options })
  for (const id of ['a', 'b']) await store.update(id, () => ({ id, _storageRevision: 1,
    messages: [{ text: id + '-CACHE-BODY-' + 'x'.repeat(10000) }, { text: 'second' }] }))
  return { root, store }
}
function countParses(t) {
  const parse = JSON.parse
  let count = 0
  t.mock.method(JSON, 'parse', function (text, ...args) {
    if (String(text).includes('CACHE-BODY')) count++
    return parse(text, ...args)
  })
  return () => count
}
const edit = (store, id, revision, index, text) => store.patch(id, revision, [
  { op: 'set', path: ['messages', index, 'text'], value: text },
  { op: 'set', path: ['_storageRevision'], value: revision + 1 }
])

for (const options of [{ maxCachedChats: 1 }, { cacheMaxBytes: 30000 }]) test('cache evicts by entry and estimated byte budgets: ' + JSON.stringify(options), async t => {
  const { store } = await fixture(t, options)
  await store.readSlice('a', [0]); await store.readSlice('b', [0])
  const parses = countParses(t)
  await store.readSlice('b', [0])
  assert.equal(parses(), 0)
  await store.readSlice('a', [0])
  assert.ok(parses() > 0)
})

test('external edits and removal invalidate only the affected chat and discard its deltas', async t => {
  const { root, store } = await fixture(t)
  await edit(store, 'a', 1, 1, 'local-a')
  await edit(store, 'b', 1, 1, 'local-b')
  const external = createChatJournalStore({ dataRoot: root })
  await edit(external, 'a', 2, 1, 'external-a')
  assert.equal(await store.readChangedSlice('a', 1), undefined)
  assert.equal((await store.readSlice('a', [1])).chat.messages[0].text, 'external-a')
  assert.equal((await store.readChangedSlice('b', 1)).chat.messages[0].text, 'local-b')
  await external.remove('a')
  assert.equal(await store.readSlice('a'), undefined)
  await external.update('a', () => ({ id: 'a', _storageRevision: 1, messages: [{ text: 'reborn' }] }))
  assert.equal((await store.readSlice('a', [0])).chat.messages[0].text, 'reborn')
  assert.equal(await store.readChangedSlice('a', 0), undefined)
})

test('oversized states bypass the cache, eviction drops delta evidence, and JSON key order is preserved', async t => {
  const { store } = await fixture(t, { cacheMaxBytes: 30000 })
  await edit(store, 'a', 1, 1, 'local')
  await store.readSlice('b', [0])
  assert.equal(await store.readChangedSlice('a', 1), undefined)
  await store.patch('a', 2, [
    { op: 'set', path: ['variables'], value: { z: 1, a: 2, m: 3 } },
    { op: 'set', path: ['messages', 1, 'text'], value: 'large'.repeat(20000) },
    { op: 'set', path: ['_storageRevision'], value: 3 }
  ])
  const parses = countParses(t)
  await store.readSlice('a', [0]); await store.readSlice('a', [0])
  assert.ok(parses() >= 2)
  assert.equal(JSON.stringify((await store.read('a')).variables), '{"z":1,"a":2,"m":3}')
  assert.equal(await store.readChangedSlice('a', 2), undefined)
})

test('cancelled updates detach JSON input and output without serializing the whole saved archive',async t=>{
  const {store}=await fixture(t)
  const stringify=JSON.stringify;let full=0
  t.mock.method(JSON,'stringify',function(value,...args){if(value?.messages?.[0]?.text?.includes('CACHE-BODY'))full++;return stringify(value,...args)})
  const result=await store.update('a',draft=>{draft.messages[1].text='discard';return undefined})
  assert.equal(result.messages[1].text,'second')
  result.messages[1].text='outside'
  assert.equal((await store.readSlice('a',[1])).chat.messages[0].text,'second')
  assert.equal(full,0,'already canonical JSON does not need serialization for detached reads')
})
