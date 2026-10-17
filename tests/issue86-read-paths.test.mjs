import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { createSessionViewReader } from '../tavern-plugin/lib/domain/session-view-reader.js'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createChatJournalStore } from '../tavern-plugin/lib/domain/chat-journal-store.js'
import { createChatPersistence } from '../tavern-plugin/lib/domain/chat-persistence.js'
import { createStoryTimeline } from '../tavern-plugin/lib/domain/story-timeline.js'

test('production view reader cache hit reads state once without a full chat read', async () => {
  const chat={id:'c',sessionId:'s',mode:'story',cardPath:'card',_storageRevision:5,messages:[]}
  let stateReads=0,fullReads=0
  const sync=(_id,view,_cursor,options)=>({view,revision:options.revision})
  sync.peek=()=>({sessionId:'s',revision:5})
  const reader=createSessionViewReader({
    readState:async()=>{stateReads++;return chat},readChat:async()=>{fullReads++;return chat},
    readChanges:async()=>{throw Error('unexpected changed query')},
    project:{full:async()=>({chatId:'c'}),cached:async(_chat,previous)=>previous},
    activity:()=>({busy:false}),trace:{stage:(_name,fn)=>fn(),state(){}},foregroundRunning:()=>false,synchronize:sync
  })
  await reader.read('s');stateReads=0;fullReads=0
  const result=await reader.response({sessionId:'s',viewSync:1,viewCursor:'cursor'})
  assert.equal(stateReads,1);assert.equal(fullReads,0)
  assert.equal(result.revision,5);assert.equal(result.view.chatId,'c')
})

test('timeline inspection never traverses story data and returns isolated participants', () => {
  const timeline = createStoryTimeline({id:()=> 'branch',now:()=>1})
  const chat = {timeline:{schemaVersion:1,branchId:'b',revision:7,checkpoints:[],
    participants:{background:{sessionId:'s',lifetime:'chat'}},operations:{}}}
  Object.defineProperty(chat,'messages',{enumerable:true,get(){throw Error('history traversed')}})
  const result = timeline.inspect({chat})
  assert.equal(result.revision,7)
  result.participants.background.sessionId='changed'
  assert.equal(chat.timeline.participants.background.sessionId,'s')
})

test('projection cache and browser cursor use their own change baselines', async () => {
  let chat={id:'c',mode:'card',cardPath:'',_storageRevision:3,messages:[{role:'user',text:'old0'},{role:'assistant',text:'old1'}]}
  const queries=[]
  const sync=(_id,view,_cursor,options)=>{assert.deepEqual([...options.dirtyMessageIndices],[1]);return view}
  sync.peek=()=>({sessionId:'s',revision:4})
  const reader=createSessionViewReader({readState:async()=>chat,readChat:async()=>chat,
    readChanges:async(_id,revision)=>{queries.push(revision);return {revision:5,indices:revision===3?[0,1]:[1]}},
    project:{full:async value=>({tavernHelper:{messages:structuredClone(value.messages)}}),
      dirty:async(value,previous,indices)=>({tavernHelper:{messages:previous.tavernHelper.messages.map((row,i)=>indices.has(i)?value.messages[i]:row)}})},
    activity:()=>({busy:false}),trace:{stage:(_name,fn)=>fn(),state(){}},foregroundRunning:()=>false,synchronize:sync})
  await reader.read('s')
  chat={...chat,_storageRevision:5,messages:[{role:'user',text:'new0'},{role:'assistant',text:'new1'}]}
  const result=await reader.response({sessionId:'s',viewSync:1,viewCursor:'cursor'})
  assert.deepEqual(queries,[3,4])
  assert.equal(result.tavernHelper.messages[0].text,'new0')
  assert.equal(result.tavernHelper.messages[1].text,'new1')
})

test('timeline inspection retains legacy foreground migration without changing the source', () => {
  const timeline=createStoryTimeline({id:()=> 'checkpoint',now:()=>10})
  const chat={messages:[{role:'assistant',text:'body'}],timeline:{schemaVersion:1,branchId:'b',revision:2,
    checkpoints:[],participants:{},operations:{body:{id:'body',kind:'body',status:'foreground-completed',
      basedOn:{branchId:'b',revision:2},turn:1,userText:'go',beforeRevision:1,beforeParticipants:{}}}}}
  const result=timeline.inspect({chat})
  assert.equal(result.revision,3)
  assert.equal(result.checkpointCount,1)
  assert.equal(result.operations.body.status,'completed')
  assert.equal(chat.timeline.operations.body.status,'foreground-completed')
  assert.equal(chat.timeline.checkpoints.length,0)
})

test('change indices carry exact revision, detach results and survive more than 32 commits', async t => {
  const root = await mkdtemp(join(tmpdir(),'issue86-changes-'))
  t.after(()=>rm(root,{recursive:true,force:true}))
  const store = createChatJournalStore({dataRoot:root})
  const persistence = createChatPersistence({store})
  await store.update('c',()=>({id:'c',_storageRevision:1,messages:[{text:'a'},{text:'b'}]}))
  for(let revision=1;revision<=40;revision++) await store.patch('c',revision,[
    {op:'set',path:['_storageRevision'],value:revision+1},
    {op:'set',path:['messages',revision%2,'text'],value:String(revision)}
  ])
  const changed = await persistence.readChangedIndices('c',1)
  assert.deepEqual(changed,{indices:[0,1],baseRevision:1,revision:41})
  changed.indices.length=0
  assert.deepEqual((await persistence.readChangedIndices('c',1)).indices,[0,1])
  assert.deepEqual((await store.readChangedSlice('c',1)).indices,[0,1])
  assert.equal(await store.readChangedIndices('c',0),undefined)
  assert.equal(await createChatJournalStore({dataRoot:root}).readChangedIndices('c',1),undefined)
  await store.patch('c',41,[{op:'set',path:['_storageRevision'],value:42},
    {op:'splice',path:['messages'],index:0,deleteCount:1,items:[]}])
  assert.deepEqual((await store.readChangedIndices('c',1)).indices,[0])
  assert.equal((await store.readChangedSlice('c',1)).chat.messages[0].text,'39')
})

test('older change summaries conservatively cover interior cursors and evict oversized coverage', async t => {
  const root = await mkdtemp(join(tmpdir(),'issue86-summary-'))
  t.after(()=>rm(root,{recursive:true,force:true}))
  const store=createChatJournalStore({dataRoot:root})
  await store.update('c',()=>({id:'c',_storageRevision:1,messages:Array.from({length:4200},()=>({text:'a'}))}))
  await store.patch('c',1,[{op:'set',path:['_storageRevision'],value:2},
    ...Array.from({length:4100},(_,i)=>({op:'set',path:['messages',i,'text'],value:'b'}))])
  for(let revision=2;revision<=40;revision++) await store.patch('c',revision,[
    {op:'set',path:['_storageRevision'],value:revision+1},
    {op:'set',path:['messages',4199,'text'],value:String(revision)}])
  assert.equal(await store.readChangedIndices('c',1),undefined)
  assert.deepEqual((await store.readChangedIndices('c',2)).indices,[4199])
  assert.deepEqual((await store.readChangedIndices('c',5)).indices,[4199])
  assert.deepEqual(await store.readChangedIndices('c',41),{indices:[],baseRevision:41,revision:41})
})
