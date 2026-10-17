// private fork: new director commands use the catalogue's deterministic FigureRef identity.
import {figureActorKey} from '../tavern-plugin/lib/domain/figure-catalogue.js'
import {PACK_ID as actorPackId,FIGURE_ID as actorFigureId} from './fixtures/asset-packs/pack.mjs'
const actorKey=figureActorKey({packId:actorPackId,figureId:actorFigureId})
// private fork: an avatar-only player's portrait is independent of historical stage actors.
import test from 'node:test'
import assert from 'node:assert/strict'
import {fixture,answer} from './helpers/stage-director-harness.mjs'
import {cardExtension} from './fixtures/asset-packs/pack.mjs'
import {readStageProjection} from '../tavern-plugin/lib/domain/stage-projection.js'
import {createStagePlayback,stagePlaybackFrame,stagePlaybackKey,stagePlaybackWriter} from '../tavern-plugin/lib/domain/stage-playback.js'
import {cardBubbleConfig} from '../tavern-plugin/lib/fork-card-stage.js'

test('bound non-stage portrait survives existing unbound playback frames without rewriting history',async t=>{
  const extension=cardExtension()
  // private fork: appearance is owned by the figure, not the card.
  const f=await fixture(request=>request.onToolCall({name:'stage_update',arguments:answer}),{extension,configurePack:pack=>{pack.figures[actorFigureId].appearance='avatar'}})
  t.after(()=>f.dispose())
  await f.director.get(f.read());await f.director.drain()
  const direction=await f.director.get(f.read(),1,null,{readOnly:true})
  const consumer=await f.assets.consumer(f.read(),'http://localhost')
  const options={at:1,expectedDirectionToken:direction.token,readDirection:()=>direction,readConsumer:()=>consumer,
    readSettings:()=>f.engineSettings.read(),revision:()=>f.assets.revision}
  const projected=await readStageProjection(options)
  assert.equal(projected.status,'ready')
  assert.equal(projected.value.state.actors[actorKey],undefined)
  assert.equal(projected.value.characters.find(x=>x.alias===actorKey).ref,null,'stage figure stays historical')
  const portrait=projected.value.avatars.find(x=>x.alias===actorKey)
  assert.ok(portrait.avatarUrl?.resource)
  assert.equal(portrait.views.stage,false)
  const pack=await f.services.get('assetLibrary').getPackSnapshot({packId:portrait.ref.packId})
  const config=cardBubbleConfig(f.workspace.raw,f.engineSettings.read().values,[pack])
  assert.equal(config.characters.find(x=>x.alias===actorKey).avatarMedia.default.hash,portrait.avatar,'transcript and stage face use the same calm portrait')
  const old=createStagePlayback(direction), append=stagePlaybackWriter(old)
  for(const at of [1,2]) {
    const value=await readStageProjection({...options,at})
    const frame=stagePlaybackFrame(value.value)
    frame.avatars=[{alias:actorKey,ref:null,form:null,diagnostics:['figure-unbound']}]
    append(stagePlaybackKey(direction.record,at,direction),frame)
  }
  old.acceptedPrefix=direction.token
  const before=structuredClone(old),record=structuredClone(direction.record)
  const replay=await readStageProjection({...options,readPlayback:()=>old,writePlayback:()=>assert.fail('existing frames must not be rewritten')})
  assert.equal(replay.status,'ready')
  assert.equal(replay.value.avatars.find(x=>x.alias===actorKey).avatar,portrait.avatar)
  assert.deepEqual(old,before)
  assert.deepEqual(direction.record,record)
  // A removed/disabled figure still degrades instead of borrowing another binding.
  const service=f.services.get('assetLibrary')
  service.resolveFigures=async({refs})=>refs.map(ref=>({ref,revision:'pack-1',value:null,diagnostics:['figure-unavailable']}))
  f.changePack()
  const unavailable=await readStageProjection(options)
  assert.equal(unavailable.status,'ready')
  assert.equal(unavailable.value.avatars.find(x=>x.alias===actorKey).avatarUrl,undefined)
})
