// private fork: new director commands use the catalogue's deterministic FigureRef identity.
import {figureActorKey} from '../tavern-plugin/lib/domain/figure-catalogue.js'
import {PACK_ID as actorPackId,FIGURE_ID as actorFigureId} from './fixtures/asset-packs/pack.mjs'
const actorKey=figureActorKey({packId:actorPackId,figureId:actorFigureId})
// private fork: real task coordinator + Story Timeline + source runner; only model,
// byte service and time are local fixtures. No direction hook or final-result stub.
import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {fixture, deferred, answer} from './helpers/stage-director-harness.mjs'
import {createFakeClock, runtimeSource, runtimeText, runtimePage} from './helpers/stage-runtime-harness.mjs'
import {readAssetPackRecord, readAssetPackPreview, foldAssetPackEntries, assetPackStateAt} from '../tavern-plugin/lib/domain/stage-asset-pack-director.js'
import {readStageProjection} from '../tavern-plugin/lib/domain/stage-projection.js'
const require = createRequire(import.meta.url)
const {createStageDirectorSource,validateStageDirection} = require('../tavern-plugin/src/client/fork-stage-director-source.cjs')
const {createStageRuntimeStore} = require('../tavern-plugin/src/client/fork-stage-runtime-store.cjs')
const settle = async store => {
  // private fork: WebCrypto uses worker threads; loop counts race under the full suite.
  const deadline=Date.now()+2000
  while(Date.now()<deadline) {
    await new Promise(resolve => setTimeout(resolve,1))
    if (!store.getSnapshot().observation.flight) return
  }
  assert.fail('source did not settle')
}
const read = f => f.director.get(f.read(),1,null,{readOnly:true})
async function observe(f,t) {
  const clock = createFakeClock(), calls = [], source = runtimeSource({sessionId:'session'})
  let connected = true, fail = false, active = 0, maxActive = 0, subscribers = 0
  const runner = createStageDirectorSource({clock,
    read:async args => {calls.push(args); active++; maxActive = Math.max(maxActive,active); try {
      if (fail) {fail = false; throw Error('Offline')}
      return await f.director.get(f.read(),args.turn,null,args)
    } finally {active--}},
    watch:(source,wake) => {subscribers++; const stop = f.signals.subscribe(source.sessionId,'stage-direction',() => {if(connected) wake()}); return () => {subscribers--; stop()}}})
  const store = createStageRuntimeStore({runEffect:(...args) => runner.runEffect('session',...args)})
  const envelope = await read(f), text = {...runtimeText(1,[runtimePage(1,0,{voice:{text:'Synthetic fixture.',alias:'actor'}}),runtimePage(2)]), units:envelope.displayUnits}
  store.dispatch({type:'TURN_CHANGED',source,text})
  await settle(store)
  t.after(() => {store.dispose(); runner.dispose(); assert.equal(clock.size,0); assert.equal(subscribers,0)})
  return {store,clock,calls,source,text,get maxActive(){return maxActive},get subscribers(){return subscribers},
    disconnect:() => {connected=false}, reconnect:() => {connected=true; store.dispatch({type:'RECONCILE',source})},
    fail:() => {fail=true}}
}

test('sending the next turn persists visible cancellation on the old turn and rejects late director writes', async t => {
  const started = deferred(), finish = deferred(), logs = []
  const f = await fixture(async request => {
    started.resolve()
    await finish.promise
    await request.onToolCall({name:'stage_update',arguments:answer})
  }, {log:event => logs.push(event)})
  t.after(() => {finish.resolve(); return f.dispose()})
  await f.director.get(f.read(),1,null)
  await started.promise
  const next = f.beginReply(2)
  await new Promise(resolve => setImmediate(resolve))
  const cancellation = await read(f)
  assert.equal(cancellation.status,'error')
  assert.equal(cancellation.code,'DIRECTOR_NEXT_TURN_CANCELLED')
  assert.equal(f.read().messages[0].stageDirectionAssetPacksFailure.code, cancellation.code)
  f.commitReply(next,2,'A different scene for the next turn.')
  finish.resolve()
  await f.director.drain()
  assert.equal(f.read().messages[0].stageDirectionAssetPacks, undefined)
  assert.equal(f.read().messages[1].stageDirectionAssetPacksFailure, undefined)
  assert.equal((await read(f)).code,'DIRECTOR_NEXT_TURN_CANCELLED')
  assert.equal(logs.some(event => event.kind === 'director-failure-persistence'), false)
})

