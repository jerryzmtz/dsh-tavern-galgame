import {CORE_TIME_PARAMS} from '../tavern-plugin/packages/dsh-presentation-protocol/src/stage-time.js'
// private fork: synthetic pack assertions use canonical emotion ownership, not free-form state identities.
// private fork: current reading dictionary fixtures.
import { normalizeReadingEntries } from '../tavern-plugin/packages/dsh-tts/src/reading-dictionary.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,readFile} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {createRequire} from 'node:module'
import {syntheticPack,PACK_ID,FIGURE_ID,OTHER_FIGURE_ID,cardExtension} from './fixtures/asset-packs/pack.mjs'
import {createAssetPackService} from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/service.js'
import {sealPack,jsonBytes} from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/validation.js'
import {writeZip} from '../tavern-plugin/packages/dsh-asset-library/src/zip.js'
import {createAssetPackPresentation,selectPackFigure,packGeometryKey} from '../tavern-plugin/lib/domain/asset-pack-presentation.js'
import {createAssetPackSpeech} from '../tavern-plugin/lib/domain/asset-pack-speech.js'
import {createTts} from '../tavern-plugin/packages/dsh-tts/src/service.js'
import {reduceAssetPackScene} from '../tavern-plugin/packages/dsh-presentation-protocol/src/asset-pack-stage.js'
const require = createRequire(import.meta.url)
const {createPackCalibration,packSpriteViews:viewsFor,packFigureRenderInputs,createPackVoicePlayer} = require('../tavern-plugin/src/client/fork-pack-playback.cjs')
const spriteContract = require('../tavern-plugin/src/client/fork-layered-sprite.cjs')
const {forkSpriteAtlas,forkSpriteFrame,forkSpriteVoiceStep} = spriteContract
const packSpriteViews = figure => viewsFor(figure,spriteContract)
const ref = {packId:PACK_ID,figureId:FIGURE_ID}, background = {packId:PACK_ID,kind:'backgrounds',assetId:'classroom'}
const rawFor = extension => ({extensions:{dsh_tavern:extension}})
// private fork: effective packages replace card-local figure bindings.
const extension = cardExtension
async function fixture(t, mutate = () => {}) {
  const root = await mkdtemp(path.join(os.tmpdir(),'pack-presentation-')), pack = await syntheticPack()
  mutate(pack); pack.files.set(`figures/${FIGURE_ID}.json`,jsonBytes(pack.figures[FIGURE_ID])); await sealPack(pack.manifest,pack.files)
  const zip = path.join(root,'pack.zip'); await writeZip(zip,[{path:'manifest.json',data:jsonBytes(pack.manifest)},...[...pack.files].map(([path,data]) => ({path,data}))])
  const service = createAssetPackService({assetRoot:path.join(root,'assets'),authorizeLease:async () => true})
  const inspect = await service.inspectImport({bytes:await readFile(zip)})
  await service.applyImport({inspectionId:inspect.inspectionId,expectedRevision:null,decision:'install'})
  let now = Date.now()
  const ext = extension(), consumer = createAssetPackPresentation({now:() => now,raw:rawFor(ext),getService:() => service,origin:'http://localhost',scope:'test'})
  t.after(async () => { consumer.dispose(); await service.dispose(); await rm(root,{recursive:true,force:true}) })
  return {pack,service,consumer,ext,expireTickets:() => {now += 3600000}}
}

// private fork: canonical figure IDs differ from display names and card aliases.
for (const unavailable of ['removed','disabled']) test(`persisted ${unavailable} outfit projects the current default without rewriting history`, async t => {
  const {pack,consumer} = await fixture(t, pack => {
    const figure = pack.figures[FIGURE_ID]
    figure.appearance = 'live2d'
    if (unavailable === 'removed') figure.outfits[1].key = 'replacement'
    else figure.outfits[1].enabled = false
  })
  assert.notEqual(FIGURE_ID,pack.figures[FIGURE_ID].name)
  assert.notEqual(FIGURE_ID,'actor')
  const actor = {figure:ref,outfitKey:'casual'}, before = structuredClone(actor)
  const projected = await consumer.materialize(await consumer.character('actor',{historical:true,actor,emotion:'crying'}))
  assert.equal(projected.outfitKey,'school')
  assert.equal(projected.form,'sprite')
  assert.ok(projected.diagnostics.includes('outfit-fallback'))
  assert.ok(projected.diagnostics.includes('stage-form-unavailable'))
  assert.ok(projected.state.mouthSet)
  assert.deepEqual(actor,before)
  const disabled = structuredClone(pack.figures[FIGURE_ID])
  disabled.outfits.forEach(outfit => {outfit.enabled = false})
  assert.equal(selectPackFigure(disabled,pack.sprites,{outfitKey:'casual'}).form,null)
})

