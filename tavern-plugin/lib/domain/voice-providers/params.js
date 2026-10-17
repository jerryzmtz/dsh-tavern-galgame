export const PROVIDER_ID = /^[a-z][a-z0-9-]{0,23}$/
export const PROVIDER_KINDS = [
  { kind: 'local-fork', label: '本地模型服务', fields: [{ key: 'url', label: '服务地址', required: true, placeholder: 'http://127.0.0.1:9882' }, { key: 'token', label: 'Token', secret: true, required: true }] },
  { kind: 'gpt-sovits-api', label: 'GPT-SoVITS API', fields: [{ key: 'url', label: '服务地址', required: true, placeholder: 'http://127.0.0.1:9880' }] },
  { kind: 'azure', label: 'Azure 语音', fields: [{ key: 'region', label: '区域', required: true, placeholder: 'eastasia' }, { key: 'key', label: '订阅密钥', secret: true, required: true }] },
  { kind: 'volcengine', label: '火山引擎语音', fields: [{ key: 'appId', label: 'App ID', required: true }, { key: 'resourceId', label: '资源 ID', required: true, placeholder: 'seed-tts-2.0' }, { key: 'accessKey', label: 'Access Key', secret: true, required: true }] }
].map(item => ({ ...item, fields: item.fields.map(field => ({ secret: false, required: false, placeholder: '', ...field })) }))
export function providerKind(kind) { const value = PROVIDER_KINDS.find(item => item.kind === kind); if (!value) throw new Error('语音服务类型无效'); return value }
export function credentialRef(id, field) { return 'DSH_TAVERN_TTS_' + id.toUpperCase().replace(/-/g, '_') + '_' + field.toUpperCase() }
export function providerConfig(kind, input = {}) {
  providerKind(kind)
  if (kind === 'local-fork' || kind === 'gpt-sovits-api') {
    let url
    try { url = new URL(input.url || (kind === 'gpt-sovits-api' ? 'http://127.0.0.1:9880' : '')) } catch { throw new Error('语音服务地址无效') }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('语音服务地址无效')
    return { url: url.href.replace(/\/+$/, '') }
  }
  if (kind === 'azure') { if (!/^[a-z][a-z0-9-]{0,50}$/.test(input.region || '')) throw new Error('Azure 区域无效'); return { region: input.region } }
  const appId = String(input.appId || '').trim(), resourceId = String(input.resourceId || 'seed-tts-2.0').trim()
  if (!/^[\w.-]{1,100}$/.test(appId) || !/^[\w.-]{1,100}$/.test(resourceId)) throw new Error('火山引擎 App ID 或资源 ID 无效')
  return { appId, resourceId }
}
const text = (value, max = 1000) => typeof value === 'string' ? value.trim().slice(0, max) : ''
function number(value, fallback, min, max) {
  const valid = typeof value === 'number' || typeof value === 'string' && /^[+-]?\d+(?:\.\d+)?$/.test(value)
  const n = value === undefined ? fallback : valid ? Number(value) : NaN
  if (!Number.isFinite(n) || n < min || n > max) throw new Error('语音参数超出范围')
  return n
}
export function presetParams(kind, raw = {}, base = {}) {
  providerKind(kind)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('语音参数无效')
  const allowed = kind === 'azure' ? ['voiceName', 'pitch', 'rate'] : kind === 'volcengine' ? ['speaker', 'speechRate'] : kind === 'gpt-sovits-api' ? ['refAudioPath', 'promptText', 'promptLang', 'gptWeights', 'sovitsWeights', 'speedFactor', 'textSplitMethod'] : []
  if (Object.keys(raw).some(key => !allowed.includes(key))) throw new Error('不支持的语音参数')
  const p = { ...base, ...raw }
  if (kind === 'azure') {
    if (!/^[a-z]{2,3}-[A-Za-z0-9-]+(?::[A-Za-z0-9-]+)?Neural$/.test(p.voiceName || '')) throw new Error('Azure 声音名称无效')
    return { voiceName: p.voiceName, pitch: number(p.pitch, 0, -50, 50), rate: number(p.rate, 0, -50, 100) }
  }
  if (kind === 'volcengine') { if (!/^[a-zA-Z0-9_-]{1,180}$/.test(p.speaker || '')) throw new Error('火山引擎声音 ID 无效'); return { speaker: p.speaker, speechRate: number(p.speechRate, 0, -50, 100) } }
  if (kind === 'gpt-sovits-api') {
    if (!text(p.refAudioPath) || !text(p.promptText) || !['zh', 'ja', 'en', 'ko', 'yue', 'all_zh', 'all_ja', 'all_ko', 'all_yue'].includes(p.promptLang)) throw new Error('请填写参考音频路径、原文和语言')
    if (p.textSplitMethod !== undefined && !/^cut[0-5]$/.test(p.textSplitMethod)) throw new Error('文本切分方法无效')
    return { refAudioPath: text(p.refAudioPath), promptText: text(p.promptText), promptLang: p.promptLang, ...(text(p.gptWeights) ? { gptWeights: text(p.gptWeights) } : {}), ...(text(p.sovitsWeights) ? { sovitsWeights: text(p.sovitsWeights) } : {}), speedFactor: number(p.speedFactor, 1, 0.25, 4), textSplitMethod: p.textSplitMethod || 'cut5' }
  }
  return {}
}
export function resolveProvider(voice, providers = []) {
  const hinted = providers.find(p => p.id === voice.providerId)
  if (hinted) return hinted.kind === voice.providerKind ? hinted : undefined
  return providers.find(p => p.kind === voice.providerKind && p.status === 'ready')
}
export function localeLanguage(locale) { const root = String(locale).split('-')[0]; return ['zh', 'ja', 'en'].includes(root) ? root : locale }
