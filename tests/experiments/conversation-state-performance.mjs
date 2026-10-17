// Standalone storage/domain benchmark; no browser, model, scripts or native Session.
import {mkdtemp,rm,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {performance} from 'node:perf_hooks'
import assert from 'node:assert/strict'
import {createConversationPageStore} from '../../tavern-plugin/lib/domain/conversation-page-store.js'
import {createConversationState} from '../../tavern-plugin/lib/domain/conversation-state.js'
const results=[]
for(const rounds of [1000,10000]){
 const root=await mkdtemp(join(tmpdir(),'domain-bench-'))
 try{
  let events=[]
  const store=createConversationPageStore({root,onIO:e=>events.push(e)}),domain=createConversationState({store})
  await domain.create('bench',{world:{variables:{gold:10,padding:'v'.repeat(8192)}},messages:Array.from({length:rounds*2},(_,i)=>({id:'m'+i,role:i%2?'assistant':'user',text:'body '.repeat(200)}))})
  // Seed prior receipts too: history-only fixtures would hide a growing operation index.
  await store.commit('bench',{expectedRevision:1,records:Array.from({length:rounds*2},(_,i)=>['prior:'+i,{status:'completed',position:i}])})
  const samples=[]
  for(let i=0;i<3;i++){
   events=[]
   const ms={},timed=async(name,fn)=>{const start=performance.now(),value=await fn();ms[name]=Number((performance.now()-start).toFixed(3));return value}
   const fresh=createConversationState({store:createConversationPageStore({root,onIO:e=>events.push(e)})})
   const view=await timed('open',()=>fresh.open('bench'))
   const fg=await timed('foreground',()=>fresh.commitForeground('bench',{operationId:'round:'+i,basis:view.basis,userText:'continue',assistantText:'reward'}))
   await timed('submit',()=>fresh.submitSettlement('bench',{operationId:fg.settlementId,submission:{gold:20+i}}))
   await timed('prepare',()=>fresh.prepareSettlement('bench',{operationId:fg.settlementId,world:{variables:{gold:20+i,padding:'v'.repeat(8192)}}}))
   await timed('settle',()=>fresh.commitSettlement('bench',{operationId:fg.settlementId}))
   const io=Object.fromEntries(['read','write'].map(kind=>[kind,{blocks:events.filter(e=>e.kind===kind).length,pages:events.filter(e=>e.kind===kind&&e.type==='page').length,bytes:events.filter(e=>e.kind===kind).reduce((n,e)=>n+(e.bytes??0),0)}]))
   const verified=await createConversationState({store:createConversationPageStore({root})}).open('bench')
   assert.equal(verified.messageCount,rounds*2+(i+1)*2)
   assert.equal(verified.state.world.variables.gold,20+i)
   samples.push({ms,io})
  }
  results.push({rounds,priorReceipts:rounds*2,samples})
 }finally{await rm(root,{recursive:true,force:true})}
}
const report={generatedAt:new Date().toISOString(),node:process.version,platform:process.platform,scope:'isolated domain and durable file store; fresh JS readers, warm OS cache; no UI, scripts, model or native session',results}
if(process.argv[2])await writeFile(process.argv[2],JSON.stringify(report,null,2)+'\n')
console.log(JSON.stringify(report,null,2))
