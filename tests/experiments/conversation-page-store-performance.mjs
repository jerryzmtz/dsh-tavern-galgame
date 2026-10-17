// Storage prototype benchmark only: this is not Tavern/MVU/browser E2E.
import {mkdtemp,rm,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {performance} from 'node:perf_hooks'
import assert from 'node:assert/strict'
import {createConversationPageStore} from '../../tavern-plugin/lib/domain/conversation-page-store.js'
const report={scope:'new-format file adapter; fresh reader per sample; no browser/model/MVU; OS disk cache not cleared',pageSize:50,samples:[]}
const root=await mkdtemp(join(tmpdir(),'conversation-page-perf-'))
try{
 for(const rounds of [1000,10000]){
  const id=String(rounds),messages=Array.from({length:rounds*2},(_,i)=>({id:'m'+i,role:i%2?'assistant':'user',text:'固定长度的合成剧情。'.repeat(60)}))
  const state=Object.fromEntries(Array.from({length:50},(_,i)=>['field'+i,{value:i,label:'当前状态'}]))
  const seed=createConversationPageStore({root}),start=performance.now()
  await seed.create(id,{state,metadata:{card:'synthetic'},messages})
  const initializationMs=performance.now()-start
  for(let run=0;run<5;run++){
   const io=[],store=createConversationPageStore({root,onIO:e=>io.push(e)})
   let began=performance.now()
   const opened=await store.openConversation(id,{limit:50})
   const openMs=performance.now()-began,openIO=io.splice(0)
   assert.equal(opened.messages.length,50)
   began=performance.now()
   await store.commit(id,{expectedRevision:opened.revision,append:[{id:'u'+run,text:'continue'},{id:'a'+run,text:'reply'}],state:{...state,gold:run}})
   const commitMs=performance.now()-began,commitIO=io.splice(0)
   const persisted=await createConversationPageStore({root}).openConversation(id,{limit:2})
   assert.equal(persisted.messageCount,rounds*2+2*(run+1));assert.equal(persisted.state.gold,run)
   assert.equal(persisted.messages.at(-1).message.id,'a'+run)
   const stats=events=>({readBlocks:events.filter(e=>e.kind==='read').length,readPages:events.filter(e=>e.kind==='read'&&e.type==='page').length,readBytes:events.filter(e=>e.kind==='read').reduce((n,e)=>n+e.bytes,0),writeBlocks:events.filter(e=>e.kind==='write').length,writePages:events.filter(e=>e.kind==='write'&&e.type==='page').length,writeBytes:events.filter(e=>e.kind==='write').reduce((n,e)=>n+e.bytes,0)})
   const sample={rounds,run,initializationMs,openMs,commitMs,open:stats(openIO),commit:stats(commitIO)}
   assert.ok(sample.open.readPages<=2);assert.ok(sample.commit.readPages<=1);assert.ok(sample.commit.writePages<=1)
   report.samples.push(sample)
  }
 }
 if(process.argv[2])await writeFile(process.argv[2],JSON.stringify(report,null,2)+'\n')
 for(const rounds of [1000,10000]){
  const samples=report.samples.filter(s=>s.rounds===rounds)
  const range=key=>[Math.min(...samples.map(s=>s[key])),Math.max(...samples.map(s=>s[key]))].map(n=>Number(n.toFixed(2)))
  console.log(JSON.stringify({rounds,openMs:range('openMs'),commitMs:range('commitMs'),readPages:samples.map(s=>s.open.readPages),writePages:samples.map(s=>s.commit.writePages)}))
 }
}finally{await rm(root,{recursive:true,force:true})}
