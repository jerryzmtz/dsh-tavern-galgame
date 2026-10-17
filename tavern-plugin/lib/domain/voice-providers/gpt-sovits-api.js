export function createGptSovitsAdapter({ fetch: fetchImpl = globalThis.fetch, readings } = {}) {
  const spoken = (text, language) => readings ? readings.apply(text, language) : text
  const queues = new Map(), weights = new Map()
  async function request(provider, route, body) {
    let response
    try { response = await fetchImpl(provider.config.url + route, { method: body ? 'POST' : 'GET', ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}), redirect: 'error', signal: AbortSignal.timeout(body || route.startsWith('/set_') ? 120000 : 10000) }) } catch { throw new Error('GPT-SoVITS API 未连接或请求超时') }
    if (!response.ok) { const detail = await response.json().catch(() => ({})); throw new Error('GPT-SoVITS API：' + String(detail.message || '请求失败').slice(0, 160)) }
    return response
  }
  return {
    async catalog(provider) { await request(provider, '/openapi.json'); return { items: [], manual: true } },
    synthesize(provider, secret, spec) {
      const key = provider.id + ':' + provider.config.url
      const run = (queues.get(key) || Promise.resolve()).then(async () => {
        const p = spec.params, active = weights.get(key) || {}
        for (const [field, route] of [['gptWeights', '/set_gpt_weights'], ['sovitsWeights', '/set_sovits_weights']]) {
          if (p[field] && active[field] !== p[field]) { await request(provider, route + '?weights_path=' + encodeURIComponent(p[field])); active[field] = p[field]; weights.set(key, active) }
        }
        const response = await request(provider, '/tts', { text: spoken(spec.text, spec.language), text_lang: spec.language, ref_audio_path: p.refAudioPath, prompt_text: spoken(p.promptText, p.promptLang), prompt_lang: p.promptLang, media_type: 'wav', streaming_mode: false, speed_factor: p.speedFactor, text_split_method: p.textSplitMethod })
        return Buffer.from(await response.arrayBuffer())
      })
      queues.set(key, run.catch(() => {})); return run
    }
  }
}
