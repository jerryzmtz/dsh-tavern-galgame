// private fork: production read/admission/commit against native journal storage.
import test from 'node:test'
import assert from 'node:assert/strict'
import { widgetChatFixture,purchase,nextWidgetTurn } from './fixtures/widget-variable-chat.mjs'
import { createWidgetVariableService } from '../tavern-plugin/lib/domain/widget-variable-service.js'
import { lastRoundVariableChanges } from '../tavern-plugin/lib/domain/foreground-variable-changes.js'


test('native purchase is atomic, idempotent and the next actual writer/MVU baseline sees it',async t=>{
  const h=await widgetChatFixture(t)
  await h.mutate(chat=>{chat.promptTemplateInput={turn:2,message:{variables:[{stat_data:{balance:999}}]}};chat.runtimeInputs={'2':{source:'Continue after the purchase',text:'stale'}};chat.preparedWorldBookContext='stale balance 999'})
  const projection=await h.service.read(h.input)
  assert.equal(projection.values.balance.value,20);assert.equal(projection.writable.allowed,true)
  const result=await h.propose(purchase,'buy',projection)
  assert.equal(result.status,'committed',JSON.stringify(result))
  const saved=await h.db.read('fixture')
  assert.deepEqual(saved.messages[0].variables[0].stat_data,{balance:15,bag:{seed:1}})
  assert.equal(saved.posture,'unchanged');assert.equal(saved.messages[0].text,'Synthetic opening')
  assert.equal(saved.timeline.checkpoints.length,0);assert.equal(saved.promptTemplateInput,undefined)
  assert.equal(saved.runtimeInputs,undefined);assert.equal(saved.preparedWorldBookContext,'')
  assert.equal((await h.propose(purchase,'buy',projection)).status,'committed');assert.equal(h.dispatches(),1)
  const status=await h.service.status({...h.input,operationId:'buy'})
  assert.equal(status.status,'committed');assert.equal(status.schema,undefined)
  const restarted=createWidgetVariableService(h.config);t.after(()=>restarted.dispose())
  assert.equal((await restarted.status({...h.input,operationId:'buy'})).status,'committed')
  assert.throws(()=>h.timeline.apply({chat:saved,intent:{kind:'agent.begin',role:'settlement'}}),/edited-after-settlement/)
  assert.match(lastRoundVariableChanges(saved),/15/)
  const next=await nextWidgetTurn(h)
  assert.equal(next.writer.messages[0].variables[0].stat_data.balance,15)
  assert.equal(next.chat.messages.at(-1).variables[0].stat_data.balance,15)
  assert.match(JSON.stringify(next.prepared.frame),/15/)
})

test('reading follows last page, pending settlement, selected swipe and never a future floor',async t=>{
  const h=await widgetChatFixture(t)
  await h.mutate(chat=>{chat.messages.push({role:'user',turn:2,text:'continue'},{role:'assistant',turn:2,text:'Two pages',swipeId:0,variables:[{...h.variables,stat_data:{balance:40,bag:{}}},{...h.variables,stat_data:{balance:80,bag:{}}}],mvu:{receipt:{status:'updated'}}})})
  const before=await h.db.read('fixture')
  const read=(turn,page,viewEpoch)=>h.service.read({...h.input,turn,page:{index:page},viewEpoch})
  assert.equal((await read(2,0,2)).values.balance.value,20)
  assert.equal((await read(2,1,3)).values.balance.value,40)
  assert.equal((await read(1,1,4)).values.balance.value,20)
  assert.equal((await read(1,0,5)).values.balance.status,'unavailable')
  assert.equal((await h.db.read('fixture'))._storageRevision,before._storageRevision)
  await h.mutate(chat=>{chat.messages[2].swipeId=1})
  assert.equal((await read(2,1,6)).values.balance.value,80)
  await h.mutate(chat=>{chat.messages[2].mvu.pending=true})
  const pending=await read(2,1,7)
  assert.equal(pending.values.balance.value,20);assert.equal(pending.snapshot.kind,'inherited');assert.equal(pending.writable.allowed,false)
})

