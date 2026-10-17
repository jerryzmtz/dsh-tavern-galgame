// private fork: refresh and revoke now run through the session resource owner, not the deleted hook.
import test from 'node:test'
import assert from 'node:assert/strict'
import {harness,drain} from './helpers/stage-resource-harness.mjs'
import {deferred} from './helpers/stage-director-harness.mjs'
for(const field of ['scene','music','ambience','figures','avatars']) test(`${field}: failed catalogue refresh retains the accepted group`,async t=>{
  const h=await harness(t);await h.direct()
  const before=h.store.getSnapshot().accepted[field]
  h.setResponse({status:'failed',error:'ASSET_CATALOGUE_TIMEOUT'});h.refresh();await drain()
  assert.equal(h.store.getSnapshot().accepted[field],before)
})
test('aborted transport does not revoke accepted resource pins',async t=>{
  const h=await harness(t);await h.direct()
  // private fork: invalidation retires speculative warm pins, never accepted foreground pins.
  const foregroundPins=()=>h.owner.debug().resources.flatMap(row=>row.pins).filter(pin=>!pin.prefetch).length
  const pins=foregroundPins(),accepted=h.store.getSnapshot().accepted
  h.setResponse(()=>{throw new DOMException('Aborted','AbortError')});h.refresh();await drain()
  assert.equal(foregroundPins(),pins)
  assert.equal(h.store.getSnapshot().accepted,accepted)
})
test('a late refresh cannot replace a newer accepted token',async t=>{
  const h=await harness(t);await h.direct()
  const late=deferred();h.setResponse(()=>late.promise);h.refresh();await drain()
  h.setResponse(null);h.refresh();await drain()
  const before=h.store.getSnapshot().accepted
  late.resolve({status:'failed',error:'old'});await drain()
  assert.equal(h.store.getSnapshot().accepted,before)
})
test('an authority replacement releases old media before another source can project',async t=>{
  const h=await harness(t);await h.direct()
  h.store.dispatch({type:'TURN_CHANGED',source:{...h.source,authorityEpoch:99},text:h.store.getSnapshot().text})
  assert.equal(h.store.getSnapshot().accepted.scene,null)
  assert.equal(h.owner.snapshot().pins,0)
})
