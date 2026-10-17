// private fork: figure vocabulary drives writer rows and pack-owned art, scoped by alias.
import test from 'node:test'
import assert from 'node:assert/strict'
import {createCardStage} from '../tavern-plugin/lib/fork-card-stage.js'
import {cardAssetRawOperations} from '../tavern-plugin/lib/domain/card-asset-bindings.js'
import {bubbleInstruction, normalizeBubbleEmotions, resolveBubbleMood} from '../tavern-plugin/lib/domain/dialogue-bubbles.js'
import {defaultAssetEngineSettings} from '../tavern-plugin/lib/domain/asset-engine-settings.js'
import {selectPackFigure} from '../tavern-plugin/lib/domain/asset-pack-presentation.js'
import {readStageProjection} from '../tavern-plugin/lib/domain/stage-projection.js'
import {stagePlaybackEmotions,saveStagePlayback} from '../tavern-plugin/lib/domain/stage-playback.js'
import {fixture} from './helpers/stage-director-harness.mjs'
import {PACK_ID} from './fixtures/asset-packs/pack.mjs'
const emotions = [{id:'smug',label:'得意',words:'自鸣得意 洋洋得意',note:'小小炫耀'},
  {id:'stand',label:'站立'}, {id:'walk',label:'行走'}, {id:'lie',label:'趴下'}, {id:'tilt',label:'歪头'}]

test('figure declarations reach only the owning writer row without engine defaults', async t => {
  const f = await fixture(() => {}); t.after(() => f.dispose())
  const engine = defaultAssetEngineSettings(), service = f.services.get('assetLibrary')
  engine.dialogue.emotions = [{id:'other',label:'其他'}]
  const pack = await service.getPackSnapshot({packId:PACK_ID})
  // private fork: preserve the existing declarations and add ordinary named rows.
  Object.values(pack.figures)[0].emotions.push(...emotions.map(({id,label,note}) => ({id,label,...(note ? {guidance:note} : {})})))
  const stage = createCardStage({getEngine:() => engine, getAssetLibrary:() => service, profileData:{readJson:async () => f.workspace}})
  assert.throws(() => cardAssetRawOperations(f.workspace.raw,{emotions}),{code:'UNKNOWN_FIELD'})
  const config = await stage.bubbles.read('cards/a.json')
  assert.equal(config.moods.length,1) // private fork: only the engine's actual declaration
  assert.deepEqual(config.emotions,engine.dialogue.emotions)
  for (const emotion of emotions) {
    assert.ok(bubbleInstruction(config).includes(emotion.label))
    assert.equal(resolveBubbleMood(emotion.label,config,'actor').id,emotion.id)
    assert.equal(resolveBubbleMood(emotion.label,config,'other'),null)
  }
  assert.ok(bubbleInstruction(config).includes(emotions[0].note))
  assert.equal(resolveBubbleMood('洋洋得意',config,'actor'),null,'figure words are removed')
  assert.equal(resolveBubbleMood('开心',config,'actor').id,'joy')
})

test('engine custom words reject collisions and malformed input', () => {
  for (const words of ['stand','站立',42,'bad|word']) {
    assert.throws(() => normalizeBubbleEmotions([{...emotions[0],words},emotions[1]]))
  }
  assert.deepEqual(normalizeBubbleEmotions([{...emotions[0],words:' 洋洋得意  洋洋得意 '}])[0].words,'洋洋得意')
  assert.throws(() => normalizeBubbleEmotions([...emotions,{id:'smug',label:'重名'}]))
})

