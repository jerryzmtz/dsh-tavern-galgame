// private fork: official DeepSeek pricing, without a gateway or credentials.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRouterPricing } from '../tavern-plugin/lib/domain/router-pricing.js'

const selection = { provider: 'deepseek-official', model: 'deepseek-flash' }
function pricing(time) {
  return createRouterPricing({ now: () => Date.parse(time), fetchImpl: async () => { assert.fail('official pricing must not fetch a gateway') } })
}

test('official Flash and Pro return normalized per-million USD rates', async () => {
  const service = pricing('2026-10-06T02:00:00Z')
  const flash = await service.quote(selection)
  assert.equal(flash.available, true)
  assert.equal(flash.source, 'deepseek-official')
  assert.equal(flash.period, 'peak')
  assert.equal(flash.combo, null)
  assert.deepEqual(flash.selection, selection)
  assert.deepEqual(flash.rates, { input: 0.3, output: 1.2, cacheRead: 0.006, cacheWrite: 0.3 })
  const pro = await service.quote({ provider: 'llm-deepseek', model: 'deepseek-v4-pro' })
  assert.deepEqual(pro.rates, { input: 1.32, output: 3.96, cacheRead: 0.044, cacheWrite: 1.32 })
  const offPro = await pricing('2026-10-10T02:00:00Z').quote({ ...selection, model: 'deepseek-v4-pro' })
  assert.deepEqual(offPro.rates, { input: 0.66, output: 1.98, cacheRead: 0.022, cacheWrite: 0.66 })
})

test('official documented retired Flash aliases resolve, unknown models do not guess', async () => {
  const service = pricing('2026-10-06T02:00:00Z')
  for (const model of ['deepseek-v4-flash', 'deepseek-v4-flash-vision-exp']) {
    const quote = await service.quote({ ...selection, model })
    assert.equal(quote.routedModel, 'deepseek-flash')
    assert.equal(quote.rates.input, 0.3)
  }
  for (const model of ['deepseek-pro', 'unknown', 'toString']) {
    assert.equal((await service.quote({ ...selection, model })).available, false)
  }
})

test('UTC peak boundaries are start-inclusive, end-exclusive; weekends are half price', async () => {
  for (const [time, peak] of [
    ['2026-10-05T00:59:59Z', false], ['2026-10-05T01:00:00Z', true],
    ['2026-10-05T03:59:59Z', true], ['2026-10-05T04:00:00Z', false],
    ['2026-10-05T05:59:59Z', false], ['2026-10-05T06:00:00Z', true],
    ['2026-10-05T09:59:59Z', true], ['2026-10-05T10:00:00Z', false],
    ['2026-10-09T02:00:00Z', true], ['2026-10-10T02:00:00Z', false],
    ['2026-10-11T07:00:00Z', false], ['2026-10-05T09:00:00+08:00', true]
  ]) {
    const quote = await pricing(time).quote(selection)
    assert.equal(quote.period, peak ? 'peak' : 'off-peak', time)
    assert.deepEqual(quote.rates, peak
      ? { input: 0.3, output: 1.2, cacheRead: 0.006, cacheWrite: 0.3 }
      : { input: 0.15, output: 0.6, cacheRead: 0.003, cacheWrite: 0.15 }, time)
  }
})

test('official rates are recalculated rather than retained across time bands', async () => {
  let time = Date.parse('2026-10-05T03:59:59Z')
  const service = createRouterPricing({ now: () => time })
  assert.equal((await service.quote(selection)).period, 'peak')
  time += 1000
  assert.equal((await service.quote(selection)).period, 'off-peak')
})

test('the cost tile shows values only: no source, model, period or explanation prose', async () => {
  const { readFile } = await import('node:fs/promises')
  const source = await readFile(new URL('../tavern-plugin/packages/dsh-tavern-ui/src/fork-composer-metrics.js', import.meta.url), 'utf8')
  const tile = source.slice(source.indexOf('{ id: "cost"'), source.indexOf('{ id: "total"'))
  assert.ok(tile.includes('T.rateInput') && tile.includes('"USD"'))
  assert.doesNotMatch(tile, /explanation|costRoute|costRateSource|quote\.source|quote\.period|routedModel|官方|高峰/)
  assert.doesNotMatch(source, /costHelp|costOfficialHelp|单价来源|计价模型|高峰|非高峰/)
})
