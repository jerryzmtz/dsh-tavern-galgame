import test from 'node:test'
import assert from 'node:assert/strict'

import { createOrderedNumericIndex } from '../tavern-plugin/lib/domain/ordered-numeric-index.js'

test('numeric suffix preserves sorted values and only reports discarded entries', () => {
  const index = createOrderedNumericIndex()
  const values = [-Infinity, -2, 0, 1.5, 8, Infinity]
  const all = index.from(values.map(key => [key, { key }]))
  for (let start = 0; start <= values.length; start++) {
    const next = index.suffix(all, start)
    assert.deepEqual(next.map(item => item.key), values.slice(start))
    assert.equal(index.changed(all, next).length, start)
  }
})
