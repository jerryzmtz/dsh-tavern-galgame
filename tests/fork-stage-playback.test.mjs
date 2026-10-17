// private fork: new director commands use the catalogue's deterministic FigureRef identity.
import {figureActorKey} from '../tavern-plugin/lib/domain/figure-catalogue.js'
import {PACK_ID as actorPackId,FIGURE_ID as actorFigureId,distinctMedia} from './fixtures/asset-packs/pack.mjs'
const actorKey=figureActorKey({packId:actorPackId,figureId:actorFigureId})
// private fork: replay is host-derived; bytes, viewport and mount order cannot choose a ruler.
import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {fixture,answer,deferred} from './helpers/stage-director-harness.mjs'
import {readStageProjection} from '../tavern-plugin/lib/domain/stage-projection.js'
import {freezeJson} from '../tavern-plugin/lib/domain/freeze-json.js'
import {initialAssetPackStage,deriveAssetPackFigureScale} from '../tavern-plugin/lib/domain/stage-asset-pack-tools.js'
import {assetPackDigest} from '../tavern-plugin/lib/domain/stage-asset-pack-catalogue.js'
import {stagePlaybackRuler,validateStagePlayback,foldStagePlayback,saveStagePlayback,patchStagePlayback,addStageMeasurement,stagePlaybackFrame,createStagePlayback,stagePlaybackWriter,stagePlaybackFrames} from '../tavern-plugin/lib/domain/stage-playback.js'
const require = createRequire(import.meta.url)
const {stagePlaybackVisual} = require('../tavern-plugin/src/client/fork-stage-resource-runner.cjs')
const {forkFigureSceneUpdate,forkFigureSceneFrame,forkFigureCarry} = require('../tavern-plugin/packages/dsh-presentation-protocol/src/fork-figure-scale.cjs')
const clone = value => structuredClone(value)
// private fork: mutate the decoded DTO, then encode a candidate in the current format.
function editFrame(metadata, mutate) {
  const frames=stagePlaybackFrames(metadata), key=Object.keys(frames)[0]
  mutate(frames[key])
  stagePlaybackWriter(metadata)(key,frames[key])
}
const read = f => f.director.get(f.read(),f.turn,null,{readOnly:true})
async function setup(t,model=request => request.onToolCall({name:'stage_update',arguments:{...answer,beats:[{...answer.beats[0],ops:[...answer.beats[0].ops,{op:'cast.add',actor:actorKey}]},answer.beats[1]]}}),turn=1) {
  const f = await fixture(model)
  f.turn = turn
  t.after(()=>f.dispose())
  if (turn !== 1) await f.store.updateChat('chat',chat=>{chat.messages[0].turn=turn;return chat})
  f.project = async (at=1,history=true) => {
    const direction = await read(f)
    return readStageProjection({at,history,expectedDirectionToken:direction.token,readDirection:()=>read(f),readConsumer:()=>f.assets.consumer(f.read(),'http://localhost'),
      readSettings:()=>f.engineSettings.read(),revision:()=>f.assets.revision,
      readPlayback:()=>f.read().messages[0].stagePlaybackV1,
      writePlayback:async (direction,candidate)=>{
        let saved
        await f.store.updateChat('chat',chat=>{saved=saveStagePlayback(chat,f.turn,direction,candidate);return chat})
        return saved
      }})
  }
  f.direct = async()=>{await f.director.get(f.read());await f.director.drain()}
  return f
}
test('presentation patches only playback, detaches inputs and CAS-checks writes and no-ops',async t=>{
  const f=await setup(t);await f.direct();await f.project()
  const direction=await read(f),chat=f.read(),candidate=clone(chat.messages[0].stagePlaybackV1)
  chat._storageRevision=7
  delete chat.messages[0].stagePlaybackV1
  const original=clone(chat),input=clone(candidate),calls=[]
  let revision=7,stored=clone(chat),checks=0
  const options={assertCurrent:()=>{checks++},patch:async(id,expected,changes,metadata)=>{
    calls.push({id,expected,changes,metadata})
    if(expected!==revision)return undefined
    metadata.assertCurrent()
    if(changes.length){stored.messages[0].stagePlaybackV1=clone(changes[0].value);stored._storageRevision=++revision}
    return {revision}
  }}
  const writes=await Promise.allSettled([
    patchStagePlayback(chat,f.turn,direction,candidate,options),
    patchStagePlayback(chat,f.turn,direction,candidate,options)
  ])
  assert.equal(writes[0].status,'fulfilled')
  assert.equal(writes[1].reason.code,'REVISION_CONFLICT')
  assert.deepEqual(chat,original);assert.deepEqual(candidate,input)
  assert.equal(calls[0].id,chat.id);assert.equal(calls[0].expected,7)
  assert.deepEqual(calls[0].changes,[{op:'set',path:['messages',0,'stagePlaybackV1'],value:writes[0].value}])
  assert.deepEqual({...calls[0].metadata,assertCurrent:undefined},{source:'stage-playback',touchUpdatedAt:false,returnProjection:[],assertCurrent:undefined})
  const saved=await patchStagePlayback(stored,f.turn,direction,candidate,options)
  assert.equal(saved,stored.messages[0].stagePlaybackV1)
  assert.deepEqual(calls.at(-1).changes,[]);assert.equal(revision,8);assert.equal(checks,2)
  const stale=clone(stored);stale._storageRevision=7
  await assert.rejects(patchStagePlayback(stale,f.turn,direction,candidate,options),{code:'REVISION_CONFLICT'})
  await assert.rejects(patchStagePlayback(stored,f.turn,direction,candidate,{...options,assertCurrent:()=>{throw Error('revoked')}}),/revoked/)
})
function rulerRecord() {
  const actor = heightCm => ({figure:null,outfits:[],ruler:{heightCm,headRatio:1,elevationCm:0}})
  const baseline = initialAssetPackStage({small:actor(150),tall:actor(240)})
  const entries = [], append = (at,cast,ops,cut=false)=>{
    const before=entries.at(-1)?.state || baseline,state={...clone(before),cast}
    state.figureScale=deriveAssetPackFigureScale(before,state,at,cut)
    entries.push({at,ops,state,timeTransitionMs:0})
  }
  append(1,['small'],[{op:'cast.add',actor:'small'}])
  append(2,['small','tall'],[{op:'cast.add',actor:'tall'}])
  append(3,['small'],[{op:'cast.remove',actor:'tall'}])
  append(4,['small'],[{op:"transition.play", transition:'cut'}],true)
  return {baseline,entries,binding:{commandSpecVersion:2}}
}
test('P6 adapter matches gate frozen ruler inputs at every prefix; only cuts reset',()=>{
  const checked=rulerRecord()
  for(const entry of checked.entries) {
    // private fork: semantic ruler matches the gate; the last transition survives no-op beats for late prefixes.
    assert.deepEqual(forkFigureCarry(stagePlaybackRuler(checked,entry.at)),forkFigureCarry(entry.state.figureScale))
    assert.deepEqual(stagePlaybackRuler({...checked,entries:checked.entries.filter(e=>e.at<=entry.at)},entry.at),stagePlaybackRuler(checked,entry.at))
  }
  assert.equal(stagePlaybackRuler(checked,2).event.kind,'rescale')
  assert.equal(stagePlaybackRuler(checked,3).hMax,240)
  assert.equal(stagePlaybackRuler(checked,4).hMax,150)
  assert.equal(stagePlaybackRuler(checked,4).scene,stagePlaybackRuler(checked,3).scene+1)
})
test('verified snapshot rulers survive per-operation historical filtering without replay',()=>{
  const checked=rulerRecord(),filtered=clone(checked)
  for(const entry of filtered.entries)entry.ops=[]
  const original=clone(filtered)
  for(const entry of checked.entries)assert.deepEqual(stagePlaybackRuler(filtered,entry.at),stagePlaybackRuler(checked,entry.at))
  assert.equal(stagePlaybackRuler(filtered,4).hMax,150)
  assert.equal(stagePlaybackRuler(filtered,4).event.kind,'cut')
  assert.deepEqual(filtered,original)
})
test('late taller entrant keeps the existing animated rescale; history snaps',()=>{
  const checked=rulerRecord(), first=forkFigureSceneUpdate(null,stagePlaybackRuler(checked,1),0)
  const late=forkFigureSceneUpdate(first,stagePlaybackRuler(checked,2),100)
  assert.equal(late.from,150);assert.equal(late.to,240)
  assert.ok(forkFigureSceneFrame(late,700).hMax>150 && forkFigureSceneFrame(late,700).hMax<240)
  assert.equal(forkFigureSceneUpdate(first,stagePlaybackRuler(checked,2),100,true).from,240)
  assert.equal(forkFigureSceneUpdate(first,stagePlaybackRuler(checked,3),100).from,150,'late prefix still animates after the entrant page')
  assert.equal(forkFigureSceneUpdate(late,stagePlaybackRuler(checked,4),200).from,150)
})
test('visual group requires replay ruler and exposes it to the renderer before resource readiness',()=>{
  const value={state:{figureScale:stagePlaybackRuler(rulerRecord(),2),lighting:{}},scene:{backgroundUrl:{resource:true}},characters:[{alias:'small'}]}
  const visual=stagePlaybackVisual(value,{},{}), reverse=stagePlaybackVisual({...value,characters:[...value.characters].reverse()}, {}, {})
  assert.equal(visual.ruler,value.state.figureScale);assert.equal(visual.scene.figureScale,visual.ruler)
  assert.deepEqual(visual.ruler,reverse.ruler);assert.equal(visual.scene.backgroundUrl,value.scene.backgroundUrl)
  assert.throws(()=>stagePlaybackVisual({...value,state:{}},{},{}),/Missing P6 replay ruler/)
})
test('private fork: history keeps director boundaries but uses current variants',async t=>{
  const f=await setup(t);await f.direct()
  const first=await f.project(1);assert.equal(first.status,'ready',JSON.stringify(first))
  const direction=await read(f),metadata=f.read().messages[0].stagePlaybackV1
  assert.equal(metadata.reconstructed,true)
  assert.deepEqual(first.value.diagnostics,[])
  assert.ok(Object.keys(metadata.frames).length>=2)
  assert.equal(JSON.stringify(metadata).includes('hMax'),false)
  assert.equal(JSON.stringify(metadata).includes('blob:'),false)
  const lib=f.services.get('assetLibrary'),resolve=lib.resolveAssets
  lib.resolveAssets=async args=>(await resolve(args)).map(row=>row.value?.kind==='backgrounds'?{...row,value:{...row.value,variants:{...row.value.variants,entries:row.value.variants.entries.map(variant=>({...variant,content:{...variant.content,media:'f'.repeat(64)}}))}}}:row)
  f.changePack({revision:'changed'})
  const later=await f.project(2);assert.equal(later.status,'ready',JSON.stringify(later))
  const historical=foldStagePlayback(direction.record,metadata,direction,2)
  assert.notEqual(later.value.scene.backgroundUrl.hash,historical.scene.backgroundUrl.hash)
  const reentered=await f.project(1)
  assert.deepEqual(reentered.value.state.figureScale,first.value.state.figureScale)
  assert.equal(reentered.value.scene.backgroundUrl.hash,'f'.repeat(64))
  assert.equal(f.calls.length,1)
})
test('checkpoint partial -> done persists metadata on the message queue, not a closed task',async t=>{
  const sealed=deferred(),resume=deferred()
  const f=await setup(t,async request=>{
    const result=await request.onToolCall({name:'stage_update',arguments:{sequence:1,through:1,done:false,beats:[answer.beats[0]]}})
    assert.equal(JSON.parse(result).ok,true);sealed.resolve();await resume.promise
    await request.onToolCall({name:'stage_update',arguments:{sequence:2,through:2,done:true,beats:[answer.beats[1]]}})
  })
  await f.director.get(f.read());await sealed.promise
  const first=await f.project(1);resume.resolve();assert.equal(first.status,'ready',JSON.stringify(first))
  const prefix=clone(f.read().messages[0].stagePlaybackV1)
  resume.resolve();await f.director.drain()
  const done=await f.project(1);assert.equal(done.status,'ready',JSON.stringify(done))
  assert.deepEqual(first.value.state.figureScale,done.value.state.figureScale)
  const saved=f.read().messages[0].stagePlaybackV1
  assert.equal(saved.reconstructed,false)
  for(const [key,value] of Object.entries(prefix.frames))assert.deepEqual(saved.frames[key],value)
  assert.notDeepEqual(saved.acceptedPrefix,prefix.acceptedPrefix)
  const again=await f.project(2);assert.equal(again.status,'ready')
})
test('private fork: removing an asset degrades only that element on every visit',async t=>{
  const f=await setup(t);await f.direct();const first=await f.project()
  assert.equal(first.status,'ready')
  const lib=f.services.get('assetLibrary'),resolve=lib.resolveAssets
  lib.resolveAssets=async args=>(await resolve(args)).map(row=>row.ref.kind==='backgrounds'?{...row,value:null}:row)
  f.changePack({revision:'changed'})
  const missing=await f.project()
  assert.equal(missing.status,'ready');assert.equal(missing.value.scene.backgroundUrl,null)
  assert.equal(missing.value.notice,'部分素材已移除，已跳过')
  assert.equal((await f.project()).status,'ready');assert.equal(f.calls.length,1)
})
test('metadata validates source, version, frozen geometry and rejects locks and transports',async t=>{
  const f=await setup(t);await f.direct();assert.equal((await f.project()).status,'ready')
  const direction=await read(f),metadata=f.read().messages[0].stagePlaybackV1
  for(const mutate of [m=>m.version=1,m=>m.source.generation++,m=>m.locks={},m=>editFrame(m,f=>f.scene.hMax=900),m=>editFrame(m,f=>f.scene.backgroundUrl='blob:forged')]) {
    const bad=clone(metadata);mutate(bad);assert.throws(()=>validateStagePlayback(bad,direction))
  }
  const chat=f.read();chat.messages[0].stageDirectionGeneration=1
  assert.throws(()=>saveStagePlayback(chat,1,direction,metadata),/stale/)
  const changed=clone(metadata);editFrame(changed,f=>f.scene.timeOfDay='night')
  assert.throws(()=>saveStagePlayback(f.read(),1,direction,changed),/stale/)
  assert.deepEqual(saveStagePlayback(f.read(),1,direction,metadata),metadata)
})
test('derived geometry reports are hash/version checked and cannot override the gate ruler',async t=>{
  const directed={...answer,beats:[{at:1,ops:[...answer.beats[0].ops,{op:'cast.add',actor:actorKey}]},answer.beats[1]]}
  const f=await setup(t,request=>request.onToolCall({name:'stage_update',arguments:directed}));await f.direct()
  const first=await f.project();assert.equal(first.status,'ready',JSON.stringify(first))
  const direction=await read(f),metadata=f.read().messages[0].stagePlaybackV1
  const figure=Object.values(stagePlaybackFrames(metadata))[0].characters.find(c=>c.alias===actorKey)
  const hash=Object.values(figure.spriteUrls)[0].hash
  const input={geometryKey:figure.geometry.stage,hash,algorithm:1,metrics:{algorithmVersion:1,figureTop:0,visibleBottom:100}}
  const measured=addStageMeasurement(metadata,direction,input)
  assert.deepEqual(addStageMeasurement(measured,direction,input),measured)
  assert.deepEqual(foldStagePlayback(direction.record,measured,direction,1).state.figureScale,first.value.state.figureScale)
  for(const bad of [{...input,algorithm:2},{...input,metrics:{algorithmVersion:2}},{...input,hash:'f'.repeat(64)},{...input,metrics:{figureTop:Infinity}},{...input,metrics:{figureTop:1}}])assert.throws(()=>addStageMeasurement(measured,direction,bad))
})
test('old binding without unitsDigest is explicitly marked and still source checked',async t=>{
  const f=await setup(t);await f.direct()
  await f.store.updateChat('chat',chat=>{
    const record=chat.messages[0].stageDirectionAssetPacks;delete record.binding.unitsDigest
    record.digest=assetPackDigest({binding:record.binding,baseline:record.baseline,entries:record.entries,end:record.end})
    return chat
  })
  const direction=await read(f);assert.equal(direction.legacyPlayback,true)
  assert.equal((await f.project()).status,'ready')
  await f.store.updateChat('chat',chat=>{chat.messages[0].text='Changed source';return chat})
  assert.equal((await read(f)).token,null)
})

