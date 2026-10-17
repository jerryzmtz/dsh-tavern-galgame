import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {spawnSync} from 'node:child_process'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url)
const {createStageRuntimeState,stageRuntimeIndicators,stageRuntimeErrorText}=require('../tavern-plugin/src/client/fork-stage-runtime.cjs')

test('real dispatcher separates media carrier authority from server-template privilege',async t=>{
  const root=await mkdtemp(join(tmpdir(),'stage-dispatch-'))
  t.after(()=>rm(root,{recursive:true,force:true}))
  const result=spawnSync(process.execPath,[fileURLToPath(new URL('./fixtures/stage-dispatch-host.mjs',import.meta.url))],{
    env:{...process.env,DSH_HOME:root},encoding:'utf8',timeout:60000
  })
  assert.ifError(result.error)
  assert.equal(result.status,0,result.stdout+result.stderr)
  assert.match(result.stdout,/stage dispatcher authority and server template privileges passed/)
})

test('stage status normalizes structured errors, native errors and malformed diagnostics to text',()=>{
  const state=createStageRuntimeState()
  assert.equal(stageRuntimeIndicators(state).error,null)
  for(const error of [{code:'PROJECTION_FAILED',message:'authority is not defined'},new Error('offline'),{code:'OTHER',message:{nested:true}},{}]) {
    state.pending.error=error
    const text=stageRuntimeIndicators(state).error
    assert.equal(typeof text,'string')
    assert.ok(text.length)
    assert.ok(!text.includes('[object Object]'))
  }
  assert.match(stageRuntimeErrorText({code:'PROJECTION_FAILED',message:'authority is not defined'}),/^PROJECTION_FAILED: /)
  assert.equal(stageRuntimeErrorText('offline'),'offline')
})
