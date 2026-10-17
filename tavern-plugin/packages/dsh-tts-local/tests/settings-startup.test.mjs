// private fork: real Cordis + file settings lifecycle, synthetic config/model and no worker or paid calls.
import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import FileSettingsProvider from '@deepseek-ai/dsh-settings-file'
import { mkdtemp, writeFile, unlink, rmdir } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { createServer } from 'node:net'
import { once } from 'node:events'
import * as local from '../src/index.js'

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return {promise,resolve} }
const tick = () => new Promise(resolve => setImmediate(resolve))

for (const autoStart of [true, false]) test('native settings gate auto-start, persisted autoStart=' + autoStart, async t => {
  const root = await mkdtemp(resolve('.tts-startup-test-'))
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = root
  t.after(() => { if (previousHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previousHome })
  const configPath = join(root,'worker.json'), settingsPath = join(root,'settings.json')
  t.after(async () => { await unlink(settingsPath); await unlink(configPath); await rmdir(root) })
  const port = createServer()
  port.listen(0,'127.0.0.1'); await once(port,'listening')
  const url = 'http://127.0.0.1:' + port.address().port
  await new Promise(resolve => port.close(resolve))
  await writeFile(configPath, JSON.stringify({url,token:'test-only-redacted'}))
  const saved = {providerId:'fixture',installPath:root,pythonExecutable:process.execPath,workerScript:configPath,modelConfigPath:configPath,autoStart}
  await writeFile(settingsPath, JSON.stringify({'tts-local':saved}))
  const started = deferred(), load = deferred(), done = deferred(), spawns = [], calls = []
  class DelayedSettings extends FileSettingsProvider {
    async load() { started.resolve(); await load.promise; return super.load() }
  }
  t.mock.method(globalThis, 'fetch', async (address, init) => {
    assert.ok([url+'/v1/info',url+'/shutdown'].includes(address), 'no model/synthesis request')
    assert.equal(init.headers.Authorization, 'Bearer test-only-redacted')
    calls.push(address)
    return Response.json({protocol:'dsh-tts-reference-v1',state:'ready',voices:[{id:'fake-model-voice'}]})
  })
  const ctx = new Context()
  t.after(async () => { load.resolve(); await ctx.fiber.dispose() })
  ctx.provide('subprocess', {spawn(spec) {
    spawns.push(spec)
    return {done:done.promise,terminate:() => done.resolve(),waitForExit:() => done.promise}
  }})
  const settings = ctx.plugin(DelayedSettings, {path:settingsPath,watch:false})
  // A complete base must not bypass a persisted opt-out while its owner is loading.
  const plugin = ctx.plugin(local, {settings:{...saved,autoStart:true}})
  await started.promise; await tick()
  assert.equal(ctx.get('ttsLocal'), undefined)
  assert.equal(spawns.length, 0)
  assert.equal(calls.length, 0)
  load.resolve(); await settings.await(); await plugin.await()
  const manager = ctx.get('ttsLocal')
  assert.ok(manager)
  if (autoStart) {
    for (let i=0; i<200 && manager.status().state === 'starting'; i++) await new Promise(r => setTimeout(r,5))
    assert.equal(manager.status().state, 'ready')
    assert.equal(manager.status().voiceCount, 1)
    assert.equal(spawns.length, 1)
    assert.equal(spawns[0].cwd, root)
    assert.deepEqual(spawns[0].argv, [process.execPath,'-u',configPath,'--config',configPath])
  } else {
    await tick()
    assert.equal(manager.status().state, 'stopped')
    assert.equal(spawns.length, 0)
    assert.equal(calls.length, 0)
  }
  await ctx.get('settings').update('tts-local', {readinessTimeoutMs:3000})
  await tick()
  assert.equal(spawns.length, autoStart ? 1 : 0, 'settings edits do not reactivate')
})
