import {distinctMedia} from './fixtures/asset-packs/pack.mjs'
// private fork: ambience is a persistent independent director channel.
import test from 'node:test'
import assert from 'node:assert/strict'
import {productionDirectorFixture} from './helpers/production-director-fixture.mjs'
import {modelArguments} from './helpers/director-model-call.mjs'
import {PACK_ID} from './fixtures/asset-packs/pack.mjs'
import {createAssetPackTransaction, prepareAssetPackDirector, assetPackStateAt} from '../tavern-plugin/lib/domain/stage-asset-pack-director.js'
import {validateAsset} from '../tavern-plugin/packages/dsh-asset-library/src/asset-packs/manifest.js'
const ref=(kind,assetId)=>({packId:PACK_ID,kind,assetId})
const scene={op:'scene.set',background:ref('backgrounds','classroom'),time:'day'}
const rain=ref('ambience','rain')
const txFor=p=>createAssetPackTransaction({prepared:p,getCurrentBinding:()=>p.binding})
const submit=(tx,beats)=>tx.submitModel(modelArguments(tx.request,{sequence:1,through:3,done:true,beats}))

test('scene, clear and weather never select or reset ambience; explicit clear alone stops it',async()=>{
  const {input,prepared}=await productionDirectorFixture()
  const silent=txFor(prepared)
  assert.equal(submit(silent,[{at:1,ops:[scene,{op:'weather.set',weather:'storm'}]}]).ok,true)
  assert.deepEqual(silent.effect().end.soundscape,{})
  const tx=txFor(prepared)
  assert.equal(submit(tx,[{at:1,ops:[{op:'ambience.set',refs:[rain]},scene]},{at:2,ops:[{op:'scene.clear'},{op:'weather.set',weather:'storm'}]}]).ok,true)
  const record=tx.effect(),held=record.end.soundscape
  assert.deepEqual(held,{layer1:rain})
  assert.deepEqual(assetPackStateAt(record,1).soundscape,held)
  assert.equal(record.end.weather,'storm')
  const next=prepareAssetPackDirector({...input,record}),noop=txFor(next)
  assert.deepEqual(next.baseline.soundscape,held)
  assert.equal(submit(noop,[]).ok,true)
  assert.deepEqual(noop.effect().end.soundscape,held)
  const clear=txFor(next)
  assert.equal(submit(clear,[{at:1,ops:[{op:'ambience.clear'}]}]).ok,true)
  assert.deepEqual(clear.effect().end.soundscape,{})
})

test('two recalled loops mix with BGM and SE; ambience can change without a hold',async()=>{
  const {input}=await productionDirectorFixture()
  const other={...input.snapshots[0].manifest.assets.find(a=>a.kind==='ambience'),id:'second-rain',name:'Other rain'}
  input.snapshots[0].manifest.assets.push(distinctMedia(other,'second-rain'))
  input.assetStatus[PACK_ID+'/ambience/second-rain']={available:true}
  const second=ref('ambience','second-rain'),prepared=prepareAssetPackDirector(input),tx=txFor(prepared)
  assert.equal(submit(tx,[{at:1,ops:[{op:'ambience.set',refs:[rain,second]},{op:'music.set',ref:ref('music','classroom')},{op:'sfx.play',ref:ref('sfx','bell')}]},{at:2,ops:[{op:'ambience.set',refs:[second]}]}]).ok,true)
  assert.deepEqual(Object.values(tx.effect().entries[0].state.soundscape),[rain,second])
  assert.deepEqual(Object.values(tx.effect().end.soundscape),[second])
  assert.deepEqual(tx.effect().end.music,ref('music','classroom'))
  for(const refs of [[rain,rain],[rain,second,rain],[],[ref('music','classroom')]]){
    const bad=txFor(prepared)
    assert.equal(submit(bad,[{at:1,ops:[{op:'ambience.set',refs}]}]).ok,false)
  }
})

test('background presets and old sound tags are rejected rather than interpreted',async()=>{
  const {prepared,input}=await productionDirectorFixture()
  const background=input.snapshots[0].manifest.assets.find(a=>a.kind==='backgrounds')
  assert.throws(()=>validateAsset({...background,soundscape:{place:rain,exposure:'open',people:false}}),{code:'UNKNOWN_FIELD'})
  const tx=txFor(prepared)
  const rejected=submit(tx,[{at:1,ops:[{op:'ambience.set',tags:['open']}]}])
  assert.equal(rejected.ok,false)
  assert.equal(rejected.errors[0].code,'UNKNOWN_FIELD')
})
