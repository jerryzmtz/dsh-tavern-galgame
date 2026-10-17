import {importFigureVariants} from '../../tavern-plugin/packages/dsh-asset-library/src/pack-v2/import-figure-variants.js' // private fork
// private fork: include source literally, without String.replace replacement-token expansion.
// private fork (voice v4 P1): an in-page fake of every backend the figure voice page talks to — asset-library v2 carrier
// (pack voice CAS, variants, templates, blobs), Tavern RPC (editor status, services, preview with billing confirm) and TTS
// control (recommended / Fish lookup + search / online catalogues) — following docs/fork/voice-contract.md (P1 RPC).
// Writes are validated with the real shared voice schema. Nothing leaves the page: no live data, no real TTS.
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { browserReactScript } from '../fixtures/browser-react.mjs'
import { forkThemeCss } from './fork-theme-css.mjs'
import { stageSource, THEMES } from '../harness/card-centric-stage.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const client = file => readFile(path.join(root, 'tavern-plugin/src/client', file), 'utf8')
export { THEMES }
export const FIGURE_MOODS = importFigureVariants({}, {f:{outfits:[{}]}},{}).figures.f.emotions.map(({ id, label, color }) => ({ id, label, color }))

// Production client sources (asset views + shared help tip) and the real voice schema, as one page script.
export async function voicePageScript() {
  let { source, picker, playback } = await stageSource()
  source = await client('fork-settings-ui.js') + '\n' + source.split('// @include fork-asset-pack-cg-ui.js').join(await client('fork-asset-pack-cg-ui.js'))
  const schema = (await readFile(path.join(root, 'tavern-plugin/packages/dsh-presentation-protocol/src/voice-schema.js'), 'utf8')).replace(/^export /gm, '')
  return await browserReactScript() + ';window.React=modules.react;window.ReactDOM={...modules["react-dom"],...modules["react-dom/client"]};' + playback + source + picker +
    '\nwindow.voiceSchema=(function(){' + schema + ';return {validateVoiceSpec,validateVoiceBinding,validateVoiceLibrary};})();'
}
export const voiceThemeCss = forkThemeCss

