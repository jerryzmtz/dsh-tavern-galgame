import test from 'node:test'
import assert from 'node:assert/strict'
import {createDanmakuController} from '../fork/mods/danmaku/controller.js'
import {appendPresentation,emptyPresentation,readPresentation} from '../fork/mods/danmaku/presentation.js'
import {sourceOf,sourceKey} from '../fork/mods/danmaku/contract.js'
import {validateAudienceContent} from '../fork/mods/danmaku/audience.js'

const group={ref:{packId:'14727416-04af-4dbe-b98e-0c93e643d337',kind:'audience',assetId:'canon-fans'},name:'考据观众',
  content:{persona:'Remember details',tone:'Friendly teasing',catchphrases:['Again!'],examples:['Nice choice']}}
const other={...structuredClone(group),ref:{...group.ref,assetId:'canon-shippers'},name:'CP粉'}
function fixture(initialState=emptyPresentation()) {
  let at=0,serial=0,context={modId:'dsh.danmaku',sessionId:'session',branchId:'branch',revision:'1',sourceKey:'reply-1',
    generation:1,textVersion:'v1',authorityEpoch:1,settledTurn:1,mode:'live'}
  let state=initialState,currentAnchor={sourceKey:'reply-1',part:'body',paragraph:1,charOffset:0},active=true
  let controller=createDanmakuController({now:()=>at,id:()=>`call-${++serial}`})
  const calls=[],cancelled=[],windows=[]
  const host={async request({requestId,method,args}) {
    try {
      let value
      if(method==='host.presentation.read')value=readPresentation(state,{anchor:args.anchor,sources:[sourceOf(context)]})
      else if(method==='host.presentation.append') {
        const next=appendPresentation(state,args,{source:sourceOf(context),turn:context.settledTurn,active,mode:context.mode,anchorAllowed:()=>true})
        state=next.state;value=next.receipt
      } else if(method==='host.models.request') {
        assert.equal(active,true);assert.equal(context.mode,'live')
        calls.push({at,args:structuredClone(args),context:structuredClone(context)})
        windows.push({completed:context.settledTurn})
        value={operationId:'model-'+calls.length,status:'queued'}
      } else if(method==='host.models.cancel'){cancelled.push(args.operationId);value={cancelled:true}}
      else throw new Error('Unexpected host method '+method)
      return {channel:'dsh-mod',version:2,requestId,result:{ok:true,value}}
    } catch(error){return {requestId,result:{ok:false,error:{code:error.code,message:error.message}}}}
  }}
  async function send(event,payload={}) {
    if(typeof payload.active==='boolean')active=payload.active
    if(payload.anchor)currentAnchor=payload.anchor
    return controller.handle({channel:'dsh-mod',version:2,type:'event',eventId:'event-'+ ++serial,seq:serial,event,
      context:structuredClone(context),payload:{anchor:currentAnchor,activeTimeMs:at,...payload}},host)
  }
  const snapshot={groups:[group,other],settings:{view:'overlay'},model:{selection:'follow-foreground',provider:'fake',model:'fake-foreground',label:'Fake',available:true}}
  return {send,calls,cancelled,windows,snapshot,get state(){return state},get context(){return context},
    time(value){at=value},contextTo(value){context={...context,...value}},reset(){controller=createDanmakuController({now:()=>at,id:()=>`call-${++serial}`})},
    async start(groups=snapshot.groups){return send('stage.entered',{active:true,danmaku:{...snapshot,groups}})},
    complete(output={comments:[{group:group.ref,author:'viewer-a',text:'主播又选冒险了',kind:'comment',mode:'top',color:'#ffffff',size:'large'}]},operationId='model-'+calls.length){return send('model.completed',{operationId,status:'completed',output})}}
}

test('no recalled group is completely silent; mixed groups share one batch and both views',async()=>{
  const f=fixture();let result=await f.start([])
  await f.send('page.changed');await f.send('generation.ended',{status:'completed'})
  assert.equal(f.calls.length,0);assert.equal(result.view.silent,true);assert.equal(result.view.online,0)
  await f.start();await f.send('page.changed')
  assert.equal(f.calls.length,1);assert.equal(f.calls[0].args.input.groups.length,2)
  result=await f.complete({comments:[{group:group.ref,author:'a',text:'One',kind:'highlight',mode:'top'},
    {group:other.ref,author:'b',text:'Two',kind:'comment',mode:'bottom',color:'#aabbcc',size:'small'}]})
  const original=structuredClone(result.view.batches.at(-1).comments)
  f.time(1300)
  result=await f.send('mod.context.changed',{reason:'settings',danmaku:{...f.snapshot,settings:{view:'sidebar'}}})
  assert.equal(result.view.view,'sidebar');assert.equal(result.view.sidebar.items.length,2)
  assert.deepEqual(result.view.batches.at(-1).comments,original);assert.equal(f.calls.length,1)
})

