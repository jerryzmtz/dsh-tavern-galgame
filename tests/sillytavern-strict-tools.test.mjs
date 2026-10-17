import test from 'node:test'
import assert from 'node:assert/strict'

import { applySillyTavernStrictTools } from '../tavern-plugin/lib/domain/sillytavern-strict-tools.js'

test('strict_tools 按酒馆语义展开示例名称并保留工具字段', () => {
  const result = applySillyTavernStrictTools([
    { role: 'system', name: 'example_assistant', content: '示例回答' },
    { role: 'system', name: 'example_user', content: '示例提问' },
    { role: 'assistant', name: '旁白', content: '继续' },
    { role: 'tool', content: '工具结果', tool_call_id: 'tool-1' }
  ], { charName: '阿芙拉', userName: '玩家' })

  assert.deepEqual(result.map(function (item) { return [item.role, item.content] }), [
    ['system', '阿芙拉: 示例回答\n\n玩家: 示例提问'],
    ['user', '[Start a new chat]'],
    ['assistant', '旁白: 继续'],
    ['tool', '工具结果']
  ])
  assert.equal(result[3].tool_call_id, 'tool-1')
  assert.equal(result.some(function (item) { return Object.hasOwn(item, 'name') }), false)
})
