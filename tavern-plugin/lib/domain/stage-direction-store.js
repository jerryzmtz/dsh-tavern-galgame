// Per-turn derived records with a small index. Legacy files stay intact; migration
// is lazy on writes, and cache clearing never deletes direction records.
import { createHash } from 'node:crypto'
const MAX_TURNS = 300
const hash = value => createHash('sha256').update(value).digest('hex').slice(0, 24)

export function createStageDirectionStore(store) {
  const cache = new Map(), locks = new Map()
  function paths(chatId) {
    const base = 'stage/direction/' + hash(chatId)
    return { legacy: base + '.json', index: base + '/index.json', turn: (turn, file) => base + '/' + (file || turn + '.json') }
  }
  async function read(path) {
    const version = store.version ? await store.version(path) : null
    const hit = cache.get(path)
    if (version !== null && hit && hit.version === version) { cache.delete(path); cache.set(path, hit); return hit.value }
    const value = await store.readJson(path)
    if (version !== null) {
      cache.delete(path); cache.set(path, { version, value })
      while (cache.size > 32) cache.delete(cache.keys().next().value)
    }
    return value
  }
  async function index(chatId) {
    const path = paths(chatId), saved = await read(path.index)
    if (saved?.version === 2 && saved.turns) return saved
    const legacy = await read(path.legacy)
    const turns = {}
    for (const turn of Object.keys(legacy?.turns || {}).map(Number).filter(t => Number.isSafeInteger(t) && t > 0).sort((a, b) => b - a).slice(0, MAX_TURNS)) {
      const record = legacy.turns[turn]
      turns[turn] = { key: record.key, status: record.status, legacy: true }
    }
    return { version: 2, turns }
  }
  async function get(chatId, turn) {
    if (!Number.isSafeInteger(turn) || turn < 1) return null
    const entry = (await index(chatId)).turns[turn]
    if (!entry || typeof entry.key !== 'string') return null
    const path = paths(chatId)
    if (entry.file && !new RegExp('^' + turn + '-[a-f0-9]{24}\\.json$').test(entry.file)) return null
    const record = entry.legacy ? (await read(path.legacy))?.turns?.[turn] : await read(path.turn(turn, entry.file))
    if (record?.key !== entry.key || record?.status !== entry.status) return null
    return structuredClone(record)
  }
  function serial(chatId, fn) {
    const operation = (locks.get(chatId) || Promise.resolve()).catch(() => {}).then(fn)
    locks.set(chatId, operation)
    return operation.finally(() => { if (locks.get(chatId) === operation) locks.delete(chatId) })
  }
  // private fork: the owner predicate is checked inside the serialization boundary.
  async function update(chatId, turn, record, current = () => true) {
    if (!Number.isSafeInteger(turn) || turn < 1) throw new Error('Invalid direction turn')
    return serial(chatId, async () => {
      if (!current()) return false
      const path = paths(chatId), before = await index(chatId)
      if (!current()) return false
      const file = record ? turn + '-' + hash(JSON.stringify(record)) + '.json' : null
      // Publish an immutable revision before its pointer; a failed index write leaves
      // the previous complete record readable, including during lazy migration.
      if (record) { await store.writeJson(path.turn(turn, file), record); cache.delete(path.turn(turn, file)) }
      if (!current()) return false
      const apply = saved => {
        if (!current()) throw Object.assign(new Error('Direction superseded'), { code: 'DIRECTION_SUPERSEDED' })
        const value = saved?.version === 2 ? saved : before
        const turns = { ...value.turns }
        if (record) turns[turn] = { key: record.key, status: record.status, file }
        else delete turns[turn]
        for (const old of Object.keys(turns).map(Number).sort((a, b) => b - a).slice(MAX_TURNS)) delete turns[old]
        return { version: 2, turns }
      }
      if (store.updateJson) await store.updateJson(path.index, apply)
      else await store.writeJson(path.index, apply(await read(path.index)))
      cache.delete(path.index)
      return true
    })
  }
  return { get, index: async chatId => structuredClone(await index(chatId)), write: update, remove: (chatId, turn, current) => update(chatId, turn, null, current),
    inspect: () => ({ cachedFiles: cache.size, maxCachedFiles: 32, activeWrites: locks.size, maxTurns: MAX_TURNS }) }
}
