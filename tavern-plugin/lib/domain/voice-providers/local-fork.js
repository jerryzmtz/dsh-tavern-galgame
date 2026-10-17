export function createLocalForkAdapter({ fetch: fetchImpl = globalThis.fetch } = {}) {
  async function request(provider, secrets, route, body, binary = false) {
    let response
    try { response = await fetchImpl(provider.config.url + route, { method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + secrets.token, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(route === '/synthesize' ? 120000 : 5000), redirect: 'error' }) } catch { throw new Error('本地语音服务未连接或请求超时') }
    if (!response.ok) { const detail = await response.json().catch(() => ({})); throw new Error(String(detail.error || '本地语音请求失败').slice(0, 180)) }
    return binary ? Buffer.from(await response.arrayBuffer()) : response.json()
  }
  return {
    health: (p, s) => request(p, s, '/health'),
    async catalog(p, s) { const h = await request(p, s, '/health'); return { items: h.voices || (h.state === 'ready' ? [{ id: 'homura', label: '晓美焰', state: 'ready', revision: h.version, languages: ['ja', 'zh', 'en'] }] : []), health: h } },
    async synthesize(p, s, spec, key) { const { voice, revision, text, language, mood, params } = spec; await request(p, s, '/synthesize', { key, voice, revision, text, language, mood, ...(params && Object.keys(params).length ? { params } : {}) }); return request(p, s, '/audio/' + key, undefined, true) }
  }
}
