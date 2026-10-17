import {tmpdir as publicTmpdir} from 'node:os';
import {join as publicJoin} from 'node:path';
import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { SettingsProvider } from '@deepseek-ai/dsh-settings'
import * as ttsPlugin from '../src/index.js'
import * as localPlugin from '../../dsh-tts-local/src/index.js'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import { registerRoutes } from '../src/routes.js'
import { createCache } from '../src/cache.js'
import { pcmWav } from '../src/providers/audio.js'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
const tick=() => new Promise(r => setTimeout(r,20))
class MemorySettings extends SettingsProvider {
  get writable() { return true }
  async load() { return {} }
  async persist(ns,section) { this.saved={...this.saved,[ns]:structuredClone(section)} }
}
test('real Cordis mounts independent services, settings and authenticated routes; unload removes them',async () => {
  const ctx=new Context(), routes=new Map();let spawns=0
  ctx.plugin({name:'fixtures',apply(ctx) {ctx.provide('subprocess',{spawn(){spawns++;throw Error('must not start')}});ctx.provide('connection',{fetch:{register(route){routes.set(route.path,route);return () => routes.delete(route.path)}}})}})
  ctx.plugin(MemorySettings)
  const a=ctx.plugin(ttsPlugin,{profileId:'test'}),b=ctx.plugin(localPlugin,{profileId:'test'})
  await tick()
  assert.equal(ctx.get('tts')?.apiVersion,1);assert.equal(ctx.get('ttsLocal')?.apiVersion,1)
  assert.equal(spawns,0);assert.equal(routes.size,6)
  assert.equal(ctx.get('settings').get('tts').enabled,true)
  assert.equal(ctx.get('settings').get('tts-local').autoStart,false) // Opt-in startup; missing installation stays asleep.
  assert.deepEqual(ctx.get('settings').describe().map(s => s.ns).sort(),['tts','tts-local'])
  await ctx.get('settings').update('tts-local',{autoStart:true});assert.equal(spawns,0)
  await ctx.get('settings').update('tts',{enabled:false});await tick()
  assert.equal(ctx.get('tts'),undefined);assert.equal(ctx.get('ttsLocal').status().state,'stopped');assert.equal(spawns,0)
  assert.equal(ctx.get('settings').get('tts-local').autoStart,true)
  await ctx.get('settings').update('tts',{enabled:true});await tick()
  await b.dispose();await tick();assert.equal(ctx.get('ttsLocal'),undefined);assert.equal(ctx.get('tts')?.apiVersion,1)
  await a.dispose();await tick();assert.equal(routes.size,0);assert.equal(ctx.get('settings').describe().length,0)
  await ctx.fiber.dispose()
})
test('runtime Connection authentication delegates to browser auth and origin/host fence',() => {
  const proto=HostConnectionService.prototype
  let allowed=false
  const connection={trustedHosts:[],browserAuth:{isAuthenticated:() => allowed}}
  const request={headers:{host:'localhost:123',origin:'http://localhost:123','sec-fetch-site':'same-origin'}}
  assert.equal(proto.requestRejection.call(connection,request),401)
  allowed=true;assert.equal(proto.requestRejection.call(connection,request),undefined)
  assert.equal(proto.requestRejection.call(connection,{headers:{...request.headers,origin:'https://evil.test'}}),403)
})

