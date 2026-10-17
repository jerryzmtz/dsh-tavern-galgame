import test from 'node:test'
import assert from 'node:assert/strict'
import {workbenchFixture} from './fixtures/workbench-features.mjs'
import {createReadingPresetStore} from '../tavern-plugin/packages/dsh-tts/src/reading-presets.js'

test('reading creation preserves active rules; activating requires separate global approval',async t=>{
  const store=createReadingPresetStore()
  await store.edit({id:'default',expectedRevision:0,op:'add',entry:{forms:'Alice',reading:'Alis'}})
  const before=await store.activeEntries()
  const f=await workbenchFixture({tts:{call:(method,args)=>store[({createReadingPreset:'create',setActiveReadingPreset:'setActive'})[method]](args)}})
  t.after(()=>f.close())
  f.setApproval('allowed-once')
  const created=await f.invoke('voice_patch',{action:'reading-create',name:'Spare'})
  assert.equal(created.ok,true)
  assert.equal(created.data.active,'default')
  assert.deepEqual(await store.activeEntries(),before)
  f.setApproval('rejected')
  const denied=await f.invoke('voice_patch',{action:'reading-active',id:created.data.id})
  assert.equal(denied.error.code,'APPROVAL_REJECTED')
  assert.equal((await store.list()).active,'default')
  f.setApproval('allowed-once')
  assert.equal((await f.invoke('voice_patch',{action:'reading-active',id:created.data.id})).ok,true)
  assert.equal((await store.list()).active,created.data.id)
  assert.deepEqual(await store.activeEntries(),[])
  assert.equal(f.approvals.length,3)
})

test('global writes fail closed and approval never replaces owner CAS',async t=>{
  const f=await workbenchFixture();t.after(()=>f.close())
  const before=f.engine.read(),input={action:'engine',expectedRevision:before.revision,patch:{stageToggles:{music:false}}}
  assert.equal((await f.invoke('stage_patch',input)).error.code,'APPROVAL_REJECTED')
  assert.equal(f.engine.read().revision,before.revision)
  assert.match(f.approvals[0].reason,/影响所有卡片/)
  assert.equal(f.calls.filter(c=>c.method==='saveAssetEngineSettings').length,0)
  f.setApproval('allowed-once',async()=>f.engine.save({expectedRevision:before.revision,patch:{stageToggles:{voice:false}}}))
  assert.equal((await f.invoke('stage_patch',input)).error.code,'REVISION_CONFLICT')
  f.setApproval('allowed-once')
  const changed=await f.invoke('stage_patch',{...input,expectedRevision:f.engine.read().revision})
  assert.equal(changed.ok,true);assert.equal(f.engine.read().values.stageToggles.music,false)
  assert.equal(f.approvals.length,3)
})

test('no approval channel cannot authorize a global write',async t=>{
  const f=await workbenchFixture({noApproval:true});t.after(()=>f.close())
  assert.equal((await f.invoke('stage_patch',{action:'engine',expectedRevision:f.engine.read().revision,patch:{stageToggles:{stage:false}}})).error.code,'APPROVAL_REQUIRED')
  assert.equal(f.calls.filter(c=>c.method==='saveAssetEngineSettings').length,0)
})

test('paid generation approval displays frozen count and cost risk, rejected calls do not generate',async t=>{
  const f=await workbenchFixture();t.after(()=>f.close())
  const plan=(await f.invoke('asset_generation',{action:'prepare',target:{packId:f.pack.manifest.id,kind:'background'},expectedRevision:f.pack.revision,userPrompt:'Garden',count:3})).data
  const result=await f.invoke('asset_generation',{action:'generate',planId:plan.planId,consentToken:plan.consentToken})
  assert.equal(result.error.code,'APPROVAL_REJECTED')
  assert.match(f.approvals[0].reason,/3 张 = 3 个单图请求/);assert.match(f.approvals[0].reason,/不保证免费/)
  assert.equal(f.calls.filter(c=>c.method==='generateAssetCandidate').length,0)
  assert.equal(f.paidCalls,0)
  const other={...f.exec,agent:{session:{...f.exec.agent.session,id:'other'}}}
  assert.equal((await f.invoke('asset_generation',{action:'generate',planId:plan.planId,consentToken:plan.consentToken},other)).error.code,'EXPIRED')
})

test('real approval policy never auto-rejects without answerer; ask waits, rejects, then allows one write',async t=>{
  const {ApprovalService}=await import(new URL('../../dsh-user-approval/lib/index.js',import.meta.resolve('@deepseek-ai/dsh-tools')))
  let answer,asked,answererCalls=0
  const service=Object.create(ApprovalService.prototype)
  Object.defineProperty(service,'ctx',{value:{waterfall:async()=>{answererCalls++;asked();return new Promise(resolve=>{answer=resolve})}}})
  service.config={policy:'never'}
  const f=await workbenchFixture({approval:service});t.after(()=>f.close())
  const events=[{type:'turn/start',data:{}}],session=f.exec.agent.session
  Object.defineProperty(session,'seq',{get:()=>events.length})
  session.eventAt=index=>events[index]
  session.append=(type,data)=>events.push({type,data})
  const input={action:'engine',expectedRevision:f.engine.read().revision,patch:{stageToggles:{music:false}}}
  const policy=await f.invoke('stage_patch',input)
  assert.equal(policy.error.reason,'policy-rejected')
  assert.match(policy.error.message,/策略自动拒绝/)
  assert.equal(answererCalls,0)
  assert.equal(events.at(-1).data.outcome,'rejected')
  service.config.policy='ask'
  for(const outcome of ['rejected','allowed-once']) {
    const waiting=new Promise(resolve=>{asked=resolve})
    const pending=f.invoke('stage_patch',input)
    await waiting
    assert.match(events.at(-1).data.reason,/等待用户批准/)
    assert.equal(f.calls.filter(c=>c.method==='saveAssetEngineSettings').length,0)
    answer(outcome)
    const result=await pending
    if(outcome==='rejected') {
      assert.equal(result.error.reason,'user-rejected')
      assert.equal(result.error.message,'用户拒绝，未更改。')
      assert.equal(f.engine.read().values.stageToggles.music,true)
    } else assert.equal(result.ok,true)
  }
  assert.equal(f.engine.read().values.stageToggles.music,false)
  assert.equal(f.calls.filter(c=>c.method==='saveAssetEngineSettings').length,1)
})