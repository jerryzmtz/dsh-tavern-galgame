// Disposable synthesized audio only. Never shares a directory with imported assets.
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { createDurableFilePromotion } from './durable-file-promotion.js'

const KEY = /^[a-f0-9]{64}$/
export const DEFAULT_VOICE_CACHE_BYTES = 1024 ** 3
const MAX_ENTRIES = 10000
const MAX_SCOPES = 128
export function voiceCacheScope(value) { return typeof value === 'string' && value ? createHash('sha256').update(value).digest('hex') : '' }
export function voiceCacheBudget(value) {
  const number = Number(value)
  return value !== undefined && value !== '' && Number.isSafeInteger(number) && number >= 0 ? number : DEFAULT_VOICE_CACHE_BYTES
}

export function createVoiceDiskCache({ dataRoot, maxBytes = process.env.DSH_TAVERN_VOICE_CACHE_BYTES, maxEntries = MAX_ENTRIES, now = Date.now }) {
  const root = join(dataRoot, 'voice', 'audio-cache-v1'), manifest = join(root, 'index.json')
  const files = createDurableFilePromotion()
  const budget = voiceCacheBudget(maxBytes), countLimit = Math.max(1, Math.min(MAX_ENTRIES, Number(maxEntries) || MAX_ENTRIES))
  let entries = new Map(), loaded = false, stamp = '', chain = Promise.resolve(), lastSaved = 0, dirty = false, clock = 0
  const accessed = () => (clock = Math.max(now(), clock + 1))
  const serial = fn => { const result = chain.then(fn); chain = result.catch(() => {}); return result }
  const version = async () => { try { const s = await stat(manifest); return [s.size, s.mtimeMs, s.ctimeMs].join(':') } catch (error) { if (error.code === 'ENOENT') return ''; throw error } }
  async function save() {
    await files.write(manifest, JSON.stringify({ version: 1, entries: Object.fromEntries(entries) }))
    stamp = await version(); lastSaved = now(); dirty = false
  }
  async function remove(key) {
    await rm(join(root, key + '.wav'), { force: true })
    entries.delete(key); dirty = true
  }
  async function trim() {
    let bytes = [...entries.values()].reduce((sum, entry) => sum + entry.bytes, 0)
    const oldest = [...entries].sort((a, b) => a[1].access - b[1].access)
    for (const [key, entry] of oldest) {
      if (bytes <= budget && entries.size <= countLimit) break
      await remove(key); bytes -= entry.bytes
    }
  }
  async function load() {
    const current = await version()
    if (loaded && current === stamp) return
    let document
    try { document = JSON.parse(await readFile(manifest, 'utf8')) } catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error }
    const next = new Map()
    for (const [key, value] of Object.entries(document?.version === 1 ? document.entries || {} : {})) {
      if (!KEY.test(key) || !Number.isSafeInteger(value?.bytes) || value.bytes < 1 || typeof value.provider !== 'string') continue
      next.set(key, { bytes: value.bytes, provider: value.provider.slice(0, 64), access: Number.isFinite(value.access) ? value.access : 0,
        sessions: (Array.isArray(value.sessions) ? value.sessions : []).filter(s => KEY.test(s)).slice(0, MAX_SCOPES), cards: (Array.isArray(value.cards) ? value.cards : []).filter(s => KEY.test(s)).slice(0, MAX_SCOPES) })
    }
    entries = next; loaded = true; stamp = current
    for (const entry of entries.values()) clock = Math.max(clock, entry.access)
    // Reconcile crash leftovers only at load, never scan the directory on each audio read.
    const disk = await readdir(root, { withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error })
    const present = new Set(disk.filter(item => item.isFile() && /^[a-f0-9]{64}\.wav$/.test(item.name)).map(item => item.name.slice(0, 64)))
    for (const key of entries.keys()) if (!present.has(key)) { entries.delete(key); dirty = true }
    for (const key of present) if (!entries.has(key)) await rm(join(root, key + '.wav'), { force: true })
    await trim()
    if (dirty) await save()
  }
  function associate(entry, scope = {}) {
    for (const [field, id] of [['sessions', scope.sessionId], ['cards', scope.cardId]]) {
      const hash = voiceCacheScope(id)
      if (hash && !entry[field].includes(hash)) {
        if (entry[field].length >= MAX_SCOPES) return false
        entry[field].push(hash); dirty = true
      }
    }
    return true
  }
  function stats() {
    const providers = Object.create(null)
    let bytes = 0
    for (const entry of entries.values()) {
      bytes += entry.bytes
      const provider = providers[entry.provider] ||= { bytes: 0, count: 0 }
      provider.bytes += entry.bytes; provider.count++
    }
    return { bytes, count: entries.size, maxBytes: budget, maxEntries: countLimit, providers }
  }
  return {
    get: (key, scope) => serial(async () => {
      if (!KEY.test(String(key))) throw new Error('Invalid voice cache key')
      await load()
      const entry = entries.get(key)
      if (!entry) return null
      if (!associate(entry, scope)) { await remove(key); await save(); return null }
      let wav
      try { wav = await readFile(join(root, key + '.wav')) } catch (error) { if (error.code !== 'ENOENT') throw error }
      if (!wav || wav.length !== entry.bytes) { await remove(key); await save(); return null }
      entry.access = accessed(); dirty = true
      if (now() - lastSaved >= 30000) await save()
      return wav
    }),
    put: (key, wav, provider, scopes = []) => serial(async () => {
      if (!KEY.test(String(key)) || !Buffer.isBuffer(wav)) throw new Error('Invalid voice cache audio')
      await load()
      if (!wav.length || wav.length > budget) return false
      const entry = { bytes: wav.length, provider: String(provider || 'unknown').slice(0, 64), access: accessed(), sessions: [], cards: [] }
      for (const scope of scopes) if (!associate(entry, scope)) return false
      await mkdir(root, { recursive: true })
      await files.write(join(root, key + '.wav'), wav)
      entries.set(key, entry); dirty = true
      await trim(); await save()
      return entries.has(key)
    }),
    associate: (key, scope) => serial(async () => {
      await load()
      const entry = entries.get(key)
      if (!entry) return
      const count = entry.sessions.length + entry.cards.length
      if (!associate(entry, scope)) { await remove(key); await save(); return }
      entry.access = accessed(); dirty = true
      // Persist ownership promptly, but do not turn access-time updates into poll writes.
      if (count !== entry.sessions.length + entry.cards.length || now() - lastSaved >= 30000) await save()
    }),
    stats: () => serial(async () => { await load(); return stats() }),
    clear: (args = {}) => serial(async () => {
      if (!['all', 'session', 'card'].includes(args.scope)) throw new Error('Invalid voice cache scope')
      const field = args.scope === 'session' ? 'sessions' : 'cards'
      const id = voiceCacheScope(args.scope === 'session' ? args.sessionId : args.cardId)
      if (args.scope !== 'all' && !id) throw new Error('Cache scope requires an identity')
      await load()
      const keys = [...entries].filter(([, entry]) => args.scope === 'all' || entry[field].includes(id)).map(([key]) => key)
      for (const key of keys) await remove(key)
      if (dirty) await save()
      return { removed: keys.length, keys, ...stats() }
    }),
    flush: () => serial(async () => { if (loaded) { await load(); if (dirty) await save() } })
  }
}
