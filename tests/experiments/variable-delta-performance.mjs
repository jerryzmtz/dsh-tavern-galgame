// Isolated durable domain benchmark: variable size grows, changed paths stay fixed.
import {mkdtemp,rm,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {performance} from 'node:perf_hooks'
import assert from 'node:assert/strict'
import {createConversationPageStore} from '../../tavern-plugin/lib/domain/conversation-page-store.js'
import {createConversationState} from '../../tavern-plugin/lib/domain/conversation-state.js'
const results=[]
for(const fields of [1000,10000]){
 const root=await mkdtemp(join(tmpdir(),'variable-delta-bench-'))
 try{
  const events=[],store=createConversationPageStore({root,onIO:e=>events.push(e)}),domain=createConversationState({store})
  const source={variables:{gold:10,level:1,...Object.fromEntries(Array.from({length:fields},(_,i)=>['field'+i,i])),unused:'x'.repeat(1024*1024)}}
  const buildStart=performance.now()
  await domain.create('a',{world:source})
  const buildMs=performance.now()-buildStart,samples=[]
  for(let i=0;i<3;i++){
   const fresh=createConversationState({store:createConversationPageStore({root,onIO:e=>events.push(e)})})
   const view=await fresh.open('a',{includeWorld:false})
   const fg=await fresh.commitForeground('a',{operationId:'turn'+i,basis:view.basis,userText:'u',assistantText:'a'})
   await fresh.submitSettlement('a',{operationId:fg.settlementId,submission:{gold:1}})
   events.length=0
   const start=performance.now()
   await fresh.calculateSettlement('a',{operationId:fg.settlementId},async state=>{
    await state.delta('/variables/gold',1)
    await state.set('/variables/level',(await state.get('/variables/gold'))>11?2:1)
   })
   const prepared=performance.now()
   await fresh.commitSettlement('a',{operationId:fg.settlementId})
   const committed=performance.now(),delta=await fresh.readSettlementDelta('a',fg.settlementId)
   const io=Object.fromEntries(['read','write'].map(kind=>[kind,{blocks:events.filter(e=>e.kind===kind).length,bytes:events.filter(e=>e.kind===kind).reduce((n,e)=>n+e.bytes,0)}]))
   assert.equal(await fresh.readWorld('a',{path:'/variables/gold'}),11+i)
   assert.equal((await fresh.readWorld('a',{path:'/variables/unused'})).length,1024*1024)
   samples.push({calculateAndPrepareMs:prepared-start,commitMs:committed-prepared,wireBytes:Buffer.byteLength(JSON.stringify(delta)),io})
  }
  results.push({fields,worldBytes:Buffer.byteLength(JSON.stringify(source)),buildMs,samples})
 }finally{await rm(root,{recursive:true,force:true})}
}
const report={generatedAt:new Date().toISOString(),node:process.version,scope:'new domain only; warm OS cache; fixed two scalar paths; no browser or legacy MVU executor',results}
if(process.argv[2])await writeFile(process.argv[2],JSON.stringify(report,null,2)+'\n')
console.log(JSON.stringify(report,null,2))