test('private fork: live and historical turns both use updated media without rewriting direction',async t=>{
  const f=await setup(t);await f.direct();const first=await f.project(1,false)
  assert.equal(first.status,'ready')
  const lib=f.services.get('assetLibrary'),resolve=lib.resolveAssets,pack=await lib.getPackSnapshot({packId:answer.beats[0].ops[0].background.packId})
  const night=pack.manifest.assets.find(asset=>asset.kind==='backgrounds' && asset.id==='classroom').variants.entries.find(row=>row.id==='night').content.media
  lib.resolveAssets=async args=>(await resolve(args)).map(row=>row.value?.kind==='backgrounds'?{...row,value:{...row.value,variants:{...row.value.variants,entries:row.value.variants.entries.map(variant=>({...variant,content:{...variant.content,media:night}}))}}}:row)
  f.changePack({revision:'changed'})
  const live=await f.project(1,false),history=await f.project(1,true)
  assert.equal(live.status,'ready');assert.equal(history.status,'ready')
  assert.notEqual(live.value.scene.backgroundUrl.hash,first.value.scene.backgroundUrl.hash)
  assert.equal(history.value.scene.backgroundUrl.hash,live.value.scene.backgroundUrl.hash)
  assert.equal(history.value.notice,undefined)
  assert.deepEqual(live.value.state.figureScale,history.value.state.figureScale)
})
test('private fork: bundle history resolves the current content closure',async t=>{
  const directed={...answer,beats:[{at:1,ops:[{op:'cast.add',actor:actorKey},{op:"actor.outfit.set", outfit:'casual', actor:actorKey}]}]}
  const f=await setup(t,request=>request.onToolCall({name:'stage_update',arguments:directed}));await f.direct()
  const first=await f.project();assert.equal(first.status,'ready',JSON.stringify(first))
  assert.equal(first.value.characters[0].modelUrl.kind,'bundle')
  const lib=f.services.get('assetLibrary'),get=lib.getPackSnapshot
  lib.getPackSnapshot=async args=>{const pack=clone(await get(args));if(pack)pack.manifest.bundles.casual.contentHash='f'.repeat(64);return pack}
  f.changePack({revision:'changed'})
  const updated=await f.project();assert.equal(updated.status,'ready');assert.equal(updated.value.characters[0].modelUrl.hash,'f'.repeat(64))
  assert.equal(updated.value.notice,undefined)
})
test('private fork: unavailable off-page media does not block the current page or restoration',async t=>{
  const music={packId:answer.beats[0].ops[0].background.packId,kind:'music',assetId:'classroom'}
  const directed={...answer,beats:[answer.beats[0],{at:2,ops:[{op:'scene.clear'},{op:"music.set", ref:music}]}]}
  const f=await setup(t,request=>request.onToolCall({name:'stage_update',arguments:directed}));await f.direct()
  assert.equal((await read(f)).phase,'done')
  const lib=f.services.get('assetLibrary'),resolve=lib.resolveAssets
  let unavailable=true
  lib.resolveAssets=async args=>(await resolve(args)).map(row=>row.ref.kind==='music' && unavailable?{...row,value:null}:row)
  f.changePack({revision:'changed'})
  const current=await f.project(1);assert.equal(current.status,'ready',JSON.stringify(current))
  const removed=await f.project(2);assert.equal(removed.status,'ready');assert.equal(removed.value.audio.music,null)
  assert.equal(removed.value.notice,'部分素材已移除，已跳过')
  unavailable=false;f.changePack({revision:'restored'})
  const history=await f.project(2);assert.equal(history.status,'ready');assert.ok(history.value.audio.music)
  assert.equal(history.value.notice,undefined)
  assert.equal((await f.project(2,false)).status,'ready')
})
test('sparse history snapshots cover idle paragraphs and camera expiration without reselecting media',async t=>{
  const directed={sequence:1,through:8,done:true,beats:[{at:1,ops:[...answer.beats[0].ops,{op:'cast.add',actor:actorKey}]},
    {at:2,ops:[{op:"closeup.play", actor:actorKey}]}]}
  const f=await setup(t,request=>request.onToolCall({name:'stage_update',arguments:directed}))
  await f.store.updateChat('chat',chat=>{chat.messages[0].text=Array.from({length:8},(_,i)=>'Synthetic paragraph '+i+'.').join('\n\n');return chat})
  await f.direct();assert.equal((await read(f)).phase,'done')
  for(const at of [8,1,4,2,6,7,3,5])assert.equal((await f.project(at)).status,'ready','paragraph '+at)
  assert.equal((await f.project(2)).value.state.camera.mode,'close')
  assert.equal((await f.project(8)).value.state.camera.mode,'reset')
})
test('late completion cannot write playback metadata into a regenerated source',async t=>{
  const f=await setup(t);await f.direct()
  const update=f.store.updateChat
  f.store.updateChat=async (id,fn)=>update(id,chat=>{chat.messages[0].stageDirectionGeneration=1;return fn(chat)})
  assert.equal((await f.project()).status,'stale')
  assert.equal(f.read().messages[0].stagePlaybackV1,undefined)
})

