import test from 'node:test'
import assert from 'node:assert/strict'
import {historicalPerformanceFixture} from './helpers/performance-director-fixture.mjs'
import {modelCall} from './helpers/director-model-call.mjs'
import {createAssetPackTransaction,runAssetPackDirector,readAssetPackRecord} from '../tavern-plugin/lib/domain/stage-asset-pack-director.js'
import {stagePageIndex} from '../tavern-plugin/src/client/fork-stage-page-index.cjs'

// Madoka turn 129's accepted and rejected anchors, without private dialogue or assets.
const acceptedAnchors=[3,6,8,11,16,18,20,21]
const rejectedAnchors=[24,29,31,39,44,46,49,50,53,54,57,60,63,72,76,78]
const anchors=[...acceptedAnchors,...rejectedAnchors]
const emote=symbol=>({op:'actor.emote.play',actor:'actor',symbol})
async function fixture() {
  const f=await historicalPerformanceFixture()
  f.input.raw.extensions.dsh_tavern.assetBindings.boundPackIds=[f.pack.manifest.id]
  f.input.units=Array.from({length:78},(_,i)=>({kind:'narration',text:'Paragraph '+(i+1)}))
  f.input.pageIndex=stagePageIndex(f.input.units)
  f.input.engine={actionCaps:{emote:8},dimensions:{widgets:false}}
  return f.prepare()
}

for(const incremental of [false,true]) test('manpu beyond eight remains repairable through native tools, incremental='+incremental,async()=>{
  const prepared=await fixture(),receipts=[]
  const wrap=beats=>incremental?{sequence:1,through:78,done:true,beats}:{beats}
  const beats=[{at:1,ops:[{op:'cast.add',actor:'actor'}]},...anchors.map(at=>({at,ops:[emote(at===24?'invalid':'note')]}))]
  const result=await runAssetPackDirector({prepared,incremental,getCurrentBinding:()=>prepared.binding,
    async runAgent(request) {
      assert.equal(request.tools[0].name,incremental?'stage_update':'submit_direction')
      const submit=async value=>JSON.parse(await modelCall(request,{name:request.tools[0].name,arguments:value}))
      receipts.push(await submit(wrap(beats)))
      assert.equal(request.stopToolsWhen(),false)
      assert.equal(receipts[0].accepted,24)
      assert.equal(receipts[0].errors.length,1)
      const error=receipts[0].errors[0]
      assert.equal(error.command,'actor.emote.play')
      assert.equal(error.code,'INVALID_ARGUMENT')
      assert.equal(error.received,'invalid')
      assert.equal(error.retryable,true)
      assert.deepEqual(error.choices,['!','?','...','sweat','anger','heart','note','gloom','sparkle','blush'])
      assert.match(error.next_action,/Correct this slot/)
      receipts.push(await submit(wrap([{at:24,ops:[emote('heart')]}])))
      assert.equal(receipts[1].ok,true)
      assert.equal(request.stopToolsWhen(),true)
    }})
  assert.equal(result.effect.partial,false)
  assert.deepEqual(result.effect.diagnostics,[])
  const saved=result.effect.entries.flatMap(entry=>entry.ops.filter(op=>op.op==='actor.emote.play').map(op=>({at:entry.at,symbol:op.symbol})))
  assert.deepEqual(saved,anchors.map(at=>({at,symbol:at===24?'heart':'note'})))
  assert.equal(result.effect.stats.acceptedOps,25,'repair must not repeat accepted one-shots')
})

test('manpu count stays retired after a checkpoint at eight accepted events',async()=>{
  const prepared=await fixture(),tx=createAssetPackTransaction({prepared,getCurrentBinding:()=>prepared.binding})
  const first={sequence:1,through:21,done:false,beats:[{at:1,ops:[{op:'cast.add',actor:'actor'}]},...acceptedAnchors.map(at=>({at,ops:[emote('note')]}))]}
  assert.equal(tx.submit(first).ok,true)
  assert.equal(tx.submit(first).duplicate,true)
  const checkpoint=tx.savepoint(),before=structuredClone(checkpoint)
  const resumed=createAssetPackTransaction({prepared,checkpoint,getCurrentBinding:()=>prepared.binding})
  const receipt=resumed.submit({sequence:2,through:78,done:true,beats:rejectedAnchors.map(at=>({at,ops:[emote('note')]}))})
  assert.equal(receipt.ok,true,JSON.stringify(receipt))
  assert.deepEqual(checkpoint,before)
  assert.deepEqual(resumed.effect().entries.flatMap(entry=>entry.ops.filter(op=>op.op==='actor.emote.play').map(()=>entry.at)),anchors)
})

test('reading historical manpu drops preserves the record and does not recover omitted events',async()=>{
  const prepared=await fixture(),tx=createAssetPackTransaction({prepared,incremental:false,getCurrentBinding:()=>prepared.binding})
  tx.submit({beats:[{at:1,ops:[{op:'cast.add',actor:'actor'}]},...acceptedAnchors.map(at=>({at,ops:[emote('note')]}))]})
  const historical=structuredClone(tx.effect())
  historical.partial=true
  historical.diagnostics=rejectedAnchors.map(at=>({code:'CAP_EXCEEDED',command:'actor.emote.play',capability:'emotes',at,retryable:false,message:'Action safety cap exceeded',dropped:true}))
  historical.stats={...historical.stats,droppedOps:16,dropsByCapability:{emotes:16}}
  const before=JSON.stringify(historical),read=readAssetPackRecord(historical)
  assert.equal(JSON.stringify(read),before)
  assert.equal(JSON.stringify(historical),before)
  assert.equal(read.entries.flatMap(entry=>entry.ops).filter(op=>op.op==='actor.emote.play').length,8)
  assert.equal(read.diagnostics.length,16)
})
