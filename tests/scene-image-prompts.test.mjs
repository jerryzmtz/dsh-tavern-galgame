import assert from 'node:assert/strict'
import test from 'node:test'

const files = {
  readSceneImageSystemInstruction: 'scene-image-system',
  readScenePlanInstruction: 'scene-plan',
  readSceneAdjustmentInstruction: 'scene-image-adjustment'
}

test('三份文生图提示词支持面板保存和恢复默认', async () => {
  const { SYSTEM_PROMPT_NAMES, prompt } = await import('../tavern-plugin/lib/prompt-catalog.js')
  const { applyTavernSettingsPatch, resolveSystemPrompt } = await import('../tavern-plugin/lib/domain/tavern-settings.js')
  for (const name of Object.values(files)) {
    assert.ok(SYSTEM_PROMPT_NAMES.includes(name))
    const saved = applyTavernSettingsPatch({}, {systemPrompt:{name,text:'自定义生图要求'}})
    assert.equal(resolveSystemPrompt(saved,name,prompt),'自定义生图要求')
    const reset = applyTavernSettingsPatch(saved,{resetSystemPrompts:[name]})
    assert.equal(resolveSystemPrompt(reset,name,prompt),prompt(name))
  }
})
