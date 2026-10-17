// private fork (layered renderer fix, output/layered-trial/pilot/CONTRACT.md + RESULT-backend.md): part.clearRect is carried
// by the resolver and cleared right before its part (stage compositor incl. partial repaints, and the editor thumbnail);
// a hybrid whole may be a native static-sprites manifest (flat still/talk/mouth rig/blink, never "missing");
// render.preview is used only when render.previewRevision equals the native rest revision.
import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import {readFile} from 'node:fs/promises'
import {createRequire} from 'node:module'
import contract from '../tavern-plugin/shared/sprite-emotions.cjs'
import backend from '../tavern-plugin/packages/dsh-asset-library/lib/shared/hybrid-sprite.cjs'
import {selectPackFigure, packGeometryKey} from '../tavern-plugin/lib/domain/asset-pack-presentation.js'
import {hybridFixture} from './fixtures/layered-parts.mjs'
const require = createRequire(import.meta.url)
const {packFigureRenderInputs} = require('../tavern-plugin/src/client/fork-pack-playback.cjs')
const {hybridSpriteRender, spriteViewManifest} = contract

// The fixture plus a pose with clearRect (an old arm hidden under the new one) and a flat static-sprites whole.
function fixture() {
  const m = hybridFixture(), rig = m.rigs.maid
  rig.parts['arm-up'] = {group:'pose', src:'parts/arm-up.png', rect:[60, 20, 20, 30], bbox:[0, 0, 20, 30], revision:1, baseRevision:2, clearRect:[60, 50, 30, 40]}
  rig.recipes.wave = {revision:1, selection:{underlay:'base', pose:'arm-up', face:'face-calm', mouth:'mouth-calm', front:'clip'}, mouthFrames:{a:'mouth-a'}}
  m.emotions.wave = {render:{kind:'parts', rig:'maid', recipe:'wave'}}
  m.emotions.smug = {render:{kind:'whole', legacy:{version:1, kind:'static-sprites',
    rig:{mouthSets:{normal:{canvas:[4, 4], pivot:[2, 2], frames:{closed:'flat/closed.png', a:'flat/a.png'}}}},
    emotions:{smug:{src:'flat/smug.png', talk:'flat/smug-talk.png', blink:{closed:'flat/smug-blink.png', rect:[1, 2, 3, 4]},
      binding:{canvas:[8, 8], mouth:{set:'normal', anchor:{x:2, y:2, scale:1, rotation:0}, surface:'patch', cover:{src:'flat/cover.png', rect:[1, 1, 4, 4]}}}}}}}}
  m.emotions.love = {render:{kind:'whole', legacy:{version:1, kind:'static-sprites',
    rig:{mouthSets:{normal:{canvas:[4, 4], pivot:[1, 1], frames:{closed:'flat/closed2.png'}}}},
    emotions:{love:{src:'flat/love.png', binding:{canvas:[8, 8], mouth:{set:'normal', anchor:{x:1, y:1, scale:1, rotation:0}, surface:'patch'}}}}}}}
  return m
}
const assetsOf = manifest => {
  const out = {}
  const add = value => { if (typeof value === 'string' && /\.png$/.test(value)) out[value] = value.replace(/\W/g, '').padEnd(64, '0').slice(0, 64)
    else if (value && typeof value === 'object') Object.values(value).forEach(add) }
  add(manifest); return out
}

test('clearRect travels with the resolved closure; one outside the rig canvas makes the 差分 missing, not silently unclipped', () => {
  const m = fixture(), wave = hybridSpriteRender(m, 'wave')
  assert.equal(wave.kind, 'parts')
  assert.deepEqual(wave.parts.parts['arm-up'].clearRect, [60, 50, 30, 40])
  assert.equal(wave.parts.parts.base.clearRect, undefined, 'never invented for parts without one')
  const bad = fixture(); bad.rigs.maid.parts['arm-up'].clearRect = [90, 140, 20, 20]
  assert.deepEqual(hybridSpriteRender(bad, 'wave').missing, [{kind:'part', id:'arm-up', code:'BAD_PART', group:'pose'}])
  // A changed clearRect is a new picture identity.
  const moved = fixture(); moved.rigs.maid.parts['arm-up'].clearRect = [60, 50, 30, 41]
  assert.notEqual(hybridSpriteRender(moved, 'wave').parts.revision, wave.parts.revision)
})

