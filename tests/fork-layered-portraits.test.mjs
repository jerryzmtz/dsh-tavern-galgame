import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from "node:fs/promises"

import vm from 'node:vm'

import {normalizeStagePortraits} from '../tavern-plugin/lib/domain/stage-portraits.js'
import { collectPortraitAssets, normalizePortraitRig, portraitWebpSize, validatePortraitRigAssets } from '../tavern-plugin/lib/domain/stage-portrait-rig.js'
import { validateStagePortraitIndex, mergeStagePortraitIndexes } from '../tavern-plugin/lib/domain/stage-portrait-pack.js'
import { image, sha, rigId, fixture } from './fixtures/fork-mouth-rig.mjs'

const source = await readFile(new URL('../tavern-plugin/src/client/fork-gal-mouth.js', import.meta.url), 'utf8'), ctx = {}
vm.runInNewContext(source + ';Object.assign(this,{forkGalMouthStep,forkGalMouthTransform,forkGalMouthPoint,forkGalMouthLayers,forkGalMouthBundle});', ctx)
const plain = value => JSON.parse(JSON.stringify(value))

test('mouth rig v2: whitelist, legacy compatibility, stale binding and invalid references', () => {
  const raw = fixture(), valid = normalizeStagePortraits(raw)
  assert.equal(valid.version, 2)
  assert.deepEqual(valid.rigs, raw.rigs)
  assert.deepEqual(valid.portraits[0].layered, raw.portraits[0].layered)
  assert.deepEqual(collectPortraitAssets(valid.portraits[0], valid.rigs), [sha])
  assert.equal(normalizeStagePortraits({ portraits: [{ id: raw.portraits[0].id, images: { default: sha } }] }).version, 1)
  for (const edit of [b => b.canvas[0] = 4097, b => b.mouth.anchor.x = NaN, b => b.mouth.anchor.scale = -1, b => b.mouth.anchor.rotation = 46, b => b.mouth.cover.rect[2] = 99999, b => b.imageSha = 'a'.repeat(64), b => b.mouth.set = 'absent']) {
    const bad = fixture(); edit(bad.portraits[0].layered.bindings.default)
    assert.deepEqual(normalizeStagePortraits(bad).portraits[0].layered.bindings, {})
  }
  for (const edit of [r => delete r.mouthSets.neutral.frames.open, r => r.mouthSets.neutral.canvas[0] = 513, r => r.mouthSets.neutral.pivot[1] = Infinity]) {
    const bad = fixture().rigs[rigId]; edit(bad); assert.equal(normalizePortraitRig(bad), null)
  }
})

test('rig asset validation checks real WebP dimensions, truncation, digest and complete closure', async () => {
  assert.deepEqual(portraitWebpSize(image), [8, 8])
  assert.throws(() => portraitWebpSize(image.subarray(0, 25)), /WebP/)
  await validatePortraitRigAssets(fixture(), async () => image)
  await assert.rejects(validatePortraitRigAssets(fixture(), async () => undefined), /Missing/)
  await assert.rejects(validatePortraitRigAssets(fixture(), async () => Buffer.alloc(24)), /corrupt/)
  const raw = fixture(); raw.portraits[0].layered.bindings.default.imageSha = 'a'.repeat(64)
  await assert.rejects(validateStagePortraitIndex(raw, async () => image), /binding/)
})

test('four mouth levels: inclusive upward thresholds, hysteresis, 80ms hold and silence priority', () => {
  const step = ctx.forkGalMouthStep, key = {}
  let s = step(null, 0.199, true, 0, key)
  assert.equal(s.frame, 'closed')
  s = step(s, 0.20, true, 1, key); assert.equal(s.frame, 'small')
  assert.equal(step(s, 0.99, true, 80, key).frame, 'small')
  s = step(s, 0.45, true, 81, key); assert.equal(s.frame, 'mid')
  assert.equal(step(s, 0.32, true, 161, key).frame, 'mid')
  s = step(s, 0.72, true, 161, key); assert.equal(s.frame, 'open')
  assert.equal(step(s, 0.58, true, 241, key).frame, 'open')
  assert.equal(step(s, 0.579, true, 241, key).frame, 'mid')
  for (const [level, voiced] of [[0, true], [NaN, true], [Infinity, true], [1, false]]) assert.equal(step(s, level, voiced, 162, key).frame, 'closed')
  assert.equal(step(null, 1, true, 0, key).frame, 'open', 'accent can skip levels')
  assert.equal(step(s, 0.21, true, 162, {}).frame, 'small', 'new audio discards held open state')
  assert.equal(step(s, 0.21, true, 0, key).frame, 'small', 'clock reset discards stale state')
  assert.equal(step(s, 0.21, true, 500, key).frame, 'small', 'tab resume discards stale state')
})

