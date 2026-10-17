import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {spawnSync} from 'node:child_process'
const root=fileURLToPath(new URL('../',import.meta.url))

test('read-only history gate rejects empty input and reports absent records instead of passing', async () => {
  const tempRoot=path.join(root,'.tmp')
  await fs.mkdir(tempRoot,{recursive:true})
  const directory=await fs.mkdtemp(path.join(tempRoot,'mod-replay-')),report=path.join(directory,'report.json')
  const run=()=>spawnSync(process.execPath,[path.join(root,'bin/fork-compare-widget-history.mjs'),root,root,directory,report],{cwd:root,encoding:'utf8',timeout:30000})
  try {
    const empty=run()
    assert.equal(empty.status,1,empty.stderr)
    assert.match(empty.stderr,/No copied chat inputs/)
    const file=path.join(directory,'chat-fixture.json'),bytes=JSON.stringify({id:'chat-fixture',messages:[]})
    await fs.writeFile(file,bytes)
    const missing=run()
    assert.equal(missing.status,1,missing.stderr)
    const result=JSON.parse(await fs.readFile(report,'utf8'))
    assert.equal(result.status,'FAIL')
    assert.equal(result.chats[0].latestRecord,'NO_RECORD')
    assert.equal(result.chats[0].records,0)
    assert.match(result.chats[0].failures[0].error,/NO_RECORDS/)
    assert.equal(await fs.readFile(file,'utf8'),bytes)
  } finally {
    await fs.rm(directory,{recursive:true,force:true})
  }
})
