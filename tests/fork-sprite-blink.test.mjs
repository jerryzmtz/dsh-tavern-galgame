// private fork: synthetic pack assertions use canonical emotion ownership, not free-form state identities.
// private fork: automatic blinking for static sprites with an authored blink patch.
import test from 'node:test'
import {nativeSpriteFixture} from './fixtures/fork-layered-sprite.mjs'
import assert from 'node:assert/strict'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { deflateSync } from 'node:zlib'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { syntheticPack, PACK_ID, FIGURE_ID, cardExtension } from './fixtures/asset-packs/pack.mjs'
import { validateSpriteManifest, spriteResourcePaths, validateFigureClosure } from '../tavern-plugin/packages/dsh-asset-library/src/asset-packs/index.js'
import { createAssetPackService } from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/service.js'
import { sealPack, jsonBytes, verifyBytes } from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/validation.js'
import { writeZip } from '../tavern-plugin/packages/dsh-asset-library/src/zip.js'
import { createAssetPackPresentation } from '../tavern-plugin/lib/domain/asset-pack-presentation.js'
import * as patchTool from '../tavern-plugin/lib/domain/sprite-blink-patch.js'

const require = createRequire(import.meta.url)
const blink = require('../tavern-plugin/src/client/fork-sprite-blink.cjs')
const spriteContract = require('../tavern-plugin/src/client/fork-layered-sprite.cjs')
const { packFigureRenderInputs, packBlinkBundle } = require('../tavern-plugin/src/client/fork-pack-playback.cjs')
const client = new URL('../tavern-plugin/src/client/', import.meta.url)
const source = name => readFile(new URL(name, client), 'utf8')
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const code = expected => error => { assert.equal(error.code, expected); return true }

function png(width, height, color = [240, 200, 180, 255]) {
  const crc = bytes => { let n = 0xffffffff; for (const b of bytes) { n ^= b; for (let i = 0; i < 8; i++) n = (n >>> 1) ^ (n & 1 ? 0xedb88320 : 0) } return (n ^ 0xffffffff) >>> 0 }
  const chunk = (type, bytes) => { const body = Buffer.concat([Buffer.from(type), bytes]), header = Buffer.alloc(4), tail = Buffer.alloc(4); header.writeUInt32BE(bytes.length); tail.writeUInt32BE(crc(body)); return Buffer.concat([header, body, tail]) }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6
  const stride = width * 4 + 1, pixels = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) pixels.set(color, y * stride + 1 + x * 4)
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))])
}
// The synthetic pack's sprites are 8×8; a 3×2 blink patch sits at [2,2,3,2].
function withBlink(pack, { size = [3, 2], rect = [2, 2, 3, 2], layered = true, flat = true } = {}) {
  const bytes = png(...size), hash = digest(bytes)
  pack.files.set(`media/${hash}.png`, bytes); pack.manifest.blobs[hash] = { ext: 'png', mime: 'image/png', size: bytes.length }
  const outfits = pack.figures[FIGURE_ID].outfits
  if (layered) {
    pack.sprites.school.emotions.calm.stage.blink = { closed: 'assets/blink-calm.png', rect }
    outfits[0].sprite.assets['assets/blink-calm.png'] = hash
    pack.files.set('sprites/school/manifest.json', jsonBytes(pack.sprites.school))
  }
  if (flat) {
    pack.sprites.casual.emotions.calm.blink = { closed: 'assets/still-blink.png', rect }
    outfits[1].sprite.assets['assets/still-blink.png'] = hash
    pack.files.set('sprites/casual/manifest.json', jsonBytes(pack.sprites.casual))
  }
  pack.files.set(`figures/${FIGURE_ID}.json`, jsonBytes(pack.figures[FIGURE_ID]))
  return hash
}

