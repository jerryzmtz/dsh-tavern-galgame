import { randomUUID } from 'node:crypto'
import speakers from '../shared/volcengine-speakers.json' with { type: 'json' }
import { pcmWav } from './audio.js'
import { presetMood } from './params.js'
// V3 req_params.audio_params.emotion; support varies by speaker (docs/6561/1257544).
export const VOLCENGINE_MOODS = Object.freeze({}) // private fork: styles belong to voice declarations.
export const volcengineMood = spec => Object.hasOwn(spec.params,'emotion') ? spec.params.emotion : presetMood(VOLCENGINE_MOODS,spec)
export function volcengineError(code, message = '') {
  if (/quota exceeded/i.test(message)) return '火山引擎语音额度已用完'
  if (/grant not found/i.test(message)) return '火山引擎凭据无效，请检查 App ID 和 Access Key'
  if (/Init Engine Instance failed/i.test(message)) return '火山引擎声音与资源 ID 不匹配'
  if (Number(code) === 45000000) return '火山引擎未授权此声音，请开通对应声音权限'
  return '火山引擎语音请求失败（' + String(code).slice(0, 20) + '）'
}
export function parseVolcengine(text) {
  const chunks = []; let ended = false
  for (let line of text.split(/\r?\n/)) {
    line = line.trim(); if (!line || line.startsWith(':') || /^(event|id|retry):/.test(line)) continue
    if (line.startsWith('data:')) line = line.slice(5).trim()
    if (!line) continue
    let chunk
    try { chunk = JSON.parse(line) } catch { throw new Error('火山引擎返回了无效的音频数据') }
    if (chunk.code === 20000000) { ended = true; break }
    if (chunk.code !== 0) throw new Error(volcengineError(chunk.code, chunk.message || chunk.msg))
    if (chunk.data) { if (typeof chunk.data !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(chunk.data)) throw new Error('火山引擎返回了无效的音频数据'); chunks.push(Buffer.from(chunk.data, 'base64')) }
  }
  if (!ended || !chunks.length) throw new Error('火山引擎音频响应不完整')
  return pcmWav(Buffer.concat(chunks))
}
export function createVolcengineAdapter({ fetch: fetchImpl = globalThis.fetch } = {}) {
  return {
    async catalog() { return { items: structuredClone(speakers), manual: true } },
    // private fork (voice settings r3): Volcengine has no free list/auth endpoint, so an explicit 测试连接 synthesizes
    // a single character with the first listed speaker. A speaker-permission refusal still proves the key works.
    async verify(provider, secret, speaker = speakers[0].id) {
      let response
      try { response = await fetchImpl('https://openspeech.bytedance.com/api/v3/tts/unidirectional', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Api-App-Id': provider.config.appId, 'X-Api-Access-Key': secret.accessKey, 'X-Api-Resource-Id': provider.config.resourceId, 'X-Api-Request-Id': randomUUID() }, body: JSON.stringify({ user: { uid: 'dsh-tts' }, req_params: { text: '嗯', speaker, audio_params: { format: 'pcm', sample_rate: 24000 } } }), redirect: 'error', signal: AbortSignal.timeout(15000) }) } catch { throw new Error('火山引擎语音连接失败或请求超时') }
      const unauthorized = message => /未授权此声音|声音与资源 ID 不匹配/.test(message)
      if (!response.ok) {
        const detail = await response.json().catch(() => ({})), message = volcengineError(detail.code || response.status, detail.message || detail.msg || (response.status === 401 || response.status === 403 ? 'grant not found' : ''))
        if (unauthorized(message)) return { status: 'connected', message: '密钥有效；示例声音未开通', synthesisTested: true }
        throw new Error(message)
      }
      try { parseVolcengine(await response.text()) } catch (error) { if (unauthorized(error.message)) return { status: 'connected', message: '密钥有效；示例声音未开通', synthesisTested: true }; throw error }
      return { status: 'connected', synthesisTested: true }
    },
    async probe(provider, secret) {
      // There is no catalog/auth probe API. HEAD checks connectivity without a billed POST;
      // method/body rejection is expected and does not assert speaker authorization.
      let response
      try { response = await fetchImpl('https://openspeech.bytedance.com/api/v3/tts/unidirectional', { method: 'HEAD', headers: { 'X-Api-App-Id': provider.config.appId, 'X-Api-Access-Key': secret.accessKey, 'X-Api-Resource-Id': provider.config.resourceId, 'X-Api-Request-Id': randomUUID() }, redirect: 'error', signal: AbortSignal.timeout(10000) }) } catch { throw new Error('火山引擎语音连接失败或请求超时') }
      if (!response.ok && ![400, 404, 405].includes(response.status)) throw new Error(volcengineError(response.status, response.status === 401 || response.status === 403 ? 'grant not found' : ''))
    },
    async synthesize(provider, secret, spec) {
      const emotion = volcengineMood(spec)
      // private fork: omission enables Chinese/English mixing; explicit_language filters other text.
      // Keep non-Chinese/English selection: some speaker families require it (notably ICL2).
      const additions = ['zh', 'en'].includes(spec.language) ? {} : { explicit_language: spec.language }
      let response
      try { response = await fetchImpl('https://openspeech.bytedance.com/api/v3/tts/unidirectional', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Api-App-Id': provider.config.appId, 'X-Api-Access-Key': secret.accessKey, 'X-Api-Resource-Id': provider.config.resourceId, 'X-Api-Request-Id': randomUUID() }, body: JSON.stringify({ user: { uid: 'dsh-tts' }, req_params: { text: spec.text, speaker: spec.params.speaker, audio_params: { format: 'pcm', sample_rate: 24000, speech_rate: spec.params.speechRate, loudness_rate: 0, ...(emotion ? { emotion, emotion_scale: 1 } : {}) }, additions } }), redirect: 'error', signal: AbortSignal.any([AbortSignal.timeout(45000), ...(spec.signal ? [spec.signal] : [])]) }) } catch { throw new Error('火山引擎语音连接失败或请求超时') }
      if (!response.ok) { const detail = await response.json().catch(() => ({})); throw Object.assign(new Error(volcengineError(detail.code || response.status, detail.message || detail.msg)), {status:response.status}) }
      return parseVolcengine(await response.text())
    }
  }
}