test('new renderer gate leaves absent-extension legacy inputs and ports untouched', () => {
  let calls = 0
  assert.equal(createAssetPackPresentation({raw:{},getService:() => { calls++; throw new Error() }}),null)
  assert.equal(createAssetPackPresentation({raw:rawFor({schemaVersion:1,legacyField:true}),getService:() => { calls++; throw new Error() }}),null)
  assert.equal(createAssetPackSpeech({presentation:null}),null)
  assert.equal(calls,0)
})

test('special and crying select one state/mouthSet for stage and portrait with outfit-only faces', async t => {
  const {consumer,pack} = await fixture(t)
  for (const emotion of ['crying','crying']) {
    const selected = await consumer.character('actor',{emotion})
    assert.equal(selected.state.id,'crying')
    const figure = await consumer.materialize(selected), views = packSpriteViews(figure)
    assert.equal(views.stage.state,views.portrait.state)
    assert.equal(forkSpriteAtlas(views.stage.pack,views.stage.state),views.stage.pack.mouthSets.special)
    assert.deepEqual(forkSpriteFrame(views.stage.pack,views.stage.state,'a'),forkSpriteFrame(views.portrait.pack,views.portrait.state,'a'))
    assert.ok(views.stage.view.mouthByFrame); assert.ok(views.portrait.view.mouthOcclusionMask)
    assert.equal(figure.spritePack.mouthSets.unused,undefined) // private fork: unused media cannot be installed.
    // private fork: a dedicated state avatar wins over a sprite crop.
    assert.equal(selected.avatar,pack.figures[FIGURE_ID].outfits[0].avatars.crying)
    assert.equal(packSpriteViews(await consumer.materialize(selected,{stage:false})).stage,null)
    assert.equal(packSpriteViews(await consumer.materialize(selected,{portrait:false})).portrait,null)
  }
  // private fork: removing own art leaves a missing slot, not an authored mapping.
  const custom = structuredClone(pack.figures[FIGURE_ID])
  const noCrying = structuredClone(pack.sprites); noCrying.school.emotions = {calm:noCrying.school.emotions.calm}
  assert.equal(selectPackFigure(custom,noCrying,{emotion:'crying'}).state.id,'calm')
  const audio = {paused:true,currentTime:0}
  const stopped = forkSpriteVoiceStep({audio,started:true,at:1,changed:1,time:0},audio,1,true,2)
  assert.equal(stopped.event,'closed')
})

test('form preference, flat sprites, missing portrait, disabled outfits and voice-only figures do not borrow faces', async t => {
  const {pack,consumer} = await fixture(t)
  const figure = pack.figures[FIGURE_ID]
  assert.equal(selectPackFigure(figure,pack.sprites,{outfitKey:'casual'}).form,'live2d')
  // private fork: appearance belongs to the figure; stageForm is never consulted.
  assert.equal(selectPackFigure(figure,pack.sprites,{outfitKey:'casual',appearance:'sprite'}).form,'sprite')
  assert.deepEqual(selectPackFigure(figure,pack.sprites,{appearance:'live2d'}).diagnostics,['stage-form-unavailable'])
  assert.equal(selectPackFigure(figure,pack.sprites,{outfitKey:'deleted'}).outfitKey,'school')
  assert.equal(selectPackFigure({...figure,outfits:[]},{}).form,null)
  const casual = await consumer.materialize(await consumer.character('actor',{actor:{outfitKey:'casual'}}))
  assert.ok(casual.modelUrl.endsWith('/model.model3.json'))
  assert.ok(casual.avatarUrl)
  assert.equal(packSpriteViews(casual).portrait,null)
  const absent = await consumer.character('actor',{historical:true,actor:{figure:{...ref,figureId:OTHER_FIGURE_ID},outfitKey:'school'}})
  assert.equal(absent.form,null); assert.equal(absent.avatar,undefined)
  const historical = await consumer.character('not-in-current-card',{historical:true,actor:{figure:ref,outfitKey:'school'}})
  assert.equal(historical.outfitKey,'school')
})

// private fork (new-user journey 2026-10): no Cubism Core = the same ladder as an outfit without a model.
test('missing Cubism Core shows the outfit sprite through the appearance ladder, and nothing without one', async t => {
  const {pack,consumer} = await fixture(t)
  const figure = pack.figures[FIGURE_ID], actor = {outfitKey:'casual'}
  const fallback = await consumer.character('actor',{actor,live2d:false})
  assert.equal(fallback.form,'sprite')
  assert.ok(fallback.diagnostics.includes('live2d-core-missing'))
  const shown = await consumer.materialize(fallback)
  assert.equal(shown.modelUrl,null); assert.equal(packFigureRenderInputs(shown,{},spriteContract).stage.kind,'static')
  // The cached projection for an installed Core is a different entry: Live2D comes back without a reload.
  const installed = await consumer.character('actor',{actor})
  assert.equal(installed.form,'live2d'); assert.ok(!installed.diagnostics.includes('live2d-core-missing'))
  // A Live2D-only outfit stays missing on the stage (no placeholder).
  const live2dOnly = {...figure,outfits:figure.outfits.map(outfit => outfit.key === 'casual' ? {...outfit,sprite:undefined} : outfit)}
  const missing = selectPackFigure(live2dOnly,pack.sprites,{outfitKey:'casual',live2d:false})
  assert.equal(missing.form,'avatar'); assert.ok(missing.diagnostics.includes('live2d-core-missing'))
  assert.equal(selectPackFigure(figure,pack.sprites,{outfitKey:'school',live2d:false}).diagnostics.includes('live2d-core-missing'),false)
})