// ---- schema: validated once at import
test('schema accepts optional layered-view and flat-state blink patches and lists their resources', () => {
  const layered = { version: 2, kind: 'layered-static-sprites', character: { id: 'a', name: 'A' }, closedBehavior: 'restore-base',
    states: [{ id: 'calm', stage: { src: 'assets/calm.png', width: 100, height: 200, blink: { closed: 'assets/calm-blink.png', half: 'assets/calm-half.png', rect: [40, 30, 20, 8] } } }] }
  const nativeLayered=nativeSpriteFixture(layered);assert.equal(validateSpriteManifest(nativeLayered), nativeLayered)
  assert.deepEqual(spriteResourcePaths(nativeLayered).sort(), ['assets/calm-blink.png', 'assets/calm-half.png', 'assets/calm.png'])
  const flat = { version: 1, kind: 'static-sprites', defaultState: 'calm', states: [{ id: 'calm', src: 'assets/calm.webp', blink: { closed: 'assets/calm-blink.png', rect: [1, 2, 3, 4] } }] }
  const nativeFlat=nativeSpriteFixture(flat);assert.equal(validateSpriteManifest(nativeFlat), nativeFlat)
  assert.deepEqual(spriteResourcePaths(nativeFlat).sort(), ['assets/calm-blink.png', 'assets/calm.webp'])
  // Without a blink nothing changes: mouth frame IDs named "closed" are never mistaken for paths.
  const plain = structuredClone(layered); delete plain.states[0].stage.blink
  assert.deepEqual(spriteResourcePaths(nativeSpriteFixture(plain)), ['assets/calm.png'])
})

test('schema rejects malformed blink patches before installation', () => {
  const base = () => ({ version: 2, kind: 'layered-static-sprites', character: { id: 'a', name: 'A' }, closedBehavior: 'restore-base',
    states: [{ id: 'calm', stage: { src: 'assets/calm.png', width: 100, height: 200, blink: { closed: 'assets/b.png', rect: [40, 30, 20, 8] } } }] })
  for (const mutate of [
    b => { b.rect = [40, 30, 0, 8] }, b => { b.rect = [90, 30, 20, 8] }, b => { b.rect = [40, 195, 20, 8] }, b => { b.rect = [40.5, 30, 20, 8] },
    b => { b.rect = [40, 30, 20] }, b => { b.closed = '../b.png' }, b => { b.closed = 'assets/b.gif' }, b => { delete b.closed },
    b => { b.half = b.closed }, b => { b.extra = true }
  ]) {
    const manifest = base(); mutate(manifest.states[0].stage.blink)
    assert.throws(() => validateSpriteManifest(nativeSpriteFixture(manifest)), /./)
  }
  const flat = { version: 1, kind: 'static-sprites', defaultState: 'calm', states: [{ id: 'calm', src: 'assets/c.png', binding: undefined, blink: { closed: 'assets/b.png', rect: [0, 0, 2, 2], frames: {} } }] }
  delete flat.states[0].binding
  assert.throws(() => validateSpriteManifest(nativeSpriteFixture(flat)), /./)
})

test('import closure and decoded dimensions cover blink patches', async () => {
  const ok = await syntheticPack(); withBlink(ok); await sealPack(ok.manifest, ok.files)
  await verifyBytes(ok.manifest, ok.files)
  const missing = await syntheticPack(); withBlink(missing)
  delete missing.figures[FIGURE_ID].outfits[0].sprite.assets['assets/blink-calm.png']
  assert.throws(() => validateFigureClosure(missing.manifest, missing.figures, missing.sprites), code('FILE_CLOSURE_MISMATCH'))
  for (const options of [{ size: [4, 2] }, { size: [3, 3] }, { rect: [6, 2, 3, 2], size: [3, 2], layered: false }]) {
    const pack = await syntheticPack(); withBlink(pack, options); await sealPack(pack.manifest, pack.files)
    await assert.rejects(verifyBytes(pack.manifest, pack.files), /Blink/)
  }
})

