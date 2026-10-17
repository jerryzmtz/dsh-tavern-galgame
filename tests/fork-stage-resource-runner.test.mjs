// private fork: background provenance replaces the former all-visual readiness group.
// private fork: resource/host fixtures are shared with the migrated F refresh tests.
import test from 'node:test'
import assert from 'node:assert/strict'
import {answer,deferred} from './helpers/stage-director-harness.mjs'
import {harness,drain,fixtureScale} from './helpers/stage-resource-harness.mjs'

test('real checkpoint/done projection pairs request and direction tokens; bytes are pinned before group commit',async t=>{
  const projections=[]
  const h=await harness(t,answer,(value,token,directionToken)=>{
    projections.push({token,directionToken})
    return {scene:value.scene,lighting:value.state.lighting,figures:value.characters,ruler:null}
  }), bytes=deferred();h.blockBytes(bytes.promise)
  await h.direct()
  assert.ok(h.requests.length)
  assert.equal(h.store.getSnapshot().accepted.scene,null)
  const request=h.requests.at(-1), token=h.store.getSnapshot().projection.token
  assert.deepEqual(request.expectedDirectionToken,h.store.getSnapshot().director.token)
  assert.notDeepEqual(request.expectedDirectionToken,token)
  assert.equal(projections.at(-1).token,token)
  assert.deepEqual(projections.at(-1).directionToken,request.expectedDirectionToken)
  bytes.resolve();await drain()
  assert.ok(h.store.getSnapshot().accepted.scene.backgroundUrl.startsWith('blob:'))
  assert.equal(h.store.getSnapshot().accepted.provenanceByChannel.background.token,token)
  assert.ok(h.owner.snapshot().pins>0)
  assert.equal(h.f.calls.length,1)
  assert.ok(h.requests.every(request=>request.expectedDirectionToken.digest))
})

for(const status of ['pending','failed','stale']) test(`${status} projection keeps last-good and retries through the same runner`,async t=>{
  const h=await harness(t);await h.direct()
  const accepted=h.store.getSnapshot().accepted.scene
  h.setResponse({status,error:'offline'});h.refresh();await drain()
  assert.equal(h.store.getSnapshot().accepted.scene,accepted)
  assert.equal(h.store.getSnapshot().pending.resources,true)
  h.setResponse(null);h.clock.advance(700);await drain()
  assert.equal(h.store.getSnapshot().accepted.scene.backgroundUrl,accepted.backgroundUrl)
  assert.equal(h.store.getSnapshot().pending.resources,false)
})

test('structured projection errors become localized text and preserve last-good until retry',async t=>{
  const h=await harness(t);await h.direct()
  const accepted=h.store.getSnapshot().accepted.scene
  h.setResponse({status:'failed',error:{code:'PROJECTION_FAILED',message:'authority is not defined'}})
  h.refresh();await drain()
  assert.match(h.store.getSnapshot().pending.error,/^PROJECTION_FAILED: 舞台资源投影失败（authority is not defined）$/)
  assert.equal(h.store.getSnapshot().accepted.scene,accepted)
  h.setResponse(null);h.clock.advance(700);await drain()
  assert.equal(h.store.getSnapshot().pending.error,null)
})

test('a racing token and cancelled byte preparation cannot replace last-good or resurrect after revoke',async t=>{
  const h=await harness(t);await h.direct()
  const accepted=h.store.getSnapshot().accepted.scene
  h.setResponse({status:'ready',directionToken:{digest:'wrong'},value:{}});h.refresh();await drain()
  assert.equal(h.store.getSnapshot().accepted.scene,accepted)
  const late=deferred();h.setResponse(()=>late.promise);h.refresh();await drain()
  h.resources.revoke('session',{packId:accepted.background.packId},h.store.dispatch,h.store.getSnapshot)
  assert.equal(h.store.getSnapshot().accepted.scene.backgroundUrl,null)
  late.resolve({status:'ready',directionToken:h.store.getSnapshot().director.token,value:{}});await drain()
  assert.equal(h.store.getSnapshot().accepted.scene.backgroundUrl,null)
  assert.equal(h.owner.snapshot().pins,0)
})

