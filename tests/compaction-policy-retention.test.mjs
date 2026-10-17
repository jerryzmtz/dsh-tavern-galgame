import assert from 'node:assert/strict'
import test from 'node:test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { installCompactionPolicy } from '../tavern-plugin/lib/domain/auto-compaction.js'

test('retained plugin teardown callbacks do not keep released compaction engines alive', async () => {
  await promisify(execFile)(process.execPath, ['--expose-gc', fileURLToPath(new URL('./fixtures/compaction-policy-retention.mjs', import.meta.url))], { timeout: 15000 })
})

test('cancellation while saving the guard cannot start a summary afterwards', async () => {
  const controller = new AbortController()
  let compacted = false
  const engine = { compactIfNeeded() {}, compactRegion() { compacted = true } }
  const dispose = installCompactionPolicy(engine, () => null, { beforeRegion: async () => controller.abort() })
  await assert.rejects(engine.compactRegion(1, 2, {}, controller.signal), { name: 'AbortError' })
  assert.equal(compacted, false); dispose()
})
