import test from 'node:test'
import assert from 'node:assert/strict'
import { createManager, attachProvider, redact } from '../src/manager.js'
import { createTts } from '../../dsh-tts/src/service.js'
import { validatePaths } from '../src/transport.js'
const deferred=() => {let resolve;const promise=new Promise(r => {resolve=r});return {promise,resolve}}
// private fork: lifecycle fixtures never start Python or touch installed models.
const ready={state:'ready'} // private fork: lifecycle readiness does not require a voice registry.
function fixture(options={}) {
  let settings={providerId:'engine',installPath:'C:/engine',modelConfigPath:'C:/engine/config.json',readinessTimeoutMs:40,autoStart:false}, starts=0, terminations=0
  const done=deferred(), exited=deferred(), logs={text:'token=hidden\nAuthorization: Bearer hidden',nextOffset:40,lossy:true}
  const handle={done:done.promise,waitForExit:() => exited.promise,terminate(){terminations++;exited.resolve()},collected:{stdout:{readFrom:() => logs}}}
  const manager=createManager({subprocess:{spawn(spec){starts++;assert.deepEqual(spec.argv,['python','worker']);assert.equal(spec.env.PYTHONUTF8,'1');assert.equal(spec.signal,undefined);return handle}},getSettings:() => settings,connection:async()=>({id:'engine',url:'http://localhost:12345',key:'test-only',fetch:async()=>Response.json({...ready,protocol:'dsh-tts-reference-v1',revision:'test',capabilities:{voiceKinds:['reference'],paid:false}})}),prepare:async () => ({argv:['python','worker'],key:'hidden',provider:{id:'engine',url:'http://localhost:12345',key:'test-only',fetch:async()=>new Response(JSON.stringify({...ready,protocol:'dsh-tts-reference-v1',revision:'test',capabilities:{voiceKinds:['reference'],paid:false}}))}}),probe:async () => ready,pollMs:1,stopTimeoutMs:10,...options})
  return {manager,done,exited,handle,settings:patch => {settings={...settings,...patch}},counts:() => ({starts,terminations})}
}

test('duplicate starts join readiness and stop awaits range exit',async () => {
  const wait=deferred(),f=fixture({probe:() => wait.promise})
  const one=f.manager.start(),two=f.manager.start();assert.equal(one,two);wait.resolve(ready);assert.equal((await one).state,'ready');assert.equal(f.counts().starts,1)
  await f.manager.stop();assert.equal(f.manager.status().state,'stopped');assert.equal(f.manager.provider(),null)
})
test('stop during prepare never spawns or publishes a late provider',async () => {
  const prepared=deferred(),f=fixture({prepare:() => prepared.promise}); const start=f.manager.start();const rejected=assert.rejects(start,{code:'ABORTED'});const stop=f.manager.stop();prepared.resolve({argv:['python','worker']});await rejected;await stop;assert.equal(f.counts().starts,0);assert.equal(f.manager.provider(),null)
})
test('stop during readiness fences ready callback',async () => {
  const probe=deferred(),f=fixture({probe:() => probe.promise});const start=f.manager.start();const rejected=assert.rejects(start,{code:'ABORTED'});await new Promise(r => setTimeout(r,2));const stop=f.manager.stop();probe.resolve(ready);await rejected;await stop;assert.equal(f.manager.status().state,'stopped')
})
test('readiness timeout terminates worker, no crash restart loop',async () => {
  const f=fixture({probe:async () => ({state:'starting'})});await assert.rejects(f.manager.start(),{code:'TIMEOUT'});assert.equal(f.manager.status().state,'error');assert.equal(f.counts().terminations,1);assert.equal(f.counts().starts,1)
})
test('crash retains the wakeable connection, VRAM unknown stays absent',async () => {
  const f=fixture(),tts=createTts(),off=attachProvider(f.manager,tts);await f.manager.start();assert.equal((await tts.listServices()).length,1);assert.equal(f.manager.status().vramBytes,undefined);f.done.resolve({exitCode:1});await new Promise(r => setTimeout(r,2));assert.equal(f.manager.status().state,'error');assert.equal((await tts.listServices()).length,1);off();await f.manager.dispose();await tts.dispose()
})
test('auto-start is opt-in; absent or false stays asleep at activation',async () => {
  const f=fixture();f.manager.activate();assert.equal(f.counts().starts,0);f.settings({autoStart:true});assert.equal(f.counts().starts,0);await f.manager.dispose()
  const g=fixture();g.settings({autoStart:undefined});g.manager.activate();await new Promise(r => setTimeout(r,2));assert.equal(g.counts().starts,0);await g.manager.dispose()
})
test('L2 disposal does not stop the engine and idle stop retains L2',async () => {
  const f=fixture();await f.manager.start();const tts=createTts(),off=attachProvider(f.manager,tts);await new Promise(setImmediate);assert.equal((await tts.listServices()).length,1);off();await tts.dispose();assert.equal(f.manager.status().state,'ready');const next=createTts(),off2=attachProvider(f.manager,next);await new Promise(setImmediate);assert.equal((await next.listServices()).length,1);await f.manager.stop();assert.equal((await next.listServices()).length,1);off2();await next.dispose()
})
test('logs redact launch token/credential-shaped lines and bound/truncate output',async () => {
  const f=fixture();await f.manager.start();const page=f.manager.recentLogs();assert.ok(page.items.length);assert.equal(JSON.stringify(page).includes('hidden'),false);assert.match(page.items[0].text,/truncated/);assert.equal(redact('x'.repeat(10000)).length,2048);await f.manager.dispose()
})
test('invalid paths and service startup errors fail safely; revision mismatch never spawns',async () => {
  await assert.rejects(validatePaths({installPath:'relative'}),{code:'INVALID_PATH'})
  const f=fixture({probe:async () => ({state:'error'})});await assert.rejects(f.manager.start({expectedRevision:'bad'}),{code:'REVISION_CONFLICT'});assert.equal(f.counts().starts,0);await assert.rejects(f.manager.start(),{code:'SERVICE_START_FAILED'});await f.manager.dispose()
})
test('stop timeout keeps error, blocks unsafe restart',async () => {
  const f=fixture();f.handle.waitForExit=() => new Promise(() => {});await f.manager.start();await assert.rejects(f.manager.stop(),{code:'STOP_TIMEOUT'});assert.equal(f.manager.status().state,'error');await assert.rejects(f.manager.start(),{code:'STOP_TIMEOUT'});f.handle.waitForExit=async () => {};await f.manager.dispose()
})
test('restart waits stop quiescence; changed config marks active engine stale',async () => {
  const f=fixture(),wait=deferred();await f.manager.start();f.settings({installPath:'C:/other'});assert.equal(f.manager.status().stale,true);f.handle.waitForExit=() => wait.promise;const restarted=f.manager.restart();await new Promise(r => setTimeout(r,2));assert.equal(f.counts().starts,1);wait.resolve();await restarted;assert.equal(f.counts().starts,2);await f.manager.dispose()
})