test('opposite resource load orders prepare the same visual ruler with the single owner',async()=>{
  const {createStageResourceOwner}=require('../tavern-plugin/src/client/fork-stage-resources.cjs')
  const ruler=stagePlaybackRuler(rulerRecord(),3),results=[],orders=[]
  for(const ids of [['small','tall'],['tall','small']]) {
    const order=[],owner=createStageResourceOwner({service:{async leaseMedia({hash}){return {revision:'r',url:hash,ticket:hash}},releaseLease(){}},
      fetch:async hash=>{await new Promise(resolve=>setImmediate(resolve));order.push(hash);return new Response('fixture')},
      urls:{createObjectURL:()=> 'blob:local',revokeObjectURL(){}}})
    try {
      const characters=ids.map((id,i)=>({alias:id,geometry:{stage:id},url:{resource:true,kind:'media',ref:{packId:'pack',figureId:id},revision:'r',identity:id,hash:id}}))
      const visual=stagePlaybackVisual({scene:{},state:{figureScale:ruler,lighting:{}},characters},{},{})
      const prepared=await owner.prepare(visual,'authority')
      assert.equal(prepared.pins.length,2)
      assert.deepEqual(prepared.value.ruler,prepared.value.scene.figureScale)
      results.push(prepared.value.ruler);orders.push(order);prepared.release()
    } finally {owner.dispose()}
  }
  assert.notDeepEqual(orders[0],orders[1]);assert.deepEqual(results[0],results[1])
})

