import {directorPromptData} from './fixtures/asset-packs/prompt.mjs'
// private fork: assert the model handle DTO, while saved state stays canonical.
import {modelCall,modelHandle} from './helpers/director-model-call.mjs'
// private fork: tool receipts use the CLI v1 envelope; saved record diagnostics are unchanged.
// private fork: the reported Da Fei Yu failure shapes, with a scripted model and no paid IO.
import test from 'node:test'
import assert from 'node:assert/strict'
import {historicalPerformanceFixture as performanceFixture} from './helpers/performance-director-fixture.mjs'
import {createStreamingPackDirector} from '../tavern-plugin/lib/domain/stage-streaming-pack.js'
import {buildAssetPackRequest,createAssetPackTransaction,runAssetPackDirector} from '../tavern-plugin/lib/domain/stage-asset-pack-director.js'
import {validateAssetPackToolValue} from '../tavern-plugin/lib/domain/stage-asset-pack-tools.js'
import {assetPackToolResult} from '../tavern-plugin/lib/domain/stage-asset-pack-validation.js'

const batch = beats => ({sequence:1,through:22,done:true,beats})
async function fixture() {
  const f = await performanceFixture()
  f.input.units = Array.from({length:22},(_,i)=>({kind:'narration',text:'Paragraph '+(i+1)}))
  f.input.engine = {dimensions:{widgets:false},limits:{maxBeatsPerCall:8,maxOpsPerCall:1,maxOps:1,maxBeats:1}}
  return f
}
const enter = {op:'cast.add',actor:'actor'}
const rejected = [
  {at:2,ops:[{op:'cast.set',actors:['actor','kosakatsuki']},{op:'cast.add',actor:'kosakatsuki'}]},
  {at:3,ops:[{op:'actor.emote.play',actor:'kosakatsuki',symbol:'!'},{op:'closeup.play',actor:'kosakatsuki'}]},
  {at:10,ops:[{op:'cast.set',actors:['actor','kosakatsuki']}]},
  {at:12,ops:[{op:'actor.gaze.set',actor:'actor',target:'kosakatsuki'}]},
  {at:13,ops:[{op:'actor.emote.play',actor:'kosakatsuki',symbol:'!'}]}
]
const repaired = rejected.map(beat=>({...beat,ops:beat.ops.map(op=>({...op,...(op.actors ? {actors:['actor']} : {}),...(op.actor ? {actor:'actor'} : {}),...(op.target ? {target:'viewer'} : {})}))}))

test('streaming CLI returns exact slot choices and repairs states, events and temporary cameras without repeating accepted events',async()=>{
  const f = await fixture(), receipts=[]
  const pack = createStreamingPackDirector({input:f.input,identity:{bodyOperationId:'test'},current:()=>true,
    async runAgent(request) {
      assert.equal(Object.hasOwn(request,'maxToolCalls'),false)
      assert.match(JSON.stringify(request.tools),/clock\.advance/)
      assert.ok(!directorPromptData(request).allowedCommands.includes('clock.advance'))
      const first = batch([{at:1,ops:[enter,{op:'title.play',text:'Retained'}]},...rejected,
        ...Array.from({length:9},(_,i)=>({at:14+i,ops:[{op:'title.play',text:'Beat '+i}]}))])
      const submit=async value=>JSON.parse(await modelCall(request,{name:request.tools[0].name,arguments:value}))
      receipts.push(await submit(first))
      assert.equal(request.stopToolsWhen(),false,'partial acceptance must not conclude the native turn')
      assert.equal(receipts[0].retryable,true)
      assert.equal(receipts[0].errors.length,7)
      assert.ok(receipts[0].errors.every(drop=>drop.retryable))
      assert.equal(receipts[0].errors[0].received,'kosakatsuki')
      assert.deepEqual(receipts[0].errors[0].choices,[modelHandle(request,'actor')])
      assert.deepEqual(receipts[0].errors.find(drop=>drop.command==='actor.gaze.set').choices,['viewer','away'])
      assert.deepEqual(receipts[0].errors.at(-1).choices,[modelHandle(request,'actor')])
      receipts.push(await submit(batch([{at:1,ops:[enter,{op:'title.play',text:'Retained'}]},...repaired])))
      assert.equal(receipts[1].ok,true)
      assert.equal(request.stopToolsWhen(),true)
    }})
  pack.kernel.commit(f.input.units);await pack.kernel.drain()
  assert.equal(pack.kernel.snapshot().phase,'settled',JSON.stringify(pack.kernel.snapshot().failure))
  const record=pack.complete(pack.binding,22),ops=record.entries.flatMap(entry=>entry.ops)
  assert.equal(record.partial,false)
  assert.equal(record.stats.attempts,2);assert.equal(record.stats.retries,1)
  assert.equal(ops.filter(op=>op.op==='title.play').length,10,'non-safety beat/op/title quotas are removed')
  assert.equal(ops.filter(op=>op.op==='actor.emote.play').length,2)
  assert.ok(record.entries.some(entry=>entry.at===22))
})

