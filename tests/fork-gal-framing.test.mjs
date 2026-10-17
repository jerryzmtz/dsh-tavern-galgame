import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const scene = await readFile(new URL('../tavern-plugin/src/client/fork-gal-scene.js', import.meta.url), 'utf8')
const live = await readFile(new URL('../tavern-plugin/src/client/fork-live2d.js', import.meta.url), 'utf8')
const helpers = scene.slice(scene.indexOf('// ---------- Scene helpers'), scene.indexOf('// ---------- Scene runtime'))
const ctx = {}
vm.runInNewContext(helpers + live.slice(live.indexOf('function forkLive2dSlots'), live.indexOf('// Staged actions without')), ctx)
const close = (a, b, eps = 1e-3) => assert.ok(Math.abs(a - b) < eps, `${a} ~= ${b}`)
const plain = x => JSON.parse(JSON.stringify(x))
const camera = { zoom: 1, fx: 0.5, fy: 0.42, ax: 0.5, ay: 0.42, rotation: 0 }
const projectTop = (head, cam, W, H, shift = 0) => cam.ay * H + cam.zoom * (
  (head.top + shift - cam.fy * H) * Math.cos(cam.rotation) +
  (head.x - cam.fx * W) * Math.sin(cam.rotation) - Math.abs(Math.sin(cam.rotation)) * head.width / 2)

function model(frame, estimate, W = 2400, H = 3100) {
  return { internalModel: { originalWidth: W, originalHeight: H, settings: { json: { ForkStage: frame } } },
    forkStageHeadFrame: estimate, scale: { x: 1, y: 1, set(x, y) { this.x = x; this.y = y } } }
}

test('scene and Live2D runtime source compile, not just the extracted layout helpers', () => {
  assert.doesNotThrow(() => new vm.Script(scene))
  assert.doesNotThrow(() => new vm.Script(live))
})

test('visible frame matches CSS bars at wide, tall and mobile aspect ratios; normal reserves UI', () => {
  const normal = ctx.forkGalVisibleFrame(1600, 900, false)
  assert.deepEqual(plain(normal), { top: 52, bottom: 900, height: 848, margin: 848 * 0.015 })
  for (const [W, H] of [[1600, 900], [2400, 900], [900, 1200], [390, 844], [844, 390]]) {
    const frame = ctx.forkGalVisibleFrame(W, H, true)
    // CSS --film-bar: the cinema bar, never shorter than two subtitle lines plus the name line.
    const cssBar = Math.max(Math.min(H * 0.16, Math.max(H * 0.08, (H - W / 2.35) / 2)), Math.min(22, Math.max(16, W * 0.015)) * 3.4 + 58.25)
    close(frame.top, cssBar)
    close(frame.bottom, H - cssBar)
    close(frame.height, H - 2 * cssBar)
    close(frame.margin, frame.height * 0.03)
  }
  assert.equal(ctx.forkGalVisibleFrame(1600, 900, false, 64).top, 64)
})

