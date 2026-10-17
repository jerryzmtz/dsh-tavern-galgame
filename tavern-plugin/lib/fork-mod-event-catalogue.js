import {recallAssetPacks} from './domain/stage-asset-pack-catalogue.js'
import {readCardAssetExtension} from './domain/card-asset-bindings.js'
import {modAssetCatalogue} from './domain/mods/catalogue.js'
import {isDeepStrictEqual as equal} from 'node:util'
import {assetRefKey} from '../packages/dsh-presentation-protocol/src/asset-packs.js'

// Reuse core blue/green admission, including the director's already-paid judge result.
export function createModEventCatalogue({snapshot}) {
  const recalled=new Map()
  return {
    remember(sessionId,sourceKey,catalogue) {
      if(!catalogue)return
      recalled.set(sessionId,{sourceKey,catalogue})
      while(recalled.size>64)recalled.delete(recalled.keys().next().value)
    },
    clear(){recalled.clear()},
    async read(value,manifests) {
      const assets=await snapshot(value.head.cardPath)
      if(!assets)return Object.fromEntries(manifests.map(row=>[row.id,{packs:[],recalled:[]}]))
      const extension=readCardAssetExtension(assets.raw)
      const input={...assets,boundPackIds:extension.assetBindings.boundPackIds,units:value.units,
        modAssetKinds:manifests.flatMap(row=>row.admission.entryKinds)}
      let catalogue=recallAssetPacks(input)
      const saved=recalled.get(value.head.sessionId)
      if(saved?.sourceKey===value.source.sourceKey && equal(saved.catalogue.revisions,catalogue.revisions)) {
        const judgeRecall=new Set(saved.catalogue.rows.filter(row=>!row.excluded && row.reasons.includes('judge')).map(row=>assetRefKey(row.ref)))
        catalogue=recallAssetPacks({...input,judgeRecall})
      }
      if(!assets.current())throw Object.assign(new Error('Asset authority changed'),{code:'MOD_SOURCE_STALE'})
      return Object.fromEntries(manifests.map(manifest=>[manifest.id,modAssetCatalogue(manifest,catalogue)]))
    },
  }
}
