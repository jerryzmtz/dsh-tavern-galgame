// private fork: tagged English defaults; retain protocol, payload, cache and budget assertions.
// private fork: cached director requests split candidates and story into separate content blocks.
import {directorPromptData} from './fixtures/asset-packs/prompt.mjs'
// private fork: assert request-local handles; canonical records retain exact IDs.
import {modelHandle} from './helpers/director-model-call.mjs'
// private fork: assert the CLI v1 receipt; persisted record diagnostics retain domain codes.
// private fork: canonical transactions and the shared sustained fold; no player substitutes.
import test from 'node:test'
import assert from 'node:assert/strict'
import {performanceFixture,performanceRef} from './helpers/performance-director-fixture.mjs'
import {createAssetPackTransaction,buildAssetPackRequest,readAssetPackRecord} from '../tavern-plugin/lib/domain/stage-asset-pack-director.js'
import {compilePerformance,performancePlan,performanceSustained} from '../fork/mods/performance/state.cjs'
import {assetPackDigest} from '../tavern-plugin/lib/domain/stage-asset-pack-catalogue.js'
import {stagePageIndex} from '../tavern-plugin/src/client/fork-stage-page-index.cjs'
const perform=(level,id='show')=>({op:'mod.dsh.performance.set',ref:performanceRef(id),...(level===undefined?{}:{level})})
const off={op:"mod.dsh.performance.off"}
const batch=(sequence,at,ops,through=at)=>({sequence,through,done:through===8,beats:[{at,ops}]})
const ok=value=>assert.equal(value.ok,true,JSON.stringify(value))

test('entry, same-level no-op, turn, downgrade, re-upgrade and off share durable boundaries',async()=>{
  const f=await performanceFixture(),p=f.prepare(),tx=f.transaction(p)
  const phases=['entry','entry','turn','idle','turn','exit']
  const boundaries=[0,0,2,3,4,5], keys=[]
  for(const [i,op] of [perform(),perform(2),perform(3),perform(2),perform(3),off].entries()) {
    ok(tx.submit(batch(i+1,i+1,[op])))
    const saved=tx.savepoint()
    assert.equal(saved.state.state.performance.phase,phases[i])
    assert.deepEqual(saved.state.state.performance.startedAt,{turn:1,page:boundaries[i]})
    const projected=f.fold(tx.preview(),p,i)
    keys.push(projected.phaseKey)
    assert.equal(projected.phase,i===1?'idle':phases[i])
    assert.equal(projected.sustained.bgm?.ref.assetId,i===2||i===4?'turn-track':i===5?undefined:'classroom')
    if(i===5) assert.deepEqual(projected.sustained,{skin:null,bgm:null,look:null,ambience:null,widgets:{}})
    const resumed=createAssetPackTransaction({prepared:p,getCurrentBinding:()=>p.binding,checkpoint:saved})
    assert.deepEqual(resumed.savepoint(),saved)
    assert.deepEqual(resumed.preview(),tx.preview())
  }
  assert.deepEqual(keys[0],keys[1])
  assert.notDeepEqual(keys[2],keys[4])
  assert.equal(f.fold(tx.preview(),p,6),null)
  assert.throws(()=>f.prepare({record:tx.preview()}),/record|Unknown field|complete/i,'a sealed preview is not an authoritative next-turn baseline')
  ok(tx.submit({sequence:7,through:8,done:true,beats:[]}))
  const record=readAssetPackRecord(tx.effect())
  const next=f.prepare({record,target:{...p.binding.target,turn:2,sourceKey:'s2'},predecessor:[record]})
  assert.equal(next.baseline.performance,null)
  const empty=f.transaction(next);ok(empty.submit({sequence:1,through:8,done:true,beats:[]}))
  assert.equal(f.fold(empty.effect(),next),null)
})

