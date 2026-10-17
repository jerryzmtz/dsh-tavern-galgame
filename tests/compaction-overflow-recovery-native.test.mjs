import test from 'node:test'
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { createInitializationNative } from './fixtures/conversation-initialization-native.mjs'
import { installCompactionRequestProjection } from '../tavern-plugin/lib/domain/compaction-request.js'
import { sessionEvents } from '../tavern-plugin/lib/domain/session-events.js'
const native = { skip: !process.env.DSH_BOOT_MODULE, timeout: 30000 }

for (const mode of ['history', 'single-message', 'failed-chunk', 'cancelled-chunk', 'truncated-chunk', 'tokenizer-drift', 'optimistic-drift']) {
  test(`32K native overflow recovery: ${mode}`, native, async t => {
    const window = 32768, calls = []
    let enforce = false, fault = mode
    const controller = new AbortController()
    const h = await createInitializationNative(process.env.DSH_BOOT_MODULE, { contextWindow: window,
      async *modelStream(request) {
        const text = JSON.stringify(request.messages)
        const tokens = Math.ceil(text.length / (mode.endsWith('-drift') ? 1 : 4)) + (request.maxTokens || 0)
        if (request.purpose === 'compaction') {
          calls.push({ tokens, text, rejected: enforce && tokens > window })
          if (enforce && tokens > window) {
            const error = Error(`maximum context length ${window}; requested ${tokens}`)
            error.code = 'CONTEXT_WINDOW_EXCEEDED'
            throw error
          }
          if (calls.length === 2) {
            if (fault === 'failed-chunk') { fault = ''; throw Error('injected second chunk failure') }
            if (fault === 'cancelled-chunk') { fault = ''; controller.abort(); request.signal.throwIfAborted() }
          }
        }
        const markers = [...new Set(text.match(/STORY_FACT_\d+/g) || [])]
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'block-end', index: 0, block: { type: 'text', text: request.purpose === 'compaction' ? markers.join(' ') + '\n' + '摘要保留人物关系。'.repeat(500) : '正文已记录。' } }
        const truncated = request.purpose === 'compaction' && calls.length === 2 && fault === 'truncated-chunk'
        if (truncated) fault = ''
        yield { type: 'finish', reason: { kind: truncated ? 'length' : 'stop' } }
      }
    })
    t.after(() => h.dispose())
    installCompactionRequestProjection(h.ctx, async () => true)
    const { BasicCompactionEngine } = await import(new URL('../../dsh-compaction-basic/lib/index.js', pathToFileURL(process.env.DSH_BOOT_MODULE)))
    // Existing history may come from an earlier larger route or a broken migration.
    // Populate real Session turns before imposing the simulated 32K provider limit.
    for (let i = 0; i < (mode === 'single-message' ? 1 : 6); i++) {
      h.target.agent.followup({ id: `oversized-${i}`, role: 'user', content: [{ type: 'text', text: `STORY_FACT_${i} ` + 'long established story fact '.repeat(mode === 'single-message' ? 8400 : mode === 'optimistic-drift' ? 300 : 1400) }], source: { kind: 'human' } })
      await h.target.agent.whenIdle()
    }
    const agent = h.target.agent, before = [...agent.session.surface.nodes]
    const beforeSize = JSON.stringify(agent.session.deriveMessages()).length
    enforce = true
    const engine = new BasicCompactionEngine(h.ctx, { auto: false, maxTokens: 4096 })
    if (mode.endsWith('-chunk')) {
      await assert.rejects(() => engine.compactNow(agent, controller.signal))
      assert.deepEqual(agent.session.surface.nodes, before, 'partial summaries never replace original surface')
      assert.equal(sessionEvents(agent.session).some(event => event.type === 'compaction/summary'), false)
    }
    try { await engine.compactNow(agent, new AbortController().signal) }
    catch (error) { t.diagnostic(JSON.stringify({ cause: error.cause?.message, calls: calls.map(({ tokens, rejected }) => ({ tokens, rejected })) })); throw error }
    assert.ok(calls.length > 1, 'oversized input must be summarized in bounded segments')
    assert.ok(calls.filter(call => !call.rejected).every(call => call.tokens <= window), 'every accepted request fits the provider window')
    if (!mode.endsWith('-drift')) assert.ok(calls.every(call => !call.rejected), 'known tokenizer must not overflow')
    else assert.ok(calls.some(call => call.rejected), 'exercise adaptive retry after provider rejects the estimate')
    const events = sessionEvents(agent.session)
    const summary = events.findLast(event => event.type === 'compaction/summary')
    for (let i = 0; i < (mode === 'single-message' ? 1 : 5); i++) assert.ok(JSON.stringify(summary.data.summary).includes(`STORY_FACT_${i}`), `fact ${i} survives`)
    assert.ok(JSON.stringify(agent.session.deriveMessages()).length < beforeSize / 2, 'effective context shrinks even when one oversized message becomes one summary')
    assert.ok(events.some(event => JSON.stringify(event.data).includes('long established story fact')), 'raw history is retained')
    t.diagnostic(JSON.stringify(calls.map(({ tokens }) => ({ tokens }))))
  })
}
