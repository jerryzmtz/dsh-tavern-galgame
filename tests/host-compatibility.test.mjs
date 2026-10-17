import test from 'node:test'
import assert from 'node:assert/strict'

import { classifyHostVersion } from '../tavern-plugin/lib/domain/host-compatibility.js'

test('只适配唯一精确版本，其他版本和读取失败均不适配', () => {
  assert.equal(classifyHostVersion('0.1.2-rc.1', '0.1.2-rc.1').status, 'verified')
  assert.equal(classifyHostVersion('0.1.5-rc.1', '0.1.2-rc.1').status, 'incompatible')
  assert.equal(classifyHostVersion('0.2.0', '0.1.2-rc.1').status, 'incompatible')
  assert.equal(classifyHostVersion('', '0.1.2-rc.1').status, 'incompatible')
})
