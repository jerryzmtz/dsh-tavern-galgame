// private fork: named command registry validates insertions and forbids survivor reordering.
import commands from '../tavern-plugin/packages/dsh-presentation-protocol/src/director-commands.cjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { PACK_ID, FIGURE_ID } from './fixtures/asset-packs/pack.mjs'
import { assetPackDimensions, assetPackOperationSchema, initialAssetPackStage, reduceAssetPackOperation, validateAssetPackStage, validateAssetPackToolValue } from '../tavern-plugin/lib/domain/stage-asset-pack-tools.js'
const { packStageMembers } = createRequire(import.meta.url)('../tavern-plugin/src/client/fork-pack-playback.cjs')
const actors = Object.fromEntries(['alice', 'bob', 'carol', 'dave'].map(id => [id, {figure:{packId:PACK_ID, figureId:FIGURE_ID}, outfits:[{key:'school',enabled:true}]}]))
const context = {actors, dimensions:assetPackDimensions(), catalogue:{candidates:Object.fromEntries(['backgrounds','music','sfx','ambience','looks','widgets'].map(kind => [kind, []]))}}
function reducer() {
  let state = initialAssetPackStage(actors)
  return {get state() { return state }, run(op) { validateAssetPackToolValue(op, schema()); state = reduceAssetPackOperation(state, op, context).state; return state.cast }}
}
const schema = () => ({...assetPackOperationSchema(context), $defs:commands.defs(context)})
const enter = (actor, position) => ({op:'cast.add', actor, ...(position?.startsWith('after ') ? {after:position.slice(6)} : position ? {position} : {})})
test('entry slots are consumed once and never become shared positions', () => {
  const r = reducer()
  assert.deepEqual(r.run(enter('alice', 'left')), ['alice'])
  assert.deepEqual(r.run(enter('bob', 'left')), ['bob','alice'])
  assert.deepEqual(r.run(enter('carol', 'center')), ['bob','carol','alice'])
  assert.throws(() => r.run(enter('alice', 'left')), /already on stage/)
  assert.deepEqual(r.state.cast, ['bob','carol','alice'])
  assert.deepEqual(packStageMembers(r.state).map(({id,x}) => [id,x]), [['bob',0.25],['carol',0.5],['alice',0.75]])
  assert.deepEqual(packStageMembers(r.state, id => id !== 'carol').map(({id,x}) => [id,x]), [['bob',1/3],['alice',2/3]])
  // private fork: normal cast membership is not a safety quota; layout already supports more actors.
  assert.deepEqual(r.run(enter('dave')), ['bob','carol','alice','dave'])
  assert.deepEqual(packStageMembers(r.state).map(({id,x}) => [id,x]), [['bob',0.2],['carol',0.4],['alice',0.6],['dave',0.8]])
  assert.equal(Object.hasOwn(r.state.actors.alice, 'position'), false)
  assert.equal(Object.hasOwn(r.state.actors.alice, 'focus'), false)
})
test('after requires an on-stage anchor; exit and reentry may choose a new slot', () => {
  const r = reducer()
  assert.throws(() => r.run(enter('bob', 'after alice')), /anchor/)
  r.run(enter('alice')); r.run(enter('bob')); r.run(enter('carol', 'after alice'))
  assert.deepEqual(r.state.cast, ['alice','carol','bob'])
  r.run({op:'cast.remove', actor:'alice'})
  assert.deepEqual(r.run(enter('alice','right')), ['carol','bob','alice'])
})
test('bulk membership cannot reorder surviving actors', () => {
  const r = reducer(); r.run(enter('alice')); r.run(enter('bob'))
  assert.throws(() => r.run({op:'cast.set', actors:['bob','alice','carol']}), /survivors/)
  assert.deepEqual(r.state.cast, ['alice','bob'])
  assert.deepEqual(r.run({op:'cast.set', actors:['alice','bob','carol']}), ['alice','bob','carol'])
  assert.throws(() => r.run({op:'cast.set', actors:['carol','dave','alice']}), /survivors/)
  assert.deepEqual(r.run({op:'cast.set', actors:['alice','carol','dave']}), ['alice','carol','dave'])
})
test('both tools reject legacy anchors and persistent depth; named close-up stays available', () => {
  for (const full of [false,true]) {
    const schema = {...assetPackOperationSchema(context, full), $defs:commands.defs(context)}
    for (const position of ['auto','far-left','far-right']) assert.throws(() => validateAssetPackToolValue(enter('alice',position),schema))
    assert.throws(() => reduceAssetPackOperation(initialAssetPackStage(actors), enter('alice','after nobody'), context))
    for (const value of [{position:'left'},{focus:'near'},{focus:'far'},{focus:'normal'},{focus:'close'}]) assert.throws(() => validateAssetPackToolValue({op:'actor.patch',actor:'alice',value},schema))
    // private fork: the only close-up command is camera.close; removed focus ops are invalid.
    validateAssetPackToolValue({op:'closeup.play',actor:'alice'},schema)
    for (const op of ['actor.focus.close','actor.focus.reset']) assert.throws(() => validateAssetPackToolValue({op,actor:'alice'},schema))
    for (const value of ['normal','far','near']) assert.throws(() => validateAssetPackToolValue({op:'event',value:{op:'focus',id:'alice',value}},schema))
  }
  const state = initialAssetPackStage(actors)
  state.actors.alice.position = 'left'
  assert.throws(() => validateAssetPackStage(state))
})