test('one in flight, 3s starts, <=20/min including one completed-round memory; 30s cooling',async()=>{
  const f=fixture();await f.start();await f.send('page.changed')
  await f.send('performance.presented');await f.send('player.input',{text:'Accepted choice'})
  assert.equal(f.calls.length,1)
  await f.complete();await f.send('round.committed');await f.send('generation.ended',{status:'completed'})
  f.time(2999);await f.send('mod.context.changed',{reason:'cadence'});assert.equal(f.calls.length,1)
  f.time(3000);await f.send('mod.context.changed',{reason:'cadence'})
  assert.equal(f.calls[1].args.purpose,'memory');await f.complete({memory:'Old jokes'})
  await f.send('round.committed');await f.send('generation.ended',{status:'completed'})
  for(let i=2;i<22;i++) {
    f.time(i*3000);await f.send('performance.presented')
    await f.complete({comments:[{group:group.ref,author:'a',text:'reaction-'+i,kind:'comment'}]})
  }
  assert.equal(f.calls.filter(row=>row.args.purpose==='memory').length,1)
  for(let i=1;i<f.calls.length;i++)assert.ok(f.calls[i].at-f.calls[i-1].at>=3000)
  for(const call of f.calls)assert.ok(f.calls.filter(row=>row.at>call.at-60000 && row.at<=call.at).length<=20)
  f.time(100000);const result=await f.send('mod.context.changed',{reason:'cadence'})
  assert.equal(result.view.heat,0);assert.equal(result.wakeAfterMs,null)
})

test('background cancels, ignores late output, merges memory and never catches up comments',async()=>{
  const f=fixture();await f.start();await f.send('page.changed')
  await f.send('activity.changed',{active:false});assert.deepEqual(f.cancelled,['model-1'])
  await f.complete();const before=f.state.rows.length
  for(let i=0;i<4;i++) {
    f.time(10000+i*1000);f.contextTo({sourceKey:'reply-'+(i+2),textVersion:'v'+(i+2),settledTurn:i+2})
    await f.send('generation.ended',{status:'completed',anchor:{sourceKey:'reply-'+(i+2),part:'body',paragraph:1,charOffset:0}})
    await f.send('page.changed')
  }
  assert.equal(f.calls.length,1);assert.equal(f.state.rows.length,before)
  let result=await f.send('activity.changed',{active:true})
  assert.equal(f.calls.length,2);assert.equal(f.calls[1].args.purpose,'memory');assert.equal(result.view.heat,0)
  assert.equal(f.calls[1].context.settledTurn,5)
  await f.complete({memory:'x'.repeat(400)})
  assert.equal(f.state.rows.at(-1).record.memory.length,300)
  result=await f.send('mod.context.changed',{reason:'cadence'})
  assert.equal(f.calls.length,2);assert.equal(result.wakeAfterMs,null)
})

test('history and refresh replay original comments with no model calls; rollback has no future memory',async()=>{
  const f=fixture();await f.start();await f.send('page.changed');let result=await f.complete()
  const original=result.view.batches.at(-1).comments
  f.reset();result=await f.start();assert.equal(f.calls.length,1)
  assert.deepEqual(result.view.batches.at(-1).comments,original)
  f.contextTo({mode:'history'});f.time(5000)
  result=await f.send('activity.changed',{active:false})
  assert.deepEqual(result.view.batches.at(-1).comments,original);assert.equal(result.view.heat,67)
  await f.send('generation.ended',{status:'completed'});assert.equal(f.calls.length,1)
  f.contextTo({mode:'live',generation:2,textVersion:'v2',sourceKey:'reply-replaced'})
  result=await f.send('timeline.changed',{active:true,anchor:{sourceKey:'reply-replaced',part:'body',paragraph:1,charOffset:0}})
  assert.equal(result.view.batches.length,0);assert.equal(f.calls.length,1)
  await f.send('page.changed');assert.equal(f.calls.at(-1).args.input.memory,'')
})

