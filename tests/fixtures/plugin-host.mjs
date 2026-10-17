import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'

// Host adapters only: apply(), HTTP dispatch, storage, and projections stay real.
// Call from an isolated child process with its own DSH_HOME.
export async function createPluginHost({ withTools = false, composition } = {}) {
  globalThis.fetch = async () => new Response('/* test asset */', { headers: { 'content-type': 'text/css' } })
  const { apply } = await import('../../tavern-plugin/lib/index.js')
  const routes = new Map(), nativeRoutes = new Map(), events = new Set(), disposers = []
  const services = new Map([
    ['settings', { describe: () => [], installSection(_owner, _key, _schema, entry, hooks) { hooks.setSource(() => entry) } }], ['llm', {}],
    ['tokenMeter', { _foldEvent() {} }], ['skills', { registerProvider() {} }],
    ['agentPresets', { resolvedRoots: [] }], ['agents', new Map()], ['sessions', new Map()],
    ['connection', { trustedHosts: [], browserAuth: { isAuthenticated: req => req.headers.cookie === 'test-cookie' },
      requestRejection(req) { return HostConnectionService.prototype.requestRejection.call(this, req) } }],
    ['webServer', { register(route) { routes.set(route.path, route.handler); return () => routes.delete(route.path) } }]
  ])
  const registeredTools = new Map()
  if (withTools) services.set('tools', {
    register(tool) {
      assert.ok(!registeredTools.has(tool.name), 'duplicate tool: ' + tool.name)
      registeredTools.set(tool.name, tool)
    }
  })
  let disableAssets
  const dispose = async () => { for (const callback of disposers.reverse()) await callback() }
  try {
    if (composition) {
      const { Context } = await import('@deepseek-ai/cordis')
      const ctx = new Context()
      disposers.push(() => ctx.fiber.dispose())
      services.set('connection', { ...services.get('connection'), fetch: { register(route) {
        assert.ok(!nativeRoutes.has(route.path), 'duplicate native route: ' + route.path)
        nativeRoutes.set(route.path, route.fetch)
        return () => nativeRoutes.delete(route.path)
      } } })
      for (const [name, value] of services) ctx.provide(name, value)
      // External host services are adapters; both owners and their optional
      // registration/disposal run in real Cordis, in generated entry order.
      for (const entry of composition.entries.filter(entry => ['dsh-tavern', 'dsh-asset-library'].includes(entry.id))) {
        if (entry.disabled) continue
        const plugin = await import(composition.modules.get(entry.name) || entry.name)
        const fiber = ctx.plugin(plugin, composition.configFor(entry))
        await fiber.await()
        if (entry.id === 'dsh-asset-library') disableAssets = async () => {
          await fiber.dispose()
          assert.equal(ctx.get('assetLibrary'), undefined, 'Cordis removes the optional service')
          services.delete('assetLibrary')
        }
      }
      await new Promise(resolve => setImmediate(resolve))
      for (const name of ['assetLibrary', 'tavernSessionSignals']) {
        if (ctx.get(name)) services.set(name, ctx.get(name))
      }
    } else {
      const ctx = {
        get: name => services.get(name),
        inject(names, callback) { if (names.every(name => services.has(name))) return callback(this) },
        llm: services.get('llm'),
        effect(callback) { const stop = callback(); if (typeof stop === 'function') disposers.push(stop) },
        on: name => events.add(name),
        provide: (name, value) => services.set(name, value)
      }
      await apply(ctx)
      await new Promise(resolve => setImmediate(resolve))
    }
  } catch (error) { await dispose(); throw error }
  return {
    services, events, registeredTools, dispose, nativeRoutes, disableAssets,
    async rpc(method, args = {}, headers = {}) {
      const req = Readable.from([Buffer.from(JSON.stringify(args))])
      Object.assign(req, { method: 'POST', url: '/api/dsh-tavern/' + method, headers: { host: 'localhost:3081', cookie: 'test-cookie', ...headers } })
      let status, body
      await routes.get('/api/dsh-tavern')(req, { writeHead(code) { status = code }, end(value) { body = value } })
      assert.equal(status, 200)
      const result = JSON.parse(body)
      assert.equal(result.ok, true, result.error)
      return result
    }
  }
}