// private fork: republished avatar authoring documents must not multiply the replay budget.
test('51-frame replay stores only selected avatar closures, not unused outfit states',async t=>{
  const f=await setup(t);await f.direct()
  const direction=await read(f),consumer=(await f.assets.consumer(f.read(),'http://localhost')).presentation
  const selected=await consumer.materialize(await consumer.character(actorKey,{actor:{outfitKey:'casual'}}),{descriptors:true})
  selected.avatarSource=clone(selected.avatarSource)
  for(let i=0;i<600;i++) {
    // private fork: even oversized synthetic dictionaries freeze only selected resources.
    selected.avatarSource.manifest.emotions['unused-'+i]={src:'unused-'+i+'.png'}
    selected.avatarSource.outfit.sprite.assets['unused-'+i+'.png']='a'.repeat(64)
  }
  const characters=Array.from({length:20},(_,i)=>({...selected,alias:'actor-'+i}))
  const metadata=createStagePlayback(direction)
  const append=stagePlaybackWriter(metadata)
  for(let i=0;i<51;i++) append(assetPackDigest({i}),stagePlaybackFrame({characters,avatars:characters,scene:{},audio:{}}))
  assert.doesNotThrow(()=>validateStagePlayback(metadata,direction))
  const recorded=Object.values(stagePlaybackFrames(metadata))[0].avatars[0]
  assert.equal(JSON.stringify(recorded.avatarSource).includes('unused-'),false)
  const replay=await consumer.frozen({characters:[recorded]})
  assert.equal(replay.characters[0].avatar,selected.avatar)
  assert.deepEqual(replay.characters[0].avatarCrop,selected.avatarCrop)
  assert.equal(Object.keys(selected.avatarSource.manifest.emotions).length,601,'input authoring documents remain untouched')
})

