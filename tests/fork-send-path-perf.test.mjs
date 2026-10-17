// private fork: call-count gates, not machine-dependent latency budgets.
import test from 'node:test'
import assert from 'node:assert/strict'
import {createStageHistoryCache} from '../tavern-plugin/lib/domain/stage-history-cache.js'
import {createStageChatCache} from '../tavern-plugin/lib/domain/stage-chat-cache.js'
import {captureStageTarget} from '../tavern-plugin/lib/domain/stage-incremental.js'
import {initialAssetPackStage} from '../tavern-plugin/lib/domain/stage-asset-pack-tools.js'
import {readAssetPackRecord} from '../tavern-plugin/lib/domain/stage-asset-pack-director.js'
import {assetPackDigest} from '../tavern-plugin/lib/domain/stage-asset-pack-catalogue.js'
import {createIncrementalReplyView} from '../tavern-plugin/lib/domain/incremental-reply-view.js'

function append(chat) {
  const turn = chat.messages.length + 1
  const message = {role:'assistant',turn,text:'Turn '+turn+'\n\nStill here.'}
  chat.messages.push(message)
  const target = {...captureStageTarget(chat,turn-1),predecessorDigest:chat.messages.at(-2)?.stageDirectionAssetPacks.digest || null}
  const state = initialAssetPackStage({}), body = {binding:{target},baseline:state,entries:[],end:state}
  message.stageDirectionAssetPacks = {format:'asset-packs-v1',complete:true,...body,diagnostics:[],digest:assetPackDigest(body)}
  return message
}
function fixture(turns) {
  const chat = {id:'chat',sessionId:'session',_storageRevision:1,timeline:{branchId:'branch',revision:1},messages:[]}
  for (let i=0;i<turns;i++) append(chat)
  return chat
}

for (const turns of [40,129]) test(`${turns} turns: one read per revision, append validates only the new record`, async () => {
  const chat = fixture(turns), counts = {validations:0,targets:0,changes:0}
  let indices = []
  const cache = createStageHistoryCache({onValidate:()=>counts.validations++,onTarget:()=>counts.targets++,
    readChanges:async (_id,revision) => {counts.changes++;return {baseRevision:revision,revision:chat._storageRevision,indices}}})
  const cold = await cache.read(chat)
  assert.deepEqual(cold.at(-2),{current:null,previous:null,records:[]})
  assert.equal(cold.at(turns).current,null)
  assert.equal(cold.at(turns).previous.digest,chat.messages.at(-1).stageDirectionAssetPacks.digest)
  assert.equal(counts.validations,turns)
  for (let i=0;i<turns;i++) assert.deepEqual(cold.rows[i].target,captureStageTarget(chat,i))
  await Promise.all(Array.from({length:20},()=>cache.read(structuredClone(chat))))
  assert.deepEqual(counts,{validations:turns,targets:turns,changes:0})
  append(chat); chat._storageRevision++; indices = [turns]
  const warm = await Promise.all(Array.from({length:20},()=>cache.read(structuredClone(chat))))
  assert.ok(warm.every(value=>value===warm[0]))
  assert.deepEqual(counts,{validations:turns+1,targets:turns+1,changes:1})
  assert.equal(warm[0].at(turns).records.length,turns+1)
  assert.strictEqual(warm[0].rows[0].checked,cold.rows[0].checked)
  chat._storageRevision++; indices = []
  await cache.read(chat)
  assert.deepEqual(counts,{validations:turns+1,targets:turns+1,changes:2})
})

test('edits, regeneration, truncation and branch changes invalidate admission without rewriting history', async () => {
  const chat = fixture(4), original = structuredClone(chat), cache = createStageHistoryCache({readChanges:async (_id,baseRevision)=>({baseRevision,revision:chat._storageRevision,indices:dirty})})
  let dirty = []
  await cache.read(chat)
  chat.messages[1].text = 'edited'; chat._storageRevision++; dirty = [1]
  let value = await cache.read(chat)
  assert.deepEqual(value.at(3).records.map(record=>record.binding.target.turn),[1])
  assert.deepEqual(chat.messages.map(message=>message.stageDirectionAssetPacks),original.messages.map(message=>message.stageDirectionAssetPacks))
  chat.messages = structuredClone(original.messages); chat._storageRevision++; dirty = [1]
  assert.equal((await cache.read(chat)).at(3).records.length,4)
  delete chat.messages[1].stageDirectionAssetPacks; chat._storageRevision++; dirty = [1]
  assert.equal((await cache.read(chat)).at(3).records.length,1)
  chat.messages.length = 1; chat._storageRevision++; dirty = []
  assert.equal((await cache.read(chat)).rows.length,1)
  chat.timeline.branchId = 'new'; chat._storageRevision++
  assert.equal((await cache.read(chat)).at(0).records[0].digest,original.messages[0].stageDirectionAssetPacks.digest)
})

