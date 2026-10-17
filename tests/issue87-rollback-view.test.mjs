import { createSessionViewReader } from '../tavern-plugin/lib/domain/session-view-reader.js'
import { projectChatSessionState, createSessionStateView } from '../tavern-plugin/lib/domain/chat-session-state.js'
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { sessionEvents } from '../tavern-plugin/lib/domain/session-events.js'

test('cached rollback controls follow the stored Session surface without resuming an Agent', async () => {
  const source=await readFile(new URL('../tavern-plugin/lib/index.js',import.meta.url),'utf8')
  const evidence=source.slice(source.indexOf('  function sessionDebugEvidence('),source.indexOf('  const readBackgroundSuppression'))
  const session={id:'s',events:[
    {seq:0,type:'user/message',data:{role:'user',source:{kind:'user'}}},
    {seq:1,type:'assistant/message',data:{turn:2,message:{source:{kind:'model',provider:'test',model:'test'}}}}
  ],surface:{nodes:[0,1]}}
  const chat={id:'c',sessionId:'s',mode:'story',cardPath:'card',_storageRevision:1,messages:[{role:'user'},{role:'assistant',turn:2}]}
  let loaded=true
  const context={str:String,sessionEvents,
    ctx:{get:()=>({get:()=>loaded?session:undefined})},
    agentRegistry:{get:()=>undefined,resume:()=>{throw Error('view must not resume')}},
    requestPerformance:{stage:(_name,fn)=>fn(),state(){}}}
  const evidenceOf=vm.runInNewContext(`(()=>{${evidence}\nreturn sessionDebugEvidence})()`,context)
  const fields=createSessionStateView({activity:()=>({busy:false}),evidence:id=>evidenceOf(id,true)})
  const reader=createSessionViewReader({readState:async()=>projectChatSessionState(chat),readChat:async()=>chat,
    project:{full:async value=>fields.volatile(value,{busy:false}),cached:async(value,previous,activity)=>({...previous,...fields.volatile(value,activity)})},
    readChanges:async()=>null,activity:()=>({busy:false}),trace:context.requestPerformance,foregroundRunning:()=>false,synchronize:()=>{}})
  const run=reader.read
  assert.equal((await run('s')).canRollback,true)
  session.surface.nodes=[]
  assert.equal((await run('s')).canRollback,false)
  session.surface.nodes=[0,1]
  assert.equal((await run('s')).canRollback,true)
  loaded=false
  const missing=await run('s')
  assert.equal(missing.canRollback,false)
  assert.match(missing.rollbackUnavailableReason,/尚未加载/)
  assert.doesNotMatch(missing.rollbackUnavailableReason,/已不在可回退/)
})
