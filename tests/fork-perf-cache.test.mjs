import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm, readFile } from "node:fs/promises"
import { tmpdir } from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { Writable } from 'node:stream'
import { LruMap, mapConcurrent } from "../tavern-plugin/lib/fork-perf-cache.js"
import { assetEtag, assetRange, assetNotModified, serveAssetFile } from '../tavern-plugin/lib/fork-http-file.js'

test('LRU bounds recomputable entries and touches reads and updates', () => {
  const cache = new LruMap(2)
  cache.set('a', 1).set('b', 2); assert.equal(cache.get('a'), 1)
  cache.set('c', 3); assert.equal(cache.has('b'), false)
  cache.set('a', 4).set('d', 5); assert.equal(cache.has('c'), false)
  assert.equal(cache.size, 2); assert.equal(cache.get('a'), 4)
})
test('bounded map preserves order and never runs more than four hashes', async () => {
  let active = 0, max = 0
  const result = await mapConcurrent(Array.from({ length: 37 }, (_, i) => i), 4, async i => {
    max = Math.max(max, ++active); await new Promise(resolve => setTimeout(resolve, i % 3)); active--; return i * 2
  })
  assert.equal(max, 4); assert.deepEqual(result, Array.from({ length: 37 }, (_, i) => i * 2))
})
test('ETags and byte ranges cover weak matching, suffixes, empty files and unsafe integers', () => {
  const info = { size: 43, mtimeMs: 1234.5, ctimeMs: 4567 }
  const etag = assetEtag(info)
  assert.notEqual(assetEtag({ ...info, mtimeMs: 1234.6 }), etag)
  assert.notEqual(assetEtag({ ...info, size: 44 }), etag)
  assert.equal(assetNotModified('"other", W/' + etag, etag), true)
  assert.equal(assetNotModified('*', etag), true)
  assert.equal(assetNotModified('"other"', etag), false)
  assert.deepEqual(assetRange('bytes=3-8', 43), { start: 3, end: 8 })
  assert.deepEqual(assetRange('bytes=-99', 43), { start: 0, end: 42 })
  assert.deepEqual(assetRange('bytes=40-99', 43), { start: 40, end: 42 })
  for (const range of ['bytes=-0', 'bytes=-', 'bytes=8-2', 'bytes=99-', 'bytes=0-1,2-3', 'bytes=9007199254740992-', 'bytes=-9007199254740992']) assert.equal(assetRange(range, 43), null, range)
  assert.equal(assetRange('bytes=0-', 0), null)
})
test('streamed file GET/HEAD, early conditional response, replacement and aborted destination', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'fork-http-')); t.after(() => rm(root, { recursive: true, force: true }))
  const file = path.join(root, 'asset.bin'); await writeFile(file, Buffer.alloc(1024 * 1024, 42))
  async function request(headers = {}, method = 'GET') {
    const chunks = [], res = new Writable({ write(chunk, _, done) { chunks.push(chunk); done() } })
    res.writeHead = (status, values) => { res.status = status; res.headers = values }
    await serveAssetFile({ headers, method }, res, file, 'application/octet-stream')
    return { ...res, bytes: Buffer.concat(chunks) }
  }
  const first = await request({ range: 'bytes=1024-2047' })
  assert.equal(first.status, 206); assert.equal(first.bytes.length, 1024)
  const cached = await request({ 'if-none-match': first.headers.ETag, range: 'bytes=0-1' })
  assert.equal(cached.status, 304); assert.equal(cached.bytes.length, 0)
  assert.equal((await request({}, 'HEAD')).bytes.length, 0)
  await writeFile(file, 'changed')
  assert.equal((await request({ 'if-none-match': first.headers.ETag })).status, 200)
  const broken = new Writable({ write(chunk, _, done) { done(new Error('client disconnected')) } }); broken.writeHead = () => {}
  await assert.rejects(serveAssetFile({ headers: {} }, broken, file, 'application/octet-stream'), /disconnected/)
  await writeFile(file, 'after close')
})

// private fork: deleted the host-queue deadline ticker test. Native synthesis promises
// replace polling; fork-stage-voice.test.mjs checks idle/tail cleanup and cancellation.
test('bubble settings retain the 64 most recently accessed sessions, not lifetime history', async () => {
  const source = await readFile(new URL('../tavern-plugin/src/client/fork-bubbles.js', import.meta.url), 'utf8')
  const ctx = {}; vm.runInNewContext(source.slice(source.indexOf('const forkBubbleStore ='), source.indexOf('function useForkBubbles(')) + ';this.store=forkBubbleStore', ctx)
  for (let i = 0; i < 64; i++) ctx.store.set('s' + i, { config: i })
  ctx.store.get('s0'); ctx.store.set('s64', { config: 64 })
  assert.equal(ctx.store.get('s1'), null); assert.equal(ctx.store.get('s0').config, 0)
})

test('audio catalogue and analysis queue remain bounded across 4000 unique assets', async () => {
  const source = await readFile(new URL('../tavern-plugin/src/client/fork-stage-audio.js', import.meta.url), 'utf8')
  const ctx = { rpc: () => new Promise(() => {}), forkAudioMeasurement: value => value?.v === 1 }
  const instrumented = source.replace('        subscribe(fn)', '        sizes: () => ({ catalogue: catalogue.size, queued: queued.size, queue: queue.length, failed: failed.size }),\n        subscribe(fn)')
  vm.runInNewContext(instrumented + ';this.mixer = forkStageAudio', ctx)
  ctx.mixer.register(Array.from({length:4000}, (_,i)=>({url:'/asset/'+i})))
  assert.equal(ctx.mixer.sizes().catalogue, 1024)
  assert.equal(ctx.mixer.sizes().queued, 256)
  assert.equal(ctx.mixer.sizes().queue, 255)
})
