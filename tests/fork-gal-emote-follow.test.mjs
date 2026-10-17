import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const source = await readFile(new URL('../tavern-plugin/src/client/fork-gal-scene.js', import.meta.url), 'utf8')
const effects = await readFile(new URL('../tavern-plugin/src/client/fork-gal-effects.js', import.meta.url), 'utf8')
const helpers = source.slice(source.indexOf('// ---------- Scene helpers'), source.indexOf('// ---------- Scene runtime'))
const ctx = {}
vm.runInNewContext(helpers + '\n' + effects.slice(0, effects.indexOf('// The effects runtime of one scene.')), ctx)
const close = (a, b, eps = 1e-7) => assert.ok(Math.abs(a - b) < eps, `${a} ~= ${b}`)
const identity = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 }
const plain = x => JSON.parse(JSON.stringify(x))

test('drawable bounds transform Cubism Y-up into stage coordinates, including translation and mirroring', () => {
  const vertices = [new Float32Array([-1, 2, 1, 2, -1, -2, 1, -2]), [0, 0]]
  const head = ctx.forkGalMeshHead(vertices, { a: -10, b: 0, c: 0, d: -10, tx: 300, ty: 100 }, 0)
  assert.deepEqual(plain(head), { x: 300, top: 80, chin: 120, width: 20, rotation: 0 })
  assert.equal(ctx.forkGalMeshHead([], identity), null)
  assert.equal(ctx.forkGalMeshHead([[NaN, 0, 1, Infinity]], identity), null)
  assert.equal(ctx.forkGalMeshHead([[1, 1]], identity), null)
})

test('rotated mesh bounds keep local face size instead of expanding with the axis-aligned bounding box', () => {
  const a = Math.PI / 6, c = Math.cos(a), s = Math.sin(a)
  const head = ctx.forkGalMeshHead([[-2, -3, 2, -3, 2, 3, -2, 3]], { a: c, b: s, c: -s, d: c, tx: 23, ty: 42 }, a)
  close(head.x, 23); close(head.top, 39); close(head.chin, 45); close(head.width, 4)
  const ref = [[-2, -3, 2, -3, 2, 3, -2, 3]], moved = ref.map(v => v.map((_, i) => i % 2 ? s * v[i - 1] + c * v[i] + 50 : c * v[i] - s * v[i + 1] + 20))
  close(ctx.forkGalMeshRotation(ref, moved), a)
})

test('face selection caches semantic IDs/Parts and prefers Magia Record head hit mesh over corrupt legacy parents', () => {
  assert.deepEqual(plain(ctx.forkGalFaceDrawables(['body', 'FaceMesh', 'EyeL'], [], null)), [1])
  assert.deepEqual(plain(ctx.forkGalFaceDrawables(['ArtMesh50', 'ArtMesh51', 'ArtMesh3'], ['PartFace', 'PartCheek'], [0, 0, 1])), [0, 1])
  assert.deepEqual(plain(ctx.forkGalFaceDrawables(['D_PSD_34', 'HitAreaHead', 'D_PSD_131'], ['PartFace'], [45, 90, 0])), [1])
  assert.deepEqual(plain(ctx.forkGalFaceDrawables(['opaque', 'opaque2'], ['PartFace'], [0, 90])), [])
  assert.deepEqual(plain(ctx.forkGalFaceDrawables(['EyeL', 'eyeR', 'mouth', 'body'], [], null)), [0, 1, 2])
})

test('fallback rotates about neck pivot and includes head yaw/pitch and body movement', () => {
  const base = { x: 100, top: 20, chin: 60, width: 38 }
  assert.deepEqual(plain(ctx.forkGalFallbackHead(base, {})), { ...base, rotation: 0 })
  const head = ctx.forkGalFallbackHead(base, { ParamAngleZ: 30 })
  close(head.rotation, -Math.PI / 6)
  const pivot = 64.8, dy = 40 - pivot
  close(head.x, 100 - Math.sin(-Math.PI / 6) * dy)
  close((head.top + head.chin) / 2, pivot + Math.cos(-Math.PI / 6) * dy)
  const body = ctx.forkGalFallbackHead(base, { ParamBodyAngleZ: 10, ParamBodyAngleX: 30, ParamAngleX: 30, ParamAngleY: 30 })
  close(body.rotation, -7 * Math.PI / 180)
  assert.ok(body.x > head.x)
  assert.ok(body.top < base.top)
})

