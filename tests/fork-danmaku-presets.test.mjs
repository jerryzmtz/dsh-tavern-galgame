import test from 'node:test'
import assert from 'node:assert/strict'
import {createDanmakuController} from '../fork/mods/danmaku/controller.js'
import {validateAudienceContent} from '../fork/mods/danmaku/audience.js'
import {createAudiencePresets,presetExamples,paceComments} from '../fork/mods/danmaku/presets.js'
import {compactAudienceInput} from '../fork/mods/danmaku/input.js'
import {sourceOf} from '../fork/mods/danmaku/contract.js'
import {appendPresentation,emptyPresentation,readPresentation} from '../fork/mods/danmaku/presentation.js'

const group={ref:{packId:'14727416-04af-4dbe-b98e-0c93e643d337',kind:'audience',assetId:'canonical-railgun-fans'},name:'电击使观众',
  content:{persona:'记得名台词的观众',tone:'友好',catchphrases:[],examples:[],
    triggers:[{id:'electric-line',keywords:['御坂美琴'],lines:['你指尖跳跃的电光……'],cooldown:30}],
    chains:[{id:'dinner',match:'吃什么',replies:['是呀，吃什么'],probability:1},
      {id:'dinner-again',match:'是呀',replies:['到底吃什么'],probability:1},
      {id:'never-third',match:'到底',replies:['越界回复'],probability:1}]}}

function fixture({available=true,groups=[group],modelError=false}={}) {
  let clock=0,serial=0,active=true,state=emptyPresentation(),context={modId:'dsh.danmaku',sessionId:'session',branchId:'branch',
    revision:'1',sourceKey:'completed-source',generation:1,textVersion:'version',authorityEpoch:1,settledTurn:1,mode:'live'}
  const anchor={sourceKey:context.sourceKey,part:'body',paragraph:1,charOffset:0},calls=[]
  const make=()=>createDanmakuController({now:()=>clock,id:()=>`id-${++serial}`,random:()=>0})
  let controller=make()
  const host={async request({requestId,method,args}) {
    let value
    if(method==='host.presentation.read')value=readPresentation(state,{anchor,sources:[sourceOf(context)]})
    else if(method==='host.presentation.append') {
      const next=appendPresentation(state,args,{source:sourceOf(context),turn:1,active,mode:context.mode,anchorAllowed:()=>true})
      state=next.state;value=next.receipt
    } else if(method==='host.models.request') {
      calls.push(args)
      if(modelError)return {requestId,result:{ok:false,error:{code:'MOD_RESOURCE_UNAVAILABLE',message:'Model rate limit reached'}}}
      value={operationId:'model-'+calls.length,status:'queued'}
    }
    else if(method==='host.models.cancel')value={cancelled:true}
    else assert.fail(method)
    return {requestId,result:{ok:true,value}}
  }}
  async function send(event,payload={}) {
    if(payload.active!==undefined)active=payload.active
    return controller.handle({eventId:'event-'+ ++serial,event,context:{...context},payload:{active,anchor,activeTimeMs:clock,...payload}},host)
  }
  const start=()=>send('stage.entered',{danmaku:{groups,settings:{},model:{available,selection:'follow-foreground',provider:'fake',model:'fake',label:'fake'}}})
  return {send,start,calls,time:at=>{clock=at},reset:()=>{controller=make()},history:()=>{context={...context,mode:'history'}},
    get state(){return state},comments:()=>state.rows.filter(row=>row.record.type==='batch').flatMap(row=>row.record.batch.comments)}
}

