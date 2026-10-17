import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = fileURLToPath(new URL('../', import.meta.url))

for (const args of [['install', '--help'], ['install', '-h'], ['install', '--host', 'cli', '--help']]) {
  test(`installer help exits without installing: ${args.join(' ')}`, () => {
    const result = spawnSync(process.execPath, ['bin/dsh-tavern.mjs', ...args], {
      cwd: root, encoding: 'utf8', timeout: 15000, windowsHide: true,
      env: { ...process.env, DSH_TAVERN_REINSTALL_RUNTIME: '1' },
    })
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /dsh-tavern install \[--host cli\|desktop\|android\]/)
    assert.equal(result.stdout.trim().split('\n').length, 1)
    assert.equal(result.stderr, '')
  })
}

test('textcard runtime loads as explicit ESM without typeless-package warnings', () => {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e',
    "const mod = await import('./fork/mods/textcard/runtime.js'); if (typeof mod.configure !== 'function' || typeof mod.command !== 'function') process.exit(1)"], {
    cwd: root, encoding: 'utf8', timeout: 15000, windowsHide: true,
  })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stderr, '')
})
