import { simulateReparse } from './fixtures/simulated-reparse.mjs'
import test from 'node:test'
import { Writable } from 'node:stream'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createFontLibrary, FONT_ROUTE } from '../tavern-plugin/lib/fork-font-library.js'

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'tavern-fonts-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const dir = path.join(root, 'fonts', 'example')
  await mkdir(dir, { recursive: true })
  const file = '400-0123456789abcdef.woff2'
  const manifest = { id: 'example', label: 'Example', family: 'Tavern Example', category: 'sans', weights: [400], files: [{ weight: 400, style: 'normal', file, format: 'woff2' }], license: 'OFL', source: 'https://example.test/font', coverage: { subset: false } }
  await writeFile(path.join(dir, 'index.json'), JSON.stringify(manifest))
  await writeFile(path.join(dir, file), 'wOF2-0123456789')
  const api = createFontLibrary({ dataRoot: root, bundledRoot: null })
  const url = FONT_ROUTE + 'example/' + file
  async function request(urlValue = url, headers = {}, method = 'GET') {
    const result = {}
    const chunks = [], response = new Writable({ write(chunk, _, done) { chunks.push(chunk); done() } })
    response.writeHead = (status, headers) => { Object.assign(result, { status, headers }); response.headersSent = true }
    result.handled = await api.serve({ url: urlValue, headers, method }, response)
    result.body = chunks.length ? Buffer.concat(chunks) : undefined
    return result
  }
  return { root, dir, manifest, api, url, request }
}

test('font library: catalog shape, safe URLs, missing directory and malformed entries', async t => {
  const f = await fixture(t)
  const { fonts } = await f.api.listFonts()
  assert.equal(fonts.length, 1)
  assert.deepEqual(Object.keys(fonts[0]).sort(), ['id', 'label', 'family', 'category', 'weights', 'files', 'url', 'license', 'source', 'coverage'].sort())
  assert.equal(fonts[0].url, f.url)
  assert.equal(fonts[0].files[0].url, f.url)
  assert.deepEqual(fonts[0].weights, [400])
  assert.equal(fonts[0].files[0].bytes, 15)
  assert.equal(fonts[0].coverage.subset, false)
  assert.deepEqual(await createFontLibrary({ dataRoot: path.join(f.root, 'missing'), bundledRoot: null }).listFonts(), { fonts: [] })
  await mkdir(path.join(f.root, 'fonts', 'broken'))
  await writeFile(path.join(f.root, 'fonts', 'broken', 'index.json'), 'broken')
  assert.equal((await f.api.listFonts()).fonts.length, 1)
  await writeFile(path.join(f.dir, 'index.json'), JSON.stringify({ ...f.manifest, family: 'evil";}' }))
  assert.equal((await f.api.listFonts()).fonts.length, 0)
})

test('font library: clean installs serve bundled Noto Serif SC without replacing an installed family', async t => {
  const f = await fixture(t), api = createFontLibrary({ dataRoot: f.root })
  const bundled = (await api.listFonts()).fonts.find(font => font.id === 'noto-serif-sc')
  assert.equal(bundled.license, 'SIL OFL 1.1')
  assert.deepEqual(bundled.weights, [400, 500, 700])
  assert.ok(bundled.files.every(face => face.bytes > 1000000))
  const chunks = [], response = new Writable({ write(chunk, _, done) { chunks.push(chunk); done() } })
  response.writeHead = status => { assert.equal(status, 206); response.headersSent = true }
  await api.serve({url:bundled.files[0].url,method:'GET',headers:{range:'bytes=0-3'}},response)
  assert.equal(Buffer.concat(chunks).toString(), 'wOF2')
  const local = path.join(f.root, 'fonts', 'noto-serif-sc')
  await mkdir(local)
  await writeFile(path.join(local, 'index.json'), JSON.stringify({...f.manifest,id:'noto-serif-sc',label:'Owner choice'}))
  await writeFile(path.join(local, f.manifest.files[0].file), 'wOF2-local')
  const selected = (await api.listFonts()).fonts.find(font => font.id === 'noto-serif-sc')
  assert.equal(selected.label, 'Owner choice'); assert.deepEqual(selected.weights, [400])
})

test('font library: WOFF2 MIME, immutable cache, HEAD, ETag and Range contracts', async t => {
  const { request, url } = await fixture(t)
  const full = await request()
  assert.equal(full.status, 200)
  assert.equal(full.headers['Content-Type'], 'font/woff2')
  assert.equal(full.headers['X-Content-Type-Options'], 'nosniff')
  assert.match(full.headers['Cache-Control'], /max-age=31536000, immutable/)
  assert.equal(full.headers['Accept-Ranges'], 'bytes')
  const head = await request(url, {}, 'HEAD')
  assert.equal(head.status, 200)
  assert.equal(head.body, undefined)
  assert.equal(head.headers['Content-Length'], 15)
  assert.equal((await request(url, { 'if-none-match': full.headers.ETag })).status, 304)
  for (const [range, body, contentRange] of [['bytes=0-3', 'wOF2', 'bytes 0-3/15'], ['bytes=-3', '789', 'bytes 12-14/15'], ['bytes=13-', '89', 'bytes 13-14/15']]) {
    const partial = await request(url, { range })
    assert.equal(partial.status, 206)
    assert.equal(partial.body.toString(), body)
    assert.equal(partial.headers['Content-Range'], contentRange)
  }
  for (const range of ['bytes=50-', 'bytes=4-1', 'bytes=-0', 'bytes=0-1,3-4', 'nonsense']) assert.equal((await request(url, { range })).status, 416, range)
  assert.equal((await request(url, { range: 'bytes=0-3', 'if-range': 'stale' })).status, 200)
  assert.equal((await request(url, {}, 'POST')).status, 405)
})

test('font library: reject traversal, encoded separators, malformed URL and unlisted files', async t => {
  const { request, dir } = await fixture(t)
  await writeFile(path.join(dir, 'extra.woff2'), 'not listed')
  for (const suffix of ['../secret.woff2', 'example/../secret.woff2', 'example/%2e%2e%2fsecret.woff2', 'example/%5csecret.woff2', 'example/C:%5csecret.woff2', 'example/index.json', 'example/extra.woff2', 'example/file.woff2%00', 'example/%ZZ']) {
    const response = await request(FONT_ROUTE + suffix)
    assert.equal(response.handled, true)
    assert.equal(response.status, 404, suffix)
  }
  assert.equal((await request('/unrelated')).handled, false)
})

test('font library: simulated reparse paths cannot expose files outside the library', async t => {
  const markReparse = simulateReparse(t)
  const f = await fixture(t)
  const outside = path.join(f.root, 'outside')
  await mkdir(outside)
  await writeFile(path.join(outside, 'index.json'), JSON.stringify({ ...f.manifest, id: 'escape' }))
  await writeFile(path.join(outside, f.manifest.files[0].file), 'secret')
  await markReparse(outside, path.join(f.root, 'fonts', 'escape'))
  assert.equal((await f.request(FONT_ROUTE + 'escape/' + f.manifest.files[0].file)).status, 404)
  assert.equal((await f.api.listFonts()).fonts.length, 1)
})
