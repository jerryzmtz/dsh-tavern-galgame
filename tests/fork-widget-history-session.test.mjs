// private fork: reuse the canonical index and existing history read/validation owner.
import test from 'node:test'
import assert from 'node:assert/strict'
import {sessionHarness,nativeNode} from './helpers/stage-session-harness.mjs'
test('widget history is serial, at most 19 earlier turns, memoized across reveal updates and read-only',async()=>{
 const calls=[];let inFlight=0,max=0
 const h=sessionHarness({nodes:Array.from({length:30},(_,i)=>nativeNode(i+1,'@bubble:alice|Alice|calm|[Text '+i+']')),readHistory:async args=>{calls.push(args);max=Math.max(max,++inFlight);await Promise.resolve();inFlight--;return {token:{sourceKey:'story-'+args.turn},phase:'done'}},ownerOptions:{primeHistory:async(_source,_text,value)=>value}})
 try {
  const source=h.state().source,first=await h.owner.readWidgetHistory('s',source)
  assert.equal(first.rows.length,19);assert.equal(first.limited,true);assert.equal(max,1)
  assert.deepEqual(calls.map(c=>c.turn),Array.from({length:19},(_,i)=>29-i));assert.ok(calls.every(c=>c.readOnly===true))
  assert.equal(await h.owner.readWidgetHistory('s',source),first);assert.equal(calls.length,19)
  const context=h.owner.getWidgetContext('s');context.refs.set('one',{kind:'widgets'});context.state={intent:'hidden'}
  h.owner.get('s').dispatch({type:'STAGE_OPEN',opened:false});assert.equal(context.refs.size,0);assert.equal(context.state,null)
 } finally {h.dispose()}
})
test('a late history read cannot cross regeneration or session disposal',async()=>{
 let finish;const wait=new Promise(resolve=>finish=resolve)
 const h=sessionHarness({nodes:[nativeNode(1,'old'),nativeNode(2,'current')],readHistory:async()=>{await wait;return {token:{sourceKey:'old'}}},ownerOptions:{primeHistory:async(_s,_t,value)=>value}})
 try {
  const pending=h.owner.readWidgetHistory('s',h.state().source)
  h.binding.chunk(nativeNode(2,'replacement'));finish()
  assert.equal(await pending,null)
 } finally {h.dispose()}
})
