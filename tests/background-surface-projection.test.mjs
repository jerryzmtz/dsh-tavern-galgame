import test from 'node:test'
import assert from 'node:assert/strict'
import { backgroundSuppressedTurns } from '../tavern-plugin/lib/domain/background-surface.js'
test('durable rollback excludes tool and reasoning turns including older rollback records', () => {
  const events = [
    { type: "projection-cache", data: { turn: 1 } },
    { seq: 2959, type: 'turn/end', data: { turn: 2 } },
    { seq: 2964, type: 'user/message', data: { turn: 3 } },
    { seq: 3325, type: 'tool/call', data: { turn: 3 } },
    { seq: 4000, type: 'assistant/message', data: { turn: 4 } },
    { seq: 4257, type: 'tool/call', data: { turn: 5 } },
    { seq: 4262, type: 'assistant/message', data: { turn: 5, message: { content: [] } }, surfaceOp: { op: 'replace', start: 2964, end: 4258 } },
    { seq: 4265, type: 'tool/call', data: { turn: 6 } }
  ]
  assert.deepEqual(backgroundSuppressedTurns(events), [3, 4, 5])
  assert.deepEqual(backgroundSuppressedTurns(events.slice(0, 5)), [])
})

test('large background history scans event sequences once instead of once per rollback',()=>{
 let reads=0
 const events=Array.from({length:31564},(_,seq)=>({get seq(){reads++;return seq},type:'tool/call',data:{turn:Math.floor(seq/100)+1}}))
 for(let i=0;i<249;i++)events.push({seq:31564+i,type:'assistant/message',data:{message:{content:[]}},surfaceOp:{op:'replace',startSeq:i*100,endSeq:i*100+99}})
 const result=backgroundSuppressedTurns(events)
 assert.equal(result.length,249)
 assert.ok(reads<31564*4,`sequence inspected ${reads} times`)
})
