// private fork: voice resolves authored names; stage figures use canonical actor keys.
import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'
import bubble from '../tavern-plugin/src/client/fork-bubble-line.cjs'
import playback from '../tavern-plugin/src/client/fork-pack-playback.cjs'

const source = readFileSync(new URL('../tavern-plugin/src/client/fork-gal-stage.js', import.meta.url), 'utf8')
const projection = source.slice(source.indexOf('    const speaker ='), source.indexOf('    const quality = useForkStageQuality();', source.indexOf('    const speaker =')))
const actor = 'f_efed52c1c67556e0'
const ref = {packId:'pack',figureId:'whale'}
const config = {characters:[{alias:actor,ref,aliases:['dafeiyu','whale'],name:'Whale'}]}
const figure = alias => ({alias,ref:{...ref,figureId:alias},form:'live2d',modelUrl:'/model',media:{model:{identity:alias}},geometry:{stage:'geometry'},heightCm:120})
function project(current, overrides = {}) {
  const audio = {paused:false,ended:false,currentTime:0.5}
  const ctx = {current,config,pack:{characters:[figure(actor),figure('listener')]},player:{audio},playingHere:true,
    skipping:false,turn:2,page:23,sessionId:'test',awaiting:false,shot:{key:'',acts:{}},
    state:{cast:[actor,'listener'],actors:{[actor]:{},listener:{}}},forwardReading:true,
    colorOf:()=>'',forkGalGaze:()=>0,forkBubbleCharacter:bubble.forkBubbleCharacter,...playback,...overrides}
  vm.runInNewContext(projection + ';this.result = {speaker,items};',ctx)
  return {audio,...ctx.result}
}

for (const current of [
  {kind:'line',alias:'dafeiyu',name:'Whale'},
  {kind:'line',alias:'whale'},
  {kind:'line',alias:'generated-alias',name:'Whale'},
  {kind:'line',alias:actor}
]) test(`resolved line ${current.alias} routes its audio only to its canonical actor`, () => {
  const {audio,speaker,items} = project(current)
  assert.equal(speaker,actor)
  assert.equal(items[0].speaking,true)
  assert.equal(items[0].audio,audio)
  assert.equal(items[0].voiced,true)
  assert.equal(items[0].voiceStarted,true)
  assert.equal(items[1].speaking,false)
  assert.equal(items[1].audio,null)
})

test('narration, unknown speakers, missing audio and skip never borrow another actor voice', () => {
  for (const current of [null,{kind:'narration',alias:'dafeiyu'},{kind:'line',alias:'unknown'}]) {
    assert.ok(project(current).items.every(item => !item.speaking && item.audio === null))
  }
  for (const override of [{playingHere:false},{skipping:true}]) {
    const result = project({kind:'line',alias:'dafeiyu'},override)
    assert.equal(result.items[0].speaking,true)
    assert.equal(result.items[0].audio,null)
  }
})

test('legacy alias-only cards retain their existing speaker identity', () => {
  const result = project({kind:'line',alias:actor},{config:{characters:[{alias:actor}]}})
  assert.equal(result.speaker,actor)
  assert.equal(result.items[0].audio,result.audio)
})
