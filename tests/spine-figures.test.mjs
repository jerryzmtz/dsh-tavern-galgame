// private fork (docs/fork/spine-figures.md): Spine figures are a pack bundle kind plus an outfit `spine` block.
import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import os from 'node:os'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import { createRequire } from 'node:module'
import { createAssetPackService } from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/service.js'
import { selectPackFigure } from '../tavern-plugin/lib/domain/asset-pack-presentation.js'
import { png } from './fixtures/asset-packs/pack.mjs'
const { packFigureRenderInputs, packSpineBottomFade } = createRequire(import.meta.url)('../tavern-plugin/src/client/fork-pack-playback.cjs')

test('missing Spine runtime gives the importer an installation note and permits a later retry', async () => {
  const window = {}, runtime = {Spine(){}, SpineParser(){}, TextureAtlas(){}}
  let installed = false, loads = 0
  const load = runInNewContext((await readFile(new URL('../tavern-plugin/src/client/fork-spine.js',import.meta.url),'utf8')) + '\nforkLoadSpineRuntime', {
    window, forkLoadPixiRuntime:async () => {}, forkLoadScript:async () => {
      loads++
      if (!installed) throw Error('404')
      window.PIXI = {spine:runtime}
    }
  })
  await assert.rejects(load(), /Spine 运行库未安装.*运行库 导入/)
  installed = true
  assert.ok(await load() === runtime)
  assert.equal(loads, 2)
})

// Header-only skeletons: install validation reads the version, the browser runtime reads the rest.
const text = value => [value.length + 1, ...Buffer.from(value)]
const skel38 = () => Uint8Array.from([...text('fixturehash0123456789abcdef'), ...text('3.8.99'), 0, 0, 0])
const skel42 = () => Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, ...text('4.2.33'), 0, 0, 0])
const atlas = page => Buffer.from(`\n${page}\nsize: 8,8\nformat: RGBA8888\nfilter: Linear,Linear\nrepeat: none\nhead\n  rotate: false\n  xy: 0, 0\n  size: 8, 8\n  orig: 8, 8\n  offset: 0, 0\n  index: -1\n`)
const rejected = code => error => error.code === code

test('Spine bundles install only runtime-readable skeletons with a closed atlas, and lease as inert data', async t => {
  const assetRoot = await mkdtemp(path.join(os.tmpdir(), 'spine-pack-'))
  t.after(() => rm(assetRoot, {recursive:true, force:true}))
  const service = createAssetPackService({assetRoot, authorizeLease:async () => true})
  t.after(() => service.dispose())
  let {snapshot} = await service.createPack({name:'Spine', expectedRevision:null})
  const packId = snapshot.manifest.id, descriptor = {kind:'spine', entry:'rig/fig.skel'}
  const bundle = skeleton => new Map([['rig/fig.skel', skeleton], ['rig/fig.atlas', atlas('page.png')], ['rig/page.png', png([200, 100, 50])]])
  await assert.rejects(service.putBundle({packId, expectedRevision:snapshot.revision, bundleKey:'rig', descriptor, files:bundle(skel42())}), rejected('UNSUPPORTED_SPINE_VERSION'))
  const missingPage = bundle(skel38()); missingPage.delete('rig/page.png')
  await assert.rejects(service.putBundle({packId, expectedRevision:snapshot.revision, bundleKey:'rig', descriptor, files:missingPage}), rejected('MISSING_DEPENDENCY'))
  const script = bundle(skel38()); script.set('rig/run.js', Buffer.from('void 0'))
  await assert.rejects(service.putBundle({packId, expectedRevision:snapshot.revision, bundleKey:'rig', descriptor, files:script}))
  ;({snapshot} = await service.putBundle({packId, expectedRevision:snapshot.revision, bundleKey:'rig', descriptor, files:bundle(skel38())}))
  assert.equal(snapshot.manifest.bundles.rig.kind, 'spine')
  const figure = {schemaVersion:1, name:'Spine figure', enabled:true, recall:{mode:'constant'}, appearance:'spine', heightCm:155, emotions:[{id:'calm', label:'平静'}, {id:'sad', label:'难过'}],
    outfits:[{key:'lobby', label:'Lobby', enabled:true, spine:{bundleKey:'rig', defaultAnimation:'Idle', talkAnimation:'Talk', emotionMap:{sad:{animation:'Sad'}}, hideSlots:['rain_*', 'toplight']}}]}
  await assert.rejects(service.createFigure({packId, expectedRevision:snapshot.revision, figure:{...figure, outfits:[{...figure.outfits[0], spine:{...figure.outfits[0].spine, bundleKey:'missing'}}]}}), rejected('MISSING_DEPENDENCY'))
  await assert.rejects(service.createFigure({packId, expectedRevision:snapshot.revision, figure:{...figure, outfits:[{...figure.outfits[0], spine:{...figure.outfits[0].spine, hideSlots:['*']}}]}}))
  ;({snapshot} = await service.createFigure({packId, expectedRevision:snapshot.revision, figure}))
  const lease = await service.leaseBundle({packId, bundleKey:'rig', origin:'http://localhost', scope:'session'})
  assert.ok(lease.url.endsWith('/rig/fig.skel'))
  for (const [name, type] of [['rig/fig.skel', 'application/octet-stream'], ['rig/fig.atlas', 'text/plain; charset=utf-8'], ['rig/page.png', 'image/png']]) {
    const response = await service.respondLease({ticket:lease.ticket, resource:name, request:new Request(new URL(name.slice(4), 'http://localhost' + lease.url))})
    assert.equal(response.status, 200, name); assert.equal(response.headers.get('content-type'), type, name)
  }
})