test('flat sizing, ground and close-up lift retain the full stage, independent of bars and toolbar', () => {
  for (const [W, H] of [[1600, 900], [390, 844]]) for (const focus of [0.8, 1, 1.45]) {
    const place = (frame, lift = 0, ground = 0) => ctx.forkGalFlatLayout(1000, 2000, W, H, 0.5, focus, lift, 0.8, ground, frame)
    const original = place()
    close(original.scale, Math.min(H * 0.88 / 2000, W * 0.4 / 1000) * 0.8 * focus)
    for (const mix of [0, 0.25, 0.5, 0.75, 1]) {
      const frame = ctx.forkGalVisibleFrame(W, H, mix)
      assert.deepEqual(plain(place(frame)), plain(original))
      close(place(frame).y, H)
      close(place(frame, 0, 0.15).y, H * 0.85)
      close(place(frame, 1).y, H + 0.3 * 0.88 * H)
      close(place(frame).x, W / 2)
    }
  }
  // Guard the runtime call sites too: helpers alone cannot catch a cropped height passed by a caller.
  const runtime = scene.slice(scene.indexOf('function tickFigures('), scene.indexOf('function faceEnvironment('))
  assert.doesNotMatch(runtime, /frame\.(height|top|bottom)/)
  assert.equal((runtime.match(/forkLive2dPlace\(model, W, H,/g) || []).length, 2)
  assert.match(scene, /tickFigures\(desc, now, dt, W, H\);/)
})

test('camera focus and anchor map to the same visible frame, keeping an identity shot neutral', () => {
  for (const film of [false, true]) {
    const frame = ctx.forkGalVisibleFrame(1600, 900, film)
    const result = ctx.forkGalFrameCameraTarget(camera, frame, 900)
    close(result.fy * 900, frame.top + 0.42 * frame.height)
    close(result.ay, result.fy)
    close(projectTop({ x: 800, top: 200, width: 100 }, result, 1600, 900), 200)
    assert.equal(result.zoom, 1)
  }
  assert.equal(camera.fy, 0.42, 'does not mutate the shot target')
})

test('post-camera headroom shifts each rest head down, never scales it, including dutch and off-centre shots', () => {
  for (const film of [false, true]) for (const rotation of [0, -0.061, 0.061]) {
    const frame = ctx.forkGalVisibleFrame(1600, 900, film)
    const cam = { ...camera, zoom: 2, rotation, fy: 0.48 }
    for (const x of [320, 800, 1280]) {
      const head = { x, top: frame.top + 20, width: 160 }
      const before = JSON.stringify({ head, cam })
      const shift = ctx.forkGalHeadroomShift(head, cam, frame, 1600, 900)
      assert.ok(shift > 0)
      close(projectTop(head, cam, 1600, 900, shift), frame.top + frame.margin)
      assert.equal(JSON.stringify({ head, cam }), before)
      const safeHead = { ...head, top: head.top + shift + 10 }
      assert.equal(ctx.forkGalHeadroomShift(safeHead, cam, frame, 1600, 900), 0)
    }
  }
})

test('alpha head estimate rejects side pixels, faint pixels, isolated noise; includes a substantial ahoge', () => {
  const W = 120, H = 100, data = new Uint8ClampedArray(W * H * 4)
  const put = (x, y, alpha = 255) => { data[(y * W + x) * 4 + 3] = alpha }
  for (let y = 0; y < 20; y++) { put(2, y); put(117, y); put(60, y, 63) }
  put(60, 2); put(61, 2) // one populated row is not a head
  put(60, 5); put(60, 6) // a single-pixel vertical wisp is also rejected
  for (let y = 12; y < 30; y++) for (let x = 59; x <= 61; x++) put(x, y, 64)
  for (let y = 25; y < H; y++) for (let x = 45; x < 75; x++) put(x, y)
  close(ctx.forkGalEstimateHeadTop(data, W, H), 0.12)
  assert.equal(ctx.forkGalEstimateHeadTop(new Uint8ClampedArray(data.length), W, H), 0)
  assert.equal(ctx.forkGalEstimateHeadTop(new Uint8ClampedArray(data.length).fill(255), W, H), 0)
})

test('texture head metrics are cached by URL and alpha-read failures use a conservative fallback', () => {
  let reads = 0
  const W = 12, H = 10, data = new Uint8ClampedArray(W * H * 4)
  for (let y = 3; y < H; y++) for (let x = 4; x < 8; x++) data[(y * W + x) * 4 + 3] = 255
  ctx.document = { createElement: () => ({ getContext: () => ({ drawImage() {}, getImageData() { reads++; return { data } } }) }) }
  const texture = { width: W, height: H, baseTexture: { resource: { source: {} } } }
  close(ctx.forkGalTextureHeadTop('test:portrait-sha', texture), 0.3)
  close(ctx.forkGalTextureHeadTop('test:portrait-sha', texture), 0.3)
  assert.equal(reads, 1)
  ctx.document.createElement = () => { throw new Error('tainted canvas') }
  assert.equal(ctx.forkGalTextureHeadTop('test:tainted', texture), 0)
})

test('film entry/exit ease their frame and headroom targets continuously without a delayed safety clamp', () => {
  close(ctx.forkGalFrameMix(0, 1, 0), 0)
  close(ctx.forkGalFrameMix(0, 1, 350), 0.5)
  close(ctx.forkGalFrameMix(0, 1, 700), 1)
  close(ctx.forkGalFrameMix(0, 1, 1000), 1)
  assert.ok(ctx.forkGalFrameMix(0, 1, 100) < 100 / 700)
  let previous = -1
  for (let ms = 0; ms <= 700; ms += 10) {
    const mix = ctx.forkGalFrameMix(0, 1, ms)
    assert.ok(mix >= previous)
    assert.ok(mix - Math.max(0, previous) < 0.05, 'no frame-sized jump')
    previous = mix
    close(ctx.forkGalFrameMix(1, 0, ms), 1 - mix)
    const frame = ctx.forkGalVisibleFrame(1280, 900, mix)
    const head = { x: 640, top: 80, width: 100 }, cam = { ...camera, zoom: 1.8 }
    const shift = ctx.forkGalHeadroomShift(head, cam, frame, 1280, 900)
    close(projectTop(head, cam, 1280, 900, shift), frame.top + frame.margin)
  }
  const mid = ctx.forkGalFrameMix(0, 1, 240)
  close(ctx.forkGalFrameMix(mid, 0, 0), mid, 1e-8)
  close(ctx.forkGalFrameMix(mid, 0, 700), 0)
})

test('headroom only constrains rest pose: jump and bow offsets remain additive', () => {
  const frame = ctx.forkGalVisibleFrame(1280, 900, true), cam = { ...camera, zoom: 1.8 }
  const head = { x: 640, top: 100, width: 100 }
  const shift = ctx.forkGalHeadroomShift(head, cam, frame, 1280, 900)
  const jump = ctx.forkGalFlatActAt('jump', 180), bow = ctx.forkGalFlatActAt('bow', 500)
  assert.ok(jump.dy < 0)
  assert.ok(bow.dy > 0)
  assert.ok(projectTop(head, cam, 1280, 900, shift + jump.dy * 700) < frame.top + frame.margin)
  assert.ok(projectTop(head, cam, 1280, 900, shift + bow.dy * 700) > frame.top + frame.margin)
})

test('Live2D uses full-stage declared head matching; sampled bounds never recalibrate size or ground', () => {
  const explicit = { HeadTop: 0.085, Chin: 0.235 }, estimate = { HeadTop: 0.07, Chin: 0.22 }
  const a = model(explicit, estimate), b = model(undefined, estimate), original = model()
  assert.deepEqual(plain(ctx.forkLive2dHeadFrame(a)), explicit)
  assert.deepEqual(plain(ctx.forkLive2dHeadFrame(b)), estimate)
  ctx.forkLive2dPlace(a, 1600, 900, 0.5, false, false, 1, 1)
  close((explicit.Chin - explicit.HeadTop) * 3100 * a.scale.y, 900 * 0.19)
  close(a.y + explicit.HeadTop * 3100 * a.scale.y, 900 * 0.13)
  for (const [W, H] of [[2400, 3100], [2400, 2200]]) for (const focus of [0.8, 1, 1.45]) {
    const sampled = model(undefined, estimate, W, H), baseline = model(undefined, undefined, W, H)
    for (const m of [sampled, baseline]) ctx.forkLive2dPlace(m, 1600, 900, 0.5, false, false, focus, 1)
    close(sampled.scale.y, baseline.scale.y)
    close(sampled.y, baseline.y)
  }
  for (const m of [b, original]) ctx.forkLive2dPlace(m, 1600, 900, 0.5, false, false, 1, 1)
  close(b.scale.y, 900 / (3100 * 0.758))
  close(b.y, original.y)
  const invalid = model({ HeadTop: 0.5, Chin: 0.1 }, estimate)
  assert.deepEqual(plain(ctx.forkLive2dHeadFrame(invalid)), estimate)
})
