// private fork: assert the model handle DTO, while saved state stays canonical.
import {modelArguments} from './helpers/director-model-call.mjs'
// private fork: verify native tool feedback repairs each window without leaking history across windows.
import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {join} from 'node:path'
import {createBackgroundAgentRunner} from '../tavern-plugin/lib/background-agent-runner.js'
import {createStreamingPackDirector} from '../tavern-plugin/lib/domain/stage-streaming-pack.js'
import {performanceFixture} from './helpers/performance-director-fixture.mjs'

// private fork: native adapters must also deliver recoverable zero-base args to the transaction.
for (const style of ['numbered','gemini-zero']) test('native streaming '+style+' windows preserve fixed prefix/schema and repair partial results in native tool history',{skip:!process.env.DSH_BOOT_MODULE,timeout:30000},async t=>{
  const bootUrl=pathToFileURL(process.env.DSH_BOOT_MODULE),{boot}=await import(bootUrl.href)
  const {LlmAdapter}=await import(new URL('../../dsh-llm/lib/index.js',bootUrl))
  const temp=fileURLToPath(new URL('../.tmp/',import.meta.url));await mkdir(temp,{recursive:true})
  const root=await mkdtemp(join(temp,'streaming-native-')),config=join(root,'host.yml')
  const packages=['dsh-system-prompt','dsh-tools','dsh-agent','dsh-llm','dsh-session','dsh-session-projection','dsh-session-persistence-jsonl','dsh-token-meter','dsh-agent-loop']
  await writeFile(config,packages.map(name=>'- id: '+name+'\n  name: '+new URL('../../'+name+'/lib/index.js',bootUrl).href+(name==='dsh-session-persistence-jsonl'?'\n  config:\n    root: '+join(root,'sessions')+'\n    compression: none':'')+'\n').join(''))
  const ctx=await boot('streaming-native-test',config);t.after(()=>ctx.fiber.dispose())
  const requests=[],windowAttempts=new Map()
  class Model extends LlmAdapter {
    async resolveModel(provider,model) {return {provider,id:model,name:model}}
    async *stream(input) {
      requests.push(structuredClone(input))
      const user=input.messages.find(message=>message.role==='user' && message.content.some(block=>block.type==='text' && block.text.startsWith('{')))
      const data=Object.assign({},...user.content.flatMap(block=>{try{return [JSON.parse(block.text)]}catch{return []}}))
      assert.equal(data.reply[0].at,data.first)
      const attempt=(windowAttempts.get(data.first)||0)+1;windowAttempts.set(data.first,attempt)
      if(attempt>1) assert.match(JSON.stringify(input.messages),/choices/,'native retry contains the per-op choices')
      const shift=style==='gemini-zero' && data.first===1 && attempt===1 ? 1:0
      const args={sequence:1,through:data.reply.at(-1).at-shift,done:true,beats:[{at:data.reply[0].at-shift,ops:[
        {op:'scene.set',background:{packId:'11111111-1111-4111-8111-111111111111',kind:'backgrounds',assetId:attempt<=5?'not-recalled':'classroom'},time:null},
        {op:'screen.play',effect:'flash'}]}]}
      const argumentsText=JSON.stringify(modelArguments(input,args)),id='window-'+requests.length
      yield {type:'block-start',index:0,blockType:'tool-call'}
      yield {type:'tool-call-delta',index:0,id,name:'stage_update',argumentsDelta:argumentsText}
      yield {type:'block-end',index:0,block:{type:'tool-call',id,name:'stage_update',arguments:argumentsText}}
      yield {type:'finish',reason:{kind:'tool-calls'}}
    }
  }
  ctx.llm.registerAdapter(['streaming-fixture'],new Model())
  const parent=await ctx.agents.create({sessionId:'streaming-parent',agentOptions:{provider:'streaming-fixture',model:'fixture'}});t.after(()=>parent.dispose())
  const runner=createBackgroundAgentRunner({agents:ctx.agents});t.after(()=>runner.dispose())
  const fixture=await performanceFixture(),input={...fixture.input,engine:{directorModel:{provider:'streaming-fixture',model:'fixture'}}}
  const pack=createStreamingPackDirector({input,identity:{bodyOperationId:'test-body'},current:()=>true,
    runAgent:request=>runner.run({...request,sessionId:'streaming-parent'})})
  pack.kernel.update(input.units);await pack.kernel.drain()
  assert.equal(pack.kernel.snapshot().phase,'streaming',JSON.stringify(pack.kernel.snapshot().failure))
  assert.equal(requests.length,6,'five correction rounds are allowed before success')
  pack.kernel.commit(input.units);await pack.kernel.drain()
  assert.equal(pack.kernel.snapshot().phase,'settled',JSON.stringify(pack.kernel.snapshot().failure))
  assert.equal(requests.length,12)
  assert.equal(pack.kernel.snapshot().entries.length,2)
  assert.equal(pack.kernel.snapshot().diagnostics.some(item=>item.dropped),false)
  assert.equal(pack.kernel.snapshot().entries.flatMap(entry=>entry.ops).filter(op=>op.op==='screen.play').length,2,'accepted flashes are not replayed by retries')
  assert.equal(pack.kernel.snapshot().diagnostics.some(item=>item.code==='INDEX_NORMALIZED'),style==='gemini-zero')
  // Native node UUIDs are journal metadata, not model prompt text.
  const system=request=>JSON.stringify(request.messages.filter(message=>message.role==='system').map(({role,content})=>({role,content})))
  for(const request of requests) {
    assert.equal(system(request),system(requests[0]))
    assert.deepEqual(request.tools,requests[0].tools)
  }
  assert.ok([requests[0],requests[6]].every(request=>request.messages.every(message=>message.role!=='assistant' && message.role!=='tool')),'a new window never inherits previous tool history')
  assert.ok([requests[5],requests[11]].every(request=>request.messages.flatMap(message=>message.content||[]).some(block=>block.type==='tool-result')),'correction rounds receive real tool feedback')
})
