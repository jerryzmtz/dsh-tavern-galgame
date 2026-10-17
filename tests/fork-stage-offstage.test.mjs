import {stagePageSource} from './helpers/stage-page-source.mjs' // private fork
// private fork: distance focus is no longer a submission value.
// private fork: follow protocol extraction paths; behavior assertions unchanged.
import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'
import { forkStageOffstage } from '../tavern-plugin/src/client/fork-stage-offstage.cjs'

const config = {
  stage: { protagonist: 'legacy' },
  characters: [{ alias: 'a', name: 'Actor' }, { alias: 'hidden', name: 'Hidden', offstage: true, note: 'PRIVATE NOTE', outfitLabel: 'PRIVATE OUTFIT' }, { alias: 'voice', name: 'Voice', offstage: true }, { alias: 'legacy', name: 'Legacy' }]
}
const context = { ...config, units: 3, start: { cast: ['a', 'hidden'], order: ['hidden', 'a'], outfits: { hidden: 'PRIVATE OUTFIT' }, focus: { hidden: 'near' }, look: { a: 'hidden' }, positions: { hidden: 'left' }, camera: { value: 'close', id: 'hidden' }, dof: 'voice', figureLight: { voice: 'glow' } } }

const shared = await readFile(new URL('../tavern-plugin/packages/dsh-presentation-protocol/src/fork-stage-light.cjs', import.meta.url), 'utf8') + await readFile(new URL('../tavern-plugin/src/client/fork-stage-offstage.cjs', import.meta.url), 'utf8')
const stage = await readFile(new URL('../tavern-plugin/src/client/fork-gal-stage.js', import.meta.url), 'utf8')
const scene = await readFile(new URL('../tavern-plugin/src/client/fork-gal-scene.js', import.meta.url), 'utf8')
const effects = await readFile(new URL('../tavern-plugin/src/client/fork-gal-effects.js', import.meta.url), 'utf8')
const live2d = await readFile(new URL('../tavern-plugin/src/client/fork-live2d.js', import.meta.url), 'utf8')
const client = { window: {}, module: { exports: { preserved: true } } }
vm.runInNewContext(shared + '\n' + live2d.slice(live2d.indexOf('function forkLive2dSlots'), live2d.indexOf('\n', live2d.indexOf('function forkLive2dSlots'))) + '\n' +
  scene.slice(scene.indexOf('// ---------- Scene helpers'), scene.indexOf('// ---------- Scene runtime')) +
  effects.slice(effects.indexOf('// ---------- Effect helpers'), effects.indexOf('// ---------- Effect runtime')) +
  (stagePageSource + '\n' + stage.slice(stage.indexOf('// Plain reading text'), stage.indexOf('// The stage is a full-screen mode'))) +
  ';this.offstage=forkStageOffstage;this.cast=forkGalCast;this.cue=forkGalCue;this.staging=forkGalStaging;this.pages=forkGalPages;', client)
const plain = value => JSON.parse(JSON.stringify(value))

test('shared offstage helper uses every flag, falling back to legacy only for an empty set', () => {
  for (const value of [config, { stage: { protagonist: 'legacy' }, characters: [{ alias: 'legacy' }] }, { characters: [] }, undefined]) {
    assert.deepEqual([...client.offstage(value)], [...forkStageOffstage(value)])
  }
  assert.deepEqual([...forkStageOffstage(config)], ['hidden', 'voice'])
  assert.deepEqual([...forkStageOffstage({ stage: { protagonist: 'legacy' }, characters: [{ alias: 'legacy', offstage: false }] })], ['legacy'])
  assert.deepEqual(client.module.exports, { preserved: true }, 'browser include must not overwrite the client module')
})

test('client replays old records without offstage cast, outfits, gaze, camera or one-shots', () => {
  const direction = { status: 'done', start: context.start, entries: [{ at: 2, cast: ['a', 'hidden', 'voice'], outfits: { hidden: 'PRIVATE OUTFIT', a: 'coat' }, commands: [
    { op: 'enter', id: 'hidden', value: 'left' }, { op: 'exit', id: 'voice', value: 'right' }, { op: 'focus', id: 'hidden', value: 'close' },
    { op: 'look', id: 'a', value: 'voice' }, { op: 'cam', id: 'hidden', value: 'close' }, { op: 'dof', id: 'voice' },
    { op: 'emote', id: 'hidden', value: '!' }, { op: 'act', id: 'voice', value: 'nod' }, { op: 'outfit', id: 'hidden', value: 'coat' },
    { op: 'flash', id: 'hidden' }, { op: 'act', id: 'a', value: 'nod' }
  ] }] }
  const offstage = forkStageOffstage(config), before = JSON.stringify(direction)
  for (const at of [1, 2, 3]) {
    const result = plain(client.staging(direction, at, offstage))
    assert.deepEqual(result.members.map(member => member.id), ['a'])
    assert.equal(result.members[0].look, '')
    assert.deepEqual(result.camera, { value: '' })
    assert.equal(result.dof, '')
    assert.doesNotMatch(JSON.stringify(result), /hidden|voice/)
    assert.deepEqual(result.effects, at === 2 ? [{ op: 'act', id: 'a', value: 'nod' }] : [])
    const cue = plain(client.cue(direction, at, offstage))
    assert.deepEqual(cue.cast, ['a'])
    assert.doesNotMatch(JSON.stringify(cue), /hidden|voice|PRIVATE/)
  }
  assert.equal(JSON.stringify(direction), before, 'stored records are never rewritten')
})

test('heuristic cast excludes offstage before the three-person cap, preserving dialogue pages and voice', () => {
  const names = ['a', 'b', 'c', 'hidden', 'voice']
  const pages = client.pages([{ voices: { 3: { id: 'voice-handle' } }, segments: names.map(alias => ({ kind: 'bubble', alias, name: alias, text: 'Line from ' + alias })) }])
  const offstage = forkStageOffstage(config)
  assert.deepEqual(Array.from(client.cast(pages, 4, offstage), item => item.alias), ['a', 'b', 'c'])
  assert.equal(pages[3].alias, 'hidden'); assert.equal(pages[3].text, 'Line from hidden')
  assert.equal(pages[3].voice.id, 'voice-handle'); assert.equal(pages[4].name, 'voice')
  // private fork: keep full directed slots, then filter pending/offstage render inputs.
  assert.match(stage, /packStageMembers\(state\)\.filter\(member => !!renderInputs.get\(member.id\)\?\.stage\)/)
  assert.match(stage, /const faceMode = film \|\| accepted\.cg \|\| cg\.visible \? 'off' : 'always';/) // private fork: CG owns the face gate until exit
  assert.match(stage, /const portraitFace = !film && speaker \? portraits.get\(speaker\)/)
})
