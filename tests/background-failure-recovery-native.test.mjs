import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'
import { createSceneImageNativeRuntime } from './fixtures/scene-image-native-runtime.mjs'
import { installHostSessionPatch } from '../tavern-plugin/lib/domain/host-session-patch.js'
import { installTavernTokenMeter } from '../tavern-plugin/lib/domain/tavern-token-meter.js'

for (const reloadBeforeRetry of [false, true]) test(`first model failure can rewind and recover${reloadBeforeRetry ? ' after reload' : ''}`, {
  skip: !process.env.DSH_BOOT_MODULE, timeout: 30000
}, async t => {
  let unavailable = true
  let host
  const runtime = await createSceneImageNativeRuntime(process.env.DSH_BOOT_MODULE, {
    async setupHost(ctx) {
      host = ctx
      const patch = await installHostSessionPatch({ hostRequire: createRequire(process.env.DSH_BOOT_MODULE),
        persistence: ctx.get('sessionPersistence'), query: ctx.get('sessionQuery') })
      assert.equal(patch.serverReady, true, patch.reason)
      const stopMeter = installTavernTokenMeter(ctx.tokenMeter)
      return () => { stopMeter(); patch.dispose() }
    },
    beforeModelRequest: async () => { if (unavailable) throw new Error('fixture model unavailable') }
  })
  t.after(() => runtime.dispose())
  const input = {
    sessionId: 'scene-parent', task: 'settlement', persistent: true,
    selection: { provider: 'scene-fixture', model: 'fixture-text' },
    backgroundContext: 'FIXED_BACKGROUND_SURVIVES', tools: [],
    messages: [{ role: 'user', content: [{ type: 'text', text: 'FAILED_TASK_MUST_DISAPPEAR' }] }]
  }
  let failedId
  await assert.rejects(runtime.runBackground(input), error => {
    failedId = error.traceSessionId
    return /fixture model unavailable/.test(error.message)
  })
  assert.ok(failedId)
  assert.equal(runtime.traceEvents(failedId).some(event => event.type === 'assistant/message'), false)
  if (reloadBeforeRetry) await runtime.restart()
  unavailable = false
  const recovered = await runtime.runBackground({ ...input, persistentSessionId: failedId, rewindTo: -1,
    messages: [{ role: 'user', content: [{ type: 'text', text: 'RECOVERED_TASK' }] }]
  })
  assert.equal(recovered.traceSessionId, failedId)
  assert.ok(recovered.text)
  assert.doesNotMatch(JSON.stringify(runtime.requests.at(-1)), /FAILED_TASK_MUST_DISAPPEAR/)
  assert.match(JSON.stringify(runtime.requests.at(-1)), /FIXED_BACKGROUND_SURVIVES/)
  const replacement = runtime.traceEvents(failedId).find(event => event.surfaceOp?.op === 'replace' && event.type === 'assistant/message')
  assert.ok(replacement)
  assert.deepEqual(replacement.data.message.content, [])
  assert.ok(replacement.sourceEventSeqs.length)
  assert.ok(host.tokenMeter.measure(host.sessions.get(failedId)).totalTokens >= 0)
  await runtime.restart()
  const next = await runtime.runBackground({ ...input, persistentSessionId: failedId,
    messages: [{ role: 'user', content: [{ type: 'text', text: 'NEXT_TASK' }] }]
  })
  assert.equal(next.traceSessionId, failedId)
  assert.ok(next.text)
  assert.doesNotMatch(JSON.stringify(runtime.requests.at(-1)), /FAILED_TASK_MUST_DISAPPEAR/)
  assert.match(JSON.stringify(runtime.requests.at(-1)), /RECOVERED_TASK/)
  assert.ok(host.tokenMeter.measure(host.sessions.get(failedId)).totalTokens >= 0)
})