test('native blush shares the sprite envelope and adds/clamps the current expression without accumulating', () => {
  for (const [ms, amount] of [[-1, 0], [0, 0], [150, 0.5], [300, 1], [1399, 1], [1600, 0.5], [1800, 0], [2000, 0]]) {
    close(ctx.forkGalBlushEnvelope(ms), amount)
    close(ctx.forkGalCheekValue(0.3, ctx.forkGalBlushEnvelope(ms), 0, 1), Math.min(1, 0.3 + amount))
  }
  close(ctx.forkGalBlushEnvelope(600, 0.5), 0.5)
  close(ctx.forkGalBlushEnvelope(600, -1), 0)
  close(ctx.forkGalCheekValue(0.3, ctx.forkGalBlushEnvelope(1800), 0, 1), 0.3)
  assert.equal(ctx.forkGalCheekIndex({ getParameterIndex: () => 5, getParameterCount: () => 5 }), -1, 'virtual Cubism parameter is not a native cheek')
  assert.equal(ctx.forkGalCheekIndex({ getParameterIndex: () => 4, getParameterCount: () => 5 }), 4)
  assert.match(source, /beforeModelUpdate[\s\S]*effects\.blush\(model, state\.clock\)/)
  assert.match(source, /forkGalCheekValue\(core\.getParameterValueByIndex\(cheek\)/)
})

test('face-attached sprites rotate about face center; floating punctuation remains upright', () => {
  const head = { x: 100, top: 20, chin: 60, width: 40, rotation: Math.PI / 2 }
  const anchor = ctx.forkGalEmoteAnchor('blush', head, 800), frame = ctx.forkGalEmoteAt('blush', 500)
  const parts = ctx.forkGalEmoteParts('blush')
  const left = ctx.forkGalEmotePlacement('blush', head, anchor, parts[0], frame)
  const right = ctx.forkGalEmotePlacement('blush', head, anchor, parts[1], frame)
  // private fork: fallback cheek centers use +/- 26% of the head width.
  close(left.x, right.x); close(right.y - left.y, 20.8); close(left.rotation, Math.PI / 2)
  const f = ctx.forkGalEmoteAt('!', 500), a = ctx.forkGalEmoteAnchor('!', head, 800)
  const bang = ctx.forkGalEmotePlacement('!', head, a, ctx.forkGalEmoteParts('!')[0], f)
  close(bang.x, a.x); close(bang.rotation, f.rotation)
})

test('display transform includes portrait act position, parent headroom, scale and shared camera cancellation', () => {
  const display = { toGlobal: p => ({ x: 2 * (p.x * 0.5 + 105 + 7), y: 2 * (p.y * 0.5 + 200 - 20 + 35) }) }
  const target = { toLocal: p => ({ x: p.x / 2, y: p.y / 2 }) }
  const matrix = ctx.forkGalDisplayMatrix(display, target, identity)
  assert.deepEqual(plain(matrix), { a: 0.5, b: 0, c: 0, d: 0.5, tx: 112, ty: 215 })
  const head = ctx.forkGalMeshHead([[-8, -100, 8, -83]], matrix, 0)
  close(head.x, 112); close(head.top, 165); close(head.chin, 173.5)
})

test('mesh sampling consumes the deferred Cubism update exactly once before render', () => {
  const calls = [], model = { deltaTime: 16, elapsedTime: 1200, internalModel: { update: (...args) => calls.push(args) } }
  ctx.forkGalFlushFace(model)
  assert.deepEqual(calls, [[16, 1200]])
  assert.equal(model.deltaTime, 0)
  ctx.forkGalFlushFace(model)
  assert.equal(calls.length, 1, 'repeat head queries/render must not advance motion, physics or blink again')
  model.deltaTime = 33; model.elapsedTime += 33
  ctx.forkGalFlushFace(model)
  assert.deepEqual(calls[1], [33, 1233])
  assert.match(source, /forkGalFlushFace\(model\);[\s\S]*face\.indices\.map\(i => im\.coreModel\.getDrawableVertices\(i\)\)/)
})

test('light anchor spring settles rapidly and is stable on repeated reads of the same frame', () => {
  const state = {}, first = { x: 0, top: 0, chin: 40, width: 38, rotation: 0 }
  ctx.forkGalSmoothHead(state, first, 0)
  const target = { ...first, x: 10 }
  const head = ctx.forkGalSmoothHead(state, target, 16)
  assert.ok(head.x > 4 && head.x < 10)
  close(ctx.forkGalSmoothHead(state, target, 16).x, head.x)
  for (let t = 32; t <= 128; t += 16) ctx.forkGalSmoothHead(state, target, t)
  close(ctx.forkGalSmoothHead(state, target, 144).x, 10, 0.001)
})
