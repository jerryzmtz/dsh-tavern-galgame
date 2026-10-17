// private fork: pack models have their own lease routes; this adapter owns only Cubism Core.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, unlink, rmdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { createLive2dFiles, LIVE2D_ROUTE_PREFIX } from '../tavern-plugin/lib/fork-live2d-files.js'
import { registerTavernHttpRoutes } from '../tavern-plugin/lib/http/routes.js'

test('Core adapter preserves runtime availability and serving without scanning legacy model folders', async t => {
  assert.throws(() => createLive2dFiles('live2d'), /绝对路径/)
  const root = await mkdtemp(path.join(tmpdir(), 'live2d-core-'))
  const core = path.join(root, 'core'), file = path.join(core, 'live2dcubismcore.min.js')
  await mkdir(core)
  const display = path.join(core, 'pixi-live2d-display-cubism4.min.js')
  t.after(async () => { await unlink(file); await unlink(display); await rmdir(core); await rmdir(root) })
  const files = createLive2dFiles(root, { displayVendor: path.join(root, 'no-private-vendor.js') })
  // Exercise the actual host projection capability decision, not just status().
  const host = await readFile(new URL('../tavern-plugin/lib/index.js', import.meta.url), 'utf8')
  const decision = host.match(/const live2d = live2dFiles[^\n]+spineRuntimeAvailable\(\)/)?.[0]
  assert.ok(decision)
  const projectAvailable = new (Object.getPrototypeOf(async function () {}).constructor)('live2dFiles', 'spineRuntimeAvailable', decision + '; return live2d')
  const project = () => projectAvailable(files, async () => false)
  assert.equal(await files.hasCore(), false)
  assert.equal(await project(), false)
  await writeFile(file, '// core')
  assert.equal(await files.hasCore(), true)
  assert.equal(await files.available(), false)
  assert.equal(await project(), false, 'Core alone must retain the missing-runtime prompt in public builds')
  assert.deepEqual((await files.coreStatus()).missing, ['display'])
  assert.equal((await files.coreStatus()).displayDownloadUrl, 'https://registry.npmjs.org/pixi-live2d-display/-/pixi-live2d-display-0.4.0.tgz')
  await writeFile(display, '// display')
  assert.equal(await files.available(), true)
  assert.equal(await project(), true)
  assert.equal((await files.read('core/live2dcubismcore.min.js')).body.toString(), '// core')
  assert.equal((await files.read('core/live2dcubismcore.min.js')).type, 'text/javascript; charset=utf-8')
  for (const name of ['core/../private.js', '../core/live2dcubismcore.min.js', 'models/200100/model.model3.json', 'other/x.json', 'core/params.txt']) {
    assert.equal(await files.read(name), undefined, name)
  }
  const routes = [], disposers = []
  const webServer = { server: new EventEmitter(), register(route) { routes.push(route); return () => {} } }
  registerTavernHttpRoutes({
    ctx: { get: name => name === 'webServer' ? webServer : name === 'connection' ? {requestRejection:() => undefined} : undefined, effect: fn => disposers.push(fn()) },
    live2dFiles: files, LIVE2D_ROUTE_PREFIX, fontLibrary: { serve: async () => false },
    runtimeReadiness: Promise.resolve({ ok: true }), performanceDiagnostics: { http() {} }
  })
  t.after(() => disposers.forEach(dispose => dispose?.()))
  const route = routes.find(item => item.path === '/api/dsh-tavern')
  async function get(name, origin = 'http://localhost') {
    const response = { writeHead(status, headers) { this.status = status; this.headers = headers }, end(body) { this.body = body } }
    await route.handler({ method: 'GET', url: LIVE2D_ROUTE_PREFIX + name, headers: { host: 'localhost', origin } }, response)
    return response
  }
  const served = await get('core/live2dcubismcore.min.js')
  assert.equal(served.status, 200)
  assert.equal(served.body.toString(), '// core')
  assert.equal(served.headers['Content-Type'], 'text/javascript; charset=utf-8')
  assert.equal(served.headers['X-Content-Type-Options'], 'nosniff')
  assert.equal((await get('core/missing.js')).status, 404)
  assert.equal((await get('core/live2dcubismcore.min.js', 'https://untrusted.example')).status, 403)
  // private fork: consent cannot be posted from an opaque card frame or another local origin.
  for (const origin of ['null', 'https://untrusted.example', 'http://localhost:1234']) {
    const response = { writeHead(status) { this.status = status }, end() {} }
    await route.handler({ method: 'POST', url: '/api/dsh-tavern/installLive2dCore', headers: { host: 'localhost', origin } }, response)
    assert.equal(response.status, 403)
  }
})
