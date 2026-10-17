import { mkdir, readFile, writeFile, rename, readdir, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { hash, SHA, wav, fail } from './core.js'

// Only synthesized clips owned by this directory; never scan a consumer's assets.
export function createCache({ dataDir, maxBytes = 1024 ** 3, maxAgeDays = 30 } = {}) {
  const root = dataDir && join(dataDir, 'cache', 'audio-v2')
  const entries = new Map()
  let loaded = false, chain = Promise.resolve()
  const serial = fn => { const p = chain.then(fn); chain = p.catch(() => {}); return p }
  async function load() {
    if (loaded) return
    loaded = true
    if (!root) return
    const files = await readdir(root).catch(e => { if (e.code === 'ENOENT') return []; throw e })
    for (const file of files.filter(f => /^[a-f0-9]{64}\.json$/.test(f))) {
      try {
        const entry = JSON.parse(await readFile(join(root, file), 'utf8'))
        if (SHA.test(entry.hash) && Array.isArray(entry.scopes) && entry.scopes.length <= 128 && entry.scopes.every(s => typeof s === 'string') && Number.isSafeInteger(entry.bytes) && entry.bytes > 0 && entry.bytes <= 32 * 1024 ** 2 && Number.isFinite(entry.access)) entries.set(file.slice(0, 64), entry)
      } catch { /* A interrupted manifest is a miss, never a guessed cache hit. */ }
    }
    await trim()
  }
  async function atomic(file, bytes) {
    const tmp = file + '.' + randomUUID() + '.tmp'
    await writeFile(tmp, bytes, { mode: 0o600 }); await rename(tmp, file)
  }
  async function remove(key) {
    entries.delete(key)
    if (root) for (const ext of ['wav', 'json']) await unlink(join(root, key + '.' + ext)).catch(e => { if (e.code !== 'ENOENT') throw e })
  }
  async function trim() {
    const cutoff = Date.now() - maxAgeDays * 86400000
    for (const [key, e] of entries) if (e.access < cutoff) await remove(key)
    let size = [...entries.values()].reduce((sum, e) => sum + e.bytes, 0)
    for (const [key, e] of [...entries].sort((a,b) => a[1].access - b[1].access)) {
      if (size <= maxBytes && entries.size <= 10000) break
      await remove(key); size -= e.bytes
    }
  }
  return {
    get: (key, scope) => serial(async () => {
      if (!SHA.test(key)) fail('INVALID_INPUT')
      await load(); const e = entries.get(key); if (!e) return null
      if (e.access < Date.now() - maxAgeDays * 86400000) { await remove(key); return null }
      try {
        const b = root ? await readFile(join(root, key + '.wav')) : e.audio
        // Written once by put() via tmp+rename; size plus the WAV parse rejects a torn file without rehashing every hit.
        if (b.length !== e.bytes) { await remove(key); return null }
        wav(b); e.access = Date.now()
        if (scope && !e.scopes.includes(scope)) { if (e.scopes.length >= 128) { await remove(key); return null }; e.scopes.push(scope) }
        if (root) await atomic(join(root, key + '.json'), JSON.stringify(e))
        return b
      } catch { await remove(key); return null }
    }),
    put: (key, bytes, scopes) => serial(async () => {
      await load(); const b = wav(bytes)
      if (!SHA.test(key) || b.length > maxBytes) fail('CACHE_FULL')
      const e = { hash: hash(b), bytes: b.length, scopes: [...new Set(scopes)], access: Date.now() }
      if (root) { await mkdir(root, { recursive: true }); await atomic(join(root, key + '.wav'), b); await atomic(join(root, key + '.json'), JSON.stringify(e)) }
      else e.audio = b
      entries.set(key, e); await trim()
    }),
    configure: limits => serial(async () => { maxBytes = limits.maxBytes; maxAgeDays = limits.maxAgeDays; await load(); await trim() }),
    stats: () => serial(async () => { await load(); await trim(); return { count: entries.size, bytes: [...entries.values()].reduce((s,e) => s + e.bytes, 0), maxBytes, maxAgeDays } }),
    clear: scope => serial(async () => { await load(); const keys = [...entries].filter(([,e]) => !scope || e.scopes.includes(scope)).map(([k]) => k); for (const k of keys) await remove(k); return { removed: keys.length, keys } }),
    flush: () => chain,
  }
}
