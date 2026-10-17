import test from 'node:test'
import assert from 'node:assert/strict'
import { openTavernSettings } from './fixtures/tavern-settings-browser.mjs'

function fixture() {
  let fail = false
  let settings = { defaultForegroundModel: null, defaultBackgroundModel: null,
    defaultPlaySettings: { playerName: '你', statusBarPlacement: 'sidebar', backgroundTasks: { variables: true, posture: true }, webSearchEnabled: false, sceneImagesEnabled: false } }
  return {
    setFail(value) { fail = value },
    respond(method, args) {
      if (method === 'getTavernSettings') return { settings, modelCatalog: [{ provider: 'p', models: [{ id: 'm' }] }], releaseCapabilities: { sceneImages: false } }
      if (method === 'getBackgroundModelReasoning') return { reasoning: { efforts: [{ id: 'low', name: 'Low' }] } }
      if (method === 'updateTavernSettings') {
        if (fail) throw Error('保存失败测试')
        const defaults = args.patch.defaultPlaySettings
        settings = { ...settings, ...args.patch, defaultPlaySettings: { ...settings.defaultPlaySettings, ...defaults,
          backgroundTasks: { ...settings.defaultPlaySettings.backgroundTasks, ...defaults?.backgroundTasks } } }
        return { settings }
      }
    }
  }
}

test('registered settings preserves model selection after rejected saves', async t => {
  const backend = fixture()
  const { page, calls } = await openTavernSettings(t, { sceneImages: false, respond: backend.respond })
  const model = page.getByLabel('默认前台模型', { exact: true })
  await page.waitForFunction(() => document.querySelector('[aria-label="默认前台模型"]')?.disabled === false)
  const choice = JSON.stringify({ provider: 'p', model: 'm' })
  await model.selectOption(choice)
  await page.getByText('已保存，下次新游戏生效', { exact: true }).waitFor()
  await page.waitForFunction(() => document.querySelector('[aria-label="默认前台模型推理强度"]')?.disabled === false)
  await page.getByLabel('默认前台模型推理强度', { exact: true }).selectOption('low')
  await page.waitForFunction(() => document.querySelector('[aria-label="默认前台模型"]')?.disabled === false)
  assert.deepEqual(calls.filter(c => c.method === 'updateTavernSettings').at(-1).args.patch.defaultForegroundModel, { provider: 'p', model: 'm', reasoningEffort: 'low' })
  backend.setFail(true)
  await model.selectOption('')
  await page.getByRole('alert').filter({ hasText: '保存失败测试' }).waitFor()
  assert.equal(await model.inputValue(), choice)
  backend.setFail(false)
  await model.selectOption('')
  await page.waitForFunction(() => document.querySelector('[aria-label="默认前台模型"]')?.disabled === false)
  assert.equal(await model.inputValue(), '')
})

test('saving opening defaults preserves sibling values without reloading catalogs', async t => {
  const backend = fixture()
  const { page, calls } = await openTavernSettings(t, { sceneImages: false, respond: backend.respond })
  const toggle = page.getByRole('switch', { name: '联网搜索', exact: true })
  await page.waitForFunction(() => document.querySelector('[aria-label="联网搜索"]')?.disabled === false)
  const reads = Object.fromEntries(["getTavernSettings", "listPresets", "getUserPreferenceProfile"].map(method => [method, calls.filter(c => c.method === method).length]))
  // The controlled switch adopts its value only after the asynchronous save succeeds.
  await toggle.click()
  await page.getByText('已保存，新游戏继承此设置，已有游戏保持不变。', { exact: true }).waitFor()
  assert.equal(await toggle.isChecked(), true)
  assert.equal(await page.getByRole('switch', { name: '变量结算', exact: true }).isChecked(), true)
  for (const method of ['getTavernSettings', 'listPresets', 'getUserPreferenceProfile']) assert.equal(calls.filter(c => c.method === method).length, reads[method], method)
  backend.setFail(true)
  await toggle.click()
  await page.getByText('保存失败：保存失败测试', { exact: true }).waitFor()
  assert.equal(await toggle.isChecked(), true)
})

test('卡片工作台默认模型可单独保存，留空表示跟随前台', async t => {
  const backend = fixture()
  const { page, calls } = await openTavernSettings(t, { sceneImages: false, respond: backend.respond })
  const model = page.getByLabel('卡片工作台默认模型', { exact: true })
  await page.waitForFunction(() => document.querySelector('[aria-label="卡片工作台默认模型"]')?.disabled === false)
  assert.equal(await model.locator('option[value=""]').textContent(), '跟随前台')
  await model.selectOption(JSON.stringify({ provider: 'p', model: 'm' }))
  await page.getByText('已保存，下次新建工作台对话生效', { exact: true }).waitFor()
  assert.deepEqual(calls.filter(c => c.method === 'updateTavernSettings').at(-1).args.patch, { defaultWorkbenchModel: { provider: 'p', model: 'm' } })
})