test('avatar appearance keeps portrait and speech without acquiring a stage model', async t => {
  const {service,pack} = await fixture(t,p=>{p.figures[FIGURE_ID].appearance='avatar'}), ext = extension()
  const consumer = createAssetPackPresentation({raw:rawFor(ext),getService:() => service,origin:'http://localhost',scope:'offstage'})
  t.after(() => consumer.dispose())
  const figure = await consumer.materialize(await consumer.character('actor',{emotion:'crying'}))
  assert.equal(packSpriteViews(figure).stage,null); assert.ok(packSpriteViews(figure).portrait)
  // private fork: avatar-only casting still uses the uploaded emotion avatar.
  assert.equal(figure.avatar,pack.figures[FIGURE_ID].outfits[0].avatars.crying)
})

test('hash-keyed derived calibration ignores labels/height but remeasures new media, view and state', async t => {
  const {service,consumer,pack} = await fixture(t)
  let measures = 0, placements = 0
  const calibration = createPackCalibration({measure:() => ++measures,place:(geometry,input) => ({geometry,input,n:++placements})})
  const first = await consumer.character('actor')
  await calibration.placement(first,'stage',{viewport:[800,600]})
  await calibration.placement(first,'stage',{viewport:[1200,600]})
  assert.equal(measures,1); assert.equal(placements,2)
  const copy = structuredClone(pack), selection = selectPackFigure(copy.figures[FIGURE_ID],copy.sprites)
  const original = packGeometryKey(selection,copy)
  copy.figures[FIGURE_ID].name = 'renamed'; copy.figures[FIGURE_ID].heightCm = 180
  assert.equal(packGeometryKey(selectPackFigure(copy.figures[FIGURE_ID],copy.sprites),copy),original)
  const snap = await service.getPackSnapshot({packId:PACK_ID}), outfits = structuredClone(snap.figures[FIGURE_ID].outfits)
  outfits[0].sprite.assets['assets/stage.png'] = pack.manifest.assets[0].variants.entries[0].content.media
  await service.patchFigure({packId:PACK_ID,figureId:FIGURE_ID,expectedRevision:snap.revision,patch:{outfits}})
  const changed = await consumer.character('actor')
  assert.notEqual(changed.geometry.stage,first.geometry.stage)
  await calibration.placement(changed,'stage',{}); await calibration.placement(changed,'portrait',{})
  await calibration.placement(await consumer.character('actor',{emotion:'crying'}),'stage',{})
  assert.equal(measures,4)
})

const sceneState = time => ({scene:{background,timeOfDay:time,timeLook:null},lighting:{time:{mode:'auto',ref:null},mood:null},camera:{mode:'close',actor:'actor'},widgets:{keep:{lifetime:{until:'scene-change'}}},sound:['keep'],soundscape:{keep:true}})
test('explicit day to night preserves location state, recorded time choices and transition duration', async t => {
  const {consumer,pack} = await fixture(t), start = sceneState('day')
  const night = reduceAssetPackScene(start,{background,timeOfDay:'night'},[])
  assert.equal(night.locationChanged,false); assert.equal(night.transitionMs,2500)
  assert.deepEqual(night.state.camera,start.camera); assert.deepEqual(night.state.widgets,start.widgets)
  assert.deepEqual(night.diagnostics,[])
  const day = await consumer.scene(start), projected = await consumer.scene(night.state,{timeTransitionMs:night.transitionMs})
  assert.notEqual(day.backgroundUrl,projected.backgroundUrl)
  assert.equal(day.backgroundName,'Synthetic backgrounds')
  assert.equal(projected.backgroundName,day.backgroundName)
  assert.deepEqual(projected.time.params,CORE_TIME_PARAMS.night); assert.equal(projected.timeTransitionMs,2500)
  assert.equal((await consumer.scene(night.state,{timeTransitionMs:2500,snap:true})).timeTransitionMs,0)
  const looks = [{ref:{packId:PACK_ID,kind:'looks',assetId:'dusk'},layer:'time',timeOfDay:'dusk'}]
  const dusk = reduceAssetPackScene(start,{background,timeOfDay:'dusk'},looks)
  const rendered = await consumer.scene(dusk.state)
  assert.equal(rendered.timeMatched,true); assert.equal(rendered.compensateBackground,false); assert.deepEqual(rendered.time.params,CORE_TIME_PARAMS.dusk)
  const ambiguous = reduceAssetPackScene(start,{background,timeOfDay:'dusk'},[...looks,{...looks[0],ref:{...looks[0].ref,assetId:'other'}}])
  assert.deepEqual(ambiguous.diagnostics,[])
  assert.deepEqual((await consumer.scene(ambiguous.state)).time.params,CORE_TIME_PARAMS.dusk)
  assert.equal(pack.manifest.assets[0].variants.entries.find(row=>row.id==='night').content.media,pack.manifest.assets[0].variants.entries.find(row=>row.id==='dusk').content.media)
})