test('explicit clear releases its accepted pins and hidden observation does not emit audio policy changes',async t=>{
  const h=await harness(t);await h.direct()
  const before=h.presents.length, scene=h.store.getSnapshot().accepted.scene
  h.store.dispatch({type:'VISIBILITY',visible:false});h.clock.advance(9000);h.store.dispatch({type:'VISIBILITY',visible:true});await drain()
  assert.equal(h.presents.length,before)
  assert.equal(h.store.getSnapshot().accepted.scene,scene)
  const pins=h.owner.snapshot().pins
  h.store.dispatch({type:'CLEAR',source:h.source,groups:['visual'],reason:'scene.clear'});await drain()
  assert.equal(h.owner.snapshot().pins,pins-1,'avatars keep their independent pins')
  assert.equal(h.store.getSnapshot().accepted.scene,null)
})

test('outgoing accepted refs are revalidated even when absent from the new candidate',async t=>{
  const h=await harness(t);await h.direct();const before=h.requests.length;h.refresh();await drain()
  // private fork: refresh restarts whole-turn warming after the foreground validation read.
  const foreground=h.requests.slice(before).find(request=>request.validateResources)
  assert.ok(foreground.validateResources.some(item=>item.ref.kind==='backgrounds'))
})

test('scoped ref and alias revocation removes only matching visual nodes and ambience slots',async t=>{
  const h=await harness(t);await h.direct()
  const ref=(kind,assetId)=>({packId:'pack',kind,assetId})
  const track=(kind,id)=>({ref:ref(kind,id),identity:id,url:{resource:true,kind:'media',ref:ref(kind,id),identity:id,hash:id,revision:'pack-1'}})
  const figure={alias:'actor',ref:{packId:'figures',figureId:'actor'},identity:'figure',url:{resource:true,kind:'media',ref:{packId:'figures',figureId:'actor'},identity:'figure',hash:'figure',revision:'pack-1'}}
  h.setResponse({status:'ready',directionToken:h.store.getSnapshot().director.token,value:{
    scene:{background:ref('backgrounds','room'),backgroundMedia:track('backgrounds','room')},characters:[figure],avatars:[figure],widgets:[],state:{lighting:{},figureScale:fixtureScale},
    audio:{music:track('music','song'),soundscape:{version:1,layers:[{...track('ambience','rain'),slot:'weather'},{...track('ambience','roomtone'),slot:'place'}]},sfx:[]}
  }})
  h.refresh();await drain()
  const before=h.store.getSnapshot().accepted, music=before.music, background=before.scene.backgroundMedia.url
  h.resources.revoke('session',{refs:[ref('ambience','rain')]},h.store.dispatch,h.store.getSnapshot)
  assert.equal(h.store.getSnapshot().accepted.music,music)
  assert.equal(h.store.getSnapshot().accepted.scene.backgroundMedia.url,background)
  assert.deepEqual(h.store.getSnapshot().accepted.ambience.layers.map(layer=>layer.slot),['place'])
  const pins=h.owner.snapshot().pins
  h.resources.revoke('session',{aliases:['actor']},h.store.dispatch,h.store.getSnapshot)
  assert.deepEqual(h.store.getSnapshot().accepted.figures,[]);assert.deepEqual(h.store.getSnapshot().accepted.avatars,[])
  assert.equal(h.store.getSnapshot().accepted.music,music)
  assert.equal(h.owner.snapshot().pins,pins-2,'both view pins retire without stopping unrelated audio')
})

