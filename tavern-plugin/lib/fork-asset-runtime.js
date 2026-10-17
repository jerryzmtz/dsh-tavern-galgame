import { createAssetPackPresentation } from './domain/asset-pack-presentation.js'
import { createAssetPackSpeech } from './domain/asset-pack-speech.js'
import { readCardAssetExtension } from './domain/card-asset-bindings.js'
import { cardAssetWorkspaceRevision, hasCardAssetBindings } from './fork-card-asset-bindings.js'
import { cardEngineSettings, effectiveCardStage } from './domain/card-stage-settings.js'
import { assetRefKey } from '../packages/dsh-presentation-protocol/src/asset-packs.js'

import { assetVoiceBinding } from './domain/figure-voice.js'
export { assetVoiceBinding } from './domain/figure-voice.js'

// The authenticated Tavern carrier owns sessions; pack services own bytes and leases.
export function createAssetRuntime({ctx, readWorkspace, engineSettings, onInvalidate = () => {},
  getBinding = (_ref, voice) => assetVoiceBinding(ctx.get('tts'), engineSettings.read().values.voiceServices, voice)}) {
  const consumers = new Map(), listeners = new Set()
  let generation = 0, disposed = false
  const service = () => { const value = ctx.get('assetLibrary'); return value?.apiVersion === 2 ? value : undefined }
  function clear(cardPath, event = {kind:'refresh', scope:{}, reason:'configuration'}) {
    generation++
    for (const [id, entry] of consumers) if (!cardPath || entry.cardPath === cardPath) {
      if (event.kind === 'revoked' && event.scope.authority) {
        consumers.delete(id); entry.speech?.dispose(); entry.presentation?.dispose()
      } else entry.presentation?.refresh(event)
    }
    for (const listener of listeners) listener(cardPath,event)
    onInvalidate(cardPath,event)
  }
  for (const name of ['assetLibrary', 'assetPackSettings', 'tts']) ctx.inject([name], child => {
    const lifecycle = reason => {
      if (name === 'tts') for (const entry of consumers.values()) {entry.speech?.dispose(); entry.speech = null}
      clear(undefined,{kind:name === 'assetLibrary' ? 'revoked' : 'refresh',scope:name === 'assetLibrary' ? {authority:true} : {},reason})
    }
    lifecycle('service-installed')
    const off = child.get(name)?.subscribe?.(event => {
      if (name !== 'tts') clear(undefined,{kind:event.revision === null ? 'revoked' : 'refresh',scope:{packId:event.packId},reason:'service-event'})
      else if (['providerChanged','providerRemoved','disposed','cacheInvalidated'].includes(event.type)) {
        for (const entry of consumers.values()) {entry.speech?.dispose(); entry.speech = null}
        clear()
      }
    })
    child.effect(() => () => { off?.(); lifecycle('service-unloaded') })
  })
  const offEngine = engineSettings.subscribe(() => clear())
  async function snapshot(cardPath) {
    if (disposed) throw new Error('Asset runtime disposed')
    const epoch = generation, workspace = await readWorkspace(cardPath), raw = workspace?.raw
    if (!raw || !hasCardAssetBindings(raw)) return null
    const extension = readCardAssetExtension(raw)
    if (!effectiveCardStage(extension, engineSettings.read().values).stage) return null
    const owner = service(), settings = engineSettings.read()
    const globalEnabledPackIds = ctx.get('assetPackSettings')?.read().values.globalEnabledPackIds || []
    const snapshots = [], assetStatus = {}
    if (owner) {
      for (const packId of new Set([...extension.assetBindings.boundPackIds, ...globalEnabledPackIds])) {
        const pack = await owner.getPackSnapshot({packId})
        if (pack) snapshots.push(pack)
      }
      const refs = snapshots.flatMap(pack => pack.manifest.assets.map(asset => ({packId:pack.manifest.id, kind:asset.kind, assetId:asset.id})))
      for (const row of await owner.resolveAssets({refs})) assetStatus[assetRefKey(row.ref)] = {available:!!row.value && row.value.pendingMedia !== true && !row.diagnostics.length}

    }
    if (epoch !== generation || owner !== service()) throw Object.assign(new Error('Assets changed; retry explicitly'), {code:'REVISION_CONFLICT'})
    const values = cardEngineSettings(settings.values, extension)
    return {raw, cardRevision:cardAssetWorkspaceRevision(workspace), snapshots, globalEnabledPackIds, assetStatus,
      engine:{...values, widgetsEnabled:values.dimensions.widgets},
      current:() => !disposed && epoch === generation && owner === service() && settings.revision === engineSettings.read().revision}
  }
  async function consumer(chat, origin) {
    const workspace = await readWorkspace(chat.cardPath), id = chat.sessionId
    if (disposed) throw new Error('Asset runtime disposed')
    let entry = consumers.get(id)
    if (!workspace?.raw || !hasCardAssetBindings(workspace.raw)) {
      consumers.delete(id); entry?.speech?.dispose(); entry?.presentation.dispose()
      return null
    }
    if (!origin) throw new Error('Authenticated same-origin carrier required')
    const revision = cardAssetWorkspaceRevision(workspace)
    if (entry && (entry.origin !== origin || entry.cardPath !== chat.cardPath)) {
      entry.speech?.dispose(); entry.presentation.dispose(); consumers.delete(id); entry = null
    }
    if (entry && entry.revision !== revision) {entry.presentation.rebind(workspace.raw); entry.revision = revision}
    if (!entry) {
      const presentation = createAssetPackPresentation({raw:workspace.raw, getEngine:() => engineSettings.read().values, getService:service, getAllowedPackIds:() => entry?.allowedPackIds || [], origin, scope:'dsh-browser', onInvalidate:event => {
        // private fork: external same-UUID publications must also invalidate the
        // director envelope and browser warm timeline, not just server descriptors.
        if (event.reason === 'pack-revision-observed') {
          generation++
          for (const listener of listeners) listener(chat.cardPath,event)
        }
        onInvalidate(chat.cardPath,event)
      }})
      const speech = createAssetPackSpeech({presentation, getEngine:() => engineSettings.read().values, getTts:() => ctx.get('tts'), getBinding, cardId:workspace.meta.id, scope:'dsh-browser'})
      entry = {cardPath:chat.cardPath, revision, origin, presentation, speech}
      consumers.set(id, entry)
    }
    if (!entry.speech) entry.speech = createAssetPackSpeech({presentation:entry.presentation,getEngine:() => engineSettings.read().values,getTts:() => ctx.get('tts'),getBinding,cardId:workspace.meta.id,scope:'dsh-browser'})
    entry.allowedPackIds = [...new Set([...entry.presentation.extension.assetBindings.boundPackIds,
      ...(ctx.get('assetPackSettings')?.read().values.globalEnabledPackIds || [])])]
    return entry
  }
  return {snapshot, consumer, invalidate:clear, get revision() {return generation},
    async hasBindings(cardPath) {const raw = (await readWorkspace(cardPath))?.raw; return !!raw && hasCardAssetBindings(raw) && effectiveCardStage(readCardAssetExtension(raw), engineSettings.read().values).stage},
    subscribe(fn) {listeners.add(fn); return () => listeners.delete(fn)},
    dispose() {disposed = true; offEngine(); clear(undefined,{kind:'revoked',scope:{authority:true},reason:'disposed'}); listeners.clear()}}
}
