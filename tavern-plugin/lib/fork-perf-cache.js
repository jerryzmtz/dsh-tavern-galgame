// Small bounded caches for recomputable host metadata; never use for write locks or leases.
import { readdir, stat } from 'node:fs/promises'
export class LruMap extends Map {
  constructor(limit = 256) { super(); if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('Invalid cache limit'); this.limit = limit }
  get(key) { if (!super.has(key)) return undefined; const value = super.get(key); super.delete(key); super.set(key, value); return value }
  set(key, value) { super.delete(key); super.set(key, value); while (this.size > this.limit) super.delete(this.keys().next().value); return this }
}
export async function fileStamp(file) {
  try { const info = await stat(file); return info.size + ':' + info.mtimeMs + ':' + info.ctimeMs }
  catch (error) { if (error.code === 'ENOENT') return 'missing'; throw error }
}
const directories = new LruMap(128)
export async function cachedDirectoryEntries(directory) {
  const stamp = await fileStamp(directory), old = directories.get(directory)
  if (old?.stamp === stamp) return old.entries
  const entries = stamp === 'missing' ? [] : await readdir(directory, { withFileTypes: true })
  directories.set(directory, { stamp, entries }); return entries
}
export async function mapConcurrent(items, limit, fn) {
  const result = new Array(items.length); let next = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const index = next++; result[index] = await fn(items[index], index) }
  }))
  return result
}
