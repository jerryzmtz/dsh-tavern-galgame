import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createChatJournalStore } from '../tavern-plugin/lib/domain/chat-journal-store.js'
import { createChatPersistence } from '../tavern-plugin/lib/domain/chat-persistence.js'

test('selected journal reads and versioned patches preserve history, isolation and stale rejection',async t=>{
 const root=await mkdtemp(join(tmpdir(),'journal-slice-'));t.after(()=>rm(root,{recursive:true,force:true}))
 const store=createChatJournalStore({dataRoot:root,frameLimit:2}),db=createChatPersistence({store})
 await db.write({id:'c',sessionId:'s',messages:[{text:'old',variables:[{hp:7}]},{text:'new',variables:[{hp:8}]}]})
 const slice=await db.readSlice('c',[1]);assert.equal(slice.chat.messages.length,1);assert.equal(slice.chat.messages[0].text,'new')
 slice.chat.messages[0].variables[0].hp=999
 assert.equal((await db.readSlice('c',[1])).chat.messages[0].variables[0].hp,8)
 const result=await db.patch('c',1,[{op:'set',path:['messages',1,'variables',0,'hp'],value:9}])
 assert.equal(result._storageRevision,2)
 assert.equal(await db.patch('c',1,[{op:'set',path:['messages',1,'text'],value:'bad'}]),undefined)
 assert.equal((await db.readRevision('c',1)).messages[1].variables[0].hp,8)
 assert.equal((await db.read('c')).messages[0].text,'old')
 await db.patch('c',2,[{op:'set',path:['messages',1,'variables',0,'hp'],value:10}])
 assert.equal((await createChatJournalStore({dataRoot:root}).read('c')).messages[1].variables[0].hp,10)
 const other=createChatPersistence({store:createChatJournalStore({dataRoot:root})})
 await other.update('c',c=>{c.messages[0].text='external';return c})
 assert.equal((await db.readSlice('c',[0])).chat.messages[0].text,'external')
 await assert.rejects(db.patch('c',4,[{op:'set',path:['messages',999,'text'],value:'bad'}]))
 await assert.rejects(db.patch('c',4,[],{assertCurrent(){throw new Error('settlement active')}}),/settlement active/)
 assert.equal((await db.read('c'))._storageRevision,4)
})

test('changed slices cover multiple commits and fall back after external writes or eviction',async t=>{
 const root=await mkdtemp(join(tmpdir(),'journal-changes-'));t.after(()=>rm(root,{recursive:true,force:true}))
 const db=createChatPersistence({store:createChatJournalStore({dataRoot:root,frameLimit:100})})
 await db.write({id:'c',messages:[{text:'one'},{text:'two'}]})
 await db.read('c')
 await db.update('c',c=>{c.messages.push({text:'three'});return c})
 await db.update('c',c=>{c.messages[0].text='edited';return c})
 const changed=await db.readChangedSlice('c',1)
 assert.deepEqual(changed.indices,[0,2]);assert.equal(changed.messageCount,3)
 changed.chat.messages[0].text='detached'
 assert.equal((await db.readChangedSlice('c',1)).chat.messages[0].text,'edited')
 const other=createChatPersistence({store:createChatJournalStore({dataRoot:root})})
 await other.update('c',c=>{c.messages[1].text='external';return c})
 assert.equal(await db.readChangedSlice('c',1),undefined)
 const revision=(await db.read('c'))._storageRevision
 for(let i=0;i<33;i++)await db.update('c',c=>{c.counter=i;return c})
 const metadataOnly=await db.readChangedSlice('c',revision)
 assert.deepEqual(metadataOnly.indices,[])
 assert.equal(metadataOnly.chat.counter,32)
})

test('layout boundary proves tail append but never hides old-floor replacement or truncation',async t=>{
 const root=await mkdtemp(join(tmpdir(),'journal-layout-'));t.after(()=>rm(root,{recursive:true,force:true}))
 const db=createChatPersistence({store:createChatJournalStore({dataRoot:root,frameLimit:1000})})
 await db.write({id:'c',messages:[{role:'assistant',turn:1,text:'one'},{role:'assistant',turn:2,text:'two'}]})
 await db.update('c',c=>{c.messages.push({role:'assistant',turn:3,text:'three'});return c})
 for(let i=0;i<35;i++)await db.update('c',c=>{c.messages[0].text='edit '+i;return c})
 const append=await db.readChangedSlice('c',1)
 assert.equal(append.layoutChanged,true);assert.equal(append.layoutFrom,2)
 assert.equal((await db.readViewDelta('c',1)).layoutFrom,2)
 await db.update('c',c=>{c.messages[0].turn=20;return c})
 assert.equal((await db.readChangedSlice('c',1)).layoutFrom,0)
 const before=(await db.readSessionState('c'))._storageRevision
 await db.update('c',c=>{c.messages.splice(1);return c})
 await db.update('c',c=>{c.messages.push({role:'assistant',turn:4},{role:'assistant',turn:5},{role:'assistant',turn:6});return c})
 assert.equal((await db.readChangedSlice('c',before)).layoutFrom,1,'regrowth cannot disguise a truncated prefix as append')
})