for(const race of ['helper','body','swipe','rewind','revoke','navigation'])test(`awaiting executor rejects late ${race} effect`,async t=>{
  let entered,finish;const waiting=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>finish=resolve)
  const h=await widgetChatFixture(t,{beforeExecute:async()=>{entered();await gate}})
  const request=h.propose();await waiting
  if(race==='revoke')h.revoke()
  else if(race==='navigation')h.service.invalidate({...h.input,viewEpoch:2,active:false})
  else await h.mutate(chat=>{
    if(race==='helper')chat.messages[0].variables[0].stat_data.balance=99
    if(race==='body')Object.assign(chat,h.timeline.apply({chat,intent:{kind:'body.begin',turn:2,userText:'next'}}).chat)
    if(race==='swipe'){chat.messages[0].variables[1]=structuredClone(h.variables);chat.messages[0].swipeId=1}
    if(race==='rewind'){chat.timeline.branchId='replacement';chat.timeline.revision++;chat.tavernHelperLifecycleRevision=1}
  })
  finish();const result=await request
  assert.ok(['conflict','cancelled','unavailable'].includes(result.status),JSON.stringify(result))
  const saved=await h.db.read('fixture')
  assert.deepEqual(saved.messages[0].variables[0].stat_data.bag,{})
  assert.equal(saved.messages[0].variableEdits,undefined)
})

test('model-stage, prepared delivery and failed settlement admission are closed',async t=>{
  const h=await widgetChatFixture(t)
  for(const state of ['model','prepared','failed']) {
    await h.mutate(chat=>{chat.timeline.operations={};delete chat.messages[0].mvu;
      if(state==='model')chat.timeline.operations.model={id:'model',kind:'agent',role:'settlement',status:'running',basedOn:{branchId:chat.timeline.branchId,revision:chat.timeline.revision}}
      if(state==='prepared')chat.messages[0].mvu={pending:true,delivery:{prepared:{}}}
      if(state==='failed')chat.messages[0].mvu={receipt:{status:'error'}}
    })
    assert.equal((await h.service.read(h.input)).writable.reason,'settlement-pending')
    assert.equal((await h.propose()).status,'conflict')
  }
  assert.equal(h.dispatches(),0)
})

test('receipts evict at 16 without losing edit fact or feedback and all limits reject atomically',async t=>{
  const h=await widgetChatFixture(t)
  const service=createWidgetVariableService({...h.config,now:(()=>{let time=0;return ()=>time+=61000})()});t.after(()=>service.dispose())
  for(let i=0;i<18;i++) {
    const view=await service.read(h.input)
    assert.equal((await service.propose({sessionId:'fixture',operationId:'edit-'+i,contextKey:view.contextKey,revision:view.revision,operations:[{writeId:'balance',op:'delta',value:1}]})).status,'committed')
  }
  const saved=await h.db.read('fixture'),block=saved.messages[0].variableEdits[0]
  assert.equal(block.receipts.length,16);assert.equal(block.editedAfterSettlement,true);assert.deepEqual(block.feedbackPaths,['/balance'])
  assert.equal(saved.messages[0].variables[0].stat_data.balance,38)
  assert.equal((await h.propose([{writeId:'bag',suffix:'/seed',op:'insert',value:'x'.repeat(9000)}])).status,'rejected')
  await h.mutate(chat=>{chat.messages[0].variableEdits[0].feedbackPaths=Array.from({length:64},(_,i)=>'/field'+i)})
  assert.equal((await h.propose()).status,'conflict')
  assert.equal((await h.db.read('fixture')).messages[0].variables[0].stat_data.balance,38)
})


test('a second widget and settlement cannot enter an admitted edit; restart discards only the unsaved intent',async t=>{
  let entered,finish;const waiting=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>finish=resolve)
  const h=await widgetChatFixture(t,{beforeExecute:async()=>{entered();await gate}})
  const request=h.propose();await waiting
  const latest=await h.db.read('fixture')
  assert.throws(()=>h.timeline.apply({chat:latest,intent:{kind:'agent.begin',role:'settlement'}}),/variable-edit-running/)
  const other=await h.service.read({...h.input,viewId:'other'})
  assert.equal(other.writable.allowed,false)
  assert.equal((await h.service.propose({sessionId:'fixture',operationId:'other',contextKey:other.contextKey,revision:other.revision,operations:purchase})).reason,'rate-limit')
  h.service.dispose()
  const restarted=createWidgetVariableService(h.config);t.after(()=>restarted.dispose())
  assert.equal((await restarted.status({...h.input,operationId:'purchase'})).status,'cancelled')
  finish();assert.equal((await request).status,'cancelled')
  assert.equal((await h.db.read('fixture')).messages[0].variables[0].stat_data.balance,20)
})

test('deleting a purchased item is atomic and its final deletion reaches the existing feedback channel',async t=>{
  const h=await widgetChatFixture(t)
  assert.equal((await h.propose()).status,'committed')
  assert.equal((await h.propose([{writeId:'bag',suffix:'/seed',op:'remove'}],'remove')).status,'committed')
  const chat=await h.db.read('fixture')
  assert.deepEqual(chat.messages[0].variables[0].stat_data.bag,{})
  assert.match(lastRoundVariableChanges(chat),/已删除/)
  assert.equal(chat.messages[0].variableEdits[0].receipts.length,2)
})

