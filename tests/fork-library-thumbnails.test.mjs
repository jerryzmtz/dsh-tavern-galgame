// private fork: historical vocabulary is fixture data, not a runtime default.
// private fork: expand the shared emotion dependency in isolated client fragments.
import {withSpriteEmotionSource} from './helpers/sprite-emotion-source.mjs'
// private fork: real React + IntersectionObserver + cropped images, not a synchronous thumbnail mock.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { browserReactScript } from './fixtures/browser-react.mjs'
import { forkSpinnerSource } from './helpers/fork-spinner.mjs'
import { syntheticPack, PACK_ID, FIGURE_ID } from './fixtures/asset-packs/pack.mjs'

const client = name => readFile(new URL('../tavern-plugin/src/client/' + name, import.meta.url), 'utf8')
let source = await client('fork-asset-pack-ui.js')
// private fork: match the production shared colour include.
source = source.split('// @include-shared figure-auto-color.cjs').join(await readFile(new URL('../tavern-plugin/shared/figure-auto-color.cjs',import.meta.url),'utf8'))
source = source.split('// @include-shared asset-image-publication.cjs').join(await readFile(new URL('../tavern-plugin/shared/asset-image-publication.cjs',import.meta.url),'utf8'))
source = source.split('// @include-protocol director-commands.cjs').join(await readFile(new URL('../tavern-plugin/packages/dsh-presentation-protocol/src/director-commands.cjs', import.meta.url), 'utf8'))
source = source.split('// @include-domain pack-avatar.cjs').join(withSpriteEmotionSource(await readFile(new URL('../tavern-plugin/lib/domain/pack-avatar.cjs', import.meta.url), 'utf8')))
// private fork (voice v4 P1): the figure voice page is its own included module.
for (const name of ['figure','spine','import', 'voice', 'card', 'opening', 'character', 'engine', 'entry','gen','catalogue','setup']) source = source.split('// @include fork-asset-pack-' + name + '-ui.js').join(await client('fork-asset-pack-' + name + '-ui.js'))
// Test-only access to the shared owner lets cleanup be checked without waiting out its 30 second cache TTL.
// private fork: the mod library is included inside the pack UI closure, as in production.
for (const name of ['fork-mod-library.js','fork-mod-config-pages.js','fork-mod-settings.js','fork-mod-assets.js']) { const included = await client(name); source = source.replace('// @include ' + name, () => included) }
source = source.replace('return {App,Home,', 'return {Thumb,dropMedia,mediaShares,leaseQueues,App,Home,')
const moods = JSON.parse(await readFile(new URL('../tests/fixtures/legacy-dialogue-moods.json', import.meta.url), 'utf8'))

