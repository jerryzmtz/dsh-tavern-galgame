import test from 'node:test'
import assert from 'node:assert/strict'

import { createBackgroundSessionRetirement } from '../tavern-plugin/lib/domain/background-session-retirement.js'

test('旧版本失败记录仅在被新会话替代后折叠，回退到旧参与者时恢复可见',async()=>{
  const chat={timeline:{participants:{background:{sessionId:'new'}},operations:{a:{kind:'agent',status:'failed',startedSessionId:'old'},b:{kind:'agent',status:'running',startedSessionId:'busy'}}}}
  const retirement=createBackgroundSessionRetirement({readJson:async()=>undefined},{readState:async()=>chat})
  const rows=['old','new','busy','unrelated'].map(id=>({kind:'child',id,label:'酒馆后台 Agent',activity:'inactive'}))
  assert.deepEqual((await retirement.filter(rows,'parent')).map(row=>row.id),['new','busy','unrelated'])
  chat.timeline.participants.background.sessionId='old'
  assert.equal((await retirement.filter(rows,'parent')).length,4)
})

// Public summaries also feed the native header count. Keep ancestors and live
// workers discoverable even when their retirement record already exists.
