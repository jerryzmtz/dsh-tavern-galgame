// private fork: count production work, not wall time; hooks only instrument this isolated test process.
import test from 'node:test'
import assert from 'node:assert/strict'
import {registerHooks} from 'node:module'
import {readFile} from 'node:fs/promises'
const counts = {envelopes:0,targets:0,stored:0}
const hookKey = Symbol.for('fork-send-observation-test')
globalThis[hookKey] = {hash(value) {
  if (value?.phase && Object.hasOwn(value,'displayUnits')) counts.envelopes++
  if (value?.binding && value?.baseline && value?.entries && value?.end) counts.stored++
},target() {counts.targets++}}
const hooks = registerHooks({load(url,context,next) {
  const result = next(url,context)
  if (url.endsWith('/stage-asset-pack-catalogue.js')) result.source = String(result.source).replace(
    "value => createHash('sha256').update(canonicalJson(value)).digest('hex')",
    "value => (globalThis[Symbol.for('fork-send-observation-test')].hash(value), createHash('sha256').update(canonicalJson(value)).digest('hex'))")
  if (url.endsWith('/stage-incremental.js')) result.source = String(result.source).replace(
    'export function captureStageTarget(chat, messageId, prefixDigest) {',
    "export function captureStageTarget(chat, messageId, prefixDigest) { globalThis[Symbol.for('fork-send-observation-test')].target();")
  return result
}})
const {createStageDirector} = await import('../tavern-plugin/lib/domain/stage-director.js')
const {captureStageTarget} = await import('../tavern-plugin/lib/domain/stage-incremental.js')
const {initialAssetPackStage} = await import('../tavern-plugin/lib/domain/stage-asset-pack-tools.js')
const {assetPackDigest} = await import('../tavern-plugin/lib/domain/stage-asset-pack-catalogue.js')
const {readStageProjection} = await import('../tavern-plugin/lib/domain/stage-projection.js')
const {fixture,answer} = await import('./helpers/stage-director-harness.mjs')
hooks.deregister()
function history(turns) {
  const chat = {id:'chat',sessionId:'session',cardPath:'card',mode:'story',_storageRevision:1,timeline:{branchId:'branch',revision:1},messages:[]}
  let previous = null
  for (let i=0;i<turns;i++) {
    const message = {role:'assistant',turn:i+1,text:'Text '+i+'\n\nSecond paragraph.'}
    chat.messages.push(message)
    const body = {binding:{target:{...captureStageTarget(chat,i),predecessorDigest:previous}},baseline:initialAssetPackStage({}),entries:[],end:initialAssetPackStage({})}
    message.stageDirectionAssetPacks = {format:'asset-packs-v1',complete:true,...body,diagnostics:[],digest:assetPackDigest(body)}
    previous = message.stageDirectionAssetPacks.digest
  }
  return chat
}
for (const turns of [40,129]) test(`${turns} turns: observation hashes no envelope or accepted stored record, captures target once`, async t => {
  const chat=history(turns), stored=JSON.stringify(chat.messages.map(m=>m.stageDirectionAssetPacks))
  let assetRevision=1, parts
  const director=createStageDirector({assets:{get revision(){return assetRevision},hasBindings:async()=>true,subscribe:()=>()=>{}},
    paragraphParts:async()=>parts,readChanges:async(_id,baseRevision)=>({baseRevision,revision:chat._storageRevision,indices:[]})})
  t.after(()=>director.dispose())
  const first=await director.get(chat,turns,null,{readOnly:true}), cold={...counts}
  for (const result of await Promise.all(Array.from({length:20},()=>director.get(chat,turns,null,{readOnly:true,sinceRevision:first.revision}))))
    assert.deepEqual(result,{unchanged:true,revision:first.revision})
  assert.equal(counts.targets,cold.targets)
  assert.equal(counts.stored,cold.stored)
  assert.equal(counts.envelopes,0)
  chat.timeline.revision++; chat._storageRevision++
  const header=await director.get(chat,turns,null,{readOnly:true,sinceRevision:first.revision})
  assert.equal(header.target.revision,chat.timeline.revision)
  assert.ok(header.revision>first.revision)
  assert.equal(counts.targets,cold.targets,'header changes do not recapture any historical target')
  assetRevision++
  const assets=await director.get(chat,turns,null,{readOnly:true,sinceRevision:header.revision})
  assert.ok(assets.revision>header.revision)
  parts=[{kind:'markdown',text:'Changed display.'}]
  const display=await director.get(chat,turns,null,{readOnly:true,sinceRevision:assets.revision})
  assert.ok(display.revision>assets.revision,'legacy display changes still revise the observation')
  assert.equal(JSON.stringify(chat.messages.map(m=>m.stageDirectionAssetPacks)),stored)
})
test('an undirected target is captured once per indexed source; edits, branches, sessions and errors remain observable',async t=>{
  const chat=history(1); delete chat.messages[0].stageDirectionAssetPacks
  const director=createStageDirector({assets:{revision:0,hasBindings:async()=>true,subscribe:()=>()=>{}},
    readChanges:async(_id,baseRevision)=>({baseRevision,revision:chat._storageRevision,indices:[0]})})
  t.after(()=>director.dispose())
  let value=await director.get(chat,1,null,{readOnly:true}), cold=counts.targets
  for(let i=0;i<20;i++) await director.get(chat,1,null,{readOnly:true,sinceRevision:value.revision})
  assert.equal(counts.targets,cold)
  for(const mutate of [()=>{chat.messages[0].text='Edited'},()=>{chat.timeline.branchId='fork'},()=>{chat.sessionId='other'},
    ()=>{chat.messages[0].stageDirectionGeneration=1},()=>{chat.messages[0].stageDirectionAssetPacksFailure={status:'error',sourceKey:value.target.sourceKey,error:'Failure'}}]) {
    mutate();chat._storageRevision++
    const next=await director.get(chat,1,null,{readOnly:true,sinceRevision:value.revision})
    assert.ok(next.revision>value.revision)
    assert.deepEqual(next.target,captureStageTarget(chat,0));value=next
  }
  assert.equal(value.phase,'error');assert.equal(value.error,'Failure')
})
test('persisted projection reads direction twice, not three times, and still rejects a mid-projection source change',async t=>{
  const f=await fixture(request=>request.onToolCall({name:'stage_update',arguments:answer}));t.after(()=>f.dispose())
  await f.director.get(f.read());await f.director.drain()
  let gets=0, playback, change=false
  const read=()=>f.director.get(f.read(),1,null,{readOnly:true})
  const direction=await read()
  const options={expectedDirectionToken:direction.token,readDirection:async()=>{gets++;const value=await read();return change&&gets>1?{...value,token:{...value.token,generation:10}}:value},
    readConsumer:()=>f.assets.consumer(f.read(),'http://localhost'),readSettings:f.engineSettings.read,revision:()=>f.assets.revision,at:1,
    readPlayback:async()=>playback,writePlayback:async(_direction,metadata)=>playback=metadata}
  assert.equal((await readStageProjection(options)).status,'ready')
  gets=0
  assert.equal((await readStageProjection(options)).status,'ready')
  assert.equal(gets,2)
  change=true;gets=0
  assert.equal((await readStageProjection(options)).status,'stale')
  assert.equal(gets,2)
})
test('production adapter wires the existing template owner',async()=>{
  const source=await readFile(new URL('../tavern-plugin/lib/index.js',import.meta.url),'utf8')
  assert.match(source,/createTavernScriptHostAdapter\(\{[\s\S]*?resolveTemplateChat: readStageChat\.template,/)
})
