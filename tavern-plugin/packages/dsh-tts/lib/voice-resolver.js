import {hash, fail} from './core.js'

export const POOL_ALGORITHM = 'ref-pool-v1'
export function selectReference(pool, {figureIdentity, voiceId, sourceId, selectionKey, mood}) {
  if (!pool.length) fail('MISSING_REFERENCE')
  const fingerprint = hash(pool)
  const seed = hash([POOL_ALGORITHM,figureIdentity,voiceId,sourceId,selectionKey,mood,fingerprint])
  const index = Number(BigInt('0x'+seed) % BigInt(pool.length))
  return {reference:pool[index],index,fingerprint,algorithm:POOL_ALGORITHM}
}
export function sourceProvider(voice, binding) {
  return binding.source === null ? null : voice.sources[binding.source ?? voice.defaultSource].provider
}
export function chooseService(source, services, defaults = {}) {
  const compatible = services.filter(s => source.provider === 'local' ? s.capabilities?.localEngine === source.engine : s.kind === source.provider)
  const preferred = defaults[source.provider]
  return preferred ? compatible.find(s => s.id === preferred) : compatible.length === 1 ? compatible[0] : undefined
}
// Trusted, already validated pack data. This projection never mutates the binding.
export function resolveVoiceSpec({voice, binding, figureIdentity, mood = 'default', emotions = [], selectionKey, text = '', defaults = {}}) {
  if (binding.source === null) return {effective:null,issues:[]}
  const sourceId = binding.source ?? voice.defaultSource, source = voice.sources[sourceId]
  const selectedEmotion=voice.emotions?.[emotions.find(row=>row.id===mood)?.voiceEmotion];
  const referenceEmotion=selectedEmotion?.referenceEmotion;
  const variantId = binding.emotionVariants?.[mood] ?? binding.variant ?? 'normal'
  const params = {...defaults,...voice.variants?.normal?.tuning?.[sourceId],...voice.variants?.[variantId]?.tuning?.[sourceId],...selectedEmotion?.tuning?.[sourceId]}
  let references, selectedReference
  if (source.kind === 'reference-list') references = source.references
  if (source.kind === 'emotion-references') {
    const pool = referenceEmotion !== undefined && source.emotions[referenceEmotion]?.length ? source.emotions[referenceEmotion] : source.fallback
    if (!pool.length) return {effective:null,issues:[{code:'MISSING_REFERENCE'}]}
    selectedReference = selectReference(pool,{figureIdentity,voiceId:binding.voice,sourceId,selectionKey:selectionKey || hash(['preview',figureIdentity,text.normalize('NFC').trim(),mood]),mood})
    references = [selectedReference.reference]
  }
  const kind = references ? 'reference' : source.provider
  if (source.kind === 'voice-id') params.referenceId = source.voiceId
  if (source.kind === 'preset') {
    params[source.provider === 'azure' ? 'voiceName' : source.provider === 'volcengine' ? 'speaker' : 'voice'] = source.voiceName
    if (source.model) params.model = source.model
  }
  // Emotion variants have already selected a single style/instruction. The adapter must not apply legacy maps again.
  const voiceData = {schemaVersion:1,id:'voice',enabled:true,label:voice.name,kind,languages:[binding.language || voice.language],params,
    ...(source.kind === 'emotion-references' ? {model:source.model} : {}),
    ...(references ? {references:references.map(r => ({sha256:r.media,transcript:r.text,language:r.language}))} : {})}
  return {effective:{sourceId,provider:source.provider,variantId,language:voiceData.languages[0],voice:voiceData},issues:[],
    ...(selectedReference ? {selectedReference} : {})}
}
export function describeVoiceCapabilities(service) {
  return service ? {id:service.id,provider:service.kind,revision:service.revision,...structuredClone(service.capabilities)} : null
}
