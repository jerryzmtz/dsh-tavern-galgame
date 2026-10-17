import { join } from 'node:path'
import { DEFAULT_PRONUNCIATIONS, validatePronunciations } from './pronunciation.js'
import { createReadingPresetStore } from './reading-presets.js'
import { createTts } from './service.js'
import { createCache } from './cache.js'
import { Settings, validateSettings, createServiceSettings } from './settings.js'
import { registerRoutes, registerEnabledRoute } from './routes.js'
import { fail, hash, id } from './core.js'
export const name = 'dsh-tts'
export function apply(ctx, config = {}) {
  const entry = Settings(config.settings || {})
  let source = () => entry, generation = 0
  // private fork (docs/fork/reading-dictionary.md): named reading presets, one active; synthesis reads the active one.
  const readings = createReadingPresetStore({file:config.dataDir ? join(config.dataDir,'readings.json') : undefined})
  const cacheLimits = value => ({maxBytes:value.cacheMaxGB * 1024 ** 3, maxAgeDays:value.cacheMaxAgeDays})
  const cache = createCache({dataDir:config.dataDir,...cacheLimits(entry)})
  const tts = createTts({ profileId:config.profileId, dataDir:config.dataDir,
    cache, globalReadings:() => readings.activeEntries(), globalPronunciations:() => source().pronunciationDictionary || [] })
  const services = createServiceSettings({ tts, get:() => source(), credentials:() => ctx.get('credentials'), warn:message => ctx.logger.warn(message),
    replace: async value => { const settings = ctx.get('settings'); if (!settings) fail('SETTINGS_UNAVAILABLE'); await settings.replace('tts',validateSettings(value)) },
  })
  Object.assign(tts, { listRecommendedFishVoices:services.listRecommendedFishVoices, saveService:services.save, deleteService:services.delete, testService:services.test, importVoicePresets:services.importVoicePresets })
  // private fork: per-provider status for the services list. Local servers answer /health on loopback;
  // cloud providers only report key presence (no network). Bounded so an absent server cannot stall the tab.
  async function runningStatus(list) {
    return Promise.all(list.map(async s => {
      let timer
      try {
        const h = await Promise.race([tts.health({serviceId:s.id}).then(r => r[0] || {}), new Promise((_,reject) => { timer = setTimeout(() => reject(new Error('TIMEOUT')),4000) })])
        const voices = Array.isArray(h.voices) ? h.voices : undefined
        return {...s, status:{state:typeof h.state === 'string' ? h.state.slice(0,40) : 'ready', ...(voices ? {voiceCount:voices.filter(v => v?.state === 'ready').length, voiceTotal:voices.length} : {}),
          ...(typeof h.error === 'string' && h.error ? {error:h.error.slice(0,200)} : {})}}
      } catch { return {...s, status:{state:'offline'}} }
      finally { clearTimeout(timer) }
    }))
  }
  async function providerVoices({serviceId} = {}) {
    if (source().providers.some(p => p.id === serviceId)) return services.voices({id:serviceId})
    const items = await tts.listProviderCatalog({serviceId:id(serviceId)})
    return {status:'ok', source:'live', models:[], voices:items.filter(v => !v.preset).map(v => ({id:v.id, label:v.label || v.id, languages:v.languages || [], engine:v.engine, revision:v.revision, state:v.state,
      ...(v.modelSetId ? {modelSetId:v.modelSetId} : {}), ...(v.modelVersion ? {modelVersion:v.modelVersion} : {}), ...(v.params ? {params:v.params} : {})}))}
  }
  const previewGrant = tts.grantServiceConsumer({principal:'dsh-browser',scope:'voice-preset-preview'})
  const enabledListeners = new Set()
  let unprovide, removing = Promise.resolve(), disposed = false
  async function syncEnabled() {
    tts.setEnabled(source().enabled)
    if (!source().enabled && unprovide) {
      const stop = unprovide; unprovide = undefined; removing = stop()
    }
    for (const fn of enabledListeners) fn(source().enabled)
    await removing
    if (!disposed && source().enabled && !unprovide) unprovide = ctx.provide('tts',tts)
  }
  async function changed() {
    const mine = ++generation, value = source(); validateSettings(value)
    await cache.configure(cacheLimits(value))
    await syncEnabled(); services.sync()
  }
  ctx.inject(['settings'], child => child.get('settings').installSection(ctx,'tts',Settings,entry,{
    setSource:fn => { source = fn }, onChange:() => { void changed().catch(error => ctx.logger.warn(error)) }, validate:validateSettings,
  }))
  services.sync()
  void syncEnabled()
  registerEnabledRoute(ctx, { get:() => source().enabled, subscribe(fn) { enabledListeners.add(fn); return () => enabledListeners.delete(fn) } })
  const control=async (method,args = {}) => {
    switch (method) {
      case 'getEnabled': return {enabled:source().enabled}
      case 'setEnabled': {
        if (typeof args.enabled !== 'boolean') fail('INVALID_INPUT')
        const settings = ctx.get('settings'); if (!settings) fail('SETTINGS_UNAVAILABLE')
        await settings.update('tts',{enabled:args.enabled}); await syncEnabled()
        return {enabled:source().enabled}
      }
      case 'capabilities': return tts.capabilities()
      case 'settings': return { ...source(), providers:await services.list() }
      case 'services': return { configured:await services.list(), running:await runningStatus(await tts.listServices()) }
      case 'providerKinds': return services.kinds()
      case 'listRecommendedFishVoices': return services.listRecommendedFishVoices()
      case 'validateFishVoice': return services.validateFishVoice(args)
      case 'searchFishVoices': return services.searchFishVoices(args)
      case 'voiceModelStatus': return services.voiceModelStatus(args)
      case 'validateVoiceModel': return services.validateVoiceModel(args)
      case 'listOnlinePresetVoices': return services.listOnlinePresetVoices(args)
      case 'probeService': return services.probe(args)
      case 'providerVoices': return providerVoices(args)
      // private fork: discovery controls share the same unbilled, provider-owned listing.
      case 'listModels': { const result = await providerVoices(args); return {...result,voices:undefined} }
      case 'listVoices': { const result = await providerVoices(args); return {...result,models:undefined} }
      case 'saveService': return services.save(args)
      case 'deleteService': return services.delete(args)
      case 'testService': return services.test(args)
      case 'voicePresets': return services.listVoicePresets().map(preset => ({preset,revision:hash(preset)}))
      case 'saveVoicePreset': return services.saveVoicePreset(args)
      case 'deleteVoicePreset': return services.deleteVoicePreset(args)
      case 'importVoicePresets': return services.importVoicePresets(args)
      case 'voices': return tts.listServiceVoices()
      case 'catalog': return tts.listProviderCatalog(args)
      case 'health': return tts.health(args)
      case 'cache': return tts.cacheStats()
      case 'clearCache': return tts.clearCache(args)
      case 'saveCacheSettings': {
        const value = validateSettings({...source(),cacheMaxGB:args.cacheMaxGB,cacheMaxAgeDays:args.cacheMaxAgeDays})
        const settings = ctx.get('settings'); if (!settings) fail('SETTINGS_UNAVAILABLE')
        await settings.update('tts',{cacheMaxGB:value.cacheMaxGB,cacheMaxAgeDays:value.cacheMaxAgeDays})
        await cache.configure(cacheLimits(source())); return tts.cacheStats()
      }
      case 'pronunciationDictionary': return {entries:source().pronunciationDictionary || [], defaults:DEFAULT_PRONUNCIATIONS}
      case 'savePronunciationDictionary': {
        const entries = validatePronunciations(args.entries)
        const settings = ctx.get('settings'); if (!settings) fail('SETTINGS_UNAVAILABLE')
        await settings.update('tts',{pronunciationDictionary:entries})
        return {entries:source().pronunciationDictionary || [], defaults:DEFAULT_PRONUNCIATIONS}
      }
      case 'readingPresets': return readings.list()
      case 'readingPreset': return readings.get(args)
      case 'editReading': return readings.edit(args)
      case 'createReadingPreset': return readings.create(args)
      case 'renameReadingPreset': return readings.rename(args)
      case 'deleteReadingPreset': return readings.remove(args)
      case 'setActiveReadingPreset': return readings.setActive(args)
      case 'exportReadingPreset': return readings.exportPreset(args)
      case 'importReadingPreset': return readings.importPreset(args)

      default: fail('UNKNOWN_METHOD')
    }
  }
  ctx.provide('ttsControl',Object.freeze({call:control}))
  registerRoutes(ctx,'/api/dsh-tts/v1',control, ticket => tts.redeemAudioTicket(ticket), tts.jobs)
  ctx.effect(() => async () => { disposed = true; generation++; enabledListeners.clear(); previewGrant.dispose(); services.dispose(); await tts.dispose() })
}