// A pixel-level 2D context (labels instead of colours; 0 = transparent; opaque source-over) that honours clip for
// clearRect and drawImage like the canvas spec, so an incremental repaint can be compared with a fresh full paint.
function surface() {
  const self = {width:0, height:0, data:null, clips:[[0, 0, Infinity, Infinity]]}
  const inside = (x, y) => self.clips.every(([cx, cy, cw, ch]) => x >= cx && y >= cy && x < cx + cw && y < cy + ch)
  let path = null
  const stack = []
  const ctx = {save() { stack.push([...self.clips]) }, restore() { self.clips = stack.pop() },
    beginPath() { path = null }, rect(x, y, w, h) { path = [x, y, w, h] }, clip() { self.clips.push(path) },
    clearRect(x, y, w, h) { for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) if (inside(xx, yy)) self.data[yy * self.width + xx] = 0 },
    drawImage(image, x, y) { for (let yy = 0; yy < image.height; yy++) for (let xx = 0; xx < image.width; xx++) {
      const v = image.pixels[yy * image.width + xx]; if (v && inside(x + xx, y + yy)) self.data[(y + yy) * self.width + x + xx] = v } }}
  return new Proxy(self, {set(target, key, value) { target[key] = value; if (key === 'width' || key === 'height') target.data = new Uint16Array(target.width * target.height); return true },
    get(target, key) { return key === 'getContext' ? () => ctx : target[key] }})
}
async function renderer() {
  const source = await readFile(new URL('../tavern-plugin/src/client/fork-layered-sprite.cjs', import.meta.url), 'utf8')
  const render = await readFile(new URL('../tavern-plugin/src/client/fork-layered-sprite-render.js', import.meta.url), 'utf8')
  const context = {document:{createElement:surface}, forkForeground:{now:() => 0}}
  vm.runInNewContext(source + '\n' + render, context)
  return context
}
// Every part is an opaque block with its own label; the base covers the canvas.
function imagesOf(parts) {
  const labels = Object.keys(parts.parts)
  return new Map(Object.entries(parts.parts).map(([id, part]) => [part.src, {width:part.rect[2], height:part.rect[3], pixels:new Uint16Array(part.rect[2] * part.rect[3]).fill(labels.indexOf(id) + 1)}]))
}

test('stage compositor: clearRect clears right before its part, and every incremental repaint equals a fresh full paint', async () => {
  const context = await renderer(), m = fixture()
  // Animate a recipe whose mouth frame toggles while the arm (with clearRect) is drawn; plus a synthetic case where the
  // changed part itself carries clearRect (a mouth frame that hides the rest mouth's larger outline).
  const wave = hybridSpriteRender(m, 'wave').parts
  const custom = structuredClone(wave)
  custom.parts['mouth-a'].clearRect = [40, 50, 22, 16]
  for (const parts of [wave, custom]) {
    const images = imagesOf(parts), live = surface()
    context.forkSpritePaint(live, {parts}, images, 'initial', 'open')
    // Below the arm's clearRect the base is gone, the arm itself is drawn: the old outline cannot show through.
    assert.equal(live.data[70 * live.width + 75], 0, 'cleared under clearRect')
    for (const event of ['a', 'initial', 'e', 'a', 'closed', 'a', 'idle']) {
      context.forkSpritePaint(live, {parts}, images, event, 'open')
      const fresh = surface(); context.forkSpritePaint(fresh, {parts}, images, event, 'open')
      assert.deepEqual([...live.data], [...fresh.data], 'incremental ' + event + ' equals full paint')
    }
  }
  // Without clearRect nothing is cleared implicitly (old behaviour kept).
  const calm = hybridSpriteRender(m, 'calm').parts, plain = surface()
  context.forkSpritePaint(plain, {parts:calm}, imagesOf(calm), 'initial', 'open')
  assert.ok(plain.data.every(v => v !== 0), 'the base stays wherever no clearRect is declared')
  // The dirty box of a changed part covers rect ∪ clearRect.
  assert.deepEqual([...context.forkPartsBox(custom, ['mouth-a'])], [40, 50, 22, 16])
  assert.deepEqual([...context.forkPartsBox(wave, ['arm-up'])], [60, 20, 30, 70])
})

test('editor thumbnail compositor applies clearRect before its part (same semantics as the stage)', async () => {
  const source = await readFile(new URL('../tavern-plugin/src/client/fork-asset-pack-figure-ui.js', import.meta.url), 'utf8')
  const body = source.slice(source.indexOf('function partsPicture('), source.indexOf('function usePartsPicture('))
  assert.match(body, /if\(part\.clearRect\)ctx\.clearRect\(\.\.\.part\.clearRect\);ctx\.drawImage\(img,r\[0\],r\[1\]\)/)
})

