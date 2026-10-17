// private fork: template reads reuse only the shared committed Chat owner.
import test from 'node:test'
import assert from 'node:assert/strict'
import {createStageChatCache} from '../tavern-plugin/lib/domain/stage-chat-cache.js'
import {projectTavernHelperContext} from '../tavern-plugin/lib/domain/tavern-helper-context.js'
import {projectFullPromptTemplateState} from '../tavern-plugin/lib/domain/full-prompt-template-state.js'
import {createTavernScriptHostAdapter} from '../tavern-plugin/lib/domain/tavern-script-host-adapter.js'

function fixture(turns, limits = {}) {
  const chat = {id:'chat', sessionId:'session', mode:'story', _storageRevision:1, tavernHelperLifecycleRevision:1,
    variables:{shared:1}, messages:Array.from({length:turns}, (_,i) => ({role:'assistant',turn:i+1,text:'Turn '+(i+1),variables:[{hp:i}],tavernPluginData:{template_display:{text:'display'}}}))}
  let dirty = [], full = 0, calls = 0, projected = 0, fail = false, coverage = true
  const read = createStageChatCache({
    readHeader:async () => ({id:chat.id,sessionId:chat.sessionId,_storageRevision:chat._storageRevision}),
    readChat:async () => {full++;return structuredClone(chat)},
    readChanges:async (_id, baseRevision) => {
      if (fail) throw Error('failed read')
      return coverage ? {baseRevision,chat:{...structuredClone(chat),messages:dirty.map(i=>structuredClone(chat.messages[i]))},indices:dirty,messageCount:chat.messages.length,denseMessages:true} : undefined
    },
    projectHelper:(value, options) => {
      calls++
      const context = projectTavernHelperContext(value, options)
      projected += context.messages.filter((row, i) => row !== options.previousMessages?.[i]).length
      return context
    }, ...limits,
  })
  const adapter = createTavernScriptHostAdapter({resolveChat:async()=>structuredClone(chat),resolveTemplateChat:read.template,
    writeChat:async()=>{},readCard:async()=>({name:'Character'}),worldBooks:{bound:async()=>null},scriptDispatch:{}})
  return {chat,read,adapter,change(indices, mutate) {mutate?.(chat);dirty=indices;chat._storageRevision++},
    counts:()=>({full,calls,projected}),fail(value){fail=value},coverage(value){coverage=value}}
}

for (const turns of [40,129]) test(`${turns} turns: template cold/warm/append counts, byte parity and script isolation`, async () => {
  const f = fixture(turns), {chat, read, adapter} = f
  const first = await read.template('session')
  const expected = JSON.stringify(projectFullPromptTemplateState(chat))
  const replies = await Promise.all(Array.from({length:20},()=>adapter.readFullPromptTemplateState('session')))
  assert.deepEqual(f.counts(),{full:1,calls:1,projected:turns})
  for (const reply of replies) assert.equal(JSON.stringify(reply.state),expected)
  replies[0].state.chat[0].variables[0].hp = -1
  replies[0].state.chat[0].swipes.push('tamper')
  replies[0].state.chat[0].template_display.text = 'tamper'
  replies[0].state.chat_metadata.variables.shared = -1
  assert.equal(JSON.stringify((await adapter.readFullPromptTemplateState('session')).state),expected)
  f.change([turns], chat=>chat.messages.push({role:'user',text:'next',variables:[{hp:9}]}))
  await Promise.all(Array.from({length:20},()=>adapter.readFullPromptTemplateState('session')))
  assert.deepEqual(f.counts(),{full:1,calls:2,projected:turns+1})
  const appended = await read.template('session')
  assert.strictEqual(appended.helper.messages[0],first.helper.messages[0])
  assert.equal(JSON.stringify(projectFullPromptTemplateState(appended.chat,appended.helper)),JSON.stringify(projectFullPromptTemplateState(chat)))
  f.change([],chat=>{chat.variables.shared=2})
  const header = await read.template('session')
  assert.deepEqual(f.counts(),{full:1,calls:3,projected:turns+1})
  assert.strictEqual(header.helper.messages[0],first.helper.messages[0])
  assert.equal(header.helper.chatVariables.shared,2)
})

test('non-append edits, truncation, lifecycle and session changes rebuild template history', async () => {
  const f=fixture(4)
  await f.read.template('session')
  f.change([1],chat=>{chat.messages[1].text='edited';chat.messages[1].variables[0].hp=99})
  await f.read.template('session')
  assert.equal(f.counts().projected,8)
  f.change([],chat=>{chat.messages.length=2})
  let value=await f.read.template('session')
  assert.equal(f.counts().projected,10)
  f.change([],chat=>{chat.tavernHelperLifecycleRevision++})
  value=await f.read.template('session')
  assert.equal(f.counts().projected,12)
  f.change([],chat=>{chat.sessionId='other'})
  value=await f.read.template('other')
  assert.equal(f.counts().full,2)
  assert.equal(f.counts().projected,14)
  assert.equal(JSON.stringify(projectFullPromptTemplateState(value.chat,value.helper)),JSON.stringify(projectFullPromptTemplateState(f.chat)))
})

test('pending template input remains an uncached overlay, including same-revision drafts', async () => {
  const f=fixture(4), value=await f.read.template('session')
  const draft={...value.chat,promptTemplateInput:{message:{role:'user',text:'input',variables:[{hp:7}]}}}
  let state=projectFullPromptTemplateState(draft,value.helper)
  assert.equal(state.chat.length,5)
  assert.equal(state.chat[4].variables[0].hp,7)
  draft.promptTemplateInput.message.variables[0].hp=8
  state=projectFullPromptTemplateState(draft,value.helper)
  assert.equal(state.chat[4].variables[0].hp,8)
  assert.equal(value.helper.messages.length,4)
  assert.equal(JSON.stringify(state),JSON.stringify(projectFullPromptTemplateState(draft)))
  const mutable=structuredClone(f.chat)
  projectFullPromptTemplateState(mutable)
  mutable.messages[0].variables[0].hp=123
  assert.equal(projectFullPromptTemplateState(mutable).chat[0].variables[0].hp,123)
})

test('missed revisions, journal coverage, failures and bounded eviction do not retain stale Helper state', async () => {
  const f=fixture(4)
  const original=await f.read.template('session')
  f.change([4],chat=>chat.messages.push({role:'user',text:'append'}))
  await f.read('session') // A stage read advances the owner before a template read.
  f.change([],chat=>{chat.variables.shared=9})
  const next=await f.read.template('session')
  assert.strictEqual(next.helper.messages[0],original.helper.messages[0])
  assert.equal(next.helper.messages.length,5)
  assert.equal(f.counts().projected,5)
  f.change([],chat=>{chat.variables.shared=10});f.fail(true)
  await assert.rejects(f.read.template('session'),/failed read/)
  f.fail(false)
  assert.equal((await f.read.template('session')).helper.chatVariables.shared,10)
  f.coverage(false);f.change([],chat=>{chat.messages[0].text='unknown change'})
  assert.equal((await f.read.template('session')).helper.messages[0].message,'unknown change')
  assert.equal(f.counts().projected,10)
  const bounded=fixture(4,{maxBytes:1})
  await bounded.read.template('session');await bounded.read.template('session')
  assert.deepEqual(bounded.counts(),{full:2,calls:2,projected:8})
})
