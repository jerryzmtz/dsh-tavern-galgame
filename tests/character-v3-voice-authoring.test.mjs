// private fork: real publication, independent preview grants, and byte exports.
// This P0 template is a Fish ordered list; personal local template slot authoring is P1.
import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdir,mkdtemp} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {join} from 'node:path'
import {createAssetPackService} from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/service.js'
import {createFigureVoiceAuthoring} from '../tavern-plugin/lib/fork-figure-voice-authoring.js'
import {createTts} from '../tavern-plugin/packages/dsh-tts/src/service.js'
import {referenceVoice} from './fixtures/asset-packs/voice.mjs'
import {syntheticPack,FIGURE_ID} from './fixtures/asset-packs/pack.mjs'

async function fixture(t,{health}={}) {
  const base=fileURLToPath(new URL('../.tmp/',import.meta.url));await mkdir(base,{recursive:true})
  const library=createAssetPackService({assetRoot:await mkdtemp(join(base,'figure-voice-')),authorizeLease:async()=>true})
  const synthetic=await syntheticPack(),voice=referenceVoice(synthetic),media={}
  for(const ref of Object.values(voice.references))media[ref.sha256]=synthetic.files.get('media/'+ref.sha256+'.wav').toString('base64')
  const tts=createTts(),calls=[]
  tts.registerProvider('fixture',{id:'local',kind:'fish-audio',revision:'v1',health:health || (async()=>({state:'ready'})),capabilities:{voiceKinds:['reference'],referenceInput:['bytes-list-v1'],paid:false,catalogue:true},catalog:async()=>[{id:'test/clone',label:'Clone',state:'ready',engine:'gpt-sovits',languages:['ja'],revision:'v1'}],
    exportVoice:async()=>({voice,media}),synthesize:async input=>{calls.push(input);return Buffer.from(Object.values(media)[0],'base64')}})
  const api=createFigureVoiceAuthoring({getLibrary:()=>library,getTts:()=>tts,getSettings:()=>({})})
  let pack=(await library.createPack({name:'Voices',expectedRevision:null})).snapshot
  pack=(await library.createFigure({packId:pack.manifest.id,expectedRevision:pack.revision,figure:{schemaVersion:1,id:FIGURE_ID,name:'Figure',enabled:true,outfits:[]}})).snapshot
  t.after(async()=>{api.dispose();await tts.dispose();await library.dispose()})
  const figureId=pack.manifest.figures[0]
  const input=()=>({packId:pack.manifest.id,figureId,expectedRevision:pack.revision})
  const assign=async extra=>{const result=await api.assign({...input(),voiceId:'test/clone',serviceId:'local',...extra});pack=result.snapshot;return pack}
  return {figureId,api,library,tts,calls,input,assign,voice,media,get pack(){return pack}}
}

test('portable export publishes figure and WAV closure atomically; clear removes only the voice',async t=>{
  const f=await fixture(t),before=f.input()
  const pack=await f.assign()
  assert.ok(pack.figures[f.figureId].voice.voice.startsWith('v-'))
  assert.deepEqual(pack.manifest.voiceLibrary.voices[pack.figures[f.figureId].voice.voice].sources.fish.references[0].text,f.voice.references[0].transcript)
  assert.ok(pack.manifest.blobs[f.voice.references[0].sha256])
  await assert.rejects(f.api.assign({...before,voiceId:'test/clone'}),{code:'REVISION_CONFLICT'})
  await f.assign({voiceId:null});assert.equal(f.pack.figures[f.figureId].voice,undefined)
  assert.equal(f.pack.figures[f.figureId].name,'Figure')
})

test('builtin provider presets copy parameters into the figure without paid synthesis or a global saved preset',async t=>{
  const f=await fixture(t);await f.assign({voiceId:'qwen/bella'})
  assert.equal(f.pack.manifest.voiceLibrary.voices[f.pack.figures[f.figureId].voice.voice].sources.qwen.provider,'qwen')
  assert.equal(f.pack.manifest.voiceLibrary.voices[f.pack.figures[f.figureId].voice.voice].sources.qwen.voiceName,'Bella')
  assert.equal(f.pack.manifest.voiceLibrary.voices[f.pack.figures[f.figureId].voice.voice].sources.qwen.engine,undefined)
  assert.equal(f.calls.length,0)
})

