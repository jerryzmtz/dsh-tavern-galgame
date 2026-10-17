import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {spawnSync} from 'node:child_process'

for (const enabled of [false, true]) test('installer-generated composition: full Tavern apply with asset plugin ' + (enabled ? 'enabled and runtime disabled' : 'absent'), async () => {
  const root = await mkdtemp(join(tmpdir(), 'asset-composition-'))
  try {
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('./fixtures/asset-composition.mjs', import.meta.url)), ...(enabled ? ['--assets'] : [])], {env:{...process.env, DSH_HOME:root}, encoding:'utf8', timeout:60000})
    assert.ifError(result.error)
    assert.equal(result.status, 0, result.stderr + result.stdout)
    assert.match(result.stdout, /asset composition passed/)
  } finally { await rm(root, {recursive:true, force:true}) }
})