// ---- presentation: leased URLs reach the stage input
async function installed(t, mutate) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pack-blink-')), pack = await syntheticPack()
  mutate(pack); await sealPack(pack.manifest, pack.files)
  const zip = path.join(root, 'pack.zip'); await writeZip(zip, [{ path: 'manifest.json', data: jsonBytes(pack.manifest) }, ...[...pack.files].map(([p, data]) => ({ path: p, data }))])
  const service = createAssetPackService({ assetRoot: path.join(root, 'assets'), authorizeLease: async () => true })
  const inspect = await service.inspectImport({ bytes: await readFile(zip) })
  await service.applyImport({ inspectionId: inspect.inspectionId, expectedRevision: null, decision: 'install' })
  const consumer = createAssetPackPresentation({ now: () => Date.now(), raw: { extensions: { dsh_tavern: cardExtension() } }, getService: () => service, origin: 'http://localhost', scope: 'test' })
  t.after(async () => { consumer.dispose(); await service.dispose(); await rm(root, { recursive: true, force: true }) })
  return consumer
}
test('layered and flat stage inputs carry a leased blink bundle; sprites without one have none', async t => {
  const consumer = await installed(t, pack => { pack.figures[FIGURE_ID].appearance = 'sprite'; withBlink(pack) })
  const layered = packFigureRenderInputs(await consumer.materialize(await consumer.character('actor', { emotion: 'calm' })), {}, spriteContract).stage
  assert.ok(layered.spriteBundle)
  assert.deepEqual(layered.blinkBundle.rect, [2, 2, 3, 2]); assert.deepEqual(layered.blinkBundle.canvas, [8, 8])
  assert.ok(layered.blinkBundle.closed.startsWith('/api/dsh-asset-library/')); assert.equal(layered.blinkBundle.half, '')
  const flat = packFigureRenderInputs(await consumer.materialize(await consumer.character('actor', { actor: { outfitKey: 'casual' } })), {}, spriteContract).stage
  assert.equal(flat.kind, 'static'); assert.deepEqual(flat.blinkBundle.rect, [2, 2, 3, 2]); assert.equal(flat.blinkBundle.canvas, null)
  assert.ok(flat.blinkBundle.closed.startsWith('/api/dsh-asset-library/')); assert.notEqual(flat.blinkBundle.closed, flat.src)
  const special = packFigureRenderInputs(await consumer.materialize(await consumer.character('actor', { emotion: 'crying' })), {}, spriteContract).stage
  assert.equal(special.blinkBundle, null)
})
test('client normalization keeps a valid blink, maps its assets and ignores a bad one without losing the sprite', () => {
  const raw = { version: 2, kind: 'layered-static-sprites', character: { id: 'a', name: 'A' }, closedBehavior: 'restore-base',
    states: [{ id: 'calm', stage: { src: 'assets/c.png', width: 10, height: 10, blink: { closed: 'assets/b.png', half: 'assets/h.png', rect: [1, 1, 4, 2] } } },
      { id: 'joy', stage: { src: 'assets/j.png', width: 10, height: 10, blink: { closed: 'assets/b.png', rect: [8, 8, 4, 4] } } }] }
  const pack = spriteContract.forkSpriteMapAssets(spriteContract.forkSpriteManifest({ ...raw, states: raw.states.map(s => ({ ...s, portrait: s.stage })) }), src => '/u/' + src)
  assert.deepEqual(pack.states[0].stage.blink, { closed: '/u/assets/b.png', half: '/u/assets/h.png', rect: [1, 1, 4, 2] })
  assert.equal(pack.states[1].stage.blink, undefined); assert.equal(pack.states[1].stage.src, '/u/assets/j.png')
  assert.equal(packBlinkBundle(undefined, null), null)
})