for (const incremental of [false,true]) test('CLI envelope: five corrections succeed with idempotent resends, incremental='+incremental,async()=>{
  const f=await fixture(),p=f.prepare(),replies=[]
  const result=await runAssetPackDirector({prepared:p,incremental,getCurrentBinding:()=>p.binding,
    async runAgent(request) {
      assert.equal(Object.hasOwn(request,'maxToolCalls'),false)
      for(let attempt=0;attempt<=5;attempt++) {
        assert.equal(request.stopToolsWhen(),false)
        const beats=[{at:1,ops:[enter,{op:'screen.play',effect:'flash'},{op:'actor.emote.play',actor:'actor',symbol:attempt===5?'!':'wrong'}]}]
        replies.push(JSON.parse(await modelCall(request,{name:request.tools[0].name,arguments:incremental?batch(beats):{beats}})))
      }
      assert.equal(request.stopToolsWhen(),true)
    }})
  assert.deepEqual(replies.map(reply=>reply.retryable),[true,true,true,true,true,false])
  assert.deepEqual(replies.map(reply=>reply.outcome),['partial','partial','partial','partial','partial','applied'])
  assert.ok(replies.every(reply=>reply.schema_version===1))
  assert.ok(replies.slice(0,5).every(reply=>!reply.ok && reply.accepted===2 && reply.errors[0].next_action && reply.errors[0].code==='INVALID_ARGUMENT'))
  assert.ok(replies[0].errors[0].choices.includes('anger'))
  assert.equal(result.effect.stats.calls,6)
  assert.equal(result.effect.stats.acceptedOps,3)
  assert.deepEqual(result.effect.end.cast,['actor'])
  assert.deepEqual(result.effect.entries[0].ops.map(op=>op.op),['cast.add','screen.play','actor.emote.play'])
  assert.equal(result.effect.partial,false)
})

for (const incremental of [false,true]) test('model stops after partial acceptance without another correction, incremental='+incremental,async()=>{
  const f=await fixture(),p=f.prepare()
  const result=await runAssetPackDirector({prepared:p,incremental,getCurrentBinding:()=>p.binding,
    async runAgent(request) {
      const beats=[{at:1,ops:[enter,{op:'actor.emote.play',actor:'actor',symbol:'wrong'}]}]
      const reply=JSON.parse(await modelCall(request,{name:request.tools[0].name,arguments:incremental?batch(beats):{beats}}))
      assert.equal(reply.ok,false);assert.equal(reply.outcome,'partial');assert.equal(reply.accepted,1)
      assert.equal(request.stopToolsWhen(),false)
    }})
  assert.equal(result.effect.partial,true)
  assert.equal(result.effect.stats.calls,1)
  assert.equal(result.effect.stats.droppedOps,1)
  assert.deepEqual(result.effect.entries[0].ops,[enter])
})

