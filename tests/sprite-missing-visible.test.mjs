// private fork (owner rule 「可以有 fallback，不能静默掩盖缺图」): the stage's display fallback for a missing 差分 image
// uses only the same outfit's default image and is reported; no arbitrary image is borrowed.
// It never writes into the data (the slot stays missing).
import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import {readFile} from 'node:fs/promises'
import {createRequire} from 'node:module'
import contract from '../tavern-plugin/shared/sprite-emotions.cjs'
import {selectPackFigure, figureEmotionOrder} from '../tavern-plugin/lib/domain/asset-pack-presentation.js'
const require = createRequire(import.meta.url)
const {packFigureRenderInputs, packSpriteFallbacks, packSpriteStandIn} = require('../tavern-plugin/src/client/fork-pack-playback.cjs')
const {resolveSpriteDisplay} = contract
const manifest = ids => ({version:1, kind:'static-sprites', emotions:Object.fromEntries(ids.map(id => [id, {src:'emotions/' + id + '/stage.png'}]))})
const figure = (ids, extra = {}) => ({enabled:true, name:'大肥鱼', appearance:'sprite', emotions:[...new Set([...ids,'sad'])].map(id=>({id,label:({joy:'喜悦',sad:'悲伤','e-mine':'得意'})[id]||id})),
  outfits:[{key:'maid', label:'女仆装', enabled:true, sprite:{manifestKey:'maid', assets:Object.fromEntries(ids.map(id => ['emotions/' + id + '/stage.png', id.padEnd(64, '0')]))}, ...extra}]})

test('fallback order: own -> same-outfit default only -> unavailable', () => {
  const order = ['calm', 'joy', 'anger', 'sad']
  assert.deepEqual({...resolveSpriteDisplay(manifest(['calm', 'joy']), 'joy', order), state:undefined},
    {requestedEmotion:'joy', resolvedEmotion:'joy', missing:false, intentionalFallback:false, reason:'own', fallback:null, state:undefined})
  const calm = resolveSpriteDisplay(manifest(['calm', 'joy']), 'sad', order)
  assert.equal(calm.resolvedEmotion, 'calm'); assert.equal(calm.missing, true); assert.equal(calm.fallback, 'first-emotion')
  // private fork: neither an old ID nor undeclared media overrides availability/order.
  assert.equal(resolveSpriteDisplay(manifest(['calm','joy']),'sad',['joy','calm']).resolvedEmotion,'joy')
  assert.equal(resolveSpriteDisplay(manifest(['joy']),'joy',[]).state,null)
  // Existing unrelated art cannot replace a missing default.
  const first = resolveSpriteDisplay(manifest(['sad', 'anger']), 'joy', order)
  assert.equal(first.resolvedEmotion,null); assert.equal(first.state,null); assert.equal(first.missing,true)
  assert.equal(resolveSpriteDisplay(manifest(['sad', 'anger']), 'calm', order).resolvedEmotion,null)
  assert.equal(resolveSpriteDisplay(manifest(['shy']), 'joy').resolvedEmotion,null)
  const none = resolveSpriteDisplay(manifest([]), 'joy', order)
  assert.equal(none.state, null); assert.equal(none.reason, 'missing-sprite'); assert.equal(none.fallback, 'avatar')
  assert.equal(resolveSpriteDisplay(null, 'joy', order).fallback, 'avatar')
})

test('the 差分 order is declared, without stock insertions', () => {
  const order = figureEmotionOrder({emotions:[{id:'joy',label:'喜悦', guidance:'x'}, {id:'e-mine', label:'得意'}]})
  assert.equal(order[0], 'joy') // private fork
; assert.equal(order.at(-1), 'e-mine'); assert.equal(order.filter(id => id === 'joy').length, 1)
})

test('selectPackFigure keeps the figure on stage when calm is missing and never writes the data', () => {
  const f = figure(['joy', 'e-mine']), sprites = {maid:manifest(['e-mine', 'joy'])}, before = structuredClone({f, sprites})
  const selected = selectPackFigure(f, sprites, {emotion:'sad'})
  assert.equal(selected.form, 'sprite'); assert.equal(selected.state.id, 'joy', 'explicit outfit order before manifest key order')
  assert.deepEqual({...selected.spriteResolution, state:undefined}, {requestedEmotion:'sad', resolvedEmotion:'joy', missing:true, intentionalFallback:false, reason:'missing-emotion', fallback:'first-emotion', state:undefined,
    labels:{figure:'大肥鱼', sad:'悲伤', joy:'喜悦'}})
  assert.deepEqual({f, sprites}, before, 'display fallback only; the slot stays missing in the data')
  assert.equal(Object.hasOwn(sprites.maid.emotions, 'calm'), false)
  const own = selectPackFigure(f, sprites, {emotion:'e-mine'})
  assert.equal(own.spriteResolution.missing, false); assert.equal(own.spriteResolution.labels, undefined, 'no labels unless something is missing')
})

