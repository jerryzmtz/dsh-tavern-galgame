// private fork: provider selection belongs to TTS; no global reference route.
import test from 'node:test'
import assert from 'node:assert/strict'
import {assetVoiceBinding} from '../tavern-plugin/lib/fork-asset-runtime.js'
import {defaultAssetEngineSettings,patchAssetEngineSettings} from '../tavern-plugin/lib/domain/asset-engine-settings.js'
import {createTts} from '../tavern-plugin/packages/dsh-tts/src/service.js'
import {onlineSpec} from './fixtures/asset-packs/voice.mjs'
test('voice service setting is a validated provider-to-service map',()=>{
 const defaults=defaultAssetEngineSettings();assert.deepEqual(defaults.voiceServices,{})
 assert.deepEqual(patchAssetEngineSettings(defaults,{voiceServices:{'fish-audio':'fish'}}).voiceServices,{'fish-audio':'fish'})
 for(const voiceServices of [[],null,{azure:''},{azure:{id:'cloud'}},{'bad/key':'cloud'}])assert.throws(()=>patchAssetEngineSettings(defaults,{voiceServices}))
})
test('one compatible service defaults automatically; absent, ambiguous and stale selections stay silent',async t=>{
 const tts=createTts();t.after(()=>tts.dispose());const declaration={voice:onlineSpec(),binding:{voice:'actor'}}
 assert.equal(await assetVoiceBinding(undefined,{},declaration),null)
 assert.equal(await assetVoiceBinding(tts,{},declaration),null)
 tts.registerProvider('test',{id:'cloud',kind:'azure',revision:'1',capabilities:{paid:true},synthesize:()=>assert.fail('No synthesis')})
 tts.registerProvider('test',{id:'other',kind:'qwen',revision:'1',synthesize:()=>assert.fail('No synthesis')})
 // private fork: P1 confirmation binds the resolved provider revision, not only its ID.
 assert.deepEqual(await assetVoiceBinding(tts,{},declaration),{serviceId:'cloud',serviceRevision:'1',capabilities:{paid:true}})
 tts.registerProvider('test',{id:'second',kind:'azure',revision:'1',capabilities:{paid:true},synthesize:()=>assert.fail('No synthesis')})
 assert.equal(await assetVoiceBinding(tts,{},declaration),null)
 assert.equal((await assetVoiceBinding(tts,{azure:'second'},declaration)).serviceId,'second')
 for(const id of ['missing','other'])assert.equal(await assetVoiceBinding(tts,{azure:id},declaration),null)
 assert.equal(await assetVoiceBinding(tts,{reference:'cloud'},declaration),null)
})
