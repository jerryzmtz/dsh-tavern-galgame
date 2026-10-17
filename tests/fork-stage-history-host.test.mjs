import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createStageDirectionStore } from '../tavern-plugin/lib/domain/stage-direction-store.js'

const hash = value => createHash('sha256').update(value).digest('hex').slice(0, 24)
function storage() {
  const files = new Map(), versions = new Map(), reads = []
  return { files, reads, version: async key => versions.get(key) || 0,
    readJson: async key => { reads.push(key); return structuredClone(files.get(key)) },
    writeJson: async (key, value) => { files.set(key, structuredClone(value)); versions.set(key, (versions.get(key) || 0) + 1) } }
}
const legacyPath = id => 'stage/direction/' + hash(id) + '.json'

test('direction migration is read-only until a turn writes; legacy records remain byte-equivalent', async () => {
  const store = storage(), path = legacyPath('chat'), legacy = { version: 1, turns: { 1: { key: 'one', status: 'done', entries: [] }, 2: { key: 'two', status: 'error' } } }
  await store.writeJson(path, legacy)
  const records = createStageDirectionStore(store)
  assert.deepEqual(await records.get('chat', 1), legacy.turns[1])
  assert.equal(store.files.size, 1)
  await records.write('chat', 2, { key: 'two', status: 'done', entries: [{ at: 1 }] })
  assert.equal(store.files.size, 3)
  assert.deepEqual(store.files.get(path), legacy)
  const restart = createStageDirectionStore(store)
  assert.deepEqual(await restart.get('chat', 1), legacy.turns[1])
  assert.equal((await restart.get('chat', 2)).status, 'done')
  await restart.remove('chat', 2)
  assert.equal(await restart.get('chat', 2), null, 'a removed retry target cannot resurrect from legacy')
  assert.deepEqual(store.files.get(path), legacy)
})

test('direction reads invalidate by file version and never retain an unbounded map', async () => {
  const store = storage(), records = createStageDirectionStore(store)
  await records.write('c', 1, { key: 'one', status: 'done', entries: [] })
  await records.get('c', 1)
  store.reads.length = 0
  const copy = await records.get('c', 1); copy.entries.push({ at: 9 })
  assert.equal((await records.get('c', 1)).entries.length, 0)
  assert.equal(store.reads.length, 0, 'warm read checks versions, not JSON')
  const path = 'stage/direction/' + hash('c') + '/' + (await records.index('c')).turns[1].file
  await store.writeJson(path, { key: 'one', status: 'done', entries: [{ at: 2 }] })
  assert.equal((await records.get('c', 1)).entries[0].at, 2)
  for (let turn = 2; turn <= 320; turn++) await records.write('c', turn, { key: String(turn), status: 'done' })
  assert.equal(Object.keys((await records.index('c')).turns).length, 300)
  assert.equal(await records.get('c', 1), null)
  assert.ok(store.files.has(path), 'old direction data is preserved, not deleted by cache eviction')
  assert.ok(records.inspect().cachedFiles <= 32)
  assert.equal(records.inspect().activeWrites, 0)
})

test('failed index publication preserves the previous record and leaves no partial migration', async () => {
  const store = storage(), records = createStageDirectionStore(store)
  const original = { key: 'one', status: 'done', entries: [{ at: 1 }] }
  await records.write('c', 1, original)
  const write = store.writeJson
  store.writeJson = async (path, value) => { if (path.endsWith('/index.json')) throw new Error('disk full'); return write(path, value) }
  await assert.rejects(records.write('c', 1, { ...original, entries: [{ at: 2 }] }), /disk full/)
  assert.deepEqual(await records.get('c', 1), original)
  assert.equal(records.inspect().activeWrites, 0)
  assert.equal(await records.get('c', '../index'), null)
})

test('concurrent turn writes merge the index without losing siblings', async () => {
  const store = storage(), records = createStageDirectionStore(store)
  await Promise.all(Array.from({ length: 20 }, (_, i) => records.write('c', i + 1, { key: String(i), status: 'done' })))
  assert.equal(Object.keys((await records.index('c')).turns).length, 20)
})
