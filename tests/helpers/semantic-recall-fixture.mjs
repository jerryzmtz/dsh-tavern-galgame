// private fork: synthetic inputs only, never user packs or chats.
import { syntheticPack, cardExtension, PACK_ID } from '../fixtures/asset-packs/pack.mjs'
import { assetRefKey } from '../../tavern-plugin/packages/dsh-presentation-protocol/src/asset-packs.js'
import { defaultAssetEngineSettings } from '../../tavern-plugin/lib/domain/asset-engine-settings.js'
import { prepareAssetPackDirector } from '../../tavern-plugin/lib/domain/stage-asset-pack-director.js'
export async function recallFixture(count = 20) {
  const pack = await syntheticPack()
  const template = pack.manifest.assets.find(row => row.kind === 'music')
  pack.manifest.assets = ['music','backgrounds','sfx','ambience'].flatMap(kind => Array.from({length:count},(_,i) => ({...structuredClone(template),kind,id:'asset-' + i,name:kind + '-name-' + i,recall:{mode:'keyword',keywords:[]}})))
  const snapshot = {...pack,revision:'r1'}
  const assetStatus = Object.fromEntries(pack.manifest.assets.map(asset => [assetRefKey({packId:PACK_ID,kind:asset.kind,assetId:asset.id}),{available:true}]))
  const engine = defaultAssetEngineSettings()
  const input = {snapshots:[snapshot],assetStatus,raw:{extensions:{dsh_tavern:cardExtension()}},cardRevision:'c1',target:{sourceKey:'source',branchId:'b',revision:1},engine,units:['A quiet synthetic evening.']}
  return {pack:snapshot,input,prepare:extra => prepareAssetPackDirector({...input,...extra})}
}
