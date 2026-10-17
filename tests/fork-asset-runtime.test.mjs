// private fork: F deletes the projection hook; these regressions use the sole session runner.
import test from 'node:test'
import assert from 'node:assert/strict'
import {harness,drain} from './helpers/stage-resource-harness.mjs'
import {deferred} from './helpers/stage-director-harness.mjs'

test('an unaccepted session stays empty without inventing media',async t=>{
  const h=await harness(t)
  assert.equal(h.store.getSnapshot().accepted.scene,null)
  assert.equal(h.owner.snapshot().pins,0)
})
test('explicit pack deletion invalidates pending candidates and cannot be undone by late reads',async t=>{
  const h=await harness(t);await h.direct()
  const late=deferred(), before=h.store.getSnapshot().accepted.scene
  h.setResponse(()=>late.promise);h.refresh();await drain()
  h.resources.revoke('session',{packId:before.background.packId},h.store.dispatch,h.store.getSnapshot)
  late.resolve({status:'pending'});await drain()
  assert.equal(h.store.getSnapshot().accepted.scene.backgroundUrl,null)
})
test('disposing the session cancels a pending projection and releases accepted pins',async t=>{
  const h=await harness(t);await h.direct()
  const late=deferred();h.setResponse(()=>late.promise);h.refresh();await drain()
  h.store.dispose();late.resolve({status:'pending'});await drain()
  assert.equal(h.store.getSnapshot().disposed,true)
  assert.equal(h.owner.snapshot().pins,0)
})
test('failed reads retain accepted presentation and never invent revoke',async t=>{
  const h=await harness(t);await h.direct()
  const before=h.store.getSnapshot().accepted
  h.setResponse(()=>{throw Error('offline')});h.refresh();await drain()
  assert.equal(h.store.getSnapshot().accepted,before)
  assert.match(h.store.getSnapshot().pending.error,/offline/)
})
test('ordinary refresh does not clear or notify unchanged media sinks',async t=>{
  const h=await harness(t);await h.direct()
  const before=h.store.getSnapshot().accepted, count=h.presents.length
  h.refresh();await drain()
  assert.equal(h.store.getSnapshot().accepted,before)
  assert.equal(h.presents.length,count)
})