test('a static-sprites whole is its own image: flat still, talk, mouth rig binding and blink survive the hybrid view', () => {
  const m = fixture(), view = spriteViewManifest(m)
  assert.equal(hybridSpriteRender(m, 'smug').kind, 'whole')
  assert.equal(view.hybrid.missing.smug, undefined, 'never treated as missing')
  assert.equal(view.emotions.smug.src, 'flat/smug.png'); assert.equal(view.emotions.smug.talk, 'flat/smug-talk.png')
  assert.deepEqual(view.emotions.smug.blink, {closed:'flat/smug-blink.png', rect:[1, 2, 3, 4]})
  // Two flat wholes bring two different mouth rigs under the same set name: the second is renamed, binding follows.
  assert.equal(view.emotions.smug.binding.mouth.set, 'normal'); assert.equal(view.emotions.love.binding.mouth.set, 'normal-love')
  assert.equal(view.rig.mouthSets.normal.frames.a, 'flat/a.png'); assert.equal(view.rig.mouthSets['normal-love'].pivot[0], 1)
  // The layered wholes keep their own atlases.
  assert.equal(view.emotions.singing.stage.src, 'emotions/singing/stage.png')

  const assets = assetsOf(m), urls = Object.fromEntries(Object.keys(assets).map(name => [name, '/media/' + assets[name]]))
  const order = Object.keys(m.emotions) // private fork: figure and outfit explicitly declare available differences.
  const figure = {enabled:true, name:'大肥鱼', appearance:'sprite', heightCm:150, emotions:order.map(id=>({id,label:id})),
    outfits:[{key:'default', label:'女仆装', enabled:true, emotions:order, sprite:{manifestKey:'maid', assets}}]}
  const project = value => typeof value === 'string' ? urls[value] || value : Array.isArray(value) ? value.map(project)
    : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, project(v)])) : value
  for (const emotion of ['smug', 'love']) {
    const selected = selectPackFigure(figure, {maid:m}, {emotion, appearance:'sprite'})
    assert.equal(selected.state.id, emotion); assert.equal(selected.spriteResolution.missing, false)
    const geometry = {stage:packGeometryKey(selected, {}, 'stage'), portrait:null}
    const input = packFigureRenderInputs({...selected, alias:'dfy', ref:{packId:'p', figureId:'f'}, media:{sprite:{identity:'p:' + geometry.stage}},
      views:{stage:true, portrait:false}, geometry, spritePack:project(selected.manifest), spriteUrls:urls}).stage
    assert.equal(input.kind, 'static'); assert.equal(input.spriteBundle, null)
    assert.equal(input.src, urls['flat/' + emotion + '.png'])
    assert.equal(input.mouthBundle.binding.mouth.set, emotion === 'smug' ? 'normal' : 'normal-love')
    assert.equal(input.mouthBundle.set.frames.closed, urls[emotion === 'smug' ? 'flat/closed.png' : 'flat/closed2.png'])
    if (emotion === 'smug') {
      assert.equal(input.talkSrc, urls['flat/smug-talk.png'])
      assert.equal(input.mouthBundle.binding.mouth.cover.sha, urls['flat/cover.png'])
      assert.equal(input.blinkBundle.closed, urls['flat/smug-blink.png'])
    }
  }
  // Geometry keys follow the flat closure (its own image, its own rig).
  const key = emotion => packGeometryKey(selectPackFigure(figure, {maid:m}, {emotion, appearance:'sprite'}), {}, 'stage')
  assert.notEqual(key('smug'), key('love'))
})

test('render.preview is used only with the exact native rest revision; parity with resolveHybridSprite incl. clearRect and static wholes', () => {
  const m = fixture()
  for (const emotion of ['calm', 'joy', 'wave']) {
    const native = backend.resolveHybridSprite(m, emotion), mine = hybridSpriteRender(m, emotion)
    assert.equal(mine.parts.restRevision, native.revision)
    m.emotions[emotion].render.preview = 'baked/' + emotion + '.png'
    m.emotions[emotion].render.previewRevision = native.revision
  }
  m.emotions.joy.render.previewRevision = '["maid",1,"joy",3,[]]'  // stale bake
  delete m.emotions.wave.render.previewRevision                     // unpaired
  const view = spriteViewManifest(m)
  assert.equal(view.emotions.calm.src, 'baked/calm.png')
  assert.equal(view.emotions.joy.src, undefined, 'stale preview is never shown')
  assert.equal(view.emotions.wave.src, undefined, 'preview without revision is never shown')
  // Frame / layer selection parity (the existing parity test, with the clearRect pose and the static wholes).
  const source = contract
  for (const emotion of Object.keys(m.emotions)) {
    const native = backend.resolveHybridSprite(m, emotion), mine = source.hybridSpriteRender(m, emotion)
    assert.equal(mine.kind, native.kind, emotion)
    if (native.kind === 'parts') for (const layer of native.layers) assert.deepEqual(mine.parts.parts[layer.id].clearRect, layer.clearRect)
    if (native.kind === 'whole') assert.deepEqual(mine.legacy, native.legacy)
  }
})
