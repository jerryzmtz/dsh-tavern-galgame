// private fork (layered pilot phase 1): in the figure editor a layered 差分 is still one tile — its composed picture —
// and a 差分 whose face part is missing is a missing tile (dashed ✦) counted by 「缺 N」, exactly like a missing image.
import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import vm from 'node:vm'
import {assetRenderer} from './fixtures/asset-editor-renderer.mjs'
import {forkSpinnerSource} from './helpers/fork-spinner.mjs'
import {hybridFixture} from './fixtures/layered-parts.mjs'

const read = name => readFile(new URL('../tavern-plugin/' + name, import.meta.url), 'utf8')
let source = await read('src/client/fork-asset-pack-ui.js')
source = source.replace('// @include-shared figure-auto-color.cjs', await read('shared/figure-auto-color.cjs'))
source = source.replace('// @include-shared asset-image-publication.cjs', await read('shared/asset-image-publication.cjs'))
source = source.split('// @include-protocol director-commands.cjs').join(await read('packages/dsh-presentation-protocol/src/director-commands.cjs'))
const avatar = (await read('lib/domain/pack-avatar.cjs')).replace('// @include-shared sprite-emotions.cjs', await read('shared/sprite-emotions.cjs'))
source = source.replace('// @include-domain pack-avatar.cjs', () => avatar)
for (const name of ['figure','spine','import', 'voice', 'card', 'opening', 'character', 'engine', 'entry', 'gen', 'catalogue','setup', 'cg']) source = source.replace('// @include fork-asset-pack-' + name + '-ui.js', await read('src/client/fork-asset-pack-' + name + '-ui.js'))
for (const name of ['fork-widget-contracts.cjs', 'fork-widget-settings-ui.js','fork-mod-library.js','fork-mod-config-pages.js','fork-mod-settings.js','fork-mod-assets.js'] /* private fork: mod library lives inside the pack UI closure */) { const included = await read('src/client/' + name); source = source.replace('// @include ' + name, () => included) }

function load(t) {
  const r = assetRenderer(); t.after(() => r.dispose())
  const context = {React:r.React, TextEncoder, AbortController, setTimeout, clearTimeout, setInterval, clearInterval, forkForeground:{media:node => node},
    document:{activeElement:null, addEventListener(){}, removeEventListener(){}}, localStorage:{getItem:() => null, setItem(){}}}
  vm.runInNewContext(forkSpinnerSource + '\n' + source.replace('return {App,Home', 'return {emotionMapped,emotionState,stateBust,outfitEmotionRows,outfitHead,App,Home') + ';this.views=createForkAssetPackUI;', context)
  const moods = ['calm', 'joy', 'sad', 'shy', 'crying'].map(id => ({id, label:id, color:'#888'}))
  return context.views(r.React, {emotions:{moods}})
}
const outfitOf = manifest => {
  const assets = {}
  const add = value => { if (typeof value === 'string' && /\.png$/.test(value)) assets[value] = value.replace(/\W/g, '').padEnd(64, '0').slice(0, 64)
    else if (value && typeof value === 'object') Object.values(value).forEach(add) }
  add(manifest)
  return {key:'default', label:'女仆装', enabled:true, emotions:Object.keys(manifest.emotions), sprite:{manifestKey:'maid', assets}}
}

test('one tile per layered 差分: composed picture when its parts resolve, missing tile when its face is missing', t => {
  const views = load(t), m = hybridFixture(), outfit = outfitOf(m)
  assert.equal(views.emotionMapped('sprite', outfit, m, 'joy'), true)
  assert.equal(views.emotionMapped('sprite', outfit, m, 'singing'), true, 'whole 差分 keep their own picture')
  for (const id of ['shy', 'sad', 'crying']) assert.equal(views.emotionMapped('sprite', outfit, m, id), false, id + ' is a missing tile')
  const bust = views.stateBust(outfit, views.emotionState(outfit, m, 'joy'))
  assert.equal(bust.hash, null)
  assert.deepEqual(Object.keys(bust.parts.parts).sort(), ['base', 'face-joy', 'mouth-calm'])
  assert.equal(bust.parts.parts['face-joy'].hash, outfit.sprite.assets['parts/face-joy.png'])
  assert.equal(views.stateBust(outfit, views.emotionState(outfit, m, 'singing')).hash, outfit.sprite.assets['emotions/singing/stage.png'])
  // A part whose media is not in the outfit is never drawn as half a face.
  const broken = {...outfit, sprite:{...outfit.sprite, assets:{...outfit.sprite.assets}}}; delete broken.sprite.assets['parts/face-joy.png']
  assert.equal(views.stateBust(broken, views.emotionState(broken, m, 'joy')), null)
  // The cast face uses calm's composite.
  assert.ok(views.outfitHead(outfit, m).parts)
})

// private fork (missing-ui, owner 2026-10): 舞台设置 no longer counts 「缺 N」; the editor's dashed tiles are where a layered
// 差分 without a usable face shows, like any missing image — the outfit's one 差分 list (custom ones it owns) in every view.
test('a layered 差分 without a usable face is a dashed missing tile, like any missing image', t => {
  const views = load(t), m = hybridFixture(), outfit = outfitOf(m)
  // private fork: every fixture slot is declared.
  const figure = {name:'大肥鱼', emotions:Object.keys(m.emotions).map(id=>({id,label:id.slice(0,6)})), outfits:[outfit]}
  const rows = views.outfitEmotionRows(figure, outfit, m) // private fork (figure select): the outfit's declared 差分
  assert.deepEqual(Array.from(rows, r => r.id), Object.keys(m.emotions), 'exactly the declared 差分, in declared order') // private fork (figure select)
  assert.deepEqual([...rows.filter(r => !views.emotionMapped('sprite', outfit, m, r.id)).map(r => r.id)].sort(), ['crying', 'sad', 'shy'])
})
