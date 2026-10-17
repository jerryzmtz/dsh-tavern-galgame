// Run after opening the smoke page in a real browser. No model calls or live data.
// node tests/fixtures/verify-mvu-initialization.mjs http://127.0.0.1:PORT opening-card-trusted
// Add --expect-slow for mode=opening-slow: verify the pending companion is visible.
import assert from 'node:assert/strict'
const [base, sessionId, mode] = process.argv.slice(2)
assert.ok(base && sessionId, 'Expected smoke URL and session ID')
const rpc = async method => {
  const response = await fetch(new URL('/rpc', base), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method, sessionId }) })
  const result = await response.json()
  assert.ok(response.ok, result.error || method)
  return result
}
const result = await rpc('verify-initialization')
assert.equal(result.pass, true)
assert.equal(result.persisted, true)
assert.equal(result.modelCalls, 0)
assert.ok(Number.isFinite(result.initializationMs))
const rows = await rpc('timings')
assert.ok(rows.length, 'Production initialization timings must reach diagnostic storage')
if (mode === '--expect-slow') {
  assert.ok(result.initializationMs >= 20000)
  assert.ok(rows.some(row => row.diagnostic.timings.entries.some(entry => entry.stage === 'companion-module' && entry.scriptId === 'slow-companion' && entry.pending === 1 && entry.oldestPendingMs >= 10000)), 'Slow companion must be identified while pending')
} else assert.ok(result.initializationMs < 15000, 'Opening exceeded 15-second initialization budget: ' + result.initializationMs)
console.log(JSON.stringify({ ...result, timingRecords: rows.length }))
