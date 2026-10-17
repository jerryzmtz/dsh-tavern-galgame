// private fork (layered pilot phase 1): a parts 差分 of a hybrid-face-sprites manifest renders as the composite of one
// variant per group in the fixed order underlay → pose → face → mouth → front; lip-sync picks the mouth group's frame and
// blinking the face group's frame; a 差分 whose face part is missing is a missing image (calm stands in, reported).
import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import {readFile} from 'node:fs/promises'
import {createRequire} from 'node:module'
import contract from '../tavern-plugin/shared/sprite-emotions.cjs'
import {selectPackFigure, packGeometryKey} from '../tavern-plugin/lib/domain/asset-pack-presentation.js'
const require = createRequire(import.meta.url)
const {packFigureRenderInputs, packSpriteFallbacks} = require('../tavern-plugin/src/client/fork-pack-playback.cjs')
const {hybridSpriteRender, spriteViewManifest, resolveSpriteDisplay, spriteRenderManifest} = contract

import {GROUPS, hybridFixture} from './fixtures/layered-parts.mjs'
const assetsOf = manifest => {
  const out = {}
  const add = value => { if (typeof value === 'string' && /\.png$/.test(value)) out[value] = value.replace(/\W/g, '').padEnd(64, '0').slice(0, 64)
    else if (value && typeof value === 'object') Object.values(value).forEach(add) }
  add(manifest); return out
}

test('a parts 差分 resolves to its closure; stale core parts, missing parts and missing renders are missing images', () => {
  const m = hybridFixture(), calm = hybridSpriteRender(m, 'calm')
  assert.equal(calm.kind, 'parts')
  assert.deepEqual(calm.parts.drawOrder, GROUPS)
  assert.deepEqual(calm.parts.selection, {underlay:'base', pose:'none', face:'face-calm', mouth:'mouth-calm', front:'clip'})
  assert.deepEqual(calm.parts.mouthFrames, {closed:'mouth-closed', a:'mouth-a'})
  // An optional frame on an old base revision is dropped (eyes stay open), never drawn misaligned.
  assert.deepEqual(calm.parts.blinkFrames, {closed:'face-blink'})
  assert.deepEqual(Object.keys(calm.parts.parts).sort(), ['base', 'clip', 'face-blink', 'face-calm', 'mouth-a', 'mouth-calm', 'mouth-closed'])
  assert.deepEqual(hybridSpriteRender(m, 'shy').missing, [{kind:'part', id:'face-shy', code:'MISSING_PART', group:'face'}])
  assert.deepEqual(hybridSpriteRender(m, 'sad').missing, [{kind:'part', id:'face-old', code:'STALE_PART', group:'face'}])
  assert.equal(hybridSpriteRender(m, 'crying').kind, 'missing')
  assert.equal(hybridSpriteRender(m, 'singing').kind, 'whole')
  // Revisions are part of the identity: a new recipe/part revision is a new picture.
  const next = hybridFixture(); next.rigs.maid.parts['face-calm'].revision = 2
  assert.notEqual(hybridSpriteRender(next, 'calm').parts.revision, calm.parts.revision)
})

test('the layered view keeps whole 差分 on the legacy path and leaves missing ones out', () => {
  const m = hybridFixture(), view = spriteViewManifest(m)
  assert.equal(view, spriteViewManifest(m), 'cached per manifest object')
  assert.equal(view.kind, 'layered-static-sprites')
  assert.deepEqual(Object.keys(view.emotions).sort(), ['calm', 'eating', 'joy', 'singing'])
  assert.deepEqual(Object.keys(view.mouthSets).sort(), ['eating', 'singing'])
  assert.equal(view.emotions.singing.stage.src, 'emotions/singing/stage.png')
  assert.ok(view.emotions.joy.parts && !view.emotions.joy.stage)
  assert.deepEqual(Object.keys(view.hybrid.missing).sort(), ['crying', 'sad', 'shy'])
  const render = spriteRenderManifest(m)
  assert.deepEqual(render.states.map(s => s.id), ['calm', 'joy', 'singing', 'eating'])
  assert.equal(render.defaultState, 'calm')
  // Other kinds are untouched.
  const flat = {version:1, kind:'static-sprites', emotions:{calm:{src:'a.png'}}}
  assert.equal(spriteViewManifest(flat), flat)
})

