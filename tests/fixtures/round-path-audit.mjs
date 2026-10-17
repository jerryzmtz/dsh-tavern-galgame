// Production storage/timeline/settlement/projection chain. Synthetic model output;
// NOT a DSH/browser/official MVU end-to-end run. No user data or network access.
import assert from 'node:assert/strict'
import {mkdtemp,rm,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {performance,PerformanceObserver,monitorEventLoopDelay} from 'node:perf_hooks'
import {Session} from 'node:inspector'
import {createChatJournalStore} from '../../tavern-plugin/lib/domain/chat-journal-store.js'
import {createChatPersistence} from '../../tavern-plugin/lib/domain/chat-persistence.js'
import {createStoryTimeline} from '../../tavern-plugin/lib/domain/story-timeline.js'
import {createBackgroundTaskCoordinator} from '../../tavern-plugin/lib/domain/background-task-coordinator.js'
import {projectTavernHelperContext} from '../../tavern-plugin/lib/domain/tavern-helper-context.js'
import {createSessionViewSync} from '../../tavern-plugin/lib/domain/session-view-sync.js'
import {createMvuSettlementEffect,applyMvuSettlementEffect} from '../../tavern-plugin/lib/domain/mvu-settlement-effect.js'
const count=Number(process.argv[2]||453), output=process.argv[3]
const root=await mkdtemp(join(tmpdir(),'round-path-audit-')), rows=[],gcs=[]
const observer=new PerformanceObserver(list=>gcs.push(...list.getEntries()))
observer.observe({entryTypes:['gc']})
const profiler=new Session();profiler.connect()
const call=(method,params={})=>new Promise((resolve,reject)=>profiler.post(method,params,(err,value)=>err?reject(err):resolve(value)))
const delay=monitorEventLoopDelay({resolution:10});delay.enable()
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))
async function stage(name,fn){
  await pause(20);delay.reset()
  const start=performance.now(),cpu=process.cpuUsage(),before=process.memoryUsage()
  const sentinel=new Promise(resolve=>setTimeout(()=>resolve(Math.max(0,performance.now()-start-1)),1))
  const result=await fn()
  const end=performance.now(),after=process.memoryUsage(),used=process.cpuUsage(cpu)
  const sentinelDelay=await sentinel
  await pause(20)
  rows.push({name,ms:end-start,cpuMs:(used.user+used.system)/1000,heapDeltaMB:(after.heapUsed-before.heapUsed)/1e6,
    rssMB:after.rss/1e6,eventLoopMaxMs:Math.max(delay.max/1e6,sentinelDelay),gcMs:gcs.filter(g=>g.startTime>=start&&g.startTime<end).reduce((n,g)=>n+g.duration,0)})
  return result
}
try{
 const timeline=createStoryTimeline(),store=createChatJournalStore({dataRoot:root}),p=createChatPersistence({store})
 let seed={id:'audit',sessionId:'synthetic',mode:'story',settleStatus:'done',messages:Array.from({length:count},(_,i)=>({role:i%2?'user':'assistant',turn:Math.floor(i/2)+1,text:'synthetic '+i,variables:[{stat_data:{records:Array.from({length:120},(_,j)=>({id:j,value:i,description:'synthetic historical state '.repeat(14)}))}}]}))}
 const inputBytes=Buffer.byteLength(JSON.stringify(seed))
 await p.write(timeline.apply({chat:seed,intent:{kind:'ensure'}}).chat)
 seed=null
 globalThis.gc?.();await pause(30)
 await call('Profiler.enable');await call('Profiler.start')
 let initial=await stage('foreground.read',()=>p.read('audit'))
 const turn=Math.ceil(count/2)+1
 let begun=await stage('foreground.begin',async()=>{const b=timeline.apply({chat:initial,intent:{kind:'body.begin',turn,userText:'continue'}});await p.write(b.chat);return b})
 initial=null
 let body=await stage('foreground.commit',async()=>p.update('audit',chat=>timeline.complete({chat,operationId:begun.value.operationId,basedOn:begun.value.basedOn,outcome:{status:'success'},apply(draft){draft.messages.push({role:'user',turn,text:'continue'},{role:'assistant',turn,text:'synthetic reply',variables:[{stat_data:{value:0}}],mvu:{pending:true}})}}).chat))
 begun=null
 const coordinator=createBackgroundTaskCoordinator({timeline,store:{readChat:p.read,writeChat:p.write,updateChat:p.update,readState:p.readSessionState,readSlice:p.readSlice,patchChat:p.patch}})
 const task=await stage('background.begin',()=>coordinator.begin(body,'settlement'))
 const bodyMessageId=body.messages.length-1
 body=null
 await stage('background.bind',()=>task.bindSession('synthetic-background'))
 await stage('background.checkpoint',()=>task.checkpointMessage(bodyMessageId,(chat,target)=>{target.mvu.pendingSubmission=[{op:'replace',path:'/stat_data/value',value:1}]}))
 let before=await stage('mvu.read',()=>p.read('audit'))
 const effect=await stage('mvu.effect',()=>{const after=structuredClone(before);after.messages.at(-1).variables[0].stat_data.value=1;return createMvuSettlementEffect({before,after,operationId:task.operationId,branchId:before.timeline.branchId,basedOnRevision:before.timeline.revision,chatId:'audit',sessionId:'synthetic',messageId:before.messages.length-1,swipeId:0})})
 before=null
 const committed=await stage('background.commit',()=>task.commit({stateChanged:true,apply(chat){applyMvuSettlementEffect(chat,effect)}}))
 assert.equal(committed.status,'committed');assert.equal(committed.chat.messages.at(-1).variables[0].stat_data.value,1)
 const helper=await stage('helper.fullProjection',()=>projectTavernHelperContext(committed.chat))
 const sync=createSessionViewSync()
 const full=await stage('sync.first',()=>sync('synthetic',{tavernHelper:helper},null,{revision:committed.chat._storageRevision}))
 await stage('sync.unchanged',()=>sync('synthetic',{tavernHelper:helper},full.viewCursor,{revision:committed.chat._storageRevision,dirtyMessageIndices:new Set()}))
 await stage('read.concurrent4',()=>Promise.all(Array.from({length:4},()=>p.read('audit'))))
 await stage('state.concurrent4',()=>Promise.all(Array.from({length:4},()=>p.readSessionState('audit'))))
 const {profile}=await call('Profiler.stop'),nodes=new Map(profile.nodes.map(n=>[n.id,n])),totals=new Map()
 for(let i=0;i<(profile.samples||[]).length;i++){const frame=nodes.get(profile.samples[i])?.callFrame;const key=(frame?.functionName||'(anonymous)')+' @ '+(frame?.url?.split('/').slice(-2).join('/')||'native');totals.set(key,(totals.get(key)||0)+(profile.timeDeltas?.[i]||0)/1000)}
 const result={scope:'Synthetic production-module chain; no real DSH turn, model, browser, worldbook or MVU parser',count,inputBytes,node:process.version,platform:process.platform,rows,processPeakRssMB:process.resourceUsage().maxRSS/1024,peakIncludesSetup:true,cpuTop:[...totals].sort((a,b)=>b[1]-a[1]).slice(0,15).map(([name,ms])=>({name,ms}))}
 if(output)await writeFile(output,JSON.stringify(result,null,2)+'\n')
 console.log(JSON.stringify(result,null,2))
 if(process.argv.includes('--assert-responsive'))assert.ok(rows.every(row=>row.eventLoopMaxMs<100),'audit responsiveness budget exceeded: event loop delay >=100ms')
}finally{profiler.disconnect();delay.disable();observer.disconnect();await rm(root,{recursive:true,force:true})}
