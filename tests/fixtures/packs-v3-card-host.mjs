// private fork: isolated production dispatcher checks, independent of the ZIP/worldbook suite.
import assert from 'node:assert/strict'
import { createPluginHost } from './plugin-host.mjs'
import { createProfileDataStore } from '../../tavern-plugin/lib/profile-data-store.js'
import { resolveTavernDataRoot } from '../../tavern-plugin/lib/domain/tavern-data.js'
import { createCardPreparation } from '../../tavern-plugin/lib/domain/card-preparation.js'
import { cardExtension, PACK_ID, OTHER_PACK_ID } from './asset-packs/pack.mjs'

const store = createProfileDataStore({dataRoot:resolveTavernDataRoot()}), prep = createCardPreparation()
const extension = cardExtension()
extension.assetBindings = {boundPackIds:[PACK_ID,OTHER_PACK_ID]}
await store.writeJson('resources/cards/source.json',prep.create({kind:'import',payload:{name:'Source',extensions:{dsh_tavern:extension}}}))
await store.writeJson('resources/cards/target.json',prep.create({kind:'import',payload:{name:'Target'}}))
const host = await createPluginHost()
const globalOnly = '99999999-9999-4999-8999-999999999999'
host.services.set('assetPackSettings',{read:() => ({values:{globalEnabledPackIds:[PACK_ID,globalOnly]}})})
try {
  // private fork (v3.1 r2): getPackBindingCounts is retired with the library's 「N 张卡」 cell.
  for (const method of ['ensureCardOwnedPack','setCardOwnedPack','copyFigureToCard','getPackBindingCounts']) await assert.rejects(host.rpc(method,{path:'cards/target.json'}),/未知方法/)
  const blank = await host.rpc('getCardAssetBindings',{path:'cards/target.json'})
  await assert.rejects(host.rpc('saveCardAssetBindings',{path:'cards/target.json',expectedRevision:blank.revision,patch:{ownedPackId:PACK_ID}}))
  const bound = await host.rpc('saveCardAssetBindings',{path:'cards/target.json',expectedRevision:blank.revision,patch:{assetBindings:{boundPackIds:[PACK_ID]}}})
  assert.deepEqual(bound.extension.assetBindings.boundPackIds,[PACK_ID])
  await host.rpc('saveCardAssetBindings',{path:'cards/target.json',expectedRevision:bound.revision,patch:{assetBindings:{boundPackIds:[]}}})
  assert.deepEqual((await host.rpc('getCardAssetBindings',{path:'cards/target.json'})).extension.assetBindings.boundPackIds,[])
  assert.deepEqual((await host.rpc('getCardAssetBindings',{path:'cards/source.json'})).extension.assetBindings.boundPackIds,[PACK_ID,OTHER_PACK_ID])
  console.log('packs-v3 production bindings passed')
} finally { await host.dispose() }
