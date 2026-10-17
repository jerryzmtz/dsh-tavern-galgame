import test from 'node:test'
import assert from 'node:assert/strict'
import {createDanmakuEventAdapter} from '../fork/mods/danmaku/host.js'

test('cadence wake uses a fresh host event, one timer, and no wake after revoke/background/dispose',async()=>{
  let serial=0,valid=true,active=true,release
  const timers=new Map(),views=[],events=[]
  const context={sessionId:'session',mode:'live',sourceKey:'source',generation:1}
  const fresh=()=>({active,mode:'live',anchor:{sourceKey:'source',part:'body',paragraph:2,charOffset:12},activeTimeMs:3500})
  const adapter=createDanmakuEventAdapter({current:()=>valid,snapshot:async()=>fresh(),
    publish:(...args)=>views.push(args),emit:value=>events.push(value),
    schedule:(fn,ms)=>{assert.ok(ms>0);timers.set(++serial,fn);return serial},unschedule:id=>timers.delete(id)})
  const result={view:{active:true,silent:false},wakeAfterMs:3000}
  adapter.accept(context,result);adapter.accept(context,result)
  assert.equal(timers.size,1)
  let timer=timers.values().next().value;timers.clear();await timer()
  assert.equal(events.length,1);assert.equal(events[0].payload.reason,'cadence')
  assert.deepEqual(events[0].payload.anchor,fresh().anchor)
  adapter.accept(context,result);active=false
  timer=timers.values().next().value;timers.clear();await timer()
  assert.equal(events.length,1)
  active=true;adapter.accept(context,result);adapter.revoke('session')
  assert.equal(timers.size,0);assert.deepEqual(views.at(-1),['session',null])
  valid=false;adapter.accept(context,result);assert.equal(timers.size,0)
  valid=true;adapter.accept(context,{view:{active:false,silent:false},wakeAfterMs:1});assert.equal(timers.size,0)
  adapter.accept(context,result);adapter.dispose();assert.equal(timers.size,0)
  adapter.accept(context,result);assert.equal(timers.size,0)

  const slow=createDanmakuEventAdapter({current:()=>valid,snapshot:()=>new Promise(resolve=>{release=resolve}),
    publish:()=>{},emit:()=>assert.fail('A stale awaited snapshot cannot wake'),
    schedule:fn=>{timer=fn;return 1},unschedule:()=>{}})
  slow.accept(context,result)
  const pending=timer();valid=false;release(fresh());await pending;slow.dispose()
})
