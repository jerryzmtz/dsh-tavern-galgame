// Isolated patch-engine benchmark: no filesystem, rendering, or model latency.
import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { pathToFileURL } from 'node:url'
const moduleUrl=process.argv[2] ? pathToFileURL(process.argv[2]).href : new URL('../../tavern-plugin/lib/domain/json-mutation.js',import.meta.url).href
const {applyJsonChangesShared}=await import(moduleUrl)
const input={messages:Array.from({length:453},(_,i)=>({text:String(i),variables:[{records:Array.from({length:120},(_,j)=>({id:j,text:'historical state '.repeat(25)}))}]}))}
const workloads={
  'replace variable snapshots':Array.from({length:100},(_,i)=>({op:'set',path:['messages',i,'variables'],value:[{value:i}]})),
  'batch leaf updates':Array.from({length:453},(_,i)=>({op:'set',path:['messages',i,'text'],value:'updated '+i}))
}
for(const [name,changes] of Object.entries(workloads)) {
  globalThis.gc?.()
  const clone=globalThis.structuredClone
  let copiedOldRows=0
  globalThis.structuredClone=(value,...args)=>{if(Array.isArray(value)&&value[0]?.records)copiedOldRows++;return clone(value,...args)}
  const start=performance.now(),before=process.memoryUsage().heapUsed
  let result
  try { for(let i=0;i<20;i++)result=applyJsonChangesShared(input,changes) }
  finally {globalThis.structuredClone=clone}
  console.log(JSON.stringify({name,iterations:20,ms:performance.now()-start,heapDeltaMB:(process.memoryUsage().heapUsed-before)/1e6,copiedOldRows}))
  assert.equal(input.messages[0].text,'0')
  assert.notEqual(result.messages,input.messages)
}