// private fork: a saved turn-126-like scene must replay with old and republished packs.
for (const calibrated of [false,true]) test(`turn 126 freezes and replays background plus three figures (${calibrated ? 'calibrated' : 'old'} pack)`,async t=>{
  const ids=['22222222-2222-4222-8222-222222222221','22222222-2222-4222-8222-222222222222','22222222-2222-4222-8222-222222222223']
  const cast=ids.map(figureId=>figureActorKey({packId:actorPackId,figureId}))
  const directed={sequence:1,through:54,done:true,beats:[
    {at:1,ops:[{op:'scene.clear'},{op:"cast.set", actors:cast}]},
    {at:54,ops:answer.beats[0].ops}]}
  const f=await setup(t,request=>request.onToolCall({name:'stage_update',arguments:directed}),126)
  const pack=await f.services.get('assetLibrary').getPackSnapshot({packId:actorPackId})
  const figure=pack.figures[actorFigureId]
  figure.outfits.reverse() // Live2D stage with sprite-backed cropped avatars.
  delete figure.outfits[0].avatars // private fork: an uploaded avatar image would win over the sprite crop.
  const anatomy={source:'calibrated',posture:'standing',crop:'full',figureTop:0,headTop:0,chin:0.15,
    visibleBottom:1,feet:1,supportX:0.5,poseHeightRatio:1,headRatio:1,assetScale:1}
  if(calibrated) figure.outfits[0].live2d.anatomy=anatomy
  pack.manifest.figures=ids
  for(const id of Object.keys(pack.figures)) delete pack.figures[id]
  ids.forEach((id,i)=>{pack.figures[id]=distinctMedia({...clone(figure),id,name:['Mami','Homura','Madoka'][i]},id)})
  await f.store.updateChat('chat',chat=>{chat.messages[0].text=Array.from({length:54},(_,i)=>'Synthetic paragraph '+i+'.').join('\n\n');return chat})
  await f.direct()
  for(const history of [true,false,true]) {
    const result=await f.project(54,history)
    assert.equal(result.status,'ready',JSON.stringify(result))
    assert.ok(result.value.scene.backgroundUrl?.resource)
    assert.deepEqual(result.value.state.cast,cast)
    assert.equal(result.value.characters.length,3)
    for(const item of result.value.characters) {
      assert.equal(item.form,'live2d');assert.equal(item.modelUrl.kind,'bundle')
      assert.deepEqual(item.anatomy,calibrated ? anatomy : null)
    }
    assert.ok(result.value.avatars.every(item=>item.avatarUrl.crop?.w>0))
  }
  assert.equal((await f.project(1)).value.scene.backgroundUrl,null,'an authored scene.clear must not acquire a substitute background')
  const direction=await read(f),metadata=f.read().messages[0].stagePlaybackV1
  assert.doesNotThrow(()=>validateStagePlayback(metadata,direction))
  const badCrops=[{},[],{x:0,y:0,w:0,h:1},{x:0.8,y:0,w:0.4,h:1},{x:0,y:0,w:1,h:1,url:'file:forged'}]
  for(const crop of badCrops) {
    const bad=clone(metadata);editFrame(bad,f=>f.avatars[0].avatarUrl.crop=crop)
    assert.throws(()=>validateStagePlayback(bad,direction))
  }
  const bad=clone(metadata);editFrame(bad,f=>f.characters[0].modelUrl.crop=null)
  assert.throws(()=>validateStagePlayback(bad,direction),'bundle descriptors cannot become cropped avatars')
})

