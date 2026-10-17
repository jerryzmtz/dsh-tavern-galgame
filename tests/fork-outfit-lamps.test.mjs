// private fork: cached director requests split candidates and story into separate content blocks.
// private fork: assert the model handle DTO, while saved state stays canonical.
import {modelCall,modelHandle} from './helpers/director-model-call.mjs'
// private fork: new director commands use the catalogue's deterministic FigureRef identity.
import {figureActorKey} from '../tavern-plugin/lib/domain/figure-catalogue.js'
import {PACK_ID as actorPackId,FIGURE_ID as actorFigureId} from './fixtures/asset-packs/pack.mjs'
const actorKey=figureActorKey({packId:actorPackId,figureId:actorFigureId})
// private fork: assert the CLI v1 receipt; persisted record diagnostics retain domain codes.
// private fork: recall filters model choices, never the persistent actor snapshot.
import test from 'node:test'
import assert from 'node:assert/strict'
import {syntheticPack,cardExtension,FIGURE_ID} from './fixtures/asset-packs/pack.mjs'
import {prepareAssetPackDirector,buildAssetPackRequest,createAssetPackTransaction} from '../tavern-plugin/lib/domain/stage-asset-pack-director.js'
import {createStreamingPackDirector} from '../tavern-plugin/lib/domain/stage-streaming-pack.js'
import {directorPromptData} from './fixtures/asset-packs/prompt.mjs'

async function fixture() {
  const pack=await syntheticPack(),figure=pack.figures[FIGURE_ID]
  const base=figure.outfits[0], outfit=(key,label,recall={mode:'keyword',keywords:[]})=>({...structuredClone(base),key,label,recall})
  figure.outfits=[outfit('school','校服'),outfit('pajamas','睡衣'),outfit('swim','海滨装',{mode:'keyword',keywords:['泳装'],synonyms:{泳装:['泳衣','swimsuit']},priority:1}),outfit('magic','魔法少女',{mode:'constant',keywords:[]}),{...outfit('disabled','禁用睡衣'),enabled:false}]
  const input={snapshots:[{...pack,revision:'pack-r1'}],raw:{extensions:{dsh_tavern:cardExtension()}},cardRevision:'card-r1',engine:{},target:{sourceKey:'reply-1',branchId:'b',revision:1},units:['Unchanged story.']}
  return {input,figure,prepare:extra=>prepareAssetPackDirector({...input,...extra})}
}
const keys=p=>directorPromptData(buildAssetPackRequest(p)).actors[modelHandle(buildAssetPackRequest(p),actorKey)].outfits.map(o=>o.key)
const tx=p=>createAssetPackTransaction({prepared:p,getCurrentBinding:()=>p.binding})
const batch=ops=>({sequence:1,through:1,done:true,beats:[{at:1,ops}]})

test('name, keyword and synonym recall share lexical boundaries; constants and initial outfit are fixed',async()=>{
  const f=await fixture(),base=f.prepare()
  assert.deepEqual(keys(base),['school','magic'])
  for(const text of ['换上睡衣。','泳装','泳衣','SWIMSUIT','海滨装']) {
    const p=f.prepare({units:[text]}),expected=text.includes('睡衣')?'pajamas':'swim'
    assert.deepEqual(keys(p),['school','magic',expected])
    assert.equal(buildAssetPackRequest(p).system,buildAssetPackRequest(base).system)
    const result=tx(p).submit(batch([{op:'actor.outfit.set',actor:actorKey,outfit:expected}]))
    assert.equal(result.ok,true)
  }
  assert.deepEqual(keys(f.prepare({units:['swimsuits']})),['school','magic'])
  assert.deepEqual(keys(f.prepare({units:['禁用睡衣']})),['school','magic','pajamas'])
  for(const outfit of ['swim','disabled','foreign']) assert.equal(tx(base).submit(batch([{op:'actor.outfit.set',actor:actorKey,outfit}])).ok,false)
  assert.equal(base.context.actors[actorKey].outfits.length,4,'unmatched enabled outfits still exist in the state catalogue')
})

