import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { chromium } from 'playwright'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import { registerTavernHttpRoutes, DEFAULT_RPC_BODY_LIMIT } from '../tavern-plugin/lib/http/routes.js'
import { apply as imagePlugin } from '../tavern-plugin/packages/dsh-image-gen/lib/index.js'

function fixture() {
  let handler
  const calls = []
  const connection = { trustedHosts: [], browserAuth: { isAuthenticated: req => req.headers.cookie === 'test-cookie' },
    requestRejection(req) { return HostConnectionService.prototype.requestRejection.call(this, req) } }
  const webServer = { register(spec) { if (spec.path === '/api/dsh-tavern') handler = spec.handler; return () => {} } }
  const services = { webServer, connection, webRuntime: { trustedHosts: [] } }
  registerTavernHttpRoutes({ ctx: { get: name => services[name], effect: fn => fn() }, str: String,
    performanceDiagnostics: { http() {} }, runtimeReadiness: Promise.resolve({ ok: true }), fontLibrary: { serve: async () => false },
    sessionResources: { read: async cap => { if (cap !== 'fixture') throw Error('invalid capability'); return '{"resource":true}' } },
    helperHistoryAccess: { read: async cap => { if (cap !== 'fixture') throw Error('invalid capability'); return { history: true } } },
    tavernStaticResources: { get: async () => ({ body: Buffer.from('image'), mediaType: 'image/png' }) },
    dispatch: async method => { calls.push(method); return {} } })
  async function request(path, { method = 'POST', headers = {}, chunks = [Buffer.from('{}')] } = {}) {
    const result = {}
    await handler({ url: '/api/dsh-tavern/' + path, method, headers: { host: 'localhost:3081', ...headers },
      async *[Symbol.asyncIterator]() { yield* chunks } },
    { writeHead(status) { result.status = status }, end(body) { result.body = body } })
    return result
  }
  return { request, calls, handler }
}

test('Tavern and image routes reject unauthenticated/rebinding callers before dispatch; capability routes retain cookie-free access', async t => {
  const { request, calls, handler } = fixture()
  assert.equal((await request('getJudgeConfig', { headers: { origin: 'http://localhost:9999' } })).status, 403)
  assert.equal((await request('getJudgeConfig')).status, 401, 'template worker has no browser cookie')
  assert.equal((await request('getJudgeConfig', { headers: { host: 'foreign.example', origin: 'http://foreign.example' } })).status, 403)
  assert.deepEqual(calls, [])
  assert.equal((await request('getJudgeConfig', { headers: { cookie: 'test-cookie', origin: 'http://localhost:3081' } })).status, 200)
  for (const path of ['session-resource?cap=fixture', 'helper-history?cap=fixture', 'static-assets?url=https://cdn.example/a.png']) {
    assert.equal((await request(path, { method: 'GET', headers: { origin: 'null' } })).status, 200, path)
    assert.equal((await request(path, { method: 'GET', headers: { host: 'foreign.example' } })).status, 403)
    assert.equal((await request(path, { method: 'GET', headers: { origin: 'null', 'sec-fetch-site': 'cross-site' } })).status, 200)
    for (const method of ['HEAD', 'POST']) assert.equal((await request(path, { method })).status, 401)
  }
  for (const path of ['session-resource', 'helper-history']) assert.equal((await request(path, { method: 'GET' })).status, 403)
  const headers = []
  const server = createServer((req, res) => {
    if (req.url === '/') { res.writeHead(200, {'Content-Type':'text/html'}); res.end('<!doctype html><body></body>'); return }
    headers.push(req.headers)
    void handler(req, res)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => server.close())
  const browser = await chromium.launch({headless:true,args:['--mute-audio']})
  t.after(() => browser.close())
  const page = await browser.newPage(), base = 'http://127.0.0.1:' + server.address().port
  await page.goto(base)
  const result = await page.evaluate(base => new Promise(resolve => {
    window.addEventListener('message', event => resolve(event.data), {once:true})
    const frame = document.createElement('iframe'); frame.sandbox = 'allow-scripts'
    const urls = ['session-resource?cap=fixture', 'client-assets/tavern.css', 'session-resource?cap=invalid'].map(path => base + '/api/dsh-tavern/' + path)
    frame.srcdoc = '<script>Promise.all(' + JSON.stringify(urls) + '.map(async url=>(await fetch(url)).status)).then(statuses=>parent.postMessage(statuses,"*")).catch(e=>parent.postMessage({error:e.message},"*"))</script>'
    document.body.append(frame)
  }), base)
  assert.deepEqual(result, [200, 200, 403])
  assert.ok(headers.some(h => h.origin === 'null' && h['sec-fetch-site'] === 'cross-site' && !h.cookie))
  const routes = new Map()
  imagePlugin({ inject() {}, provide() {}, effect: fn => fn(), webRuntime: { trustedHosts: [] },
    webServer: { register(spec) { routes.set(spec.path, spec.handler); return () => {} } },
    attachments: { imageLimits: { maxImageBytes: 1024 } } }, { registerAgentTools: false })
  for (const handler of routes.values()) {
    for (const headers of [{host:'foreign.example',origin:'http://foreign.example'}, {host:'localhost:3081','sec-fetch-site':'cross-site'}]) {
      let status
      await handler({ method: 'GET', headers }, { writeHead(value) { status = value }, end() {} })
      assert.equal(status, 403)
    }
  }
  assert.equal(routes.size, 3)
})

test('general RPC cap accepts the largest bounded save import envelope and rejects oversized streams before dispatch', async () => {
  const { request, calls } = fixture()
  const envelopeBytes = Math.ceil(50 * 1024 * 1024 / 3) * 4 + Buffer.byteLength('{"fileB64":"","name":"save.zip"}')
  assert.ok(envelopeBytes < DEFAULT_RPC_BODY_LIMIT)
  const chunk = Buffer.alloc(1024 * 1024, ' ')
  const validChunks = [Buffer.from('{}'), ...Array(67).fill(chunk)]
  assert.equal((await request('importGameSave', { headers: { cookie: 'test-cookie' }, chunks: validChunks })).status, 200)
  const rejected = await request('importGameSave', { headers: { cookie: 'test-cookie' }, chunks: Array(81).fill(chunk) })
  assert.equal(JSON.parse(rejected.body).ok, false)
  assert.match(JSON.parse(rejected.body).error, /80 MiB/)
  assert.deepEqual(calls, ['importGameSave'])
  const small = await request('gameplay.test', { headers: { cookie: 'test-cookie' }, chunks: Array(3).fill(chunk) })
  assert.equal(JSON.parse(small.body).ok, false, 'smaller existing cap remains active')
})
