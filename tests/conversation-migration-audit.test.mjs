import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createChatJournalStore} from '../tavern-plugin/lib/domain/chat-journal-store.js'
import {createConversationPageStore} from '../tavern-plugin/lib/domain/conversation-page-store.js'
import {createLegacyConversationMapping} from '../tavern-plugin/lib/domain/legacy-conversation-mapping.js'
import {verifyConversationMigration} from '../bin/verify-conversation-migration.mjs'

test('real journal snapshot plus later frames exports identically without modifying source',async t=>{
 const root=await mkdtemp(join(tmpdir(),'journal-migration-audit-'));t.after(()=>rm(root,{recursive:true,force:true}))
 const sourceData=join(root,'source'),targetRoot=join(root,'target')
 const source=createChatJournalStore({dataRoot:sourceData})
 const variables={stat_data:{gold:10},schema:{gold:'number'}}
 await source.update('old',()=>({id:'old',sessionId:'s',_storageRevision:1,variables:{chat:'scope'},messages:Array.from({length:2000},(_,i)=>({role:i%2?'assistant':'user',text:'body '+i,variables:[variables],mvuBaseline:{variables},swipeId:0})),unknown:{preserve:true}}))
 await source.patch('old',1,[{op:'set',path:['messages',1999,'variables',0,'stat_data','gold'],value:20},{op:'set',path:['_storageRevision'],value:2}])
 const beforeVersion=await source.version('old'),before=await source.read('old')
 const result=await verifyConversationMigration({sourceData,chatId:'old',targetRoot,targetId:'shadow'})
 assert.equal(result.status,'verified');assert.equal(result.sourceRevision,2);assert.equal(result.activated,false)
 assert.equal(await source.version('old'),beforeVersion)
 assert.deepEqual(await source.read('old'),before)
 const store=createConversationPageStore({root:targetRoot})
 assert.equal((await store.openConversation('shadow')).state.messageVariables.stat_data.gold,20)
 assert.deepEqual(await createLegacyConversationMapping({store}).exportChat('shadow'),before)
 await assert.rejects(verifyConversationMigration({sourceData,chatId:'old',targetRoot,targetId:'shadow'}),{code:'CONVERSATION_CONFLICT'})
 assert.equal(await source.version('old'),beforeVersion)
})