test('resolution is cached, leases lazy, pack revisions refresh candidates, missing plugin rejects', async t => {
  const {service} = await fixture(t); let reads = 0, leases = 0, selected = service
  const wrapper = {...service,resolveFigures(input) { reads++; return service.resolveFigures(input) },leaseMedia(input) { leases++; return service.leaseMedia(input) }}
  selected = wrapper
  const consumer = createAssetPackPresentation({raw:rawFor(extension()),getService:() => selected,origin:'http://localhost',scope:'cached'})
  t.after(() => consumer.dispose())
  const first = await consumer.character('actor'); await consumer.character('actor')
  assert.equal(reads,1); assert.equal(leases,0)
  await consumer.materialize(first); const count = leases; await consumer.materialize(first)
  assert.equal(leases,count)
  selected = null
  // private fork: transport/service failure is not a successful empty projection.
  await assert.rejects(consumer.character('actor'),{code:'ASSET_UNAVAILABLE'})
  await assert.rejects(consumer.scene(sceneState('day')),{code:'ASSET_UNAVAILABLE'})
  selected = wrapper
  assert.equal((await consumer.character('actor')).form,'sprite')
})

// private fork: figures own presets; the existing TTS source/grant seam scopes them.
function cardSpeechFixture(t) {
  const figure={enabled:true,voice:{voice:'backend-voice'}},voiceSpec={name:'Fixture',language:'ja',defaultSource:'azure',sources:{azure:{kind:'preset',provider:'azure',voiceName:'ja-JP-NanamiNeural'}}};
  const extension={stage:{},assetBindings:{boundPackIds:[PACK_ID]}};
  const native = () => {
    const sources=new Map();
    return {apiVersion:1,subscribe:()=>()=>{},resolveVoiceService:async()=>({effective:{serviceId:'azure',capabilities:{}},issues:[]}),
      registerVoiceSource(input){sources.set(input.sourceId,input);return {source:input.sourceId,dispose(){sources.delete(input.sourceId)}}},
      grantConsumer:()=>({grant:{},dispose(){}}),
      synthesize:async input=>({...input,registered:sources.get(input.voice.source)})};
  };
  let service=native(),listener;
  // private fork: fake presentation implements the same exact-name seam as the production owner.
  const presentation={extension,resolveName:async alias=>alias==='actor'?{status:'resolved',ref}:{status:'unknown'},resolveFigure:async()=>({value:figure,voiceSpec,revision:'r1'}),subscribe(fn){listener=fn;return()=>{listener=null}}};
  const engine={stageToggles:{voice:true}};const speech=createAssetPackSpeech({presentation,getEngine:()=>engine,getTts:()=>service});t.after(()=>speech.dispose());
  return {extension,figure,speech,native,engine,setService:value=>{service=value},invalidate:()=>listener?.()};
}
test('figure voice scope, language and mood reach TTS without global voice lookup; readings stay global in dsh-tts',async t=>{
  const f=cardSpeechFixture(t), selected=await f.speech.open('actor');
  assert.equal(selected.voiceId,'backend-voice');assert.equal(selected.available,true);
  const result=await f.speech.synthesize('actor',{text:'example',mood:'sad'});
  assert.ok(result.voice.source.startsWith('figure:'+PACK_ID+':'+FIGURE_ID+':'));
  assert.equal(result.voice.id,'voice');assert.equal(result.text,'example');assert.equal(result.mood,'sad');assert.equal(result.language,'ja');
  assert.equal(Object.hasOwn(result.registered,'readings'),false,'a figure source carries no dictionary');
  f.figure.voice.language='en';f.invalidate();
  const changed=await f.speech.synthesize('actor',{text:'hello'});assert.equal(changed.language,'en');
  assert.notEqual(changed.voice.source,result.voice.source);
});
test('missing figure voice stays silent and the global voice switch is authoritative',async t=>{
  const f=cardSpeechFixture(t), voice=f.figure.voice;delete f.figure.voice;
  assert.equal((await f.speech.open('actor')).available,false);
  f.figure.voice=voice;f.engine.stageToggles.voice=false;
  assert.equal((await f.speech.open('actor')).available,false);
  await assert.rejects(f.speech.synthesize('actor',{text:'hello'}),{code:'voice-unbound'});
});