test('checkpoint precedes preview wake, partial and complete share fold and stable event ordinals',async t => {
  const checkpoint = deferred(), finish = deferred()
  let f
  f = await fixture(async request => {
    const batch = {...answer,through:1,done:false,beats:[answer.beats[0]]}
    assert.equal(JSON.parse(await request.onToolCall({name:'stage_update',arguments:batch})).ok,true)
    checkpoint.resolve(); await finish.promise
    await request.onToolCall({name:'stage_update',arguments:{sequence:2,through:2,done:true,beats:[answer.beats[1]]}})
  }); t.after(() => {finish.resolve(); return f.dispose()})
  const o = await observe(f,t)
  assert.equal(o.store.getSnapshot().director.phase,'unknown')
  assert.equal(f.calls.length,0,'readOnly cannot start a model task')
  f.signals.subscribe('session','stage-direction',() => {
    if (f.read().messages[0].stageDirectionAssetPacksDraft) assert.ok(f.read().messages[0].stageDirectionAssetPacksDraft.state) // private fork
  })
  await f.director.get(f.read()); await checkpoint.promise; await settle(o.store)
  const partial = await read(f)
  assert.equal(partial.phase,'partial'); assert.equal(partial.through,1)
  assert.equal(f.read().messages[0].stageDirectionAssetPacks,undefined)
  assert.ok(readAssetPackPreview(partial.preview))
  assert.throws(() => readAssetPackRecord(partial.preview),/Unknown field/)
  assert.equal(o.store.getSnapshot().director.through,1)
  o.store.dispatch({type:'PAGE',index:1}); o.store.dispatch({type:'READ_PROGRESS',readThrough:6})
  const anchor = o.store.getSnapshot().cursor.anchor
  finish.resolve(); await f.director.drain(); await settle(o.store)
  const done = await read(f)
  assert.equal(o.store.getSnapshot().director.phase,'done')
  assert.deepEqual(o.store.getSnapshot().cursor.anchor,anchor)
  assert.deepEqual(foldAssetPackEntries(partial.preview,1),assetPackStateAt(done.record,1))
  assert.equal((await f.director.get(f.read(),1,null,{readOnly:true,sinceRevision:done.revision})).unchanged,true)
  assert.equal(o.maxActive,1); assert.equal(o.clock.size,1)
})

for (const initial of ['missing','off','error','done']) test(`non-running ${initial} stays observed: missed running/direct done reconciles without re-entry`,async t => {
  let failModel = initial === 'error'
  const f = await fixture(request => {if(failModel) throw Error('Model failed'); return request.onToolCall({name:'stage_update',arguments:answer})})
  t.after(() => f.dispose())
  if (initial === 'error' || initial === 'done') {await f.director.get(f.read()); await f.director.drain()}
  const bindings = f.workspace.raw.extensions.dsh_tavern.assetBindings
  if (initial === 'off') delete f.workspace.raw.extensions.dsh_tavern.assetBindings
  const o = await observe(f,t), oldRevision = o.store.getSnapshot().director.revision
  assert.equal(o.store.getSnapshot().director.phase,initial === 'missing' ? 'unknown' : initial)
  assert.equal(o.subscribers,1)
  o.disconnect()
  if (initial === 'off') f.workspace.raw.extensions.dsh_tavern.assetBindings = bindings
  if (initial === 'error') {failModel = false; const reset = await f.director.retry(f.read(),1); assert.equal(reset.generation,1)}
  if (initial === 'done') {
    // Same source and mounted owner: a historical redirection can miss running too.
    await f.director.generate(f.read(),1)
  } else await f.director.get(f.read(),1)
  await f.director.drain()
  o.clock.advance(5000); await settle(o.store)
  assert.equal(o.store.getSnapshot().director.phase,'done')
  assert.ok(o.store.getSnapshot().director.revision>oldRevision)
  assert.equal(o.subscribers,1); assert.equal(o.maxActive,1)
  assert.ok(o.calls.every(call => call.readOnly === true))
  assert.equal(f.calls.length,initial === 'missing' || initial === 'off' ? 1 : 2)
})

