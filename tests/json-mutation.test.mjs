import assert from 'node:assert/strict'
import test from 'node:test'

import { applyJsonChangesShared } from '../tavern-plugin/lib/domain/json-mutation.js'

test('set does not traverse the discarded old subtree', () => {
  const input={payload:{get unused(){throw new Error('old subtree traversed')}}}
  assert.deepEqual(applyJsonChangesShared(input,[{op:'set',path:['payload'],value:{new:1}}]),{payload:{new:1}})
})