function fakePlayer() {
  let available = true, plays = 0, paused = 0, synths = 0, reads = 0, listener
  const audio = {paused:true,currentTime:0,play:async () => { plays++; audio.paused = false },pause:() => { paused++; audio.paused = true }}
  const client = {apiVersion:1,available:() => available,subscribe(fn) { listener = fn; return () => {} },synthesize:async () => { synths++; return {key:'key',ticket:'ticket'} },audio:async () => { reads++; return {size:10} }}
  const player = createPackVoicePlayer({getClient:() => client,createAudio:() => audio,urls:{createObjectURL:() => 'blob:test',revokeObjectURL:() => {}}})
  return {player,client,audio,stats:() => ({plays,paused,synths,reads}),detach() { available = false; listener?.({type:'unavailable'}) }}
}
const descriptor = {available:true,voiceId:'backend-voice',language:'ja',readings:{version:2,entries:[]}}
test('new client player disables to silence and retains cached audio; plugin unload stops media', async () => {
  const {player,stats,audio,detach} = fakePlayer()
  assert.equal(await player.play(descriptor,{text:'hello'}),false)
  player.setEnabled(true); assert.equal(await player.play(descriptor,{text:'hello'}),true)
  player.setEnabled(false); assert.equal(audio.paused,true); assert.equal(player.get(),null)
  player.setEnabled(true); await player.play(descriptor,{text:'hello'})
  assert.equal(stats().reads,1); assert.equal(stats().plays,2)
  detach(); assert.equal(audio.paused,true); assert.equal(player.get(),null)
  player.dispose()
})
// private fork: provider failure remains a retryable line-local state, not loading forever.
test('voice provider error reaches the player and a manual retry clears it', async () => {
  const {player,client,stats} = fakePlayer();
  player.setEnabled(true);
  client.synthesize = async () => {throw Object.assign(new Error('quota'),{code:'QWEN_BILLING_REQUIRED'})};
  assert.equal(await player.play(descriptor,{owner:'s:stage',id:'line',text:'hello'}),false);
  assert.equal(player.get().loading,false);
  assert.equal(player.get().error,'QWEN_BILLING_REQUIRED');
  assert.equal(stats().plays,0);
  client.synthesize = async () => ({key:'retry',ticket:'retry'});
  assert.equal(await player.play(descriptor,{owner:'s:stage',id:'line',text:'hello'}),true);
  assert.equal(player.get().error,undefined);
  player.dispose();
});

test('disable during pending synthesis cannot start late playback', async () => {
  const {player,client,stats} = fakePlayer(); let finish
  client.synthesize = () => new Promise(resolve => { finish = resolve })
  player.setEnabled(true); const pending = player.play(descriptor,{text:'hello'})
  player.setEnabled(false); finish({key:'key',ticket:'ticket'})
  assert.equal(await pending,false); assert.equal(stats().plays,0); player.dispose()
})

test('missing, late and removed TTS are silent; card invalidation and disposal notify consumers',async t=>{
  const f=cardSpeechFixture(t);let notices=0;f.speech.subscribe(()=>notices++);
  f.setService(undefined);assert.equal((await f.speech.open('actor')).available,false);
  f.setService(f.native());assert.equal((await f.speech.open('actor')).available,true);
  const before=notices;f.invalidate();assert.equal(notices,before+1);
  f.setService(undefined);await assert.rejects(f.speech.synthesize('actor',{text:'hello'}),{code:'TTS_UNAVAILABLE'});
  const removed=notices;f.speech.dispose();assert.equal(notices,removed+1);assert.equal((await f.speech.open('actor')).available,false);
});

test('rendering never uses current defaults for incomplete historical outfits and uses same-outfit emotion avatars', async t => {
  const {consumer,pack} = await fixture(t)
  const joy = await consumer.character('actor',{emotion:'joy'})
  // private fork: dedicated emotion avatars do not require an emotion sprite.
  assert.equal(joy.avatar,pack.figures[FIGURE_ID].outfits[0].avatars.joy)
  const incomplete = await consumer.character('actor',{historical:true,actor:{figure:ref}})
  assert.equal(incomplete.form,null)
  assert.deepEqual(incomplete.diagnostics,['historical-outfit-missing'])
})

test('history resolves its recorded dedicated avatar without changing the snapshot',async t=>{
  const {consumer,pack}=await fixture(t)
  const recorded=await consumer.materialize(await consumer.character('actor',{emotion:'crying'}),{descriptors:true})
  const body=recorded.avatarUrl.hash
  recorded.avatar=pack.manifest.assets[0].media
  recorded.avatarCrop=null
  recorded.avatarUrl={...recorded.avatarUrl,hash:recorded.avatar,identity:'old-face'}
  recorded.media.avatar={identity:'old-face',url:recorded.avatarUrl}
  const before=structuredClone(recorded),shown=await consumer.frozen(recorded)
  assert.equal(shown.avatarUrl.hash,body)
  assert.equal(shown.media.avatar.url.identity,shown.avatarUrl.identity)
  // private fork: uploaded avatars are already framed: no body crop (null, as in the dedicated-avatar fallback).
  assert.equal(shown.avatarCrop,null)
  assert.deepEqual(recorded,before)
})

