// private fork: completed-turn wheel paging is loading, never live director work.
import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {fixture, answer} from './helpers/stage-director-harness.mjs'
import {createFakeClock, runtimeSource, runtimeText, runtimePage, createStageRuntimeHarness, runtimeDirection} from './helpers/stage-runtime-harness.mjs'
const require = createRequire(import.meta.url)
const {createStageDirectorSource} = require('../tavern-plugin/src/client/fork-stage-director-source.cjs')
const {createStageRuntimeStore} = require('../tavern-plugin/src/client/fork-stage-runtime-store.cjs')
const {stageRuntimeIndicators} = require('../tavern-plugin/src/client/fork-stage-runtime.cjs')
const settle = async store => {
  for (let i = 0; i < 100; i++) {
    await new Promise(resolve => setImmediate(resolve))
    if (!store.getSnapshot().observation.flight) return
  }
  assert.fail('read did not settle')
}

test('three completed turns back/forward never publish director notice; warm return including current is synchronous', async t => {
  const f = await fixture(request => request.onToolCall({name:'stage_update',arguments:answer}))
  t.after(() => f.dispose())
  const rows = new Map()
  for (let turn = 1; turn <= 3; turn++) {
    if (turn > 1) f.appendReply(turn)
    await f.director.get(f.read(),turn); await f.director.drain()
    const value = await f.director.get(f.read(),turn,null,{readOnly:true})
    rows.set(turn,{source:runtimeSource({sessionId:'session',turn}),text:{...runtimeText(1,[runtimePage(1),runtimePage(2)]),units:value.displayUnits}})
  }
  const clock = createFakeClock(), calls = [], notices = []
  const runner = createStageDirectorSource({clock,
    read:async args => {calls.push(args); return f.director.get(f.read(),args.turn,null,args)},
    watch:(source,wake) => f.signals.subscribe(source.sessionId,'stage-direction',wake)})
  const store = createStageRuntimeStore({runEffect:(...args) => runner.runEffect('session',...args)})
  t.after(() => {store.dispose();runner.dispose()})
  const notice = store.select(state => stageRuntimeIndicators(state).spinner)
  notice.subscribe(() => notices.push(notice.getSnapshot()))
  const visit = turn => store.dispatch({type:turn === 3 ? 'RESUME_LIVE' : 'HISTORY_JUMP',...rows.get(turn)})
  store.dispatch({type:'TURN_CHANGED',...rows.get(3)}); await settle(store)
  for (const turn of [2,1,2,3,2,1,2,3]) {visit(turn); await settle(store)}
  assert.equal(calls.length,3)
  for (const turn of [2,1,2,3]) {
    visit(turn)
    assert.equal(store.getSnapshot().director.phase,'done')
    assert.equal(store.getSnapshot().observation.flight,null)
  }
  assert.ok(notices.every(value => value === false))
  assert.equal(stageRuntimeIndicators(store.getSnapshot()).spinner,false)
  // Polls must still detect explicit same-text regeneration and asset changes.
  clock.advance(5000); await settle(store)
  assert.equal(calls.length,4)
  f.signals.publish('session',{kind:'stage-direction',version:'cache-invalidation'})
  await settle(store)
  const before = calls.length
  visit(1); await settle(store)
  assert.equal(calls.length,before,'latest-turn wake preserves inactive completed turns')
  visit(3); await settle(store)
  assert.equal(calls.length,before,'unchanged wake restores the active completed cache too')
  assert.ok(calls.every(args => args.readOnly))
})

// private fork: settled non-directing history also avoids repeat reads; capacity is per session.
test('settled snapshots use a 200-turn per-session LRU, and running snapshots are never primed as complete',async()=>{
  const runner=createStageDirectorSource({read:()=>assert.fail('cache probe made a read'),watch:()=>()=>{}})
  const text=runtimeText(1,[runtimePage(1)])
  for(let turn=1;turn<=200;turn++)await runner.prime(runtimeSource({turn}),text,{revision:turn,phase:'off'})
  assert.ok(runner.cached(runtimeSource({turn:1}),text))
  await runner.prime(runtimeSource({turn:201}),text,{revision:201,phase:'off'})
  assert.equal(runner.cached(runtimeSource({turn:2}),text),null)
  assert.ok(runner.cached(runtimeSource({turn:1}),text))
  for(let turn=1;turn<=200;turn++)await runner.prime(runtimeSource({sessionId:'other',turn}),text,{revision:turn,phase:'off'})
  assert.ok(runner.cached(runtimeSource({turn:1}),text),'another session cannot evict this one')
  await runner.prime(runtimeSource({turn:1}),text,{revision:202,phase:'running'})
  assert.equal(runner.cached(runtimeSource({turn:1}),text),null)
  runner.dispose()
})

test('unknown, slow read, completed and hidden historical turns never claim live direction work', () => {
  const h = createStageRuntimeHarness(), source = runtimeSource(), text = runtimeText(1,[runtimePage(1)])
  h.dispatch({type:'TURN_CHANGED',source,text})
  assert.equal(stageRuntimeIndicators(h.state).spinner,false)
  h.clock.advance(1000)
  assert.equal(stageRuntimeIndicators(h.state).spinner,false)
  h.replyRead(h.state.observation.flight,runtimeDirection(1,0,{phase:'running',complete:false}))
  assert.equal(stageRuntimeIndicators(h.state).spinner,true)
  h.dispatch({type:'DIRECTOR_SNAPSHOT',source,envelope:runtimeDirection(2,1,{phase:'done',complete:true})})
  assert.equal(stageRuntimeIndicators(h.state).spinner,false)
  h.dispatch({type:'VISIBILITY',visible:false})
  h.dispatch({type:'HISTORY_JUMP',source,text})
  assert.equal(stageRuntimeIndicators(h.state).spinner,false)
  h.dispatch({type:'VISIBILITY',visible:true})
  assert.equal(stageRuntimeIndicators(h.state).spinner,false)
  h.store.dispose()
})
