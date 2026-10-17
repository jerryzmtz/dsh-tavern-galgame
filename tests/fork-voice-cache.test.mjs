import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createVoiceDiskCache, voiceCacheBudget, DEFAULT_VOICE_CACHE_BYTES } from '../tavern-plugin/lib/fork-voice-cache.js'

const key = n => String(n).padStart(64, '0')
async function isolated(fn) {
  const root = await mkdtemp(join(tmpdir(), 'fork-voice-cache-'))
  try { await fn(root) } finally { await rm(root, { recursive: true, force: true }) }
}

test('disk audio survives restart, updates LRU, and enforces byte and count limits', () => isolated(async dataRoot => {
  let time = 100000
  const cache = createVoiceDiskCache({ dataRoot, maxBytes: 8, maxEntries: 2, now: () => time++ })
  await cache.put(key(1), Buffer.from('aaaa'), 'azure', [{ sessionId: 's1', cardId: 'c1' }])
  await cache.put(key(2), Buffer.from('bbbb'), 'volcengine', [{ sessionId: 's2', cardId: 'c2' }])
  assert.equal((await cache.get(key(1))).toString(), 'aaaa')
  await cache.put(key(3), Buffer.from('cccc'), 'azure')
  assert.equal(await cache.get(key(2)), null, 'least recently used, not oldest created')
  await cache.flush()
  const restart = createVoiceDiskCache({ dataRoot, maxBytes: 8, maxEntries: 2 })
  assert.equal((await restart.get(key(1))).toString(), 'aaaa')
  const stats = await restart.stats()
  assert.equal(stats.bytes, 8); assert.equal(stats.count, 2)
  assert.deepEqual(stats.providers.azure, { bytes: 8, count: 2 })
  assert.equal(await restart.put(key(4), Buffer.alloc(9), 'azure'), false)
  assert.equal((await restart.stats()).bytes, 8)
}))

test('entry cap is independent of bytes and a zero budget disables disk storage', () => isolated(async dataRoot => {
  const cache = createVoiceDiskCache({ dataRoot, maxBytes: 1000, maxEntries: 2, now: () => 1 })
  await cache.put(key(1), Buffer.from('a'), 'azure')
  await cache.put(key(2), Buffer.from('b'), 'azure')
  await cache.get(key(1))
  await cache.put(key(3), Buffer.from('c'), 'azure')
  assert.equal(await cache.get(key(2)), null, 'LRU works even when timestamps tie')
  assert.equal((await cache.stats()).count, 2)
  const disabled = createVoiceDiskCache({ dataRoot, maxBytes: 0 })
  assert.equal((await disabled.stats()).count, 0)
  assert.equal(await disabled.put(key(4), Buffer.from('d'), 'azure'), false)
}))

test('scoped clearing handles shared clips and never deletes imported files', () => isolated(async dataRoot => {
  await writeFile(join(dataRoot, 'user-content.wav'), 'keep')
  const cache = createVoiceDiskCache({ dataRoot })
  await cache.put(key(1), Buffer.from('a'), 'azure', [{ sessionId: 's1', cardId: 'c1' }])
  await cache.associate(key(1), { sessionId: 's2', cardId: 'c2' })
  await cache.put(key(2), Buffer.from('bb'), 'reference', [{ sessionId: 's3', cardId: 'c3' }])
  const restart = createVoiceDiskCache({ dataRoot })
  assert.equal((await restart.clear({ scope: 'session', sessionId: 's2' })).removed, 1)
  assert.equal((await restart.stats()).bytes, 2)
  assert.equal((await restart.clear({ scope: 'card', cardId: 'c3' })).removed, 1)
  assert.equal((await restart.stats()).count, 0)
  await assert.rejects(restart.clear({ scope: 'card' }), /identity/)
  const { readFile } = await import('node:fs/promises')
  assert.equal(await readFile(join(dataRoot, 'user-content.wav'), 'utf8'), 'keep')
}))

test('manifest invalidation, missing audio and orphan cleanup are bounded to cache files', () => isolated(async dataRoot => {
  const a = createVoiceDiskCache({ dataRoot }), b = createVoiceDiskCache({ dataRoot })
  await a.put(key(1), Buffer.from('a'), 'azure')
  assert.equal((await b.stats()).count, 1)
  await a.clear({ scope: 'all' })
  assert.equal((await b.stats()).count, 0)
  await a.put(key(2), Buffer.from('b'), 'azure')
  await rm(join(dataRoot, 'voice/audio-cache-v1', key(2) + '.wav'))
  assert.equal(await a.get(key(2)), null)
  assert.equal((await a.stats()).count, 0)
  assert.equal(voiceCacheBudget(-1), DEFAULT_VOICE_CACHE_BYTES)
  assert.equal(voiceCacheBudget('12'), 12)
  assert.equal(voiceCacheBudget(''), DEFAULT_VOICE_CACHE_BYTES)
}))
