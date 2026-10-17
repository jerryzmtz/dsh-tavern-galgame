// private fork: tagged English defaults; retain protocol, payload, cache and budget assertions.
// private fork: exercise the RPC handler against the real director/coordinator, without paid calls.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { fixture, answer } from './helpers/stage-director-harness.mjs'
const source = await readFile(new URL('../tavern-plugin/lib/index.js', import.meta.url), 'utf8')
const block = source.slice(source.indexOf("case 'retryStageDirection': {") + "case 'retryStageDirection': ".length, source.indexOf("case 'getLive2dRuntime':")).trim()

test('upstream MVU retry accepts successful settlement with its baseline and rejects unsafe old records', async () => {
  const chat = {id:'c',sessionId:'s',mvu:{enabled:true,owner:'official'},messages:[{role:'assistant',turn:7,text:'Unchanged body',swipeId:0,
    mvu:{receipt:{status:'updated'}},mvuBaseline:{swipeId:0,variables:{hp:10}}}]}
  const patches = [], queued = []
  const ctx = vm.createContext({
    readOpeningWindow:async () => null, chatForSession:async () => chat,
    backgroundTasks:{activity:() => ({busy:false,phase:'idle'})},storyTimeline:{inspect:() => ({operations:{}})},
    patchChat:async (_id,_rev,patch) => {patches.push(patch); return {_storageRevision:2,updatedAt:1}},
    queueSettlement:async id => queued.push(id),readChatCard:async () => ({}),view:async value => value,str:value => String(value || ''),console
  })
  const start = source.indexOf('  async function retrySettlement(sessionId, turn, guidance)')
  vm.runInContext(source.slice(start, source.indexOf('  async function pullBackgroundCycle(', start)) + ';this.retry = retrySettlement', ctx)
  await ctx.retry('s',7,'  Restore HP.  ')
  assert.equal(chat.messages[0].text,'Unchanged body')
  assert.equal(chat.messages[0].mvu.variableRetry,true)
  assert.equal(chat.messages[0].mvu.guidance,'Restore HP.')
  assert.equal(patches[0][0].path.join('.'),'messages.0.mvu')
  assert.deepEqual(queued,['c'])
  delete chat.messages[0].mvuBaseline
  chat.messages[0].mvu = {receipt:{status:'updated'}}
  await assert.rejects(ctx.retry('s',7,'Retry.'), /没有结算前快照/)
  assert.equal(queued.length,1)
})

test('retryStageDirection replaces a successful record, observes the new generation, and does not retain guidance', async t => {
  const f = await fixture(request => request.onToolCall({name:'stage_update',arguments:answer}))
  t.after(() => f.dispose())
  await f.director.get(f.read()); await f.director.drain()
  assert.equal((await f.director.get(f.read(),1,null,{readOnly:true})).status, 'done')
  const events = []
  f.director.subscribe(event => events.push(event))
  const ctx = vm.createContext({stageDirector:f.director, chatForSession:async () => f.read(), dialogueBubbles:{read:async () => ({})}, str:value => String(value || '')})
  vm.runInContext('this.invoke = async function(args) ' + block, ctx)
  const result = await ctx.invoke({sessionId:'session',turn:1,guidance:'  Quiet stage.  '})
  assert.equal(result.ok, true)
  assert.equal(result.generation, 1)
  await f.director.drain()
  const observed = await f.director.get(f.read(),1,null,{readOnly:true})
  assert.equal(observed.status, 'done')
  assert.equal(observed.generation, 1)
  assert.ok(events.length > 0)
  assert.match(JSON.stringify(f.calls[1].messages), /Requests for this run only:\\nQuiet stage\./)
  assert.deepEqual(f.calls[1].tools, f.calls[0].tools)
  assert.doesNotMatch(JSON.stringify(f.read()), /Quiet stage/)
  assert.doesNotMatch(JSON.stringify(await f.director.preview(f.read(),1)), /Quiet stage/)
  await ctx.invoke({sessionId:'session',turn:1,guidance:''}); await f.director.drain()
  assert.equal(f.calls.length, 3)
  assert.doesNotMatch(JSON.stringify(f.calls[2].messages), /Quiet stage|本次临时要求/)
})
