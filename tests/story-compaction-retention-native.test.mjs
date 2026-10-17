import test from 'node:test'
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { createInitializationNative } from './fixtures/conversation-initialization-native.mjs'
import { sessionEvents } from '../tavern-plugin/lib/domain/session-events.js'
import { installCompactionRequestProjection } from '../tavern-plugin/lib/domain/compaction-request.js'
import { retainRecentStoryRounds } from '../tavern-plugin/lib/domain/story-compaction.js'

const native = { skip: !process.env.DSH_BOOT_MODULE, timeout: 30000 }

test('real DSH: manual story compaction commits the summary with the latest rounds appended verbatim', native, async t => {
  const h = await createInitializationNative(process.env.DSH_BOOT_MODULE, { contextWindow: 32768 })
  t.after(() => h.dispose())
  const { BasicCompactionEngine } = await import(new URL('../../dsh-compaction-basic/lib/index.js', pathToFileURL(process.env.DSH_BOOT_MODULE)))
  const agent = h.target.agent
  for (let i = 1; i <= 5; i++) {
    agent.followup({ id: 'round-' + i, role: 'user', content: [{ type: 'text', text: `第${i}轮行动。` + '旧事。'.repeat(200) }], source: { kind: 'human' } })
    await agent.whenIdle()
  }
  installCompactionRequestProjection(h.ctx, async id => id === agent.session.id, async request => retainRecentStoryRounds(request, 2))
  const summarized = []
  h.ctx.on('llm/stream', (request, next) => {
    if (request.purpose === 'compaction') summarized.push(JSON.stringify(request.messages))
    return next()
  })
  const result = await new BasicCompactionEngine(h.ctx, { auto: false }).compactNow(agent, new AbortController().signal)
  assert.ok(result)
  assert.equal(summarized.length, 1)
  assert.ok(summarized[0].includes('第3轮行动') && !summarized[0].includes('第4轮行动'), 'the summarizer sees only older rounds')
  const checkpoint = sessionEvents(agent.session).findLast(e => e.type === 'user/message' && e.data?.source?.compactionId)
  const text = checkpoint.data.content.map(block => block.text || '').join('\n')
  assert.match(text, /【最近 2 轮原文（未压缩，按时间顺序）】/)
  assert.match(text, /\[玩家\]\n第4轮行动/)
})
