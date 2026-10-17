// private fork: session cost prices from the local 9Router gateway (docs/fork/ui-design.md).
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRouterPricing } from '../tavern-plugin/lib/domain/router-pricing.js'

const settings = { describe: () => [{ ns: 'llm-pi-ai', value: { providers: { nienrouter: { baseURL: 'http://127.0.0.1:20129/v1' } } } }] }
function fakeFetch(pricing, combos, calls = []) {
  return async url => {
    calls.push(url)
    const body = url.endsWith('/api/pricing') ? pricing : { combos }
    return { ok: true, status: 200, json: async () => body }
  }
}

test('combo 解析到路由模型，按 9Router 内置表回退到 claude-opus-* 价格', async () => {
  const calls = []
  const pricing = createRouterPricing({ settings, fetchImpl: fakeFetch({}, [{ name: 'opus', models: ['cc/claude-opus-5-5'] }], calls) })
  const quote = await pricing.quote({ provider: 'nienrouter', model: 'opus' })
  assert.equal(quote.available, true)
  assert.equal(quote.routedModel, 'cc/claude-opus-5-5')
  assert.equal(quote.source, '9router-default')
  assert.deepEqual(quote.rates, { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 })
  assert.ok(calls.every(url => url.startsWith('http://127.0.0.1:20129/api/')))
})

test('9Router 自定义价格优先（按 provider id，别名 cc → claude）', async () => {
  const overrides = { claude: { 'claude-opus-5-5': { input: 4, output: 20, cached: 0.2, cache_creation: 8 } } }
  const pricing = createRouterPricing({ settings, fetchImpl: fakeFetch(overrides, [{ name: 'opus', models: ['cc/claude-opus-5-5'] }]) })
  const quote = await pricing.quote({ provider: 'nienrouter', model: 'opus' })
  assert.equal(quote.source, '9router-override')
  assert.deepEqual(quote.rates, { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 8 })
})

test('网关不可用或提供方没有地址时给出原因而不是 0', async () => {
  const down = createRouterPricing({ settings, fetchImpl: async () => { throw new Error('ECONNREFUSED') } })
  const quote = await down.quote({ provider: 'nienrouter', model: 'opus' })
  assert.equal(quote.available, false)
  assert.match(quote.reason, /ECONNREFUSED/)
  const missing = await down.quote({ provider: 'other', model: 'x' })
  assert.equal(missing.available, false)
})
