import builtin from '../../../shared/azure-voices.json' with { type: 'json' }
import { localeLanguage } from './params.js'
const escape = value => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[ch]))
const moods = { calm: ['calm', 'narration-relaxed', 'neutral'], joy: ['cheerful', 'happy', 'excited'], sad: ['sad', 'depressed'], anger: ['angry'], anxious: ['fearful'], disgust: ['disgruntled'], love: ['affectionate', 'friendly'], shy: ['gentle', 'embarrassed'] }
// Freeze the legacy mapping into portable cards without a cloud catalogue request.
export function azureMoodStyles(voiceName, styles = []) {
  return structuredClone(builtin[voiceName]?.moodStyles || Object.fromEntries(Object.entries(moods).map(([mood, candidates]) => [mood, candidates.find(style => styles.includes(style))]).filter(([, style]) => style)))
}
export function azureSsml(spec) {
  const { voiceName, pitch = 0, rate = 0 } = spec.params
  const styles = spec.styles || [], style = builtin[voiceName] ? builtin[voiceName].moodStyles[spec.mood] : (moods[spec.mood] || []).find(style => styles.includes(style))
  const pct = n => (n >= 0 ? '+' : '') + n + '%'
  let content = '<prosody pitch="' + pct(pitch) + '" rate="' + pct(rate) + '">' + escape(spec.text) + '</prosody>'
  if (style) content = '<mstts:express-as style="' + escape(style) + '" styledegree="1">' + content + '</mstts:express-as>'
  return '<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="' + escape(voiceName.split('-').slice(0, 2).join('-')) + '"><voice name="' + escape(voiceName) + '">' + content + '</voice></speak>'
}
export function createAzureAdapter({ fetch: fetchImpl = globalThis.fetch } = {}) {
  async function request(provider, secret, route, body) {
    let response
    try { response = await fetchImpl('https://' + provider.config.region + '.tts.speech.microsoft.com/cognitiveservices/' + route, { method: body ? 'POST' : 'GET', headers: { 'Ocp-Apim-Subscription-Key': secret.key, 'User-Agent': 'dsh-tavern', ...(body ? { 'Content-Type': 'application/ssml+xml', 'X-Microsoft-OutputFormat': 'riff-24khz-16bit-mono-pcm' } : {}) }, ...(body ? { body } : {}), redirect: 'error', signal: AbortSignal.timeout(45000) }) } catch { throw new Error('Azure 语音连接失败或请求超时') }
    if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? 'Azure 密钥或区域无效' : response.status === 429 ? 'Azure 语音额度不足或请求过于频繁' : 'Azure 语音服务请求失败（' + response.status + '）')
    return response
  }
  return {
    async catalog(provider, secret) { const items = await (await request(provider, secret, 'voices/list')).json(); return { items: items.map(v => { const languages = [...new Set([v.Locale, ...(v.SecondaryLocaleList || [])].filter(Boolean).map(localeLanguage))]; return { id: v.ShortName, label: v.LocalName || v.DisplayName || v.ShortName, languages, gender: v.Gender, styles: v.StyleList || [], ...(languages.some(l => !['zh', 'ja', 'en'].includes(l)) ? { note: '包含当前角色界面尚不支持的语言' } : {}) } }) } },
    async synthesize(provider, secret, spec) { return Buffer.from(await (await request(provider, secret, 'v1', azureSsml(spec))).arrayBuffer()) }
  }
}
