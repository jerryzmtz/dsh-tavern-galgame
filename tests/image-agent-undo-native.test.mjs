import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'
import { createSceneImageNativeRuntime } from './fixtures/scene-image-native-runtime.mjs'
import { installHostSessionPatch } from '../tavern-plugin/lib/domain/host-session-patch.js'

test('文生图 Agent 撤销最近一轮：同一会话，只移除最后一轮对话', { skip: !process.env.DSH_BOOT_MODULE, timeout: 30000 }, async t => {
  const runtime = await createSceneImageNativeRuntime(process.env.DSH_BOOT_MODULE, {
    async setupHost(ctx) {
      const patch = await installHostSessionPatch({ hostRequire: createRequire(process.env.DSH_BOOT_MODULE),
        persistence: ctx.get('sessionPersistence'), query: ctx.get('sessionQuery') })
      assert.equal(patch.serverReady, true, patch.reason)
      return () => patch.dispose()
    }
  })
  t.after(() => runtime.dispose())
  const input = { sessionId: 'scene-parent', task: 'image', persistent: true,
    selection: { provider: 'scene-fixture', model: 'fixture-text' }, tools: [] }
  const ask = text => ({ messages: [{ role: 'user', content: [{ type: 'text', text }] }] })
  const first = await runtime.runBackground({ ...input, ...ask('FIRST_DRAWING') })
  const second = await runtime.runBackground({ ...input, ...ask('SECOND_DRAWING'), persistentSessionId: first.traceSessionId })
  assert.equal(second.traceSessionId, first.traceSessionId)

  const undone = await runtime.runBackground({ ...input, persistentSessionId: first.traceSessionId, undoLastTask: true, messages: [] })
  assert.deepEqual(undone, { traceSessionId: first.traceSessionId, undone: true })
  const third = await runtime.runBackground({ ...input, ...ask('THIRD_DRAWING'), persistentSessionId: first.traceSessionId })
  assert.equal(third.traceSessionId, first.traceSessionId)
  const request = JSON.stringify(runtime.requests.at(-1))
  assert.match(request, /FIRST_DRAWING/)
  assert.doesNotMatch(request, /SECOND_DRAWING/)
  assert.match(request, /THIRD_DRAWING/)
  // The raw events stay for the trace.
  assert.ok(runtime.traceEvents(first.traceSessionId).some(event => JSON.stringify(event).includes('SECOND_DRAWING')))
})