test('independent avatar preparation failure holds its last-good without delaying music; retry replaces it once',async t=>{
  const h=await harness(t);await h.direct()
  const avatars=h.store.getSnapshot().accepted.avatars
  const descriptor=hash=>({resource:true,kind:'media',ref:{packId:'p',kind:'music',assetId:hash},hash,identity:hash,revision:'pack-1'})
  h.setResponse({status:'ready',directionToken:h.store.getSnapshot().director.token,value:{state:{lighting:{},figureScale:fixtureScale},scene:null,characters:[],widgets:[],avatars:[{url:descriptor('bad-avatar')}],audio:{music:{identity:'new-song',url:descriptor('new-song')},soundscape:{version:1,layers:[]},sfx:[]}}})
  h.rejectBytes(url=>url.includes('bad-avatar'));h.refresh();await drain()
  assert.equal(h.store.getSnapshot().accepted.music.identity,'new-song')
  assert.equal(h.store.getSnapshot().accepted.avatars,avatars)
  assert.deepEqual(h.store.getSnapshot().projection.outstanding,['avatars'])
  assert.equal(h.store.getSnapshot().pending.error,'舞台资源读取失败（byte read failed）','retry scheduling preserves the preparation error')
  h.clock.advance(700);await drain()
  assert.equal(h.store.getSnapshot().pending.error,'舞台资源读取失败（byte read failed）','repeated failed preparation retains its diagnosis')
  h.rejectBytes(null);h.clock.advance(700);await drain()
  assert.notEqual(h.store.getSnapshot().accepted.avatars,avatars)
  assert.equal(h.store.getSnapshot().projection,null)
  assert.equal(h.store.getSnapshot().pending.error,null)
})

test('SFX uses the resource handle but event ordinals remain distinct; refresh never replays an event',async t=>{
  const direction=structuredClone(answer), value={packId:answer.beats[0].ops[0].background.packId,kind:'sfx',assetId:'bell'}
  direction.beats.forEach(beat=>beat.ops.push({op:"sfx.play", ref:value}))
  const h=await harness(t,direction);await h.direct();h.clock.advance(700);await drain()
  assert.equal(h.plays.length,1,JSON.stringify(h.store.getSnapshot().ledger))
  assert.ok(h.plays[0].track.url.startsWith('blob:'))
  h.refresh();await drain();assert.equal(h.plays.length,1)
  h.store.dispatch({type:'PAGE',index:1});await drain()
  assert.equal(h.plays.length,2)
  assert.equal(h.plays[0].track.identity,h.plays[1].track.identity)
  assert.notEqual(h.plays[0].token.key,h.plays[1].token.key)
})

test('skip cancels pending SFX and late pinned bytes cannot play after skip ends',async t=>{
  const direction=structuredClone(answer), value={packId:answer.beats[0].ops[0].background.packId,kind:'sfx',assetId:'bell'}
  direction.beats[0].ops.push({op:"sfx.play", ref:value})
  const h=await harness(t,direction), bytes=deferred();h.blockBytes(bytes.promise);await h.direct()
  h.store.dispatch({type:'SKIP_START',index:1});h.store.dispatch({type:'SKIP_END'});bytes.resolve();await drain()
  assert.equal(h.plays.length,0)
  assert.ok(Object.values(h.store.getSnapshot().ledger).every(entry=>entry.status==='skipped'))
})