test('fatal binding conflict stops the transaction, keeps an honest envelope and cannot seal a pending window',async()=>{
  const f=await fixture(),p=f.prepare();let current=p.binding
  const tx=createAssetPackTransaction({prepared:p,getCurrentBinding:()=>current})
  tx.submit(batch([{at:1,ops:[enter,{op:'actor.emote.play',actor:'actor',symbol:'wrong'}]}]))
  current=null
  const fatal=tx.submit(batch([]))
  assert.equal(fatal.schema_version,1);assert.equal(fatal.ok,false);assert.equal(fatal.outcome,'partial')
  assert.equal(fatal.accepted,1);assert.equal(fatal.errors[0].code,'CONFLICT')
  assert.equal(fatal.errors[0].retryable,false);assert.match(fatal.errors[0].next_action,/Stop/)
  assert.equal(tx.terminal(),true);assert.equal(tx.finish(),false)
  assert.equal(tx.completed(),false);assert.throws(()=>tx.effect())
})

test('scripted model receives a fatal envelope and the runner ends without saving or applying it',async()=>{
  const f=await fixture(),p=f.prepare();let current=p.binding,calls=0,saves=0
  await assert.rejects(runAssetPackDirector({prepared:p,getCurrentBinding:()=>current,saveCheckpoint:()=>saves++,
    async runAgent(request) {
      current=null
      const reply=JSON.parse(await modelCall(request,{name:request.tools[0].name,arguments:batch([])}));calls++
      assert.equal(reply.outcome,'not_applied');assert.equal(reply.accepted,0)
      assert.equal(reply.errors[0].code,'CONFLICT');assert.equal(reply.errors[0].retryable,false)
      assert.equal(request.stopToolsWhen(),true)
    }}),error=>error.code==='STAGE_DIRECTION_REJECTED')
  assert.equal(calls,1);assert.equal(saves,0)
})

test('malformed envelope feedback stays compact and every failure carries a corrective action',async()=>{
  const f=await fixture(),p=f.prepare(),tx=createAssetPackTransaction({prepared:p,getCurrentBinding:()=>p.binding})
  for(const args of [null,{sequence:1,through:22,done:true,beats:'wrong'}]) {
    const reply=tx.submit(args)
    assert.equal(reply.schema_version,1);assert.equal(reply.ok,false);assert.equal(reply.outcome,'not_applied')
    assert.equal(reply.accepted,0);assert.equal(reply.errors.length,1)
    assert.equal(reply.errors[0].code,'INVALID_ARGUMENT');assert.equal(reply.errors[0].retryable,true)
    assert.ok(reply.errors[0].next_action);assert.ok(reply.errors[0].schema)
    assert.doesNotThrow(()=>validateAssetPackToolValue(args===null?batch([]):[],reply.errors[0].schema))
    assert.ok(Buffer.byteLength(JSON.stringify(reply))<1024,'do not echo the whole static tool grammar')
    assert.equal(tx.terminal(),false)
  }
  assert.equal(tx.submit(batch([])).outcome,'applied')
})

