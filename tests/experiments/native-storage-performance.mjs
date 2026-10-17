// Storage-only scaling probe. Real filesystem + new-format runtime adapter;
// this does not replace browser/official-MVU end-to-end measurements.
import assert from 'node:assert/strict'
import {mkdtemp,rm,writeFile,mkdir} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {tmpdir} from 'node:os'
import {createChatJournalStore} from '../../tavern-plugin/lib/domain/chat-journal-store.js'
import {createChatPersistence} from '../../tavern-plugin/lib/domain/chat-persistence.js'

const rounds=Number(process.argv.find(arg=>arg.startsWith('--rounds='))?.split('=')[1]??10000)
assert.ok(Number.isSafeInteger(rounds)&&rounds>=1&&rounds<=10000)
const root=await mkdtemp(join(tmpdir(),'native-scale-'))
const output=resolve('output/native-performance')
await mkdir(output,{recursive:true})
let io
const onIO=e=>{io[e.kind]=(io[e.kind]??0)+1;io.bytes+=e.bytes; if(e.type==='page'&&e.kind==='read')io.pages++}
const report={rounds,scope:'storage only; native format; synthetic unique turns; no model or browser',steps:[]}
async function measure(name,run){
 io={bytes:0,pages:0};const start=performance.now()
 const value=await run()
 const sample={name,ms:Math.round((performance.now()-start)*10)/10,...io}
 report.steps.push(sample);console.log(JSON.stringify(sample))
 return value
}
try{
 const store=createChatJournalStore({dataRoot:root,newConversations:true,onNativeIO:onIO}),p=createChatPersistence({store})
 const stat_data=Object.fromEntries(Array.from({length:20},(_,i)=>['field'+i,i]))
 const messages=Array.from({length:rounds*2},(_,i)=>({role:i%2?'assistant':'user',turn:Math.floor(i/2)+1,
  text:i%2?'合成正文。'.repeat(60):'继续',...(i%2?{variables:[{stat_data:{...stat_data,gold:i}}]}:{})}))
 const chat=await measure('create',()=>p.write({id:'scale',sessionId:'synthetic',messages,mode:'story'}))
 const fresh=()=>createChatJournalStore({dataRoot:root,onNativeIO:onIO})
 await measure('cold-tail-100',async()=>{
  const result=await fresh().readSlice('scale',Array.from({length:Math.min(100,messages.length)},(_,i)=>messages.length-Math.min(100,messages.length)+i),'settlement')
  assert.equal(result.messageCount,messages.length);assert.equal(result.chat.messages.at(-1).variables[0].stat_data.gold,messages.length-1)
 })
 if(process.argv.includes('--helper'))await measure('cold-helper-tail-48',async()=>{
  const from=Math.max(0,messages.length-48)
  const result=await fresh().readHelperContext('scale',{from})
  assert.equal(result.context.messages.length,messages.length-from)
  assert.equal(result.context.messages[0].message_id,from)
  assert.equal(result.context.messages.at(-1).variables.stat_data.gold,messages.length-1)
  assert.ok(io.pages<=2,'Helper tail must not read the complete history')
 })
 await measure('cold-session-summary',async()=>{
  const result=await fresh().readSessionState('scale',{scoped:true})
  assert.equal(result.messages.length,messages.length);assert.equal(result.messages.at(-1).turn,rounds)
 })
 await measure('warm-update-20-fields',async()=>{
  await p.patch('scale',chat._storageRevision,Array.from({length:20},(_,i)=>({op:'set',path:['messages',messages.length-1,'variables',0,'stat_data','field'+i],value:i+1})))
  assert.ok(io.write<=45,'one batch must not write intermediate trees')
 })
 await measure('cold-full-read',async()=>{
  const result=await fresh().read('scale')
  assert.equal(result.messages.length,messages.length)
  for(let i=0;i<20;i++)assert.equal(result.messages.at(-1).variables[0].stat_data['field'+i],i+1)
  assert.equal(result.messages[1].variables[0].stat_data.field0,0)
 })
 if(process.argv.includes('--cold-patch'))await measure('cold-update-20-fields',async()=>{
  const cold=createChatPersistence({store:createChatJournalStore({dataRoot:root,cacheMaxBytes:1,onNativeIO:onIO})})
  const selected=await cold.readSlice('scale',[],['_storageRevision'])
  const result=await cold.patch('scale',selected.chat._storageRevision,Array.from({length:20},(_,i)=>({op:'set',path:['messages',messages.length-1,'variables',0,'stat_data','field'+i],value:i+2})))
  assert.equal(result._storageRevision,selected.chat._storageRevision+1)
  assert.ok(io.pages<=6,'cold point writes must not read all history pages')
  assert.equal((await cold.readSlice('scale',[messages.length-1],[])).chat.messages[0].variables[0].stat_data.field0,2)
 })
 report.status='passed'
}catch(error){report.status='failed';report.error=error.stack;process.exitCode=1;console.error(error)}
finally{
 await writeFile(join(output,'scale-'+(process.argv.includes('--cold-patch')?'cold-patch-':process.argv.includes('--helper')?'helper-':'')+rounds+'.json'),JSON.stringify(report,null,2)+'\n')
 await rm(root,{recursive:true,force:true})
}