// Runs in the page (page.evaluate(installVoiceFake, options)). `options.world` picks a scenario seed.
export function installVoiceFake({ moods, world = {} }) {
  const h = React.createElement, clone = v => v === undefined ? undefined : JSON.parse(JSON.stringify(v)), fail = (code, extra) => { throw Object.assign(new Error(code), { code, ...extra }) }
  const art = (hue, { w = 600, h: H = 1200 } = {}) => {
    const c = document.createElement('canvas'); c.width = w; c.height = H; const g = c.getContext('2d'), skin = '#f3d7c6', hair = `hsl(${hue} 55% 42%)`, cloth = `hsl(${hue + 180} 35% 45%)`
    g.fillStyle = hair; g.beginPath(); g.ellipse(w / 2, H * .17, w * .2, H * .13, 0, 0, Math.PI * 2); g.fill(); g.fillRect(w * .3, H * .17, w * .4, H * .2)
    g.fillStyle = skin; g.beginPath(); g.ellipse(w / 2, H * .19, w * .14, H * .085, 0, 0, Math.PI * 2); g.fill()
    g.fillStyle = '#2b2b33'; g.fillRect(w * .44, H * .19, w * .025, H * .012); g.fillRect(w * .535, H * .19, w * .025, H * .012)
    g.fillStyle = cloth; g.beginPath(); g.moveTo(w * .32, H * .3); g.lineTo(w * .68, H * .3); g.lineTo(w * .78, H * .98); g.lineTo(w * .22, H * .98); g.closePath(); g.fill()
    g.fillStyle = skin; g.fillRect(w * .46, H * .27, w * .08, H * .04)
    return c.toDataURL('image/png')
  }
  // A real (silent) PCM16 WAV so the client's signature check and <audio> metadata both work.
  const wav = seconds => { const rate = 8000, n = Math.round(rate * seconds), b = new ArrayBuffer(44 + n * 2), v = new DataView(b), s = (o, t) => [...t].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)))
    s(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); s(8, 'WAVE'); s(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); s(36, 'data'); v.setUint32(40, n * 2, true); return new Uint8Array(b) }
  window.makeWav = wav
  const media = new Map(); let blobs = 0, rev = 0, voices = 0, tokens = 0, jobs = 0, scopes = 0
  const putMedia = (bytes, mime) => { const hash = (++blobs).toString(16).padStart(64, 'a'); media.set(hash, URL.createObjectURL(new Blob([bytes], { type: mime }))); return hash }
  const PACK = '5a5a5a5a-0000-4000-8000-000000000001'
  const figureIds = { aoi: 'f1f1f1f1-0000-4000-8000-000000000001', rin: 'f1f1f1f1-0000-4000-8000-000000000002', mei: 'f1f1f1f1-0000-4000-8000-000000000003', sora: 'f1f1f1f1-0000-4000-8000-000000000004' }
  const sprites = {}, figures = {}, blobTable = {}
  const clip = (seconds, text, language = 'ja') => { const bytes = wav(seconds), hash = putMedia(bytes, 'audio/wav'); blobTable[hash] = { ext: 'wav', mime: 'audio/wav', size: bytes.length }; return { media: hash, text, language } }
  const addFigure = (key, name, hue, color) => { const id = figureIds[key], sk = 's-' + key, src = 'assets/default.png'
    sprites[sk] = { version: 2, kind: 'layered-static-sprites', character: { id: 'figure', name }, closedBehavior: 'restore-base', defaultState: 'default', states: [{ id: 'default', stage: { src, width: 600, height: 1200 } }],
      // private fork (figure select): the outfit declares its 差分 (the editor lists exactly these), one picture for all.
      emotions: Object.fromEntries(moods.map(m => [m.id, { stage: { src, width: 600, height: 1200 } }])) }
    const hash = (++blobs).toString(16).padStart(64, 'c'); media.set(hash, art(hue))
    figures[id] = { schemaVersion: 1, id, name, enabled: true, heightCm: 152, imageColor: color, appearance: 'sprite', recall: { mode: 'keyword', keywords: [] }, emotions:moods, outfits: [{ key: 'default', label: '制服', enabled: true, emotions:['calm',...moods.map(row=>row.id).filter(id=>id!=='calm')], recall: { mode: 'keyword', keywords: [] }, sprite: { manifestKey: sk, assets: { [src]: hash } } }] } }
  addFigure('aoi', '朝雾葵', 330, '#E0609A'); addFigure('rin', '雨宫凛', 210, '#4A86E0'); addFigure('mei', '芽衣', 140, '#2FAE9A'); addFigure('sora', '空', 30, '#E0932A')
  const library = { version: 1, voices: {} }
  const seed = world.voices || 'shared'
  if (seed !== 'empty') {
    library.voices.actor = { name: '温柔少女', language: 'ja', defaultSource: 'fish', sources: { fish: { kind: 'voice-id', provider: 'fish-audio', voiceId: '0a1b2c3d4e5f60718293a4b5c6d7e8f9' } },
      variants: { normal: { name: '原声' }, quick: { name: '轻快', tuning: { fish: { speed: 1.15 } } } } }
    library.voices.heroine = { name: '凛的声线', language: 'ja', defaultSource: 'fish', fallbackSources: ['fish'], sources: {
      fish: { kind: 'reference-list', provider: 'fish-audio', references: [clip(4.2, 'おはよう。今日も一緒に帰ろうね。'), clip(6.5, 'そんなの、わたしだって分かってるよ。'), clip(3.1, 'ありがとう、助かった。')] },
      local: { kind: 'emotion-references', provider: 'local', engine: 'gpt-sovits', model: { engine: 'gpt-sovits', modelVersion: 'v2ProPlus', gpt: { sha256: '1'.repeat(64) }, sovits: { sha256: '2'.repeat(64) } }, selection: 'stable-random',
        fallback: [clip(5, '普通に話すとこんな感じ。')], emotions: { joy: [clip(3.5, 'やったー！'), clip(2.8, '嬉しいな。')], sad: [clip(4, 'ごめんね……')] } } },
      variants: { normal: { name: '原声' } } }
    library.voices.cast = { name: '店员（Azure）', language: 'en', defaultSource: 'azure', sources: { azure: { kind: 'preset', provider: 'azure', voiceName: 'en-US-AshleyNeural' } },
      variants: { joyful: { name: '开心', tuning: { azure: { rate: 15, pitch: 5 } } }, soft: { name: '低缓', tuning: { azure: { rate: -15 } } } } }
    figures[figureIds.aoi].voice = { voice: 'actor' }
    figures[figureIds.rin].voice = { voice: 'heroine', ...(world.rinSource ? { source: world.rinSource } : {}) }
    figures[figureIds.sora].voice = { voice: 'cast', emotionVariants: { joy: 'joyful' } }
    if (world.meiHeroine) figures[figureIds.mei].voice = { voice: 'heroine', source: 'local' }
  }
  const pack = { manifest: { id: PACK, name: '星见学园', assets: [], figures: Object.values(figureIds), voiceLibrary: library, blobs: blobTable }, figures, sprites, revision: 'r0' }
  window.voicePack = () => pack
  window.voiceIds = { pack: PACK, ...figureIds }
  const services = clone(world.services || [
    { id: 'fish-main', kind: 'fish-audio', revision: 'f1', capabilities: { paid: false } },
    { id: 'qwen-main', kind: 'qwen', revision: 'q1', capabilities: { paid: true } },
    { id: 'azure-main', kind: 'azure', revision: 'a1', capabilities: { paid: true } },
    { id: 'local-gsv', kind: 'reference-api', revision: 'l1', capabilities: { paid: false, localEngine: 'gpt-sovits', referenceLimits: { count: 1, bytes: 8 * 1024 * 1024 },
      modelRequirements: [{ engine: 'gpt-sovits', modelVersion: 'v2ProPlus', gpt: { sha256: '1'.repeat(64) }, sovits: { sha256: '2'.repeat(64) } }] } }])
  const missingKeys = new Set(world.missingKeys || [])
  const recommended = [
    { voiceId: 'b1c2d3e4f5a60718293a4b5c6d7e8f90', name: '晴空少女', languages: ['ja', 'zh'], gender: 'female', toneTags: ['明亮', '元气'], visibility: 'public', licensed: null, licenseNote: '公开声音，使用前请核对作者授权', approval: 'candidate', verification: { status: 'unverified' } },
    { voiceId: 'c2d3e4f5a6b70718293a4b5c6d7e8f91', name: '月下学姐', languages: ['ja'], gender: 'female', toneTags: ['温柔', '沉稳'], visibility: 'public', licensed: true, licenseNote: '作者声明可用', approval: 'candidate', verification: { status: 'passed' } },
    { voiceId: 'd3e4f5a6b7c80718293a4b5c6d7e8f92', name: '少年侦探', languages: ['ja', 'en'], gender: 'male', toneTags: ['清亮', '机敏'], visibility: 'public', licensed: null, licenseNote: '公开声音，使用前请核对作者授权', approval: 'candidate', verification: { status: 'unverified' } },
    { voiceId: 'e4f5a6b7c8d90718293a4b5c6d7e8f93', name: '旁白大叔', languages: ['zh'], gender: 'male', toneTags: ['低沉', '叙事'], visibility: 'public', licensed: true, licenseNote: '作者声明可用', approval: 'candidate', verification: { status: 'failed' } }]
  const publicFish = Array.from({ length: 27 }, (_, i) => ({ voiceId: (0xf000 + i).toString(16).padStart(32, '7'), name: ['猫耳女仆', '冰山会长', '天然呆同学', '傲娇青梅'][i % 4] + ' ' + (i + 1), languages: ['ja'], gender: i % 5 ? 'female' : 'male', toneTags: [['可爱', '软萌'], ['冷静'], ['迷糊'], ['傲娇']][i % 4], visibility: 'public', licensed: null, licenseNote: '公开声音，使用前请核对作者授权' }))
  const online = {
    qwen: { voices: [{ id: 'Cherry', label: '芊悦', languages: ['zh', 'en'], gender: 'female' }, { id: 'Bella', label: '萌宝', languages: ['zh'], gender: 'female' }, { id: 'Ethan', label: '晨煦', languages: ['zh', 'en'], gender: 'male' }, { id: 'Serena', label: '苏瑶', languages: ['zh'], gender: 'female' }],
      models: [{ id: 'qwen3-tts-flash', label: 'qwen3-tts-flash' }, { id: 'qwen3-tts-instruct-flash', label: 'qwen3-tts-instruct-flash' }] },
    azure: { voices: [{ id: 'en-US-AshleyNeural', label: 'Ashley', languages: ['en-US'], gender: 'female', styles: ['cheerful', 'sad'] }, { id: 'ja-JP-NanamiNeural', label: 'Nanami', languages: ['ja-JP'], gender: 'female', styles: ['chat', 'cheerful'] }, { id: 'zh-CN-XiaoxiaoNeural', label: '晓晓', languages: ['zh-CN'], gender: 'female', styles: ['affectionate', 'cheerful', 'sad'] }], models: [] } }
  const templates = clone(world.templates || [])
  const machine = [{ id: 'local/homura', label: '晓美焰', serviceId: 'local-gsv', kind: 'reference', languages: ['ja'], state: 'ready' }]
  const confirmTokens = new Map()
  window.voiceCalls = []
  const log = (method, args) => window.voiceCalls.push([method, clone(args || {})])
  const wait = ms => new Promise(r => setTimeout(r, ms))
  const users = id => Object.values(pack.figures).filter(f => f.voice?.voice === id)
  const cas = expected => { if (expected !== pack.revision) fail('REVISION_CONFLICT') }
  const bump = extra => { pack.revision = 'r' + (++rev); window.dispatchEvent(new Event('voice-fake-change')); return { status: 'updated', snapshot: clone(pack), ...extra } }
  const sourceOf = (spec, binding) => binding.source === null ? null : spec.sources[binding.source ?? spec.defaultSource]
  const service = source => services.find(s => source.provider === 'local' ? s.capabilities?.localEngine === source.engine : s.kind === source.provider)
  const sameModel = (a, b) => ['engine', 'modelVersion'].every(k => a[k] === b[k]) && ['gpt', 'sovits', 'sv', 'lora'].every(k => (a[k]?.sha256 || '') === (b[k]?.sha256 || ''))
  const issuesFor = (spec, binding) => {
    const source = sourceOf(spec, binding); if (!source) return []
    const s = service(source); if (!s) return [{ code: 'SERVICE_REQUIRED' }]
    if (source.provider === 'local') { if (!source.fallback.length && !Object.values(source.emotions).some(p => p.length)) return [{ code: 'MISSING_REFERENCE' }]; if (!s.capabilities.modelRequirements?.some(m => sameModel(m, source.model))) return [{ code: 'MODEL_REQUIRED' }] }
    if (missingKeys.has(s.kind)) return [{ code: 'CREDENTIALS_REQUIRED' }]
    return []
  }
  const svc = {
    apiVersion: 2, capabilities: ['packs', 'figures'], subscribe: () => () => {},
    listPackSummaries: async () => [clone(pack)], getPackSnapshot: async () => clone(pack),
    patchFigure: async ({ expectedRevision, figureId, patch }) => { log('patchFigure', { figureId, patch }); cas(expectedRevision); Object.assign(pack.figures[figureId], clone(patch)); for (const [k, v] of Object.entries(patch)) if (v === null) delete pack.figures[figureId][k]; return bump() },
    patchPack: async ({ expectedRevision, patch }) => { log('patchPack', { patch }); cas(expectedRevision); Object.assign(pack.manifest, clone(patch)); return bump() },
    putBlob: async ({ expectedRevision, bytes, descriptor }) => { log('putBlob', { descriptor }); await wait(30); cas(expectedRevision); const hash = putMedia(bytes, descriptor.mime); blobTable[hash] = clone(descriptor); return bump({ hash, descriptor }) },
    savePackVoice: async ({ expectedRevision, figureId, voiceId, voiceSpec, confirmShared }) => { log('savePackVoice', { figureId, voiceId, voiceSpec, confirmShared }); await wait(40); cas(expectedRevision)
      if (users(voiceId).some(f => f.id !== figureId) && confirmShared !== true) fail('SHARED_VOICE_CONFIRMATION_REQUIRED'); voiceSchema.validateVoiceSpec(voiceSpec); library.voices[voiceId] = clone(voiceSpec); return bump({ affectedFigures: users(voiceId).map(f => ({ id: f.id, name: f.name })) }) },
    saveFigureVoiceBinding: async ({ expectedRevision, figureId, binding }) => { log('saveFigureVoiceBinding', { figureId, binding }); await wait(30); cas(expectedRevision)
      if (binding === null) delete pack.figures[figureId].voice; else { voiceSchema.validateVoiceBinding(binding, library); pack.figures[figureId].voice = clone(binding) } return bump() },
    createAndAssignPackVoice: async ({ expectedRevision, figureId, voiceSpec }) => { log('createAndAssignPackVoice', { figureId, voiceSpec }); await wait(40); cas(expectedRevision)
      voiceSchema.validateVoiceSpec(voiceSpec); const voiceId = 'v-' + (++voices).toString(16).padStart(8, '0') + '-4000-8000-000000000000'; library.voices[voiceId] = clone(voiceSpec); pack.figures[figureId].voice = { voice: voiceId }; return bump({ voiceId }) },
    savePackVoiceVariant: async ({ expectedRevision, figureId, voiceId, variantId, variant, confirmShared }) => { log('savePackVoiceVariant', { figureId, voiceId, variantId, variant, confirmShared }); await wait(30); cas(expectedRevision)
      if (users(voiceId).some(f => f.id !== figureId) && confirmShared !== true) fail('SHARED_VOICE_CONFIRMATION_REQUIRED'); const next = clone(library.voices[voiceId]); next.variants = { ...(next.variants || {}), [variantId]: clone(variant) }; voiceSchema.validateVoiceSpec(next); library.voices[voiceId] = next
      return bump({ affectedFigures: users(voiceId).map(f => ({ id: f.id, name: f.name })) }) },
    deletePackVoiceVariant: async ({ expectedRevision, figureId, voiceId, variantId, confirmShared }) => { log('deletePackVoiceVariant', { figureId, voiceId, variantId, confirmShared }); cas(expectedRevision)
      if (users(voiceId).some(f => f.voice.variant === variantId || Object.values(f.voice.emotionVariants || {}).includes(variantId))) fail('VOICE_VARIANT_IN_USE')
      if (users(voiceId).some(f => f.id !== figureId) && confirmShared !== true) fail('SHARED_VOICE_CONFIRMATION_REQUIRED'); const next = clone(library.voices[voiceId]); delete next.variants[variantId]; if (!Object.keys(next.variants).length) delete next.variants; library.voices[voiceId] = next; return bump() },
    listVoiceTemplates: async () => { log('listVoiceTemplates', {}); await wait(20); return { templates: clone(templates) } },
    saveVoiceTemplate: async ({ templateId, expectedRevision, packRevision, voiceId, binding }) => { log('saveVoiceTemplate', { templateId, expectedRevision, voiceId, binding }); if (packRevision !== pack.revision) fail('REVISION_CONFLICT')
      const t = { templateId: 'tpl-' + (templates.length + 1), revision: 'tr1', name: library.voices[voiceId].name, voiceSpec: clone(library.voices[voiceId]), binding: clone(binding) }; templates.push(t); return clone(t) },
    deleteVoiceTemplate: async ({ templateId, expectedRevision }) => { log('deleteVoiceTemplate', { templateId, expectedRevision }); const i = templates.findIndex(t => t.templateId === templateId); if (i < 0 || templates[i].revision !== expectedRevision) fail('REVISION_CONFLICT'); templates.splice(i, 1); return { deleted: true } },
    assignVoiceTemplate: async ({ templateId, templateRevision, figureId, expectedRevision }) => { log('assignVoiceTemplate', { templateId, templateRevision, figureId }); cas(expectedRevision); const t = templates.find(x => x.templateId === templateId); if (!t || t.revision !== templateRevision) fail('REVISION_CONFLICT')
      const voiceId = 'v-' + (++voices).toString(16).padStart(8, '0') + '-4000-8000-000000000000'; library.voices[voiceId] = clone(t.voiceSpec); pack.figures[figureId].voice = { ...clone(t.binding || {}), voice: voiceId }; return bump({ voiceId }) },
    leaseMedia: async ({ hash }) => ({ ticket: 't-' + hash, url: media.get(hash) }), releaseLease() {}
  }
  const rpc = async (method, a = {}) => {
    log(method, a); await wait(25)
    if (method === 'getFigureVoiceEditor') { const f = pack.figures[a.figureId], spec = f.voice && library.voices[f.voice.voice]; return { packRevision: pack.revision, binding: clone(f.voice || null), voiceLibrary: clone(library), effective: null, issues: spec ? issuesFor(spec, f.voice) : [], recommended: [] } }
    if (method === 'getAssetVoiceServices') return { services: clone(services) }
    if (method === 'listFigureVoiceChoices') return { voices: clone(machine), recommended: [] }
    if (method === 'assignFigureVoice') { cas(a.expectedRevision); const voiceId = 'v-' + (++voices).toString(16).padStart(8, '0') + '-4000-8000-000000000000'
      library.voices[voiceId] = { name: '晓美焰', language: 'ja', defaultSource: 'fish', sources: { fish: { kind: 'reference-list', provider: 'fish-audio', references: [clip(4, 'まどか……')] } } }; pack.figures[a.figureId].voice = { voice: voiceId }; return bump({ voiceId }) }
    if (method === 'previewFigureVoice') {
      if (world.previewDelayMs) await wait(world.previewDelayMs)
      if (a.expectedRevision !== pack.revision) fail('REVISION_CONFLICT')
      const f = pack.figures[a.figureId], spec = a.voiceSpec || library.voices[f.voice?.voice], binding = a.voiceSpec ? (a.binding || { voice: 'preview' }) : f.voice
      if (!spec) fail('VOICE_NOT_FOUND'); if (a.voiceSpec) voiceSchema.validateVoiceSpec(a.voiceSpec)
      const issue = issuesFor(spec, binding)[0]; if (issue) fail(issue.code)
      const s = service(sourceOf(spec, binding))
      if (s.capabilities.paid !== false) {
        const fingerprint = JSON.stringify([a.voiceSpec, a.binding, a.text, a.mood, s.id, pack.revision])
        if (!a.confirmToken) { const token = 'confirm-' + (++tokens); confirmTokens.set(token, fingerprint); return { status: 'confirmation-required', confirmToken: token, expiresAt: Date.now() + 60000, billing: { serviceId: s.id, paid: true } } }
        if (confirmTokens.get(a.confirmToken) !== fingerprint) fail('PREVIEW_CONFIRMATION_REQUIRED'); confirmTokens.delete(a.confirmToken)
      }
      const requestId = 'job-' + (++jobs); window.voiceCalls.push(['synthesis', { requestId, service: s.id, source: sourceOf(spec, binding), variant: binding.variant, text: a.text, mood: a.mood }])
      return { status: 'submitted', scope: 'figure-preview:' + (++scopes), voice: { source: 'figure-preview', id: 'voice' }, language: spec.language, requestId, timeoutMs: 5000 }
    }
    if (method === 'closeFigureVoicePreview') return { closed: true }
    if (method === 'getAssetPackDependencies') return { available: true, count: 1, cards: [] }
    if (method === 'getAssetEngineSettings') return { values: { voiceServices: {} }, revision: 'e1', writable: true }
    throw new Error('mock: ' + method)
  }
  const tts = { apiVersion: 1, available: () => true, subscribe: () => () => {}, audioUrl: ticket => 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=#' + ticket,
    call: async (method, a = {}) => { log('tts.' + method, a); await wait(30)
      if (method === 'listRecommendedFishVoices') return { voices: clone(world.noRecommended ? [] : recommended) }
      if (method === 'validateFishVoice') { const hit = [...recommended, ...publicFish].find(v => v.voiceId === a.voiceId); if (!hit) fail('VOICE_NOT_FOUND'); return clone(hit) }
      if (method === 'searchFishVoices') { const page = a.page || 1, all = publicFish.filter(v => v.name.includes(a.query) || v.toneTags.some(t => a.query.includes(t))), list = all.slice((page - 1) * 20, page * 20); return { voices: clone(list), page, pageSize: 20, total: all.length, hasMore: page * 20 < all.length, windowLimited: false } }
      if (method === 'listOnlinePresetVoices') { const configured = services.some(s => s.kind === a.provider); return { provider: a.provider, ...clone(online[a.provider]), source: configured && !missingKeys.has(a.provider) ? 'live' : 'builtin', status: missingKeys.has(a.provider) ? 'credentials-required' : 'ready' } }
      throw Object.assign(new Error('REQUEST_FAILED'), { code: 'REQUEST_FAILED' }) } }
  window.binding = { service: svc, rpc, tts, previewMedia: async ({ hash }) => ({ url: media.get(hash), release() {} }), globalEnabledPackIds: [], loadSettings: async () => {}, onSettings: () => () => {}, download() {} }
  window.views = createForkAssetPackUI(React, { VoicePicker: ForkBubbleLibraryPicker, AvatarImage: ForkPackImage, HelpTip: ForkHelpTip, emotions: { moods, palette: ['#e0707c', '#2fae9a'], max: 8 } })
  window.root = ReactDOM.createRoot(document.getElementById('panel'))
  window.openFigure = key => window.root.render(h(window.views.PackModal, { key: key + Math.random(), binding: window.binding, packId: PACK, initial: { kind: 'figures', figureId: figureIds[key] }, packs: [clone(pack)], onClose() {} }))
  window.forkForeground = { media: node => node }
  // Synthesis status is the real TTS route; the page's fetch resolves it here (Playwright route in tests/harness).
}

