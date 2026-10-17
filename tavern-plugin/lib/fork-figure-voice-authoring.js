// private fork: figure authoring owns pack publication and scoped, billing-confirmed previews.
import {migrateVoice} from '../packages/dsh-asset-library/lib/asset-packs/voice-migration.js'
import {audioKind} from '../packages/dsh-asset-library/lib/pack-v2/media.js'
import {randomUUID,createHash} from 'node:crypto'
import {canonicalJson} from '../packages/dsh-asset-library/lib/asset-packs/common.js'
import {validateVoiceSpec,validateVoiceBinding} from '../packages/dsh-asset-library/lib/shared/voice-schema.js'
import {figureTtsVoice, assetVoiceBinding} from './domain/figure-voice.js'
const canonical = value => canonicalJson(JSON.parse(JSON.stringify(value)))
const hash = value => createHash('sha256').update(canonical(value)).digest('hex')
// private fork: deep equality compares canonical JSON directly; hashing both sides first adds nothing.
const same = (a, b) => canonical(a) === canonical(b)
const fail = code => { throw Object.assign(new Error(code), {code}) }

export function createFigureVoiceAuthoring({getLibrary,getTts,getSettings}) {
  const previews = new Map(), confirmations = new Map()
  let disposed = false, epoch = 0
  function services() {
    const library = getLibrary(), tts = getTts()
    if (disposed || library?.apiVersion !== 2) fail('PLUGIN_UNAVAILABLE')
    return {library,tts}
  }
  async function current(library, input) {
    const snapshot = await library.getPackSnapshot({packId:input.packId})
    if (!snapshot?.figures[input.figureId]) fail('ASSET_UNAVAILABLE')
    if (snapshot.revision !== input.expectedRevision) fail('REVISION_CONFLICT')
    return snapshot
  }
  function close(scope) {
    const entry = previews.get(scope)
    if (!entry) return {closed:false}
    previews.delete(scope); clearTimeout(entry.timer)
    entry.grant.dispose(); entry.source.dispose(); entry.offLibrary(); entry.offTts()
    return {closed:true}
  }
  const api = {
    async editor(input) {
      const {library,tts} = services(), pack = await library.getPackSnapshot({packId:input.packId})
      const figure = pack?.figures[input.figureId]
      if (!figure) fail('ASSET_UNAVAILABLE')
      const voice = figure.voice && pack.manifest.voiceLibrary?.voices[figure.voice.voice]
      const status = voice && tts ? await tts.resolveVoiceService({voice,binding:figure.voice,defaults:getSettings().voiceServices || {}}) : {effective:null,issues:voice ? [{code:'SERVICE_REQUIRED'}] : []}
      return {packRevision:pack.revision,binding:figure.voice || null,voiceLibrary:pack.manifest.voiceLibrary || {version:1,voices:{}},...status,recommended:tts?.listRecommendedFishVoices?.().voices || []}
    },
    async choices() {
      const {tts} = services()
      return {recommended:tts?.listRecommendedFishVoices?.().voices || [],voices:(tts ? await tts.listServiceVoices() : []).map(v => ({id:v.id,serviceId:v.serviceId,label:v.label,languages:v.languages,state:v.state}))}
    },
    async assign(input) {
      const {library,tts} = services(), before = await current(library,input)
      if (input.binding !== undefined) return library.saveFigureVoiceBinding({...input,binding:input.binding})
      if (input.voiceSpec) return library.createAndAssignPackVoice(input)
      const figure = structuredClone(before.figures[input.figureId]), blobs = {...before.manifest.blobs}, files = new Map(), voiceLibrary = structuredClone(before.manifest.voiceLibrary || {version:1,voices:{}})
      if (input.voiceId === null) delete figure.voice
      else {
        if (!tts) fail('PLUGIN_UNAVAILABLE')
        const {voice,media} = await tts.exportPortableVoice({voiceId:input.voiceId,serviceId:input.serviceId})
        const {schemaVersion,id,enabled,modelDigest,providerId,...preset} = voice
        if (preset.references) preset.references = preset.references.map(ref => ({media:ref.sha256,text:ref.transcript,language:ref.language}))
        const language = input.language || preset.languages[0], voiceId = 'v-' + randomUUID()
        const converted = migrateVoice(preset,language)
        voiceLibrary.voices[voiceId] = converted.voice
        figure.voice = {voice:voiceId,...(Object.keys(converted.emotionVariants).length ? {emotionVariants:converted.emotionVariants} : {})}
        for (const [sha,bytes] of Object.entries(media)) {
          const ext = audioKind(Buffer.from(bytes))
          blobs[sha] = {ext,mime:ext === 'mp3' ? 'audio/mpeg' : 'audio/wav',size:bytes.length}
          files.set('media/' + sha + '.' + ext,bytes)
        }
      }
      if (disposed || getLibrary() !== library || getTts() !== tts) fail('PLUGIN_UNAVAILABLE')
      files.set('figures/' + figure.id + '.json',Buffer.from(JSON.stringify(figure,null,2) + '\n'))
      return library.patchPack({packId:input.packId,expectedRevision:input.expectedRevision,patch:{blobs,voiceLibrary},fileUpdates:files})
    },
    async preview(input,origin) {
      if (!origin) fail('FORBIDDEN')
      const started = epoch, {library,tts} = services(), pack = await current(library,input), figure = pack.figures[input.figureId]
      if (!tts) fail('SERVICE_REQUIRED')
      const spec = structuredClone(input.voiceSpec ?? pack.manifest.voiceLibrary?.voices[figure.voice?.voice])
      if (!spec) fail('VOICE_NOT_FOUND')
      validateVoiceSpec(spec)
      const voiceBinding = structuredClone(input.binding ?? (input.voiceSpec ? {voice:'preview'} : figure.voice))
      validateVoiceBinding(voiceBinding,{version:1,voices:{[voiceBinding?.voice]:spec}})
      const language = voiceBinding.language || spec.language
      const text = input.text ?? (language.startsWith('ja') ? '\u4eca\u65e5\u306f\u3088\u3044\u5929\u6c17\u3067\u3059\u3002' : language.startsWith('zh') ? '\u4eca\u5929\u5929\u6c14\u5f88\u597d\u3002' : 'The weather is pleasant today.')
      if (typeof text !== 'string' || !text.trim() || text.length > 200 || text.includes('\0') || (input.mood !== undefined && (typeof input.mood !== 'string' || input.mood.length > 80 || input.mood.includes('\0')))) fail('INVALID_INPUT')
      const resolution = await tts.resolveVoiceService({voice:spec,binding:voiceBinding,defaults:getSettings().voiceServices || {}}), binding = resolution.effective
      if (!binding) fail(resolution.issues[0]?.code || 'SERVICE_REQUIRED')
      if (disposed || epoch !== started || getLibrary() !== library || getTts() !== tts) fail('PLUGIN_UNAVAILABLE')
      const request = {text,language,...(input.mood === undefined ? {} : {mood:input.mood})}
      const fingerprint = hash({origin,packId:input.packId,figureId:input.figureId,revision:pack.revision,spec,voiceBinding,request,binding,epoch})
      for (const [token,entry] of confirmations) if (entry.expiresAt <= Date.now()) confirmations.delete(token)
      if (binding.capabilities?.paid !== false) {
        if (input.confirmToken !== undefined) {
          const entry = confirmations.get(input.confirmToken); confirmations.delete(input.confirmToken)
          if (!entry || entry.fingerprint !== fingerprint) fail('PREVIEW_CONFIRMATION_REQUIRED')
        } else {
          if (confirmations.size >= 16) fail('QUEUE_FULL')
          const confirmToken = randomUUID(), expiresAt = Date.now() + 60000
          confirmations.set(confirmToken,{fingerprint,expiresAt})
          return {status:'confirmation-required',confirmToken,expiresAt,billing:{serviceId:binding.serviceId,paid:true}}
        }
      }
      let used = false
      const opened = await api.open(input,origin,{spec,voiceBinding,binding,authorize:(actual,provider) => {
        if (used || !same(provider, {serviceId:binding.serviceId,serviceRevision:binding.serviceRevision}) || !same({...actual,voice:undefined}, {...request,voice:undefined})) fail('PREVIEW_CONFIRMATION_REQUIRED')
        used = true
      }})
      try { return {status:'submitted',...opened,...tts.jobs.submit({...request,voice:opened.voice},{principal:'dsh-browser',scope:opened.scope})} }
      catch (error) { close(opened.scope); throw error }
    },
    async open(input,origin,policy) {
      if (!origin) fail('FORBIDDEN')
      const started = epoch, {library,tts} = services(), pack = await current(library,input), figure = pack.figures[input.figureId]
      const voiceBinding = policy?.voiceBinding || figure.voice
      if (!figure.enabled || !voiceBinding) fail('VOICE_NOT_FOUND')
      const spec = policy?.spec || pack.manifest.voiceLibrary.voices[voiceBinding.voice]
      const binding = await assetVoiceBinding(tts,getSettings().voiceServices || {},{voice:spec,binding:voiceBinding})
      if (policy && !same(binding, policy.binding)) fail('PREVIEW_CONFIRMATION_REQUIRED')
      if (!binding) fail('SERVICE_REQUIRED')
      // Billing is a generic provider capability; Tavern never distinguishes local/cloud backends.
      if (!policy && binding.capabilities?.paid !== false) fail('PAID_PREVIEW_DISABLED')
      const scope = 'figure-preview:' + randomUUID(), sourceId = policy ? 'figure-preview:' + hash({packId:input.packId,figureId:figure.id,spec,voiceBinding}) : scope
      await current(library,input)
      if (disposed || epoch !== started || getLibrary() !== library || getTts() !== tts) fail('PLUGIN_UNAVAILABLE')
      if (previews.size >= 16) fail('QUEUE_FULL')
      const source = tts.registerVoiceSource({owner:'dsh-tavern',sourceId,revision:pack.revision,voices:[figureTtsVoice(voiceBinding,spec,input.packId+':'+figure.id,figure.emotions)],bindings:{voice:binding.serviceId},
        readReference:async hash => {
          const lease = await library.leaseMedia({packId:input.packId,hash,scope:'dsh-browser',origin})
          try {
            if (lease.revision !== pack.revision) fail('REVISION_CONFLICT')
            const response = await library.respondLease({ticket:lease.ticket,resource:'media',request:new Request(new URL(lease.url,origin),{headers:{Origin:origin}})})
            if (!response.ok) fail('MISSING_REFERENCE')
            return new Uint8Array(await response.arrayBuffer())
          } finally { library.releaseLease(lease.ticket) }
        }})
      let grant
      try { grant = tts.grantConsumer({principal:'dsh-browser',source:sourceId,scope,...(policy ? {authorize:policy.authorize} : {})}) }
      catch (error) { source.dispose(); throw error }
      const offLibrary = library.subscribe(event => { if (event.packId === input.packId) close(scope) })
      const offTts = tts.subscribe(event => { if (['disposed','providerRemoved','providerChanged','cacheInvalidated'].includes(event.type)) close(scope) })
      const timer = setTimeout(() => close(scope),180000 + (binding.capabilities?.warmupTimeoutMs || 0)); timer.unref?.()
      previews.set(scope,{source,grant,offLibrary,offTts,timer})
      return {scope,voice:{source:sourceId,id:'voice'},language:voiceBinding.language || spec.language}
    },
    close:input => close(input.scope),
    invalidate() { epoch++; confirmations.clear(); for (const scope of previews.keys()) close(scope) },
    dispose() { epoch++; confirmations.clear(); disposed = true; for (const scope of previews.keys()) close(scope) },
  }
  return api
}