test('high-level activation includes entry and turn; cross-turn empty deltas retain activation identity',async()=>{
  const f=await performanceFixture(),p=f.prepare(),tx=f.transaction(p)
  ok(tx.submit(batch(1,1,[perform(3)],8)))
  const record=tx.effect(),entry=f.fold(record,p)
  assert.deepEqual(entry.plan.blocks.map(b=>b.name),['entry','turn'])
  assert.equal(entry.sustained.bgm.ref.assetId,'turn-track')
  assert.equal(entry.plan.events.find(e=>e.do==='bgm').at,610)
  const second=f.prepare({record,predecessor:[record],target:{...p.binding.target,turn:2,sourceKey:'s2'}})
  const tx2=f.transaction(second);ok(tx2.submit({sequence:1,through:8,done:true,beats:[]}))
  assert.deepEqual(tx2.effect().end.performance,record.end.performance)
  const projected=f.fold(tx2.effect(),second)
  assert.equal(projected.phase,'idle')
  assert.deepEqual(projected.instanceKey,entry.instanceKey)
  assert.deepEqual(projected.sustained,entry.sustained)
  const third=f.prepare({record:tx2.effect(),predecessor:[record,tx2.effect()],target:{...p.binding.target,turn:3,sourceKey:'s3'}})
  assert.deepEqual(f.fold(f.transaction(third).preview(),third).instanceKey,entry.instanceKey)
})

test('same-page off/start is a new instance; replacement only projects the final plan and retiring exit',async()=>{
  const f=await performanceFixture(2),p=f.prepare(),tx=f.transaction(p)
  ok(tx.submit(batch(1,1,[perform(2),off,perform(2)])))
  const restarted=f.fold(tx.preview(),p)
  assert.deepEqual(restarted.instanceKey.slice(-2),[0,2])
  assert.equal(restarted.retiring,null)
  ok(tx.submit(batch(2,2,[perform(3,'show-1')],8)))
  const replace=f.fold(tx.effect(),p,1)
  assert.equal(replace.ref.assetId,'show-1')
  assert.deepEqual(replace.retiring.instanceKey,restarted.instanceKey)
  assert.equal(replace.retiring.plan.phase,'exit')
  assert.equal(f.fold(tx.effect(),p,2).retiring,null)
  assert.deepEqual(f.fold(tx.preview(),p,1),replace,'sealed preview and complete record fold the same page')
})

// private fork: bad performance ops are isolated in an unpublished correction window.
test('invalid references/levels and unreadable starts retain accepted siblings with bounded candidates',async()=>{
  const f=await performanceFixture(),p=f.prepare(),tx=f.transaction(p)
  for(const [op,code] of [[perform(4),'INVALID_ARGUMENT'],[perform(2,'unknown'),'NOT_FOUND']]) {
    const before=tx.savepoint().state
    const result=tx.submit(batch(1,1,[perform(2),op]))
    assert.equal(result.errors[0].code,code)
    assert.equal(result.retryable,true)
    assert.ok(result.errors[0].choices); assert.equal(result.errors[0].command, 'mod.dsh.performance.set'); assert.ok(result.errors[0].next_action)
    assert.equal(tx.savepoint().state.patchWindow.result.state.performance.level,2)
    assert.deepEqual(tx.savepoint().state.state,before.state)
    assert.deepEqual(tx.savepoint().state.performanceProjection,before.performanceProjection)
    assert.equal(tx.savepoint().state.through,0)
  }
  const units=[{kind:'narration',text:'<b></b>'},...f.input.units.slice(1)]
  const noPage=f.prepare({units,pageIndex:stagePageIndex(units)}),invalid=f.transaction(noPage)
  assert.equal(invalid.submit(batch(1,1,[perform()])).errors[0].code,'CONFLICT')
  invalid.finish()
  ok(invalid.submit(batch(2,2,[perform()],8)))
  assert.deepEqual(invalid.effect().end.performance.startedAt,{turn:1,page:0})
})

