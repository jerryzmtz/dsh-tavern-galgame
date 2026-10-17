import test from 'node:test'
import assert from 'node:assert/strict'
import {createImmutableOrderedJsonIndex,immutableArrayChanges} from '../tavern-plugin/lib/domain/freeze-json.js'
import {createSessionViewSync} from '../tavern-plugin/lib/domain/session-view-sync.js'
for(const count of [20,400,10000])test(`positional wire sync retains the ${count}-row prefix on append and truncation`,()=>{
 let visits=0
 const index=createImmutableOrderedJsonIndex({visit:()=>visits++})
 const rows=index.from(Array.from({length:count},(_,i)=>[i,{turn:i+1,text:'body'+i}]))
 const sync=createSessionViewSync(),first=sync('s',{replyProjections:rows})
 const appended=index.update(rows,[[count,{turn:count+1,text:'new'}]])
 visits=0
 const next=sync('s',{replyProjections:appended},first.viewCursor)
 assert.ok(visits<500,`append visits: ${visits}`)
 assert.deepEqual(next.viewDelta.set.map(([path])=>path),[['replyProjections','length'],['replyProjections',count]])
 assert.deepEqual(next.viewDelta.remove,[])
 visits=0
 const last=sync('s',{replyProjections:rows},next.viewCursor)
 assert.ok(visits<500,`truncate visits: ${visits}`)
 assert.deepEqual(last.viewDelta.set,[[['replyProjections','length'],count]])
 assert.deepEqual(last.viewDelta.remove,[['replyProjections',count]])
})

for(const count of [20,400,10000])test(`balanced middle replacement does not inspect the ${count}-row suffix`,()=>{
 let visits=0
 const index=createImmutableOrderedJsonIndex({visit:()=>visits++})
 const rows=index.from(Array.from({length:count},(_,i)=>[i*2,{turn:i+1,text:'body'+i}]))
 const sync=createSessionViewSync(),first=sync('s',{replyProjections:rows})
 const position=Math.floor(count/2)
 const next=index.update(rows,[[position*2,undefined],[position*2+1,{turn:position+1,text:'replacement'}]])
 visits=0
 assert.deepEqual(immutableArrayChanges(rows,next),[position])
 const delta=sync('s',{replyProjections:next},first.viewCursor).viewDelta
 assert.ok(visits<500,`replacement visits: ${visits}`)
 assert.deepEqual(delta.set.map(([path])=>path),[['replyProjections',position]])
 assert.deepEqual(delta.remove,[])
})