test('failed read, reconnect wake during single flight, hidden resume and history observation are read-only',async t => {
  const f = await fixture(request => request.onToolCall({name:'stage_update',arguments:answer})); t.after(() => f.dispose())
  const o = await observe(f,t)
  o.fail(); o.reconnect(); await settle(o.store)
  assert.match(o.store.getSnapshot().observation.error,/Offline/)
  assert.equal(o.clock.size,1)
  // private fork: hidden windows retain data polling and apply sealed results.
  o.store.dispatch({type:'VISIBILITY',visible:false}); assert.equal(o.clock.size,1)
  await f.director.get(f.read()); await f.director.drain(); await settle(o.store)
  assert.equal(o.store.getSnapshot().director.phase,'done')
  o.store.dispatch({type:'VISIBILITY',visible:true}); o.reconnect(); o.reconnect(); await settle(o.store)
  assert.equal(o.store.getSnapshot().director.phase,'done'); assert.equal(o.maxActive,1)
  const count = f.calls.length
  o.store.dispatch({type:'HISTORY_JUMP',source:o.source,text:o.text,anchor:o.text.pages[0].anchor}); await settle(o.store)
  assert.equal(o.clock.size,0); assert.equal(o.subscribers,1)
  o.reconnect(); await settle(o.store); assert.equal(f.calls.length,count)
})

test('real envelope rejects mismatched text, binding, sealed extent and mismatched digest identity',async t => {
  const f = await fixture(request => request.onToolCall({name:'stage_update',arguments:answer})); t.after(() => f.dispose())
  await f.director.get(f.read()); await f.director.drain()
  const value = await read(f), source = runtimeSource({sessionId:'session'}), text = {units:value.displayUnits,streaming:false,pages:value.pageIndex.pages.map(({para,offset})=>({anchor:{para,offset}}))} // private fork: real page coordinates
  assert.equal((await validateStageDirection(value,source,text)).phase,'done')
  // private fork: host-computed digests are compared as identities, not re-hashed in the browser.
  for (const edit of [v => {v.record.digest='bad'},v => {v.through=0},v => {v.target.sourceDigest='bad'}]) {
    const corrupt = structuredClone(value); edit(corrupt)
    await assert.rejects(validateStageDirection(corrupt,source,text),/Invalid/)
  }
  await assert.rejects(validateStageDirection(value,source,{units:[{kind:'narration',text:'different'}]}),/unaligned/)
  await assert.rejects(validateStageDirection(value,{...source,turn:2},text),/Invalid/)
})

test('projection envelope shares exact preview token; refresh failure is failed, racing revision is stale',async t => {
  const prefix = deferred(), finish = deferred()
  const f = await fixture(async request => {
    await request.onToolCall({name:'stage_update',arguments:{...answer,through:1,done:false,beats:[answer.beats[0]]}})
    prefix.resolve(); await finish.promise
    await request.onToolCall({name:'stage_update',arguments:{sequence:2,through:2,done:true,beats:[answer.beats[1]]}})
  }); t.after(() => {finish.resolve(); return f.dispose()})
  await f.director.get(f.read()); await prefix.promise
  const direction = await read(f)
  const options = {expectedDirectionToken:direction.token,readDirection:() => read(f),readConsumer:() => f.assets.consumer(f.read(),'http://localhost'),
    readSettings:f.engineSettings.read,revision:() => f.assets.revision,at:2}
  const ready = await readStageProjection(options)
  assert.equal(ready.status,'ready',JSON.stringify(ready))
  assert.deepEqual(ready.directionToken,direction.token)
  assert.deepEqual(ready.value.state,foldAssetPackEntries(direction.preview,1))
  const failed = await readStageProjection({...options,readConsumer:() => {throw Error('Offline')}})
  assert.equal(failed.status,'failed'); assert.equal(failed.value,undefined)
  const unbound = await readStageProjection({...options,readConsumer:() => null})
  assert.equal(unbound.status,'revoked'); assert.deepEqual(unbound.scope,{authority:true})
  finish.resolve(); await f.director.drain()
  assert.equal((await readStageProjection(options)).status,'stale')
  const done = await read(f)
  let reads=0
  assert.equal((await readStageProjection({...options,expectedDirectionToken:done.token,revision:() => reads++})).status,'stale')
})