test('single-level default, duplicate receipts, and saved semantic projection are deterministic',async()=>{
  const f=await performanceFixture();delete f.pack.performances.show.levels
  const p=f.prepare(),tx=f.transaction(p),args=batch(1,1,[perform()])
  ok(tx.submit(args));const before=tx.savepoint()
  assert.equal(before.state.state.performance.level,1)
  assert.equal(tx.submit(args).duplicate,true)
  assert.deepEqual(tx.savepoint(),before)
  assert.equal(tx.submit(batch(2,2,[perform(2)])).errors[0].code,'INVALID_ARGUMENT')
  const corrupt=structuredClone(before);corrupt.state.performanceProjection.instanceKey=['fake'];corrupt.digest=assetPackDigest(corrupt.state)
  assert.throws(()=>createAssetPackTransaction({prepared:p,getCurrentBinding:()=>p.binding,checkpoint:corrupt}),/projection summary/)
})

test('performance layering leaves director music/skin intact and records deferred explicit requests, including same-ref and stop',async()=>{
  const f=await performanceFixture(),p=f.prepare(),tx=f.transaction(p)
  const music={packId:performanceRef().packId,kind:'music',assetId:'classroom'}
  ok(tx.submit(batch(1,1,[{op:"music.set", ref:music},perform(3),{op:"music.set", ref:music}],8)))
  const projection=f.fold(tx.effect(),p)
  assert.deepEqual(tx.effect().end.music,music)
  assert.deepEqual(projection.restore.previous,music)
  assert.deepEqual(projection.restore.directorRequest.ref,music)
  assert.deepEqual(projection.restore.directorRequest.key.slice(-2),[0,2])
  assert.equal(projection.sustained.bgm.ref.assetId,'turn-track')
  const receipt=tx.submit(batch(1,1,[{op:"music.set", ref:music},perform(3),{op:"music.set", ref:music}],8))
  assert.equal(receipt.diagnostics[0].code,'PERFORMANCE_DEFERRED')
  // An explicit stop from silence is still a request, not an omitted field.
  const silent=f.transaction(p);ok(silent.submit(batch(1,1,[perform(),{op:'music.clear'}],8)))
  assert.deepEqual(f.fold(silent.effect(),p).restore.directorRequest.ref,null)
  f.pack.performances.show.bgm.lock=false
  const unlocked=f.transaction(f.prepare()),receipt2=unlocked.submit(batch(1,1,[perform(),{op:'music.clear'}],8))
  ok(receipt2);assert.equal(receipt2.diagnostics,undefined,'an unlocked track does not report a deferred music request')
})

test('unavailable performance is not admitted and omission retains state; generations keep distinct activation identity',async()=>{
  const f=await performanceFixture(),p=f.prepare(),tx=f.transaction(p)
  ok(tx.submit(batch(1,1,[perform()],8)))
  const record=tx.effect(),old=f.fold(record,p)
  const regenerated=f.prepare({generation:1}),again=f.transaction(regenerated)
  ok(again.submit(batch(1,1,[perform()],8)))
  assert.notDeepEqual(f.fold(again.effect(),regenerated).instanceKey,old.instanceKey)
  f.pack.manifest.assets.find(a=>a.kind==='performances').enabled=false
  const next=f.prepare({record,predecessor:[record],target:{...p.binding.target,turn:2,sourceKey:'s2'}})
  assert.equal(next.context.catalogue.candidates.performances.length,0)
  assert.equal(next.baseline.performance.ref.assetId,'show')
  const exit=f.transaction(next)
  assert.equal(exit.submit(batch(1,1,[off],8)).errors[0].code,'NOT_FOUND')
  const omitted=f.transaction(next)
  ok(omitted.submit(batch(1,1,[],8)))
  assert.deepEqual(omitted.effect().end.performance,record.end.performance)
  assert.equal(record.end.performance.phase,'entry','future downgrade never rewrites old records')
})