test('Chinese revealed-only presets work without a model; no lit group is silent; history/refresh preserve comments',async()=>{
  validateAudienceContent(group.content)
  const scGroup=structuredClone(group)
  scGroup.content.triggers[0].lines=[{text:group.content.triggers[0].lines[0],kind:'highlight',amount:1000}]
  const f=fixture({available:false,groups:[scGroup]});await f.start()
  await f.send('text.revealed',{text:'御坂美琴',snapshot:{units:[{text:'御坂美琴'}]}})
  assert.equal(f.comments().length,0)
  await f.send('text.revealed',{revealed:{id:'position-1',text:'御坂美琴走过街角。'}})
  assert.equal(f.calls.length,0);assert.equal(f.comments().length,1)
  const original=structuredClone(f.comments())
  assert.equal(original[0].amount,1000);assert.equal(original[0].source,'preset');assert.deepEqual(original[0].group,group.ref)
  assert.equal(original[0].text,'你指尖跳跃的电光……')
  f.time(1000);f.reset();await f.start()
  await f.send('text.revealed',{revealed:{id:'position-2',text:'御坂美琴'}})
  assert.deepEqual(f.comments(),original) // Persisted cooldown survives remount.
  f.time(31000);await f.send('text.revealed',{revealed:{id:'position-1',text:'御坂美琴'}})
  assert.deepEqual(f.comments(),original)
  f.history();await f.send('activity.changed',{active:false})
  await f.send('text.revealed',{revealed:{id:'future-position',text:'御坂美琴'}})
  assert.deepEqual(f.comments(),original);assert.equal(f.calls.length,0)
  const empty=fixture({groups:[]});await empty.start();await empty.send('text.revealed',{revealed:{id:'a',text:'御坂美琴'}})
  assert.equal(empty.comments().length,0);assert.equal(empty.calls.length,0)
})

test('busy model and presets interleave, dedupe, and posted model comments produce bounded reply chains',async()=>{
  const f=fixture();await f.start();await f.send('page.changed')
  assert.equal(f.calls.length,1)
  await f.send('text.revealed',{revealed:{id:'position',text:'御坂美琴'}})
  assert.equal(f.comments()[0].source,'preset');assert.equal(f.calls.length,1)
  await f.send('model.completed',{operationId:'model-1',status:'completed',output:{comments:[
    {group:group.ref,author:'小观众',text:'吃什么？',kind:'comment'},
    {group:group.ref,author:'路人',text:'你指尖跳跃的电光……',kind:'comment'}]}})
  const model=f.comments().find(row=>row.source==='model')
  assert.equal(model.offsetMs,600);assert.equal(f.comments().length,2)
  f.time(600);await f.send('mod.context.changed',{reason:'cadence'})
  assert.equal(f.comments().length,2) // Replies wait until the parent is posted, then another 600ms.
  f.time(1200);await f.send('mod.context.changed',{reason:'cadence'})
  const first=f.comments().find(row=>row.depth===1)
  assert.equal(first.source,'chain');assert.equal(first.replyTo,model.id);assert.equal(first.text,'是呀，吃什么')
  f.time(1800);await f.send('mod.context.changed',{reason:'cadence'})
  assert.equal(f.comments().find(row=>row.depth===2).text,'到底吃什么')
  f.time(2400);await f.send('mod.context.changed',{reason:'cadence'})
  assert.equal(f.comments().find(row=>row.depth===3).text,'越界回复');assert.equal(f.calls.length,1)
  const offsets=f.comments().map(row=>row.offsetMs).sort((a,b)=>a-b)
  for(let i=1;i<offsets.length;i++)assert.ok(offsets[i]-offsets[i-1]>=600)
  assert.equal(f.calls[0].input.groups[0].triggers,undefined)
  assert.deepEqual(f.calls[0].input.groups[0].presetExamples,presetExamples(group.content))
})

