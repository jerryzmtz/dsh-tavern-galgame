import test from 'node:test'
import assert from 'node:assert/strict'
import {workbenchFixture,requestFor} from './fixtures/workbench-features.mjs'

test('real tool handler reads, CAS patches a figure alias, and reads it back',async t=>{
  const f=await workbenchFixture();t.after(()=>f.close())
  const packId=f.pack.manifest.id,figureId=f.figureId
  const before=await f.invoke('assets_read',{action:'item',packId,kind:'figures',id:figureId})
  assert.equal(before.ok,true);assert.equal(before.data.items[0].name,'Canonical figure')
  const patch={action:'patch-figure',packId,figureId,expectedRevision:before.data.revision,patch:{aliases:['distinct alias']}}
  const written=await f.invoke('assets_patch',patch)
  assert.equal(written.ok,true,JSON.stringify(written))
  const after=await f.invoke('assets_read',{action:'item',packId,kind:'figures',id:figureId})
  assert.deepEqual(after.data.items[0].aliases,['distinct alias'])
  assert.notEqual(after.data.revision,before.data.revision)
  assert.equal((await f.invoke('assets_patch',patch)).error.code,'REVISION_CONFLICT')
  assert.equal((await f.invoke('stage_read',{action:'engine'})).data.revision,f.engine.read().revision)
})

test('tool syntax, card authority and secret boundaries fail before writes',async t=>{
  const f=await workbenchFixture();t.after(()=>f.close())
  const tool=f.tools.get('tavern_stage_patch'),input=requestFor('stage_patch',{action:'engine',expectedRevision:f.engine.read().revision,patch:{stageToggles:{music:false}}})
  input.request.unexpected=true
  const invalid=await tool.execute(input,f.exec)
  assert.equal(invalid.error.code,'INVALID_ARGS')
  assert.equal(invalid.error.path,'$.request.unexpected')
  assert.equal(invalid.error.example.request.operation.action,'engine')
  assert.equal((await f.invoke('stage_patch',{action:'engine',expectedRevision:f.engine.read().revision,patch:{apiKey:'secret-marker'}})).error.code,'CREDENTIALS_FORBIDDEN')
  f.chat.mode='story'
  assert.equal((await f.invoke('stage_read',{action:'engine'})).error.code,'CARD_MODE_REQUIRED')
  assert.equal(f.approvals.length,0)
  assert.equal(f.calls.filter(c=>c.method==='saveAssetEngineSettings').length,0)
})

test('voice engine-services shares the real engine owner and keeps stage writes out',async t=>{
  const f=await workbenchFixture();t.after(()=>f.close())
  const before=await f.invoke('voice_read',{action:'engine-services'})
  assert.equal(before.ok,true);assert.deepEqual(before.data.voiceServices,{})
  assert.equal(before.data.revision,f.engine.read().revision)
  assert.equal(Object.hasOwn(before.data,'values'),false)
  const input={action:'engine-services',expectedRevision:before.data.revision,voiceServices:{qwen:'voice-primary'}}
  assert.equal((await f.invoke('voice_patch',input)).error.code,'APPROVAL_REJECTED')
  assert.deepEqual(f.engine.read().values.voiceServices,{})
  f.setApproval('allowed-once')
  const oldValues=structuredClone(f.engine.read().values)
  const written=await f.invoke('voice_patch',input)
  assert.equal(written.ok,true,JSON.stringify(written))
  assert.match(f.approvals.at(-1).reason,/影响所有卡片/)
  assert.deepEqual(f.engine.read().values,{...oldValues,voiceServices:input.voiceServices})
  assert.deepEqual((await f.invoke('voice_read',{action:'engine-services'})).data,written.data)
  assert.equal((await f.invoke('voice_patch',input)).error.code,'REVISION_CONFLICT')
  const calls=f.calls.filter(c=>c.method==='saveAssetEngineSettings').length
  assert.equal((await f.invoke('stage_patch',{action:'engine',expectedRevision:written.data.revision,patch:{voiceServices:{}}})).error.code,'UNKNOWN_FIELD')
  assert.equal(f.calls.filter(c=>c.method==='saveAssetEngineSettings').length,calls)
})

test('mod pack scope accepts only global/off and never supplies card scope context',async t=>{
  const f=await workbenchFixture({rpc:async(method,args)=>method==='setModPackScope'?{scope:args.scope,revision:'next'}:undefined});t.after(()=>f.close())
  f.setApproval('allowed-once')
  for(const scope of ['global','off']) {
    const result=await f.invoke('mods_patch',{action:'pack-scope',modId:'dsh.phone',packId:'demo',expectedRevision:'current',scope})
    assert.equal(result.ok,true)
    assert.deepEqual(f.calls.at(-1),{method:'setModPackScope',args:{modId:'dsh.phone',packId:'demo',expectedRevision:'current',scope}})
    assert.match(f.approvals.at(-1).reason,/影响所有卡片/)
  }
  for(const action of ['scope','pack-scope']) {
    const args={action,modId:'dsh.phone',expectedRevision:'current',scope:'global',...(action==='pack-scope'?{packId:'demo'}:{})}
    const input=requestFor('mods_patch',args)
    const change=value=>{if(Object.hasOwn(value,'scope'))value.scope='card';if(value.operation)change(value.operation)}
    change(input.request)
    const count=f.calls.length
    assert.equal((await f.tools.get('tavern_mods_patch').execute(input,f.exec)).error.code,'INVALID_ARGS')
    assert.equal((await f.host.call('mods_patch',{...args,scope:'card'},f.exec)).error.code,'INVALID_INPUT')
    assert.equal(f.calls.length,count)
  }
})

test('prepare uses the application generation owner without issuing a paid request',async t=>{
  const f=await workbenchFixture();t.after(()=>f.close())
  const result=await f.invoke('asset_generation',{action:'prepare',target:{packId:f.pack.manifest.id,kind:'background'},expectedRevision:f.pack.revision,userPrompt:'Quiet library',count:2})
  assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.data.imageCount,2)
  assert.ok(result.data.planId);assert.equal(f.paidCalls,0);assert.equal(f.approvals.length,0)
  assert.ok(!JSON.stringify(result).includes('fixture-no-network'))
  assert.equal((await f.library.getPackSnapshot({packId:f.pack.manifest.id})).revision,f.pack.revision)
  assert.equal(f.tools.has('tavern_accept_asset'),false)
})