// private fork: only L1 requires resolved native settings before activation.
test('L2 boots without settings, credentials, web or L1; L1 waits for subprocess and settings',async () => {
  const ctx=new Context(), a=ctx.plugin(ttsPlugin,{}), b=ctx.plugin(localPlugin,{settings:{autoStart:false}})
  await tick(); assert.equal(ctx.get('tts').apiVersion,1); assert.equal(ctx.get('ttsLocal'),undefined)
  ctx.plugin({name:'fake-subprocess',apply(ctx){ctx.provide('subprocess',{spawn(){throw Error('must remain off')}})}})
  await tick(); assert.equal(ctx.get('ttsLocal'),undefined)
  ctx.plugin(MemorySettings)
  await tick(); assert.equal(ctx.get('ttsLocal').status().state,'stopped')
  await a.dispose(); assert.equal(ctx.get('ttsLocal').apiVersion,1)
  await b.dispose(); await ctx.fiber.dispose()
})
test('activation reads saved native auto-start once; invalid paths fail before spawning',async () => {
  class SavedSettings extends MemorySettings { async load() {return {'tts-local':{autoStart:true}}} }
  const ctx=new Context();ctx.plugin({name:'fake-subprocess',apply(ctx){ctx.provide('subprocess',{spawn(){throw Error('invalid install must not spawn')}})}});ctx.plugin(SavedSettings)
  const local=ctx.plugin(localPlugin,{dataDir:'C:/unused-test-data'});await tick()
  assert.equal(ctx.get('ttsLocal').status().state,'error');assert.equal(ctx.get('ttsLocal').status().error,'INVALID_PATH')
  await local.dispose();await ctx.fiber.dispose()
})
test('native enabled setting withdraws and restores service; management and live stream remain available',async () => {
  const ctx = new Context(), routes = new Map()
  ctx.plugin({name:'connection-fixture',apply(ctx) {ctx.provide('connection',{fetch:{register(route) {routes.set(route.path,route);return () => routes.delete(route.path)}}})}})
  ctx.plugin(MemorySettings)
  const plugin = ctx.plugin(ttsPlugin)
  await tick()
  const control = async (method,args) => routes.get('/api/dsh-tts/v1/control').fetch(new Request('http://localhost/api/dsh-tts/v1/control',{method:'POST',headers:{'Content-Type':'application/json',Origin:'http://localhost'},body:JSON.stringify({method,args})}))
  const stream = routes.get('/api/dsh-tts/v1/enabled')
  assert.equal((await stream.fetch(new Request('http://localhost/api/dsh-tts/v1/enabled'))).status,403)
  const response = await stream.fetch(new Request('http://localhost/api/dsh-tts/v1/enabled',{headers:{Origin:'http://localhost'}}))
  const reader = response.body.getReader(), read = async () => new TextDecoder().decode((await reader.read()).value)
  assert.match(await read(),/"enabled":true/)
  const old = ctx.get('tts')
  assert.deepEqual(await (await control('getEnabled')).json(),{enabled:true})
  assert.equal((await control('setEnabled',{enabled:'false'})).status,400)
  assert.deepEqual(await (await control('setEnabled',{enabled:false})).json(),{enabled:false})
  assert.equal(ctx.get('tts'),undefined)
  assert.match(await read(),/"enabled":false/)
  await assert.rejects(old.synthesize({},{}),{code:'TTS_DISABLED'})
  assert.equal((await control('services')).status,200)
  assert.equal((await control('cache')).status,200)
  await reader.cancel()
  for (let i = 0; i < 3; i++) {
    await control('setEnabled',{enabled:true}); assert.equal(ctx.get('tts')?.apiVersion,1)
    await ctx.get('settings').update('tts',{enabled:false}); await tick(); assert.equal(ctx.get('tts'),undefined)
  }
  const pendingStream = await stream.fetch(new Request('http://localhost/api/dsh-tts/v1/enabled',{headers:{Origin:'http://localhost'}}))
  const pendingReader = pendingStream.body.getReader();await pendingReader.read()
  await plugin.dispose(); await tick(); assert.equal(routes.size,0)
  assert.equal((await pendingReader.read()).done,true)
  await ctx.fiber.dispose()
})

test('saved enabled=false never exposes consumer service after activation',async () => {
  class DisabledSettings extends MemorySettings { async load() {return {tts:{enabled:false}}} }
  const ctx = new Context(); ctx.plugin(DisabledSettings); const plugin = ctx.plugin(ttsPlugin)
  await tick(); assert.equal(ctx.get('settings').get('tts').enabled,false); assert.equal(ctx.get('tts'),undefined)
  await ctx.get('settings').update('tts',{enabled:true}); await tick(); assert.equal(ctx.get('tts').apiVersion,1)
  await plugin.dispose(); await ctx.fiber.dispose()
})


