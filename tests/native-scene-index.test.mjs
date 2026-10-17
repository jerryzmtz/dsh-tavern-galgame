import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createChatJournalStore} from '../tavern-plugin/lib/domain/chat-journal-store.js'
import {createChatPersistence} from '../tavern-plugin/lib/domain/chat-persistence.js'
import {createConversationPageStore} from '../tavern-plugin/lib/domain/conversation-page-store.js'
import {sceneTarget} from '../tavern-plugin/lib/domain/scene-illustration.js'
async function fixture(t,count=256){
 const root=await mkdtemp(join(tmpdir(),'scene-index-'));t.after(()=>rm(root,{force:true,recursive:true}))
 const io=[],store=createChatJournalStore({dataRoot:root,newConversations:true,onNativeIO:e=>io.push(e)}),db=createChatPersistence({store})
 const chat=await db.write({id:'场景',sessionId:'s',mode:'story',messages:Array.from({length:count},(_,i)=>({role:'assistant',turn:i+1,text:'正文😀'+i,swipes:['正文😀'+i,'其他'],swipeId:0,variables:[{hp:i}]}))})
 return {root,db,io,chat}
}

test('append, old-body edits, swipe, truncation and reopening retain exact legacy identities',async t=>{
 const {db,chat}=await fixture(t,6)
 async function check(){const full=await db.read(chat.id),state=await db.readSceneImageState(chat.id,{turns:full.messages.map(row=>row.turn)})
  for(const row of full.messages)assert.deepEqual(sceneTarget(state,row.turn),sceneTarget(full,row.turn))
  return full
 }
 await db.update(chat.id,c=>{c.messages.push({role:'assistant',turn:7,text:'追加'});return c});await check()
 await db.update(chat.id,c=>{c.messages[1].text='改写';c.messages[1].swipes[0]='改写';return c});await check()
 await db.update(chat.id,c=>{c.messages[4].swipeId=1;return c});await check()
 await db.update(chat.id,c=>{c.messages[4].swipes=[];c.messages[4].swipeId=3;return c});await check()
 await db.update(chat.id,c=>{c.messages.length=3;return c});const old=await check()
 const missing=await db.readSceneImageState(chat.id,{turns:[7]});assert.throws(()=>sceneTarget(missing,7),/不存在/)
 await db.update(chat.id,c=>{c.messages.push({role:'assistant',turn:4,text:'分支'});return c});await check()
 assert.deepEqual(sceneTarget(await db.readSceneImageState(chat.id,{turns:[3],revision:old._storageRevision}),3),sceneTarget(old,3))
})

test('an index from an older writer revision cannot return stale picture identities',async t=>{
 const {root,db,chat}=await fixture(t,4),pages=createConversationPageStore({root:join(root,'chats')})
 const head=await pages.readHead(chat.id)
 await pages.commit(chat.id,{expectedRevision:head.revision,state:{...head.state,sceneIndexRevision:0}})
 const fallback=await db.readSceneImageState(chat.id,{turns:[4]})
 assert.equal(fallback.sceneTargets,undefined);assert.equal(fallback.messages.length,4)
 await db.patch(chat.id,chat._storageRevision,[{op:'set',path:['messages',3,'variables',0,'hp'],value:43}])
 assert.deepEqual(sceneTarget(await db.readSceneImageState(chat.id,{turns:[4]}),4),sceneTarget(chat,4))
})

test('display diagnostics share exact explicit-turn coordinates without scanning history',async t=>{
 const {root,db,chat,io}=await fixture(t,130)
 const {projectDisplayRuntimeState}=await import('../tavern-plugin/lib/domain/chat-session-state.js')
 async function check(turn,bounded=true){
  const full=await db.read(chat.id)
  const cold=createChatJournalStore({dataRoot:root,onNativeIO:e=>io.push(e)})
  io.length=0
  assert.deepEqual(await cold.readDisplayRuntimeState(chat.id,turn),projectDisplayRuntimeState(full,turn))
  if(bounded)assert.ok(io.filter(e=>e.type==='page').length<=1)
 }
 await check(130);await check(999)
 await db.update(chat.id,c=>{c.messages.push({role:'assistant',turn:131,text:'next',displayRuntime:{frames:[{dom:'new'}]}});return c})
 await check(131)
 // Duplicate/descending turns: the display API chooses the first matching row
 // and the maximum explicit turn, not simply the last row's turn.
 await db.update(chat.id,c=>{c.messages[1].turn=131;return c})
 await check(131)
 await db.update(chat.id,c=>{c.messages.length=3;return c})
 await check(3)
 // An inferred legacy turn collides with an explicit one: retain full semantics.
 await db.update(chat.id,c=>{c.messages=[{role:'user',text:'input'},{role:'assistant',text:'inferred',displayRuntime:{frames:[{dom:'first'}]}},{role:'assistant',turn:2,text:'explicit'}];return c})
 await check(2,false)
})