test('partial task failure preserves a validated prefix, never an authoritative predecessor',async t => {
  const f = await fixture(async request => {
    await request.onToolCall({name:'stage_update',arguments:{...answer,through:1,done:false,beats:[answer.beats[0]]}})
    throw Error('Model disconnected')
  }); t.after(() => f.dispose())
  const o = await observe(f,t)
  await f.director.get(f.read()); await f.director.drain(); await settle(o.store)
  const value = await read(f)
  assert.equal(value.phase,'error'); assert.equal(value.through,1); assert.equal(value.complete,false)
  assert.equal(o.store.getSnapshot().director.phase,'error')
  assert.equal(o.store.getSnapshot().director.entries.length,1)
  f.appendReply(2)
  assert.equal((await f.director.get(f.read(),2,null,{generate:false})).baseline,null)
  assert.equal(f.calls.length,1)
})

test('private fork: pack refresh keeps consumers; deletion revokes its scope and disabled refs degrade locally',async t => {
  const f = await fixture(request => request.onToolCall({name:'stage_update',arguments:{...answer,beats:[{...answer.beats[0],ops:[...answer.beats[0].ops,{op:'cast.add',actor:actorKey}]},answer.beats[1]]}})); t.after(() => f.dispose())
  await f.director.get(f.read()); await f.director.drain()
  const consumer = await f.assets.consumer(f.read(),'http://localhost'), events = []
  consumer.presentation.subscribe(event => events.push(event))
  consumer.presentation.available()
  events.length=0
  f.changePack({revision:'new'}); f.changeEngine()
  assert.equal(await f.assets.consumer(f.read(),'http://localhost'),consumer)
  assert.ok(events.length); assert.ok(events.every(event => event.kind === 'refresh'))
  f.changePack({revision:null})
  const deleted = events.find(event => event.kind === 'revoked')
  assert.ok(deleted.scope.packId); assert.equal(deleted.scope.authority,undefined)
  const library = f.services.get('assetLibrary'), original = library.resolveFigures
  library.resolveFigures = async ({refs}) => refs.map(ref => ({ref,value:{enabled:false},diagnostics:['figure-disabled']}))
  consumer.presentation.refresh()
  const value = await read(f)
  const projected = await readStageProjection({expectedDirectionToken:value.token,readDirection:() => read(f),readConsumer:async () => consumer,
    readSettings:f.engineSettings.read,revision:() => f.assets.revision})
  // private fork: d2c7dd88 (retained by 0b30bc45; docs/fork/skin-overlay-runtime.md)
  // degrades unavailable refs without revoking the whole stage or rewriting history.
  assert.equal(projected.status,'ready')
  assert.equal(projected.value.state.actors[actorKey].figure,null)
  assert.ok(projected.value.notice)
  const canonical = foldAssetPackEntries(value.record,1)
  assert.ok(canonical.actors[actorKey].figure)
  assert.deepEqual(projected.value.state.scene,canonical.scene,'unaffected background remains available')
  assert.deepEqual(projected.value.state.cast,canonical.cast,'directed cast survives missing media')
  assert.deepEqual((await read(f)).record,value.record,'projection cannot rewrite canonical history')
  library.resolveFigures = original
})

test('same-source settled asset revision reconciles even with no notification, without changing semantic token',async t => {
  const f = await fixture(request => request.onToolCall({name:'stage_update',arguments:answer})); t.after(() => f.dispose())
  await f.director.get(f.read()); await f.director.drain()
  const o = await observe(f,t), before = o.store.getSnapshot().director
  o.disconnect(); f.changePack({revision:'metadata-only'})
  o.clock.advance(5000); await settle(o.store)
  const after = o.store.getSnapshot().director
  assert.equal(after.phase,'done'); assert.ok(after.revision>before.revision)
  assert.deepEqual(after.token,before.token)
  assert.ok(after.assetRevision>before.assetRevision)
  assert.equal(o.subscribers,1); assert.equal(f.calls.length,1)
})