// private fork: missing or revoked authoring degrades only that element; no revoked bytes are resolved.
test('private fork: history refreshes avatar crops and degrades a deleted figure without rewriting playback',async t=>{
  const f=await setup(t)
  // private fork: uploaded avatar images win over crops (owner); this case covers sprite-crop figures.
  const bound={packId:actorPackId,figureId:actorFigureId}
  for(const figure of Object.values((await f.services.get('assetLibrary').getPackSnapshot({packId:bound.packId})).figures)) for(const outfit of figure.outfits) delete outfit.avatars
  await f.direct()
  const first=await f.project(1);assert.equal(first.status,'ready')
  const metadata=f.read().messages[0].stagePlaybackV1
  const lib=f.services.get('assetLibrary'),ref=first.value.avatars[0].ref
  const pack=await lib.getPackSnapshot({packId:ref.packId}),figure=pack.figures[ref.figureId]
  const full={x:0,y:0,w:1,h:1}
  for(const outfit of figure.outfits) outfit.avatarCrop=full
  f.changePack({revision:'crop-review'})
  const current=await f.project(1);assert.equal(current.status,'ready',JSON.stringify(current))
  assert.deepEqual(current.value.avatars[0].avatarCrop,full)
  assert.deepEqual(f.read().messages[0].stagePlaybackV1,metadata)
  figure.enabled=false;f.changePack({revision:'disabled'})
  const disabled=await f.project(1)
  assert.equal(disabled.status,'ready');assert.equal(disabled.value.characters[0].form,null)
  assert.ok(disabled.value.scene.backgroundUrl,'disabling a figure cannot blank the background')
  delete pack.figures[ref.figureId];f.changePack({revision:'deleted-figure'})
  const fallback=await f.project(1)
  assert.equal(fallback.status,'ready',JSON.stringify(fallback))
  assert.equal(fallback.value.avatars[0].avatarUrl,undefined)
  assert.equal(fallback.value.notice,'部分素材已移除，已跳过')
  assert.deepEqual(f.read().messages[0].stagePlaybackV1,metadata)
  delete pack.manifest.blobs[first.value.avatars[0].avatarUrl.hash]
  f.changePack({revision:'deleted-media'})
  assert.equal((await f.project(1)).status,'ready','removed figures never retry frozen media')
})

// private fork: simulate a separate pack authoring process (no in-process event).
test('same-UUID publication refreshes cached media and anchors for completed historical and current turns',async t=>{
  const directed={...answer,beats:[{at:1,ops:[...answer.beats[0].ops,{op:'cast.add',actor:actorKey}]},answer.beats[1]]}
  const f=await setup(t,request=>request.onToolCall({name:'stage_update',arguments:directed}));await f.direct()
  const first=await f.project(1),record=clone((await read(f)).record),saved=clone(f.read().messages[0].stagePlaybackV1)
  assert.equal(first.status,'ready')
  const lib=f.services.get('assetLibrary'),ref=first.value.characters[0].ref
  const old=await lib.getPackSnapshot({packId:ref.packId}),pack=clone(old)
  pack.revision='pack-2'
  const replacement='e'.repeat(64),figure=pack.figures[ref.figureId],outfit=figure.outfits.find(o=>o.key===first.value.characters[0].outfitKey)
  for(const key of Object.keys(outfit.sprite.assets)) outfit.sprite.assets[key]=replacement
  const anatomy={anchors:{leftCheek:[0.2,0.3],rightCheek:[0.8,0.3]},ground:[0.5,0.95]}
  outfit.sprite.anatomy={[first.value.characters[0].state.id]:anatomy}
  for(const variant of pack.manifest.assets.find(a=>a.kind==='backgrounds'&&a.id==='classroom').variants.entries)variant.content.media=replacement
  lib.getPackSnapshot=async ({packId})=>packId===ref.packId?clone(pack):null
  lib.resolveFigures=async ({refs})=>refs.map(ref=>({ref,revision:pack.revision,value:clone(pack.figures[ref.figureId]),diagnostics:[]}))
  lib.resolveAssets=async ({refs})=>refs.map(ref=>({ref,revision:pack.revision,value:clone(pack.manifest.assets.find(a=>a.id===ref.assetId&&a.kind===ref.kind)),diagnostics:[]}))
  const revision=f.assets.revision
  for(const history of [true,false]) {
    const shown=await f.project(1,history)
    assert.equal(shown.status,'ready',JSON.stringify(shown))
    assert.equal(shown.value.notice,undefined)
    assert.equal(shown.value.scene.backgroundUrl.hash,replacement)
    assert.equal(shown.value.scene.backgroundUrl.revision,'pack-2')
    assert.deepEqual(shown.value.characters[0].anatomy,anatomy)
    assert.ok(Object.values(shown.value.characters[0].spriteUrls).every(item=>item.hash===replacement&&item.revision==='pack-2'))
    assert.deepEqual(shown.value.state,first.value.state)
  }
  assert.ok(f.assets.revision>revision,'external publication invalidates director/browser revision')
  assert.deepEqual((await read(f)).record,record)
  assert.deepEqual(f.read().messages[0].stagePlaybackV1,saved)
  assert.equal(f.calls.length,1,'completed turns never regenerate to repair media')
})