test('preset parents trigger chains; pause discards pending replies without a model call',async()=>{
  const custom=structuredClone(group)
  custom.content.triggers[0].lines=['吃什么？']
  const f=fixture({available:false,groups:[custom]});await f.start()
  const result=await f.send('text.revealed',{revealed:{id:'a',text:'御坂美琴'}})
  assert.equal(result.wakeAfterMs,600)
  await f.send('activity.changed',{active:false});f.time(1000)
  await f.send('activity.changed',{active:true});await f.send('mod.context.changed',{reason:'cadence'})
  assert.equal(f.comments().length,1);assert.equal(f.calls.length,0)
  const limited=fixture({modelError:true});await limited.start();await limited.send('page.changed')
  await limited.send('text.revealed',{revealed:{id:'rate-limited',text:'御坂美琴'}})
  assert.equal(limited.comments().length,1);assert.equal(limited.comments()[0].source,'preset')
  assert.equal(limited.calls.length,1) // Presets neither retry nor consume another model request.
})

test('existing green-light lexical semantics, probability/cooldown, queue/rate caps and stable identities',()=>{
  let clock=0,serial=0
  const engine=createAudiencePresets({now:()=>clock,random:()=>0,id:()=>String(++serial)})
  const custom=structuredClone(group)
  custom.name='御坂美琴';custom.content.triggers=[{id:'canonical-rule',keywords:['电光','flash'],lines:['命中'],cooldown:30}]
  engine.trigger({id:'1',text:'御坂美琴 flashback'},[custom],clock,[])
  assert.deepEqual(engine.take([custom],clock,[]),[]) // Neither display-name identity guessing nor Latin substring matches.
  engine.trigger({id:'2',text:'電光 ＦＬＡＳＨ'},[custom],clock,[])
  assert.equal(engine.take([custom],clock,[]).length,1)
  clock=1000;engine.trigger({id:'3',text:'电光'},[custom],clock,[]);assert.equal(engine.take([custom],clock,[]).length,0)
  clock=30000;engine.trigger({id:'4',text:'电光'},[custom],clock,[]);assert.equal(engine.take([custom],clock,[]).length,1)
  custom.content.triggers[0].probability=0
  clock=60000;engine.trigger({id:'5',text:'电光'},[custom],clock,[]);assert.equal(engine.take([custom],clock,[]).length,0)
  const limited=createAudiencePresets({now:()=>clock,random:()=>0,id:()=>String(++serial)})
  let count=0
  for(let i=0;i<20;i++) {
    custom.content.triggers=[{id:'rule',keywords:['电光'],lines:['不同留言'+i],cooldown:0}]
    limited.trigger({id:String(i),text:'电光'},[custom],clock,[])
    count+=limited.take([custom],clock,[]).length
  }
  assert.equal(count,12)
  clock+=60000;limited.trigger({id:'new',text:'电光'},[custom],clock,[])
  assert.equal(limited.take([custom],clock,[]).length,1)
  assert.throws(()=>validateAudienceContent({...custom.content,chains:[{id:'bad',match:'电光',replies:['嗨'],probability:2}]}))
  assert.throws(()=>validateAudienceContent({...custom.content,triggers:[{id:'bad',keywords:['电光'],lines:['嗨'],cooldown:-1}]}))
  assert.deepEqual(paceComments([{offsetMs:0},{offsetMs:2200}],[{offsetMs:1100}],0,'low').map(row=>row.offsetMs),[0,2200])
})

test('preset examples have a measured bounded model-input cost, without shipping full rules',t=>{
  const content={...group.content,examples:[]}
  const base={task:'comments',groups:[{ref:group.ref,name:group.name,persona:content.persona,tone:content.tone,catchphrases:[],examples:[]}],
    memory:'',recent:[],presented:[],acceptedInput:null,heat:0,waiting:false}
  const withExamples=structuredClone(base);withExamples.groups[0].presetExamples=presetExamples(content)
  const bytes=value=>Buffer.byteLength(JSON.stringify(value)),before=bytes(compactAudienceInput(base)),after=bytes(compactAudienceInput(withExamples))
  assert.ok(after>before && after<=16000)
  assert.equal(withExamples.groups[0].presetExamples.length,3)
  t.diagnostic(JSON.stringify({presetExampleBytes:{before,after,delta:after-before},directorDeltaBytes:0,schemaDeltaBytes:0}))
})