// ---- scheduler (fake timers)
function clock() {
  let now = 0, serial = 0
  const timers = new Map()
  return {
    setTimeout(fn, ms) { const id = ++serial; timers.set(id, { at: now + ms, fn }); return id },
    clearTimeout(id) { timers.delete(id) },
    pending: () => timers.size,
    now: () => now,
    advance(ms) {
      const end = now + ms
      for (;;) {
        const next = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0]
        if (!next) break
        timers.delete(next[0]); now = next[1].at; next[1].fn()
      }
      now = end
    }
  }
}
const sequence = values => { let i = 0; return () => values[i++ % values.length] }
test('blink scheduler: 2.5–6 s random gap, 100–140 ms closed, occasional double blink, timers only', () => {
  const c = clock(), log = []
  const s = blink.createForkBlinkScheduler({ setTimeout: c.setTimeout, clearTimeout: c.clearTimeout, random: sequence([0, 0, 0.99]), apply: phase => log.push([c.now(), phase]) })
  s.start(); assert.equal(s.phase(), 'open'); assert.equal(c.pending(), 1)
  c.advance(2499); assert.deepEqual(log, [])
  c.advance(1); assert.deepEqual(log, [[2500, 'closed']])
  c.advance(100); assert.deepEqual(log.at(-1), [2600, 'open'])
  // Gap uses the next random value (0.99 → ~5.97 s); still exactly one pending timer while idle.
  assert.equal(c.pending(), 1)
  for (let i = 0; i < 200; i++) {
    const r = Math.random
    const plan = blink.forkBlinkPlan(r, false), gap = blink.forkBlinkGap(r)
    assert.ok(gap >= 2500 && gap <= 6000)
    for (const [phase, ms] of plan) if (phase === 'closed') assert.ok(ms >= 100 && ms <= 140)
    assert.ok(plan.length === 1 || plan.length === 3 && plan[1][0] === 'open')
  }
  const double = blink.forkBlinkPlan(sequence([0.5, 0.01, 0.5, 0.5]), false)
  assert.deepEqual(double.map(step => step[0]), ['closed', 'open', 'closed'])
  assert.deepEqual(blink.forkBlinkPlan(sequence([0.5, 0.9]), true).map(step => step[0]), ['half', 'closed', 'half'])
})
test('blink scheduler realigns on state change, keeps eyes open when disallowed and stops cleanly', () => {
  const c = clock(), phases = []
  let allowed = true
  const s = blink.createForkBlinkScheduler({ setTimeout: c.setTimeout, clearTimeout: c.clearTimeout, random: () => 0, allowed: () => allowed, apply: phase => phases.push(phase) })
  s.start(); c.advance(2500); assert.equal(s.phase(), 'closed')
  s.restart(); assert.equal(s.phase(), 'open'); assert.equal(c.pending(), 1)
  c.advance(2499); assert.equal(s.phase(), 'open'); c.advance(1); assert.equal(s.phase(), 'closed')
  allowed = false; c.advance(100); assert.equal(s.phase(), 'open')
  c.advance(60000); assert.equal(s.phase(), 'open'); assert.ok(!phases.slice(4).includes('closed'))
  allowed = true; c.advance(2500); assert.equal(s.phase(), 'closed')
  s.stop(); assert.equal(s.phase(), 'open'); assert.equal(c.pending(), 0); assert.equal(s.running(), false)
  c.advance(60000); assert.equal(s.phase(), 'open')
})

// ---- reduced motion
test('reduced motion (CONFIG or OS) keeps eyes open; stage quality does not', async () => {
  const scene = await source('fork-gal-scene.js')
  const fn = scene.slice(scene.indexOf('let forkGalHopMedia'), scene.indexOf('function forkGalShiverAt('))
  for (const [os, config, expected] of [[false, false, false], [true, false, true], [false, true, true]]) {
    const ctx = { window: { matchMedia: () => ({ matches: os, addEventListener() {} }) }, forkStageReading: { get: () => ({ reducedMotion: config }) } }
    vm.runInNewContext(fn + ';this.calm = forkGalBlinkCalm();', ctx)
    assert.equal(ctx.calm, expected)
  }
  assert.match(scene, /function blinkAllowed\(entry\) \{[^}]*!forkGalBlinkCalm\(\)/)
})

