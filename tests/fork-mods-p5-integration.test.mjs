import test from 'node:test'
import assert from 'node:assert/strict'
import {createFirstPartyMods} from '../tavern-plugin/lib/fork-mod-builtins.js'
import {prepareAssetPackDirector,createAssetPackTransaction,buildAssetPackRequest} from '../tavern-plugin/lib/domain/stage-asset-pack-director.js'
import {assetRefKey} from '../tavern-plugin/packages/dsh-presentation-protocol/src/asset-packs.js'
import {assetPackBackgroundVariant} from '../tavern-plugin/packages/dsh-presentation-protocol/src/asset-pack-stage.js'
import {stageTimeLook} from '../tavern-plugin/packages/dsh-presentation-protocol/src/stage-time.js'
import {syntheticPack,cardExtension,PACK_ID} from './fixtures/asset-packs/pack.mjs'
import {INTENSITIES} from '../fork/mods/textcard/presets.js'

async function fixture(mods) {
  const pack=await syntheticPack(),ref=(kind,assetId)=>({packId:PACK_ID,kind,assetId})
  for(const asset of pack.manifest.assets)asset.recall={mode:'constant'}
  const media=pack.manifest.assets[0].variants.entries[0].content.media
  pack.manifest.assets.push({kind:'cg',id:'art',name:'Art',enabled:true,recall:{mode:'constant'},directorNote:'',variants:{default:'base',entries:[
    {id:'base',name:'Base',content:{media}},
    {id:'detail',name:'Detail',content:{media,focusHints:[{key:'face',label:'Face',x:.5,y:.5,zoom:2}]}}
  ]}})
  const input={snapshots:[{...pack,revision:'1'}],raw:{extensions:{dsh_tavern:cardExtension()}},cardRevision:'1',engine:{dimensions:{}},
    target:{sourceKey:'source',branchId:'branch',revision:1,turn:1},units:Array.from({length:32},()=> 'Offline text.'),
    assetStatus:Object.fromEntries(pack.manifest.assets.map(asset=>[assetRefKey(ref(asset.kind,asset.id)),{available:true}])),
    ...(mods?{mods:{revision:'1',...mods}}:{})}
  const prepared=prepareAssetPackDirector(input)
  return {pack,ref,input,prepared,tx:createAssetPackTransaction({prepared,getCurrentBinding:()=>prepared.binding})}
}

test('textcard title and additive cards share the original intensity cap across retry and checkpoint',async()=>{
  const builtins=await createFirstPartyMods(),modId='dsh.textcard',manifest=builtins.manifest(modId),module=builtins.module(modId)
  const schemaCommands=module.commandSchema({manifest}).map(row=>({...row,modId}))
  for(const [intensity,{cap}] of Object.entries(INTENSITIES)) {
    const commands=module.configure({manifest,settings:{values:{intensity}}}).commands.map(row=>({...row,modId}))
    const {prepared,tx}=await fixture({commands,schemaCommands})
    const operation=i=>i%2?{op:'mod.dsh.textcard.title',placement:'before',text:'Title'}:{op:'text.show',placement:'after',preset:'word',text:'Word'}
    const request={sequence:1,through:cap,done:false,beats:Array.from({length:cap},(_,i)=>({at:i+1,ops:[operation(i)]}))}
    const accepted=tx.submit(request)
    assert.equal(accepted.ok,true,JSON.stringify({intensity,accepted}))
    assert.equal(tx.submit(request).duplicate,true)
    const resumed=createAssetPackTransaction({prepared,getCurrentBinding:()=>prepared.binding,checkpoint:tx.savepoint()})
    const rejected=resumed.submit({sequence:2,through:32,done:true,beats:[{at:cap+1,ops:[operation(cap)]}]})
    assert.match(JSON.stringify(rejected),new RegExp('limit '+cap))
    assert.equal(resumed.effect().entries.flatMap(row=>row.ops).length,cap)
  }
})

test('background and CG switches use flat ids without location changes, time refs or entrance replay',async()=>{
  const {tx,ref,pack}=await fixture()
  assert.equal(tx.submit({sequence:1,through:1,done:false,beats:[{at:1,ops:[{op:'scene.set',background:ref('backgrounds','classroom'),time:'night'},{op:'cg.set',cg:ref('cg','art')}]}]}).ok,true)
  const switched=tx.submit({sequence:2,through:2,done:false,beats:[{at:2,ops:[{op:'scene.variant',variant:'dusk'},{op:'cg.variant',variant:'detail'},{op:'cg.focus.set',focus:'face'}]}]})
  assert.equal(switched.ok,true,JSON.stringify(switched))
  const state=tx.savepoint().state.state
  assert.equal(state.scene.timeOfDay,'night')
  assert.equal(state.scene.timeLook,null)
  assert.equal(state.lighting.time.ref,null)
  assert.equal(state.scene.variant,'dusk')
  assert.equal(state.cg.variant,'detail')
  assert.equal(state.cg.focus,'face')
  assert.equal(tx.savepoint().state.entries.at(-1).timeTransitionMs,0)
  const bad=tx.submit({sequence:3,through:32,done:true,beats:[{at:3,ops:[{op:'scene.variant',variant:'missing'},{op:'cg.variant',variant:'detail',ref:ref('cg','other')}]}]})
  assert.equal(bad.ok,false)
  tx.finish()
  assert.equal(tx.effect().end.scene.variant,'dusk')
  assert.equal(tx.effect().end.cg.variant,'detail')
  const background=pack.manifest.assets[0]
  assert.equal(assetPackBackgroundVariant(background,{timeOfDay:'night'}).timeMatched,true)
  assert.equal(assetPackBackgroundVariant(background,{timeOfDay:'night'}).compensateBackground,false)
  assert.equal(assetPackBackgroundVariant(background,{timeOfDay:'night',variant:'day'}).compensateBackground,true)
  assert.deepEqual(stageTimeLook(null).params,{})
  assert.deepEqual(stageTimeLook('day').params,{})
  assert.notDeepEqual(stageTimeLook('night').params,{})
})

test('variant choices stay in recalled catalogue metadata, never installed grammar',async()=>{
  const {input,pack}=await fixture(),on=buildAssetPackRequest(prepareAssetPackDirector(input),true)
  const without=structuredClone(input)
  without.snapshots[0].manifest.assets[0]={...pack.manifest.assets[0],media:pack.manifest.assets[0].variants.entries[0].content.media}
  delete without.snapshots[0].manifest.assets[0].variants
  const plain=buildAssetPackRequest(prepareAssetPackDirector(without),true)
  const empty=structuredClone(input)
  for(const asset of empty.snapshots[0].manifest.assets)asset.recall={mode:'keyword',keywords:['unmatched']}
  const missed=buildAssetPackRequest(prepareAssetPackDirector(empty),true)
  assert.deepEqual(on.tools,plain.tools)
  assert.deepEqual(on.tools,missed.tools)
  assert.doesNotMatch(JSON.stringify(on.tools),/timeLook|lighting\.time\.(set|reset)/)
  assert.match(JSON.stringify({system:on.system,messages:on.messages}),/detail/)
  assert.doesNotMatch(JSON.stringify({system:missed.system,messages:missed.messages}),/detail/)
})