// Playwright wiring shared by the test and the screenshot harness.
export async function openVoicePage(browser, { viewport = { width: 1600, height: 900 }, theme = 'light', world = {}, reducedMotion = 'no-preference', scale = 1 } = {}) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: scale, reducedMotion }), errors = []
  page.on('pageerror', e => errors.push(e.message))
  page.on('console', m => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()) })
  await page.route('http://voice.test/**', async route => {
    const url = new URL(route.request().url())
    if (url.pathname === '/api/dsh-tts/v1/synthesis/status') return route.fulfill({ contentType: 'application/json', body: JSON.stringify(route.request().method() === 'DELETE' ? { cancelled: true } : { state: 'ready', result: { ticket: 'ticket-' + url.searchParams.get('requestId') } }) })
    return route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"></head><body><div id="panel"></div></body></html>' })
  })
  await page.goto('http://voice.test/')
  await page.addStyleTag({ content: await voiceThemeCss() + `html,body{margin:0}body{${THEMES[theme]}background:var(--page);font-family:"Microsoft YaHei UI","PingFang SC",sans-serif}` })
  await page.evaluate(context => { document.body.dataset.fkContext = context }, 'chat-' + theme)
  await page.addScriptTag({ content: await voicePageScript() })
  await page.evaluate(installVoiceFake, { moods: FIGURE_MOODS, world })
  // Audio in headless Chromium: resolve play() at once and end after a short beat (no device needed).
  await page.evaluate(() => { const play = HTMLMediaElement.prototype.play; window.audioPlays = []; HTMLMediaElement.prototype.play = function () { window.audioPlays.push(this.src); setTimeout(() => this.onended?.(), window.audioEndMs ?? 400); return Promise.resolve() }; void play })
  return { page, errors }
}

