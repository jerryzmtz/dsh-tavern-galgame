import {directorPromptData} from './fixtures/asset-packs/prompt.mjs'
// private fork: assert the model handle DTO, while saved state stays canonical.
import {modelCall,modelHandle} from './helpers/director-model-call.mjs'
// private fork: new director commands use the catalogue's deterministic FigureRef identity.
import {figureActorKey} from '../tavern-plugin/lib/domain/figure-catalogue.js'
import {PACK_ID as actorPackId,FIGURE_ID as actorFigureId} from './fixtures/asset-packs/pack.mjs'
const actorKey=figureActorKey({packId:actorPackId,figureId:actorFigureId})
// private fork: tool receipts use the CLI v1 envelope; saved record diagnostics are unchanged.
// private fork: actual host owner, pack transaction, timeline commit and source validation.
import test from 'node:test'
import assert from 'node:assert/strict'
import {fixture,answer,deferred} from './helpers/stage-director-harness.mjs'
import {stageParagraphs} from '../tavern-plugin/lib/domain/stage-paragraphs.js'
import {stagePageIndex} from '../tavern-plugin/src/client/fork-stage-page-index.cjs'
import {validateStageDirection} from '../tavern-plugin/src/client/fork-stage-director-source.cjs'
import {createForegroundStageStream} from '../tavern-plugin/lib/domain/foreground-stage-stream.js'
import {createStreamingPackDirector} from '../tavern-plugin/lib/domain/stage-streaming-pack.js'
import {performanceFixture,performanceRef} from './helpers/performance-director-fixture.mjs'
import {readStageProjection} from '../tavern-plugin/lib/domain/stage-projection.js'
const text = n => Array.from({length:n},(_,i) => 'Synthetic paragraph '+(i+1)+'.').join('\n\n')
const source = {sessionId:'session',turn:2}
function snapshot(body,streaming=true) {
  const units=stageParagraphs(body)
  return {streaming,units,pages:stagePageIndex(units).pages.map(page=>({anchor:{para:page.para,offset:page.offset}}))}
}
const submit = async (request,ops=[]) => {
  const tail=directorPromptData(request), first=tail.first, through=first+tail.reply.length-1
  return JSON.parse(await modelCall(request,{name:'stage_update',arguments:{sequence:1,through,done:true,beats:ops.length ? [{at:first,ops}] : []}}))
}
test('body stream runs real director before commit, validates a sealed prefix and commits one canonical record',async t=>{
  const f=await fixture(request=>submit(request,[answer.beats[0].ops[0]]));t.after(()=>f.dispose())
  const oldPrompt=await f.director.preview(f.read(),1)
  const op=f.beginReply(2), stream=await f.director.beginStream(f.read(),2)
  assert.ok(stream)
  stream.update(text(7));await f.director.drain()
  assert.equal(f.calls.length,1)
  assert.equal(f.read().messages.some(message=>message.turn===2),false)
  const prefix=await f.director.get(f.read(),2,null,{readOnly:true})
  assert.equal(prefix.through,6);assert.equal(prefix.streaming,true)
  assert.equal((await validateStageDirection(prefix,source,snapshot(text(7)))).phase,'partial')
  const projection=await readStageProjection({expectedDirectionToken:prefix.token,at:3,
    readDirection:()=>f.director.get(f.read(),2,null,{readOnly:true}),readConsumer:()=>f.assets.consumer(f.read(),'http://localhost'),readSettings:()=>f.engineSettings.read(),revision:()=>f.assets.revision,
    readPlayback:()=>{throw new Error('streaming must not persist playback before body commit')}})
  assert.equal(projection.status,'ready',JSON.stringify(projection.error))
  const revision=f.read().timeline.revision
  f.commitReply(op,2,text(7));await f.director.get(f.read(),2);await f.director.drain()
  const done=await f.director.get(f.read(),2,null,{readOnly:true})
  assert.equal(done.phase,'done',JSON.stringify(done))
  assert.equal(done.record.end.pacing.paragraph,7)
  assert.equal(f.calls.length,2)
  assert.equal(f.read().timeline.revision,revision+1,'only body advances story revision')
  assert.equal((await validateStageDirection(done,source,snapshot(text(7),false))).complete,true)
  assert.deepEqual(done.entries.slice(0,prefix.entries.length),prefix.entries,'sealed indices survive final commit')
  assert.equal(f.calls[0].system,f.calls[1].system)
  // private fork: compare serialized provider bytes, including the full-reply tool shape.
  assert.equal(JSON.stringify(f.calls[0].tools),JSON.stringify(f.calls[1].tools))
  assert.equal(JSON.stringify(f.calls[0].tools),JSON.stringify(oldPrompt.tools))
  t.diagnostic(JSON.stringify({calls:f.calls.length,systemBytes:[Buffer.byteLength(oldPrompt.system),Buffer.byteLength(f.calls[0].system)],toolSchemaBytes:[Buffer.byteLength(JSON.stringify(oldPrompt.tools)),Buffer.byteLength(JSON.stringify(f.calls[0].tools))],tailBytes:f.calls.map(request=>Buffer.byteLength(JSON.stringify(request.messages)))}))
})
test('final rewrite invalidates only affected input; cancelled and failed streams never call the post-commit fallback',async t=>{
  for(const kind of ['rewrite','cancel','failure']) {
    const f=await fixture(request=>kind==='failure' ? Promise.reject(new Error('fake outage')) : submit(request));t.after(()=>f.dispose())
    const op=f.beginReply(2), stream=await f.director.beginStream(f.read(),2)
    stream.update(text(13));await f.director.drain()
    if(kind==='cancel') stream.cancel()
    const final=kind==='rewrite' ? text(13).replace('paragraph 1.','changed first.') : text(13)
    f.commitReply(op,2,final);await f.director.get(f.read(),2);await f.director.drain()
    const value=await f.director.get(f.read(),2,null,{readOnly:true})
    assert.equal(value.phase,kind==='rewrite' ? 'done':'error',JSON.stringify(value))
    assert.ok(f.calls.length<=4)
    if(kind!=='rewrite') assert.equal(f.calls.length,1)
    assert.equal(f.read().messages.at(-1).text,final)
  }
})
test('late window cannot commit after branch changes, even when the fake provider ignores cancellation',async t=>{
  const gate=deferred(), started=deferred()
  const f=await fixture(async request=>{started.resolve();await gate.promise;await submit(request)});t.after(()=>f.dispose())
  f.beginReply(2);const stream=await f.director.beginStream(f.read(),2)
  stream.update(text(7));await started.promise
  f.branch();gate.resolve();await f.director.drain()
  assert.equal((await f.director.get(f.read(),2,null,{readOnly:true})).phase,'unknown')
  assert.ok(f.read().messages.every(message=>!message.stageDirectionAssetPacks))
})

