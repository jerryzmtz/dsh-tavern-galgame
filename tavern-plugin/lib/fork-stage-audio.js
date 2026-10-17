// Read-only audio analysis. Content-addressed side cache never rewrites an asset/index.
import path from 'node:path'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises'
import { LruMap, mapConcurrent } from './fork-perf-cache.js'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
const execute = promisify(execFile)
import { validLoudness } from './domain/stage-audio.js'
export { validLoudness } from './domain/stage-audio.js'
let executable
export async function resolveAudioFfmpeg() {
  if (!executable) executable = (async () => {
    for (const candidate of [...new Set([process.env.FFMPEG_PATH, 'ffmpeg'].filter(Boolean))]) {
      try { await execute(candidate, ['-version'], { windowsHide: true, timeout: 5000 }); return candidate } catch {}
    }
    return null
  })()
  return executable
}
export async function measureAudioFile(file) {
  const ffmpeg = await resolveAudioFfmpeg()
  if (!ffmpeg) return null
  try {
    const { stderr } = await execute(ffmpeg, ['-hide_banner', '-nostdin', '-i', file, '-map', '0:a:0', '-af', 'apad=whole_dur=0.4,ebur128=peak=true', '-f', 'null', '-'], { windowsHide: true, timeout: 180000, maxBuffer: 16 * 1024 * 1024 })
    const summary = stderr.slice(stderr.lastIndexOf('Summary:'))
    const lufs = Number(/I:\s+(-?[\d.]+) LUFS/.exec(summary)?.[1]), rawPeak = /Peak:\s+(-inf|-?[\d.]+) dBFS/.exec(summary)?.[1]
    const peak = rawPeak === '-inf' ? -100 : Math.max(-100, Number(rawPeak))
    const result = { lufs: peak === -100 && lufs <= -70 ? -100 : lufs, peak, v: 1 }
    return validLoudness(result) ? result : null
  } catch { return null }
}
export function createStageAudio({ dataRoot, store, readMedia, measure = measureAudioFile }) {
  const pending = new Map(), failed = new LruMap(512), queue = []
  let active = 0
  async function identity(url) {
    // Only the optional asset owner can authorize and resolve media.
    if (typeof readMedia !== 'function') throw new Error('Audio unavailable')
    const response = await readMedia(url)
    const reader = response.body?.getReader(), chunks = []
    if (!response.ok || !reader || !response.headers.get('content-type')?.startsWith('audio/')) { await response.body?.cancel(); throw new Error('Audio unavailable') }
    let size = 0
    try {
      for (;;) {
        const {done, value} = await reader.read()
        if (done) break
        if ((size += value.byteLength) > 60 * 1024 * 1024) throw new Error('Audio too large')
        chunks.push(Buffer.from(value))
      }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
    const bytes = Buffer.concat(chunks), sha = createHash('sha256').update(bytes).digest('hex')
    return {bytes, sha}
  }
  const cachePath = sha => 'cache/stage-audio/' + sha + '.json'
  async function cached(sha) { try { const value = await store.readJson(cachePath(sha)); return validLoudness(value) ? value : null } catch { return null } }
  function pump() {
    while (active < 2 && queue.length) {
      const job = queue.shift(); active++
      job().finally(() => { active--; pump() })
    }
  }
  async function measureItem(item) {
    const root = path.join(dataRoot, '.stage-audio-tmp')
    await mkdir(root, {recursive:true})
    const folder = await mkdtemp(path.join(root, 'measure-'))
    try {
      const file = path.join(folder, 'audio')
      await writeFile(file, item.bytes)
      return await measure(file)
    } finally { await rm(folder, {recursive:true, force:true}) }
  }
  function schedule(item) {
    if (failed.get(item.sha) > Date.now()) return Promise.resolve(null)
    if (!pending.has(item.sha)) {
      if (pending.size >= 256) return Promise.resolve(null)
      const run = new Promise(resolve => {
        queue.push(async () => {
          let result = null
          try { result = await cached(item.sha) || await measureItem(item); if (validLoudness(result)) await store.writeJson(cachePath(item.sha), result); else { result = null; failed.set(item.sha, Date.now() + 300000) } } catch {}
          resolve(result)
        })
      }).finally(() => pending.delete(item.sha))
      pending.set(item.sha, run); pump()
    }
    return pending.get(item.sha)
  }
  async function inspect({ url, loudness, sha } = {}) {
    const item = await identity(url)
    if (loudness !== undefined && sha !== item.sha) throw new Error('Audio changed during analysis')
    const existing = await cached(item.sha)
    if (existing) return { sha: item.sha, loudness: existing }
    if (loudness !== undefined) {
      if (!validLoudness(loudness)) throw new Error('Invalid loudness')
      const value = { lufs: loudness.lufs, peak: loudness.peak, v: 1 }
      await store.writeJson(cachePath(item.sha), value)
      return { sha: item.sha, loudness: value }
    }
    return { sha: item.sha, loudness: await schedule(item) }
  }
  async function decorate(result) {
    const items = result?.tracks || result?.sounds || [result?.track || result?.sound || result?.item].filter(Boolean)
    // Lease URLs are opaque: verify the authorized bytes before trusting cached measurements.
    await mapConcurrent(items, 4, async item => {
      if (!item.url || validLoudness(item.loudness)) return
      try {
        const id = await identity(item.url), value = await cached(id.sha)
        item.audioSha = id.sha
        if (value) item.loudness = value
        else void schedule(id)
      } catch { /* Unavailable audio remains playable at conservative gain. */ }
    })
    return result
  }
  return { inspect, decorate }
}
