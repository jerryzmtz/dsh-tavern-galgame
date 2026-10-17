// private fork: declarations, old-import conversion and voice-owned pointers share one contract.
import test from 'node:test'
import assert from 'node:assert/strict'
import {importFigureVariants} from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/import-figure-variants.js'
import {figureEmotionRows,figureOutfitEmotionRows,validateFigureEmotions} from '../tavern-plugin/packages/dsh-asset-library/src/asset-packs/figure-emotions.js'
import {resolveVoiceSpec} from '../tavern-plugin/packages/dsh-tts/src/voice-resolver.js'
import sprites from '../tavern-plugin/shared/sprite-emotions.cjs'
import {removeFigureEmotion} from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/remove-figure-emotion.js'
import {syntheticPack,FIGURE_ID} from './fixtures/asset-packs/pack.mjs'

test('opaque variants own their labels, character set and fixed default fallback',async()=>{
  const figure={emotions:[{id:'e-abc',label:'喜悦',guidance:''},{id:'e-def',label:'平和',guidance:''}]}
  validateFigureEmotions(figure.emotions)
  assert.deepEqual(figureEmotionRows({}),[])
  assert.deepEqual(figureOutfitEmotionRows(figure,{}),figure.emotions)
  const outfit={defaultEmotion:'e-def'},order=['e-def','e-abc']
  assert.deepEqual(figureOutfitEmotionRows(figure,outfit).map(row=>row.id),figure.emotions.map(row=>row.id))
  const manifest={version:1,kind:'static-sprites',emotions:{'e-abc':{src:'a.png'}}}
  const selected=sprites.resolveSpriteDisplay(manifest,'e-def',order)
  assert.equal(selected.resolvedEmotion,null);assert.equal(selected.missing,true)
  assert.equal(sprites.resolveSpriteDisplay({version:1,kind:'static-sprites',emotions:{}},'e-def',order).state,null)
  assert.throws(()=>validateFigureEmotions([...figure.emotions,{id:'e-other',label:'喜悦'}]),{code:'DUPLICATE_ID'})
  const pack=await syntheticPack()
  removeFigureEmotion(pack.manifest,pack.files,pack,FIGURE_ID,'joy')
  const deleted=JSON.parse(pack.files.get('figures/'+FIGURE_ID+'.json'))
  assert.equal(deleted.emotions.some(row=>row.id==='joy'),false)
  assert.ok(deleted.outfits.every(outfit=>!outfit.fallbackEmotions?.includes('joy')&&!outfit.avatars?.joy&&!outfit.live2d?.emotionMap?.joy))
})

test('legacy conversion preserves IDs and pools while explicit voice pointers retain selection seeds',()=>{
  const reference={media:'a'.repeat(64),text:'Reference.',language:'en'}
  const voice={name:'Voice',language:'en',defaultSource:'local',sources:{local:{kind:'emotion-references',provider:'local',engine:'test',model:{id:'test'},fallback:[reference],emotions:{joy:[reference,{...reference,media:'b'.repeat(64)}]},selection:'stable-random'}}}
  const manifest={voiceLibrary:{version:1,voices:{v:voice}}},figure={id:'f',voice:{voice:'v'},outfits:[{key:'o',sprite:{manifestKey:'s'}}]},sprite={version:1,kind:'static-sprites',emotions:{calm:{src:'a.png'},joy:{src:'b.png'}}}
  const converted=importFigureVariants(manifest,{f:figure},{s:sprite}),next=converted.figures.f
  assert.equal(next.outfits[0].defaultEmotion,'calm');assert.equal(next.outfits[0].emotions,undefined)
  assert.equal(next.emotions.find(row=>row.id==='joy').label,'喜悦')
  assert.deepEqual(converted.manifest.voiceLibrary.voices.v.sources,voice.sources)
  assert.deepEqual(importFigureVariants(converted.manifest,converted.figures,{s:sprite}),converted)
  const input={voice:converted.manifest.voiceLibrary.voices.v,binding:next.voice,figureIdentity:'pack:f',mood:'joy',selectionKey:'existing-round',emotions:next.emotions}
  const expected=resolveVoiceSpec(input)
  const renamed=next.emotions.map(row=>row.id==='joy'?{...row,label:'微笑'}:row)
  assert.deepEqual(resolveVoiceSpec({...input,emotions:renamed}).selectedReference,expected.selectedReference)
  const noPointer=next.emotions.map(({voiceEmotion,...row})=>row)
  // private fork: even a source pool named "undefined" cannot supply an absent pointer.
  input.voice.sources.local.emotions.undefined=[{...reference,media:'c'.repeat(64)}]
  const unbound=resolveVoiceSpec({...input,emotions:noPointer})
  assert.equal(unbound.effective.voice.references[0].sha256,reference.media)
  assert.notEqual(unbound.selectedReference.fingerprint,expected.selectedReference.fingerprint)
  const blank={id:'new',emotions:[],outfits:[{key:'o'}]}
  assert.deepEqual(importFigureVariants({}, {new:blank},{}).figures.new,blank)
  const shared={name:'Shared',language:'zh',defaultSource:'q',sources:{q:{kind:'preset',provider:'qwen',voiceName:'Bella',model:'qwen3-tts-instruct-flash'}},variants:{}}
  const figures={}
  for(let i=0;i<3;i++){
    const id='11111111-0000-4000-8000-00000000000'+i
    shared.variants['v'+i]={tuning:{q:{moodInstruction:'style'+i}}}
    figures[id]={id,voice:{voice:'shared',variant:'v'+i},outfits:[{key:'o'}]}
  }
  const multi=importFigureVariants({voiceLibrary:{version:1,voices:{shared}}},figures,{})
  const pointers=Object.values(multi.figures).map((figure,i)=>{
    const pointer=figure.emotions.find(row=>row.id==='joy').voiceEmotion
    assert.equal(multi.manifest.voiceLibrary.voices.shared.emotions[pointer].tuning.q.moodInstruction,'style'+i)
    return pointer
  })
  assert.equal(new Set(pointers).size,3)
})
