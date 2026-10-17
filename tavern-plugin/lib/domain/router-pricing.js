// Private fork (docs/fork/ui-design.md): per-token prices from the local 9Router gateway,
// for the cost figure in the composer's session details.
//
// 9Router prices a request as `user override (GET /api/pricing)` ?? `built-in table`
// (getPricingForModel: provider → canonical model → glob pattern). The override layer
// is read live; the built-in table is a vendored snapshot of 9Router's own
// open-sse/providers/pricing.js (refresh: bin/vendor-9router-pricing.cjs). Tavern
// only knows its DSH provider/model ("nienrouter"/"opus"), so the combo name is
// resolved through GET /api/combos to the routed "alias/model" first.
import { getPricingForModel } from '../vendor/9router/pricing.js'
import { readFileSync } from 'node:fs'

const PROVIDER_ALIASES = JSON.parse(readFileSync(new URL('../vendor/9router/provider-aliases.json', import.meta.url), 'utf8')).aliases
const CACHE_MS = 60_000

// private fork: USD / 1M tokens, verified 2026-10-06:
// https://api-docs.deepseek.com/quick_start/pricing
// Chinese public holidays are intentionally treated as ordinary weekdays.
const DEEPSEEK_PRICES = {
  'deepseek-flash': { peak: { input: 0.30, cached: 0.006, output: 1.20 }, offPeak: { input: 0.15, cached: 0.003, output: 0.60 } },
  'deepseek-v4-pro': { peak: { input: 1.32, cached: 0.044, output: 3.96 }, offPeak: { input: 0.66, cached: 0.022, output: 1.98 } }
}
const DEEPSEEK_MODEL_ALIASES = { 'deepseek-v4-flash': 'deepseek-flash', 'deepseek-v4-flash-vision-exp': 'deepseek-flash' }

function deepseekPeak(time) {
  const date = new Date(time), day = date.getUTCDay(), hour = date.getUTCHours()
  return day >= 1 && day <= 5 && ((hour >= 1 && hour < 4) || (hour >= 6 && hour < 10))
}

function providerBaseUrl(settings, provider) {
  const items = typeof settings?.describe === 'function' ? settings.describe() : []
  for (const ns of ['llm-pi-ai', 'llm-openai', 'llm-anthropic']) {
    const item = items.find(entry => entry.ns === ns)
    if (!item) continue
    for (const layer of [item.value, item.user, item.base]) {
      const url = layer?.providers?.[provider]?.baseURL
      if (typeof url === 'string' && url !== '') return url
    }
  }
  return ''
}

function rates(pricing) {
  if (!pricing || typeof pricing.input !== 'number' || typeof pricing.output !== 'number') return null
  return {
    input: pricing.input,
    output: pricing.output,
    cacheRead: typeof pricing.cached === 'number' ? pricing.cached : pricing.input,
    cacheWrite: typeof pricing.cache_creation === 'number' ? pricing.cache_creation : pricing.input
  }
}

export function createRouterPricing({ settings, fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  const cache = new Map()
  async function getJson(url) {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(5000), headers: { accept: 'application/json' } })
    if (!response.ok) throw new Error('HTTP ' + response.status)
    return await response.json()
  }
  async function gateway(origin) {
    const hit = cache.get(origin)
    if (hit && hit.expires > now()) return hit.value
    const [pricing, combos] = await Promise.all([getJson(origin + '/api/pricing'), getJson(origin + '/api/combos').catch(() => ({ combos: [] }))])
    const value = { pricing: pricing && typeof pricing === 'object' ? pricing : {}, combos: Array.isArray(combos?.combos) ? combos.combos : [] }
    cache.set(origin, { value, expires: now() + CACHE_MS })
    return value
  }
  /**
   * @param selection - the session's DSH model selection { provider, model }.
   * @returns a quote with per-1M-token rates, or { available: false, reason }.
   */
  async function quote(selection) {
    if (!selection || !selection.provider || !selection.model) return { available: false, reason: '当前会话没有模型选择' }
    if (selection.provider === 'deepseek-official' || selection.provider === 'llm-deepseek') {
      const model = DEEPSEEK_MODEL_ALIASES[selection.model] || selection.model
      const price = Object.hasOwn(DEEPSEEK_PRICES, model) ? DEEPSEEK_PRICES[model] : null
      if (!price) return { available: false, reason: 'DeepSeek 官方价格表没有 ' + selection.model + ' 的价格' }
      const peak = deepseekPeak(now())
      return {
        available: true,
        source: 'deepseek-official',
        gateway: 'https://api.deepseek.com',
        selection: { provider: selection.provider, model: selection.model },
        routedModel: model,
        combo: null,
        period: peak ? 'peak' : 'off-peak',
        rates: rates(peak ? price.peak : price.offPeak)
      }
    }
    const baseURL = providerBaseUrl(settings, selection.provider)
    let origin = ''
    try { origin = baseURL ? new URL(baseURL).origin : '' } catch { origin = '' }
    if (!origin) return { available: false, reason: '找不到提供方 ' + selection.provider + ' 的地址' }
    let data
    try { data = await gateway(origin) } catch (error) { return { available: false, reason: '无法从 9Router 读取价格（' + (error?.message || error) + '）' } }
    const combo = data.combos.find(entry => entry && entry.name === selection.model)
    const routed = combo && Array.isArray(combo.models) && typeof combo.models[0] === 'string' ? combo.models[0] : selection.model
    const slash = routed.indexOf('/')
    const alias = slash > 0 ? routed.slice(0, slash) : ''
    const model = slash > 0 ? routed.slice(slash + 1) : routed
    const providerId = PROVIDER_ALIASES[alias] || alias
    const override = providerId ? data.pricing?.[providerId]?.[model] : undefined
    const resolved = rates(override) || rates(getPricingForModel(providerId, model))
    if (!resolved) return { available: false, reason: '9Router 没有 ' + routed + ' 的价格', routedModel: routed }
    return {
      available: true,
      source: override ? '9router-override' : '9router-default',
      gateway: origin,
      selection: { provider: selection.provider, model: selection.model },
      routedModel: routed,
      combo: combo ? { name: combo.name, fallbacks: Math.max(0, combo.models.length - 1) } : null,
      rates: resolved
    }
  }
  return Object.freeze({ quote })
}