test('independent saved figure preview uses scoped jobs; edits revoke grant and ticket, no session needed',async t=>{
  const f=await fixture(t);await f.assign()
  await assert.rejects(f.api.open(f.input()),{code:'FORBIDDEN'})
  const grant=await f.api.open(f.input(),'http://localhost')
  assert.throws(()=>f.tts.jobs.submit({voice:grant.voice,text:'test',language:'ja'},{principal:'other',scope:grant.scope}),{code:'FORBIDDEN'})
  const job=f.tts.jobs.submit({voice:grant.voice,text:'test',language:'ja'},{principal:'dsh-browser',scope:grant.scope})
  let status
  for(let n=0;n<100;n++){status=f.tts.jobs.poll(job.requestId,'dsh-browser');if(status.state!=='running')break;await new Promise(r=>setTimeout(r,5))}
  assert.equal(status.state,'ready',JSON.stringify(status));assert.ok(await f.tts.redeemAudioTicket(status.result.ticket))
  assert.equal(f.calls.length,1);assert.equal(f.calls[0].voiceId,undefined);assert.equal(f.calls[0].reference.transcript,f.voice.references[0].transcript)
  await f.assign({voiceId:null})
  await assert.rejects(f.tts.redeemAudioTicket(status.result.ticket),{code:'AUDIO_GONE'})
  assert.throws(()=>f.tts.jobs.submit({voice:grant.voice,text:'test',language:'ja'},{principal:'dsh-browser',scope:grant.scope}),{code:'FORBIDDEN'})
})

test('machine invalidation fences an in-flight open before publishing a preview grant',async t=>{
  let resume,entered
  const gate=new Promise(resolve=>{resume=resolve}),started=new Promise(resolve=>{entered=resolve})
  const f=await fixture(t,{health:async()=>{entered();await gate;return {state:'ready'}}});await f.assign()
  const pending=f.api.open(f.input(),'http://localhost');await started
  f.api.invalidate();resume()
  await assert.rejects(pending,{code:'PLUGIN_UNAVAILABLE'})
  assert.equal(f.calls.length,0)
})

test('parallel preview opens respect the sixteen-grant bound',async t=>{
  const f=await fixture(t);await f.assign()
  const results=await Promise.allSettled(Array.from({length:17},()=>f.api.open(f.input(),'http://localhost')))
  assert.equal(results.filter(item=>item.status==='fulfilled').length,16)
  assert.equal(results.find(item=>item.status==='rejected').reason.code,'QUEUE_FULL')
  for(const result of results)if(result.status==='fulfilled')f.api.close(result.value.scope)
})

test('byte mismatch cannot publish a voice, cloud preview is refused before synthesis',async t=>{
  const f=await fixture(t);f.media[f.voice.references[0].sha256]=Buffer.alloc(50).toString('base64')
  await assert.rejects(f.assign(),{code:'INVALID_AUDIO'});assert.equal((await f.library.getPackSnapshot(f.input())).revision,f.pack.revision)
  f.tts.registerVoiceSource({owner:'fixture',sourceId:'voice-presets',revision:'one',voices:[{schemaVersion:1,id:'test/cloud',enabled:true,kind:'azure',label:'Cloud',languages:['ja'],params:{voiceName:'ja-JP-NanamiNeural'}}]})
  await f.assign({voiceId:'test/cloud'})
  f.tts.registerProvider('fixture',{id:'cloud',kind:'azure',revision:'one',capabilities:{paid:true},synthesize:()=>assert.fail('No paid synthesis')})
  await assert.rejects(f.api.open(f.input(),'http://localhost'),{code:'PAID_PREVIEW_DISABLED'});assert.equal(f.calls.length,0)
})
