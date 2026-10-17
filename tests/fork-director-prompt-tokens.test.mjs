import test from 'node:test'
import assert from 'node:assert/strict'
import { estimateDirectorTokens, lastDirectorProviderUsage } from '../tavern-plugin/lib/domain/stage-director-tokens.js'
test('provider usage is the latest request only, sums disjoint cache buckets, and never invents missing usage', () => {
  const event = usage => ({ type: 'assistant/message', data: { usage } })
  const first = event({ inputTokens: 100, cacheReadTokens: 200, cacheWriteTokens: 30 })
  assert.deepEqual(lastDirectorProviderUsage([first]), { inputTokens: 330, cacheHitTokens: 200 })
  const stream = { type: 'assistant/attempt', data: { stream: [{ type: 'chunk', chunk: { type: 'usage', usage: { inputTokens: 8, cacheReadTokens: 9 } } }] } }
  assert.deepEqual(lastDirectorProviderUsage([first, stream]), { inputTokens: 17, cacheHitTokens: 9 })
  assert.deepEqual(lastDirectorProviderUsage([event({ inputTokens: 0 })]), { inputTokens: 0, cacheHitTokens: 0 })
  assert.equal(lastDirectorProviderUsage([first], 1), undefined)
  assert.equal(lastDirectorProviderUsage([first, event(undefined)]), undefined)
  assert.equal(lastDirectorProviderUsage([event({ inputTokens: -1 })]), undefined)
})

test('production token estimator retains CJK and JSON accounting', () => {
  // private fork: estimator coverage does not require the retired prompt assembler.
  assert.equal(estimateDirectorTokens(''), 0)
  assert.equal(estimateDirectorTokens('魔法少女'), 6)
  assert.equal(estimateDirectorTokens('abcdefgh 123456'), 4)
  assert.equal(estimateDirectorTokens('{"x":1}'), 5)
})
