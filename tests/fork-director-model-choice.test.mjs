// private fork (stage mode entry, owner 2026-10): 舞台模式 › 导演模型 is 跟随前台 (the default) / a chosen model, stored as
// directorModel: null | {provider, model}. null means the chat model; there is no 跟随后台 (the director no longer depends on
// the host's 后台模型). A stored 'foreground' from before reads the same as null.
import test from 'node:test'
import assert from 'node:assert/strict'
import { defaultAssetEngineSettings, patchAssetEngineSettings, validateAssetEngineSettings } from '../tavern-plugin/lib/domain/asset-engine-settings.js'
import { fixture, answer } from './helpers/stage-director-harness.mjs'

test('directorModel accepts null, foreground and a provider/model; nothing else', () => {
  const defaults = defaultAssetEngineSettings()
  assert.equal(defaults.directorModel, null)
  assert.equal(patchAssetEngineSettings(defaults, {directorModel:'foreground'}).directorModel, 'foreground')
  assert.deepEqual(patchAssetEngineSettings(defaults, {directorModel:{provider:'p', model:'m'}}).directorModel, {provider:'p', model:'m'})
  assert.equal(patchAssetEngineSettings({...defaults, directorModel:'foreground'}, {directorModel:null}).directorModel, null)
  for (const bad of ['background', 'custom', '', {provider:'p'}, {provider:'p', model:'m', key:'x'}])
    assert.throws(() => validateAssetEngineSettings({...defaults, directorModel:bad}), String(JSON.stringify(bad)))
})

for (const [name, directorModel, expected] of [
  ['跟随前台 (null, the default) runs on the chat model, not the background model', null, {provider:'chat-provider', model:'chat-model', reasoningEffort:'high'}],
  ['a stored foreground runs on the chat model', 'foreground', {provider:'chat-provider', model:'chat-model', reasoningEffort:'high'}],
  ['自定义 runs on the chosen model', {provider:'custom-provider', model:'custom-model'}, {provider:'custom-provider', model:'custom-model'}]
]) test('director model: ' + name, async t => {
  const f = await fixture(async request => { await request.onToolCall({name:'stage_update', arguments:answer}) },
    {engineValues:{directorModel}, foreground:async chat => (assert.equal(chat.sessionId, 'session'), {provider:'chat-provider', model:'chat-model', reasoningEffort:'high'})})
  t.after(() => f.dispose())
  await f.director.get(f.read()); await f.director.drain()
  assert.equal(f.calls.length, 1)
  assert.deepEqual(f.calls[0].selection, expected)
})
