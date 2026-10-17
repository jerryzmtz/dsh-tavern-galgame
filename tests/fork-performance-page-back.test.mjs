// private fork: paging back restores the performance state of that page (docs/fork/skin-overlay-runtime.md): no
// performance before startedAt, the level active at that page, nothing after the exit page - in one turn and across turns.
import test from 'node:test'
import assert from 'node:assert/strict'
import {foldPerformanceAt} from '../fork/mods/performance/projection.js'
import {createStageRuntimeHarness, runtimeSource as source, runtimePage as page,
  runtimeText as text, runtimeDirection as direction} from './helpers/stage-runtime-harness.mjs'

const ref = {packId:'pack', kind:'performances', assetId:'barrier-charlotte'}
const skins = {cute:{packId:'pack',kind:'skins',assetId:'charlotte'}, fang:{packId:'pack',kind:'skins',assetId:'charlotte-fang'}}
const performance = {packs:{}, levels:{default:1}, timeline:{
  entry:{events:[{at:0, do:'skin', ref:'self:charlotte'}]},
  turn:{onLevel:3, events:[{at:0, do:'skin', ref:'self:charlotte-fang'}]},
  exit:{events:[{at:0, do:'skin-off'}]}}}
const resolveDocument = value => value.kind === 'performances' ? performance : value.kind === 'skins' ? {overlay:null, levels:{1:{}, 3:{}}} : null
// Mirrors the live Madoka turn: perform at para 58 (page 57), level 3 at para 112 (page 111), off at para 148 (page 147).
function record(turn, beats, carried = null) {
  let state = carried
  const entries = beats.map(({at, op, level}) => {
    if (op === 'perform') state = {ref, level, startedAt:{turn, page:at - 1}, phase:!state || state.phase === 'exit' ? 'entry' : 'turn'}
    else state = {...state, startedAt:{turn, page:at - 1}, phase:'exit'}
    return {at, ops:[{op:'mod.command',modId:'dsh.performance',commandId:op === 'perform' ? 'set' : 'off',params:op === 'perform' ? {ref,level} : {}}], state:{performance:structuredClone(state)}}
  })
  // private fork: flat commands carry a registry version; absent version means normalized saved ops.
  return {binding:{commandSpecVersion:4,mods:{commands:[{modId:'dsh.performance',commandId:'set'},{modId:'dsh.performance',commandId:'off'}]},target:{turn, sourceKey:'turn-' + turn, branchId:'branch'}, generation:0}, baseline:{music:null}, entries}
}
const at = (checked, index, predecessor = []) => {
  const value = foldPerformanceAt({checked, predecessor, turn:checked.binding.target.turn, resolveDocument, page:{index, para:index + 1, offset:0, version:1}})
  return value && {phase:value.phase, level:value.level, skin:value.sustained.skin?.ref.assetId ?? null}
}

test('one turn: pages before the start are bare, then the level of that page, then nothing after the exit', () => {
  const turn = record(127, [{at:58, op:'perform', level:1}, {at:112, op:'perform', level:3}, {at:148, op:'perform.off'}])
  for (const index of [0, 20, 56]) assert.equal(at(turn, index), null, 'page ' + (index + 1) + ' precedes the performance')
  assert.deepEqual(at(turn, 57), {phase:'entry', level:1, skin:'charlotte'})
  for (const index of [58, 80, 110]) assert.deepEqual(at(turn, index), {phase:'idle', level:1, skin:'charlotte'})
  assert.deepEqual(at(turn, 111), {phase:'turn', level:3, skin:'charlotte-fang'})
  assert.deepEqual(at(turn, 130), {phase:'idle', level:3, skin:'charlotte-fang'})
  assert.equal(at(turn, 147).phase, 'exit')
  assert.equal(at(turn, 147).skin, null)
  for (const index of [148, 199]) assert.equal(at(turn, index), null)
  // Paging back after the exit lands on the level active at that page again, never the turn's final state.
  for (const [index, expected] of [[130, 3], [80, 1], [20, null]]) assert.equal(at(turn, index)?.level ?? null, expected)
})

test('across turns: a carried performance holds from page 1 until its exit; the starting turn stays bare before it', () => {
  const first = record(1, [{at:6, op:'perform', level:1}])
  const second = record(2, [{at:4, op:'perform', level:3}, {at:9, op:'perform.off'}], first.entries.at(-1).state.performance)
  assert.equal(at(first, 2), null)
  assert.deepEqual(at(first, 9), {phase:'idle', level:1, skin:'charlotte'})
  assert.deepEqual(at(second, 0, [first]), {phase:'idle', level:1, skin:'charlotte'}, 'carried from the previous turn')
  assert.deepEqual(at(second, 3, [first]), {phase:'turn', level:3, skin:'charlotte-fang'})
  assert.equal(at(second, 8, [first]).phase, 'exit')
  assert.equal(at(second, 12, [first]), null)
  assert.equal(at(record(3, []), 0, [first, second]), null, 'an exited performance does not leak into the next turn')
})