// ---- scene: coexistence with mouth patches and emotion changes
async function sceneFixture() {
  const scene = await source('fork-gal-scene.js')
  const methods = scene.slice(scene.indexOf('    // private fork: authored blink overlay'), scene.indexOf('    function syncFigures(desc, now)'))
  const point = () => ({ set(x, y = x) { this.x = x; this.y = y } })
  class Sprite {
    constructor(texture) { this.texture = texture; this.position = point(); this.scale = point(); this.pivot = point(); this.anchor = { x: .5, y: 1 }; this.children = []; this.visible = true }
    addChild(child) { this.children.push(child); child.parent = this }
    destroy() { this.destroyed = true; if (this.parent) this.parent.children = this.parent.children.filter(c => c !== this); this.parent = null }
  }
  const c = clock(), textures = new Map(), base = { width: 100, height: 200 }
  const add = (url, width, height) => textures.set(url, { ready: true, texture: { url, width, height } })
  for (const level of ['closed', 'small', 'mid', 'open']) add(level + '.webp', 16, 8)
  add('cover.webp', 20, 10); add('blink.png', 30, 8); add('blink-joy.png', 32, 10)
  const mouthBundle = { binding: { imageSha: 'base.webp', canvas: [100, 200], mouth: { set: 'neutral', surface: 'patch', anchor: { x: 52, y: 31, scale: 1, rotation: 0 }, cover: { sha: 'cover.webp', rect: [40, 25, 20, 10] } } }, set: { canvas: [16, 8], pivot: [7, 3], frames: Object.fromEntries(['closed', 'small', 'mid', 'open'].map(l => [l, l + '.webp'])) } }
  const blinkBundle = { key: 'calm', closed: 'blink.png', half: '', rect: [35, 10, 30, 8], canvas: null }
  const entry = { loadedIdentity: 'calm', src: 'base.webp', baseTexture: base, sprite: new Sprite(base), container: { visible: true }, figure: { identity: 'calm', src: 'base.webp', mouthBundle, blinkBundle, audio: { currentTime: 0 } } }
  const ctx = { PIXI: { Sprite }, state: { textures, destroyed: false }, world: { visible: true }, document: { hidden: false }, console: { warn() {} },
    forkForeground: { setTimeout: c.setTimeout, clearTimeout: c.clearTimeout }, forkGalBlinkCalm: () => false, Math: Object.create(Math) }
  ctx.Math.random = () => 0
  const code = [await source('fork-layered-sprite-render.js'), await source('fork-gal-mouth.js'), await source('fork-sprite-blink.cjs'), methods].join('\n')
  vm.runInNewContext(code + ';Object.assign(this,{tickMouth,clearMouth,tickBlink,clearBlink});', ctx)
  return { ctx, entry, clock: c, textures }
}
test('blink overlay sits above the mouth layers at the base rect and never disturbs lip-sync', async () => {
  const { ctx, entry, clock: c } = await sceneFixture()
  assert.equal(ctx.tickMouth(entry, true, .9, 0), true)
  ctx.tickBlink(entry)
  assert.deepEqual(entry.sprite.children.map(s => s.texture.url), ['cover.webp', 'open.webp', 'blink.png'])
  assert.deepEqual([entry.blinkClosed.position.x, entry.blinkClosed.position.y], [-15, -190])
  assert.equal(entry.blinkClosed.visible, false)
  const mouth = entry.mouthSprite
  c.advance(2500); assert.equal(entry.blinkClosed.visible, true)
  // Speaking while the eyes are closed: the mouth animates, the blink stays.
  ctx.tickMouth(entry, true, .5, 80); ctx.tickBlink(entry)
  assert.equal(entry.mouthSprite, mouth); assert.equal(mouth.texture.url, 'mid.webp'); assert.equal(entry.blinkClosed.visible, true)
  // clearMouth (e.g. a frame without a mouth bundle) never removes the blink overlay.
  ctx.clearMouth(entry); assert.ok(entry.blinkClosed && entry.blinkClosed.parent === entry.sprite)
  c.advance(100); assert.equal(entry.blinkClosed.visible, false)
  // Steady state: repeated frames add no children and no timers.
  const pending = c.pending(); for (let i = 0; i < 10; i++) ctx.tickBlink(entry)
  assert.equal(entry.sprite.children.filter(s => s.texture.url === 'blink.png').length, 1); assert.equal(c.pending(), pending)
})
test('replacement blink caches the actual flat frame, coexists with lips and restores on removal', async () => {
  const {ctx,entry,clock:c,textures} = await sceneFixture();
  const talk = {width:100,height:200,baseTexture:{resource:{source:{}}}};
  entry.baseTexture.baseTexture = {resource:{source:{}}};
  textures.get('blink.png').texture.baseTexture = {resource:{source:{}}};
  entry.figure.blinkBundle.blend = 'replace';
  let paints = 0;
  ctx.forkSpriteReplacePatch = () => { paints++; };
  ctx.document.createElement = () => ({getContext:()=>({drawImage(){}})});
  ctx.PIXI.Texture = {from:canvas=>({width:canvas.width,height:canvas.height,destroy(){this.destroyed=true;}})};
  ctx.tickMouth(entry,true,.9,0); const mouth = entry.mouthSprite;
  entry.sprite.texture = talk; ctx.tickBlink(entry); ctx.tickBlink(entry);
  assert.ok(entry.sprite.texture === talk); assert.equal(paints,0);
  c.advance(2500); ctx.tickBlink(entry); const closed = entry.sprite.texture;
  assert.ok(closed !== talk); assert.equal(paints,1); assert.ok(entry.mouthSprite === mouth);
  ctx.tickBlink(entry); assert.ok(entry.sprite.texture === closed); assert.equal(paints,1);
  c.advance(100); ctx.tickBlink(entry); assert.ok(entry.sprite.texture === talk);
  entry.blink.restart(); c.advance(2500); ctx.tickBlink(entry); assert.ok(entry.sprite.texture === closed);
  entry.figure.blinkBundle = null; ctx.tickBlink(entry);
  assert.ok(entry.sprite.texture === talk); assert.equal(closed.destroyed,true); assert.equal(c.pending(),0);
});
test('emotion change cancels the running blink and realigns with the new state patch', async () => {
  const { ctx, entry, clock: c } = await sceneFixture()
  ctx.tickBlink(entry); c.advance(2500)
  const old = entry.blinkClosed; assert.equal(old.visible, true)
  entry.figure = { ...entry.figure, blinkBundle: { key: 'joy', closed: 'blink-joy.png', half: '', rect: [34, 9, 32, 10], canvas: [100, 200] } }
  ctx.tickBlink(entry)
  assert.equal(old.destroyed, true); assert.equal(entry.blinkClosed.texture.url, 'blink-joy.png'); assert.equal(entry.blinkClosed.visible, false)
  assert.equal(c.pending(), 1)
  c.advance(2499); assert.equal(entry.blinkClosed.visible, false); c.advance(1); assert.equal(entry.blinkClosed.visible, true)
  // A state without a patch: no blink at all (no procedural fallback).
  entry.figure = { ...entry.figure, blinkBundle: null }; ctx.tickBlink(entry)
  assert.equal(entry.blinkClosed, null); assert.equal(c.pending(), 0)
  assert.equal(entry.sprite.children.length, 0)
})
test('mismatched, unloaded or stale patches are ignored and the base stays intact', async () => {
  for (const mutate of [
    f => f.textures.get('blink.png').texture.width = 29,
    f => f.textures.get('blink.png').ready = false,
    f => f.entry.figure.blinkBundle.rect = [80, 10, 30, 8],
    f => f.entry.figure.blinkBundle.canvas = [100, 201],
    f => f.entry.figure.identity = 'next'
  ]) {
    const f = await sceneFixture(); mutate(f)
    f.ctx.tickBlink(f.entry)
    assert.equal(f.entry.blinkClosed ?? null, null); assert.equal(f.entry.sprite.children.length, 0); assert.equal(f.clock.pending(), 0)
  }
})
test('scene wiring: preload, prune, renewal, sprite swap and teardown include the blink overlay', async () => {
  const scene = await source('fork-gal-scene.js')
  assert.match(scene, /\/\/ @include fork-sprite-blink\.cjs/)
  assert.match(scene, /forkBlinkUrls\(entry\.figure\.blinkBundle\)\.forEach\(url => keep\.add\(url\)\)/)
  assert.match(scene, /mouthBundle:old\.mouthBundle,blinkBundle:old\.blinkBundle/)
  assert.match(scene, /clearMouth\(entry\); clearBlink\(entry\); entry\.fading\.push/)
  assert.match(scene, /entry\.dead = true;\n\s+clearBlink\(entry\);/)
  assert.match(scene, /entry\.sprite\.texture = entry\.flap\.open \? talkTexture : entry\.baseTexture;\n\s+\}\n\s+tickBlink\(entry\);/)
  assert.match(scene, /forkForeground\.subscribe\(active => \{ if \(!active\) state\.figures\.forEach\(entry => \{ if \(entry\.blink\) entry\.blink\.restart\(\); \}\); \}\)/)
  assert.match(scene, /setTimeout: forkForeground\.setTimeout, clearTimeout: forkForeground\.clearTimeout/)
})

