// private fork: cached director requests split candidates and story into separate content blocks.
import {directorPromptData} from './fixtures/asset-packs/prompt.mjs'
// private fork: assert the CLI v1 receipt; persisted record diagnostics retain domain codes.
// private fork: absolute model-facing anchors, evidenced zero-base recovery, no guessed offsets.
import test from 'node:test'
import assert from 'node:assert/strict'
import {performanceFixture} from './helpers/performance-director-fixture.mjs'
import {buildAssetPackRequest,createAssetPackTransaction,runAssetPackDirector} from '../tavern-plugin/lib/domain/stage-asset-pack-director.js'
import {createStreamingPackDirector} from '../tavern-plugin/lib/domain/stage-streaming-pack.js'
const flash = {op:'screen.play',effect:'flash'}
const beat = at => ({at,ops:[flash]})
const batch = (beats,extra={}) => ({sequence:1,through:8,done:true,beats,...extra})
const transaction = prepared => createAssetPackTransaction({prepared,getCurrentBinding:()=>prepared.binding})
const tail = request => directorPromptData(request)

test('number every unit, preserve source identity, and show the same numbers in preview',async()=>{
  const f=await performanceFixture(),p=f.prepare(),before=structuredClone(p)
  for(const incremental of [true,false]) {
    const request=buildAssetPackRequest(p,incremental,undefined,'',true)
    assert.deepEqual(tail(request).reply,p.units.map((unit,i)=>({...unit,at:i+1})))
    assert.deepEqual(JSON.parse(request.sections.find(s=>s.key==='reply').text),tail(request).reply)
    assert.match(request.tools[0].parameters.properties.beats.items.properties.at.description,/1-based, absolute/)
  }
  const strings=buildAssetPackRequest({...p,units:['One.','Two.']})
  assert.deepEqual(tail(strings).reply,[{text:'One.',at:1},{text:'Two.',at:2}])
  assert.deepEqual(p,before,'prompt numbering must not alter bound source units/digest')
})

test('complete zero-base evidence corrects both anchors and through, reports it, and remains idempotent',async()=>{
  const p=(await performanceFixture()).prepare(),tx=transaction(p)
  const raw=batch([beat(0),beat(7)],{through:7}),before=structuredClone(raw)
  const result=tx.submit(raw)
  assert.equal(result.ok,true);assert.equal(result.progress.complete,true)
  assert.deepEqual(tx.effect().entries.map(e=>e.at),[1,8])
  assert.equal(result.diagnostics.filter(d=>d.code==='INDEX_NORMALIZED').length,1)
  assert.equal(tx.effect().partial,false)
  assert.equal(tx.submit(raw).duplicate,true)
  assert.equal(tx.effect().stats.acceptedOps,2)
  assert.deepEqual(raw,before)
})

test('recorded 17-unit style retains scene/global time and optional BGM, including reference rationales',async()=>{
  const f=await performanceFixture(),p=f.prepare({units:Array.from({length:17},()=>({kind:'narration',text:'Fixture.'})),pageIndex:undefined})
  const background=p.context.catalogue.candidates.backgrounds[0].ref
  const music=p.context.catalogue.candidates.music[0].ref
  for(const withMusic of [false,true]) {
    const tx=transaction(p),ops=[{op:'scene.set',background:{...background,reason:'Source location'},time:'dusk'}]
    if(withMusic)ops.push({op:'music.set',ref:{...music,reason:'Source mood'}})
    const result=tx.submit({sequence:1,done:true,through:16,beats:[{ops,at:0}]})
    assert.equal(result.progress.complete,true);assert.equal(result.accepted,withMusic?2:1)
    assert.equal(tx.effect().entries[0].at,1)
    assert.deepEqual(tx.effect().end.scene.background,background)
    assert.deepEqual(tx.effect().end.music,withMusic?music:null,'never invent a missing BGM op')
  }
})

