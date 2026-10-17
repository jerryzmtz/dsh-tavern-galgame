import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const helpers = await readFile(new URL('../tavern-plugin/src/client/fork-gal-mouth.js', import.meta.url), 'utf8')
const sprites = await readFile(new URL('../tavern-plugin/src/client/fork-layered-sprite-render.js', import.meta.url), 'utf8')
const scene = await readFile(new URL('../tavern-plugin/src/client/fork-gal-scene.js', import.meta.url), 'utf8')
const methods = scene.slice(scene.indexOf('    function clearMouth(entry)'), scene.indexOf('    function syncFigures(desc, now)'))
function fixture() {
  const point = () => ({ set(x, y = x) { this.x = x; this.y = y } })
  class Sprite {
    constructor(texture) { this.texture = texture; this.position = point(); this.scale = point(); this.pivot = point(); this.anchor = { x: .5, y: 1 }; this.children = [] }
    addChild(child) { this.children.push(child); child.parent = this }
    destroy() { this.destroyed = true; if (this.parent) this.parent.children = this.parent.children.filter(c => c !== this) }
  }
  const base = { width: 100, height: 200 }, textures = new Map()
  const frames = Object.fromEntries(['closed', 'small', 'mid', 'open'].map(level => [level, level + '.webp']))
  for (const url of Object.values(frames)) textures.set(url, { ready: true, texture: { url, width: 16, height: 8 } })
  textures.set('cover.webp', { ready: true, texture: { url: 'cover.webp', width: 20, height: 10 } })
  const mouthBundle = { binding: { imageSha: 'base.webp', canvas: [100, 200], mouth: { set: 'neutral', surface: 'patch', anchor: { x: 52, y: 31, scale: 2, rotation: 10 }, cover: { sha: 'cover.webp', rect: [40, 25, 20, 10] } } }, set: { canvas: [16, 8], pivot: [7, 3], frames } }
  // private fork: readiness follows the prepared content identity, not a lease URL.
  const entry = { loadedIdentity:'base-hash', src: 'base.webp', baseTexture: base, sprite: new Sprite(base), figure: { identity:'base-hash', src: 'base.webp', mouthBundle, audio: { currentTime: 0 } } }
  const ctx = { PIXI: { Sprite }, state: { textures } }
  vm.runInNewContext(sprites + helpers + methods + ';Object.assign(this,{tickMouth,clearMouth});', ctx)
  return { entry, textures, ctx }
}

test('real mouth renderer publishes complete layers in order, follows base anchor and closes immediately', () => {
  const { entry, ctx } = fixture()
  assert.equal(ctx.tickMouth(entry, true, .9, 0), true)
  assert.deepEqual(entry.sprite.children.map(s => s.texture.url), ['cover.webp', 'open.webp'])
  assert.deepEqual([entry.mouthCover.position.x, entry.mouthCover.position.y], [-10, -175])
  assert.deepEqual([entry.mouthSprite.position.x, entry.mouthSprite.position.y], [2, -169])
  assert.deepEqual([entry.mouthSprite.pivot.x, entry.mouthSprite.pivot.y], [7, 3])
  assert.equal(entry.mouthSprite.scale.x, 2)
  assert.equal(entry.mouthSprite.rotation, 10 * Math.PI / 180)
  assert.equal(entry.sprite.texture, entry.baseTexture)
  const mouth = entry.mouthSprite
  ctx.tickMouth(entry, true, .5, 79); assert.equal(entry.mouthSprite, mouth); assert.equal(mouth.texture.url, 'open.webp')
  ctx.tickMouth(entry, true, .5, 80); assert.equal(mouth.texture.url, 'mid.webp')
  ctx.tickMouth(entry, true, 0, 81); assert.equal(mouth.texture.url, 'closed.webp'); assert.equal(mouth.visible, false); assert.equal(entry.mouthCover.visible, false)
  ctx.tickMouth(entry, false, 1, 82); assert.equal(mouth.visible, false)
})

test('missing/failed/size-mismatched resources or stale base never leave a partial cover', () => {
  for (const invalidate of [
    f => f.textures.delete('small.webp'),
    f => f.textures.get('mid.webp').ready = false,
    f => f.textures.get('open.webp').texture.width = 17,
    f => f.textures.get('cover.webp').texture.height = 9,
    f => f.entry.figure.identity = 'next-hash',
    f => f.entry.figure.mouthBundle.binding.canvas[1] = 201,
    f => f.entry.figure.mouthBundle.binding.imageSha = 'stale.webp'
  ]) {
    const f = fixture(); assert.equal(f.ctx.tickMouth(f.entry, true, .9, 0), true)
    invalidate(f)
    assert.equal(f.ctx.tickMouth(f.entry, true, .9, 1), false)
    assert.deepEqual(f.entry.sprite.children, [])
    assert.equal(f.entry.sprite.texture, f.entry.baseTexture)
    assert.equal(f.entry.mouthState, null)
  }
})

test('bundle switch and replay reset hold without destroying shared textures', () => {
  const { entry, ctx, textures } = fixture()
  entry.figure.audio.currentTime = 5
  ctx.tickMouth(entry, true, .9, 0)
  const previous = entry.mouthSprite
  entry.figure.mouthBundle.binding.mouth.anchor.x++
  ctx.tickMouth(entry, true, .25, 1)
  assert.equal(previous.destroyed, true); assert.equal(entry.mouthSprite.texture.url, 'small.webp')
  ctx.tickMouth(entry, true, .9, 81); assert.equal(entry.mouthSprite.texture.url, 'open.webp')
  entry.figure.audio.currentTime = 0
  ctx.tickMouth(entry, true, .25, 82); assert.equal(entry.mouthSprite.texture.url, 'small.webp')
  ctx.clearMouth(entry)
  assert.equal(textures.size, 5)
  assert.ok([...textures.values()].every(r => r.ready && !r.texture.destroyed))
})
