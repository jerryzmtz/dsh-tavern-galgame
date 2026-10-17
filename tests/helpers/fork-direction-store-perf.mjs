// Isolated storage benchmark; never reads or writes the live profile.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { createProfileDataStore } from '../../tavern-plugin/lib/profile-data-store.js'
import { createStageDirectionStore } from '../../tavern-plugin/lib/domain/stage-direction-store.js'
import { createHash } from 'node:crypto'
const root = await mkdtemp(join(tmpdir(), 'fork-direction-perf-'))
try {
  const store = createProfileDataStore({ dataRoot: root })
  const turns = Object.fromEntries(Array.from({ length: 300 }, (_, i) => [i + 1, {
    key: String(i).padStart(64, '0'), status: 'done', units: 80, start: { scene: 'School', cast: ['a', 'b'], music: 'Theme' },
    entries: Array.from({ length: 40 }, (_, j) => ({ at: j * 2 + 1, cast: ['a', 'b'], commands: [{ op: 'look', id: 'a', value: 'b' }, { op: 'light', value: 'day' }] })),
    stats: { used: { look: 40, light: 40 }, dropped: {} }, at: Date.now()
  }]))
  const value = { version: 1, turns }, path = 'stage/direction/benchmark.json'
  const reads = [], writes = []
  for (let i = 0; i < 12; i++) {
    let start = performance.now(); await store.writeJson(path, value); writes.push(performance.now() - start)
    start = performance.now(); await store.readJson(path); reads.push(performance.now() - start)
  }
  const stats = values => ({ medianMs: [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)], maxMs: Math.max(...values) })
  const records = createStageDirectionStore(store), chatId = 'benchmark'
  const legacyPath = 'stage/direction/' + createHash('sha256').update(chatId).digest('hex').slice(0, 24) + '.json'
  await store.writeJson(legacyPath, value)
  let start = performance.now(); await records.write(chatId, 300, turns[300]); const migrationMs = performance.now() - start
  const shardReads = [], shardWrites = []
  for (let i = 0; i < 12; i++) {
    start = performance.now(); await records.write(chatId, 300, turns[300]); shardWrites.push(performance.now() - start)
    start = performance.now(); await records.get(chatId, 300); shardReads.push(performance.now() - start)
  }
  const warmReads = []
  for (let i = 0; i < 12; i++) { start = performance.now(); await records.get(chatId, 300); warmReads.push(performance.now() - start) }
  console.log(JSON.stringify({ turns: 300, entriesPerTurn: 40, bytes: Buffer.byteLength(JSON.stringify(value, null, 2)), legacy: { read: stats(reads), write: stats(writes) }, sharded: { migrationMs, readAfterWrite: stats(shardReads), warmRead: stats(warmReads), write: stats(shardWrites), cache: records.inspect() } }, null, 2))
} finally { await rm(root, { recursive: true, force: true }) }
