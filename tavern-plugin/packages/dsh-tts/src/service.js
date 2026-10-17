import {referenceAudio} from './reference-audio.js'
import {resolveVoiceSpec, chooseService, describeVoiceCapabilities} from './voice-resolver.js'
import { randomBytes } from 'node:crypto'
import { createReferenceProvider } from './providers/reference-api.js'
import { createCache } from './cache.js'
import { createJobs } from './jobs.js'
import { BUILTIN_PRESETS } from './providers/presets.js'
import { qwenMood } from './providers/qwen.js'
import { azureMood } from './providers/azure.js'
import { volcengineMood } from './providers/volcengine.js'
import { serviceVoiceId, fail, hash, canonical, id, language, lexicon, portableVoice, voicePreset, wav, durationMs, TtsError } from './core.js'
import { compilePronunciations } from './pronunciation.js'

const moodResolvers = { qwen: qwenMood, azure: azureMood, volcengine: volcengineMood }

export function createTts({ profileId = '', dataDir, cache = createCache({ dataDir }), globalReadings = () => [], globalPronunciations = () => [], now = Date.now } = {}) {
  const providers = new Map(), sources = new Map(), grants = new Map(), tickets = new Map(), flights = new Map(), lanes = new Map(), catalogs = new Map(), listeners = new Set(), usage = new Map()
  let disposed = false, enabled = true, epoch = 0, waiters = 0
  const emit = e => { for (const fn of listeners) fn(e) }
  const alive = () => { if (disposed) fail('PLUGIN_UNAVAILABLE') }
  function grantFor(grant, source, scope) {
    alive(); const g = grants.get(grant)
    if (!g || source && g.source !== source || scope && g.scope !== scope) fail('FORBIDDEN')
    return g
  }
  function revoke(source) {
    for (const [grant,g] of grants) if (g.source === source) { g.abort.abort(); grants.delete(grant) }
    for (const [ticket,t] of tickets) if (!grants.has(t.grant)) tickets.delete(ticket)
  }
  function snapshot(input) {
    id(input.sourceId); id(input.owner)
    if (typeof input.revision !== 'string' || !input.revision || !Array.isArray(input.voices) || input.voices.length > 256) fail('INVALID_INPUT')
    const voices = input.voices.map(v => v.kind === 'pack' ? structuredClone(v) : portableVoice(v))
    if (new Set(voices.map(v => v.id)).size !== voices.length) fail('REVISION_CONFLICT')
    // private fork (docs/fork/reading-dictionary.md): readings are global presets only; a source cannot carry its own.
    if (Object.hasOwn(input, 'readings')) fail('UNKNOWN_FIELD')
    const data = structuredClone({ owner: input.owner, sourceId: input.sourceId, revision: input.revision, voices, bindings: input.bindings || {} })
    // private fork: shared sources keep each consumer's live reference reader. Disposing
    // the first card must not strand another card on its revoked presentation lease.
    return { ...data, readers:new Set(), refs: 1,
      readReference(hash) { const reader = [...this.readers].at(-1); if (!reader?.read) fail('MISSING_REFERENCE'); return reader.read(hash) } }
  }
  const sourceDefinition = s => canonical({ owner: s.owner, sourceId: s.sourceId, revision: s.revision, voices: s.voices, bindings: s.bindings })
  function voiceFor(ref) {
    alive(); const source = sources.get(ref?.source), voice = source?.voices.find(v => v.id === ref.id)
    if (!voice) fail('VOICE_NOT_FOUND')
    return { source, voice }
  }
  const api = {
    apiVersion: 1,
    resolveVoiceSpec,
    describeVoiceCapabilities,
    async resolveVoiceService({voice,binding,defaults = {}}) {
      if (binding.source === null) return {effective:null,issues:[]}
      const source = voice.sources[binding.source ?? voice.defaultSource]
      const selected = chooseService(source,await api.listServices(),defaults)
      if (!selected) return {effective:null,issues:[{code:'SERVICE_REQUIRED'}]}
      if (source.provider === 'local') {
        if (!source.fallback.length && !Object.values(source.emotions).some(pool => pool.length)) return {effective:null,issues:[{code:'MISSING_REFERENCE'}]}
        const identity = model => ({engine:model.engine,modelVersion:model.modelVersion,...Object.fromEntries(['gpt','sovits','sv','lora'].filter(k => model[k]).map(k => [k,{sha256:model[k].sha256}]))})
        // Equality check only: compare the canonical identities instead of hashing both sides per candidate.
        const wanted = canonical(identity(source.model))
        if (!selected.capabilities.modelRequirements?.some(model => canonical(identity(model)) === wanted)) return {effective:null,issues:[{code:'MODEL_REQUIRED'}]}
      }
      const provider = providers.get(selected.id).provider
      const health = provider.health ? await provider.health({}) : {state:'ready'}
      if (health.state === 'credentials-required') return {effective:null,issues:[{code:'CREDENTIALS_REQUIRED'}]}
      const validation = provider.validateModel ? await provider.validateModel(source.model, source.voiceName) : {issues:[]}
      return {effective:{serviceId:selected.id,serviceRevision:provider.revision,capabilities:selected.capabilities},issues:validation.issues}
    },
    setEnabled(value) {
      alive(); enabled = value
      if (!enabled) {
        epoch++; tickets.clear(); api.jobs.dispose()
        for (const f of flights.values()) f.abort.abort()
      }
    },
    capabilities: () => ({ scopedVoices: true, referenceInput: ['bytes-v1'] }),
    subscribe(fn) { alive(); listeners.add(fn); return () => listeners.delete(fn) },
    // Lifecycle hooks keep local residency separate from the generic reference protocol.
    registerReferenceProvider(owner, connection) { return api.registerProvider(owner,createReferenceProvider(connection)) },
    registerProvider(owner, provider) {
      alive(); id(owner); id(provider.id)
      if (!provider.revision || typeof provider.synthesize !== 'function') fail('INVALID_INPUT')
      if (providers.has(provider.id)) fail('REVISION_CONFLICT')
      const entry = { owner, provider, abort: new AbortController() }; providers.set(provider.id, entry); emit({ type: 'providerChanged', serviceId: provider.id })
      return () => { if (providers.get(provider.id) !== entry) return; providers.delete(provider.id); entry.abort.abort(); emit({ type: 'providerRemoved', serviceId: provider.id }) }
    },
    registerVoiceSource(input) {
      alive(); let current = snapshot(input), existing = sources.get(current.sourceId)
      // private fork: a shared source must be the same definition; compare canonical JSON only on this path.
      if (existing) { if (sourceDefinition(existing) !== sourceDefinition(current)) fail('REVISION_CONFLICT'); existing.refs++; current = existing }
      else sources.set(current.sourceId, current)
      const reader = {read:input.readReference}; current.readers.add(reader)
      let released = false
      emit({ type: 'voicesChanged', source: current.sourceId })
      return {
        source: current.sourceId,
        replace(next, expectedRevision) {
          alive(); if (released || sources.get(current.sourceId) !== current || expectedRevision !== current.revision) fail('REVISION_CONFLICT')
          const replacement = snapshot(next)
          if (replacement.sourceId !== current.sourceId || replacement.owner !== current.owner || current.refs !== 1) fail('REVISION_CONFLICT')
          reader.read = next.readReference; replacement.readers.add(reader)
          revoke(current.sourceId); sources.set(current.sourceId, replacement); current = replacement; emit({ type: 'voicesChanged', source: current.sourceId })
        },
        dispose() { if (released) return; released = true; current.readers.delete(reader); if (--current.refs) return; sources.delete(current.sourceId); revoke(current.sourceId); emit({ type: 'voicesChanged', source: current.sourceId }) },
      }
    },
    grantConsumer({ principal, source, scope, authorize }) {
      alive(); id(principal); id(scope)
      if (!sources.has(source)) fail('VOICE_NOT_FOUND')
      const grant = Object.freeze({}), g = { principal, source, scope, authorize, keys: new Set(), abort: new AbortController() }; grants.set(grant, g)
      return { grant, dispose() { g.abort.abort(); grants.delete(grant); for (const [t,v] of tickets) if (v.grant === grant) tickets.delete(t) } }
    },
    grantServiceConsumer({ principal, scope }) {
      alive(); id(principal); id(scope)
      const grant = Object.freeze({}), g = { principal, scope, keys:new Set(), serviceVoices:true, abort:new AbortController() }; grants.set(grant,g)
      return { grant, dispose() { g.abort.abort(); grants.delete(grant); for (const [t,v] of tickets) if (v.grant === grant) tickets.delete(t) } }
    },
    async listServiceVoices() {
      alive()
      const lists = await Promise.all([...providers.values()].filter(({provider:p}) => p.capabilities?.catalogue || p.capabilities?.serviceVoiceEngines?.length).map(async ({provider:p}) => {
        let items
        try { items = await p.catalog({}) } catch { return [] }
        alive()
        return items.filter(v => p.capabilities.catalogue ? v.kind === 'reference' : p.capabilities.serviceVoiceEngines.includes(v.engine)).map(v => ({...structuredClone(v),serviceId:p.id}))
      }))
      const presets = await Promise.all((sources.get('voice-presets')?.voices || []).map(async voice => {
        const candidates = [...providers.values()].map(e => e.provider).filter(p => voice.kind === 'service' ? p.capabilities?.serviceVoiceEngines?.includes(voice.engine) : p.kind === voice.kind)
        const provider = candidates.find(p => p.id === voice.providerId) || (candidates.length === 1 ? candidates[0] : undefined)
        let ready = false
        if (voice.kind === 'service') ready = lists.flat().some(v => v.serviceId === provider?.id && v.id === voice.voiceId && v.state === 'ready')
        else if (provider) { try { ready = ['ready','configured'].includes((await provider.health({})).state) } catch {} }
        return {...structuredClone(voice), engine:voice.engine || voice.kind, revision:hash(voice), serviceId:provider?.id,
          state:!voice.enabled ? 'disabled' : !provider ? 'service-required' : ready ? 'ready' : 'offline', preset:true}
      }))
      const items = [...presets, ...lists.flat().filter(v => !presets.some(p => p.id === v.id))]
      // Keep builtin choices searchable when their provider or credentials are absent.
      return [...items, ...structuredClone(BUILTIN_PRESETS).filter(p => !items.some(v => v.id === p.id)).map(p => ({...p,state:'offline'}))]
    },
    async exportVoicePresets(ids) {
      if (!Array.isArray(ids) || ids.length > 256) fail('INVALID_INPUT')
      const saved = sources.get('voice-presets')?.voices || [], catalogue = await api.listServiceVoices()
      return [...new Set(ids)].flatMap(id => {
        const preset = saved.find(v => v.id === id)
        if (preset) return [voicePreset(preset)]
        const matches = catalogue.filter(v => v.id === id)
        if (!matches.length) return []
        const descriptors = matches.map(v => {
          const descriptor = {schemaVersion:1,id:v.id,label:v.label,enabled:true,kind:'service',voiceId:v.id,engine:v.engine,revision:v.revision,languages:v.languages,params:v.params || {}}
          for (const key of ['modelSetId','modelVersion']) if (v[key] !== undefined) descriptor[key] = v[key]
          return voicePreset(descriptor)
        })
        if (new Set(descriptors.map(hash)).size !== 1) fail('SERVICE_REQUIRED')
        return [descriptors[0]]
      })
    },
    // private fork: authoring exports bytes and synthesis data, never provider configuration.
    async exportPortableVoice({voiceId,serviceId}) {
      alive(); serviceVoiceId(voiceId)
      let saved = sources.get('voice-presets')?.voices.find(v => v.id === voiceId)
      if (!saved) {
        const builtin = BUILTIN_PRESETS.find(v => v.id === voiceId)
        if (builtin) { const {engine,revision,...preset} = builtin; saved = {schemaVersion:1,enabled:true,...preset} }
      }
      if (saved && ['azure','qwen','fish-audio','volcengine','openai-compatible'].includes(saved.kind)) {
        const {providerId, ...voice} = voicePreset(saved)
        return {voice,media:{}}
      }
      const provider = providers.get(serviceId)?.provider
      if (!provider?.exportVoice) fail('REFERENCE_UNSUPPORTED')
      const selected = (await provider.catalog({})).find(v => v.id === voiceId)
      if (!selected || selected.state !== 'ready') fail('VOICE_NOT_FOUND')
      const exported = await provider.exportVoice({voiceId,revision:selected.revision})
      alive(); if (providers.get(serviceId)?.provider !== provider) fail('SERVICE_OFFLINE')
      const voice = portableVoice(exported.voice)
      if (voice.kind !== 'reference') fail('REFERENCE_UNSUPPORTED')
      const media = {}
      let total = 0
      for (const ref of Object.values(voice.references)) {
        const {bytes} = referenceAudio(Buffer.from(exported.media?.[ref.sha256] || '', 'base64'))
        if (hash(bytes) !== ref.sha256) fail('REFERENCE_FILE_MISMATCH')
        total += bytes.length
        media[ref.sha256] = bytes
      }
      return {voice,media}
    },
    registerUsageSource(input) { alive(); if (usage.has(input.owner)) fail('REVISION_CONFLICT'); usage.set(input.owner, input); return () => usage.delete(input.owner) },
    async inspectUsage(serviceId) { if (!usage.size) fail('USAGE_UNKNOWN'); return Promise.all([...usage.values()].map(u => u.inspect(serviceId))) },
    listVoices({ source }) { alive(); return (sources.get(source)?.voices || []).map(v => api.getVoice({ voice: { source, id: v.id } })) },
    getVoice({ voice: ref }) {
      const { source, voice } = voiceFor(ref), provider = providers.get(source.bindings[voice.id])?.provider
      return { ...structuredClone(voice), state: !voice.enabled ? 'disabled' : !source.bindings[voice.id] ? 'service-required' : provider ? 'ready' : 'offline' }
    },
    async listServices() { alive(); return Promise.all([...providers.values()].map(async ({provider:p}) => {
      if (p.capabilities?.catalogue) try { await p.health({}) } catch {}
      return {id:p.id,kind:p.kind,revision:p.revision,capabilities:structuredClone(p.capabilities || {})}
    })) },
    async listProviderCatalog({ serviceId } = {}) {
      if (!serviceId) return api.listServiceVoices()
      alive(); const p = providers.get(serviceId)?.provider, cached = catalogs.get(serviceId)
      if (!p?.capabilities?.warmupTimeoutMs && cached && (!p || cached.revision === p.revision && cached.until > now())) return structuredClone(cached.items)
      if (!p) fail('SERVICE_OFFLINE')
      let items
      try { items = await p.catalog({}) } catch { fail('SERVICE_OFFLINE') }
      alive(); if (!Array.isArray(items) || items.length > 10000) fail('INVALID_CATALOG')
      if (!p.capabilities?.warmupTimeoutMs) catalogs.set(serviceId,{revision:p.revision,until:now()+86400000,items:structuredClone(items)})
      return structuredClone(items)
    },
    async health({ serviceId } = {}) { alive(); const items = serviceId ? [providers.get(serviceId)].filter(Boolean) : [...providers.values()]; return Promise.all(items.map(async ({provider:p}) => ({ id:p.id, ...await p.health({}) }))) },
    async synthesize(input, options) {
      alive(); if (!enabled) fail('TTS_DISABLED')
      const g = grantFor(options?.grant, input.voice?.source, options?.scope)
      if (options.signal?.aborted) fail('ABORTED')
      if (waiters >= 256) fail('QUEUE_FULL')
      let source, voice
      if (input.voiceId !== undefined) {
        if (!g.serviceVoices) fail('FORBIDDEN')
        serviceVoiceId(input.voiceId)
        const matches = (await api.listServiceVoices()).filter(v => v.id === input.voiceId)
        if (matches.length !== 1) fail(matches.length ? 'SERVICE_REQUIRED' : 'VOICE_NOT_FOUND')
        const selected = matches[0]
        if (selected.kind === 'reference') fail('REFERENCE_UNSUPPORTED')
        if (selected.state !== 'ready') fail('SERVICE_OFFLINE')
        const preset = sources.get('voice-presets')?.voices.find(v => v.id === selected.id)
        voice = preset ? portableVoice(preset) : portableVoice({schemaVersion:1,id:selected.id,voiceId:selected.id,label:selected.label || selected.id,enabled:true,kind:'service',engine:selected.engine,
          revision:selected.revision,languages:selected.languages,params:selected.params || {},
          ...(selected.modelSetId ? {modelSetId:selected.modelSetId} : {}),...(selected.modelVersion ? {modelVersion:selected.modelVersion} : {})})
        if (Object.hasOwn(input, 'readings')) fail('UNKNOWN_FIELD')
        source = {sourceId:'service-voices',bindings:{[voice.id]:selected.serviceId}}
      } else {
        if (g.serviceVoices) fail('FORBIDDEN')
        ;({ source, voice } = voiceFor(input.voice))
      }
      grantFor(options.grant)
      if (input.selectionKey !== undefined && (typeof input.selectionKey !== 'string' || input.selectionKey.length > 512)) fail('INVALID_INPUT')
      if (voice.kind === 'pack') {
        const resolved = resolveVoiceSpec({...voice.pack,mood:input.mood,selectionKey:input.selectionKey,text:input.text})
        if (!resolved.effective) fail(resolved.issues[0]?.code || 'VOICE_DISABLED')
        voice = resolved.effective.voice
      }
      if (!voice.enabled) fail('VOICE_DISABLED')
      if (typeof input.text !== 'string' || !input.text.trim() || input.text.length > 1500) fail('INVALID_INPUT')
      if (!voice.languages.map(language).includes(language(input.language))) fail('LANGUAGE_UNSUPPORTED')
      const entry = providers.get(source.bindings[voice.id]); if (!entry) fail('SERVICE_OFFLINE')
      const p = entry.provider
      g.authorize?.(input,{serviceId:p.id,serviceRevision:p.revision})
      p.onRequest?.()
      if (voice.kind === 'reference' && p.health) await p.health({signal:options.signal})
      // private fork (docs/fork/reading-dictionary.md): only the active global preset; its compiled revision is part of the
      // line identity, so switching or editing the preset re-synthesises a cached line the next time it is played.
      const readings = lexicon(await globalReadings())
      const pronounce = compilePronunciations(await globalPronunciations())
      grantFor(options.grant)
      if (voice.kind === 'reference' ? !p.capabilities?.voiceKinds?.includes('reference') : voice.kind === 'service' ? !p.capabilities?.serviceVoiceEngines?.includes(voice.engine) : p.kind !== voice.kind) fail('REFERENCE_UNSUPPORTED')
      const ref = voice.references?.[0]
      const params = structuredClone(voice.params)
      if (voice.kind === 'gpt-sovits-api') params.promptText = readings.apply(params.promptText,params.promptLang)
      const resolveMood = Object.hasOwn(moodResolvers, p.kind) ? moodResolvers[p.kind] : undefined
      const identity = { version: 3, profileId, source: source.sourceId, voice, provider: { id:p.id, revision:p.revision }, mood: input.mood || 'default', ...(resolveMood ? { resolvedMood: resolveMood({ params, mood: input.mood, moodStyles: voice.moodStyles }) } : {}), language: input.language, params, readings: readings.revision, text: pronounce(readings.apply(input.text, input.language)) }
      const key = hash(identity), started = epoch
      const lane = p.endpoint || p.id
      waiters++
      try {
        const cached = await cache.get(key, g.scope)
        grantFor(options.grant); if (started !== epoch) fail('CACHE_CLEARED')
        if (cached) { g.keys.add(key); return { key, mime:'audio/wav', durationMs:durationMs(cached), cacheHit:true } }
        let flight = flights.get(key)
        if (!flight) {
          const abort = new AbortController()
          flight = { abort, users: 0, scopes: new Set(), promise: null }
          flights.set(key, flight)
          const signal = AbortSignal.any([abort.signal, entry.abort.signal, AbortSignal.timeout(120000 + (p.capabilities?.warmupTimeoutMs || 0))])
          // private fork: cloud turns warm two clips at once; local engines retain one lane.
          const slots = lanes.get(lane) || Array.from({length:['qwen','azure','volcengine','openai-compatible'].includes(p.kind) ? 2 : 1}, () => ({count:0,tail:Promise.resolve()}))
          lanes.set(lane,slots)
          const slot = slots.reduce((a,b) => a.count <= b.count ? a : b)
          slot.count++
          flight.promise = slot.tail.catch(() => {}).then(async () => {
            signal.throwIfAborted()
            let reference, references
            if (ref) {
              if (!p.capabilities?.referenceInput?.some(kind => ['bytes-v1','bytes-list-v1'].includes(kind))) fail('REFERENCE_UNSUPPORTED')
              const multiple = p.capabilities.referenceInput.includes('bytes-list-v1')
              if (!multiple && voice.references.length !== 1) fail('REFERENCE_UNSUPPORTED')
              const resolved = []
              let total = 0
              for (const item of voice.references) {
                // The asset owner validated stored audio at ingress; the reader owns authorization.
                const bytes = Buffer.from(await interrupted(Promise.resolve().then(() => source.readReference(item.sha256)), signal))
                total += bytes.length
                const limits = p.capabilities.referenceLimits
                if (limits?.totalBytes && total > limits.totalBytes || limits?.count && voice.references.length > limits.count || limits?.bytes && bytes.length > limits.bytes) fail('REFERENCE_LIMIT_EXCEEDED')
                resolved.push({sha256:item.sha256,bytes,transcript:item.transcript,promptText:readings.apply(item.transcript,item.language),promptLanguage:item.language})
              }
              reference = resolved[0]
              if (multiple) references = resolved
            }
            const audio = wav(await interrupted(Promise.resolve().then(() => p.synthesize({ ...identity, text: identity.text, voiceId:voice.voiceId, revision:voice.revision, model: voice.model, reference, ...(references ? {references} : {}), readingsRevision: readings.revision, mood:input.mood, moodStyles:voice.moodStyles, identity:key }, { signal })), signal))
            signal.throwIfAborted(); alive(); if (started !== epoch) fail('CACHE_CLEARED')
            flight.durationMs = durationMs(audio)
            await cache.put(key, audio, [...flight.scopes])
            if (started !== epoch) { await cache.clear(); fail('CACHE_CLEARED') }
          }).catch(error => { if (error instanceof TtsError) throw error; fail(signal.aborted ? 'ABORTED' : 'SERVICE_OFFLINE', error.status) }).finally(() => { if (flights.get(key) === flight) flights.delete(key) })
          const work = flight.promise
          slot.tail = work
          void work.finally(() => { slot.count--; if (slots.every(value => !value.count) && lanes.get(lane) === slots) lanes.delete(lane) }).catch(() => {})
          flight.promise.catch(() => {})
        }
        flight.users++; flight.scopes.add(g.scope)
        const signal = AbortSignal.any([g.abort.signal, ...(options.signal ? [options.signal] : [])])
        let onAbort
        try {
          await Promise.race([flight.promise, new Promise((_, reject) => { onAbort = () => reject(new TtsError('ABORTED')); if (signal.aborted) onAbort(); else signal.addEventListener('abort', onAbort, {once:true}) })])
          grantFor(options.grant); if (started !== epoch) fail('CACHE_CLEARED'); g.keys.add(key)
          return { key, mime: 'audio/wav', durationMs:flight.durationMs, cacheHit:false }
        } finally { signal.removeEventListener('abort', onAbort); if (--flight.users === 0) flight.abort.abort() }
      } finally { waiters-- }
    },
    async readAudio({ key, grant }) {
      if (!enabled) fail('TTS_DISABLED')
      const started = epoch, g = grantFor(grant); if (!g.keys.has(key)) fail('FORBIDDEN')
      const b = await cache.get(key); grantFor(grant)
      if (!b || started !== epoch) fail('AUDIO_GONE')
      return b
    },
    async createAudioTicket({ key, grant, ttlMs = 60000 }) {
      if (!enabled) fail('TTS_DISABLED')
      const g = grantFor(grant); if (!g.keys.has(key)) fail('FORBIDDEN')
      for (const [t,v] of tickets) if (v.expires <= now()) tickets.delete(t)
      if (tickets.size >= 1024) fail('QUEUE_FULL')
      const ticket = randomBytes(32).toString('base64url'); tickets.set(ticket, { key, grant, expires: now() + Math.max(1, Math.min(60000, ttlMs)) }); return ticket
    },
    async redeemAudioTicket(ticket) { const t = tickets.get(ticket); if (!t) fail('AUDIO_GONE'); if (t.expires <= now()) { tickets.delete(ticket); fail('AUDIO_GONE') }; return api.readAudio(t) },
    cacheStats: () => cache.stats(),
    async clearCache({ scope, all } = {}) { alive(); if (!all && !scope) fail('INVALID_INPUT'); epoch++; for (const f of flights.values()) f.abort.abort(); tickets.clear(); for (const g of grants.values()) g.keys.clear(); const result = await cache.clear(all ? undefined : scope); emit({ type:'cacheInvalidated', epoch }); return { ...result, epoch } },
    async dispose() { if (disposed) return; disposed = true; api.jobs.dispose(); for (const source of sources.keys()) revoke(source); for (const g of grants.values()) g.abort.abort(); grants.clear(); for (const e of providers.values()) e.abort.abort(); for (const f of flights.values()) f.abort.abort(); providers.clear(); sources.clear(); tickets.clear(); emit({ type:'disposed' }); listeners.clear(); await cache.flush() },
  }
  api.jobs = createJobs({ now, synthesize:api.synthesize, checkGrant:grantFor, ticket:api.createAudioTicket,
    timeoutMs(input,grant) {
      grantFor(grant,input.voice?.source)
      const source = input.voice && voiceFor(input.voice).source
      const p = source && providers.get(source.bindings[input.voice.id])?.provider
      return 125000 + (p?.capabilities?.warmupTimeoutMs || 0)
    },
    resolveGrant(principal,source,scope) {
      alive(); if (!enabled) fail('TTS_DISABLED')
      for (const [grant,g] of grants) if (g.principal === principal && g.source === source && g.scope === scope) return grant
      fail('FORBIDDEN')
    },
  })
  return api
}

function interrupted(promise, signal) {
  return new Promise((resolve,reject) => {
    const abort = () => reject(new TtsError(signal.reason?.name === 'TimeoutError' ? 'TIMEOUT' : 'ABORTED'))
    if (signal.aborted) { abort(); return }
    signal.addEventListener('abort',abort,{once:true})
    promise.then(resolve,reject).finally(() => signal.removeEventListener('abort',abort))
  })
}