test('pre-registry normalized performance ops retain the same historical page boundaries', () => {
  const current = record(127, [{at:58,op:'perform',level:1},{at:112,op:'perform',level:3},{at:148,op:'perform.off'}])
  const saved = structuredClone(current)
  delete saved.binding.commandSpecVersion
  for (const entry of saved.entries) entry.ops = entry.ops.map(op => op.commandId === 'set' ? {op:'perform',id:op.params.ref,level:op.params.level} : {op:'perform.off'})
  for (const index of [0,56,57,80,111,130,147,148,199]) assert.deepEqual(at(saved,index),at(current,index))
})

const value = phase => ({instanceKey:['instance'], phaseKey:['phase', phase], phase, plan:{events:[], sustainedEvents:[], bgm:null}, dependencies:[]})
test('client: a page-back projection without a performance clears the accepted performance and its playback', () => {
  const h = createStageRuntimeHarness(), s = source()
  const pages = [1, 2, 3, 4, 5].map(para => page(para))
  h.dispatch({type:'HISTORY_JUMP', source:s, text:text(1, pages), anchor:pages[3].anchor})
  h.dispatch({type:'STAGE_OPEN', opened:true})
  h.replyRead(h.state.observation.flight, direction(1, 5, {phase:'done', complete:true}))
  h.readyProjection(h.last('project').token, {performance:{kind:'set', value:value('idle')}})
  assert.equal(h.state.accepted.performance.phase, 'idle')
  assert.equal(h.last('present').performancePlayback.mode, 'seek')
  h.dispatch({type:'PAGE', index:0})
  const back = h.last('project')
  assert.equal(back.page.index, 0)
  h.readyProjection(back.token, {performance:{kind:'set', value:null}})
  assert.equal(h.state.accepted.performance, null)
  assert.equal(h.state.performancePlayback, null)
  assert.equal(h.last('present').performancePlayback, null)
  h.dispose()
})

test('client: while the window reports hidden a history jump keeps the last-good performance; visibility catches up', () => {
  const h = createStageRuntimeHarness(), s = source({turn:2}), pages = [1, 2, 3].map(para => page(para))
  h.dispatch({type:'HISTORY_JUMP', source:s, text:text(1, pages), anchor:pages[2].anchor})
  h.replyRead(h.state.observation.flight, direction(1, 3, {phase:'done', complete:true}))
  h.readyProjection(h.last('project').token, {performance:{kind:'set', value:value('idle')}})
  h.dispatch({type:'VISIBILITY', visible:false})
  const projected = h.effects('project').length
  h.dispatch({type:'HISTORY_JUMP', source:source({turn:1}), text:text(2, pages), anchor:pages[0].anchor})
  assert.equal(h.effects('project').length, projected, 'deferred: no director read while hidden')
  assert.equal(h.state.accepted.performance.phase, 'idle', 'stale until the window is visible again')
  h.dispatch({type:'VISIBILITY', visible:true})
  h.replyRead(h.state.observation.flight, direction(2, 3, {phase:'done', complete:true}))
  h.readyProjection(h.last('project').token, {performance:{kind:'set', value:null}})
  assert.equal(h.state.accepted.performance, null)
  h.dispose()
})

test('client: the first forward page turn onto the trigger page plays in real time on a completed (history) turn', () => {
  const h = createStageRuntimeHarness(), s = source({turn:3}), pages = [1, 2, 3, 4].map(para => page(para))
  h.dispatch({type:'HISTORY_JUMP', source:s, text:text(1, pages), anchor:pages[0].anchor})
  h.dispatch({type:'STAGE_OPEN', opened:true})
  h.replyRead(h.state.observation.flight, direction(1, 4, {phase:'done', complete:true}))
  h.readyProjection(h.last('project').token, {performance:{kind:'set', value:null}})
  h.dispatch({type:'PAGE', index:1})
  h.readyProjection(h.last('project').token, {performance:{kind:'set', value:value('entry')}})
  assert.equal(h.state.performancePlayback.mode, 'start', 'first forward visit plays the entry ritual')
  h.dispatch({type:'PERFORMANCE_EVENT_DUE', token:h.state.performancePlayback.token, key:'skin-0', atMs:0, descriptor:{do:'skin', block:'entry', ordinal:0, ref:{assetId:'cute'}}})
  assert.equal(h.last('performance-event').descriptor.do, 'skin', 'history playback events are not suppressed')
  h.dispatch({type:'PAGE', index:0})
  h.readyProjection(h.last('project').token, {performance:{kind:'set', value:null}})
  h.dispatch({type:'PAGE', index:1})
  h.readyProjection(h.last('project').token, {performance:{kind:'set', value:value('entry')}})
  assert.equal(h.state.performancePlayback.mode, 'seek', 'a revisit in the same visit snaps to the sustained state')
  // A jump (backlog) onto the trigger page snaps; turning forward into a completed turn lands like a page turn.
  h.dispatch({type:'HISTORY_JUMP', source:source({turn:4}), text:text(2, pages), anchor:pages[0].anchor})
  assert.equal(h.state.cursor.firstPageEligible, false)
  h.dispatch({type:'HISTORY_JUMP', source:source({turn:5}), text:text(3, pages), anchor:pages[0].anchor, forward:true})
  assert.equal(h.state.cursor.firstPageEligible, true)
  h.dispose()
})