test('stale materialization rejects without an empty face/model after an intervening pack update', async t => {
  const {consumer,service} = await fixture(t)
  const before = await consumer.character('actor')
  const snapshot = await service.getPackSnapshot({packId:PACK_ID})
  await service.patchPack({packId:PACK_ID,expectedRevision:snapshot.revision,patch:{name:'new label'}})
  // private fork: the resource owner retains last-good while this candidate retries.
  await assert.rejects(consumer.materialize(before),{code:'ASSET_STALE'})
})

test('time layer renderer uses recorded projection, neutral matched background and mood last without name inference', () => {
  const {createPackSceneLayers} = require('../tavern-plugin/src/client/fork-pack-playback.cjs')
  const layers = createPackSceneLayers({normalize:p => p,matrix:p => p.value || 1,extras:p => ({extra:p.extra}),compose:(a,b) => [a,b],multiply:(a,b) => a*b,identity:() => 1})
  const projection = {time:{params:{value:2,standIn:{value:3},extra:4}},mood:{params:{value:5}},compensateBackground:false,timeTransitionMs:2500,backgroundUrl:'night'}
  const rendered = layers(projection)
  assert.equal(rendered.figureGrade,2); assert.equal(rendered.backgroundGrade,1)
  assert.equal(rendered.world[1].value,5); assert.equal(layers(projection),rendered)
  assert.equal(layers({...projection,compensateBackground:true}).backgroundGrade,6)
  assert.equal(layers({backgroundUrl:'NightName',compensateBackground:false}).figureGrade,1)
})

// private fork: registered custom IDs replace unbounded free-form state IDs.
test('layered renderer normalization retains custom emotions, closedMouthFrame-only patches and missing portraits', async t => {
  const stateId = 'custom_render'
  const {consumer} = await fixture(t,p => {
    const state = p.sprites.school.emotions.crying
    p.sprites.school.emotions[stateId]=state; delete p.sprites.school.emotions.crying
    // private fork: request the custom owner directly; no borrowing entry.
    p.figures[FIGURE_ID].emotions.push({id:stateId,label:'Custom'}) // private fork: all owned slots remain declared
    delete state.mouthFrames.closed; delete state.portrait
    delete p.figures[FIGURE_ID].outfits[0].sprite.assets['assets/portrait-special.png']
    p.files.set('sprites/school/manifest.json',jsonBytes(p.sprites.school))
  })
  const figure = await consumer.materialize(await consumer.character('actor',{emotion:stateId}))
  const views = packSpriteViews(figure)
  assert.equal(views.stage.state.id,stateId); assert.equal(views.portrait,null)
  assert.equal(forkSpriteFrame(views.stage.pack,views.stage.state,'closed').id,'closed')
  assert.equal(views.stage.view.mouth.w,2)
  const {packFigureRenderInputs} = require('../tavern-plugin/src/client/fork-pack-playback.cjs')
  const rendered = packFigureRenderInputs(figure,{speaking:true,skipping:true,audio:{paused:false}},spriteContract)
  assert.equal(rendered.stage.audio,null); assert.equal(rendered.face.spriteBundle,undefined)
  assert.equal(rendered.face.src,figure.avatarUrl)
})

test('flat-mouth state/rig coordinates and selected resources reach the existing renderer unchanged', async t => {
  const {consumer} = await fixture(t,p => {
    p.figures[FIGURE_ID].appearance='sprite' // private fork: global figure appearance.
    const sprite = p.sprites.casual
    sprite.rig = {mouthSets:{normal:{canvas:[8,8],pivot:[4,4],frames:{closed:'assets/still.png',small:'assets/still.png',mid:'assets/still.png',open:'assets/still.png'}}}}
    sprite.emotions.calm.binding = {canvas:[8,8],mouth:{set:'normal',anchor:{x:4,y:4,scale:1,rotation:0},surface:'neutral'}}
    p.files.set('sprites/casual/manifest.json',jsonBytes(sprite))
  })
  const figure = await consumer.materialize(await consumer.character('actor',{actor:{outfitKey:'casual'}}))
  const {packFigureRenderInputs} = require('../tavern-plugin/src/client/fork-pack-playback.cjs')
  const rendered = packFigureRenderInputs(figure,{},spriteContract)
  assert.equal(rendered.stage.kind,'static'); assert.ok(rendered.stage.src.startsWith('/api/dsh-asset-library/'))
  assert.deepEqual(rendered.stage.mouthBundle.binding.canvas,[8,8])
  assert.deepEqual(rendered.stage.mouthBundle.set.pivot,[4,4])
  assert.equal(rendered.stage.mouthBundle.set.frames.open,rendered.stage.src)
})