test('native preset controls persist descriptors and expose imported ids through the host catalogue',async () => {
  const ctx = new Context(), routes = new Map()
  ctx.plugin({name:'preset-connection',apply(ctx) {ctx.provide('connection',{fetch:{register(route) {routes.set(route.path,route);return () => routes.delete(route.path)}}})}})
  ctx.plugin(MemorySettings);const plugin = ctx.plugin(ttsPlugin);await tick()
  const control = async (method,args) => {
    const response = await routes.get('/api/dsh-tts/v1/control').fetch(new Request('http://localhost/api/dsh-tts/v1/control',{method:'POST',headers:{'Content-Type':'application/json',Origin:'http://localhost'},body:JSON.stringify({method,args})}))
    assert.equal(response.status,200);return response.json()
  }
  try {
    const preset = {schemaVersion:1,id:'work/voice',label:'Voice',kind:'azure',enabled:true,languages:['en'],params:{voiceName:'en-US-AshleyNeural',pitch:25,rate:8}}
    const entry = await control('saveVoicePreset',{preset,expectedRevision:null})
    assert.deepEqual(await control('voicePresets'),[entry])
    assert.deepEqual(ctx.get('settings').get('tts').voices,[preset])
    assert.ok((await ctx.get('tts').listServiceVoices()).some(v => v.id === preset.id))
    assert.deepEqual(await control('importVoicePresets',{presets:[preset]}),{added:[],unchanged:[preset.id],conflicts:[]})
    assert.deepEqual(await control('importVoicePresets',{presets:[{...preset,label:'Different'}]}),{added:[],unchanged:[],conflicts:[preset.id]})
    await control('setEnabled',{enabled:false});await control('setEnabled',{enabled:true})
    assert.ok((await ctx.get('tts').listServiceVoices()).some(v => v.id === preset.id))
    await control('deleteVoicePreset',{id:preset.id,expectedRevision:entry.revision})
    assert.deepEqual(await control('voicePresets'),[])
  } finally {await plugin.dispose();await ctx.fiber.dispose()}
})

test('native cache settings update the active cache and panel control persists only validated limits',async t => {
  const dataDir = await mkdtemp(publicJoin(publicTmpdir(), '.cache-native-'))
  t.after(() => rm(dataDir,{recursive:true,force:true}))
  const key = 'a'.repeat(64), realNow = Date.now()
  const clock = t.mock.method(Date,'now',() => realNow - 2 * 86400000)
  await createCache({dataDir}).put(key,pcmWav(Buffer.alloc(100)),[])
  clock.mock.restore()
  const ctx = new Context(), routes = new Map()
  ctx.plugin({name:'cache-connection',apply(ctx) {ctx.provide('connection',{fetch:{register(route) {routes.set(route.path,route);return () => routes.delete(route.path)}}})}})
  ctx.plugin(MemorySettings); const plugin = ctx.plugin(ttsPlugin,{dataDir}); await tick()
  const control = async args => routes.get('/api/dsh-tts/v1/control').fetch(new Request('http://localhost/api/dsh-tts/v1/control',{method:'POST',headers:{'Content-Type':'application/json',Origin:'http://localhost'},body:JSON.stringify({method:'saveCacheSettings',args})}))
  try {
    assert.equal((await ctx.get('tts').cacheStats()).count,1)
    await ctx.get('settings').update('tts',{cacheMaxAgeDays:1,cacheMaxGB:0.5}); await tick()
    const stats = await ctx.get('tts').cacheStats()
    assert.equal(stats.count,0); assert.equal(stats.maxAgeDays,1); assert.equal(stats.maxBytes,0.5 * 1024 ** 3)
    assert.deepEqual(await readdir(join(dataDir,'cache','audio-v2')),[])
    const response = await control({cacheMaxGB:0.1,cacheMaxAgeDays:7})
    assert.equal(response.status,200)
    assert.equal((await response.json()).maxBytes,0.1 * 1024 ** 3)
    assert.equal(ctx.get('settings').get('tts').cacheMaxAgeDays,7)
    for (const args of [{cacheMaxGB:0,cacheMaxAgeDays:7},{cacheMaxGB:1,cacheMaxAgeDays:0},{cacheMaxGB:'1',cacheMaxAgeDays:30},{cacheMaxGB:1,cacheMaxAgeDays:1.5}]) {
      assert.equal((await control(args)).status,400)
      assert.equal(ctx.get('settings').get('tts').cacheMaxGB,0.1)
    }
    await assert.rejects(ctx.get('settings').update('tts',{cacheMaxGB:101}))
    await assert.rejects(ctx.get('settings').update('tts',{cacheMaxAgeDays:3651}))
  } finally {await plugin.dispose();await ctx.fiber.dispose()}
})