// private fork: a removed background pack must not revoke the still-bound cast.
for (const unavailable of ['unbound','deleted','disabled']) test('history falls back per reference: '+unavailable,async t=>{
  const original=answer.beats[0].ops[0].background, other='33333333-3333-4333-8333-333333333333';
  const oldRef={...original,packId:other};
  const directed={...answer,beats:[{at:1,ops:[{op:"scene.set", background:oldRef, time:'dusk'},{op:'cast.add',actor:actorKey}]}]};
  const f=await setup(t,request=>request.onToolCall({name:'stage_update',arguments:directed}));
  const lib=f.services.get('assetLibrary'), base=await lib.getPackSnapshot({packId:original.packId}), retired=clone(base);
  retired.manifest.id=other; retired.manifest.assets=retired.manifest.assets.filter(a=>a.kind==='backgrounds'||a.kind==='looks');
  retired.manifest.assets=retired.manifest.assets.map(asset=>distinctMedia(asset,other));
  const reads=[];
  lib.getPackSnapshot=async ({packId})=>{reads.push(packId);return packId===other?retired:base};
  lib.resolveAssets=async ({refs})=>refs.map(ref=>({ref,revision:'pack-1',value:(ref.packId===other?retired:base).manifest.assets.find(a=>a.id===ref.assetId&&a.kind===ref.kind),diagnostics:[]}));
  await f.direct(); const before=await f.project();assert.equal(before.status,'ready',JSON.stringify(before));
  const canonical=JSON.stringify(f.read().messages[0].stageDirectionAssetPacks);
  if(unavailable==='unbound'){
    f.workspace.raw.extensions.dsh_tavern.assetBindings.boundPackIds=[original.packId];
    // private fork: package withdrawal is the sole card resource permission.
  } else if(unavailable==='deleted') retired.manifest.assets=[];
  else for(const asset of retired.manifest.assets)asset.enabled=false;
  f.changePack({revision:'updated'});reads.length=0;
  for(const history of [false,true]){
    const result=await f.project(1,history);assert.equal(result.status,'ready',JSON.stringify(result));
    assert.deepEqual(result.value.scene.background,original);
    assert.equal(result.value.scene.timeOfDay,'dusk');assert.ok(result.value.scene.backgroundUrl);
    assert.equal(result.value.characters[0].form,'sprite');assert.ok(result.value.characters[0].spriteUrls);
    assert.equal(result.value.scene.time.timeOfDay,'dusk','global time lighting survives pack withdrawal');
    assert.ok(result.value.notice);
  }
  if(unavailable==='unbound')assert.ok(!reads.includes(other),'never even snapshot an unbound historical pack');
  assert.equal(JSON.stringify(f.read().messages[0].stageDirectionAssetPacks),canonical);
  assert.equal(f.calls.length,1,'history does not call the director');
});

test('private fork: missing background uses existing lexical recall within the scene, not unrelated later prose',async t=>{
  const f=await setup(t);await f.direct();
  const lib=f.services.get('assetLibrary'),pack=await lib.getPackSnapshot({packId:answer.beats[0].ops[0].background.packId});
  const bg=pack.manifest.assets.find(a=>a.kind==='backgrounds'&&a.id==='classroom');
  pack.manifest.assets.push({...clone(bg),id:'other',name:'Unrelated',recall:{mode:'keyword',keywords:['unrelated']}},
    {...clone(bg),id:'training',name:'Synthetic fixture',recall:{mode:'keyword',keywords:['fixture']}});
  bg.enabled=false;f.changePack({revision:'updated'});
  const result=await f.project();assert.equal(result.status,'ready',JSON.stringify(result));
  assert.equal(result.value.scene.background.assetId,'training');
});

// private fork: unavailable nonvisual channels must not reject an otherwise valid stage.
test('private fork: missing music, ambience and SFX degrade independently without changing history',async t=>{
  const packId=answer.beats[0].ops[0].background.packId;
  const directed={...answer,beats:[{at:1,ops:[...answer.beats[0].ops,{op:'cast.add',actor:actorKey},
    {op:"music.set", ref:{packId,kind:'music',assetId:'classroom'}},
    {op:"sfx.play", ref:{packId,kind:'sfx',assetId:'bell'}}]}]};
  const f=await setup(t,request=>request.onToolCall({name:'stage_update',arguments:directed}));await f.direct();
  const first=await f.project();assert.equal(first.status,'ready',JSON.stringify(first));
  const canonical=JSON.stringify(f.read().messages[0].stageDirectionAssetPacks);
  const lib=f.services.get('assetLibrary'),pack=await lib.getPackSnapshot({packId});
  for(const asset of pack.manifest.assets)if(['music','ambience','sfx'].includes(asset.kind))asset.enabled=false;
  f.changePack({revision:'audio-disabled'});
  const result=await f.project();assert.equal(result.status,'ready',JSON.stringify(result));
  assert.ok(result.value.scene.backgroundUrl);assert.equal(result.value.characters[0].form,'sprite');
  assert.equal(result.value.audio.music,null);assert.deepEqual(result.value.audio.soundscape.layers,[]);assert.deepEqual(result.value.audio.sfx,[]);
  assert.equal(JSON.stringify(f.read().messages[0].stageDirectionAssetPacks),canonical);
});