test('missing face: calm stands in on stage and the visible fallback notice lists it (fix/missing-visible)', () => {
  const m = hybridFixture(), order = ['calm', 'joy', 'sad', 'shy']
  const shown = resolveSpriteDisplay(m, 'shy', order)
  assert.equal(shown.missing, true); assert.equal(shown.fallback, 'first-emotion') // private fork: no reserved fallback
; assert.equal(shown.resolvedEmotion, 'calm')
  assert.ok(shown.state.parts, 'calm stands in with its own composite')
  const figure = {enabled:true, name:'大肥鱼', appearance:'sprite', heightCm:150, emotions:order.map(id=>({id,label:id})),
    outfits:[{key:'default', label:'女仆装', enabled:true, emotions:order, sprite:{manifestKey:'maid', assets:assetsOf(m)}}]}
  const before = JSON.stringify(m)
  const selected = selectPackFigure(figure, {maid:m}, {emotion:'shy', appearance:'sprite'})
  assert.equal(selected.state.id, 'calm'); assert.equal(selected.spriteResolution.missing, true)
  assert.equal(JSON.stringify(m), before, 'nothing is written back')
  const rows = packSpriteFallbacks([{...selected, alias:'dfy', ref:{packId:'p', figureId:'f'}, views:{stage:true}}])
  assert.equal(rows.length, 1); assert.equal(rows[0].requested, 'shy'); assert.equal(rows[0].shown, 'calm')
  // An own parts 差分 is not a fallback.
  assert.equal(selectPackFigure(figure, {maid:m}, {emotion:'joy', appearance:'sprite'}).spriteResolution.missing, false)
})

test('stage inputs: a parts 差分 is a composed static figure with shared part URLs, no overlay blink', () => {
  const m = hybridFixture(), assets = assetsOf(m), order=Object.keys(m.emotions) // private fork: explicit availability
  const figure = {enabled:true, name:'大肥鱼', appearance:'sprite', heightCm:150, emotions:order.map(id=>({id,label:id})),
    outfits:[{key:'default', label:'女仆装', enabled:true, emotions:order, sprite:{manifestKey:'maid', assets}}]}
  const selected = selectPackFigure(figure, {maid:m}, {emotion:'joy', appearance:'sprite'})
  const urls = Object.fromEntries(Object.keys(assets).map(name => [name, '/media/' + assets[name]]))
  const geometry = {stage:packGeometryKey(selected, {}, 'stage'), portrait:null}
  const input = packFigureRenderInputs({...selected, alias:'dfy', ref:{packId:'p', figureId:'f'}, media:{sprite:{identity:'p:' + geometry.stage}}, views:{stage:true, portrait:false},
    geometry, spritePack:selected.manifest, spriteUrls:urls}).stage
  assert.ok(input.src.startsWith('fork-parts:'))
  assert.equal(input.blinkBundle, null); assert.equal(input.mouthBundle, null)
  const parts = input.spriteBundle.parts
  assert.deepEqual(Object.values(parts.parts).map(p => p.src).sort(), Object.keys(parts.parts).map(id => '/media/' + assets['parts/' + id + '.png']).sort())
  // calm and joy share the underlay part (one texture); their geometry keys differ.
  const calm = selectPackFigure(figure, {maid:m}, {emotion:'calm', appearance:'sprite'})
  assert.equal(calm.state.parts.parts.base.src, selected.state.parts.parts.base.src)
  assert.notEqual(packGeometryKey(calm, {}, 'stage'), geometry.stage)
})

