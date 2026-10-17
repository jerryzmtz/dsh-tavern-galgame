// Offline real-journal comparison. No browser or model; OS file cache is warm.
import assert from 'node:assert/strict'
import {mkdtemp,rm,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {performance} from 'node:perf_hooks'
import {createChatJournalStore} from '../../tavern-plugin/lib/domain/chat-journal-store.js'
import {createConversationPageStore} from '../../tavern-plugin/lib/domain/conversation-page-store.js'
import {verifyConversationMigration} from '../../bin/verify-conversation-migration.mjs'
const root=await mkdtemp(join(tmpdir(),'legacy-page-comparison-'))
const report={scope:'offline old journal vs mapped page store; 50 visible bodies and current variables; legacy slice also carries historical variables; no browser/model/MVU execution; OS cache not cleared',runs:[]}
try{
 for(const rounds of [1000,10000]){
  const sourceData=join(root,'source-'+rounds),targetRoot=join(root,'target-'+rounds)
  const source=createChatJournalStore({dataRoot:sourceData,maxCachedChats:0})
  const variables={stat_data:{gold:10,inventory:Array.from({length:10},(_,i)=>({name:'合成物品'+i,count:i}))},schema:{gold:'number',inventory:'array'}}
  const chat={id:'old',sessionId:'s',_storageRevision:1,variables:{local:true},posture:'站立',messages:Array.from({length:rounds*2},(_,i)=>({role:i%2?'assistant':'user',text:'合成剧情用于结构验证。'.repeat(20)+i,sourceText:'原文'+i,turn:Math.floor(i/2)+1,variables:[variables],mvuBaseline:{swipeId:0,variables},swipeId:0,swipes:['正文'],mvu:{pending:false,receipt:{status:'updated'}},tavernPluginData:{template_rendered:{hash:'fixture',swipe:0}},customExtension:{preserve:[null,true,'未知字段']}})),timeline:{branchId:'branch',revision:rounds,checkpoints:[]}}
  const sourceJsonBytes=Buffer.byteLength(JSON.stringify(chat))
  await source.update('old',()=>chat)
  await source.patch('old',1,[{op:'set',path:['messages',rounds*2-1,'variables',0,'stat_data','gold'],value:20},{op:'set',path:['_storageRevision'],value:2}])
  const audit=await verifyConversationMigration({sourceData,chatId:'old',targetRoot,targetId:'shadow'})
  assert.equal(audit.status,'verified')
  const samples=[]
  for(let i=0;i<5;i++){
   let at=performance.now()
   const legacy=await createChatJournalStore({dataRoot:sourceData,maxCachedChats:0}).readSlice('old',Array.from({length:50},(_,i)=>rounds*2-50+i))
   const legacyMs=performance.now()-at,io=[]
   at=performance.now()
   const paged=await createConversationPageStore({root:targetRoot,onIO:e=>io.push(e)}).openConversation('shadow',{limit:50})
   const pagedMs=performance.now()-at
   assert.deepEqual(paged.messages.map(r=>[r.message.content.role,r.message.content.text]),legacy.chat.messages.map(r=>[r.role,r.text]))
   assert.equal(paged.state.messageVariables.stat_data.gold,legacy.chat.messages.at(-1).variables[0].stat_data.gold)
   assert.equal(io.filter(e=>e.type==='record').length,0)
   const pages=io.filter(e=>e.kind==='read'&&e.type==='page').length
   assert.ok(pages<=2)
   samples.push({legacyMs,pagedMs,readPages:pages,readBytes:io.filter(e=>e.kind==='read').reduce((n,e)=>n+e.bytes,0)})
  }
  report.runs.push({rounds,messages:rounds*2,sourceJsonBytes,audit,samples})
  console.log(JSON.stringify(report.runs.at(-1)))
 }
 if(process.argv[2])await writeFile(process.argv[2],JSON.stringify(report,null,2)+'\n')
}finally{await rm(root,{recursive:true,force:true})}