test('report payload: one row per on-stage sprite fallback, with what was asked and what was shown', () => {
  const base = {form:'sprite', views:{stage:true}, outfitKey:'maid', outfit:{label:'女仆装'}}
  const characters = [
    {...base, alias:'fish', ref:{packId:'p', figureId:'f'}, spriteResolution:{requestedEmotion:'calm', resolvedEmotion:'joy', missing:true, state:{id:'joy'}, labels:{figure:'大肥鱼', calm:'平和', joy:'喜悦'}}},
    {...base, alias:'cat', ref:{packId:'p', figureId:'c'}, spriteResolution:{requestedEmotion:'sad', resolvedEmotion:null, missing:true, state:null, labels:{figure:'猫', sad:'悲伤'}}},
    {...base, alias:'dog', ref:{packId:'p', figureId:'d'}, spriteResolution:{requestedEmotion:'joy', resolvedEmotion:'calm', missing:true, state:{id:'calm'}}},
    {...base, alias:'own', ref:{packId:'p', figureId:'o'}, spriteResolution:{requestedEmotion:'joy', resolvedEmotion:'joy', missing:false, state:{id:'joy'}}},
    {...base, alias:'off', ref:{packId:'p', figureId:'x'}, spriteResolution:{requestedEmotion:'joy', resolvedEmotion:'calm', missing:true, state:{id:'calm'}}},
    {...base, form:'live2d', alias:'live', ref:{packId:'p', figureId:'l'}, spriteResolution:{requestedEmotion:'joy', missing:true, state:null}},
  ]
  const rows = packSpriteFallbacks(characters, alias => alias !== 'off', alias => alias === 'cat')
  assert.deepEqual(rows.map(row => [row.alias, row.figure, row.outfit, row.requested, row.shown, row.requestedLabel, row.shownLabel]), [
    ['fish', '大肥鱼', '女仆装', 'calm', 'joy', '平和', '喜悦'],
    ['cat', '猫', '女仆装', 'sad', '@avatar', '悲伤', ''],
    ['dog', '', '女仆装', 'joy', 'calm', '', ''],
  ])
  assert.equal(new Set(rows.map(row => row.key)).size, 3)
  assert.equal(packSpriteFallbacks([characters[1]], () => true, () => false)[0].shown, null, 'nothing to show is still reported')
  assert.equal(packSpriteStandIn(characters[1]), true); assert.equal(packSpriteStandIn(characters[0]), false); assert.equal(packSpriteStandIn(characters[5]), false)
})

test('a calm-less outfit still renders its first 差分 on the stage', () => {
  const f = figure(['joy']), sprites = {maid:manifest(['joy'])}, selected = selectPackFigure(f, sprites, {emotion:'calm'})
  const rendered = packFigureRenderInputs({...selected, alias:'fish', ref:{packId:'p', figureId:'f'}, revision:'r', geometry:{stage:'g'}, views:{stage:true, portrait:false},
    media:{sprite:{identity:'s'}, avatar:{identity:null}}, spritePack:{...sprites.maid, emotions:{joy:{src:'/lease/joy.png'}}}, avatarUrl:null})
  assert.equal(rendered.stage.src, '/lease/joy.png')
})

test('stage notice: deduped per session, one line per figure · outfit · 差分 → shown', async () => {
  const source = await readFile(new URL('../tavern-plugin/src/client/fork-gal-stage.js', import.meta.url), 'utf8')
  const block = source.slice(source.indexOf('function useForkGalSpriteFallbacks'), source.indexOf('// A sprite outfit without any image'))
  const refs = []
  const context = {React:{useRef:() => { const ref = refs[0] || (refs[0] = {current:null}); return ref }}}
  vm.runInNewContext(block, context)
  const row = (key, shown) => ({key, alias:'fish', figure:'大肥鱼', outfit:'女仆装', requested:'joy', requestedLabel:'喜悦', shown, shownLabel:shown === 'calm' ? '平和' : ''})
  const first = context.useForkGalSpriteFallbacks('s', [row('a', 'calm')])
  assert.equal(context.useForkGalSpriteFallbacks('s', [row('a', 'calm')]), first, 'same rows keep one list')
  assert.equal(context.useForkGalSpriteFallbacks('s', [row('a', 'calm'), row('b', '@avatar')]).length, 2)
  assert.equal(context.useForkGalSpriteFallbacks('s', []).length, 2, 'kept for the session')
  assert.equal(context.useForkGalSpriteFallbacks('t', []).length, 0, 'a new session starts empty')
  assert.equal(context.forkGalSpriteFallbackLine(row('a', 'calm')), '大肥鱼 · 女仆装 · 喜悦 → 平和')
  assert.equal(context.forkGalSpriteFallbackLine({...row('b', '@avatar'), figure:''}, alias => alias === 'fish' ? '鱼' : ''), '鱼 · 女仆装 · 喜悦 → 头像（小图）')
  assert.equal(context.forkGalSpriteFallbackLine(row('c', null)), '大肥鱼 · 女仆装 · 喜悦 → 没有可显示的图')
  assert.equal(context.forkGalSpriteFallbackTitle([row('a', 'calm')]), '差分缺图，已临时显示平和')
  assert.equal(context.forkGalSpriteFallbackTitle([row('a', 'calm'), row('b', 'joy')]), '差分缺图，已临时替代显示')
})
