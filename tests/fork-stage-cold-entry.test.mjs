// private fork: promote the Neuro turn-49 diagnosis to a portable regression.
// Synthetic text/identities replace private logs; real validation, store and resource
// owners run through the renderer handoff (not a Pixi/Live2D GPU rendering test).
import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {assetPackDigest as digest} from '../tavern-plugin/lib/domain/stage-asset-pack-catalogue.js'
import {createFakeClock, createStageRuntimeHarness, runtimeSource, runtimePage, runtimeText,
  runtimeDirection, runtimeGroups} from './helpers/stage-runtime-harness.mjs'
const require = createRequire(import.meta.url)
const {createStageRuntimeState} = require('../tavern-plugin/src/client/fork-stage-runtime.cjs')
const {createStageRuntimeStore} = require('../tavern-plugin/src/client/fork-stage-runtime-store.cjs')
const {createStageDirectorSource} = require('../tavern-plugin/src/client/fork-stage-director-source.cjs')
const {createStageResourceRunner} = require('../tavern-plugin/src/client/fork-stage-resource-runner.cjs')
const {createStageResourceOwner} = require('../tavern-plugin/src/client/fork-stage-resources.cjs')
const {stagePageIndex} = require('../tavern-plugin/src/client/fork-stage-page-index.cjs')
const settle = async predicate => {
  const deadline = Date.now() + 3000
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 5))
    if (predicate()) return
  }
  assert.fail('Stage did not settle')
}

function completedStream() {
  const source = runtimeSource({turn:49})
  const units = Array.from({length:10}, (_, i) => ({kind:'narration', text:'Fixture paragraph ' + (i + 1)}))
  const pageIndex = stagePageIndex(units)
  const target = {...source, sourceDigest:'fixture-text'}
  const binding = {target, unitsDigest:digest(units), pageDigest:digest(pageIndex),
    stream:{version:1, operationId:'fixture-stream', epoch:0, committed:true}}
  const baseline = {cast:['f_neuro'], actors:{f_neuro:{outfitKey:'default'}}}, entries = []
  const record = {complete:true, binding, baseline, entries, end:baseline}
  record.digest = digest({binding, baseline, entries, end:record.end})
  const token = {sourceKey:target.sourceKey, branchId:target.branchId, generation:0,
    bindingKey:digest(binding), prefixRevision:1, digest:record.digest}
  const envelope = {phase:'done', revision:1, generation:0, target, token, binding,
    bindingKey:token.bindingKey, prefixRevision:1, complete:true, through:10,
    units, displayUnits:units, pageIndex, record, baseline, entries}
  const text = {...runtimeText(1, pageIndex.pages.map(p => runtimePage(p.para, p.offset))), units}
  return {source, envelope, text}
}

for (const mode of ['live', 'history']) test(`cold ${mode} entry projects a complete committed stream without a page change`, async t => {
  const {source, envelope, text} = completedStream()
  const clock = createFakeClock(), calls = [], reads = [], projections = [], presents = []
  let serial = 0
  const owner = createStageResourceOwner({
    urls:{createObjectURL:() => 'blob:fixture-' + (++serial), revokeObjectURL() {}},
    service:{leaseBundle:async ({bundleKey}) => ({ticket:bundleKey, revision:'r',
      url:'/bundle/' + bundleKey + '/model.json', resources:['/bundle/' + bundleKey + '/model.json']}), releaseLease() {}},
    fetch:async () => new Response('{}')
  })
  const resources = createStageResourceRunner({owner, clock, present:(_id, intent) => presents.push(intent),
    read:async args => {
      projections.push(args)
      assert.deepEqual(args.expectedDirectionToken, envelope.token)
      return {status:'ready', directionToken:envelope.token, value:{
        state:{...envelope.baseline, figureScale:{version:6, scene:0, hMax:150, rescales:0}, lighting:null},
        scene:{}, characters:[{alias:'f_neuro', name:'Neuro', form:'live2d', outfitKey:'default', model:{resource:true,
          kind:'bundle', identity:'fixture-neuro', ref:{packId:'fixture'}, revision:'r', hash:'model', bundleKey:'model'}}],
        avatars:[], audio:{music:null, soundscape:null}, widgets:[]}}
    }})
  const runner = createStageDirectorSource({clock,
    read:async args => {reads.push(args); return envelope}, watch:() => () => {},
    onEffect:(...args) => {calls.push(args[1]); return resources.onEffect(...args)}})
  const store = createStageRuntimeStore({initialState:{...createStageRuntimeState(), opened:false},
    runEffect:(...args) => runner.runEffect(source.sessionId, ...args)})
  t.after(() => {store.dispose(); runner.dispose(); resources.dispose()})
  store.dispatch({type:mode === 'live' ? 'TURN_CHANGED' : 'HISTORY_JUMP', source, text})
  await settle(() => !store.getSnapshot().observation.flight)
  store.dispatch({type:'STAGE_OPEN', opened:true})
  store.dispatch({type:'PAGE', index:0}) // Restore the same anchor, as on actual entry.
  await settle(() => !store.getSnapshot().observation.flight)
  const projects = calls.filter(call => call.type === 'project')
  assert.equal(projects.length, 1, 'entry must request the persisted projection immediately')
  await settle(() => presents.some(p => p.accepted?.figures?.length === 1))
  const first = store.getSnapshot()
  assert.equal(first.director.phase, 'done')
  assert.equal(first.director.complete, true)
  assert.equal(first.director.binding.stream.committed, true)
  assert.equal(first.pending.error, null)
  assert.equal(first.text.streaming, false)
  assert.equal(projects[0].at, 1)
  assert.deepEqual(projects[0].page, {index:0, para:1, offset:0, version:1})
  assert.equal(projects[0].transition, mode === 'history' ? 'snap' : 'normal')
  assert.deepEqual(first.accepted.figures.map(figure => figure.alias), ['f_neuro'])
  assert.equal(first.accepted.figures[0].outfitKey, 'default')
  assert.ok(first.accepted.figures[0].model.startsWith('blob:'))
  assert.ok(projections.some(args => args.at === 1 && args.turn === 49))
  clock.advance(15000)
  await settle(() => !store.getSnapshot().observation.flight)
  assert.equal(calls.filter(call => call.type === 'project').length, 1, 'polling must not repeat the projection')
  store.dispatch({type:'PAGE', index:1})
  store.dispatch({type:'PAGE', index:0})
  const after = calls.filter(call => call.type === 'project')
  assert.equal(after.length, 3)
  assert.equal(after.at(-1).at, 1)
  assert.deepEqual(after.at(-1).baseline.cast, ['f_neuro'])
  assert.ok(reads.every(args => args.readOnly === true))
})

