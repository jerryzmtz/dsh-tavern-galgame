import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveChatBackgroundModel } from '../tavern-plugin/lib/domain/background-model-selection.js'

test('全局切换覆盖老游戏快照与本局选择，后续本局修改可单独生效', async () => {
  const { applyTavernSettingsPatch } = await import('../tavern-plugin/lib/domain/tavern-settings.js')
  const front = { provider: 'front', model: 'current', reasoningEffort: 'low' }
  const old = { backgroundModelSelection: { provider: 'old', model: 'frozen', reasoningEffort: 'high' } }
  let settings = applyTavernSettingsPatch({}, { backgroundModel: { provider: 'new', model: 'worker' } })
  assert.deepEqual(resolveChatBackgroundModel(old, front, settings), { provider: 'new', model: 'worker' })
  assert.deepEqual(resolveChatBackgroundModel({}, front, settings), { provider: 'new', model: 'worker' })
  const local = { backgroundModelSelection: { provider: 'local', model: 'one-game' }, backgroundModelRevision: settings.backgroundModelRevision }
  assert.deepEqual(resolveChatBackgroundModel(local, front, settings), local.backgroundModelSelection)
  settings = applyTavernSettingsPatch(settings, { backgroundModel: { provider: 'new', model: 'worker', reasoningEffort: 'max' } })
  assert.equal(resolveChatBackgroundModel(local, front, settings).reasoningEffort, 'max')
  assert.equal(resolveChatBackgroundModel(old, front, settings).reasoningEffort, 'max')
  settings = applyTavernSettingsPatch(settings, { backgroundModel: null })
  assert.deepEqual(resolveChatBackgroundModel(old, front, settings), front)
  assert.deepEqual(resolveChatBackgroundModel(local, front, settings), front)
  const revision = settings.backgroundModelRevision
  settings = applyTavernSettingsPatch(settings, { webSearchEnabled: true })
  assert.equal(settings.backgroundModelRevision, revision)
  assert.deepEqual(resolveChatBackgroundModel({ ...local, backgroundModelSelection: null, backgroundModelRevision: revision }, front, settings), front)
})
