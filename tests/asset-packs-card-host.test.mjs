import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

test('card ZIP roundtrip uses Tavern production authorization, queue, workspace writer and projection notification',async () => {
  const root = await mkdtemp(join(tmpdir(),'asset-card-host-'))
  try {
    const result = spawnSync(process.execPath,[fileURLToPath(new URL('./fixtures/asset-pack-card-host.mjs',import.meta.url))],{env:{...process.env,DSH_HOME:root},encoding:'utf8',timeout:60000})
    assert.ifError(result.error)
    assert.equal(result.status,0,result.stderr + result.stdout)
    assert.match(result.stdout,/production card bundle adapter roundtrip passed/)
  } finally {await rm(root,{recursive:true,force:true})}
})