test('private fork: safety caps cross windows, ordinary titles/clocks are uncapped; expiry waits for commit',async t=>{
  const receipts=[]
  const f=await fixture(async request=>{
    const tail=directorPromptData(request)
    const ops=tail.first===1 ? [{op:'cast.add',actor:actorKey},{op:'closeup.play',actor:actorKey},{op:'title.play',text:'First'}]
      : tail.first===7 ? [{op:'title.play',text:'Second'}] : [{op:'title.play',text:'Over cap'}]
    receipts.push(await submit(request,[...ops,...Array.from({length:tail.first===1 ? 6:1},()=>({op:'screen.play',effect:'flash'})),...Array.from({length:tail.first===1 ? 8:1},()=>({op:'clock.advance',seconds:0}))]))
  },{timedWidgets:true});t.after(()=>f.dispose())
  const op=f.beginReply(2),stream=await f.director.beginStream(f.read(),2)
  stream.update(text(7));await f.director.drain()
  let value=await f.director.get(f.read(),2,null,{readOnly:true})
  assert.equal(value.entries[0].state.camera.mode,'close','window completion is not turn-end')
  stream.update(text(13));await f.director.drain()
  stream.update(text(19));await f.director.drain()
  f.commitReply(op,2,text(19));await f.director.get(f.read(),2);await f.director.drain()
  value=await f.director.get(f.read(),2,null,{readOnly:true})
  assert.equal(value.phase,'done')
  assert.equal(value.record.end.camera.mode,'reset')
  assert.equal(value.entries.flatMap(entry=>entry.ops).filter(op=>op.op==='title.play').length,4)
  assert.equal(value.entries.flatMap(entry=>entry.ops).filter(op=>op.op==='screen.play').length,6)
  assert.ok(receipts.some(receipt=>receipt.errors?.some(drop=>drop.code==='CONFLICT')))
  assert.ok(value.record.diagnostics.some(item=>item.code==='CAP_EXCEEDED'))
  assert.ok(receipts[1].errors.some(drop=>drop.command==='screen.play' && drop.code==='CONFLICT'),'flashes spend the carried safety cap')
  assert.ok(receipts.every(receipt=>!receipt.errors.some(drop=>drop.command==='clock.advance')),'no-op clocks do not spend a quota')
})

