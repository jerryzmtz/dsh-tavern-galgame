// private fork: follow protocol extraction paths; behavior assertions unchanged.
// private fork: v5 calibrated knee-up framing; all fixtures are offline geometry, not live assets.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { FORK_FIGURE_DISPLAY as C, resolveFigureSizing, forkFigureCatalog, forkFigureDirection, forkFigureSceneFrame, forkFigureSceneUpdate, forkFigureRatio } from '../tavern-plugin/packages/dsh-presentation-protocol/src/fork-figure-scale.cjs'
const W = 1707, H = 924, occluderTop = 723.125 // classic CSS, measured in offline Chrome
const sha = 'a'.repeat(64)
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`)
const metrics = (small = false) => ({ status: 'confirmed', sourceSha: sha, canvas: [2400, 3100], override: {
  figureTop: 187, headTop: 187, chin: small ? 187 + (3100 - 187) * .65 : 652, feet: small ? 3100 : 3210, visibleBottom: 3100,
  posture: small ? 'seated' : 'standing', heightBasis: small ? 'seated' : 'standing', crop: small ? 'full' : 'custom'
} })
const input = (heightCm, sceneHMax, extra = {}) => ({ version: 1, source: sha, canvas: [2400, 3100], metrics: metrics(heightCm === 23), heightBasis: heightCm === 23 ? 'seated' : 'standing', heightCm, sceneHMax, W, H, occluderTop, ...extra })

test('requested casts preserve the close head size, shared ground and compressed human ordering', () => {
  const a = [152, 155, 158].map(cm => resolveFigureSizing(input(cm, 158)))
  close(a[2].restHead.top / H, .13)
  assert.ok(Math.abs((a[0].restHead.chin - a[0].restHead.top) / H / .19 - 1) <= .15)
  close(a[1].scale / a[0].scale, forkFigureRatio(155 / 158) / forkFigureRatio(152 / 158)) // private fork: one curve, no identity-only human branch
  assert.ok(a[1].restHead.top < a[0].restHead.top)
  for (const r of a) { close(r.support.y / H, 1.37); assert.equal(r.ownGround, false); assert.ok(r.restHead.top >= (1 - C.headLimit) * H) }
  const b = [152, 155, 158, 23].map(cm => resolveFigureSizing(input(cm, 158)))
  assert.deepEqual(b.slice(0, 3), a)
  assert.equal(b[3].ownGround, true); close(b[3].restHead.chin, occluderTop - H * 40 / 900) // private fork: minimal face-safe lift, not feet at the box
  assert.ok(b[3].restHead.top > .03 * H); assert.ok(b[3].restHead.chin < occluderTop - .02 * H)
  const c = [152, 170, 118].map(cm => resolveFigureSizing(input(cm, 170)))
  close(c[1].restHead.top / H, .13); close(c[1].scale / c[0].scale, 1 / forkFigureRatio(152 / 170))
  assert.equal(c[2].ownGround, false); close(c[2].support.y / H, 1.37)
  assert.ok(c[2].restHead.chin < occluderTop - .02 * H)
})

test('ground selection uses REST, minimal lift, elevation once and no focus/speech dependence', () => {
  const base = resolveFigureSizing(input(23, 158))
  for (const focus of [.6, 1, 1.6]) for (const speaking of [false, true]) {
    const r = resolveFigureSizing(input(23, 158, { focus, speaking }))
    close(r.support.y, base.support.y); assert.equal(r.ownGround, true)
    // private fork: retired focus input no longer changes figure sizing.
    close(r.scale, base.scale * (speaking ? 1.03 : 1))
  }
  const shared = resolveFigureSizing(input(118, 170, { occluderTop: undefined }))
  // private fork: use the REST decision's arithmetic order at the exact threshold.
  const restChin = shared.sharedGroundY - (shared.feet - metrics().override.chin) * shared.scale
  // private fork: enter the safety zone only when the chin lacks the viewport-scaled margin.
  assert.equal(resolveFigureSizing(input(118, 170, { occluderTop: restChin + H * 40 / 900 - 1e-6 })).ownGround, true)
  assert.equal(resolveFigureSizing(input(118, 170, { occluderTop: restChin + H * 40 / 900 + 1e-6 })).ownGround, false)
  const raised = resolveFigureSizing(input(23, 158, { elevationCm: 10 }))
  close(raised.support.y, base.support.y) // private fork: elevation reduces required lift, not counted twice
  const high = resolveFigureSizing(input(23, 158, { elevationCm: 100 }))
  assert.equal(high.ownGround, false)
  assert.equal(resolveFigureSizing(input(23, 158, { version: 9 })).mode, 'legacy')
})

test('reference geometry is locked, carried, replayable and smoothly interpolated with a rare rescale', () => {
  const m = metrics(); m.override.headTop = 300
  const model = { id: 'm', kind: 'static', images: { default: sha + '.webp' }, figure: { version: 1, slots: { default: m } } }
  const catalog = forkFigureCatalog([{ alias: 'a', portrait: 'm', heightCm: 158 }], [model])
  const snapshot = forkFigureDirection({ cast: ['a'] }, [], catalog)
  const r = resolveFigureSizing(input(158, 158, { metrics: m, sceneGroundRatio: snapshot.groundRatio }))
  close(r.restHead.top / H, .13)
  // private fork: serialized frozen inputs reproduce the ruler without display locks.
  assert.deepEqual(forkFigureDirection({cast:['a']}, [], JSON.parse(JSON.stringify(catalog)),0),snapshot)
  const next = { ...snapshot, hMax: 220, groundRatio: 1, rescales: 1, event: { kind: 'rescale' } }
  const frame = forkFigureSceneUpdate(forkFigureSceneUpdate(null, snapshot, 0), next, 100)
  close(forkFigureSceneFrame(frame, 100).groundRatio, snapshot.groundRatio)
  close(forkFigureSceneFrame(frame, 700).groundRatio, (snapshot.groundRatio + 1) / 2)
  close(forkFigureSceneFrame(frame, 1300).groundRatio, 1)
  // A transient ruler that would hide this head must not flip the discrete destination decision.
  const transient = resolveFigureSizing(input(118, 220, { groundHMax: 170 }))
  assert.equal(transient.ownGround, false)
})

test('obsolete carry is ignored without mutating stored input', () => { // private fork: no persisted locks
  const catalog = { a: { '': [{ heightCm: 158, headRatio: 1, elevationCm: 0 }] } }
  const old = { version: 5, scene: 9, hMax: 999, rescales: 9 }
  const start = { cast: ['a'], figureScale: old }
  const result = forkFigureDirection(start, [], catalog, 0)
  assert.equal(result.version, 6); assert.equal(result.hMax, 158); assert.equal(result.scene, 0)
  assert.equal(old.version, 5)
})

test('film subtitle edge and normal box remain safe after REST, far focus, acts and camera close', async () => {
  const source = await readFile(new URL('../tavern-plugin/src/client/fork-gal-scene.js', import.meta.url), 'utf8'), ctx = {}
  vm.runInNewContext(source.slice(source.indexOf('// ---------- Scene helpers'), source.indexOf('// ---------- Scene runtime')), ctx)
  const film = ctx.forkGalVisibleFrame(W, H, 1)
  for (const edge of [occluderTop, film.bottom]) {
    const r = resolveFigureSizing(input(23, 158, { occluderTop: edge }))
    close(r.restHead.chin, edge - H * 40 / 900) // private fork: feet stay as low as face safety allows
    const rest = ctx.forkGalFaceRest(r.restHead, r.support.y, film.top + H * .02, edge, H)
    close(rest.lift, 0); close(rest.scale, 1)
    for (const name of ['lean', 'step-back', 'jump']) for (const focus of [.8, 1, 1.45]) for (const zoom of [1, 1.8]) {
      let previous = 0
      for (let ms = 0; ms <= 1400; ms += 16) {
        const act = ctx.forkGalFlatActAt(name, ms), scale = focus * act.zoom * act.scaleY
        const head = { ...r.restHead, top: r.support.y + (r.restHead.top - r.support.y) * scale + act.dy * r.poseSpan,
          chin: r.support.y + (r.restHead.chin - r.support.y) * scale + act.dy * r.poseSpan }
        const camera = { zoom, rotation: 0, fx: .5, fy: .42, ax: .5, ay: .42 }
        const clamp = ctx.forkGalFaceClamp(head, camera, W, H, edge, previous, .016)
        assert.ok(clamp.chin - clamp.lift * zoom <= edge - H * .02 + 1e-6)
        previous = clamp.lift
      }
    }
  }
  assert.match(source, /occluderTop: faceEnvironment\(desc, W, H\)\.occluderTop/)
  assert.match(source, /entry\.figureSizing, \.\.\.framing/)
  assert.match(source, /input, \.\.\.framing, W, H/)
})
