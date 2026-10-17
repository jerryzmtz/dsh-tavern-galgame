// Exercise apply -> HTTP carrier -> dispatch -> dispatchMethod, with no live data/model.
import assert from 'node:assert/strict'
import {createPluginHost} from './plugin-host.mjs'
import {fixture,answer} from '../helpers/stage-director-harness.mjs'
import {createProfileDataStore} from '../../tavern-plugin/lib/profile-data-store.js'
import {resolveTavernDataRoot} from '../../tavern-plugin/lib/domain/tavern-data.js'
import {createCardPreparation} from '../../tavern-plugin/lib/domain/card-preparation.js'
import {createTavernExtensionSettings} from '../../tavern-plugin/lib/domain/tavern-extension-settings.js'
import {createAssetPackService} from '../../tavern-plugin/packages/dsh-asset-library/src/pack-v2/service.js'
import {join} from 'node:path'

const f=await fixture(request=>request.onToolCall({name:'stage_update',arguments:answer}))
let host, createdLibrary
try {
  await f.director.get(f.read());await f.director.drain()
  const store=createProfileDataStore({dataRoot:resolveTavernDataRoot()})
  await store.writeJson('resources/cards/a.json',createCardPreparation().create({kind:'import',payload:f.workspace.raw}))
  await store.writeJson('sessions.json',{session:'chat'})
  await store.writeJson('chats/chat.json',{...f.read(),backgroundConfigVersion:1,conversationFeaturesVersion:1})
  await createTavernExtensionSettings(store).save({EjsTemplate:{enabled:true,autosave_enabled:true}}, {})
  host=await createPluginHost()
  const library=f.services.get('assetLibrary')
  library.listPacks=async()=>[await library.getPackSnapshot({packId:f.workspace.raw.extensions.dsh_tavern.assetBindings.boundPackIds[0]})]
  host.services.set('assetLibrary',library)
  const headers={host:'localhost:43120',origin:'http://localhost:43120'}
  // private fork: binding search is retired; stage dispatch remains exercised.
  const direction=await host.rpc('getStageDirection',{sessionId:'session',turn:1,readOnly:true},headers)
  assert.equal(direction.status,'done',JSON.stringify(direction))
  const args={sessionId:'session',turn:1,at:1,expectedDirectionToken:direction.token}
  // P5 moved the performance gate into this RPC: resolve its own session, not a sibling scope's chat.
  const missing=await host.rpc('getAssetPackPresentation',{...args,sessionId:'missing'},headers)
  assert.equal(missing.status,'stale',JSON.stringify(missing))
  assert.equal(missing.directionToken,null)
  const presentation=await host.rpc('getAssetPackPresentation',args,headers)
  assert.equal(presentation.status,'ready',JSON.stringify(presentation))
  assert.equal(presentation.value.scene.background.assetId,'classroom')
  assert.deepEqual(presentation.directionToken,direction.token)
  assert.ok(presentation.value.characters.length)
  const history=await host.rpc('getAssetPackPresentation',{...args,history:true},headers)
  assert.equal(history.status,'ready',JSON.stringify(history))
  assert.deepEqual(history.directionToken,direction.token)
  // Origin is necessary for media, never sufficient for server-template privilege.
  for(const method of ['executeTemplateHostCommand','getPromptTemplateHistory','saveFullPromptTemplateGlobals','saveFullPromptTemplateState']) {
    await assert.rejects(host.rpc(method,{sessionId:'session',text:'/trigger',serverTemplate:true},headers),/server-only|服务端/)
  }
  const withoutOrigin=await host.rpc('getAssetPackPresentation',args)
  assert.equal(withoutOrigin.status,'failed')
  assert.match(withoutOrigin.error.message,/same-origin carrier/)
  // Speech uses the same authority parameter even when no voice provider is installed.
  assert.equal((await host.rpc('openAssetPackVoice',{sessionId:'session',alias:'actor'},headers)).available,false)
  await assert.rejects(host.rpc('openAssetPackVoice',{sessionId:'session',alias:'actor'}),/same-origin carrier/)
  await host.rpc('executeFullTemplateCommand',{sessionId:'session',text:'/ejs <% setMessageVar("dispatcherRegression",7); setGlobalVar("dispatcherRegression",9) %>'},headers)
  const state=await host.rpc('getFullPromptTemplateState',{sessionId:'session'},headers)
  assert.equal(state.state.chat[0].variables[0].dispatcherRegression,7)
  assert.equal(state.environment.extension_settings.variables.global.dispatcherRegression,9)
  // private fork: the removed create-and-bind RPC is not a stage capability.
  assert.equal(f.calls.length,1,'only the fixture model is invoked')
  console.log('stage dispatcher authority and server template privileges passed')
} finally {await host?.dispose();await createdLibrary?.dispose();await f.dispose()}