test('Spine outfits play their mapped animations and fall back to the sprite without the Spine runtime', () => {
  const figure = {schemaVersion:1, id:'f', name:'Misaki', enabled:true, appearance:'spine', heightCm:155, emotions:[{id:'calm', label:'平静'}, {id:'sad', label:'难过'}],
    outfits:[{key:'lobby', label:'Lobby', enabled:true, defaultEmotion:'calm',
      spine:{bundleKey:'rig', defaultAnimation:'Idle', talkAnimation:'Talk', emotionMap:{sad:{animation:'Sad', talk:'SadTalk'}}, hideSlots:['rain_*'],
        anatomy:{figureTop:0.1, headTop:0.1, chin:0.4, visibleBottom:1, feet:1.2, supportX:0.5, poseHeightRatio:0.5, headRatio:0.5, posture:'standing', crop:'custom', source:'calibrated'}},
      sprite:{manifestKey:'still', assets:{'calm.png':'a'.repeat(64)}}}]}
  const sprites = {still:{version:1, kind:'static-sprites', emotions:{calm:{src:'calm.png'}}}}
  const sad = selectPackFigure(figure, sprites, {emotion:'sad'})
  assert.equal(sad.form, 'spine'); assert.deepEqual(sad.spineEmotion, {animation:'Sad', talk:'SadTalk'}); assert.equal(sad.anatomy.poseHeightRatio, 0.5)
  // Public builds ship no Spine runtime: the display falls down the ladder and says why.
  const missing = selectPackFigure(figure, sprites, {emotion:'sad', spine:false})
  assert.equal(missing.form, 'sprite'); assert.ok(missing.diagnostics.includes('spine-runtime-missing'))
  const audio = {paused:false, ended:false}
  const render = (selection, speaking) => packFigureRenderInputs({...selection, alias:'misaki', ref:{packId:'p', figureId:'f'}, revision:'r', modelUrl:'blob:skeleton',
    views:{stage:true, portrait:false}, media:{model:{identity:'model'}, sprite:{identity:'geometry'}, avatar:{identity:null}}}, {audio, speaking}).stage
  const voiced = render(sad, true)
  assert.equal(voiced.kind, 'spine'); assert.equal(voiced.url, 'blob:skeleton')
  assert.deepEqual([voiced.animation, voiced.talk, voiced.audio], ['Sad', 'SadTalk', audio])
  assert.deepEqual(voiced.spine, {defaultAnimation:'Idle', hideSlots:['rain_*']})
  const calm = render(selectPackFigure(figure, sprites, {emotion:'calm'}), false)
  assert.deepEqual([calm.animation, calm.talk, calm.audio], ['Idle', 'Talk', null])
  // An emotion change switches animation tracks; it never reloads the rig.
  assert.equal(calm.identity, voiced.identity)
})

test('Spine bodies cut off by their frame fade out at the bottom; whole bodies and an outfit override of 0 do not', () => {
  const cut = {figureTop:0.2, visibleBottom:1, feet:1.3, crop:'custom'}
  const fade = packSpineBottomFade(undefined, cut, null, 1000)
  assert.equal(fade.end, 1); assert.ok(Math.abs(fade.start - (1 - 0.12 * 0.8)) < 1e-9)
  assert.equal(packSpineBottomFade(undefined, {figureTop:0.1, visibleBottom:0.95, feet:0.95, crop:'full'}, null, 1000), null)
  assert.equal(packSpineBottomFade(0, cut, null, 1000), null)
  assert.ok(Math.abs(packSpineBottomFade(0.3, cut, null, 1000).start - (1 - 0.3 * 0.8)) < 1e-9)
  // Without anatomy the measured rest pose decides: ink touching the frame's bottom edge.
  assert.deepEqual(packSpineBottomFade(undefined, null, {figureTop:100, visibleBottom:1000, cropSuspected:true}, 1000), {start:1 - 0.12 * 0.9, end:1})
  assert.equal(packSpineBottomFade(undefined, null, {figureTop:100, visibleBottom:900, cropSuspected:false}, 1000), null)
})
