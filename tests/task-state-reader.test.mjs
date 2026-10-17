import test from 'node:test'
import assert from 'node:assert/strict'
import { createTaskStateReader, taskStateFields } from '../tavern-plugin/lib/domain/task-state-reader.js'

const chat = { id: 'chat', sessionId: 'session', cardPath: 'card', cardName: 'card name', _storageRevision: 9,
  timeline: { schemaVersion: 1, branchId: 'branch', revision: 2, operations: {}, participants: {}, checkpoints: [] },
  candidates: { requestId: 'request', messageId: 'message', operationId: 'candidate', generatedAt: 123 } }
function harness(source = chat) {
  let fullReads = 0
  const headers = () => {
    const result={}
    for(const field of taskStateFields){const parts=field.split('.');let value=source;for(const key of parts)value=value?.[key];if(value===undefined)continue;let target=result;for(const key of parts.slice(0,-1))target=target[key]??={};target[parts.at(-1)]=structuredClone(value)}
    return result
  }
  const reader = createTaskStateReader({
    readSlice: async (id, indices, fields) => { assert.equal(id, 'chat'); assert.deepEqual(indices, []); assert.equal(fields, taskStateFields); return { chat: headers() } },
    readState: async () => { fullReads++; return source },
    headerForSession: async (id, fields) => { assert.equal(id, 'session'); assert.equal(fields, taskStateFields); return headers() },
    stateForSession: async () => { fullReads++; return source },
  })
  return { reader, fullReads: () => fullReads }
}

test('task reads never materialize rollback snapshots',async()=>{
 const source={...chat,timeline:{...chat.timeline}}
 Object.defineProperty(source.timeline,'checkpoints',{enumerable:true,get(){throw Error('rollback snapshot read')}})
 const {reader}=harness(source)
 assert.equal((await reader.read('chat')).timeline.branchId,'branch')
 assert.equal((await reader.forSession('session')).timeline.checkpoints,undefined)
})
