import assert from 'node:assert/strict'
import path from 'node:path'
import {createAssetPackService} from '../../tavern-plugin/packages/dsh-asset-library/src/pack-v2/service.js'
import { createPluginHost } from './plugin-host.mjs'
import { BUBBLE_WORLDBOOK_COMMENT } from '../../tavern-plugin/lib/domain/dialogue-bubbles.js'
import { cardExtension, PACK_ID, FIGURE_ID } from './asset-packs/pack.mjs'

const host = await createPluginHost()
try {
  // Exercise the production HTTP envelope, not a direct dispatcher mock.
  assert.deepEqual((await host.rpc('getAssetVoiceServices')).services, [])
  host.services.set('tts', {apiVersion:1,listServices:async () => [{id:'local',kind:'reference-api',capabilities:{voiceKinds:['reference'],paid:false}}]})
  const voiceServices = await host.rpc('getAssetVoiceServices')
  assert.deepEqual(voiceServices.services, [{id:'local',kind:'reference-api',capabilities:{voiceKinds:['reference'],paid:false}}])
  assert.equal(Object.hasOwn(voiceServices,'0'), false)
  host.services.set('tts', {apiVersion:2,listServices:() => {throw new Error('incompatible')}})
  assert.deepEqual((await host.rpc('getAssetVoiceServices')).services, [])
  host.services.delete('tts')
  for (const [method,field] of [['listFonts','fonts'],['listCards','cards'],['listResources','resources'],['listWorldBooks','standalone'],['listPresets','presets'],['listSessions','sessions'],['listMobileCardImports','files'],['listSkills','skills']]) {
    const result = await host.rpc(method)
    assert.ok(Array.isArray(result[field]), method + ' has a named array')
    assert.equal(Object.hasOwn(result,'0'), false, method)
  }
  const settings = await host.rpc('getAssetEngineSettings')
  assert.equal(Object.hasOwn(settings.values,'widgetExecutionEnabled'), false)
  assert.equal(settings.live, true)
  for (const format of ['flat', 'chara_card_v2', 'chara_card_v3']) {
    const data = {name:'P2 ' + format, description:'Text', unknown:{keep:true}, extensions:{foreign:{keep:true}}}
    const raw = format === 'flat' ? data : {spec:format, spec_version:format.endsWith('v2') ? '2.0' : '3.0', data}
    const imported = await host.rpc('importCard', {payload:{name:format + '.json', text:JSON.stringify(raw)}})
    const path = imported.card.path
    const initial = await host.rpc('getCardAssetBindings', {path})
    assert.equal(initial.active, false)
    const extension = cardExtension()
    const saved = await host.rpc('saveCardAssetBindings', {path, expectedRevision:initial.revision, patch:{assetBindings:extension.assetBindings}})
    assert.deepEqual(saved.extension.assetBindings, extension.assetBindings)
    const missing = await host.rpc('getCardAssetBindings', {path})
    assert.equal(missing.revision, saved.revision)
    assert.equal(missing.available, false); assert.equal(missing.active, true)
    await host.rpc('updateCard', {path, patch:{description:'Text still works'}})
    await assert.rejects(host.rpc('saveCardAssetBindings', {path, expectedRevision:saved.revision, patch:{stage:{}}}), /Card changed/)
    host.services.set('assetLibrary', {apiVersion:2, capabilities:['packs','figures'], listPacks() {}, resolveFigures() {}, getPackSnapshot:async ({packId}) => ({manifest:{id:packId, figures:[FIGURE_ID]}})})
    assert.equal((await host.rpc('getCardAssetBindings', {path})).live, true)
    host.services.delete('assetLibrary')
    assert.equal((await host.rpc('getCardAssetBindings', {path})).available, false)
    const exported = await host.rpc('exportCard', {path})
    // private fork: bindings RPC persists a managed entry and returns the post-sync revision.
    assert.equal(exported.document.data.character_book.entries.filter(entry => entry.comment === BUBBLE_WORLDBOOK_COMMENT).length, 1)
    assert.equal(exported.document.data.description, 'Text still works')
    assert.deepEqual((format === 'flat' ? exported.document : exported.document.data).unknown, {keep:true})
    // private fork: first opt-in stores explicit card-centric switch defaults.
    assert.deepEqual(exported.document.data.extensions.dsh_tavern, extension)
    assert.deepEqual(exported.document.data.extensions.foreign, {keep:true})
  }
  assert.equal((await host.rpc('getAssetPackDependencies', {packId:PACK_ID})).count, 3)
  assert.equal((await host.services.get('tavernAssetDependencies').get({packId:PACK_ID})).count, 3)
  const packs=createAssetPackService({assetRoot:path.join(process.env.DSH_HOME,'config-packs'),cardTransactions:host.services.get('tavernAssetCards')})
  host.services.set('assetLibrary',packs)
  try {
    const imported=await host.rpc('importCard',{payload:{name:'config.json',text:JSON.stringify({name:'Config host smoke'})}})
    const {cardId}=await host.rpc('getCardAssetBindings',{path:imported.card.path})
    const configRpc=(method,args)=>host.rpc(method,args,{host:'localhost:43120',origin:'http://localhost:43120'})
    const initial=await configRpc('getModConfig',{modId:'dsh.phone',cardId})
    await configRpc('setModConfig',{modId:'dsh.phone',cardId,layer:'card',key:'battery',value:{fixed:42},expectedRevision:initial.revision})
    assert.equal((await configRpc('resolveModConfig',{modId:'dsh.phone',cardId,key:'battery'})).value,42)
    assert.equal((await packs.listPacks())[0].privateConfig,true)
    assert.ok((await configRpc('listModConfigSources',{cardId})).sources.some(source=>source.id==='stage'))
  } finally {await packs.dispose()}
  console.log('asset packs backend RPC smoke passed; mounted mod config RPC verified')
} finally { await host.dispose() }
