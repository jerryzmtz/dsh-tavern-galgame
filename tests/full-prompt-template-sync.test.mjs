import test from 'node:test'
import assert from 'node:assert/strict'
import { createFullPromptTemplateSync } from '../tavern-plugin/lib/domain/full-prompt-template-sync.js'
import { applyTemplateSync } from '../tavern-plugin/lib/vendor/st-prompt-template/host-build/native-connection.js'

test('selected projection fingerprints only changed rows and rejects consumed or stale cursors',()=>{
 const sync=createFullPromptTemplateSync()
 const first=sync({state:{chatId:'c',sessionId:'s',stateRevision:1,lifecycleRevision:0,chat:[{mes:'old'},{mes:'two'}]},environment:{}})
 const snapshot={state:{chatId:'c',sessionId:'s',stateRevision:2,lifecycleRevision:0,chat:[{mes:'new'}]},environment:{}}
 assert.equal(sync.selected(snapshot,first.cursor,[1],2,0),undefined)
 const result=sync.selected(snapshot,first.cursor,[1],2,1)
 assert.deepEqual(applyTemplateSync(first,result).state.chat,[{mes:'old'},{mes:'new'}])
 assert.equal(sync.selected(snapshot,first.cursor,[1],2,1),undefined)
 assert.equal(sync.selected({...snapshot,state:{...snapshot.state,lifecycleRevision:1}},result.cursor,[1],2,2),undefined)
})
