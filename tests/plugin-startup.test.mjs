import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

test('production plugin apply initializes an empty profile without declaration-order errors', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tavern-startup-'))
  try {
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('./fixtures/plugin-startup.mjs', import.meta.url))], {
      env: { ...process.env, DSH_HOME: root },
      encoding: 'utf8', timeout: 20000
    })
    assert.ifError(result.error)
    assert.equal(result.status, 0, result.stderr + result.stdout)
    assert.match(result.stdout, /plugin apply completed/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
