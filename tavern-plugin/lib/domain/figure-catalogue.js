// private fork: one effective figure index; identities are refs, never recall evidence.
import {createHash} from 'node:crypto'
import {listEffectiveAssets} from './effective-assets.js'
import resolution from '../../packages/dsh-presentation-protocol/src/figure-resolution.cjs'
import {check} from '../../packages/dsh-presentation-protocol/src/asset-pack-json.js'
const {codepointCompare} = resolution
export const figureRefKey = ref => ref.packId + '/' + ref.figureId
export const figureActorKey = ref => 'f_' + createHash('sha256').update(figureRefKey(ref)).digest('hex').slice(0,16)
export function effectiveFigurePackIds(bindings, globalEnabledPackIds = []) {
  return [...new Set([...(bindings?.boundPackIds || []), ...globalEnabledPackIds.slice().sort(codepointCompare)])]
}
export function figureCatalogue({snapshots = [], bindings, globalEnabledPackIds = [], roster = {}}) {
  const rows = [], keys = new Map()
  for (const {pack,asset:figure,ref,sourceRefs} of listEffectiveAssets({snapshots,boundPackIds:bindings?.boundPackIds,globalEnabledPackIds}).filter(row => row.ref.figureId)) {
    const identity = figureRefKey(ref), generated = figureActorKey(ref)
    check(!keys.has(generated) || keys.get(generated) === identity, '$.figures', 'Figure actor key collision')
    keys.set(generated,identity)
    const old = Object.keys(roster).sort(codepointCompare).filter(key => roster[key].figure && sourceRefs.some(ref => figureRefKey(roster[key].figure) === figureRefKey(ref)))
    // Do not merge historical keys that happen to refer to the same figure.
    for (const actorKey of old.length ? old : [generated]) rows.push({actorKey,ref,sourceRefs,name:figure.name,aliases:figure.aliases || [],enabled:figure.enabled,
      appearance:figure.appearance,recall:figure.recall,figure,packName:pack.manifest.name})
  }
  return rows
}
export {resolution}