// UI rules checked on every voice-page state (owner 2026-10): no native pickers (select / colour / radio / range /
// <audio controls>), file inputs only visually hidden behind a dashed ＋ tile, no internal ids / hashes / storage keys
// in visible text, no horizontal overflow. The figure page's own legacy 默认外观 select is outside this page's scope.
export const INTERNAL_TEXT = /[0-9a-f]{8}-[0-9a-f]{4}-|[0-9a-f]{24,}|v-[0-9a-f]{8}|fish-audio|voice-id|reference-list|emotion-references|serviceId|fish-main|qwen-main|azure-main|local-gsv|confirm-\d|figure-preview|job-\d|\bnormal\b|\bquick\b|\bjoyful\b|\bheroine\b|\bactor\b|\bcast\b|Neural\b|undefined|NaN|\[object/
export async function guardVoiceUi(page, tag, errors) {
  const m = await page.evaluate(() => {
    const ui = [...document.querySelectorAll('.ap-ui')], text = ui.map(n => n.innerText).join('\n'), onPage = !!document.querySelector('.ap-voice-page')
    const natives = ui.flatMap(n => [...n.querySelectorAll('select, input[type=color], input[type=radio], input[type=range], input[type=checkbox], audio[controls]')]).filter(el => !(el.matches('select[aria-label="默认外观"]') && !onPage))
    const files = ui.flatMap(n => [...n.querySelectorAll('input[type=file]')]).filter(el => { const st = getComputedStyle(el), r = el.getBoundingClientRect(); return st.display !== 'none' && st.clipPath === 'none' && r.width > 1 && r.height > 1 && st.opacity !== '0' })
    const overflow = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth
    const wide = [...document.querySelectorAll('.ap-voice-page *')].filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.right > innerWidth + 1 }).slice(0, 5).map(el => el.className || el.tagName)
    const adds = [...document.querySelectorAll('.ap-clip-add, .ap-voice-variant-add')].filter(el => el.innerText.trim() !== '' || !getComputedStyle(el).borderStyle.includes('dashed'))
    return { text, natives: natives.map(n => n.outerHTML.slice(0, 80)), files: files.length, overflow, wide, adds: adds.map(el => el.className) }
  })
  if (m.natives.length) errors.push(tag + ': native controls ' + m.natives.join(' | '))
  if (m.files) errors.push(tag + ': ' + m.files + ' visible file input(s)')
  if (m.adds.length) errors.push(tag + ': add tiles must be dashed ＋ without text ' + m.adds.join(','))
  const hit = m.text.match(INTERNAL_TEXT); if (hit) errors.push(tag + ': internal id visible 「' + hit[0] + '」')
  if (m.overflow > 1 || m.wide.length) errors.push(tag + ': horizontal overflow ' + m.overflow + ' ' + m.wide.join(','))
  return m
}
