// private fork: the Live2D card preview's loading spinner (owner 2026-10; since the iOS-style rework it is the shared
// ForkSpinner) — no ring for a load under 150 ms or when the
// model's remembered first frame covers the card; otherwise a centred busy ring that fades out as the model fades in.
// (Frame-by-frame proof in Chromium: tests/harness/character-modal-v2.mjs.)
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { assetRenderer, walk } from './fixtures/asset-editor-renderer.mjs'
import { forkSpinnerSource } from './helpers/fork-spinner.mjs'

const source = await readFile(new URL('../tavern-plugin/src/client/fork-live2d-preview.js', import.meta.url), 'utf8')
const theme = await readFile(new URL('../tavern-plugin/lib/client-assets/fork-theme.css', import.meta.url), 'utf8')

function setup(t) {
  const r = assetRenderer(); t.after(() => r.dispose())
  const timers = [], hooks = {}
  const app = () => ({ view: { toDataURL: () => 'data:image/webp;base64,AA' }, screen: { width: 200, height: 248 },
    renderer: { gl: {}, on() {}, once(event, fn) { hooks[event] = fn } }, ticker: { add(fn) { hooks.tick = fn }, start() {}, stop() {} }, stage: { addChild() {} }, destroy() {} })
  const model = { alpha: 1, scale: { set() {} }, destroy() {}, motion() {}, expression: async () => true,
    internalModel: { coreModel: {}, settings: { motions: {}, expressions: [] }, motionManager: { groups: {}, expressionManager: null }, originalWidth: 200, originalHeight: 400 } }
  const PIXI = { Application: function () { return app() }, live2d: { Live2DModel: { from: async () => model } } }
  const context = { React: r.React, window: { devicePixelRatio: 1 }, console,
    useForkCubismRevision: () => 0, // private fork: already-installed fixture

    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length }, clearTimeout: id => { if (timers[id - 1]) timers[id - 1].fn = null },
    forkLoadLive2dRuntime: async () => PIXI, forkLive2dUseContext() {}, forkLive2dDropContext() {}, forkLive2dStartIdle() {} }
  vm.createContext(context); vm.runInContext(forkSpinnerSource + '\n' + source, context)
  const Preview = vm.runInContext('ForkLive2dFigurePreview', context)
  const fire = ms => { for (const timer of timers.filter(x => x.ms === ms && x.fn)) { const fn = timer.fn; timer.fn = null; fn() } }
  const ring = tree => walk(tree).find(n => (n.props.className || '').split(' ').includes('fork-live2d-preview-wait'))
  const attach = tree => { const wrap = walk(tree).find(n => n.props.className === 'fork-live2d-preview-canvas'); wrap.props.ref.current = { appendChild() {} } }
  return { r, context, Preview, timers, hooks, fire, ring, attach }
}

test('no ring before 150 ms; a centred ring after; it fades out with the model fade-in and then leaves', async t => {
  const f = setup(t)
  let open; const opened = new Promise(resolve => { open = resolve })
  const source = { identity: 'bundle-a', open: () => opened }
  let tree = f.r.render(f.Preview, { source, expression: '' }); f.attach(tree); tree = await f.r.settle()
  assert.equal(f.ring(tree), undefined, 'nothing in the first 150 ms (cached loads never flash a ring)')
  assert.ok(f.timers.some(x => x.ms === 150 && x.fn), 'the ring is armed at 150 ms')
  assert.equal(walk(tree).some(n => /ap-thumb-initial|ap-spinner/.test(n.props.className || '')), false, 'no letter, no corner spinner')
  f.fire(150); tree = await f.r.settle()
  assert.ok(f.ring(tree), 'ring after 150 ms of loading'); assert.equal(f.ring(tree).props.className, 'fork-spinner is-fill fork-live2d-preview-wait', 'the shared centred spinner'); assert.equal(f.ring(tree).props['data-out'], undefined)
  assert.equal(f.ring(tree).props['aria-hidden'], true); assert.equal(tree.props['aria-busy'], true)
  open({ url: '/m.model3.json', core: '/core.js', close() {} }); tree = await f.r.settle()
  f.hooks.tick(); f.hooks.postrender(); tree = await f.r.settle()
  assert.equal(tree.props['data-status'], 'ready')
  assert.equal(walk(tree).find(n => n.props.className === 'fork-live2d-preview-canvas').props['data-reveal'], 'in')
  assert.equal(f.ring(tree)?.props['data-out'], true, 'the ring fades out while the model fades in')
  f.fire(400); tree = await f.r.settle()
  assert.equal(f.ring(tree), undefined, 'gone once the model is shown'); assert.equal(tree.props['aria-busy'], undefined)
})

test('a fast load (first frame inside 150 ms) never shows the ring', async t => {
  const f = setup(t)
  const source = { identity: 'bundle-b', open: async () => ({ url: '/m.model3.json', core: '/core.js', close() {} }) }
  let tree = f.r.render(f.Preview, { source, expression: '' }); f.attach(tree); tree = await f.r.settle()
  f.hooks.tick(); f.hooks.postrender(); tree = await f.r.settle()
  f.fire(150); tree = await f.r.settle()
  assert.equal(f.ring(tree), undefined)
})

test('a remembered first frame covers the card: no ring while the model reloads', async t => {
  const f = setup(t)
  vm.runInContext('forkLive2dRememberFrame("bundle-c\\n", { url: "data:image/webp;base64,AA", width: 200, height: 248 })', f.context)
  const source = { identity: 'bundle-c', open: () => new Promise(() => {}) }
  let tree = f.r.render(f.Preview, { source, expression: '' }); f.attach(tree); tree = await f.r.settle()
  f.fire(150); tree = await f.r.settle()
  assert.ok(walk(tree).some(n => n.props.className === 'fork-live2d-preview-still'))
  assert.equal(f.ring(tree), undefined)
})

test('a failed load drops the ring for the static fallback', async t => {
  const f = setup(t)
  let fail; const source = { identity: 'bundle-d', open: () => new Promise((_, reject) => { fail = reject }) }
  t.mock.method(console, 'warn', () => {})
  let tree = f.r.render(f.Preview, { source, expression: '', fallback: { type: 'span', props: { className: 'fallback-art' }, children: [] } }); f.attach(tree); tree = await f.r.settle()
  f.fire(150); tree = await f.r.settle(); assert.ok(f.ring(tree))
  fail(new Error('ASSET_UNAVAILABLE')); tree = await f.r.settle()
  assert.equal(f.ring(tree), undefined); assert.ok(walk(tree).some(n => n.props.className === 'fallback-art'))
})

test('the ring is the shared centred ForkSpinner; no card-local ring styles remain', () => {
  assert.match(source, /h\(ForkSpinner, \{ key: [^}]*fill: true, className: "fork-live2d-preview-wait", out: status !== "loading" \}\)/)
  assert.doesNotMatch(source, /FORK_LIVE2D_WAIT_MS|setWaiting/, 'the delay lives in ForkSpinner (FORK_SPINNER_DELAY_MS)')
  assert.match(theme, /\.fork-live2d-preview-wait \{ --fork-spinner-max: 44px; \}/)
  assert.doesNotMatch(theme, /fork-live2d-wait-out|\.fork-live2d-preview-wait\[data-out\]/)
  assert.doesNotMatch(theme, /fork-delay-show/, 'the old 1.2 s corner spinner is gone')
})
