import assert from 'node:assert/strict'
import test from 'node:test'

import { renderTavernMacros } from '../tavern-plugin/lib/domain/tavern-macro-engine.js'

test('递归执行命运开场白中转义的延迟状态宏', () => {
  const source = '{{setvar::stage::1}}{{setvar::mode::0}}进入第\\{\\{incvar::stage\\}\\}阶段｜\\{\\{setvar::mode::1\\}\\}自由冒险'
  const result = renderTavernMacros(source, {})

  assert.equal(result.text, '进入第2阶段｜自由冒险')
  assert.deepEqual(result.localVariables, { stage: 2, mode: '1' })
})
