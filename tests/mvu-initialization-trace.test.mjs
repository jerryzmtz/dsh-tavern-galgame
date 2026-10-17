import test from 'node:test'
import assert from 'node:assert/strict'

import { createInitializationTrace } from './fixtures/mvu-initialization-trace.mjs'

test('trace preserves pending work, result identity and rejection; keeps no payloads', async () => {
  let time = 0, resolve
  const trace = createInitializationTrace(() => time, 2)
  const value = { secret: 'private card text' }
  const task = trace.wait('write', new Promise(r => { resolve = r }))
  time = 15000
  assert.equal(trace.snapshot().pending[0].durationMs, 15000)
  resolve(value)
  assert.equal(await task, value)
  const error = new Error('private token')
  await assert.rejects(trace.wait('callback', Promise.reject(error)), actual => actual === error)
  await trace.wait('next', 1)
  assert.equal(trace.snapshot().dropped, 1)
  assert.doesNotMatch(JSON.stringify(trace.snapshot()), /private|secret|token/)
})
