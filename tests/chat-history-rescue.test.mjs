import test from 'node:test'
import assert from 'node:assert/strict'
import { rescueHistoryInput } from '../tavern-plugin/lib/domain/chat-history-rescue.js'

test('rescue extracts only narrative text and rejects empty sources',()=>{
 const input=rescueHistoryInput({id:'old',cardPath:'card',messages:[{role:'system',text:'hidden'},{role:'assistant',text:'story',variables:[{secret:42}],swipes:['other']} ]})
 const rows=input.text.split('\n').map(JSON.parse)
 assert.equal(rows.length,2);assert.deepEqual(rows[1],{is_user:false,mes:'story'})
 assert.throws(()=>rescueHistoryInput({cardPath:'card',messages:[]}),/没有可迁移/)
})