test('cache does not trust a client digest, failed reads retry, checked records are immutable', async () => {
  const chat = fixture(2), cache = createStageHistoryCache({readChanges:async (_id,baseRevision)=>({baseRevision,revision:chat._storageRevision,indices:[1]})})
  const first = await cache.read(chat), checked = first.at(1).current
  assert.strictEqual(readAssetPackRecord(checked,{shared:true}),checked)
  assert.throws(()=>{checked.end.cast.push('tamper')},TypeError)
  const detached = readAssetPackRecord(checked); detached.diagnostics.push('private')
  assert.deepEqual(checked.diagnostics,[])
  const saved = structuredClone(chat.messages[1].stageDirectionAssetPacks)
  // private fork: stored digests are identities and are not re-hashed on read; a structurally broken record still fails.
  chat.messages[1].stageDirectionAssetPacks.entries = 'broken'; chat._storageRevision++
  assert.equal((await cache.read(chat,0)).at(0).current.digest,first.at(0).current.digest,'a broken later record cannot break earlier history')
  await assert.rejects(cache.read(chat),/Invalid asset-pack field/)
  chat.messages[1].stageDirectionAssetPacks = saved
  assert.equal((await cache.read(chat)).at(1).current.digest,saved.digest)
})

test('missing journal coverage, changed session and cache eviction rebuild safely', async () => {
  const chat = fixture(3); let validations = 0
  const cache = createStageHistoryCache({maxEntries:1,onValidate:()=>validations++})
  await cache.read(chat); chat._storageRevision++; await cache.read(chat)
  assert.equal(validations,6)
  const other = fixture(1); other.id = 'other'
  await cache.read(other); await cache.read(chat)
  assert.equal(validations,10)
  const moved = structuredClone(chat); moved.sessionId = 'other-session'
  assert.equal((await cache.read(moved)).at(2).records.length,0)
})

test('history projection shares concurrent revision reads and only projects appended rows', async () => {
  const chat = fixture(129); let changes = 0
  const projector = createIncrementalReplyView({readChanges:async (_id,baseRevision)=>{
    changes++; await new Promise(resolve=>setImmediate(resolve))
    return {baseRevision,chat,messageCount:chat.messages.length,denseMessages:true,indices:[129]}
  }})
  const first = await projector.project(chat,{}, {},{shared:true}), before = JSON.stringify(first)
  append(chat); chat._storageRevision++
  const results = await Promise.all(Array.from({length:20},()=>projector.project(chat,{}, {},{shared:true})))
  assert.equal(changes,1)
  assert.equal(projector.stats().projectedMessages,130)
  assert.equal(projector.stats().rebuilt,1)
  assert.equal(projector.stats().incremental,1)
  assert.equal(JSON.stringify(first),before)
  for (const result of results) assert.deepEqual(result,results[0])
  const reference = await createIncrementalReplyView().project({...chat,_storageRevision:undefined},{},{},{shared:true})
  assert.equal(JSON.stringify(results[0]),JSON.stringify(reference))
})

for (const turns of [40,129]) test(turns+' turns: stage reads detach once and share only immutable snapshots', async () => {
  let chat = fixture(turns), dirty = [], fail = false, full = 0, deltas = 0
  const read = createStageChatCache({
    readHeader:async () => ({id:chat.id,sessionId:chat.sessionId,_storageRevision:chat._storageRevision}),
    readChat:async () => {full++;return structuredClone(chat)},
    readChanges:async (_id,baseRevision) => {
      deltas++; await new Promise(resolve=>setImmediate(resolve))
      if (fail) throw Error('read failed')
      return {baseRevision,chat:{...structuredClone(chat),messages:dirty.map(i=>structuredClone(chat.messages[i]))},indices:dirty,messageCount:chat.messages.length,denseMessages:true}
    }
  })
  const first = await read('session')
  assert.equal(full,1)
  assert.notStrictEqual(first.messages[0],chat.messages[0])
  assert.throws(()=>{first.messages[0].text='tampered'},TypeError)
  for (const value of await Promise.all(Array.from({length:20},()=>read('session')))) assert.strictEqual(value,first)
  append(chat); dirty=[turns]; chat._storageRevision++
  const values = await Promise.all(Array.from({length:20},()=>read('session')))
  assert.equal(full,1); assert.equal(deltas,1)
  assert.strictEqual(values[0].messages[0],first.messages[0])
  assert.deepEqual(values[0],chat)
  chat.messages[0].text='edit'; dirty=[0]; chat._storageRevision++
  assert.deepEqual(await read('session'),chat)
  chat.messages.length=1; dirty=[]; chat._storageRevision++
  assert.deepEqual(await read('session'),chat)
  chat._storageRevision++; fail=true
  await assert.rejects(read('session'),/read failed/)
  fail=false
  assert.deepEqual(await read('session'),chat)
  assert.equal(full,1)
})
