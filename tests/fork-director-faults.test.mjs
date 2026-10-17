// private fork: AR-002/003 fault injection; no filesystem or model calls.
import test from 'node:test'
import assert from 'node:assert/strict'

import { createStageDirectionStore } from '../tavern-plugin/lib/domain/stage-direction-store.js'

const tick = () => new Promise(resolve => setImmediate(resolve))
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }

test('AR-002 compare-and-publish rechecks after immutable revision write', async () => {
  const gate = deferred(), files = new Map()
  let current = true
  const records = createStageDirectionStore({ readJson: async p => files.get(p), writeJson: async (p, v) => { if (!p.endsWith('index.json')) await gate.promise; files.set(p, v) } })
  const write = records.write('chat', 1, { key: 'old', status: 'done' }, () => current)
  await tick(); current = false; gate.resolve()
  assert.equal(await write, false)
  assert.equal(await records.get('chat', 1), null)
  assert.equal(files.size, 1, 'immutable revision retained, stale pointer not published')
})
