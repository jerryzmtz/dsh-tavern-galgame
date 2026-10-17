import assert from 'node:assert/strict'
import test from 'node:test'

import { renderTavernHelperVariableMacros } from '../tavern-plugin/lib/domain/tavern-helper-variable-macros.js'

test('酒馆助手消息变量宏按路径读取并过滤内部字段', () => {
  const rendered = renderTavernHelperVariableMacros(
    '体力={{get_message_variable::stat_data.角色.体力[0]}} 数据={{get_message_variable::stat_data}}',
    { message: { stat_data: { $meta: { hidden: true }, 角色: { 体力: [12, '说明'], $cache: 1 } } } }
  )

  assert.equal(rendered.text, '体力=12 数据={"角色":{"体力":[12,"说明"]}}')
  assert.equal(rendered.replacements, 2)
})