test('saved native cache limits apply when loading existing audio',async t => {
  const dataDir = await mkdtemp(publicJoin(publicTmpdir(), '.cache-saved-'))
  t.after(() => rm(dataDir,{recursive:true,force:true}))
  const realNow = Date.now(), clock = t.mock.method(Date,'now',() => realNow - 2 * 86400000)
  await createCache({dataDir}).put('a'.repeat(64),pcmWav(Buffer.alloc(100)),[])
  clock.mock.restore()
  class SavedSettings extends MemorySettings {async load() {return {tts:{cacheMaxGB:0.2,cacheMaxAgeDays:1}}}}
  const ctx = new Context();ctx.plugin(SavedSettings)
  const plugin = ctx.plugin(ttsPlugin,{dataDir}); await tick()
  try {
    const stats = await ctx.get('tts').cacheStats()
    assert.equal(stats.count,0); assert.equal(stats.maxBytes,0.2 * 1024 ** 3); assert.equal(stats.maxAgeDays,1)
  } finally {await plugin.dispose();await ctx.fiber.dispose()}
})

// private fork: service/preset task-flow control methods (docs/fork/tts-plugins.md "Service and preset flow").
test('control exposes provider kinds, external service status, base voices and key-less probes without network',async () => {
  const ctx = new Context(), routes = new Map()
  ctx.plugin({name:'flow-connection',apply(ctx) {ctx.provide('connection',{fetch:{register(route) {routes.set(route.path,route);return () => routes.delete(route.path)}}})}})
  ctx.plugin(MemorySettings);const plugin = ctx.plugin(ttsPlugin);await tick()
  const raw = (method,args) => routes.get('/api/dsh-tts/v1/control').fetch(new Request('http://localhost/api/dsh-tts/v1/control',{method:'POST',headers:{'Content-Type':'application/json',Origin:'http://localhost'},body:JSON.stringify({method,args})}))
  const control = async (method,args) => { const response = await raw(method,args); assert.equal(response.status,200); return response.json() }
  const fetch = globalThis.fetch; globalThis.fetch = async () => { throw Error('no network in this test') }
  const tts = ctx.get('tts'), voices = [{id:'madoka/madoka',label:'Madoka',engine:'gpt-sovits',revision:'v1',languages:['ja'],state:'ready'},{id:'madoka/homura',label:'Homura',engine:'gpt-sovits',revision:'v1',languages:['ja'],state:'loading'}]
  const offProviders = [
    tts.registerProvider('test',{id:'local-service',kind:'reference',revision:'1',capabilities:{serviceVoiceEngines:['gpt-sovits']},health:async () => ({state:'ready',voices,error:''}),catalog:async () => voices,synthesize:async () => { throw Error('no synthesis') }}),
    tts.registerProvider('test',{id:'gone',kind:'reference',revision:'1',capabilities:{},health:async () => { throw Error('ECONNREFUSED') },catalog:async () => [],synthesize:async () => { throw Error('no synthesis') }}),
  ]
  try {
    const kinds = await control('providerKinds')
    assert.deepEqual(kinds.map(k => k.kind),['qwen','azure','fish-audio','volcengine','openai-compatible','gpt-sovits-api','reference-api']) // private fork: add-flow order
    assert.deepEqual((await control('listModels',{serviceId:'local-service'})).models,[])
    assert.equal((await control('listVoices',{serviceId:'local-service'})).voices.length,2)
    assert.equal(kinds.find(k => k.kind === 'qwen').fields.find(f => f.secret).key,'key')
    const services = await control('services')
    assert.deepEqual(services.running.find(s => s.id === 'local-service').status,{state:'ready',voiceCount:1,voiceTotal:2})
    assert.deepEqual(services.running.find(s => s.id === 'gone').status,{state:'offline'})
    const listed = await control('providerVoices',{serviceId:'local-service'})
    assert.deepEqual(listed.voices.map(v => [v.id,v.engine,v.revision]),[['madoka/madoka','gpt-sovits','v1'],['madoka/homura','gpt-sovits','v1']])
    assert.equal((await raw('providerVoices',{serviceId:'missing'})).status,400)
    assert.equal((await raw('providerVoices',{serviceId:'../x'})).status,400)
    const probe = await control('probeService',{kind:'qwen',config:{region:'cn'}})
    assert.equal(probe.status,'credentials-required'); assert.ok(probe.voices.some(v => v.id === 'Bella' && v.label === '萌宝'))
    assert.equal((await control('probeService',{kind:'azure',config:{region:'Bad Region'}})).status,'invalid')
  } finally { globalThis.fetch = fetch; for (const off of offProviders) off(); await plugin.dispose(); await ctx.fiber.dispose() }
})
