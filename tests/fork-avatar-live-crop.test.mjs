// private fork: synthetic pack assertions use canonical emotion ownership, not free-form state identities.
// private fork: crop review is presentation, never a historical director decision.
import test from 'node:test'
import assert from 'node:assert/strict'
import {syntheticPack,cardExtension,FIGURE_ID} from './fixtures/asset-packs/pack.mjs'
import {createAssetPackPresentation,DEFAULT_AVATAR_CROP} from '../tavern-plugin/lib/domain/asset-pack-presentation.js'
import {stagePlaybackFrame} from '../tavern-plugin/lib/domain/stage-playback.js'
import {defaultAssetEngineSettings} from '../tavern-plugin/lib/domain/asset-engine-settings.js' // private fork: complete v3 engine fixture
import {cardBubbleConfig} from '../tavern-plugin/lib/fork-card-stage.js'

async function fixture(t) {
  const pack=await syntheticPack(),raw={extensions:{dsh_tavern:cardExtension()}}
  // private fork: uploaded avatar images win over crops (owner); these cases cover sprite-crop figures.
  for(const figure of Object.values(pack.figures)) for(const outfit of figure.outfits) delete outfit.avatars
  const service={apiVersion:2,subscribe:()=>()=>{},getPackSnapshot:async()=>({...pack,revision:'current'}),
    resolveFigures:async({refs})=>refs.map(ref=>({ref,value:pack.figures[ref.figureId],revision:'current',diagnostics:[]}))}
  const presentation=createAssetPackPresentation({raw,getService:()=>service})
  t.after(()=>presentation.dispose())
  const selected=await presentation.materialize(await presentation.character('actor',{emotion:'crying'}),{descriptors:true})
  const frame=stagePlaybackFrame({characters:[selected],avatars:[selected],scene:{},audio:{}})
  return {pack,raw,presentation,frame,outfit:pack.figures[FIGURE_ID].outfits[0]}
}
const manual={x:0,y:0,w:1,h:1},outfitCrop={x:0.1,y:0.1,w:0.8,h:0.8},auto={x:0.2,y:0.1,w:0.6,h:0.6}

test('old frozen crop uses current manual, outfit, auto and default crops without changing historical selection',async t=>{
  const {pack,presentation,frame,outfit}=await fixture(t),before=structuredClone(frame)
  outfit.sprite.avatarCrop={crying:manual}
  outfit.avatarCrop=outfitCrop
  outfit.sprite.avatarCropAuto={crying:auto}
  // private fork: republishing this own slot must not replace frozen state/media identity.
  pack.sprites.school.emotions.crying=structuredClone(pack.sprites.school.emotions.calm)
  outfit.sprite.assets['assets/stage-special.png']=pack.manifest.assets[0].media
  for(const expected of [manual,outfitCrop,auto,DEFAULT_AVATAR_CROP]) {
    presentation.refresh()
    const replay=await presentation.frozen(frame)
    for(const shown of [...replay.characters,...replay.avatars]) {
      assert.deepEqual(shown.avatarCrop,expected)
      assert.deepEqual(shown.avatarUrl.crop,expected)
      assert.deepEqual(shown.media.avatar.url.crop,expected)
      for(const key of ['ref','outfitKey','state','avatarStateId','avatarOutfitKey','avatar','spriteUrls','live2dEmotion']) {
        assert.deepEqual(shown[key],frame.avatars[0][key],key)
      }
    }
    if(outfit.sprite.avatarCrop) delete outfit.sprite.avatarCrop
    else if(outfit.avatarCrop) delete outfit.avatarCrop
    else delete outfit.sprite.avatarCropAuto
  }
  assert.deepEqual(frame,before,'historical descriptors are never migrated in place')
})

for(const missing of ['state','outfit','figure']) test(`missing current ${missing} preserves frozen crop and media`,async t=>{
  const {pack,presentation,frame,outfit}=await fixture(t)
  outfit.avatarCrop=manual
  if(missing==='state') delete pack.sprites.school.emotions.crying
  if(missing==='outfit') pack.figures[FIGURE_ID].outfits=[]
  if(missing==='figure') delete pack.figures[FIGURE_ID]
  presentation.refresh()
  const replay=await presentation.frozen(frame)
  assert.deepEqual(replay.avatars[0].avatarUrl,frame.avatars[0].avatarUrl)
  assert.deepEqual(replay.avatars[0].avatarCrop,frame.avatars[0].avatarCrop)
})

test('transcript and backlog card descriptors share the current pack crop',async t=>{
  const {pack,raw,outfit}=await fixture(t)
  outfit.sprite.avatarCrop={calm:manual}
  const config=cardBubbleConfig(raw,defaultAssetEngineSettings(),[pack])
  assert.deepEqual(config.characters[0].avatarMedia.default.crop,manual)
})