test('private fork: explicit scene.clear remains empty with available fallback backgrounds',async t=>{
  const directed={...answer,beats:[{at:1,ops:[{op:'scene.clear'},{op:'cast.add',actor:actorKey}]}]};
  const f=await setup(t,request=>request.onToolCall({name:'stage_update',arguments:directed}));await f.direct();
  const result=await f.project();assert.equal(result.status,'ready',JSON.stringify(result));
  assert.equal(result.value.scene.backgroundUrl,null);assert.equal(result.value.notice,undefined);
  assert.equal(result.value.characters[0].form,'sprite');
});

// private fork: a cold reconstruction must not reread the chat/card for each sealed boundary.
test('cold playback shares the consumer and pack snapshots, but warm requests recheck authority',async t=>{
  const f=await setup(t);await f.direct()
  const consumer=f.assets.consumer.bind(f.assets),presentation=(await consumer(f.read(),'http://localhost')).presentation
  let reads=0,snapshots=0
  f.assets.consumer=(...args)=>{reads++;return consumer(...args)}
  const sync=presentation.sync.bind(presentation)
  presentation.sync=refs=>{snapshots++;return sync(refs)}
  const first=await f.project()
  assert.equal(first.status,'ready')
  assert.equal(reads,2,'one reconstruction consumer plus the final live read')
  assert.equal(snapshots,3,'initial snapshot, pre-save publication check, final live projection')
  const metadata=clone(f.read().messages[0].stagePlaybackV1)
  assert.ok(Object.keys(metadata.frames).length>1,'all sealed boundaries are still frozen')
  const second=await f.project()
  assert.equal(second.status,'ready')
  assert.equal(reads,3,'consumer caching never escapes one reconstruction')
  assert.equal(snapshots,4)
  assert.deepEqual(second.value,first.value)
  assert.deepEqual(f.read().messages[0].stagePlaybackV1,metadata)
})
test('warm immutable playback skips reconstruction, but not media, page or source checks',async t=>{
  const f=await setup(t);await f.direct()
  let stored, writes=0, reads=0, revoked=false
  const direction=await read(f)
  const options={at:1,expectedDirectionToken:direction.token,readDirection:()=>read(f),
    readConsumer:()=>{reads++;return revoked?null:f.assets.consumer(f.read(),'http://localhost')},
    readSettings:()=>f.engineSettings.read(),revision:()=>f.assets.revision,readPlayback:()=>stored,
    writePlayback:async (direction,candidate)=>{
      writes++
      const saved=saveStagePlayback(f.read(),f.turn,direction,candidate)
      stored=freezeJson(clone(saved))
      return saved
    }}
  const first=await readStageProjection(options)
  assert.equal(first.status,'ready');assert.equal(writes,1)
  const snapshot=stored
  let clones=0
  const original=globalThis.structuredClone
  t.mock.method(globalThis,'structuredClone',value=>{if(value===snapshot)clones++;return original(value)})
  const warm=await readStageProjection(options)
  assert.equal(warm.status,'ready');assert.deepEqual(warm.value,first.value)
  assert.equal(clones,0,'the saved immutable sidecar is not validated/cloned again')
  assert.equal(writes,1);assert.equal(reads,3,'warm still reads current media/authority')
  warm.value.measurements.test='detached'
  assert.deepEqual(stored.measurements,{})
  const mismatch=await readStageProjection({...options,page:{version:1,index:999,para:1,offset:0}})
  assert.equal(mismatch.status,'failed');assert.equal(mismatch.error.code,'STAGE_PAGE_MISMATCH')
  const stale=await readStageProjection({...options,expectedDirectionToken:{...direction.token,generation:99}})
  assert.equal(stale.status,'stale')
  revoked=true
  assert.equal((await readStageProjection(options)).status,'revoked')
  revoked=false
  stored=freezeJson({...clone(snapshot),frames:{}})
  assert.equal((await readStageProjection(options)).status,'ready')
  assert.equal(writes,2,'a new sidecar identity must reconstruct missing sealed boundaries')
  stored=freezeJson({...clone(snapshot),nodes:[null]})
  assert.equal((await readStageProjection(options)).status,'stale','replacement corrupt sidecars are still rejected')
})
test('external pack publication during reconstruction prevents saving stale frames',async t=>{
  const f=await setup(t);await f.direct()
  const lib=f.services.get('assetLibrary'),get=lib.getPackSnapshot.bind(lib)
  let reads=0
  lib.getPackSnapshot=async args=>{
    const pack=clone(await get(args))
    if(++reads>1 && pack) pack.revision='external-publication'
    return pack
  }
  const result=await f.project()
  assert.equal(result.status,'stale')
  assert.equal(f.read().messages[0].stagePlaybackV1,undefined)
})