test('ten requests per session per minute and complete envelopes are enforced on the server',async t=>{
  const h=await widgetChatFixture(t)
  for(let i=0;i<10;i++)assert.equal((await h.propose([{writeId:'balance',op:'delta',value:1}],'edit'+i)).status,'committed')
  assert.equal((await h.propose([{writeId:'balance',op:'delta',value:1}],'over')).reason,'rate-limit')
  assert.equal((await h.service.propose({sessionId:'fixture',operationId:'large',padding:'x'.repeat(17000)})).reason,'invalid-request')
  assert.equal((await h.db.read('fixture')).messages[0].variables[0].stat_data.balance,30)
})


test('lost admission response can be fenced as not committed, never replayed later',async t=>{
  const h=await widgetChatFixture(t),projection=await h.service.read(h.input)
  const status=await h.service.status({...h.input,contextKey:projection.contextKey,revision:projection.revision,operationId:'lost'})
  assert.equal(status.status,'cancelled');assert.equal(status.reason,'not-admitted')
  assert.equal((await h.propose(purchase,'lost',projection)).status,'conflict')
  assert.equal(h.dispatches(),0)
})

test('historical saved state is not hidden by the latest turn model-stage settlement',async t=>{
  const h=await widgetChatFixture(t)
  await h.mutate(chat=>{chat.messages.push({role:'assistant',turn:2,text:'later'});chat.timeline.operations.model={id:'model',kind:'agent',role:'settlement',status:'running',basedOn:{branchId:chat.timeline.branchId,revision:chat.timeline.revision}}})
  const old=await h.service.read(h.input)
  assert.equal(old.values.balance.value,20);assert.equal(old.snapshot.kind,'exact')
  assert.equal(old.writable.allowed,false)
})

test('two mounted refs share the same revision-pinned row read',async t=>{
  const h=await widgetChatFixture(t);let reads=0
  const service=createWidgetVariableService({...h.config,readWindow:async(...args)=>{reads++;return h.db.readWindow(...args)}});t.after(()=>service.dispose())
  await Promise.all([service.read(h.input),service.read({...h.input,viewId:'second',ref:{...h.input.ref,assetId:'other'}})])
  assert.equal(reads,1)
})


test('read gates runtime absence and startup recovery releases an orphan without replay',async t=>{
  const h=await widgetChatFixture(t),unavailable=createWidgetVariableService({...h.config,availability:()=>({ready:false})});t.after(()=>unavailable.dispose())
  const read=await unavailable.read(h.input)
  assert.equal(read.writable.reason,'runtime-unavailable')
  assert.equal((await unavailable.propose({sessionId:'fixture',operationId:'no-runtime',contextKey:read.contextKey,revision:read.revision,operations:purchase})).status,'unavailable')
  await h.mutate(chat=>{chat.timeline.operations.orphan={id:'orphan',kind:'variables.edit',status:'running',owner:'old-process',basedOn:{branchId:chat.timeline.branchId,revision:chat.timeline.revision}}})
  await h.service.recover('fixture')
  assert.equal((await h.db.read('fixture')).timeline.operations.orphan.status,'cancelled')
  assert.equal((await h.service.read(h.input)).writable.allowed,true)
  assert.equal(h.dispatches(),0)
})


test('a lost post-commit acknowledgement resolves the durable receipt without repeating delta',async t=>{
  const h=await widgetChatFixture(t)
  const service=createWidgetVariableService({...h.config,patch:async(...args)=>{const saved=await h.config.patch(...args);if(args[3]?.source==='variables.edit.commit')throw Error('lost acknowledgement');return saved}});t.after(()=>service.dispose())
  const projection=await service.read(h.input)
  const result=await service.propose({sessionId:'fixture',operationId:'lost-ack',contextKey:projection.contextKey,revision:projection.revision,operations:purchase})
  assert.equal(result.status,'committed')
  assert.equal((await service.status({...h.input,operationId:'lost-ack'})).status,'committed')
  assert.equal((await h.db.read('fixture')).messages[0].variables[0].stat_data.balance,15)
  assert.equal(h.dispatches(),1)
})


test('a same-position read already in flight cannot revoke an admitted operation',async t=>{
  let entered,finish;const waiting=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>finish=resolve)
  const h=await widgetChatFixture(t,{beforeExecute:async()=>{entered();await gate}})
  const request=h.propose();await waiting
  const refreshing=await h.service.read(h.input)
  assert.equal(refreshing.writable.allowed,false)
  finish();assert.equal((await request).status,'committed')
  assert.equal((await h.db.read('fixture')).messages[0].variables[0].stat_data.balance,15)
})