async function browserFixture(t, {thumbnail = false} = {}) {
  const { chromium } = await import('playwright')
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  t.after(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  t.after(() => assert.deepEqual(errors, []))
  await page.setContent('<html><body><div id="root" class="ap-ui"></div></body></html>')
  await page.addStyleTag({ content: await readFile(new URL('../tavern-plugin/lib/client-assets/fork-theme.css', import.meta.url), 'utf8') })
  await page.addScriptTag({ content: await browserReactScript() + ';window.React=modules.react;window.ReactDOM=modules["react-dom/client"];' + '\n' + await client('fork-pack-playback.cjs') + '\n' + forkSpinnerSource + '\n' + source })
  assert.deepEqual(errors, [], 'browser source loads')
  const pack = await syntheticPack()
  const bytes = [...pack.files].find(([file]) => file.endsWith('.png'))[1]
  const image = 'data:image/png;base64,' + bytes.toString('base64')
  if (thumbnail) {
    await page.route('http://thumbnail.test/api/dsh-asset-library/v2/thumbnail?**', route => route.fulfill({status:200,contentType:'image/png',body:bytes}))
    await page.evaluate(() => { const base=document.createElement('base');base.href='http://thumbnail.test/';document.head.append(base) })
  }
  await page.evaluate(({ moods, image, packId, figureId }) => {
    window.calls = []; window.released = []; window.pending = []; window.running = 0; window.maxRunning = 0
    window.binding = { previewMedia: ({ hash }) => {
      window.calls.push(hash); window.running++; window.maxRunning = Math.max(window.running, window.maxRunning)
      return new Promise(resolve => window.pending.push(() => { window.running--; resolve({ url: image + '#' + hash, release: () => window.released.push(hash) }) }))
    } }
    window.views = createForkAssetPackUI(React, { AvatarImage: ForkPackImage, emotions: { moods } })
    window.root = ReactDOM.createRoot(document.getElementById('root'))
    window.packId = packId
    window.figure = { id: figureId, name: 'Fixture', emotions:moods.map(({note,...row})=>row), outfits: [{ key: 'default', label: 'Default', sprite: { manifestKey: 'static', assets: {} } }] }
    // Deliberately shuffled: no emotion metadata, like v1 static-sprites in the reported pack.
    // private fork: shuffled native own-image keys still display canonical vocabulary order.
    window.states = ['love', 'shy', 'calm', 'sad', 'joy', 'disgust', 'anxious', 'anger'].map(id => ({ id, src: 'assets/' + id + '.png' }))
    window.figure.outfits[0].defaultEmotion='calm' // private fork
    for (const state of window.states) window.figure.outfits[0].sprite.assets[state.src] = state.id
    window.pack = { manifest: { id: packId }, sprites: { static: { kind: 'static-sprites', emotions: Object.fromEntries(states.map(({id,...render})=>[id,render])) } } }
    window.showFigure = () => root.render(React.createElement(views.FigureDetail, { binding, pack, figure, commitFigure() { throw Error('read-only fixture') } }))
    window.showThumbs = (prefix, className = 'ap-face-art', hidden = false) => root.render(React.createElement('div', { style: { display: hidden ? 'none' : 'flex', gap: 8 } },
      Array.from({ length: 8 }, (_, i) => React.createElement(views.Thumb, { key: prefix + i, binding, packId, hash: prefix + i, crop: { x: 0, y: 0, w: 1, h: 1 }, className }))))
    window.flush = () => window.pending.splice(0).forEach(resolve => resolve())
  }, { moods, image, packId: PACK_ID, figureId: FIGURE_ID })
  return page
}

async function drain(page, total = 8) {
  for (let i = 0; i < total; i++) {
    await page.evaluate(() => window.flush())
    await page.waitForTimeout(40)
  }
  await page.waitForFunction(() => [...document.querySelectorAll('#root img')].filter(img => img.complete && img.naturalWidth > 0).length >= 8)
}

test('private fork: the 差分 grid lists the declared 差分 of the outfit in declared order, never sprite state ordinal labels', async t => { // private fork (figure select)
  const page = await browserFixture(t)
  await page.evaluate(() => window.showFigure())
  await page.waitForSelector('.ap-face')
  const names = {calm: '平和', joy: '喜悦', anger: '愤怒', sad: '悲伤', anxious: '紧张', shy: '害羞', disgust: '嫌弃', love: '爱恋', crying: '哭泣', proud: '得意', absent: '缺少'}
  const declared = await page.evaluate(() => figure.emotions.map(row=>row.id))
  assert.deepEqual(await page.locator('.ap-face').evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label'))), declared.map(id => names[id])) // private fork (figure select): no virtual 哭泣
  await drain(page)
  assert.equal(await page.locator('.ap-face-art[data-ap-media="loading"]').count(), 0)
  assert.equal(await page.evaluate(() => window.maxRunning), 3)
  // Sprite metadata cannot add vocabulary; only figure-authored custom emotions add rows.
  await page.evaluate(() => {
    // private fork: a declared custom appears only where this outfit owns its image.
    pack.sprites.static.emotions.proud={src:states[0].src}
    window.figure.emotions.push({id:'proud',label:'得意'},{id:'absent',label:'缺少'}) // private fork
    window.showFigure()
  })
  await page.waitForFunction(() => document.querySelectorAll('.ap-face').length === 11) // private fork (figure select): 缺少 is not declared by the outfit
  assert.deepEqual(await page.locator('.ap-face').evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label'))), [...declared, 'proud', 'absent'].map(id => names[id]))
})

test('more than three cropped thumbnails drain the shared pool across unmounts and hidden outfit/list containers', async t => {
  const page = await browserFixture(t)
  await page.evaluate(() => window.showThumbs('old'))
  await page.waitForFunction(() => window.calls.length === 3)
  // Unmount while three leases are in flight and five are queued, then mount another list on the same binding.
  await page.evaluate(() => window.root.render(null))
  await page.waitForFunction(() => !document.querySelector('#root img') && !document.querySelector('.ap-face-art'))
  await page.evaluate(() => window.showThumbs('new', 'ap-outfit-art'))
  await drain(page, 16)
  const state = await page.evaluate(() => ({ calls: calls.length, active: views.leaseQueues.get(binding).active, waiting: views.leaseQueues.get(binding).waiting.length, max: maxRunning,
    oldRefs: [...views.mediaShares.get(binding).values()].filter(e => e.key.includes('old')).map(e => e.refs) }))
  assert.deepEqual(state, { calls: 16, active: 0, waiting: 0, max: 3, oldRefs: Array(8).fill(0) })
  await page.evaluate(() => { for (let i = 0; i < 8; i++) views.dropMedia(binding, packId, 'old' + i) })
  assert.equal(await page.evaluate(() => released.length), 8, 'late leases released once after their last holder unmounts')
  await page.evaluate(() => window.showThumbs('hidden', 'ap-item-thumb', true))
  await page.waitForTimeout(100)
  assert.equal(await page.evaluate(() => calls.length), 16, 'hidden containers do not eagerly lease')
  await page.evaluate(() => window.showThumbs('hidden', 'ap-item-thumb', false))
  await drain(page)
  assert.equal(await page.evaluate(() => calls.length), 24, 'revealing a hidden list activates every observer')
  await page.evaluate(() => window.root.render(null))
  await page.waitForFunction(() => !document.querySelector('.ap-item-thumb'))
  await page.evaluate(() => { for (const prefix of ['new', 'hidden']) for (let i = 0; i < 8; i++) views.dropMedia(binding, packId, prefix + i) })
  assert.equal(await page.evaluate(() => released.length), 24)
  assert.equal(await page.evaluate(() => new Set(released).size), 24, 'release is idempotent')
})

test('cached host thumbnails paint the library grid without original media leases',async t => {
  const page = await browserFixture(t,{thumbnail:true})
  await page.evaluate(() => window.showThumbs('cached-'))
  await page.waitForFunction(() => [...document.querySelectorAll('#root img')].filter(img => img.complete && img.naturalWidth > 0).length === 8)
  assert.deepEqual(await page.evaluate(() => window.calls),[])
  assert.equal(await page.locator('#root img').evaluateAll(nodes => nodes.every(img=>img.src.includes('/v2/thumbnail?'))),true)
})