test('repair receipts and resumed repair prompts carry only self-contained field constraints',async()=>{
  const f=await fixture()
  f.pack.manifest.assets.filter(asset=>asset.kind==='backgrounds').forEach(asset=>asset.recall.mode='constant')
  const p=f.prepare()
  for (const incremental of [false,true]) {
    const tx=createAssetPackTransaction({prepared:p,incremental,getCurrentBinding:()=>p.binding})
    const args=beats=>incremental?batch(beats):{beats}
    const first=tx.submitModel(args([{at:1,ops:[{op:'cast.set',actors:'wrong'},{op:'title.play',text:42}]}]))
    assert.equal(first.ok,false)
    assert.deepEqual(first.errors[0].schema,{type:'array',uniqueItems:true})
    assert.equal(first.errors[1].schema.type,'string')
    assert.equal(first.errors[1].schema.maxLength,24)
    const resumed=createAssetPackTransaction({prepared:p,incremental,checkpoint:tx.savepoint(),getCurrentBinding:()=>p.binding})
    for (const payload of [first,resumed.request.messages]) {
      assert.doesNotMatch(JSON.stringify(payload),/\$(?:ref|defs)/)
    }
    assert.ok(Buffer.byteLength(JSON.stringify(first))<1400)
    const repaired=resumed.submitModel(args([{at:1,ops:[{op:'cast.set',actors:[]},{op:'title.play',text:'Repaired'}]}]))
    assert.equal(repaired.ok,true)
    assert.equal(resumed.effect().stats.droppedOps,0)
  }
  // A repair of an unlisted slot reports an operation-level conflict, not its full schema.
  const tx=createAssetPackTransaction({prepared:p,getCurrentBinding:()=>p.binding})
  tx.submit(batch([{at:1,ops:[enter,{op:'cast.set',actors:'wrong'}]}]))
  const conflict=tx.submit(batch([{at:1,ops:[{op:'scene.set',background:p.context.catalogue.candidates.backgrounds[0].ref,time:'day'}]}]))
  const error=conflict.errors.find(row=>row.command==='scene.set')
  assert.equal(error.code,'CONFLICT')
  assert.deepEqual(error.schema,{type:'object',required:['op','background','time']})
  assert.doesNotMatch(JSON.stringify(conflict),/\$(?:ref|defs)/)
})

test('frozen tools and all feedback echoes contain no provider-interpreted references',async()=>{
  const f=await fixture(),p=f.prepare(),pointer='#/$defs/ref'
  const clean=value=>assert.doesNotMatch(JSON.stringify(value),/\$(?:ref|defs)/)
  for (const incremental of [false,true]) {
    const tx=createAssetPackTransaction({prepared:p,incremental,getCurrentBinding:()=>p.binding})
    clean(tx.request.tools)
    const bad={nested:[{$ref:pointer,note:pointer}],$defs:{ref:{type:'string'}}}
    const args=incremental?batch([]):{beats:[]}
    clean(tx.submitModel({...args,beats:bad}))
    clean(tx.submitModel({...args,beats:[{at:1,ops:[{op:'title.play',text:bad}]}]}))
    clean(tx.submitModel({...args,beats:[{at:1,ops:[{op:'title.play',text:'ok',[pointer]:true}]}]}))
    const resumed=createAssetPackTransaction({prepared:p,incremental,checkpoint:tx.savepoint(),getCurrentBinding:()=>p.binding})
    clean(resumed.request.messages)
  }
  const echoed={code:'ARG_INVALID',path:'$.'+pointer,command:'unknown',message:'Unknown '+pointer,
    received:{$ref:pointer,nested:[pointer,JSON.stringify({$ref:'other',$defs:{}})]},validValues:[{$ref:pointer},pointer],next_action:'Replace '+pointer,retryable:true}
  const unchanged=structuredClone(echoed)
  const receipt=assetPackToolResult([echoed],0)
  clean(receipt)
  assert.deepEqual(echoed,unchanged,'transport safety does not rewrite canonical diagnostics')
  assert.equal(receipt.errors[0].retryable,true)
  assert.equal(receipt.errors[0].received.nested[0],'[schema-definition]/ref')
})

test('unknown command names can be corrected without adding wire aliases',async()=>{
  const f=await fixture(),p=f.prepare(),tx=createAssetPackTransaction({prepared:p,getCurrentBinding:()=>p.binding})
  const first=tx.submit(batch([{at:1,ops:[enter,{op:'actor.emotes.play',actor:'actor',symbol:'!'}]}]))
  assert.equal(first.retryable,true)
  assert.ok(first.errors[0].choices.includes('actor.emote.play'))
  const second=tx.submit(batch([{at:1,ops:[{op:'actor.emote.play',actor:'actor',symbol:'!'}]}]))
  assert.equal(second.ok,true)
  assert.deepEqual(tx.effect().entries[0].ops.map(op=>op.op),['cast.add','actor.emote.play'])
})