test('occupied port preparation rejects without spawn or adoption',async () => {
  const f=fixture({prepare:async () => {throw Object.assign(Error(),{code:'PORT_OCCUPIED'})}})
  await assert.rejects(f.manager.start(),{code:'PORT_OCCUPIED'});assert.equal(f.counts().starts,0);await f.manager.dispose()
})
test('hung readiness probe is interrupted by stop, not by the long readiness timeout',async () => {
  const f=fixture({probe:() => new Promise(() => {})});f.settings({readinessTimeoutMs:120000})
  const pending=f.manager.start(), rejected=assert.rejects(pending,{code:'ABORTED'});await new Promise(r => setTimeout(r,2));await f.manager.stop();await rejected;assert.equal(f.manager.status().state,'stopped')
})
// private fork: lifecycle only publishes connection data, with no voice or synthesis methods.
test('lifecycle provider carries no engine capabilities or synthesis adapter',async()=>{
  const f=fixture();await f.manager.start()
  const provider=f.manager.provider();assert.equal(provider.id,'engine');assert.equal(provider.url,'http://localhost:12345')
  assert.equal(provider.synthesize,undefined);assert.equal(provider.kind,undefined);assert.equal(provider.capabilities,undefined)
  await f.manager.dispose();assert.equal(f.counts().terminations,1)
})
test('spawned service requests shutdown on stop and DSH exit', async () => {
  let shutdowns=0
  const f=fixture({shutdown:async () => {shutdowns++}})
  await f.manager.start();await f.manager.restart();assert.equal(shutdowns,1);assert.equal(f.counts().starts,2)
  await f.manager.dispose();assert.equal(shutdowns,2)
})
// private fork: only the spawned child may be terminated after a failed graceful shutdown.
test('failed graceful shutdown terminates the owned child and waits for exit',async()=>{
  const f=fixture({shutdown:async()=>{throw Error('offline')}});await f.manager.start();await f.manager.stop()
  assert.equal(f.manager.status().state,'stopped');assert.equal(f.counts().terminations,1);await f.manager.dispose()
})
test('restart revision conflict never shuts down the active engine', async () => {
  let shutdowns=0
  const f=fixture({shutdown:async () => {shutdowns++}})
  await f.manager.start();await assert.rejects(f.manager.restart({expectedRevision:'stale'}),{code:'REVISION_CONFLICT'})
  assert.equal(shutdowns,0);assert.equal(f.manager.status().state,'ready');await f.manager.dispose()
})
test('a worker without shutdown is stopped only through its owned process handle',async()=>{
  const f=fixture({shutdown:async()=>{throw Object.assign(Error(),{code:'SHUTDOWN_UNSUPPORTED'})}})
  await f.manager.start();await f.manager.stop();assert.equal(f.counts().terminations,1);await f.manager.dispose()
})
