import test from 'node:test'
import assert from 'node:assert/strict'

import {createRequestPerformance} from '../tavern-plugin/lib/domain/request-performance.js'

test('opening RPC traces preserve concurrent stage attribution and template failures',async()=>{
 const trace=createRequestPerformance(),id='00000000-0000-0000-0000-000000000001'
 await Promise.all(['getCardOpenings','startChat','preparePlayStart'].map(method=>trace.run(method,id,()=>trace.stage(method==='startChat'?'initializeConversation':'prepare',async()=>{}))))
 await assert.rejects(trace.run('initializeOpeningTemplate',id,()=>trace.stage('templateInitialize',()=>{throw Error('PRIVATE')})))
 const rows=trace.read().recent
 assert.equal(rows.length,4);assert.equal(rows.at(-1).failed,true);assert.equal(rows.at(-1).stages[0].name,'templateInitialize')
 assert.ok(rows.every(row=>row.id===id));assert.doesNotMatch(JSON.stringify(rows),/PRIVATE/)
})
