import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { SettingsProvider } from '@deepseek-ai/dsh-settings'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import * as plugin from '../lib/index.js'
import { PACK_CONTROL_PATH } from '../src/pack-v2/transport.js'
const tick = () => new Promise(resolve => setTimeout(resolve, 30))
class MemorySettings extends SettingsProvider {
  get writable() { return true }
  async load() { return {} }
  async persist(ns, section) { this.saved = {...this.saved, [ns]:structuredClone(section)} }
}
const req = (method, args) => new Request('http://dsh.internal' + PACK_CONTROL_PATH, {method:'POST', headers:{host:'localhost:123', origin:'http://localhost:123', 'content-type':'application/json'}, body:JSON.stringify({method, args})})
test('package root mounts only v2; native settings and Connection can arrive late and detach', async t => {
  const root = await mkdtemp(join(tmpdir(), 'asset-native-')), ctx = new Context(), routes = new Map()
  t.after(async () => { await ctx.fiber.dispose(); await rm(root, {recursive:true, force:true}) })
  const config = {assetRoot:join(root, 'packs')}
  const first = ctx.plugin(plugin, config)
  await tick()
  const service = ctx.get('assetLibrary')
  assert.equal(service.apiVersion, 2)
  assert.equal(service.getPlan, undefined)
  assert.deepEqual(await service.listPacks(), [])
  const {snapshot} = await service.createPack({name:'Decoder wired at root', expectedRevision:null})
  const bytes = Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA', 'base64')
  // private fork: image bytes and their owning asset are installed atomically.
  const hash = createHash('sha256').update(bytes).digest('hex')
  const blob = await service.patchPack({packId:snapshot.manifest.id, expectedRevision:snapshot.revision,
    patch:{blobs:{[hash]:{ext:'webp',mime:'image/webp',size:bytes.length}},assets:[{kind:'backgrounds',id:'decoder',name:'Decoder',enabled:true,recall:{mode:'constant',keywords:[]},directorNote:'',media:hash}]},
    fileUpdates:new Map([[`media/${hash}.webp`,bytes]])})
  assert.equal(blob.status, 'updated', 'package root supplies the trusted structural port')
  const connection = ctx.plugin({name:'test-connection', apply(ctx) { ctx.provide('connection', {fetch:{register(route) { routes.set(route.path, route); return () => routes.delete(route.path) }}}) }})
  await tick(); assert.equal(routes.size, 6)
  const route = routes.get(PACK_CONTROL_PATH)
  const defaults = await (await route.fetch(req('settings'))).json()
  assert.equal(defaults.writable, false)
  assert.equal((await route.fetch(req('saveSettings', {...defaults.values, expectedRevision:defaults.revision}))).status, 503)
  const settingsPlugin = ctx.plugin(MemorySettings)
  await tick()
  // private fork: catalogue configuration now registers alongside pack settings.
  assert.deepEqual(ctx.get('settings').describe().map(item => item.ns), ['asset-library-packs', 'asset-library-catalogues'])
  assert.equal((await route.fetch(req('saveSettings', {...defaults.values, expectedRevision:defaults.revision}))).status, 200)
  for (const method of ['getPlan', 'patchSources', 'listLibraries', 'save']) assert.equal((await route.fetch(req(method))).status, 400)
  await connection.dispose(); await tick(); assert.equal(routes.size, 0)
  assert.equal((await route.fetch(req('capabilities'))).status, 503)
  assert.equal(ctx.get('assetLibrary'), service)
  await settingsPlugin.dispose(); await first.dispose(); await tick()
  assert.equal(ctx.get('assetLibrary'), undefined)
  await assert.rejects(service.listPacks(), {code:'ASSET_UNAVAILABLE'})
  const second = ctx.plugin(plugin, config); await tick()
  assert.equal(ctx.get('assetLibrary').apiVersion, 2)
  assert.notEqual(ctx.get('assetLibrary'), service)
  await second.dispose()
})
test('actual Connection rejects unauthenticated requests before a plugin handler', () => {
  const check = HostConnectionService.prototype.requestRejection
  let authenticated = false
  const connection = {trustedHosts:[], browserAuth:{isAuthenticated:() => authenticated}}
  const request = {headers:{host:'localhost:123', origin:'http://localhost:123', 'sec-fetch-site':'same-origin'}}
  assert.equal(check.call(connection, request), 401)
  authenticated = true
  assert.equal(check.call(connection, request), undefined)
  assert.equal(check.call(connection, {headers:{...request.headers, origin:'https://evil.invalid'}}), 403)
})