test('off/unavailable widgets remain grammar-only; malicious widget ops degrade only themselves',async()=>{
  for(const mode of ['disabled','no-assets']) {
    const f=await fixture()
    if(mode==='no-assets') {f.input.engine.dimensions={};f.pack.manifest.assets=f.pack.manifest.assets.filter(row=>row.kind!=='widgets')}
    const p=f.prepare(),request=buildAssetPackRequest(p)
    assert.match(JSON.stringify(request.tools),/clock\.advance/)
    assert.ok(!directorPromptData(request).allowedCommands.includes('clock.advance'))
    assert.doesNotMatch(request.system,/clock:advance|director_commands/)
    const tx=createAssetPackTransaction({prepared:p,getCurrentBinding:()=>p.binding})
    const reply=tx.submit(batch([{at:1,ops:[{op:'weather.set',weather:'rain'},{op:'clock.advance',seconds:30}]}]))
    assert.equal(reply.errors[0].code,'UNAVAILABLE');assert.equal(reply.retryable,false)
    assert.equal(tx.effect().end.weather,'rain')
  }
})

test('bad outfit/reference errors list only recalled, owned, kind-correct values',async()=>{
  const f=await fixture()
  // private fork: this error-choice fixture makes backgrounds blue, never relies on fill.
  f.pack.manifest.assets.filter(asset=>asset.kind==='backgrounds').forEach(asset=>asset.recall.mode='constant')
  const p=f.prepare(),tx=createAssetPackTransaction({prepared:p,getCurrentBinding:()=>p.binding})
  const reply=tx.submit(batch([{at:1,ops:[{op:'actor.outfit.set',actor:'actor',outfit:'claude'},{op:'scene.set',background:{packId:f.pack.manifest.id,kind:'backgrounds',assetId:'renamed'},time:'day'}]}]))
  assert.deepEqual(reply.errors[0].choices,['school','casual'])
  assert.ok(reply.errors[1].choices.every(ref=>ref.kind==='backgrounds'))
  assert.deepEqual(reply.errors[1].choices,p.context.catalogue.candidates.backgrounds.map(row=>row.ref))
})

test('cast size is not a quota, including the deferred CG cast',async()=>{
  const f=await fixture(),roster=f.input.baseline.actors
  // private fork: historical multiple keys for one ref must not be merged.
  for(const alias of ['second','third','fourth','fifth']) roster[alias]=structuredClone(roster.actor)
  for(const cg of [false,true]) {
    const p=structuredClone(f.prepare())
    if(cg) p.baseline.cg={ref:{packId:f.pack.manifest.id,kind:'cg',assetId:'test'},variant:'base',focus:'full',resumeCast:[]}
    const tx=createAssetPackTransaction({prepared:p,getCurrentBinding:()=>p.binding})
    const actors=Object.keys(roster)
    assert.equal(tx.submit(batch([{at:1,ops:[{op:'cast.set',actors}]}])).ok,true)
    assert.deepEqual(cg?tx.effect().end.cg.resumeCast:tx.effect().end.cast,actors)
  }
})

test('only photosensitive screen effects and shaking retain count safety limits',async()=>{
  const f=await fixture(),p=f.prepare(),tx=createAssetPackTransaction({prepared:p,getCurrentBinding:()=>p.binding})
  const reply=tx.submit(batch([{at:1,ops:[enter,
    ...Array.from({length:12},()=>({op:'actor.act.play',actor:'actor',motion:'nod'})),
    ...Array.from({length:5},()=>({op:'actor.act.play',actor:'actor',motion:'shake'})),
    ...Array.from({length:7},()=>({op:'screen.play',effect:'flash'})),
    ...Array.from({length:12},()=>({op:'screen.play',effect:'blur'}))]}]))
  assert.equal(reply.errors.length,2)
  assert.ok(reply.errors.every(drop=>drop.code==='CONFLICT' && !drop.retryable))
  assert.equal(tx.effect().entries[0].ops.length,35)
})
