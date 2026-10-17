import path from 'node:path'
import {spawn} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {readFile, mkdir, writeFile, rename, unlink, stat} from 'node:fs/promises'
import {randomUUID} from 'node:crypto'
import {check, validateUuid, validateHash} from '../asset-packs/common.js'
import {checkedPath} from './storage.js'

const image = descriptor => ['png','jpeg','webp'].includes(descriptor?.ext)
// Longest-side tiers. 256 is the warmed grid size; the client asks for a larger tier when its box × devicePixelRatio
// (or a head crop of the picture) needs more pixels. A few fixed sizes keep the cache shared between views.
export const THUMBNAIL_SIZES = [256,512,1024]
const absent = error => { if (error.code !== 'ENOENT') throw error }
async function encode(bytes, size = 256) {
  // A worker thread still shares native DLLs: use a process to isolate host libvips.
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(new URL('./thumbnail-encoder.js', import.meta.url)),String(size)], {
      windowsHide:true, stdio:['pipe','pipe','pipe'], env:{...process.env,ELECTRON_RUN_AS_NODE:'1'}, timeout:30000
    })
    const output = [], errors = []
    child.stdout.on('data', chunk => output.push(chunk))
    child.stderr.on('data', chunk => errors.push(chunk))
    child.on('error', reject)
    child.stdin.on('error', reject)
    child.on('close', code => code === 0 ? resolve(Buffer.concat(output)) : reject(new Error(Buffer.concat(errors).toString() || 'Thumbnail encoder exited: ' + code)))
    child.stdin.end(bytes)
  })
}

// This is disposable derived data. Stored blob identities are never recomputed.
export function createThumbnailCache({assetRoot, service, encodeImage = encode, delayMs = 1000, startupMs = 10000, isBusy = () => false, onError = error => console.warn('[asset-thumbnails]',error.message)}) {
  const root = path.join(assetRoot,'thumbnail-cache','v1'), pending = new Map(), packs = new Set()
  let tail = Promise.resolve(), timer, stopped = false, scanning = false, entries = [], scanTask, startupTask
  const file = (hash,size = 256) => checkedPath(root,hash + (size === 256 ? '' : '-' + size) + '.webp')
  const exists = async hash => !!(await stat(await file(hash)).catch(absent))?.size
  async function snapshot(packId) { validateUuid(packId); return service.getPackSnapshot({packId}) }
  async function get({packId,hash,size = 256}) {
    validateUuid(packId); validateHash(hash); check(THUMBNAIL_SIZES.includes(size),'$.size','Unsupported thumbnail size')
    const pack = await snapshot(packId)
    if (!image(pack?.manifest.blobs[hash])) return null
    const cached = await readFile(await file(hash,size)).catch(absent), key = hash + ':' + size
    if (cached?.length) return cached
    if (pending.has(key)) return pending.get(key)
    const task = tail.then(async () => {
      check(!stopped,'$.thumbnail','Thumbnail cache stopped','ASSET_UNAVAILABLE')
      const target = await file(hash,size), hit = await readFile(target).catch(absent)
      if (hit?.length) return hit
      const {bytes} = await service.readMedia({packId,hash,expectedRevision:pack.revision})
      const output = await encodeImage(bytes,size)
      await mkdir(root,{recursive:true})
      const temporary = await checkedPath(root,randomUUID() + '.tmp')
      try { await writeFile(temporary,output,{flag:'wx'}); await rename(temporary,target) }
      finally { await unlink(temporary).catch(absent) }
      return output
    })
    pending.set(key,task)
    tail = task.catch(() => {})
    try { return await task } finally { pending.delete(key) }
  }
  async function manifest(packId) {
    const pack = await snapshot(packId), hashes = []
    for (const [hash,descriptor] of Object.entries(pack?.manifest.blobs || {})) if (image(descriptor) && await exists(hash)) hashes.push(hash)
    return {hashes}
  }
  function schedule(delay = delayMs) {
    if (stopped || timer || scanning) return
    timer = setTimeout(() => { timer = null; scanTask = step() },delay); timer.unref?.()
  }
  async function step() {
    if (stopped) return
    if (isBusy() || pending.size) { schedule(); return }
    scanning = true
    try {
      if (!entries.length && packs.size) {
        const packId = packs.values().next().value; packs.delete(packId)
        const pack = await snapshot(packId)
        entries = Object.entries(pack?.manifest.blobs || {}).filter(([,descriptor]) => image(descriptor)).map(([hash]) => ({packId,hash}))
      }
      const entry = entries.shift()
      if (entry && !stopped && !await exists(entry.hash)) await get(entry)
    } catch (error) { onError(error) }
    finally { scanning = false; if (entries.length || packs.size) schedule() }
  }
  function warm(packId) { if (!stopped) { packs.add(packId); schedule() } }
  const stopChanges = service.subscribe(event => { if (event.revision) warm(event.packId) })
  let startup
  function start() {
    if (startup || stopped) return
    startup = setTimeout(() => {
      startup = null
      startupTask = service.listPackSummaries().then(rows => {
        for (const row of rows) if (!row.error && !row.privateConfig) warm(row.packId)
      }).catch(error => { if (!stopped) onError(error) })
    },startupMs); startup.unref?.()
  }
  return {get,manifest,warm,start,async dispose() {
    stopped = true; clearTimeout(startup); clearTimeout(timer); stopChanges(); packs.clear(); entries = []; await Promise.all([tail,scanTask,startupTask])
  }}
}