test('current green outfit is offered without keywords, reset/fallback and disabled outfit dimension keep their contracts',async()=>{
  const f=await fixture(),first=f.prepare({units:['睡衣']}),transaction=tx(first)
  assert.equal(transaction.submit(batch([{op:'actor.outfit.set',actor:actorKey,outfit:'pajamas'}])).ok,true)
  const record=transaction.effect(),next=f.prepare({record})
  assert.deepEqual(keys(next),['school','magic','pajamas'])
  assert.equal(next.baseline.actors[actorKey].outfitKey,'pajamas')
  assert.equal(buildAssetPackRequest(next).system,buildAssetPackRequest(f.prepare()).system)
  const reset=tx(next);assert.equal(reset.submit(batch([{op:'actor.outfit.reset',actor:actorKey}])).ok,true)
  assert.equal(reset.effect().end.actors[actorKey].outfitKey,'school')
  f.figure.outfits.find(o=>o.key==='pajamas').enabled=false
  assert.equal(f.prepare({record}).baseline.actors[actorKey].outfitKey,'school')
  assert.equal(record.end.actors[actorKey].outfitKey,'pajamas')
  const disabled=buildAssetPackRequest(f.prepare({engine:{dimensions:{outfit:false}},units:['睡衣','泳衣']}))
  assert.doesNotMatch(disabled.system,/pajamas|swim|魔法少女/)
  assert.equal(JSON.parse(disabled.messages[0].content[0].text).outfits,undefined)
})

test('many-outfit prompt shrinks and schemas stay byte-identical when green choices fire',async t=>{
  const f=await fixture()
  for(let i=0;i<66;i++) f.figure.outfits.push({...structuredClone(f.figure.outfits[1]),key:'costume-'+i,label:'Special costume '+i})
  const p=f.prepare(),request=buildAssetPackRequest(p,true,undefined,'',true),hit=buildAssetPackRequest(f.prepare({units:['泳衣 睡衣']}),true,undefined,'',true)
  const bytes=v=>Buffer.byteLength(typeof v==='string'?v:JSON.stringify(v))
  const legacy=Object.fromEntries(Object.entries(p.context.actors).map(([id,a])=>[id,{...a,outfits:a.outfits.map(({label,recall,...o})=>o)}]))
  const after=request.sections.filter(s=>['actors.constant','actors.turn','outfits'].includes(s.key)).reduce((n,s)=>n+bytes(s.text),0)
  assert.ok(after>0 && after<bytes(legacy)/3)
  assert.equal(bytes(request.tools),bytes(hit.tools))
  assert.equal(request.system,hit.system)
  assert.ok(hit.inputBytes-request.inputBytes<256,'only two terse green choices and changed reply are appended')
  t.diagnostic(JSON.stringify({legacyActorsBytes:bytes(legacy),actorsAndOutfitsBytes:after,toolSchemaBytes:bytes(request.tools)}))
})

test('production streaming windows recall only their own text and retain a selected green outfit',async()=>{
  const f=await fixture(),requests=[]
  const pack=createStreamingPackDirector({input:f.input,identity:{bodyOperationId:'outfit-stream'},current:()=>true,runAgent:async request=>{
    requests.push(request)
    const data=directorPromptData(request),last=data.reply.at(-1).at
    const ops=requests.length===1?[{op:'actor.outfit.set',actor:actorKey,outfit:'pajamas'}]:[]
    const response=JSON.parse(await modelCall(request,{name:'stage_update',arguments:{sequence:1,through:last,done:true,beats:[{at:data.first,ops}]}}))
    assert.equal(response.ok,true)
  }})
  const units=Array.from({length:16},(_,i)=>({kind:'narration',text:i===0?'换上睡衣和泳衣。':'Unchanged paragraph '+i}))
  pack.kernel.update(units.slice(0,8));await pack.kernel.drain()
  assert.equal(requests.length,1)
  pack.kernel.update(units);await pack.kernel.drain()
  pack.kernel.commit(units);await pack.kernel.drain()
  assert.equal(pack.kernel.snapshot().phase,'settled')
  assert.ok(requests.length>=2)
  for(const request of requests.slice(1)) {
    const data=directorPromptData(request)
    assert.equal(request.system,requests[0].system)
    assert.deepEqual(request.tools,requests[0].tools)
    assert.deepEqual(data.outfits[modelHandle(request,actorKey)].map(o=>o.key),['pajamas'],'unselected swim choice does not become carry')
    assert.equal(data.carried.actors[modelHandle(request,actorKey)].outfit,'pajamas')
  }
  assert.equal(pack.kernel.snapshot().state.actors[actorKey].outfitKey,'pajamas')
})
