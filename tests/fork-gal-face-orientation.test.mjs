// private fork: the face window follows actual stage mirroring, including action turns.
import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import {readFile} from 'node:fs/promises'
const read = path => readFile(new URL('../tavern-plugin/' + path, import.meta.url), 'utf8')
const scene = await read('src/client/fork-gal-scene.js')
const context = {}
vm.runInNewContext(scene.slice(scene.indexOf('function forkGalSyncFaceOrientation('), scene.indexOf('function forkGalCreateScene(')), context)
function portrait(alias) {
  const values = new Map(); let writes = 0
  return {getAttribute: () => alias, style: {getPropertyValue: name => values.get(name), setProperty(name, value) { values.set(name, value); writes++ }}, get flip() { return values.get('--face-flip') }, get writes() { return writes }}
}
function figure(alias, x, kind = 'static') {
  return {figure: {alias}, kind, [kind === 'live2d' ? 'model' : 'sprite']: {scale: {x}}}
}
test('source orientation, directed flip, turn reversal, Live2D and absent figures', () => {
  const a = portrait('a'), b = portrait('b'), offstage = portrait('offstage')
  const root = {querySelectorAll: selector => { assert.equal(selector, '[data-face-actor]'); return [a, b, offstage] }}
  const figures = new Map([['a', figure('a', 2)], ['b', figure('b', -0.4, 'live2d')]])
  const sync = () => context.forkGalSyncFaceOrientation(root, figures)
  sync(); assert.deepEqual([a.flip, b.flip, offstage.flip], ['1', '-1', '1'])
  sync(); assert.equal(a.writes, 1, 'unchanged frames do not rewrite styles')
  figures.get('a').sprite.scale.x = -0.2; sync(); assert.equal(a.flip, '-1')
  figures.get('a').sprite.scale.x = 0.2; sync(); assert.equal(a.flip, '1', 'temporary turn uses rendered sign, not directed gaze')
  figures.get('a').sprite.scale.x = 0; sync(); assert.equal(a.flip, '1')
  figures.delete('b'); sync(); assert.equal(b.flip, '1', 'offstage portrait returns to source orientation')
  context.forkGalSyncFaceOrientation(null, figures)
})
test('crossfading layers retain their own speaker identity and both image renderers forward it', async () => {
  const stage = await read('src/client/fork-gal-stage.js')
  const sprite = await read('src/client/fork-layered-sprite-render.js')
  const css = await read('lib/client-assets/fork-theme.css')
  assert.match(stage, /faceActor: layer\.key/)
  assert.match(stage, /"data-face-actor": layer\.key/)
  assert.match(sprite, /'data-face-actor': props\.faceActor/)
  assert.match(scene, /forkGalSyncFaceOrientation\(stageHost, state\.figures\)/)
  assert.match(css, /\.fork-gal-side-img \{ scale: var\(--face-flip, 1\) 1; \}/)
  assert.match(css, /@keyframes fork-gal-side-in \{ from \{ opacity: 0; transform: translateX\(-9%\); \} \}/)
})

test('cropped faces mirror the complete crop wrapper, not the offset source image', async () => {
  const React = {createElement: (type, props, ...children) => ({type, props, children}), useRef: () => ({current: null}), useState: value => [value, () => {}], useSyncExternalStore: (_subscribe, get) => get(), useEffect() {}}
  const ctx = {React}
  vm.runInNewContext(await read('src/client/fork-pack-playback.cjs'), ctx)
  const face = ctx.ForkPackImage({identity: 'a', src: '/a.png', crop: {x: 0.2, y: 0.1, w: 0.5, h: 0.4}, cropOverflow: true, className: 'fork-gal-side-img', 'data-face-actor': 'a'})
  assert.equal(face.type, 'span')
  assert.equal(face.props['data-face-actor'], 'a')
  assert.equal(face.children[0].props['data-face-actor'], undefined)
})
