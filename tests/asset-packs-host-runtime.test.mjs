import test from 'node:test'
import assert from 'node:assert/strict'
import { createStageDirector } from '../tavern-plugin/lib/domain/stage-director.js'
import { createAssetRuntime } from '../tavern-plugin/lib/fork-asset-runtime.js'
import { createCardStage } from '../tavern-plugin/lib/fork-card-stage.js'
import { createStoryTimeline } from '../tavern-plugin/lib/domain/story-timeline.js'
import { createBackgroundTaskCoordinator } from '../tavern-plugin/lib/domain/background-task-coordinator.js'
import { defaultAssetEngineSettings } from '../tavern-plugin/lib/domain/asset-engine-settings.js'
import { syntheticPack, cardExtension, PACK_ID } from './fixtures/asset-packs/pack.mjs'
import {fixture, deferred, answer} from './helpers/stage-director-harness.mjs'
test('production pack director commits through real coordinator beside MVU, checkpoints before receipt, replays semantic record',async t => {
  let f
  f = await fixture(async request => {
    assert.deepEqual(request.tools.map(tool => tool.name),['stage_update'])
    const reply = JSON.parse(await request.onToolCall({name:'stage_update',arguments:answer}))
    assert.equal(reply.ok,true)
    assert.equal(f.read().messages[0].stageDirectionAssetPacksDraft.state.complete,true)
  })
  t.after(() => f.dispose())
  const core = await f.tasks.begin(f.read(),'settlement')
  await core.checkpointMessage(0,(_chat,message) => {message.mvu = {preserved:true}})
  assert.equal((await f.director.get(f.read())).status,'running')
  await f.director.drain()
  const result = await f.director.get(f.read(),1,null,{generate:false})
  assert.equal(result.status,'done',JSON.stringify(result))
  assert.equal(result.record.format,'asset-packs-v1')
  assert.equal(result.record.entries[1].timeTransitionMs,2500)
  assert.equal(f.read().messages[0].stageDirectionAssetPacksDraft,undefined)
  assert.deepEqual(f.read().messages[0].mvu,{preserved:true})
  assert.equal((await core.commit({stateChanged:false,participant:null})).status,'committed')
  assert.equal(f.calls.length,1)
  f.changePack()
  assert.equal((await f.director.get(f.read(),1,null,{generate:false})).record.digest,result.record.digest)
})

for (const change of ['changePack','changeEngine','branch']) test(`pack director rejects ${change} during model call and retries only explicitly`,async t => {
  const entered = deferred(), release = deferred()
  let first = true
  const f = await fixture(async request => {if(first) {first = false; entered.resolve(); await release.promise} await request.onToolCall({name:'stage_update',arguments:answer})})
  t.after(() => f.dispose())
  await f.director.get(f.read()); await entered.promise
  f[change](); release.resolve(); await f.director.drain()
  assert.equal(f.read().messages[0].stageDirectionAssetPacks,undefined)
  assert.equal((await f.director.get(f.read())).status,'error')
  assert.equal(f.calls.length,1)
  const reset = await f.director.retry(f.read(),1)
  await f.director.get(reset.chat); await f.director.drain()
  assert.equal((await f.director.get(f.read(),1,null,{generate:false})).status,'done')
})

test('card edits expire prepared binding and unload prevents publication',async t => {
  const entered = deferred(), release = deferred()
  const f = await fixture(async request => {entered.resolve(); await release.promise; await request.onToolCall({name:'stage_update',arguments:answer})})
  t.after(() => f.dispose())
  await f.director.get(f.read()); await entered.promise
  f.workspace.raw.name = 'Edited'; f.assets.invalidate('cards/a.json')
  const disposed = f.director.dispose(); release.resolve(); await disposed
  assert.equal(f.read().messages[0].stageDirectionAssetPacks,undefined)
})

test('unbound and old-extension cards are neutral with zero pack/TTS reads; no legacy directory reads',async t => {
  const f = await fixture(() => {throw new Error('No model call')},{bound:false})
  t.after(() => f.dispose())
  assert.equal((await f.director.get(f.read())).status,'off')
  assert.equal(await f.assets.consumer(f.read()),null)
  assert.equal(f.reads(),0)
  const paths = []
  const stage = createCardStage({getEngine:()=>defaultAssetEngineSettings(),profileData:{readJson:async path => {paths.push(path); return f.workspace}}})
  const dialogue=await stage.bubbles.read('cards/a.json')
  assert.equal(dialogue.stage.director,false);assert.deepEqual(dialogue.characters,[])
  assert.deepEqual(paths,['resources/cards/a.json'])
})

test('host consumer requires carrier origin and retains lifetime on pack refresh',async t => {
  const f = await fixture(() => {})
  t.after(() => f.dispose())
  await assert.rejects(f.assets.consumer(f.read()),/carrier/)
  const a = await f.assets.consumer(f.read(),'http://localhost:123')
  assert.equal(a.presentation.available(),true)
  assert.equal((await a.speech.open('actor')).available,false)
  f.changePack()
  // private fork: revision refresh preserves the consumer and acquired media.
  assert.equal(a.presentation.available(),true)
  const b = await f.assets.consumer(f.read(),'http://localhost:123')
  assert.equal(a,b)
  f.services.delete('assetLibrary')
  assert.equal(b.presentation.available(),false)
})

test('P4 never registers figure voices, and native provider changes do not revoke unrelated presentation',async t => {
  const listeners=new Set();let registrations=0;
  const tts={apiVersion:1,subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn)},registerVoiceSource(){registrations++;throw Error('Forbidden')}};
  const f=await fixture(()=>{},{tts});t.after(()=>f.dispose());
  const consumer=await f.assets.consumer(f.read(),'http://localhost:123');
  assert.equal((await consumer.speech.open('actor')).available,false);assert.equal(registrations,0);
  for(const fn of [...listeners])fn({type:'providerChanged'});
  // private fork: TTS provider changes are not visual authority changes.
  assert.equal(consumer.presentation.available(),true);
  const next=await f.assets.consumer(f.read(),'http://localhost:123');
  assert.equal((await next.speech.open('actor')).available,false);
  delete f.workspace.raw.extensions.dsh_tavern.assetBindings;
  assert.equal(await f.assets.consumer(f.read(),'http://localhost:123'),null);
  assert.equal(next.presentation.available(),false);assert.equal(registrations,0);
});

test('regenerating an earlier effect invalidates dependent records without rewriting history',async t => {
  const f = await fixture(request => request.onToolCall({name:'stage_update',arguments:answer}))
  t.after(() => f.dispose())
  await f.director.get(f.read(),1); await f.director.drain()
  f.appendReply(2)
  await f.director.get(f.read(),2); await f.director.drain()
  const second = (await f.director.get(f.read(),2,null,{generate:false})).record
  assert.ok(second)
  await f.director.generate(f.read(),1); await f.director.drain()
  assert.equal((await f.director.get(f.read(),2,null,{generate:false})).status,'missing')
  assert.equal(f.read().messages[1].stageDirectionAssetPacks.digest,second.digest)
})

test('failed pack jobs keep an authoritative retry marker across host restart',async t => {
  const f = await fixture(() => {throw new Error('Offline model')})
  t.after(() => f.dispose())
  await f.director.get(f.read()); await f.director.drain()
  assert.equal(f.read().messages[0].stageDirectionAssetPacksFailure.status,'error')
  const reopened = createStageDirector({assets:f.assets})
  t.after(() => reopened.dispose())
  assert.equal((await reopened.get(f.read())).status,'error')
  assert.equal(f.calls.length,1)
})