test('one-unit zero-base completion and metadata byte budgets',async()=>{
  const f=await performanceFixture(),p=f.prepare({units:[{kind:'narration',text:'One.'}],pageIndex:undefined}),tx=transaction(p)
  assert.equal(tx.submit(batch([beat(0)],{through:0})).progress.complete,true)
  assert.equal(tx.effect().entries[0].at,1)
  const request=buildAssetPackRequest(p),schema=request.tools[0].parameters
  assert.ok(Buffer.byteLength(JSON.stringify(tail(request).reply))-Buffer.byteLength(JSON.stringify(p.units))<=12)
  const plain=structuredClone(schema)
  delete plain.properties.through.description;delete plain.properties.beats.items.properties.at.description
  assert.ok(Buffer.byteLength(JSON.stringify(schema))-Buffer.byteLength(JSON.stringify(plain))<=120)
})

test('a lone zero in a 1-based batch drops only that beat; valid siblings keep their exact anchors',async()=>{
  const tx=transaction((await performanceFixture()).prepare())
  const result=tx.submit(batch([beat(0),beat(1),beat(8)]))
  assert.equal(result.ok,false);assert.equal(result.outcome,'partial');assert.equal(result.errors.length,1)
  assert.equal(result.errors[0].path,'$.beats[0].at')
  assert.equal(result.errors[0].retryable,false,'beat anchors are not repairable operation slots')
  assert.equal(result.errors[0].received,0)
  assert.equal(result.errors[0].schema.minimum,1)
  assert.equal(result.errors[0].choices,undefined,'a beat anchor error must not offer command names')
  assert.match(result.errors[0].next_action,/beat/)
  assert.deepEqual(tx.effect().entries.map(e=>e.at),[1,8])
  assert.ok(!tx.effect().diagnostics.some(d=>d.code==='INDEX_NORMALIZED'))
})

test('ambiguous completion, mixed conventions, partial prefixes and full-submit never guess an offset',async()=>{
  const p=(await performanceFixture()).prepare()
  for(const raw of [batch([beat(1)],{through:7}),batch([beat(0),beat(8)],{through:7})]) {
    const tx=transaction(p),result=tx.submit(raw)
    assert.equal(result.ok,false);assert.equal(result.errors[0].path,'$.through')
    assert.equal(tx.preview().through,0);assert.deepEqual(tx.preview().entries,[])
  }
  const partial=transaction(p)
  assert.equal(partial.submit(batch([beat(0),beat(2)],{through:3,done:false})).errors.length,1)
  assert.deepEqual(partial.preview().entries.map(e=>e.at),[2])
  const full=createAssetPackTransaction({prepared:p,incremental:false,getCurrentBinding:()=>p.binding})
  assert.equal(full.submit({beats:[beat(0),beat(1)]}).errors.length,1)
  assert.deepEqual(full.effect().entries.map(e=>e.at),[1])
})

test('later streaming windows reject local numbering without shifting any sibling',async()=>{
  const p=(await performanceFixture()).prepare()
  const tx=createAssetPackTransaction({prepared:p,getCurrentBinding:()=>p.binding,
    window:{first:7,carried:p.baseline,entries:[]}})
  const rejected=tx.submit(batch([beat(0)],{through:1}))
  assert.equal(rejected.ok,false)
  const result=tx.submit(batch([beat(0),beat(6),beat(7),beat(8)]))
  assert.equal(result.ok,false);assert.equal(result.outcome,'partial');assert.equal(result.errors.length,2)
  assert.deepEqual(tx.effect().entries.map(e=>e.at),[7,8])
})

test('zero-base correction survives checkpoint and per-op repair without repeating accepted events',async()=>{
  const p=(await performanceFixture()).prepare(),tx=transaction(p)
  const background=p.context.catalogue.candidates.backgrounds[0].ref
  const raw=batch([{at:0,ops:[flash,{op:'scene.set',background:{...background,assetId:'missing'},time:null}]}],{through:7})
  assert.equal(tx.submit(raw).retryable,true)
  const resumed=createAssetPackTransaction({prepared:p,getCurrentBinding:()=>p.binding,checkpoint:tx.savepoint()})
  const result=resumed.submit(batch([{at:1,ops:[{op:'scene.set',background,time:null}]}]))
  assert.equal(result.progress.complete,true)
  assert.equal(resumed.effect().entries.flatMap(e=>e.ops).filter(op=>op.op==='screen.play').length,1)
  assert.ok(resumed.effect().diagnostics.some(d=>d.code==='INDEX_NORMALIZED'))
  assert.equal(resumed.submit(raw).duplicate,true)
})