// private fork: ordered outfits replace the separate default selector.
test('stored outfit order survives CAS and first enabled outfit is the presentation default', async t => {
  const {service,consumer} = await fixture(t)
  const before = await service.getPackSnapshot({packId:PACK_ID})
  const outfits = [...before.figures[FIGURE_ID].outfits].reverse()
  await service.patchFigure({packId:PACK_ID,figureId:FIGURE_ID,expectedRevision:before.revision,patch:{outfits}})
  const after = await service.getPackSnapshot({packId:PACK_ID})
  assert.deepEqual(after.figures[FIGURE_ID].outfits.map(outfit => outfit.key),['casual','school'])
  assert.notEqual(after.manifest.contentHash,before.manifest.contentHash)
  assert.equal((await consumer.character('actor')).outfitKey,'casual')
  assert.equal((await consumer.character('actor',{historical:true,actor:{figure:ref,outfitKey:'school'}})).outfitKey,'school')
  const disabled = structuredClone(after.figures[FIGURE_ID]); disabled.outfits[0].enabled=false
  assert.equal(selectPackFigure(disabled,after.sprites).outfitKey,'school','private fork: opening skips disabled outfits')
  assert.equal(selectPackFigure(disabled,after.sprites,{outfitKey:'casual'}).outfitKey,'school','private fork: disabled outfits degrade only in projection')
})
// private fork: reissued exact leases change URLs, never media identity or loaded render targets.
test('P4 catalogue refresh and ticket reissue preserve every media identity; accepted content changes still replace targets',async t=>{
  const {consumer,expireTickets}=await fixture(t)
  const state={scene:{background,timeOfDay:'day',timeLook:null},lighting:{},music:{packId:PACK_ID,kind:'music',assetId:'classroom'},soundscape:{weather:{packId:PACK_ID,kind:'ambience',assetId:'rain'}}}
  const event={op:'event',value:{op:'sfx',value:{packId:PACK_ID,kind:'sfx',assetId:'bell'}}}
  const projection=async()=>({available:true,characters:[
    await consumer.materialize(await consumer.character('actor',{emotion:'crying'})),
    {...await consumer.materialize(await consumer.character('actor',{actor:{outfitKey:'casual'}})),alias:'model'}
  ],scene:await consumer.scene(state),state,widgets:[],audio:await consumer.audio(state,[event])})
  const first=await projection();consumer.refresh();const refreshed=await projection()
  // private fork: refresh itself keeps leases; actual expiration still issues fresh transports.
  assert.equal(refreshed.scene.backgroundUrl,first.scene.backgroundUrl)
  expireTickets();const renewed=await projection()
  const items=value=>[value.scene.backgroundMedia,value.audio.music,...value.audio.soundscape.layers,...value.audio.sfx,...value.characters.flatMap(figure=>[figure.media.avatar,figure.media.model,...Object.values(figure.media.resources)])].filter(item=>item.url)
  assert.ok(items(first).length>=8)
  assert.deepEqual(items(renewed).map(item=>item.identity),items(first).map(item=>item.identity))
  items(renewed).forEach((item,i)=>assert.notEqual(item.url,items(first)[i].url,'test really reissued the ticket'))
  const {default:vm}=await import('node:vm'), runtime={}
  // private fork: compare immutable DTOs; runtime ownership is covered by the real resource runner.
  const accepted=first, after=renewed
  let current
  const {packFigureRenderInputs}=require('../tavern-plugin/src/client/fork-pack-playback.cjs')
  const sceneSource=await readFile(new URL('../tavern-plugin/src/client/fork-gal-scene.js',import.meta.url),'utf8'),sceneRuntime={}
  vm.runInNewContext(sceneSource.slice(sceneSource.indexOf('// ---------- Scene helpers'),sceneSource.indexOf('// ---------- Scene runtime')),sceneRuntime)
  const render=figure=>packFigureRenderInputs(figure,{},spriteContract)
  for(let i=0;i<after.characters.length;i++) {
    const a=render(accepted.characters[i]),b=render(after.characters[i])
    assert.equal(b.stage.identity,a.stage.identity)
    assert.deepEqual(JSON.parse(JSON.stringify(sceneRuntime.forkGalFigurePlan([a.stage],[b.stage]))),{add:[],replace:[],retire:[],revive:[]},'renewal does not replace model/static figure owners')
    assert.equal(b.stage.spriteBundle?.revision,a.stage.spriteBundle?.revision,'layered resources do not reload')
    assert.equal(b.face?.identity,a.face?.identity,'avatar reload identity is unchanged')
  }
  // A real background variant and outfit/state change must not be retained as the old media.
  current={...renewed,scene:await consumer.scene({...state,scene:{...state.scene,timeOfDay:'night'}}),characters:[await consumer.materialize(await consumer.character('actor',{emotion:'calm'}))]}
  assert.notEqual(current.scene.backgroundMedia.identity,accepted.scene.backgroundMedia.identity)
  assert.notEqual(current.scene.backgroundUrl,accepted.scene.backgroundUrl)
  assert.notEqual(render(current.characters[0]).stage.identity,render(accepted.characters[0]).stage.identity)

})

