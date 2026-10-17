import assert from 'node:assert/strict'
import test from 'node:test'
import { createSceneImageNativeRuntime } from './fixtures/scene-image-native-runtime.mjs'

test('native JSONL idle release unloads Agent and Session, then restores history under the same ID', { skip: !process.env.DSH_BOOT_MODULE, timeout: 30000 }, async t => {
  let time = 0
  const runtime = await createSceneImageNativeRuntime(process.env.DSH_BOOT_MODULE, { residentOptions: { now: () => time, residentIdleMs: 1000 } })
  t.after(() => runtime.dispose())
  const run = text => runtime.runBackground({ sessionId: 'scene-parent', task: 'candidate', persistent: true,
    selection: { provider: 'scene-fixture', model: 'fixture-text' },
    messages: [{ role: 'user', content: [{ type: 'text', text }] }], tools: [] })
  const first = await run('历史标记：空闲释放之前')
  assert.deepEqual(runtime.backgroundLoaded(first.traceSessionId), { agent: true, session: true })
  time = 1000
  await runtime.reapBackground()
  assert.deepEqual(runtime.backgroundLoaded(first.traceSessionId), { agent: false, session: false })
  const second = await run('恢复后的新任务')
  assert.equal(second.traceSessionId, first.traceSessionId)
  assert.match(JSON.stringify(runtime.requests.at(-1).messages), /历史标记：空闲释放之前/)
  assert.match(JSON.stringify(runtime.requests.at(-1).messages), /恢复后的新任务/)
})

test('native stalled model times out, releases the queue and retries on a new session', {skip:!process.env.DSH_BOOT_MODULE,timeout:30000}, async t=>{
  let release, first=true
  const gate=new Promise(resolve=>{release=resolve})
  const runtime=await createSceneImageNativeRuntime(process.env.DSH_BOOT_MODULE,{
    residentOptions:{modelIdleTimeoutMs:500},
    beforeModelRequest:async()=>{if(first){first=false;await gate}}
  })
  t.after(async()=>{release();await runtime.dispose()})
  const input={sessionId:'scene-parent',task:'candidate',persistent:true,selection:{provider:'scene-fixture',model:'fixture-text'},messages:[],tools:[]}
  let failedId
  await assert.rejects(runtime.runBackground(input),error=>{failedId=error.traceSessionId;return /没有有效输出/.test(error.message)})
  release()
  await new Promise(resolve=>setTimeout(resolve,50))
  await runtime.restart()
  const result=await runtime.runBackground({...input,persistentSessionId:failedId})
  assert.notEqual(result.traceSessionId,failedId)
  assert.ok(result.text)
  const children=await runtime.backgroundChildren()
  assert.ok(children.some(child=>child.id===result.traceSessionId))
  assert.equal(children.some(child=>child.id===failedId),false)
})