test('replaced source cancels an in-flight real read and rejects its late response',async t => {
  const f = await fixture(request => request.onToolCall({name:'stage_update',arguments:answer})); t.after(() => f.dispose())
  await f.director.get(f.read()); await f.director.drain()
  const value = await read(f), gate = deferred(), clock = createFakeClock()
  let first = true
  const runner = createStageDirectorSource({clock,watch:(source,wake) => f.signals.subscribe(source.sessionId,'stage-direction',wake),
    read:async args => {const result = await f.director.get(f.read(),args.turn,null,args); if(first) {first=false; await gate.promise} return result}})
  const store = createStageRuntimeStore({runEffect:(...args) => runner.runEffect('session',...args)})
  t.after(() => {gate.resolve();store.dispose();runner.dispose()})
  const source = runtimeSource({sessionId:'session'}), text = {...runtimeText(1,[runtimePage(1)]),units:value.displayUnits}
  store.dispatch({type:'TURN_CHANGED',source,text}); await new Promise(resolve => setImmediate(resolve))
  store.dispatch({type:'TURN_CHANGED',source:{...source,sourceKey:'replacement',generation:2},text})
  await settle(store); const snapshot = store.getSnapshot()
  gate.resolve(); await new Promise(resolve => setImmediate(resolve))
  assert.equal(store.getSnapshot(),snapshot)
})

test('explicit same-text generation accepts a shorter new prefix without clearing or replaying paragraph voice',async t => {
  const prefix = deferred(), finish = deferred(); let second = false
  const f = await fixture(async request => {
    if (!second) return request.onToolCall({name:'stage_update',arguments:answer})
    await request.onToolCall({name:'stage_update',arguments:{...answer,through:1,done:false,beats:[answer.beats[0]]}})
    prefix.resolve(); await finish.promise
    await request.onToolCall({name:'stage_update',arguments:{sequence:2,through:2,done:true,beats:[answer.beats[1]]}})
  }); t.after(() => {finish.resolve();return f.dispose()})
  await f.director.get(f.read()); await f.director.drain()
  const o = await observe(f,t), before = o.store.getSnapshot()
  second=true; await f.director.generate(f.read(),1); await prefix.promise; await settle(o.store)
  const partial = o.store.getSnapshot()
  assert.equal(partial.director.phase,'partial'); assert.equal(partial.director.generation,1)
  assert.equal(partial.director.through,1); assert.equal(partial.accepted,before.accepted)
  assert.equal(partial.source,before.source); assert.deepEqual(partial.cursor,before.cursor)
  const voice = Object.entries(before.ledger).find(([,entry]) => entry.descriptor.kind === 'voice')
  assert.ok(voice); assert.equal(partial.ledger[voice[0]],voice[1])
  finish.resolve(); await f.director.drain(); await settle(o.store)
  assert.equal(o.store.getSnapshot().director.phase,'done')
})

test('many wakes during a real read coalesce to one dirty reconciliation and one timer',async t => {
  const f = await fixture(() => {}); t.after(() => f.dispose())
  const gate = deferred(), entered = deferred(), clock = createFakeClock()
  let calls=0, inFlight=0, max=0
  const source = runtimeSource({sessionId:'session'}), envelope=await read(f)
  const runner=createStageDirectorSource({clock,watch:() => () => {},read:async args => {
    calls++;inFlight++;max=Math.max(max,inFlight)
    const value=await f.director.get(f.read(),args.turn,null,args)
    if(calls===1){entered.resolve();await gate.promise}
    inFlight--;return value
  }})
  const store=createStageRuntimeStore({runEffect:(...args)=>runner.runEffect('session',...args)})
  t.after(()=>{gate.resolve();store.dispose();runner.dispose()})
  store.dispatch({type:'TURN_CHANGED',source,text:{...runtimeText(1,[runtimePage(1)]),units:envelope.displayUnits}})
  await entered.promise
  for(let i=0;i<10;i++)store.dispatch({type:'DIRECTOR_WAKE',source})
  assert.equal(calls,1);gate.resolve();await settle(store)
  assert.equal(calls,2);assert.equal(max,1);assert.equal(clock.size,1);assert.equal(f.calls.length,0)
})