test('streaming prefix validation rejects tampered content, operation identity, and foreign source text',async t=>{
  const f=await fixture(request=>submit(request));t.after(()=>f.dispose())
  f.beginReply(2);const stream=await f.director.beginStream(f.read(),2)
  stream.update(text(7));await f.director.drain()
  const value=await f.director.get(f.read(),2,null,{readOnly:true})
  for(const mutate of [copy=>{copy.binding.stream.epoch++},copy=>{copy.displayUnits[0].text='foreign'},copy=>{copy.preview.entries.push({at:7,ops:[],state:{}})}]) {
    const copy=structuredClone(value);mutate(copy)
    await assert.rejects(()=>validateStageDirection(copy,source,snapshot(text(7))))
  }
  await assert.rejects(()=>validateStageDirection(value,source,snapshot(text(7).replace('paragraph 1.','foreign text.'))))
})

test('intermediate tool nodes retire their epoch without cancelling the body or resetting its call budget',async t=>{
  const gate=deferred(),started=deferred(), f=await fixture(async request=>{if(f.calls.length===1){started.resolve();await gate.promise}return submit(request)})
  t.after(()=>{gate.resolve();return f.dispose()})
  const op=f.beginReply(2), create=()=>createForegroundStageStream({begin:()=>f.director.beginStream(f.read(),2)})
  const note=create();await note.ready;note.append(text(7).replaceAll('Synthetic','Tool explanation'));await started.promise
  assert.equal(f.calls.length,1)
  note.discard();note.finish(true)
  const story=create();await story.ready;story.append(text(7))
  assert.equal(f.calls.length,1,'abort-ignoring intermediate request remains single-flight')
  gate.resolve();await f.director.drain()
  assert.equal(f.calls.length,2)
  assert.equal((await f.director.get(f.read(),2,{}, {readOnly:true})).generation,1)
  story.finish(true);f.commitReply(op,2,text(7));await f.director.get(f.read(),2);await f.director.drain()
  const done=await f.director.get(f.read(),2,{}, {readOnly:true})
  assert.equal(done.complete,true,done.error)
  assert.equal(f.calls.length,3,'all native nodes share the same operation budget')
})

test('a changed display projection cannot rebind an already directed final window',async t=>{
  const gate=deferred(), started=deferred()
  let projected=text(7)
  const f=await fixture(async request=>{
    if(f.calls.length===2) {started.resolve();await gate.promise}
    return submit(request)
  },{paragraphParts:async()=>[{kind:'markdown',text:projected}]})
  t.after(()=>{gate.resolve();return f.dispose()})
  const op=f.beginReply(2), stream=await f.director.beginStream(f.read(),2)
  stream.update(projected);await f.director.drain()
  f.commitReply(op,2,projected);await f.director.get(f.read(),2);await started.promise
  projected=projected.replace('paragraph 7.','different final display.')
  gate.resolve();await f.director.drain()
  assert.equal(f.read().messages.at(-1).stageDirectionAssetPacks,undefined,'validated old text cannot acquire the new display digest')
  assert.equal((await f.director.get(f.read(),2,null,{readOnly:true})).phase,'error')
  assert.equal(f.calls.length,2,'stale projection must not trigger a paid fallback')
})