test('alias revoke preserves another alias sharing the exact same pinned content',async t=>{
  const h=await harness(t);await h.direct()
  const ref={packId:'figures',figureId:'shared'}
  const figure=alias=>({alias,ref,identity:'shared',url:{resource:true,kind:'media',ref,alias,identity:'shared',hash:'shared',revision:'pack-1'}})
  h.setResponse({status:'ready',directionToken:h.store.getSnapshot().director.token,value:{state:{lighting:{},figureScale:fixtureScale},scene:null,characters:[figure('left'),figure('right')],avatars:[figure('left'),figure('right')],widgets:[],audio:{music:null,soundscape:{version:1,layers:[]},sfx:[]}}})
  h.refresh();await drain()
  const before=h.store.getSnapshot().accepted, url=before.figures[0].url
  assert.equal(url,before.figures[1].url)
  h.resources.revoke('session',{aliases:['left']},h.store.dispatch,h.store.getSnapshot)
  for(const group of ['figures','avatars']) {
    assert.deepEqual(h.store.getSnapshot().accepted[group].map(figure=>figure.alias),['right'])
    assert.equal(h.store.getSnapshot().accepted[group][0].url,url)
  }
  assert.ok(!h.revoked.includes(url));assert.equal(h.owner.snapshot().pins,2)
  h.resources.revoke('session',{aliases:['right']},h.store.dispatch,h.store.getSnapshot)
  assert.deepEqual(h.store.getSnapshot().accepted.figures,[])
  assert.equal(h.owner.snapshot().pins,0)
})

test('equal prepared groups retain accepted references and do not notify media sinks',async t=>{
  const h=await harness(t);await h.direct()
  const accepted=h.store.getSnapshot().accepted, presented=h.presents.length, pins=h.owner.snapshot().pins
  for(let i=0;i<3;i++){h.refresh();await drain()}
  assert.equal(h.store.getSnapshot().accepted,accepted)
  assert.equal(h.presents.length,presented)
  assert.equal(h.owner.snapshot().pins,pins)
})

test('scoped revocation skips a pending SFX event before its late bytes complete',async t=>{
  const direction=structuredClone(answer),value={packId:answer.beats[0].ops[0].background.packId,kind:'sfx',assetId:'bell'}
  direction.beats[0].ops.push({op:"sfx.play", ref:value})
  const h=await harness(t,direction),bytes=deferred();h.blockBytes(bytes.promise);await h.direct()
  assert.ok(Object.values(h.store.getSnapshot().ledger).some(entry=>entry.status==='pending'))
  h.resources.revoke('session',{refs:[value]},h.store.dispatch,h.store.getSnapshot)
  assert.ok(Object.values(h.store.getSnapshot().ledger).every(entry=>entry.status==='skipped'))
  bytes.resolve();await drain()
  assert.equal(h.plays.length,0)
})

test('first view pins only cast faces; idle fills the face catalogue without a scene revision or sprite leases',async t=>{
  const idle=deferred(),h=await harness(t,answer,undefined,{idle:()=>idle.promise});await h.direct()
  const descriptor=id=>({resource:true,kind:'media',ref:{packId:'p',figureId:id},hash:id,identity:id,revision:'pack-1'})
  const avatar=alias=>({alias,ref:{packId:'p',figureId:alias},avatarUrl:descriptor(alias),media:{avatar:{identity:alias,url:descriptor(alias)},resources:{unused:{url:descriptor(alias+'-unused')}}},spritePack:{url:descriptor(alias+'-unused')},state:{id:'calm'}})
  const token=h.store.getSnapshot().director.token
  h.setResponse({status:'ready',directionToken:token,value:{state:{cast:['onstage'],lighting:{},figureScale:fixtureScale},scene:{},characters:[],widgets:[],avatars:[avatar('onstage'),avatar('offstage')],audio:{music:null,soundscape:{version:1,layers:[]}},sfx:[]}})
  h.refresh();await drain()
  assert.deepEqual(h.store.getSnapshot().accepted.avatars.map(a=>a.alias),['onstage'])
  assert.ok(!h.owner.debug().resources.some(r=>r.identity==='offstage'||r.identity?.endsWith('-unused')))
  const revision=h.store.getSnapshot().accepted.presentationRevision
  idle.resolve(true);await drain()
  assert.deepEqual(h.store.getSnapshot().accepted.avatars.map(a=>a.alias),['onstage','offstage'])
  assert.equal(h.store.getSnapshot().accepted.presentationRevision,revision,'idle portraits must not re-present the scene')
  assert.ok(!h.owner.debug().resources.some(r=>r.identity?.endsWith('-unused')))
})