test('waiting input is accepted text only; no failure retry; group removal stops and hides old batches',async()=>{
  const f=fixture();await f.start();await f.send('player.input',{inputId:'accepted',text:'Choose left'})
  await f.send('generation.started');await f.complete()
  f.time(3000);await f.send('mod.context.changed',{reason:'cadence'})
  assert.equal(f.calls[1].args.input.waiting,true)
  assert.deepEqual(f.calls[1].args.input.acceptedInput,{inputId:'accepted',text:'Choose left'})
  assert.equal(f.windows[1].completed,1)
  await f.send('model.completed',{operationId:'model-2',status:'failed',error:{code:'MODEL_UNAVAILABLE',message:'Choose a model'}})
  f.time(6000);let result=await f.send('mod.context.changed',{reason:'cadence'})
  assert.equal(f.calls.length,2);assert.equal(result.view.status,'error');assert.equal(result.wakeAfterMs,null)
  result=await f.send('mod.context.changed',{reason:'admission',danmaku:{...f.snapshot,groups:[]}})
  assert.equal(result.view.silent,true);assert.equal(result.view.batches.length,0);assert.equal(f.calls.length,2)
})

test('audience content and model output are checked only at incoming boundaries',async()=>{
  assert.deepEqual(validateAudienceContent(group.content),group.content)
  assert.throws(()=>validateAudienceContent({...group.content,enabled:true}))
  const f=fixture();await f.start();await f.send('page.changed')
  const result=await f.complete({comments:[{group:{...group.ref,assetId:'unknown'},author:'a',text:'wrong group',kind:'comment'}]})
  assert.equal(result.view.status,'error')
  assert.equal(f.state.rows.filter(row=>row.record.type==='batch').flatMap(row=>row.record.batch.comments).length,0)
  const rich=fixture(),groups=[group,other].map(row=>({...row,content:{persona:'人'.repeat(1200),tone:'风'.repeat(600),
    catchphrases:Array(12).fill('口'.repeat(120)),examples:Array(12).fill('例'.repeat(240))}}))
  groups.forEach(row=>validateAudienceContent(row.content))
  await rich.start(groups);await rich.send('page.changed')
  assert.ok(Buffer.byteLength(JSON.stringify(rich.calls[0].args.input))<=16000)
  assert.deepEqual(rich.calls[0].args.input.groups.map(row=>row.ref),groups.map(row=>row.ref))
})

test('the global off view cancels generation, hides both layers and does not catch up on reopen',async()=>{
  const f=fixture();await f.start();await f.send('page.changed');await f.complete()
  f.time(3000);await f.send('mod.context.changed',{reason:'cadence'})
  assert.equal(f.calls.length,2)
  let result=await f.send('mod.context.changed',{reason:'settings',danmaku:{...f.snapshot,settings:{view:'off'}}})
  assert.equal(result.view.view,'off');assert.equal(result.view.settings.view,'off')
  assert.equal(result.view.active,false);assert.equal(result.view.heat,0);assert.equal(result.view.online,0)
  assert.deepEqual(result.view.batches,[]);assert.deepEqual(result.view.sidebar.items,[])
  assert.equal(result.wakeAfterMs,null);assert.deepEqual(f.cancelled,['model-2'])
  f.time(90000);await f.complete();await f.send('page.changed')
  result=await f.send('mod.context.changed',{reason:'cadence'})
  assert.equal(f.calls.length,2);assert.equal(result.wakeAfterMs,null)
  result=await f.send('mod.context.changed',{reason:'settings',danmaku:{...f.snapshot,settings:{view:'sidebar'}}})
  assert.equal(result.view.view,'sidebar');assert.equal(result.view.sidebar.limit,32);assert.equal(f.calls.length,2)
})

test('presentation CAS/idempotency/source lineage are independent from story/MVU',()=>{
  const f=fixture(),source=sourceOf(f.context),anchor={sourceKey:source.sourceKey,part:'body',paragraph:1,charOffset:0}
  const args={operationId:'memory-once',anchor,offsetMs:0,expectedRevision:'0',records:[{type:'memory',source,turn:1,memory:'Known past'}]}
  const lease={source,turn:1,active:true,mode:'live',anchorAllowed:()=>true}
  const first=appendPresentation(emptyPresentation(),args,lease)
  const replay=appendPresentation(first.state,args,lease)
  assert.equal(replay.changed,false);assert.deepEqual(first.receipt,replay.receipt)
  assert.throws(()=>appendPresentation(first.state,{...args,operationId:'conflict'},lease),{code:'MOD_REVISION_CONFLICT'})
  assert.throws(()=>appendPresentation(first.state,{...args,records:[{...args.records[0],memory:'Changed'}]},lease),{code:'MOD_REVISION_CONFLICT'})
  assert.throws(()=>appendPresentation(first.state,args,{...lease,active:false}),{code:'MOD_SOURCE_STALE'})
  assert.equal(readPresentation(first.state,{anchor,sources:[{...source,generation:2}]}).records.length,0)
  assert.equal(readPresentation(first.state,{anchor,sources:[source]}).records[0].record.memory,'Known past')
  assert.notEqual(sourceKey(source),sourceKey({...source,generation:2}))
})