// private fork: the tokened runtime path describes content without acquiring tickets.
test('descriptor projections expose actual hashes for every resource and acquire no leases',async t=>{
  // private fork: authored SFX loudness must survive the production descriptor projection.
  const loudness={v:1,lufs:-20,peak:-9}
  // private fork (audio editor): every audio kind carries its authored 音量 to the player.
  const {service,pack,ext}=await fixture(t,pack=>{Object.assign(pack.manifest.assets.find(a=>a.kind==='sfx'),{gainDb:6,loudness,volume:.5})
    Object.assign(pack.manifest.assets.find(a=>a.kind==='music'),{volume:.6});Object.assign(pack.manifest.assets.find(a=>a.kind==='ambience'),{volume:.3})})
  let leases=0
  const lease=async()=>{leases++;throw Error('descriptor path must not lease')}
  const transport={...service,leaseMedia:lease,leaseBundle:lease}
  const consumer=createAssetPackPresentation({raw:rawFor(ext),getService:()=>transport,origin:'http://localhost',scope:'descriptors'})
  t.after(()=>consumer.dispose())
  const layered=await consumer.materialize(await consumer.character('actor',{emotion:'crying'}),{descriptors:true})
  const model=await consumer.materialize(await consumer.character('actor',{actor:{outfitKey:'casual'}}),{descriptors:true})
  assert.equal(model.modelUrl.hash,pack.manifest.bundles.casual.contentHash)
  assert.equal(model.media.model.identity,model.modelUrl.identity)
  assert.equal(layered.avatarUrl.hash,layered.avatar)
  for(const [name,descriptor] of Object.entries(layered.spriteUrls)) assert.equal(descriptor.hash,layered.outfit.sprite.assets[name])
  const state={scene:{background,timeOfDay:'day'},lighting:{},music:{packId:PACK_ID,kind:'music',assetId:'classroom'},soundscape:{place:{packId:PACK_ID,kind:'ambience',assetId:'rain'}}}
  const scene=await consumer.scene(state,{descriptors:true})
  const audio=await consumer.audio(state,[{op:'sfx',value:{packId:PACK_ID,kind:'sfx',assetId:'bell'}}],{descriptors:true})
  assert.equal(audio.sfx[0].gainDb,6)
  assert.deepEqual(audio.sfx[0].loudness,loudness)
  assert.equal(audio.music.gainDb,undefined)
  assert.deepEqual([audio.music.volume,audio.soundscape.layers[0].volume,audio.sfx[0].volume],[.6,.3,.5])
  for(const descriptor of [scene.backgroundUrl,audio.music.url,audio.soundscape.layers[0].url,audio.sfx[0].url,model.modelUrl,layered.avatarUrl]) {
    assert.equal(descriptor.resource,true);assert.match(descriptor.hash,/^[a-f0-9]{64}$/);assert.ok(descriptor.ref.packId)
    assert.equal(descriptor.url,undefined);assert.equal(descriptor.ticket,undefined)
  }
  assert.equal(leases,0)
  const modified=structuredClone(pack), before=packGeometryKey(selectPackFigure(modified.figures[FIGURE_ID],modified.sprites),modified)
  modified.figures[FIGURE_ID].outfits[0].sprite.assets['unused.png']='f'.repeat(64)
  assert.equal(packGeometryKey(selectPackFigure(modified.figures[FIGURE_ID],modified.sprites),modified),before)
})
// private fork: variant selection, not baseTime metadata, determines time-grade routing.
for (const timeOfDay of ['dusk', 'night']) test(`${timeOfDay} image variants bypass background grading, missing variants do not`, async t => {
  for (const hasVariant of [true, false]) {
    const {consumer} = await fixture(t, pack => {
      const bg = pack.manifest.assets.find(a => a.kind === 'backgrounds')
      if (!hasVariant) bg.variants.entries=bg.variants.entries.filter(row=>row.id!==timeOfDay)
    })
    const state = sceneState(timeOfDay)
    state.lighting.time.ref = {packId:PACK_ID,kind:'looks',assetId:timeOfDay}
    const projected = await consumer.scene(state)
    assert.equal(projected.compensateBackground, !hasVariant)
    assert.ok(projected.backgroundUrl)
    assert.equal(projected.timeMatched,hasVariant,'selected flat variant determines grade routing')
    assert.deepEqual(projected.time.params,CORE_TIME_PARAMS[timeOfDay],'stored retired refs do not own global time')
  }
})
// A Live2D-only outfit cannot borrow an avatar from another costume.
test('Live2D-only selection never materializes a different outfit avatar',async t=>{
  const {consumer}=await fixture(t,pack=>{
    const figure=pack.figures[FIGURE_ID]
    figure.outfits.unshift({key:'model-only',label:'Model',enabled:true,live2d:figure.outfits[1].live2d})
  })
  const selected=await consumer.character('actor',{emotion:'crying'})
  assert.equal(selected.form,'live2d');assert.equal(selected.outfitKey,'model-only')
  assert.equal(selected.avatarOutfitKey,null);assert.equal(selected.avatarStateId,null)
  const frame=await consumer.materialize(selected,{stage:false,descriptors:true})
  assert.equal(frame.modelUrl,null);assert.equal(frame.avatarUrl,null)
  const replay=await consumer.frozen(frame)
  assert.equal(replay.avatarUrl,null)
  assert.deepEqual(replay.avatarCrop,selected.avatarCrop)
})
