import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createChatJournalStore } from '../tavern-plugin/lib/domain/chat-journal-store.js'
import { createChatPersistence } from '../tavern-plugin/lib/domain/chat-persistence.js'
import { createStoryTimeline } from '../tavern-plugin/lib/domain/story-timeline.js'
import { createBackgroundTaskCoordinator } from '../tavern-plugin/lib/domain/background-task-coordinator.js'
import { createTavernScriptDispatch } from '../tavern-plugin/lib/domain/tavern-script-dispatch.js'
import { createMvuSettlementReconciler } from '../tavern-plugin/lib/domain/mvu-settlement-reconciler.js'
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}}

for (const cancelled of [false,true]) test(`claim timeout + stale read wake race: ${cancelled?'stopped task stays stopped':'pending resumes and commits once'}`,async t=>{
  const root=await mkdtemp(join(tmpdir(),'issue89-'))
  t.after(()=>rm(root,{recursive:true,force:true}))
  const persistence=createChatPersistence({store:createChatJournalStore({dataRoot:root})})
  await persistence.write({id:'c',sessionId:'s',mode:'story',messages:[{role:'assistant',turn:1,variables:[{stat_data:{time:'old'}}],mvu:{pending:true}}],
    timeline:{schemaVersion:1,branchId:'b',revision:1,participants:{},checkpoints:[],operations:{
      body:{id:'body',kind:'body',status:'completed',basedOn:{branchId:'b',revision:1},committedRevision:1,completedAt:1,background:{phase:'pending',role:'settlement'}}}}})
  const coordinator=createBackgroundTaskCoordinator({timeline:createStoryTimeline(),store:{readChat:persistence.read,writeChat:persistence.write,updateChat:persistence.update}})
  const dispatch=createTavernScriptDispatch({claimTimeoutMs:100})
  t.after(()=>dispatch.dispose('s'))
  dispatch.touch('s','browser',true)
  const task=await coordinator.begin(await persistence.read('c'),'settlement')
  await task.checkpoint(draft=>{
    draft.messages[0].mvu.pendingSubmission={operations:[{op:'replace',path:'/stat_data/time',value:'new'}]}
  })
  const timedOut=await dispatch.dispatch('s','MESSAGE_RECEIVED',[0])
  assert.equal(timedOut.claimTimedOut,true)
  const staleRead=deferred(),releaseRead=deferred(),scheduled=[]
  let first=true, executions=0
  const reconciler=createMvuSettlementReconciler({list:async()=>[{sessionId:'s'}],
    resolve:async()=>{
      const chat=await persistence.read('c')
      if(first){first=false;staleRead.resolve();await releaseRead.promise}
      return chat
    },
    shouldResume:chat=>Boolean(chat.messages[0].mvu.pending && chat.messages[0].mvu.pendingSubmission && coordinator.activity(chat).phase==='pending'),
    isReady:()=>dispatch.status('s').ready,
    resume:async()=>{
      const resumed=await coordinator.begin(await persistence.read('c'),'settlement')
      const work=dispatch.dispatch('s','MESSAGE_RECEIVED',[0])
      const offer=dispatch.claim('s','browser',true)
      assert.ok(offer.event)
      assert.equal(dispatch.start('s',offer.event.id,offer.leaseToken,'browser').started,true)
      executions++
      assert.equal(dispatch.complete('s',offer.event.id,offer.event.args,'browser',offer.leaseToken),true)
      assert.equal((await work).handled,true)
      // Browser execution is simulated; persistence and timeline commit are real.
      await resumed.commit({status:'success',stateChanged:true,apply(draft){
        const message=draft.messages[0]
        message.variables[0].stat_data.time=message.mvu.pendingSubmission.operations[0].value
        message.mvu.pending=false;delete message.mvu.pendingSubmission
        message.mvu.receipt={status:'updated'}
      }})
    },schedule:fn=>{scheduled.push(fn);return scheduled.length},cancel(){}})
  t.after(()=>reconciler.dispose())
  dispatch.subscribeSettled(id=>{void reconciler.wake(id)})
  const check=reconciler.wake('s')
  await staleRead.promise
  await task.defer({apply(draft){draft.messages[0].mvu.receipt={status:'pending',deferredReason:'claim-timeout'}}})
  dispatch.touch('s','browser',true)
  void reconciler.wake('s') // queueSettlement finally notification
  if(cancelled) {
    const current=await persistence.read('c')
    await coordinator.recover(current,{operationId:coordinator.activity(current).operationId})
  }
  releaseRead.resolve()
  await check
  assert.equal(scheduled.length,1)
  await scheduled.shift()()
  // Completion signals can request one final recheck, never another execution.
  if(scheduled.length) await scheduled.shift()()
  assert.equal(executions,cancelled?0:1)
  assert.equal(scheduled.length,0)
  const disk=createChatPersistence({store:createChatJournalStore({dataRoot:root})})
  assert.equal((await disk.read('c')).messages[0].variables[0].stat_data.time,cancelled?'old':'new')
  if(!cancelled) assert.equal((await disk.read('c')).messages[0].mvu.pendingSubmission,undefined)
})