test('shared sustained reducer excludes one-shots and always clears exit-owned layers',()=>{
  const doc={timeline:{entry:{events:[{at:0,do:'skin',ref:'s'},{at:0,do:'widget',ref:'w',slot:'a'},{at:0,do:'widget',ref:'w',slot:'a'},{at:1,do:'flash',ms:80},{at:2,do:'sfx',ref:'sfx'}]},idle:{every:[3000,5000],events:[{at:0,do:'widget-off',slot:'a'}]},turn:{events:[{at:600,do:'bgm',ref:'turn'}]},exit:{events:[]}},bgm:{ref:'base'}}
  const compiled=compilePerformance(doc),low=performancePlan(compiled,{phase:'idle',level:2}),high=performancePlan(compiled,{phase:'turn',level:3})
  assert.equal(Object.keys(performanceSustained(low).widgets).length,0)
  assert.equal(performanceSustained(high).bgm.ref,'turn')
  assert.equal(compiled.blocks.entry.events[1].ordinal,1)
  assert.equal(compiled.blocks.entry.events[2].ordinal,2)
  assert.equal(compiled.blocks.entry.durationMs,81)
  assert.deepEqual(performanceSustained(performancePlan(compiled,{phase:'exit',level:3})),{skin:null,bgm:null,look:null,ambience:null,widgets:{}})
})

const bytes=value=>Buffer.byteLength(typeof value==='string'?value:JSON.stringify(value),'utf8')
function measure(prepared) {
  const request=buildAssetPackRequest(prepared,true,undefined,'',true),user=directorPromptData(request)
  // private fork: volatile performance choices live after the stable prefix; retain the same content budget.
  return {performance:request.sections.filter(section=>section.key.startsWith('mod.dsh.performance.')).reduce((sum,row)=>sum+bytes(row.text),0),system:bytes(request.system),catalogue:bytes(user.catalogue),carried:bytes(user.carried),reply:bytes(user.reply),tools:bytes(request.tools),toolSchemaBytes:bytes(request.tools[0].parameters),wire:bytes({system:request.system,messages:request.messages,tools:request.tools})}
}
test('installed performance schema is frozen; off and no recall have zero prompt bytes',async t=>{
  for(const n of [1,6]) {
    const f=await performanceFixture(n)
    for(const doc of Object.values(f.pack.performances))doc.directorNote='演'.repeat(120)
    const active=f.prepare(),on=buildAssetPackRequest(active,true,undefined,'',true)
    const off=f.prepare({mods:{revision:'off',commands:[],schemaCommands:active.context.schemaModCommands,enabledAssetKinds:[]},modPrompts:[]})
    for(const asset of f.pack.manifest.assets)if(asset.kind==='performances')asset.enabled=false
    const empty=f.prepare()
    const before=measure(off),after=measure(active)
    t.diagnostic(JSON.stringify({candidates:n,before,after,empty:measure(empty)}))
    assert.equal(before.performance,0)
    assert.equal(off.context.catalogue.candidates.performances.length,0)
    assert.ok(off.context.catalogue.rows.filter(row=>row.ref.kind==='performances').every(row=>row.excluded==='mod-disabled'))
    assert.equal(measure(empty).performance,0)
    assert.deepEqual(on.tools,buildAssetPackRequest(off).tools)
    assert.deepEqual(on.tools,buildAssetPackRequest(empty).tools)
    const catalogue=on.sections.find(row=>row.key==='mod.dsh.performance.catalogue')
    assert.ok(catalogue.bytes<=(n===1?512:1536))
    assert.ok(after.performance>0)
    assert.doesNotMatch(JSON.stringify(buildAssetPackRequest(off).messages),/dsh.performance|"performance"/)
    assert.doesNotMatch(JSON.stringify(buildAssetPackRequest(empty).messages),/dsh.performance|"performance"/)
    assert.doesNotMatch(on.system,/Do not repeat|Not the document note|startedAt|timeline/)
    assert.equal(after.reply,before.reply)
    const carried=structuredClone(active)
    carried.baseline.performance={ref:performanceRef(),level:2,phase:'entry',startedAt:{turn:1,page:0}}
    assert.deepEqual(directorPromptData(buildAssetPackRequest(carried)).carried.performance,{ref:modelHandle(buildAssetPackRequest(carried),performanceRef()),level:2})
    const disabledCarry=structuredClone(off);disabledCarry.baseline.performance=carried.baseline.performance
    assert.equal(directorPromptData(buildAssetPackRequest(disabledCarry)).carried.performance,undefined)
  }
})
