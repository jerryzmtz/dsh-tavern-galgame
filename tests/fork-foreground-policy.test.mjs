// private fork: hidden windows retain data and run work; only presentation sleeps.
import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import vm from 'node:vm'
import {createStageRuntimeHarness, createFakeClock, runtimeSource, runtimeText, runtimePage, runtimeDirection, runtimeGroups} from './helpers/stage-runtime-harness.mjs'

const foregroundSource = await readFile(new URL('../tavern-plugin/src/client/fork-foreground.js', import.meta.url), 'utf8')
test('native data callbacks run while presentation is hidden; return paints the latest data', () => {
  const clock = createFakeClock(), host = new EventTarget(), doc = new EventTarget()
  Object.assign(doc, {visibilityState:'visible', hasFocus:()=>true})
  Object.assign(host, {performance:{now:()=>clock.now}, setTimeout:clock.setTimeout, clearTimeout:clock.clearTimeout,
    requestAnimationFrame:fn=>clock.setTimeout(fn,16), cancelAnimationFrame:clock.clearTimeout})
  const nativeTimer = host.setTimeout
  vm.runInNewContext(foregroundSource, {window:host, document:doc})
  doc.visibilityState='hidden'; doc.dispatchEvent(new Event('visibilitychange'))
  let value=0, painted=-1
  const cache=new Map([['warm',{}]]), retained=cache.get('warm')
  host.forkForeground.requestAnimationFrame(()=>{painted=value})
  host.setTimeout(()=>{value=42; cache.set('new',value)},50)
  clock.advance(60000)
  assert.equal(host.setTimeout,nativeTimer)
  assert.equal(value,42); assert.equal(painted,-1); assert.equal(cache.get('warm'),retained)
  doc.visibilityState='visible'; doc.dispatchEvent(new Event('visibilitychange')); clock.advance(16)
  assert.equal(painted,42); assert.equal(cache.get('new'),42)
})

test('hidden stage retains accepted resources, receives text and continues director reads', () => {
  const h=createStageRuntimeHarness(), source=runtimeSource()
  h.dispatch({type:'SEND_ACK',source})
  h.dispatch({type:'TEXT_APPEND',source,text:runtimeText(1,[runtimePage(1)],true)})
  h.replyRead(h.state.observation.flight,runtimeDirection(1,1))
  h.readyProjection(h.last('project').token,runtimeGroups())
  const accepted=h.state.accepted, before=h.calls.length
  h.dispatch({type:'VISIBILITY',visible:false})
  assert.equal(h.state.accepted,accepted)
  assert.ok(!h.calls.slice(before).some(x=>/cancel|release|dispose/.test(x.type)))
  h.clock.advance(5000)
  assert.ok(h.state.observation.flight,'director polling continues without a visibility wake')
  h.dispatch({type:'TEXT_APPEND',source,text:runtimeText(2,[runtimePage(1),runtimePage(2)],true)})
  assert.equal(h.state.text.pages.length,2)
  h.dispatch({type:'VISIBILITY',visible:true})
  assert.equal(h.state.text.pages.length,2)
  assert.equal(h.state.accepted,accepted)
})

test('submit acknowledgement deadline never uses the presentation clock', async () => {
  const source=await readFile(new URL('../tavern-plugin/src/client/fork-gal-stage.js',import.meta.url),'utf8')
  assert.match(source,/if \(!waiting\.seen\) \{ const timer = setTimeout\(/)
})