// Final records stay fenced even after text.streaming becomes false and when
// the client missed every partial director delivery. A new visit must reset it.
for (const arrival of ['partial-then-final', 'final-only', 'text-append', 'director-stream', 'generating-final']) test(`live stream late deltas never restage or replay: ${arrival}`, () => {
  const h = createStageRuntimeHarness(), source = runtimeSource(), pages = [runtimePage(1), runtimePage(2)]
  try {
    h.dispatch({type:'TURN_CHANGED', source, text:runtimeText(1, pages)})
    h.replyRead(h.state.observation.flight, runtimeDirection(1, 2, {phase:'done', complete:true}))
    h.readyProjection(h.last('project').token, runtimeGroups('already-shown'))
    const accepted = h.state.accepted
    const next = runtimeSource({turn:49, sourceKey:'turn-49'})
    h.dispatch({type:'TURN_CHANGED', source:next, generating:arrival === 'generating-final',
      text:runtimeText(1, pages, !['text-append', 'director-stream', 'generating-final'].includes(arrival))})
    if (arrival === 'text-append') h.dispatch({type:'TEXT_APPEND', source:next, text:runtimeText(2, pages, true)})
    const entries = [{at:1, ordinal:0, events:[{kind:'sfx', ordinal:0}]}]
    const stream = {version:1, operationId:'fixture-stream', epoch:0}
    if (!['final-only', 'generating-final'].includes(arrival)) h.replyRead(h.state.observation.flight,
      runtimeDirection(1, 1, {streaming:true, binding:{stream}, entries}))
    h.dispatch({type:'STAGE_OPEN', opened:false})
    h.dispatch({type:'STAGE_OPEN', opened:true})
    h.dispatch({type:'TEXT_RECONCILE', source:next, text:runtimeText(3, pages)})
    const done = runtimeDirection(2, 2, {phase:'done', complete:true, binding:{stream:{...stream, committed:true}}, entries})
    h.dispatch({type:'DIRECTOR_SNAPSHOT', source:next, envelope:done})
    h.dispatch({type:'DIRECTOR_SNAPSHOT', source:next, envelope:{...done, revision:3, prefixRevision:3}})
    assert.equal(h.state.text.streaming, false)
    assert.equal(h.state.director.phase, 'done')
    assert.equal(h.state.accepted, accepted)
    assert.equal(h.effects('project').length, 1)
    assert.equal(h.effects('prepare-one-shot').length, 0)
    assert.ok(Object.values(h.state.ledger).every(entry => entry.status === 'skipped'))
    h.dispatch({type:'PAGE', index:1})
    assert.equal(h.effects('project').length, 2, 'navigation still projects the newest fold')
    h.dispatch({type:'STAGE_OPEN', opened:false})
    h.dispatch({type:'STAGE_OPEN', opened:true})
    assert.equal(h.effects('project').length, 3, 'opening the now-complete stream explicitly restores the current page')
    assert.equal(h.last('project').at, 2)
    assert.equal(h.effects('prepare-one-shot').length, 0)
    h.dispatch({type:'RESUME_LIVE', source:next, text:runtimeText(3, pages)})
    h.replyRead(h.state.observation.flight, {...done, entries:[]})
    assert.equal(h.effects('project').length, 4, 're-entering a completed turn is a fresh read, not a live stream')
  } finally {h.dispose()}
})