test('switching to zero-base during a repair is also reported, never silently normalized',async()=>{
  const p=(await performanceFixture()).prepare(),tx=transaction(p),background=p.context.catalogue.candidates.backgrounds[0].ref
  assert.equal(tx.submit(batch([{at:1,ops:[flash,{op:'scene.set',background:{...background,assetId:'missing'},time:null}]}])).retryable,true)
  const reply=tx.submit(batch([{at:0,ops:[{op:'scene.set',background,time:null}]}],{through:7}))
  assert.equal(reply.progress.complete,true)
  assert.ok(reply.diagnostics.some(d=>d.code==='INDEX_NORMALIZED'))
  assert.equal(tx.effect().entries.flatMap(e=>e.ops).filter(op=>op.op==='screen.play').length,1)
})

test('reference rationale is stripped narrowly; unknown identity fields and non-string annotations still fail',async()=>{
  const p=(await performanceFixture()).prepare(),background=p.context.catalogue.candidates.backgrounds[0].ref
  const tx=transaction(p),result=tx.submit(batch([{at:1,ops:[{op:'scene.set',background:{...background,reason:'A source-backed place.'},time:null},flash]}]))
  assert.equal(result.progress.complete,true);assert.equal(result.accepted,2)
  assert.ok(result.diagnostics.some(d=>d.code==='REF_ANNOTATION_IGNORED'))
  assert.deepEqual(tx.effect().end.scene.background,background)
  assert.ok(!JSON.stringify(tx.effect().entries).includes('A source-backed place.'))
  for(const extra of [{reason:3},{reason:'Metadata',url:'https://invalid.example'},{packId:'wrong',reason:'Metadata'}]) {
    const invalid=transaction(p),reply=invalid.submit(batch([{at:1,ops:[{op:'scene.set',background:{...background,...extra},time:null},flash]}]))
    assert.equal(reply.accepted,1);assert.equal(reply.errors.length,1)
    invalid.finish();assert.equal(invalid.effect().end.scene,null)
  }
})

for(const style of ['gemini-zero','numbered-object','numbered-json']) test('fake model style: '+style,async()=>{
  const p=(await performanceFixture()).prepare()
  const record=await runAssetPackDirector({prepared:p,getCurrentBinding:()=>p.binding,runAgent:async request=>{
    const units=tail(request).reply
    const zero=style==='gemini-zero'
    const args=batch([{at:units[0].at-(zero?1:0),ops:[flash]}],{through:units.at(-1).at-(zero?1:0)})
    const result=JSON.parse(await request.onToolCall({name:'stage_update',arguments:style==='numbered-object'?args:JSON.stringify(args)}))
    assert.equal(result.ok,true)
  }})
  assert.deepEqual(record.effect.entries.map(e=>e.at),[1])
})

for(const zero of [false,true]) test('streaming numbered windows keep fixed prefix/schema and absolute at/through: '+zero,async()=>{
  const {input}=await performanceFixture(),requests=[]
  const pack=createStreamingPackDirector({input,identity:{bodyOperationId:'index-test'},current:()=>true,runAgent:async request=>{
    requests.push(request)
    const data=tail(request),first=data.reply[0].at,last=data.reply.at(-1).at
    assert.deepEqual(data.reply.map(u=>u.at),Array.from({length:data.reply.length},(_,i)=>data.first+i))
    const shift=zero && first===1 ? 1:0
    const result=JSON.parse(await request.onToolCall({name:'stage_update',arguments:batch([beat(first-shift)],{through:last-shift})}))
    assert.equal(result.ok,true);assert.equal(result.progress.complete,true)
  }})
  pack.kernel.update(input.units);await pack.kernel.drain()
  pack.kernel.commit(input.units);await pack.kernel.drain()
  const snapshot=pack.kernel.snapshot()
  assert.equal(snapshot.phase,'settled',JSON.stringify(snapshot.failure))
  assert.equal(requests.length,2)
  assert.deepEqual(snapshot.entries.map(e=>e.at),requests.map(r=>tail(r).first))
  assert.equal(requests[0].system,requests[1].system)
  assert.deepEqual(requests[0].tools,requests[1].tools)
  assert.equal(snapshot.through,input.units.length)
})
