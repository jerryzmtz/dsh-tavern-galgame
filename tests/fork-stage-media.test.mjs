// private fork: offline media continuity; real players, DTOs and figure render inputs.
import test from 'node:test'
import assert from 'node:assert/strict'
import {fixture} from './helpers/stage-director-harness.mjs'
import {createStageMediaHarness} from './helpers/stage-media-harness.mjs'
import {PACK_ID} from './fixtures/asset-packs/pack.mjs'
const ref = (kind,assetId) => ({packId:PACK_ID,kind,assetId})

test('all consumers survive three ticket renewals and hidden/visible playback; content changes replace exactly once',async t => {
  const f = await fixture(() => {}), h = createStageMediaHarness()
  t.after(async () => {h.dispose();await f.dispose()})
  const consumer = (await f.assets.consumer(f.read(),'http://localhost')).presentation
  const descriptors = async () => {
    const layered = await consumer.character('actor',{emotion:'crying'})
    const live2d = await consumer.character('actor',{actor:{outfitKey:'casual'}})
    const flat = {...live2d,form:'sprite',alias:'flat'}
    const state = {scene:{background:ref('backgrounds','classroom'),timeOfDay:'day'},lighting:{},music:ref('music','classroom'),soundscape:{place:ref('ambience','rain'),weather:ref('ambience','rain')}}
    const value = {scene:await consumer.scene(state,{descriptors:true}),characters:[
      await consumer.materialize(layered,{descriptors:true}),
      {...await consumer.materialize(live2d,{descriptors:true}),alias:'live2d'},
      await consumer.materialize(flat,{descriptors:true})
    ],audio:await consumer.audio(state,[{op:'sfx',value:ref('sfx','bell')}],{descriptors:true})}
    // Use two distinct test tracks so both ambience slots are independently observable.
    value.audio.soundscape.layers[1].identity += ':weather'
    value.audio.soundscape.layers[1].url.identity += ':weather'
    value.audio.soundscape.layers[1].url.hash += ':weather'
    function revision(item) {if(item?.resource)item.revision=1;else if(item&&typeof item==='object')Object.values(item).forEach(revision)}
    revision(value); return value
  }
  const original = await descriptors(), first = await h.resources.prepare(original,'a')
  h.apply(first.value)
  const shot = first.value.audio.sfx[0], shotDone = h.players.sfx.play(shot.url,shot.identity,shot.ref)
  await h.voice.play({available:true,voiceId:'voice'},{owner:'session',id:'paragraph',text:'Continuous voice'})
  await new Promise(resolve => setImmediate(resolve))
  h.advance(4000)
  const audio = h.nodes.filter(node => !node.paused), stats = audio.map(node => [node.plays,node.pauses,node.srcChanges]), visuals = new Map(h.instances)
  assert.equal(audio.length,5,'music, place, weather, voice and SFX are playing')
  const reads = h.byteReads
  for(let i=0;i<3;i++) {
    for(const pin of first.pins) await h.resources.renew(pin.handle.identity,'a')
    const renewed = await h.resources.prepare(await descriptors(),'a')
    h.apply(renewed.value); renewed.release()
    h.hidden(true);h.advance(1000);h.hidden(false);h.advance(1000)
    assert.deepEqual(audio.map(node => [node.plays,node.pauses,node.srcChanges]),stats)
    assert.deepEqual(new Map(h.instances),visuals)
    assert.ok(audio.every(node => node.currentTime === 6 + i*2 && !node.paused))
  }
  assert.equal(h.byteReads,reads)
  const changed = structuredClone(original)
  function change(item) {if(item?.resource){item.hash+='new';item.identity+='new'}else if(item&&typeof item==='object')for(const [key,value] of Object.entries(item)){if(key==='identity'&&typeof value==='string')item[key]+='new';else change(value)}}
  change(changed)
  for (const figure of changed.characters) for (const view of ['stage','portrait']) if (figure.geometry[view]) figure.geometry[view] += 'new'
  const replacement = await h.resources.prepare(changed,'a')
  h.apply(replacement.value);h.apply(replacement.value)
  for(const [key,count] of h.replacements) assert.equal(count,2,key+' changes once')
  assert.equal(h.nodes.filter(node=>node.bus==='music').reduce((sum,node)=>sum+node.plays,0),2)
  assert.equal(h.nodes.filter(node=>node.bus==='ambience').length,4)
  // Same resource, distinct event: both shots play; renewals never invented a play.
  const secondShot = h.players.sfx.play(shot.url,shot.identity,shot.ref)
  assert.equal(h.nodes.filter(node=>node.bus==='sfx').length,2)
  h.nodes.filter(node=>node.bus==='sfx').forEach(node=>node.end())
  await Promise.all([shotDone,secondShot]);first.release();replacement.release()
})

test('music and ambience replacement envelopes complete while visual RAF is hidden',()=>{
  const h=createStageMediaHarness()
  h.hidden(true)
  h.players.music.play('blob:music-a',false,'music-a')
  h.ambience.apply({version:1,layers:[{slot:'place',identity:'room-a',url:'blob:room-a',gain:1}],warnings:[]},{snap:false})
  h.advance(1300)
  const first=h.nodes.filter(node=>!node.paused)
  assert.equal(first.length,2);assert.ok(first.every(node=>node.volume===1))
  h.players.music.play('blob:music-b',false,'music-b')
  h.ambience.apply({version:1,layers:[{slot:'place',identity:'room-b',url:'blob:room-b',gain:1}],warnings:[]},{snap:false})
  h.advance(1300)
  assert.ok(first.every(node=>node.paused))
  assert.equal(h.nodes.filter(node=>!node.paused&&node.volume===1).length,2)
  h.hidden(false);h.dispose()
})
