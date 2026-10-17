import assert from 'node:assert/strict'
import test from 'node:test'
import { presentModelError } from '../tavern-plugin/lib/domain/model-error-presentation.js'

test('其他验证错误不展开输入对象，普通短错误保留', () => {
  const result = presentModelError(new Error('422: ' + JSON.stringify({ message: 'Validation error: invalid messages [{"value":"PRIVATE"}]' })))
  assert.ok(result.message.length < 200)
  assert.doesNotMatch(result.message, /PRIVATE/)
  const normal = new Error('Connection reset')
  assert.equal(presentModelError(normal), normal)
})
