// private fork: one in-memory fixture for production prompt/protocol regressions and offline preview.
import { syntheticPack, cardExtension, PACK_ID, FIGURE_ID } from '../fixtures/asset-packs/pack.mjs'
import { assetRefKey } from '../../tavern-plugin/packages/dsh-presentation-protocol/src/asset-packs.js'
import { initialAssetPackStage } from '../../tavern-plugin/lib/domain/stage-asset-pack-tools.js'
import { prepareAssetPackDirector } from '../../tavern-plugin/lib/domain/stage-asset-pack-director.js'
export async function productionDirectorFixture(overrides = {}) {
  const pack = await syntheticPack()
  const assetStatus = {}, widgetAuthorizations = {}
  for (const asset of pack.manifest.assets) {
    const key = assetRefKey({packId: PACK_ID, kind: asset.kind, assetId: asset.id})
    assetStatus[key] = {available: true, executableDigest: 'a'.repeat(64)}
    widgetAuthorizations[key] = 'a'.repeat(64)
  }
  const input = {
    snapshots: [{manifest: pack.manifest, figures: pack.figures, widgets: pack.widgets, revision: 'fixture'}], assetStatus,
    raw: {extensions: {dsh_tavern: cardExtension()}}, cardRevision: 'fixture',
    engine: {widgetsEnabled: true, widgetAuthorizations},
    baseline: initialAssetPackStage({actor: {figure: {packId: PACK_ID, figureId: FIGURE_ID}, outfits: []}}),
    target: {sourceKey: 'fixture', branchId: 'fixture', revision: 1},
    units: ['Synthetic fixture: rain outside.', 'The last visitor leaves and opens the window.', 'Visitors return and close the window.'],
    ...overrides
  }
  return {input, prepared: prepareAssetPackDirector(input)}
}
