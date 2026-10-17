// private fork: expand the shared emotion dependency in isolated client fragments.
import {withSpriteEmotionSource} from './helpers/sprite-emotion-source.mjs'
// private fork: calm-only resting media and first-enabled opening; no legacy slot/alias reader.
import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import {readFile} from 'node:fs/promises'
import avatar from '../tavern-plugin/lib/domain/pack-avatar.cjs'
import {selectPackFigure} from '../tavern-plugin/lib/domain/asset-pack-presentation.js'
import {validateFigure} from '../tavern-plugin/packages/dsh-asset-library/src/asset-packs/index.js'
import {syntheticPack,FIGURE_ID} from './fixtures/asset-packs/pack.mjs'
const source=withSpriteEmotionSource(await readFile(new URL('../tavern-plugin/lib/domain/pack-avatar.cjs',import.meta.url),'utf8'))
const browser=vm.runInNewContext(source+';({packAvatarState,selectPackAvatar,selectFigureAvatar})',{window:{}})
const state=id=>({id,src:id+'.png'})

for(const [runtime,api] of [['node',avatar],['browser',browser]]) {
  // private fork: own image wins; missing images rest only at calm, never at an arbitrary custom.
  test(runtime+': own image wins; missing slots rest only at calm',()=>{
    const manifest={emotions:Object.fromEntries(['joy','calm','other'].map(id=>[id,{src:id+'.png'}]))},outfit={sprite:{}}
    assert.equal(api.packAvatarState(outfit,manifest,'joy').id,'joy')
    assert.equal(api.packAvatarState(outfit,manifest,'crying').id,'calm')
    delete manifest.emotions.calm
    assert.equal(api.packAvatarState(outfit,manifest,'crying'),null)
    assert.equal(api.packAvatarState(outfit,{emotions:{}},'crying'),null)
  })
  test(runtime+': an exact emotion crop precedes calm avatar; missing emotions use calm, never retired default',()=>{
    const manifest={emotions:Object.fromEntries(['joy','calm','other'].map(id=>[id,{src:id+'.png'}]))}
    const outfit={sprite:{assets:{'joy.png':'joy-crop','calm.png':'calm-crop','other.png':'other-crop'}},avatars:{calm:'calm-face',default:'retired-face'}}
    assert.equal(api.selectPackAvatar({outfit,manifest,emotion:'joy'}).hash,'joy-crop')
    assert.equal(api.selectPackAvatar({outfit,manifest,emotion:'crying'}).hash,'calm-face')
    delete outfit.avatars.calm
    assert.equal(api.selectPackAvatar({outfit,manifest,emotion:'crying'}).hash,'calm-crop')
    assert.equal(api.selectPackAvatar({outfit:{avatars:{default:'retired-face'}},emotion:'calm'}),null)
    assert.equal(api.selectPackAvatar({outfit:{avatars:{sadness:'old-alias',calm:'rest'}},emotion:'sad'}).hash,'rest')
  })
  test(runtime+': opening skips disabled rows but an explicit missing or disabled outfit stays unavailable',()=>{
    const figure={enabled:true,outfits:[{key:'disabled',enabled:false,avatars:{calm:'disabled'}},{key:'daily',enabled:true,avatars:{calm:'daily'}}]}
    const before=structuredClone(figure)
    assert.equal(api.selectFigureAvatar(figure).outfitKey,'daily')
    assert.equal(api.selectFigureAvatar(figure,{}, {outfitKey:'disabled'}),null)
    assert.equal(api.selectFigureAvatar(figure,{}, {outfitKey:'missing'}),null)
    assert.deepEqual(figure,before)
  })
}
test('figure schema accepts ordinary default IDs without changing clone default reference',async()=>{
  const pack=await syntheticPack(),figure=pack.figures[FIGURE_ID]
  validateFigure(figure)
  const before=structuredClone(figure)
  figure.outfits[0].avatars.default=figure.outfits[0].avatars.calm
  // private fork: default is not a reserved difference ID.
  validateFigure(figure)
  delete figure.outfits[0].avatars.default
  assert.deepEqual(figure,before)
  assert.ok(pack.manifest.voiceLibrary.voices[figure.voice.voice].sources.fish.references[0])
})
test('Live2D unmapped emotion uses the first declared mapping, then the model pose',()=>{
  // private fork: fallback is explicit outfit order, not a reserved calm state.
  const outfit={key:'daily',enabled:true,defaultEmotion:'calm',live2d:{bundleKey:'model',emotionMap:{calm:{expression:'rest',motion:'idle'},sadness:{expression:'old'}}}}
  const figure={enabled:true,emotions:[{id:'calm',label:'平和'},{id:'sadness',label:'悲伤'}],outfits:[outfit]}
  assert.deepEqual(selectPackFigure(figure,{}, {emotion:'sad'}).live2dEmotion,{expression:'rest',motion:'idle'})
  delete outfit.live2d.emotionMap.calm
  assert.equal(selectPackFigure(figure,{}, {emotion:'sad'}).live2dEmotion,null)
})
