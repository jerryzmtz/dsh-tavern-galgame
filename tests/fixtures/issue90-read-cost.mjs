// Isolated mechanism benchmark: production RPC functions, real journal/persistence.
// Excludes DSH turn scheduling, browser and model. Run in a fresh process per revision.
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PerformanceObserver, performance } from 'node:perf_hooks'
import { createChatJournalStore } from '../../tavern-plugin/lib/domain/chat-journal-store.js'
import { createChatPersistence } from '../../tavern-plugin/lib/domain/chat-persistence.js'
import { sessionHarness } from './issue90-session-harness.mjs'
const root=await mkdtemp(join(tmpdir(),'issue90-bench-'))
const results=[], gcEvents=[]
const observer=new PerformanceObserver(list=>gcEvents.push(...list.getEntries()))
observer.observe({entryTypes:['gc']})
const originalClone=globalThis.structuredClone
const originalParse=JSON.parse
let active
JSON.parse=(...args)=>{
  const value=originalParse(...args)
  if(active && value?.id==='c' && value.messages?.[0]?.variables)active.fullChatJsonParses++
  return value
}
// Count only complete historical payloads, not the compact message identities.
globalThis.structuredClone=(value,...args)=>{
  if(active && value?.id==='c' && value.messages?.[0]?.variables)active.fullChatStructuredClones++
  return originalClone(value,...args)
}
const tick=()=>new Promise(resolve=>setImmediate(resolve))
async function measure(name, fn) {
  await tick(); globalThis.gc?.(); await tick(); await tick()
  const before=process.memoryUsage(), cpu=process.cpuUsage(), start=performance.now()
  const row={name,fullChatStructuredClones:0,fullChatJsonParses:0};active=row
  try { await fn() } finally {active=undefined}
  const end=performance.now(), after=process.memoryUsage()
  row.ms=end-start; row.cpuMs=Object.values(process.cpuUsage(cpu)).reduce((a,b)=>a+b,0)/1000
  row.heapDeltaMB=(after.heapUsed-before.heapUsed)/1e6;row.rssMB=after.rss/1e6
  await tick();await tick()
  const gc=gcEvents.filter(event=>event.startTime>=start && event.startTime<end)
  row.gcCount=gc.length;row.gcMs=gc.reduce((sum,event)=>sum+event.duration,0)
  results.push(row);console.log(JSON.stringify(row))
}
try {
  const store=createChatJournalStore({dataRoot:root}), persistence=createChatPersistence({store})
  let chat={id:'c',sessionId:'s',mode:'story',cardPath:'card',backgroundConfigVersion:1,conversationFeaturesVersion:1,_storageRevision:5921,
    messages:Array.from({length:453},(_,i)=>({role:i%2?'assistant':'user',turn:Math.floor(i/2)+1,text:'Synthetic '+i,
      variables:[{stat_data:{records:Array.from({length:120},(_,j)=>({id:j,value:i,description:'synthetic historical state '.repeat(14)}))}}]}))}
  const bytes=Buffer.byteLength(JSON.stringify(chat))
  await store.update('c',()=>chat)
  const app=await sessionHarness(persistence,chat)
  chat=null
  await measure('getSession cache hit x20',async()=>{for(let i=0;i<20;i++)await app.get()})
  await measure('sessionActivity x20',async()=>{for(let i=0;i<20;i++)await app.activity()})
  let snapshot=await persistence.read('c')
  await measure('volatile projection only x20',()=>{for(let i=0;i<20;i++)app.volatile(snapshot)})
  snapshot=null
  await measure('isolated writable read x20',async()=>{for(let i=0;i<20;i++)await persistence.read('c')})
  await measure('no-op update',()=>persistence.update('c',()=>undefined))
  await measure('metadata update',()=>persistence.update('c',current=>{current.counter=1;return current}))
  for (const mode of ['full', 'delta']) {
    let revision=(await persistence.readSessionState('c'))._storageRevision
    await measure('changing revision ' + mode + ' x10',async()=>{
      for(let i=0;i<10;i++) {
        await persistence.patch('c',revision,[{op:'set',path:['messages',452,'text'],value:mode+i}])
        const selected=mode==='delta' ? await persistence.readViewDelta('c',revision) : {chat:await persistence.read('c')}
        assert.equal(selected.chat.messages[452].text,mode+i)
        revision++
      }
    })
  }
  const promptDraft=await persistence.read('c')
  promptDraft.tavernScriptPrompts=[{id:'benchmark',content:'prompt'}]
  await measure('prompt full write',()=>persistence.write(promptDraft))
  const promptRevision=(await persistence.readSessionState('c'))._storageRevision
  await measure('prompt exact revision patch',()=>persistence.patch('c',promptRevision,[
    {op:'set',path:['tavernScriptPrompts'],value:[{id:'benchmark',content:'next prompt'}]}
  ]))
  await measure('forced GC after writes',()=>globalThis.gc?.())
  await writeFile(process.argv[2],JSON.stringify({node:process.version,platform:process.platform,bytes,messages:453,
    scope:'Warm synthetic cache/status RPC functions, volatile projection, reads and writes. GC events overlap wall time; RSS is endpoint, not peak.',results},null,2)+'\n')
  if(process.argv.includes('--assert-optimized')) {
    for(const name of ['getSession cache hit x20','sessionActivity x20','no-op update']) {
      assert.equal(results.find(row=>row.name===name).fullChatStructuredClones,0,name)
    }
    const write = results.find(row=>row.name==='metadata update')
    assert.equal(write.fullChatStructuredClones,1,'detached normalized result')
    assert.equal(write.fullChatJsonParses,2,'only draft and normalization JSON copies')
  }
} finally {observer.disconnect();JSON.parse=originalParse;globalThis.structuredClone=originalClone;await rm(root,{recursive:true,force:true})}
