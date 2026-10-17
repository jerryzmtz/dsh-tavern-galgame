import { createAssetPackSettings } from './native-settings.js'
import { createCatalogueSettings } from '../pack-catalogue/settings.js'
import { createAssetPackTransport, registerAssetPackTransport } from './transport.js'
import { decodeMedia } from './media.js'
import { check } from '../asset-packs/common.js'
import { PACK_BUDGET } from './budget.js'

export const name = 'dsh-asset-library'
// The sole installed asset owner. Seeds are explicit input, never a runtime catalogue.
export function apply(ctx, config = {}) {
  const runningAgents = new Set()
  ctx.on('agent/status', ({agent,status}) => {
    if (status === 'running') runningAgents.add(agent)
    else runningAgents.delete(agent)
  }, {global:true})
  const settings = createAssetPackSettings(ctx)
  const catalogueSettings = createCatalogueSettings(ctx, config.officialCatalogueUrl)
  const cards = Object.fromEntries(['snapshot','inspectRaw','remapRaw','bindRaw','withPrepared','withConfigPack','withBoundPack','recover'].map(method => [method, (...args) => {
    const adapter = ctx.get('tavernAssetCards')
    check(adapter?.apiVersion === 2 && typeof adapter[method] === 'function', '$.card', 'Card owner unavailable', 'RECOVERY_REQUIRED')
    return adapter[method](...args)
  }]))
  const transport = createAssetPackTransport({...config, thumbnails:{isBusy:() => runningAgents.size > 0,onError:error => ctx.logger.warn('[asset-thumbnails] ' + error.message)}, limits:PACK_BUDGET, decodeMedia:config.decodeMedia || decodeMedia, settings, catalogueSettings, cardTransactions:cards, voiceSourceAvailable:async source => {
    const tts = ctx.get('tts')
    if (!tts?.resolveVoiceService) return false
    return !!(await tts.resolveVoiceService({voice:{defaultSource:'source',sources:{source}},binding:{voice:'import'}})).effective
  }})
  ctx.provide('assetLibrary',transport.service)
  ctx.provide('assetPackSettings',settings)
  registerAssetPackTransport(ctx,transport)
  ctx.effect(() => () => transport.service.dispose())
}