test('mouth hold is time-based at 30/60/120Hz; noisy thresholds do not chatter', () => {
  const step = ctx.forkGalMouthStep
  for (const hz of [30, 60, 120]) {
    let s = null, seed = 3
    for (let i = 0; i < hz * 4; i++) {
      const now = i * 1000 / hz; seed = (seed * 16807) % 2147483647
      const before = s; s = step(s, 0.6 + 0.15 * seed / 2147483647, true, now, 'same')
      if (before && s.frame !== before.frame) assert.ok(now - before.changedAt >= 80)
    }
    s = step(s, 0.5, true, 4000, 'same')
    for (let i = 1; i < hz; i++) { s = step(s, 0.45 + (i % 2 ? 0.01 : -0.01), true, 4000 + i * 1000 / hz, 'same'); assert.equal(s.frame, 'mid') }
  }
})

test('render order, pivot transform, mirror/act/breath/headroom inherited through base sprite', async () => {
  const b = fixture().portraits[0].layered.bindings.default, set = fixture().rigs[rigId].mouthSets.neutral
  b.mouth.anchor = { x: 3, y: 5, scale: 2, rotation: 90 }
  assert.deepEqual(plain(ctx.forkGalMouthPoint(b, set, { x: 4, y: 4 })), { x: 3, y: 5 })
  assert.deepEqual(plain(ctx.forkGalMouthPoint(b, set, { x: 5, y: 4 })), { x: 3, y: 7 })
  const t = ctx.forkGalMouthTransform(b, set, { x: .5, y: 1 })
  assert.equal(t.x, -1); assert.equal(t.y, -3); assert.equal(t.rotation, Math.PI / 2)
  assert.deepEqual(plain(ctx.forkGalMouthLayers('patch', 'open', true)), ['base', 'cover', 'mouth'])
  assert.deepEqual(plain(ctx.forkGalMouthLayers('patch', 'closed', false)), ['base'])
  assert.deepEqual(plain(ctx.forkGalMouthLayers('mouthless', 'closed', false)), ['base', 'mouth'])
  const scene = await readFile(new URL('../tavern-plugin/src/client/fork-gal-scene.js', import.meta.url), 'utf8')
  assert.ok(scene.indexOf('sprite.addChild(entry.mouthCover)') < scene.indexOf('sprite.addChild(entry.mouthSprite)'))
  assert.match(scene, /sprite\.scale\.set\(L\.scale \* entry\.flip\.v \* act\.flip \* act\.scaleX, L\.scale \* breath \* act\.scaleY\)/)
  // A mirrored, breathed base and translated parent apply to the entire mouth transform, once.
  const local = { x: t.x, y: t.y }, world = { x: 100 - 3 * local.x, y: 200 + 7 + 3 * 1.008 * local.y }
  assert.deepEqual(world, { x: 103, y: 197.928 })
})

test('rig merge reuses identical IDs, rejects conflicting rigs with dependent portraits', () => {
  const current = fixture(), incoming = fixture('sp9876543210'); incoming.portraits[0].label = 'Second'
  assert.equal(mergeStagePortraitIndexes(current, incoming).value.portraits.length, 2)
  incoming.rigs[rigId].label = 'Different'
  const result = mergeStagePortraitIndexes(current, incoming)
  assert.deepEqual(result.clashes.map(c => c.kind), ['rigs', 'portraits'])
  assert.equal(result.value.portraits.length, 1)
  assert.deepEqual(result.value.rigs, current.rigs)
})
