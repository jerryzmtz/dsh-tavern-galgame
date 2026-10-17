import assert from 'node:assert/strict'
import { installCompactionPolicy } from '../../tavern-plugin/lib/domain/auto-compaction.js'

// Reproduce the plugin's long-lived teardown list after releasing an Agent scope.
const disposers = []
function releasedEngine() {
  const engine = { compactIfNeeded() {}, context: { events: new Array(10000).fill('history') } }
  const ref = new WeakRef(engine)
  disposers.push(installCompactionPolicy(engine, async () => null))
  return ref
}
const ref = releasedEngine()
let collected = false
for (let i = 0; i < 30; i++) {
  await new Promise(resolve => setImmediate(resolve))
  global.gc()
  if (!ref.deref()) { collected = true; break }
}
assert.equal(collected, true, 'plugin teardown callbacks must not retain released compaction engines')
for (const dispose of disposers) dispose()