// ---- production tool core (pure RGBA; codecs belong to callers)
function canvas(width, height, fill) {
  const image = patchTool.blankImage(width, height)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) image.data.set(fill(x, y), (y * width + x) * 4)
  return image
}
const figure = (x, y) => {
  const inside = x > 20 && x < 180 && y > 10 && y < 290
  if (!inside) return [0, 0, 0, 0]
  const stripe = ((x >> 3) + (y >> 4)) & 1 ? 40 : 0
  return [200 - stripe, 170, 150 + stripe, 255]
}
const eyes = [[70, 90], [130, 90]]
const open = (x, y) => eyes.some(([cx, cy]) => Math.abs(x - cx) < 14 && Math.abs(y - cy) < 9) ? [30, 30, 90, 255] : figure(x, y)
test('patch extraction keeps only the changed eyes, aligned, and rejects spills or a repainted figure', () => {
  const base = canvas(200, 300, open)
  const closedEyes = canvas(200, 300, (x, y) => eyes.some(([cx, cy]) => Math.abs(x - cx) < 14 && Math.abs(y - cy) < 9) ? (Math.abs(y - 92) < 2 ? [40, 30, 30, 255] : [235, 200, 180, 255]) : figure(x, y))
  const layout = patchTool.blinkReferenceLayout(200, 300)
  assert.equal(layout.size, '1024x1536')
  const edit = patchTool.resizeImage(patchTool.padImage(patchTool.warpImage(closedEyes, 2, -1, 1), layout), 1024, 1536)
  const result = patchTool.makeBlinkPatch(base, edit, layout, { mouth: { x: 90, y: 130, w: 20, h: 8 } })
  assert.equal(result.ok, true, result.warnings.join('; '))
  const [x, y, w, h] = result.rect
  assert.ok(x <= 56 && x + w >= 144 && y <= 81 && y + h >= 99 && h < 60, String(result.rect))
  assert.equal(result.patch.width, w); assert.equal(result.patch.height, h)
  assert.ok(Math.abs(result.alignment.dx + 2) < 0.6 && Math.abs(result.alignment.dy - 1) < 0.6)
  const composite = patchTool.compositePatch(base, result.patch, result.rect)
  const at = (image, px, py) => Array.from(image.data.subarray((py * 200 + px) * 4, (py * 200 + px) * 4 + 4))
  assert.deepEqual(at(composite, 70, 86), [235, 200, 180, 255]); assert.deepEqual(at(composite, 100, 200), at(base, 100, 200))
  // A repainted body or a change far outside the head is reported, not patched over.
  const spilled = canvas(200, 300, (px, py) => px > 60 && px < 140 && py > 220 && py < 280 ? [10, 200, 10, 255] : closedEyes.data.slice((py * 200 + px) * 4, (py * 200 + px) * 4 + 4))
  const bad = patchTool.makeBlinkPatch(base, patchTool.resizeImage(patchTool.padImage(spilled, layout), 1024, 1536), layout)
  assert.equal(bad.ok, false); assert.ok(bad.warnings.some(w => /diff-spill|rest-changed/.test(w)))
  const none = patchTool.makeBlinkPatch(base, patchTool.resizeImage(patchTool.padImage(base, layout), 1024, 1536), layout)
  assert.equal(none.ok, false); assert.match(none.warnings[0], /no-eye-change/)
})
