// private fork: each figure registers its own immutable, pack-scoped portable preset.
import { effectiveCardStage } from './card-stage-settings.js'
import { assetPackDigest } from './stage-asset-pack-catalogue.js'
import { figureTtsVoice, assetVoiceBinding } from './figure-voice.js'
const failure = code => Object.assign(new Error(code), {code})

export function createAssetPackSpeech({presentation, getEngine, getTts, getBinding, scope, principal = 'dsh-browser'}) {
  if (!presentation) return null
  const entries = new Map(), pending = new Map(), listeners = new Set()
  let current, offTts, disposed = false, epoch = 0
  const emit = event => { for (const listener of listeners) listener(event) }
  function clear() {
    epoch++; pending.clear()
    for (const entry of entries.values()) { entry.grant.dispose(); entry.source.dispose() }
    entries.clear(); emit({type:'invalidated'})
  }
  // Recheck author data on open; visual-only publications must not abort playing speech.
  const offPresentation = presentation.subscribe(event => {
    if (!event || event.scope?.authority || event.reason === 'bindings-changed' || event.kind === 'revoked' && presentation.extension.assetBindings.boundPackIds.includes(event.scope?.packId)) clear()
    else {
      epoch++; pending.clear(); emit({type:'invalidated'})
      // Revalidate existing grants after author edits, even before the next browser request.
      for (const alias of entries.keys()) queueMicrotask(() => { if (!disposed) void api.open(alias) })
    }
  })
  function tts() {
    if (disposed) throw failure('TTS_UNAVAILABLE')
    const next = getTts()
    if (next !== current) {
      offTts?.(); clear(); current = next
      offTts = current?.apiVersion === 1 ? current.subscribe(event => {
        if (['disposed','providerChanged','providerRemoved','cacheInvalidated'].includes(event.type)) clear()
      }) : undefined
    }
    if (current?.apiVersion !== 1) throw failure('TTS_UNAVAILABLE')
    return current
  }
  async function prepare(alias, service, generation) {
    const extension = presentation.extension
    const stage = effectiveCardStage(extension, getEngine?.()), resolvedName = await presentation.resolveName(alias), ref = resolvedName.ref
    const unbound = () => {
      const old = entries.get(alias)
      if (old) { old.grant.dispose(); old.source.dispose(); entries.delete(alias) }
      return {available:false,diagnostics:['voice-unbound']}
    }
    if (!stage.voice || resolvedName.status !== 'resolved' || !ref) return unbound()
    const resolved = await presentation.resolveFigure(ref), figure = resolved.value
    if (disposed || epoch !== generation || getTts() !== service) throw failure('TTS_STALE')
    if (!figure?.enabled || !figure.voice) return unbound()
    const voice = figureTtsVoice(figure.voice, resolved.voiceSpec, `${ref.packId}:${ref.figureId}`, figure.emotions)
    const declaration = {voice:resolved.voiceSpec,binding:figure.voice}
    const binding = getBinding ? await getBinding(ref, declaration) : await assetVoiceBinding(service, {}, declaration)
    if (!binding) throw failure('SERVICE_REQUIRED')
    // private fork (docs/fork/reading-dictionary.md): readings are the global active preset, applied (and part of the line
    // identity) inside dsh-tts. The empty `readings` keeps every figure's source id — and so its cached audio — unchanged.
    const revision = assetPackDigest({voice,readings:[],binding,id:figure.voice.voice,language:voice.languages[0]})
    const sourceId = `figure:${ref.packId}:${ref.figureId}:${revision}`
    if (disposed || epoch !== generation || getTts() !== service) throw failure('TTS_STALE')
    const previous = entries.get(alias)
    if (previous?.voice.source === sourceId) return previous.public
    if (previous) { previous.grant.dispose(); previous.source.dispose(); entries.delete(alias) }
    const source = service.registerVoiceSource({owner:'dsh-tavern', sourceId, revision, voices:[voice],
      bindings:{voice:binding.serviceId},
      readReference:async hash => presentation.readReference(ref, (await presentation.resolveFigure(ref)).revision, hash)})
    let grant
    try {
      grant = service.grantConsumer({principal, source:sourceId, scope})
      if (disposed || epoch !== generation || getTts() !== service) throw failure('TTS_STALE')
      const entry = {source, grant, voice:{source:sourceId,id:'voice'}, public:{available:true,voice:{source:sourceId,id:'voice'},voiceId:figure.voice.voice,language:voice.languages[0],scope,diagnostics:[]}}
      entries.set(alias,entry)
      return entry.public
    } catch (error) { grant?.dispose(); source.dispose(); throw error }
  }
  const api = {
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    async open(alias) {
      try {
        const service = tts(), generation = epoch
        if (!pending.has(alias)) {
          const promise = prepare(alias,service,generation).catch(error => {
            // private fork: an unavailable replacement must revoke the browser's old scoped ref.
            // A superseded request cannot revoke a newer generation's successful registration.
            if (epoch === generation) {
              const old = entries.get(alias)
              if (old) { old.grant.dispose(); old.source.dispose(); entries.delete(alias) }
            }
            throw error
          })
          pending.set(alias,promise)
          promise.finally(() => { if (pending.get(alias) === promise) pending.delete(alias) }).catch(() => {})
        }
        return structuredClone(await pending.get(alias))
      } catch (error) { return {available:false,diagnostics:[error.code || 'TTS_UNAVAILABLE']} }
    },
    async synthesize(alias, {text,mood = 'default',selectionKey}, {signal} = {}) {
      const selected = await api.open(alias)
      if (!selected.available) throw failure(selected.diagnostics[0])
      const entry = entries.get(alias)
      if (!entry) throw failure('TTS_STALE')
      return tts().synthesize({voice:entry.voice,text,mood,selectionKey,language:selected.language}, {scope,grant:entry.grant.grant,signal})
    },
    refresh:clear,
    dispose() { if (disposed) return; disposed = true; offPresentation(); offTts?.(); clear(); listeners.clear() }
  }
  return api
}