test('explicit retry fences a retiring streaming task failure before resetting its generation',async t=>{
  const gate=deferred(), started=deferred()
  const f=await fixture(async request=>{started.resolve();await gate.promise;return submit(request)})
  t.after(()=>{gate.resolve();return f.dispose()})
  const op=f.beginReply(2), stream=await f.director.beginStream(f.read(),2)
  stream.update(text(7));await started.promise
  f.commitReply(op,2,text(7));await f.director.get(f.read(),2)
  const retry=f.director.retry(f.read(),2,{regenerate:true})
  gate.resolve()
  const reset=await retry
  await f.director.drain()
  const message=f.read().messages.at(-1)
  assert.equal(message.stageDirectionGeneration,reset.generation,'late failure must not restore the retired epoch')
  assert.equal(message.stageDirectionAssetPacksFailure,undefined)
  assert.equal((await f.director.get(f.read(),2,null,{readOnly:true})).phase,'unknown')
})

test('performance event ordinals and source namespace survive streaming-to-canonical binding',async()=>{
  const f=await performanceFixture(), units=stageParagraphs(text(14))
  const pack=createStreamingPackDirector({input:f.prepareInput(),identity:{bodyOperationId:'performance-body'},current:()=>true,
    runAgent:async request=>{
      const {first}=directorPromptData(request)
      const result=await submit(request,first===1 ? [{op:'mod.dsh.performance.set',ref:performanceRef()}] : first===8 ? [{op:'mod.dsh.performance.off'}] : [])
      assert.equal(result.ok,true,JSON.stringify(result))
    }})
  pack.kernel.update(units.slice(0,8));await pack.kernel.drain()
  const first=pack.kernel.snapshot(), stream={operationId:'performance-body',epoch:0}
  assert.equal(first.failure,null)
  const preview={baseline:pack.baseline,entries:first.entries,binding:{...pack.binding,stream}}
  const before=f.fold(preview,f.prepare(),0)
  assert.ok(before)
  pack.kernel.update(units);await pack.kernel.drain()
  assert.equal(pack.kernel.snapshot().state.performance.phase,'exit')
  pack.kernel.commit(units);await pack.kernel.drain()
  const final=pack.complete({...f.prepare().binding,target:{...f.input.target,sourceKey:'final-digest'},stream:{...stream,committed:true}},14)
  const after=f.fold(final,f.prepare(),0)
  assert.deepEqual(after.instanceKey,before.instanceKey)
  assert.deepEqual(after.phaseKey,before.phaseKey)
  assert.deepEqual(final.entries.slice(0,first.entries.length),first.entries)
})

// private fork: replicate the 78-paragraph / ten-window Madoka turn without a model.
test('long streaming turns do not cap emotes or add allowance prompt bytes',async t=>{
  const receipts=[]
  const f=await fixture(async request=>{
    const tail=directorPromptData(request)
    assert.equal(tail.remaining,undefined)
    receipts.push(await submit(request,[...(tail.first===1 ? [{op:'cast.add',actor:actorKey}] : []),
      ...Array.from({length:3},()=>({op:'actor.emote.play',actor:actorKey,symbol:'note'}))]))
  });t.after(()=>f.dispose())
  const op=f.beginReply(2),stream=await f.director.beginStream(f.read(),2)
  for(const end of [6,13,21,29,35,45,53,60,74]) {stream.update(text(end+1));await f.director.drain()}
  f.commitReply(op,2,text(78));await f.director.get(f.read(),2);await f.director.drain()
  const value=await f.director.get(f.read(),2,null,{readOnly:true})
  assert.equal(value.phase,'done')
  assert.equal(f.calls.length,10)
  assert.equal(value.entries.flatMap(entry=>entry.ops).filter(op=>op.op==='actor.emote.play').length,30)
  assert.ok(receipts.every(receipt=>!receipt.errors?.length),JSON.stringify(receipts))
  assert.ok(f.calls.every(call=>call.system===f.calls[0].system))
  assert.ok(f.calls.every(call=>JSON.stringify(call.tools)===JSON.stringify(f.calls[0].tools)))
  t.diagnostic(JSON.stringify({systemBytes:Buffer.byteLength(f.calls[0].system),toolSchemaBytes:Buffer.byteLength(JSON.stringify(f.calls[0].tools)),tailAllowanceBytes:0}))
})
