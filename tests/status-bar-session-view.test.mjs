import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

test('saved status bar placement survives real full, dirty, and cached session RPC projections', async t => {
  const root = await mkdtemp(join(tmpdir(), 'tavern-status-view-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./fixtures/status-bar-session-view.mjs', import.meta.url))], {
    env: { ...process.env, DSH_HOME: root }, encoding: 'utf8', timeout: 20000
  })
  assert.ifError(result.error)
  assert.equal(result.status, 0, result.stderr + result.stdout)
  assert.match(result.stdout, /status bar full\/dirty\/cached RPC projections passed/)
})