test('sealed source emotions resolve exact pack states and stay distinct in frozen history without director beats', async t => {
  const f = await fixture(request => request.onToolCall({name:'stage_update',arguments:{sequence:1,through:7,done:true,beats:[]}}))
  t.after(() => f.dispose())
  const pack = await f.services.get('assetLibrary').getPackSnapshot({packId:PACK_ID})
  const figure = Object.values(pack.figures)[0], sprite = pack.sprites.school
  // private fork: availability and fallback follow declared membership.
  figure.emotions.push(...emotions.map(({id,label,note}) => ({id,label,...(note ? {guidance:note} : {})})))
  // private fork: direct emotion ownership replaces map precedence and generic default-state substitution.
  Object.assign(sprite.emotions,Object.fromEntries(emotions.map(({id})=>[id,structuredClone(sprite.emotions.calm)])))
  assert.equal(selectPackFigure(figure,pack.sprites,{emotion:'smug'}).state.id,'smug')
  assert.equal(selectPackFigure(figure,pack.sprites,{emotion:'missing'}).state.id,'calm')
  const actionSprites = structuredClone(pack.sprites);delete actionSprites.school.emotions.calm
  const actionFigure = structuredClone(figure)
  // A missing default remains unavailable rather than borrowing another emotion.
  const restless = selectPackFigure(actionFigure,actionSprites,{emotion:'calm'})
  assert.equal(restless.state,null);assert.equal(restless.spriteResolution.missing,true)
  assert.equal(Object.hasOwn(actionSprites.school.emotions,'calm'),false)
  for (const {id} of emotions) assert.equal(selectPackFigure(actionFigure,actionSprites,{emotion:id}).state.id,id)
  await f.store.updateChat('chat',chat => {
    chat.messages[0].text = ['得意','站立','行走','趴下','歪头','平静','未知'].map(mood => `@bubble:actor|Actor|${mood}|[text]`).join('\n')
    return chat
  })
  await f.director.get(f.read()); await f.director.drain()
  const direction = await f.director.get(f.read(),1,null,{readOnly:true})
  assert.equal(direction.through,7)
  const project = (at,history) => readStageProjection({at,history,expectedDirectionToken:direction.token,
    readDirection:() => f.director.get(f.read(),1,null,{readOnly:true}),readConsumer:() => f.assets.consumer(f.read(),'http://localhost'),
    readSettings:() => f.engineSettings.read(), revision:() => f.assets.revision,
    readPlayback:() => f.read().messages[0].stagePlaybackV1,
    writePlayback:async (dir,candidate) => {let saved; await f.store.updateChat('chat',chat => {saved=saveStagePlayback(chat,1,dir,candidate); return chat}); return saved}})
  const record=structuredClone(direction.record),units=structuredClone(direction.displayUnits)
  for (const history of [false,true]) for (const [index,id] of ['smug','stand','walk','lie','tilt','calm','calm'].entries()) {
    const result = await project(index + 1,history)
    assert.equal(result.status,'ready',JSON.stringify(result))
    // private fork: source moods drive portraits without materializing unused stage actors.
    assert.equal(result.value.characters[0].form,null)
    assert.deepEqual(result.value.state.actors,{})
    assert.equal(result.value.avatars[0].state.id,id)
    // private fork: raw speaker aliases and Chinese moods cross the resolver boundary before media selection.
    assert.match(result.value.avatars[0].alias,/^f_/)
    assert.notEqual(result.value.avatars[0].alias,'actor')
  }
  assert.deepEqual(direction.record,record)
  assert.deepEqual(direction.displayUnits,units)
})

test('private fork: emotion projection resolves full speaker labels without changing stored playback key input',()=>{
  const direction={displayUnits:[{kind:'line',text:'@bubble:unknown|Synthetic figure|smug|[one]'},{kind:'line',text:'@bubble:actor|Actor|crying|[two]'}]}
  const before=structuredClone(direction),seen=[]
  const derived=stagePlaybackEmotions(direction,2,segment=>{seen.push(segment);return 'ref_key'})
  assert.deepEqual(seen,[{alias:'unknown',name:'Synthetic figure'},{alias:'actor',name:'Actor'}])
  assert.deepEqual(derived,{ref_key:'crying'})
  assert.deepEqual(stagePlaybackEmotions(direction,2),{unknown:'smug',actor:'crying'})
  assert.deepEqual(stagePlaybackEmotions(direction,2,()=>undefined),{})
  assert.deepEqual(direction,before)
})
