// private fork: author documents share the pack's identity and closed dependency rules.
import contract from '../shared/stage-performance.cjs'
import {check} from '../asset-packs/common.js'
const {validateStagePerformance, performanceReferences} = contract
export function validatePerformancePack(manifest, performances, skins) {
  const assets = manifest.assets.filter(asset => asset.kind === 'performances')
  if (!assets.length) return performances
  const themeIds = new Set(Object.keys(skins)), assetKeys = new Set(manifest.assets.map(asset => asset.kind + '/' + asset.id))
  for (const asset of assets) {
    const document = validateStagePerformance(performances[asset.id])
    if (document.theme) {
      check(!themeIds.has(document.theme.id), '$.performances.' + asset.id, 'Ambiguous embedded theme identity', 'INVALID_PERFORMANCE')
      themeIds.add(document.theme.id)
    }
    check(document.id === asset.id, '$.performances.' + asset.id, 'Performance identity differs from asset', 'INVALID_PERFORMANCE')
    for (const {ref} of performanceReferences(document, manifest.id)) if (ref.packId === manifest.id) {
      check(assetKeys.has(ref.kind + '/' + ref.assetId), '$.performances.' + asset.id, 'Missing local performance reference: ' + ref.kind + '/' + ref.assetId, 'MISSING_DEPENDENCY')
    }
    for (const block of Object.values(document.timeline)) for (const event of block.events) if (event.do === 'skin' && event.level !== undefined) {
      const [alias, id] = event.ref.split(':')
      if (alias === 'self' || document.packs[alias] === manifest.id) {
        check((alias === 'self' && id === document.theme?.id ? document.theme : skins[id])?.levels?.[event.level], '$.performances.' + asset.id, 'Performance requests an undeclared skin level', 'INVALID_PERFORMANCE')
      }
    }
  }
  return performances
}