async function renderer() {
  const source = await readFile(new URL('../tavern-plugin/src/client/fork-layered-sprite.cjs', import.meta.url), 'utf8')
  const render = await readFile(new URL('../tavern-plugin/src/client/fork-layered-sprite-render.js', import.meta.url), 'utf8')
  const calls = []
  const canvas = () => ({width:0, height:0, getContext:() => ({save(){calls.push(['save'])}, restore(){calls.push(['restore'])}, beginPath(){}, clip(){calls.push(['clip'])},
    rect(...a){calls.push(['rect', ...a])}, clearRect(...a){calls.push(['clear', ...a])}, drawImage(image, x, y){calls.push(['draw', image.id, x, y])}})})
  const context = {document:{createElement:canvas}, forkForeground:{now:() => 0}}
  vm.runInNewContext(source + '\n' + render, context)
  return {context, calls, canvas}
}
function imagesOf(parts) {
  return new Map(Object.entries(parts.parts).map(([id, part]) => [part.src, {id, width:part.rect[2], height:part.rect[3]}]))
}

test('composition order and mouth / blink folding into groups 04 and 03', async () => {
  const {context} = await renderer(), parts = hybridSpriteRender(hybridFixture(), 'calm').parts
  const layers = (event, blink) => [...context.forkPartsLayers(parts, event, blink)]
  assert.deepEqual(layers('initial', 'open'), ['base', 'face-calm', 'mouth-calm', 'clip'])
  assert.deepEqual(layers('a', 'open'), ['base', 'face-calm', 'mouth-a', 'clip'])
  assert.deepEqual(layers('e', 'open'), ['base', 'face-calm', 'mouth-closed', 'clip'], 'a vowel without its own frame uses the closed frame')
  assert.deepEqual(layers('closed', 'closed'), ['base', 'face-blink', 'mouth-closed', 'clip'])
  assert.deepEqual(layers('initial', 'half'), ['base', 'face-calm', 'mouth-calm', 'clip'], 'no half frame: the eyes stay open')
  // No frames at all (joy): lip-sync and blinking keep the rest face.
  const joy = hybridSpriteRender(hybridFixture(), 'joy').parts
  assert.deepEqual([...context.forkPartsLayers(joy, 'a', 'closed')], ['base', 'face-joy', 'mouth-calm'])
  assert.deepEqual([...context.forkPartsUrls(parts)].length, 7)
})

test('painter draws each part at its rect in group order, then repaints only the changed region', async () => {
  const {context, calls, canvas} = await renderer(), parts = hybridSpriteRender(hybridFixture(), 'calm').parts, images = imagesOf(parts)
  const surface = canvas(), bundle = {parts}
  context.forkSpritePaint(surface, bundle, images, 'initial', 'open')
  assert.equal(surface.width, 100); assert.equal(surface.height, 150)
  assert.deepEqual(calls.filter(c => c[0] === 'draw'), [['draw', 'base', 0, 0], ['draw', 'face-calm', 30, 30], ['draw', 'mouth-calm', 42, 52], ['draw', 'clip', 20, 10]])
  assert.deepEqual(calls.find(c => c[0] === 'clear'), ['clear', 0, 0, 100, 150])
  calls.length = 0
  context.forkSpritePaint(surface, bundle, images, 'a', 'open')
  // Only the mouth region (old rest mouth ∪ new open mouth) is cleared and redrawn, with every layer that touches it.
  assert.deepEqual(calls.find(c => c[0] === 'clear'), ['clear', 42, 52, 16, 12])
  assert.deepEqual(calls.filter(c => c[0] === 'draw').map(c => c[1]), ['base', 'mouth-a'])
  calls.length = 0
  context.forkSpritePaint(surface, bundle, images, 'a', 'open')
  assert.equal(calls.length, 0, 'an unchanged frame paints nothing')
  context.forkSpritePaint(surface, bundle, images, 'a', 'closed')
  // The eye region (30,30 40×20) does not reach the mouth (y ≥ 52): the mouth is not redrawn.
  assert.deepEqual(calls.filter(c => c[0] === 'draw').map(c => c[1]), ['base', 'face-blink', 'clip'])
  assert.deepEqual(calls.find(c => c[0] === 'clear'), ['clear', 30, 30, 40, 20])
  // A part of the wrong size is refused (the stage keeps its last good picture).
  images.set(parts.parts['mouth-a'].src, {id:'mouth-a', width:1, height:1})
  assert.throws(() => context.forkSpritePaint(canvas(), bundle, images, 'a', 'open'))
})
