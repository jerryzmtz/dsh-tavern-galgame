import {importFigureVariants} from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/import-figure-variants.js' // private fork
// private fork (asset-gen; gen-ui r12, owner 2026-10-15 — output/gen-ui-mock, DECISIONS U1–U4): the 生图 UI against the real
// consent-bound backend — temp packs, the real asset-generation domain and image module, a local fake image server; no paid
// calls. Pictures are made where they go: a 差分 tile's menu (生成… / 重画… / 改图… / 上传 / 设置回退 › / 删除…) opens the one
// generation dialog, the request runs in the tile, 采用 from the tile; 「生成缺失立绘」 / 「生成缺失头像」 send at once for the
// missing 差分 only, with each one's default prompt; 「存为默认」 keeps a prompt for that cell only; 设置回退 names the stand-in. The 生图 page is 设定 (人物 · 服装) and
// this outfit's 生成 records. Also: the eight-face sheet with slice receipts, a resumed import, the confirmation gate
// (no money talk), the unsupported channel ⚠, backgrounds and the 人物设定图.
import test from 'node:test'
import {withSpriteEmotionSource} from './helpers/sprite-emotion-source.mjs'
import {patchFigureImages} from './fixtures/atomic-figure-images.mjs'
import assert from 'node:assert/strict'
import {readFile, mkdir, mkdtemp} from 'node:fs/promises'
import {createServer} from 'node:http'
import vm from 'node:vm'
import {webcrypto, createHash} from 'node:crypto'
import {fileURLToPath} from 'node:url'
import {deflateSync, crc32} from 'node:zlib'
import {assetRenderer, walk, text} from './fixtures/asset-editor-renderer.mjs'
import {forkSpinnerSource} from './helpers/fork-spinner.mjs'
import {createAssetPackService} from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/service.js'
import {createImageGenerationModule} from '../tavern-plugin/packages/dsh-image-gen/src/module.js'
import {createAssetGeneration, assetGenerationResult} from '../tavern-plugin/lib/domain/asset-generation.js'
import {createProfileDataStore} from '../tavern-plugin/lib/profile-data-store.js'

const read = path => readFile(new URL(path, import.meta.url), 'utf8')
let source = await read('../tavern-plugin/src/client/fork-asset-pack-ui.js')
source = source.split('// @include-shared figure-auto-color.cjs').join(await read('../tavern-plugin/shared/figure-auto-color.cjs'))
source = source.split('// @include-shared asset-image-publication.cjs').join(await read('../tavern-plugin/shared/asset-image-publication.cjs'))
source = source.split('// @include-protocol director-commands.cjs').join(await read('../tavern-plugin/packages/dsh-presentation-protocol/src/director-commands.cjs'))
source = source.split('// @include-domain pack-avatar.cjs').join(await read('../tavern-plugin/lib/domain/pack-avatar.cjs'))
for (const name of ['figure','spine','import','card','opening','character','engine','entry','gen','cg','voice','catalogue','setup']) source = source.split('// @include fork-asset-pack-' + name + '-ui.js').join(await read('../tavern-plugin/src/client/fork-asset-pack-' + name + '-ui.js'))
for (const name of ['fork-widget-contracts.cjs','fork-widget-settings-ui.js','fork-mod-library.js','fork-mod-config-pages.js','fork-mod-settings.js','fork-mod-assets.js'] /* private fork: mod library lives inside the pack UI closure */) { const included = await read('../tavern-plugin/src/client/' + name); source = source.replace('// @include ' + name, () => included) }
source = withSpriteEmotionSource(source) // private fork: shared native resolver in the isolated browser realm.
// private fork (gen prompts): the override dot of 设置 → 生图 is the shared ForkOverrideDot (bundled at the outer level).
const modConfig = await read('../tavern-plugin/src/client/fork-mod-config-ui.js')
source = forkSpinnerSource + '\n' + modConfig.slice(modConfig.indexOf('function ForkOverrideDot('), modConfig.indexOf('// `data-fork-cfg-keep`')) + '\n' + source
const moods = importFigureVariants({}, {f:{outfits:[{}]}},{}).figures.f.emotions
const SHEET = ['joy','anger','sad','anxious','calm','shy','disgust','love']
const MONEY = /计费|费用|按次|收费|扣费/

// Synthetic RGBA PNG: a transparent border around an opaque block (or fully opaque).
function png(width, height, {opaque = false} = {}) {
  const chunk = (type, data) => { const out = Buffer.alloc(data.length + 12); out.writeUInt32BE(data.length); out.write(type, 4); data.copy(out, 8); out.writeUInt32BE(crc32(out.subarray(4, -4)), out.length - 4); return out }
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * (width * 4 + 1) + 1 + x * 4, inside = x > width / 8 && x < width * 7 / 8 && y > height / 8 && y < height * 7 / 8
    raw[i] = (x * 7 + y) % 250; raw[i + 1] = 90; raw[i + 2] = 130; raw[i + 3] = opaque || inside ? 255 : 0
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}
// The fake server answers by the requested output: 1024x1536 → a sprite, 1024x1024 → an avatar, a transparent 1536x1024
// → a 4×2 sheet, an opaque 1536x1024 → a settei / background (small on purpose: real ⚠ checks come back).
const images = {sprite: png(200, 300), avatar: png(160, 160), sheet: png(256, 128), wide: png(192, 128, {opaque: true}), background: png(320, 200, {opaque: true})}
const byOutput = tool => tool.size === '1024x1536' ? images.sprite : tool.size === '1024x1024' ? images.avatar : tool.background === 'transparent' ? images.sheet : images.wide
// Values crossing from the UI realm (vm) to the backend become plain local objects / byte arrays.
const local = v => Object.prototype.toString.call(v) === '[object Map]' ? new Map([...v].map(([k,x]) => [k,local(x)])) : ArrayBuffer.isView(v) ? new Uint8Array(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength)) : Array.isArray(v) ? [...v].map(local) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, local(x)])) : v
const METHODS = {prepareAssetGeneration:'prepare', generateAssetCandidate:'generate', getAssetGenerationJob:'get', cancelAssetGenerationJob:'cancel', listAssetCandidates:'list',
  readAssetCandidate:'read', rejectAssetCandidate:'reject', retryAssetCandidateSave:'retrySave', acceptAssetCandidate:'accept',
  getAssetGenPrompts:'prompts', setAssetGenPrompt:'setPrompt'}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const cls = (n, name) => new RegExp('(^| )' + name + '( |$)').test(n.props.className || '')
const byLabel = (tree, label) => walk(tree).find(n => n.props['aria-label'] === label)
const button = (tree, label) => walk(tree).find(n => n.type === 'button' && text(n).replace(/\s+/g, ' ').trim() === label)
const sheetOf = tree => walk(tree).find(n => cls(n, 'ap-gen-sheet'))
const dialogOf = tree => walk(tree).find(n => cls(n, 'ap-gen-dialog'))
const confirmOf = tree => walk(tree).find(n => cls(n, 'ap-confirm'))
// A 差分 tile in 编辑 (its button is the trigger of the tile's menu) and a 生图 slot tile.
const face = (tree, label) => walk(tree).find(n => n.type === 'button' && cls(n, 'ap-face') && n.props['aria-label'] === label)
const tile = (tree, slot) => walk(walk(tree).find(n => n.props['data-gen-slot'] === slot)).find(n => n.type === 'button' && cls(n, 'ap-gen-tile'))
const menuItems = tree => walk(walk(tree).find(n => cls(n, 'ap-cell-menu'))).filter(n => n.type === 'button')
// The menu of one tile (menus of other tiles may still be open in this renderer: nothing clicks outside).
// private fork (cell menu input, owner 2026-10-17): on PC a cell's menu opens on right click (cellMenuTrigger).
const menuOpen = node => node.props.onContextMenu({ preventDefault() {} })
const cellOf = (tree, label) => walk(tree).find(n => cls(n, 'ap-emotion-cell') && !!face(n, label))
const cellMenu = (tree, label) => walk(cellOf(tree, label)).find(n => cls(n, 'ap-cell-menu'))
const itemText = n => text(n).replace(/\s+/g, ' ').trim()

async function fixture(t, {figure: extraFigure = {}, board = true} = {}) {
  const base = fileURLToPath(new URL('../.preview/asset-gen-ui-tests/', import.meta.url)); await mkdir(base, {recursive: true})
  const root = await mkdtemp(base + 'case-'), store = createProfileDataStore({dataRoot: root + '/data'}), library = createAssetPackService({assetRoot: root + '/packs'})
  const requests = [], calls = []
  let mode = 'ok', override = null
  const server = createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c)
    const body = JSON.parse(Buffer.concat(chunks)); requests.push(body)
    res.setHeader('content-type', 'application/json')
    if (mode === '500') { res.writeHead(500); res.end('{}'); return }
    res.end(JSON.stringify({output: [{type: 'image_generation_call', result: (override || byOutput(body.tools[0])).toString('base64')}]}))
  })
  let generation, r
  t.after(async () => { r?.dispose(); await generation?.dispose(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await library.dispose() })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const keys = new Map(), module = createImageGenerationModule({store, credentials: () => ({resolve: async k => ({value: keys.get(k)}), set: async (k, v) => keys.set(k, v)})})
  let provider = 'openai'
  const configure = (protocol, selectedProvider = 'openai') => module.configure({provider: (provider = selectedProvider), baseURL: `http://127.0.0.1:${server.address().port}/v1`, model: 'gpt-image-2.5', protocol, dispatcherModel: 'fake-dispatcher', apiKey: 'test-local-key'})
  await configure('responses-image-tool')
  const pack = (await library.createPack({name: 'Authoring', expectedRevision: null})).snapshot
  // Ids differ from names on purpose: a figure 'Nana' with id from the service, an outfit 'daily' named 日常.
  const made = await library.createFigure({packId: pack.manifest.id, expectedRevision: pack.revision, figure: {schemaVersion: 1, name: 'Nana', appearance: 'sprite', enabled: true, recall: {mode: 'keyword'},
    outfits: [{key: 'daily', label: '日常', enabled: true, defaultEmotion: 'calm'}], ...extraFigure, emotions: [...moods, ...(extraFigure.emotions || [])]}})
  const packId = pack.manifest.id, figureId = made.figureId
  // The identity board (backend-only authoring) is the default 设定 the requests draw from; `board:false` starts with none.
  if (board) await patchFigureImages(library, made.snapshot, figureId, {board: images.wide}, hashes => ({identitySettei: {board: hashes.board, version: 'fixture-identity-v1', palette: []}}))
  generation = createAssetGeneration({store, imageModule: module, capture: () => module.capture(provider), getLibrary: () => library})
  const failures = [], busy = {count: 0}
  const service = Object.fromEntries(Object.keys(library).filter(key => typeof library[key] === 'function').map(key => [key, key === 'subscribe' ? library.subscribe : async (...args) => {
    const input = args.map(local); calls.push([key, input[0]])
    const fail = failures.findIndex(f => f.method === key && f.when(input[0])); if (fail >= 0) { failures.splice(fail, 1); throw Object.assign(new Error('写入失败（测试）'), {code: 'IO'}) }
    busy.count++; try { return await library[key](...input) } finally { busy.count-- }
  }]))
  const binding = {service, rpc: async (method, args) => {
    const input = local(args); calls.push([method, input])
    if (!METHODS[method]) throw new Error('unexpected rpc ' + method)
    const result = await assetGenerationResult(() => generation[METHODS[method]](input))
    if (!result.ok) throw Object.assign(new Error(result.error.message), result.error)
    return result
  }}
  r = assetRenderer()
  const prepareImage = async file => {
    const bytes = new Uint8Array(await file.arrayBuffer()), view = Buffer.from(bytes)
    return {bytes, descriptor: {ext: 'png', mime: 'image/png', size: bytes.length}, width: view.readUInt32BE(16), height: view.readUInt32BE(20), warnings: [], autoColor: '#8899aa', hasAlpha: true}
  }
  const context = {React: r.React, crypto: webcrypto, TextEncoder, TextDecoder, AbortController, File, atob, btoa, Blob, setInterval, clearInterval, setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms || 0, 3)), clearTimeout,
    forkForeground: {media: node => node}, document: {activeElement: null, addEventListener() {}, removeEventListener() {}}, localStorage: {getItem: () => null, setItem() {}}}
  vm.runInNewContext(source + ';this.views=createForkAssetPackUI;', context)
  const views = context.views(r.React, {emotions: {moods}, prepareImage})
  const render = (more = {}) => r.render(views.PackModal, {binding, packId, packs: [], initial: {kind: 'figures', figureId}, onClose() {}, onPacksChanged: () => calls.push(['packsChanged']), ...more})
  render()
  const f = {r, calls, requests, store, library, generation, packId, figureId, views, binding, failures, configure, setMode: v => { mode = v }, setImage: v => { override = v },
    fresh: () => library.getPackSnapshot({packId}), outfit: async () => (await library.getPackSnapshot({packId})).figures[figureId].outfits[0],
    count: method => calls.filter(([m]) => m === method).length, last: method => calls.filter(([m]) => m === method).at(-1)?.[1], all: method => calls.filter(([m]) => m === method).map(([, a]) => a)}
  f.tree = await r.settle()
  f.until = async (predicate, label = 'condition') => {
    for (const end = Date.now() + 20000; Date.now() < end;) { const tree = await r.settle(); if (predicate(tree)) return (f.tree = tree); await sleep(4) }
    throw new Error('timed out waiting for ' + label + '\n' + text(f.tree).slice(0, 800))
  }
  await f.until(tree => walk(tree).some(n => n.props.role === 'tab' && n.props['data-tab']), 'the figure page')
  f.openGen = async () => { button(f.tree, '生图').props.onClick(); return f.until(tree => walk(tree).some(n => cls(n, 'ap-gen-tab')), '生图 tab') }
  f.openEdit = async () => { button(f.tree, '编辑').props.onClick(); return f.until(tree => !walk(tree).some(n => cls(n, 'ap-gen-tab')) && walk(tree).some(n => n.props.className === 'ap-emotion-roster'), '编辑 tab') }
  f.view = async label => { walk(f.tree).find(n => n.type === 'button' && n.props.role === 'radio' && n.props['aria-pressed'] !== undefined && text(n) === label).props.onClick(); return (f.tree = await r.settle()) }
  f.type = async (label, value) => {
    const before = f.count('patchFigure'); byLabel(f.tree, label).props.onChange({target: {value}}); await r.settle(); byLabel(r.render(), label).props.onBlur()
    return f.until(() => f.count('patchFigure') > before && busy.count === 0, label + ' saved')
  }
  // The tile's menu: click the 差分 tile (unless its menu is open), then the item whose text starts with `item`.
  f.menu = async label => { if (!cellMenu(f.tree, label)) { menuOpen(face(f.tree, label)); f.tree = await r.settle() } return menuItems(cellMenu(f.tree, label)) }
  f.pick = async (label, item) => { const found = (await f.menu(label)).find(n => itemText(n).startsWith(item)); assert.ok(found, label + ' › ' + item + ' in ' + menuItems(cellMenu(f.tree, label)).map(itemText).join(' | ')); return found }
  f.dialog = () => f.until(tree => !!dialogOf(tree), 'the generation dialog')
  f.send = async () => { const body = walk(dialogOf(f.tree = r.render())).find(n => cls(n, 'ap-gd-body')); body.props.onKeyDown({key: 'Enter', ctrlKey: true, preventDefault() {}}); return f.until(tree => !dialogOf(tree), 'dialog sent and closed') }
  f.prompt = () => walk(dialogOf(f.tree = r.render())).find(n => n.type === 'textarea')
  f.waitState = (label, state) => f.until(tree => face(tree, label)?.props['data-gen'] === state, label + ' ' + state)
  f.kindMenu = async (view, item) => { byLabel(f.tree, view + ' 操作').props.onClick(); f.tree = await r.settle(); return walk(f.tree).find(n => n.type === 'button' && n.props.role === 'menuitem' && itemText(n).startsWith(item)) }
  return f
}
// Settei: 生图 › the empty 设定图 tile opens the dialog; the request runs in the tile; 采用 from the tile's menu.
async function adoptSettei(f) {
  await f.openGen(); if (!(await f.fresh()).figures[f.figureId].identityAppearance) await f.type('外貌', '银色长发，红色眼睛，娇小')
  tile(f.tree, 'settei').props.onClick(); await f.dialog()
  button(dialogOf(f.tree), '生成').props.onClick(); await f.until(tree => !dialogOf(tree), 'settei sent')
  await f.until(tree => tile(tree, 'settei')?.props['data-state'] === 'candidate', 'settei candidate in the tile')
  menuOpen(tile(f.tree, 'settei')); f.tree = await f.r.settle()
  menuItems(f.tree).find(n => itemText(n) === '采用').props.onClick()
  return f.until(tree => tile(tree, 'settei')?.props['data-state'] === 'filled' && !!f.calls.find(([m]) => m === 'acceptAssetCandidate'), 'settei adopted')
}

// private fork (cell menu input, owner 2026-10-17): one trigger for every cell menu (cellMenuTrigger). A mouse click does the
// primary thing (select the 差分 / view the 设定图) without the menu; right click, Shift+F10 and the context-menu key open it;
// a touch tap opens it as before. The input is the click's pointerType, never the width.
test('cell menus: mouse click selects, right click / Shift+F10 / touch tap open the menu', async t => {
  const f = await fixture(t), mouse = {nativeEvent: {pointerType: 'mouse'}}, touch = {nativeEvent: {pointerType: 'touch'}}
  assert.equal(face(f.tree, '喜悦').props['aria-keyshortcuts'], 'Shift+F10 ContextMenu')
  face(f.tree, '喜悦').props.onClick(mouse); f.tree = await f.r.settle()
  assert.equal(face(f.tree, '喜悦').props['aria-pressed'], true, 'a mouse click selects'); assert.ok(byLabel(f.tree, '喜悦设置'), 'and opens the detail')
  assert.ok(!cellMenu(f.tree, '喜悦'), 'without the menu'); assert.equal(face(f.tree, '喜悦').props['aria-expanded'], false)
  let prevented = false; face(f.tree, '哭泣').props.onContextMenu({preventDefault() { prevented = true }}); f.tree = await f.r.settle()
  assert.ok(prevented && cellMenu(f.tree, '哭泣'), 'right click opens the menu'); assert.equal(face(f.tree, '哭泣').props['aria-pressed'], true, 'and selects the tile')
  face(f.tree, '哭泣').props.onClick(mouse); f.tree = await f.r.settle(); assert.ok(!cellMenu(f.tree, '哭泣'), 'a click closes it')
  prevented = false; face(f.tree, '害羞').props.onKeyDown({key: 'F10', shiftKey: true, preventDefault() { prevented = true }}); f.tree = await f.r.settle()
  assert.ok(prevented && cellMenu(f.tree, '害羞'), 'Shift+F10 opens the menu')
  face(f.tree, '喜悦').props.onKeyDown({key: 'ContextMenu', preventDefault() {}}); f.tree = await f.r.settle(); assert.ok(cellMenu(f.tree, '喜悦'), 'the context-menu key opens it')
  face(f.tree, '平和').props.onClick(touch); f.tree = await f.r.settle(); assert.ok(cellMenu(f.tree, '平和'), 'a touch tap opens the menu')
  await adoptSettei(f)
  tile(f.tree, 'settei').props.onClick(mouse); await f.until(tree => !!sheetOf(tree), 'a mouse click views the 设定图')
  assert.ok(!walk(f.tree).some(n => cls(n, 'ap-cell-menu')), 'without its menu')
})

test('编辑 tiles carry their own menus; 生图 is 设定 (人物 · 服装) and this outfit\'s records; nothing is requested and nothing talks money', async t => {
  const f = await fixture(t); let tree = f.tree
  const tabs = walk(tree).filter(n => n.props.role === 'tab' && n.props['data-tab'])
  assert.deepEqual(tabs.map(n => text(n)), ['编辑', '生图']); assert.equal(tabs[0].props['aria-selected'], true)
  for (const word of ['外貌', '服装描述', '参考图']) assert.doesNotMatch(text(tree), new RegExp(word), word + ' stays in 生图')
  // Every declared 差分 has a tile; a tile is the trigger of its menu (U1), no ✦ / ⚠ buttons on it.
  assert.deepEqual(walk(tree).filter(n => n.type === 'button' && cls(n, 'ap-face')).map(n => n.props['aria-label']), moods.map(row => row.label))
  assert.equal(face(tree, '喜悦').props['aria-haspopup'], 'menu')
  assert.ok(!walk(tree).some(n => cls(n, 'ap-face-fallback') || cls(n, 'ap-face-gen')), 'no corner ⚠ toggle, no ✦ jump')
  // The empty tile's menu: 生成… / 上传图片… / 设置回退 ›; private fork (owner 2026-10-16 copy): the head is the name only.
  // private fork (avatar-actions, owner 2026-10): a tile acts on its own picture only — deleting the 差分 is the heading's ⋯.
  let items = await f.menu('喜悦')
  assert.deepEqual(items.map(itemText).map(s => s.split(' ')[0]), ['生成…', '上传图片…', '设置回退'])
  assert.equal(itemText(walk(cellMenu(f.tree, '喜悦')).find(n => cls(n, 'ap-cell-menu-head'))), '喜悦')
  assert.match(itemText(items.find(n => itemText(n).startsWith('设置回退'))), /无回退/)
  // The default 差分 cannot stand in for itself: no 设置回退 there.
  items = await f.menu('平和'); assert.ok(!items.some(n => itemText(n).startsWith('设置回退')))
  // The heading offers the batch (U2): every empty 差分 of the view.
  // private fork (owner 2026-10-16 copy): 「补齐空差分」 reads 「生成缺失立绘」 (no count) in the 立绘 view; it still fills only the empty 差分.
  assert.equal(itemText(walk(f.tree).find(n => cls(n, 'ap-gen-fill'))), '生成缺失立绘')
  assert.match(walk(f.tree).find(n => cls(n, 'ap-gen-fill')).props.title, /只给 9 个没有立绘的差分各画一张，已有的图不动/)
  tree = await f.openGen()
  assert.deepEqual(walk(tree).filter(n => n.props.role === 'group' && ['人物', '服装'].includes(n.props['aria-label'])).map(n => n.props['aria-label']), ['人物', '服装'])
  assert.match(byLabel(tree, '外貌').props.placeholder, /^例：/); assert.match(byLabel(tree, '服装描述').props.placeholder, /^例：/)
  assert.equal(tile(tree, 'settei').props['aria-label'], '生成「日常」的设定图')
  assert.match(text(walk(tree).find(n => n.props['aria-label'] === '生成')), /还没有生成过/)
  await f.type('外貌', '银色长发，红色眼睛'); await f.type('服装描述', '深蓝水手服，红色领结')
  const figure = (await f.fresh()).figures[f.figureId]
  assert.equal(figure.identityAppearance, '银色长发，红色眼睛'); assert.equal(figure.outfits[0].outfitAppearance, '深蓝水手服，红色领结')
  assert.equal(f.count('prepareAssetGeneration') + f.count('generateAssetCandidate'), 0, 'nothing was requested')
  assert.doesNotMatch(text(f.tree), MONEY)
})

test('without any 设定 the tile menu says so first and offers the ways to make one; 生成… waits for it', async t => {
  const f = await fixture(t, {board: false})
  const items = await f.menu('喜悦'), labels = items.map(itemText)
  assert.match(text(walk(cellMenu(f.tree, '喜悦')).find(n => cls(n, 'ap-cell-menu-warn'))), /还没有设定/)
  assert.deepEqual(labels.slice(0, 3), ['上传设定图…', '生成设定图…', '去写设定文字'])
  const gen = items.find(n => itemText(n).startsWith('生成…')); assert.equal(gen.props.disabled, true); assert.match(itemText(gen), /先写外貌或服装描述/)
  // 「生成缺失立绘」 is shown but waits too; a click says why (touch has no tooltips) and sends nothing.
  const fill = walk(f.tree).find(n => cls(n, 'ap-gen-fill')); assert.equal(fill.props['aria-disabled'], true)
  fill.props.onClick(); f.tree = await f.r.settle(); assert.match(text(walk(f.tree).find(n => cls(n, 'ap-gen-gate'))), /还没有设定/)
  assert.equal(f.count('prepareAssetGeneration'), 0)
  // 去写设定文字 goes to 生图; with 外貌 written the menu's 生成… opens.
  ;(await f.pick('喜悦', '去写设定文字')).props.onClick(); await f.until(tree => walk(tree).some(n => cls(n, 'ap-gen-tab')), '生图')
  await f.type('外貌', '银色长发'); await f.openEdit()
  assert.ok(!(await f.pick('喜悦', '生成…')).props.disabled)
  // The dialog draws from the 设定文字 card when there is no 设定图.
  ;(await f.pick('平和', '生成…')).props.onClick(); const tree = await f.dialog()
  assert.match(text(walk(dialogOf(tree)).find(n => cls(n, 'ap-gd-text-card'))), /外貌.*银色长发/)
})

test('生成… opens the dialog: the prompt is pre-filled, 存为默认 keeps it for this cell, the request runs in the tile, 采用 fills that slot and records it', async t => {
  const f = await fixture(t)
  ;(await f.pick('喜悦', '生成…')).props.onClick(); let tree = await f.dialog(), dialog = dialogOf(tree)
  assert.match(text(walk(dialog).find(n => n.type === 'h2')), /^生成「喜悦」立绘/)
  assert.equal(f.prompt().props.value, '喜悦的表情。', 'pre-filled from the 差分 name and 使用情景')
  // References: the 设定 by default (each can be switched off), the dashed ＋; never 平和.
  const refs = walk(dialog).filter(n => n.type === 'button' && n.props['aria-pressed'] !== undefined && n.props['aria-label']?.startsWith('照着画：')).map(n => n.props['aria-label'])
  assert.deepEqual(refs, ['照着画：人物设定图']); assert.ok(byLabel(dialog, '添加参考图'))
  assert.doesNotMatch(text(dialog), /平和立绘|首个差分立绘/); assert.doesNotMatch(text(dialog), MONEY)
  // The fixed requirements are one line; 查看全文 builds the exact prompt without a request.
  button(dialog, '查看全文').props.onClick(); tree = await f.until(t2 => walk(dialogOf(t2)).some(n => n.type === 'pre'), 'the full prompt')
  assert.equal(f.last('prepareAssetGeneration').preview, true); assert.equal(f.count('generateAssetCandidate'), 0)
  f.prompt().props.onChange({target: {value: '双手比耶，眨一只眼'}}); tree = await f.r.settle()
  assert.match(text(dialogOf(tree)), /已改 · 只用于这一次/)
  walk(dialogOf(tree)).find(n => n.props.role === 'checkbox' && /存为默认/.test(text(n))).props.onClick(); tree = await f.r.settle()
  assert.match(text(dialogOf(tree)), /已改 · 存为这一格的默认/)
  await f.send()
  const prepared = f.last('prepareAssetGeneration')
  assert.deepEqual(prepared.target, {packId: f.packId, figureId: f.figureId, outfitKey: 'daily', kind: 'sprite', emotionId: 'joy'})
  assert.equal(prepared.userPrompt, '双手比耶，眨一只眼'); assert.equal(prepared.omit, undefined); assert.equal(prepared.references, undefined)
  assert.deepEqual((await f.outfit()).genPrompts, {sprite: {joy: '双手比耶，眨一只眼'}}, '存为默认: this figure × outfit × 差分 only')
  // The request runs in the tile: a ring (or 排队), then the candidate with 待采用; nothing is written before 采用.
  tree = await f.waitState('喜悦', 'candidate')
  assert.match(text(face(tree, '喜悦')), /待采用/)
  assert.equal((await f.fresh()).sprites[(await f.outfit()).sprite?.manifestKey]?.emotions?.joy, undefined)
  // The detail under the grid says it too, with its actions (R9).
  assert.ok(walk(tree).find(n => cls(n, 'ap-gen-status') && n.props['data-state'] === 'candidate'))
  // 采用 from the tile's menu: exactly that slot, aligned import, then the outfit's record.
  const candidateItems = await f.menu('喜悦'); assert.deepEqual(candidateItems.map(itemText), ['采用', '不要', '重画…', '改图…', '查看大图'])
  candidateItems[0].props.onClick()
  tree = await f.until(t2 => !face(t2, '喜悦').props['data-gen'] && f.count('acceptAssetCandidate') === 1, 'adopted')
  const pack = await f.fresh(), outfit = pack.figures[f.figureId].outfits[0], manifest = pack.sprites[outfit.sprite.manifestKey]
  assert.deepEqual(Object.keys(manifest.emotions), ['joy'], 'only 喜悦 filled')
  assert.equal(f.last('acceptAssetCandidate').importedHash, outfit.sprite.assets[manifest.emotions.joy.stage.src])
  assert.equal(outfit.genRecords.length, 1); assert.equal(outfit.genRecords[0].kind, 'sprite'); assert.equal(outfit.genRecords[0].emotionId, 'joy'); assert.equal(outfit.genRecords[0].prompt, '双手比耶，眨一只眼')
  // 生图 › 生成: the record, with this outfit's name of the 差分 and view.
  tree = await f.openGen()
  const rows = walk(walk(tree).find(n => n.props['aria-label'] === '生成记录')).filter(n => n.type === 'li')
  assert.equal(rows.length, 1); assert.match(text(rows[0]), /喜悦 · 立绘/); assert.match(text(rows[0]), /已采用/)
  // 重画… on the adopted picture: the saved default comes back; a quick note appends; 「现在这张」 adds the picture as a reference.
  tree = await f.openEdit(); (await f.pick('喜悦', '重画…')).props.onClick(); tree = await f.dialog()
  assert.equal(f.prompt().props.value, '双手比耶，眨一只眼')
  button(dialogOf(tree), '再夸张一点').props.onClick(); tree = await f.r.settle()
  assert.equal(f.prompt().props.value, '双手比耶，眨一只眼，再夸张一点。')
  walk(dialogOf(f.tree)).find(n => n.props['aria-label'] === '照着画：现在这张').props.onClick(); tree = await f.r.settle()
  await f.send()
  const redraw = f.last('prepareAssetGeneration'), own = outfit.sprite.assets[manifest.emotions.joy.stage.src]
  assert.equal(redraw.userPrompt, '双手比耶，眨一只眼，再夸张一点。'); assert.equal(redraw.references.length, 1); assert.equal(redraw.references[0].hash, own); assert.match(redraw.references[0].role, /Current picture/)
  // The adopted picture stays until the new one is adopted.
  await f.waitState('喜悦', 'candidate'); assert.equal((await f.fresh()).sprites[outfit.sprite.manifestKey].emotions.joy.stage.src, manifest.emotions.joy.stage.src)
  assert.doesNotMatch(text(f.tree), MONEY)
})

test('改图… needs the change written and sends the picture as the base to edit; a reference can be switched off (omit)', async t => {
  const f = await fixture(t)
  ;(await f.pick('平和', '生成…')).props.onClick(); let tree = await f.dialog()
  walk(dialogOf(tree)).find(n => n.props['aria-label'] === '照着画：人物设定图').props.onClick(); tree = await f.r.settle()
  assert.equal(walk(dialogOf(tree)).find(n => n.props['aria-label'] === '照着画：人物设定图').props['aria-pressed'], false)
  await f.send(); assert.deepEqual([...f.last('prepareAssetGeneration').omit], ['identity'])
  await f.waitState('平和', 'candidate')
  ;(await f.pick('平和', '改图…')).props.onClick(); tree = await f.dialog()
  assert.match(text(walk(dialogOf(tree)).find(n => n.type === 'h2')), /^改图「平和」立绘/)
  assert.equal(f.prompt().props.value, ''); assert.equal(button(dialogOf(tree), '改图').props.disabled, true)
  f.prompt().props.onChange({target: {value: '领巾换成红色'}}); tree = await f.r.settle()
  await f.send()
  const edit = f.last('prepareAssetGeneration'); assert.equal(edit.userPrompt, '领巾换成红色')
  assert.equal(edit.references.length, 1); assert.match(edit.references[0].role, /Base image to edit/); assert.ok(edit.references[0].base64, 'the waiting candidate is the base')
})

test('「生成缺失立绘」 sends one request per empty 差分 at once with its default prompt — no dialog; 全部采用 adopts them; stand-ins are not empty', async t => {
  const f = await fixture(t, {figure: {outfits: [{key: 'daily', label: '日常', enabled: true, defaultEmotion: 'calm', fallbackEmotions: ['anxious', 'shy', 'disgust', 'love', 'crying'], fallbackTo: {crying: 'joy'},
    genPrompts: {sprite: {anger: '叉腰怒视'}}}]}})
  let pack
  let tree = await f.until(tree => /只给 4 个没有立绘的差分/.test(walk(tree).find(n => cls(n, 'ap-gen-fill'))?.props.title || ''), 'the batch count')
  // Stand-in tiles show the picture they use (none yet) and name it.
  assert.equal(face(tree, '哭泣').props['data-fallback'], true); assert.match(text(walk(face(tree, '哭泣')).find(n => cls(n, 'ap-face-use'))), /喜悦/)
  assert.match(text(walk(face(tree, '害羞')).find(n => cls(n, 'ap-face-use'))), /平和/, 'no choice = the default 差分')
  walk(tree).find(n => cls(n, 'ap-gen-fill')).props.onClick()
  tree = await f.until(() => f.count('generateAssetCandidate') === 4, 'four requests')
  assert.ok(!dialogOf(tree), 'no dialog')
  const prompts = Object.fromEntries(f.all('prepareAssetGeneration').map(p => [p.target.emotionId, p.userPrompt]))
  assert.deepEqual(prompts, {joy: '喜悦的表情。', anger: '叉腰怒视', sad: '悲伤的表情。', calm: '平和的表情。'})
  tree = await f.until(t2 => /4 张待采用/.test(text(walk(t2).find(n => cls(n, 'ap-gen-waiting')) || {children: []})), 'four waiting')
  button(walk(tree).find(n => cls(n, 'ap-gen-waiting')), '全部采用').props.onClick()
  tree = await f.until(t2 => f.count('acceptAssetCandidate') === 4 && !walk(t2).some(n => cls(n, 'ap-gen-waiting')), 'all adopted')
  for (let i = 0; i < 2000 && (await f.outfit()).genRecords?.length !== 4; i++) await sleep(5)
  pack = await f.fresh(); const outfit = pack.figures[f.figureId].outfits[0]
  assert.deepEqual(Object.keys(pack.sprites[outfit.sprite.manifestKey].emotions).sort(), ['anger', 'calm', 'joy', 'sad'])
  assert.equal(outfit.genRecords.length, 4)
  tree = await f.until(t2 => !walk(t2).some(n => cls(n, 'ap-gen-fill')), 'nothing empty left')
  assert.equal(f.requests.length, 4, 'one request per 差分')
})

// private fork (owner 2026-10-16 copy): 缺图时用 reads 设置回退 / 无回退 / 回退为「X」 everywhere; the submenu has no footnote.
test('设置回退 (U3): the tile menu and the detail field name the stand-in through setFigureEmotionFallback; the tile shows it', async t => {
  const f = await fixture(t)
  ;(await f.pick('哭泣', '设置回退')).props.onClick(); let tree = f.tree = await f.r.settle()
  assert.match(text(cellMenu(tree, '哭泣')), /「哭泣」设置回退/)
  assert.doesNotMatch(text(cellMenu(tree, '哭泣')), /以图为准/)
  const choices = menuItems(cellMenu(tree, '哭泣')).filter(n => n.props.role === 'menuitemradio')
  assert.deepEqual(choices.map(itemText), ['无回退', '回退为「平和」', '回退为「喜悦」', '回退为「愤怒」', '回退为「悲伤」', '回退为「紧张」', '回退为「害羞」', '回退为「嫌弃」', '回退为「爱恋」'])
  assert.equal(choices[0].props['aria-checked'], true)
  choices.find(n => itemText(n) === '回退为「喜悦」').props.onClick()
  tree = await f.until(t2 => face(t2, '哭泣')?.props['data-fallback'] === true, 'stand-in shown')
  const call = f.last('setFigureEmotionFallback'); assert.equal(call.emotionId, 'crying'); assert.equal(call.enabled, true); assert.equal(call.use, 'joy')
  let outfit = await f.outfit(); assert.deepEqual(outfit.fallbackEmotions, ['crying']); assert.deepEqual(outfit.fallbackTo, {crying: 'joy'})
  assert.match(text(walk(face(tree, '哭泣')).find(n => cls(n, 'ap-face-use'))), /喜悦/)
  assert.match(face(tree, '哭泣').props.title, /回退为「喜悦」/)
  // The detail field 回退 (the tile is selected): 回退为「喜悦」; the default 差分 clears fallbackTo, 无回退 clears the mark.
  const field = byLabel(tree, '哭泣回退：回退为「喜悦」'); assert.ok(field, 'the 回退 field')
  field.props.onClick(); tree = await f.r.settle()
  walk(tree).find(n => n.props.role === 'menuitemradio' && cls(n, 'fork-inline-option') && text(n).includes('回退为「平和」')).props.onClick()
  tree = await f.until(t2 => !!byLabel(t2, '哭泣回退：回退为「平和」'), 'default stand-in')
  outfit = await f.outfit(); assert.deepEqual(outfit.fallbackEmotions, ['crying']); assert.equal(outfit.fallbackTo, undefined)
  assert.equal(f.last('setFigureEmotionFallback').use, undefined)
  byLabel(tree, '哭泣回退：回退为「平和」').props.onClick(); tree = await f.r.settle()
  walk(tree).find(n => n.props.role === 'menuitemradio' && cls(n, 'fork-inline-option') && text(n).includes('无回退')).props.onClick()
  tree = await f.until(t2 => face(t2, '哭泣')?.props['data-missing'] === true, 'missing again')
  outfit = await f.outfit(); assert.equal(outfit.fallbackEmotions, undefined)
  assert.equal(f.last('setFigureEmotionFallback').enabled, false)
})

test('删除这张立绘… (U1) removes only that picture behind a confirm; the 差分 stays as an empty tile', async t => {
  const f = await fixture(t)
  ;(await f.pick('喜悦', '生成…')).props.onClick(); await f.dialog(); await f.send(); await f.waitState('喜悦', 'candidate')
  ;(await f.pick('喜悦', '采用')).props.onClick(); await f.until(t2 => !face(t2, '喜悦').props['data-gen'] && f.count('acceptAssetCandidate') === 1, 'adopted')
  ;(await f.pick('平和', '生成…')).props.onClick(); await f.dialog(); await f.send(); await f.waitState('平和', 'candidate')
  ;(await f.pick('平和', '采用')).props.onClick(); await f.until(t2 => !face(t2, '平和').props['data-gen'] && f.count('acceptAssetCandidate') === 2, 'adopted')
  const items = await f.menu('喜悦'); assert.deepEqual(items.map(itemText), ['重画…', '改图…', '替换为本地图片…', '重新裁切…', '删除这张立绘…']) // private fork (avatar-actions): 裁切 moved here from the preview card
  items.at(-1).props.onClick(); let tree = await f.until(t2 => !!confirmOf(t2), 'the confirm')
  assert.match(text(confirmOf(tree)), /删除「喜悦」的立绘？/); assert.match(text(confirmOf(tree)), /差分「喜悦」和它的头像、模型都保留/)
  button(confirmOf(tree), '取消').props.onClick(); tree = await f.until(t2 => !confirmOf(t2)); assert.ok((await f.fresh()).sprites[(await f.outfit()).sprite.manifestKey].emotions.joy)
  ;(await f.pick('喜悦', '删除这张立绘…')).props.onClick(); tree = await f.until(t2 => !!confirmOf(t2))
  button(confirmOf(tree), '删除').props.onClick()
  tree = await f.until(t2 => !confirmOf(t2) && face(t2, '喜悦')?.props['data-missing'] === true, 'removed')
  const pack = await f.fresh(), outfit = pack.figures[f.figureId].outfits[0], manifest = pack.sprites[outfit.sprite.manifestKey]
  assert.deepEqual(Object.keys(manifest.emotions), ['calm'], '平和 untouched'); assert.ok(pack.figures[f.figureId].emotions.some(e => e.id === 'joy'), 'the 差分 stays')
  assert.equal(Object.values(outfit.sprite.assets).length, 1, 'the unused picture left the sprite')
})

test('settei → adopt → avatar sheet → eight slices imported by receipt → adopt; crying stays a single avatar', async t => {
  const f = await fixture(t); let tree = await adoptSettei(f)
  const settei = (await f.outfit()).settei
  assert.match(settei, /^[0-9a-f]{64}$/); assert.equal(f.requests.length, 1)
  assert.equal(f.requests[0].tools[0].size, '1536x1024'); assert.match(JSON.stringify(f.requests[0]), /银色长发/)
  assert.equal((await f.outfit()).genRecords[0].kind, 'settei', 'the 设定图 is recorded too')
  tree = await f.openEdit(); tree = await f.view('头像')
  // private fork (owner 2026-10-16): the 头像 heading's 「✦ 生成缺失头像」 (not in the ⋯). All eight base faces are missing, so it
  // sends the eight-face sheet for exactly those 差分 at once (no naming step); crying is left for later.
  assert.equal(await f.kindMenu('头像', '一次生成八个表情'), undefined); byLabel(f.tree, '头像 操作').props.onClick(); tree = f.tree = await f.r.settle()
  const sheetButton = walk(tree).find(n => cls(n, 'ap-gen-avatars')); assert.equal(itemText(sheetButton), '生成缺失头像'); assert.equal(sheetButton.props['aria-disabled'], undefined)
  assert.equal(sheetButton.props.title, '八个基础表情都还没有头像：一次画出这八个，已有的头像不动；另有 1 个之后再补')
  sheetButton.props.onClick(); tree = await f.until(t2 => !!button(t2, '采用全部'), 'the sheet candidate')
  assert.doesNotMatch(text(tree), /确认差分名称/)
  const sheet = sheetOf(tree); assert.match(text(sheet), /八个表情头像/)
  assert.deepEqual(walk(sheet).filter(n => n.type === 'figcaption').map(n => text(n)), ['喜悦', '愤怒', '悲伤', '紧张', '平和', '害羞', '嫌弃', '爱恋'])
  const chips = walk(sheet).filter(n => n.props.className === 'ap-gen-warn').map(n => text(n))
  assert.ok(chips.some(c => /^分辨率偏低：喜悦、/.test(c)), chips.join(' | ')); assert.doesNotMatch(chips.join(' '), /[0-9a-f]{8}-|LOW_RESOLUTION|joy/)
  assert.equal(walk(tree).find(n => n.props.role === 'tab' && n.props['data-tab'] === 'edit').props.title, '有新图等你选')
  const job = (await f.generation.list({packId: f.packId})).find(j => j.target.kind === 'avatar-sheet'), sheetIds = job.target.emotionIds
  assert.deepEqual(sheetIds, SHEET, 'the declared base faces, by key')
  button(tree, '采用全部').props.onClick()
  tree = await f.until(t2 => !sheetOf(t2) && f.count('acceptAssetCandidate') === 2, 'sheet adopted')
  const outfit = await f.outfit(), accept = f.last('acceptAssetCandidate')
  for (const id of sheetIds) assert.equal(outfit.avatars[id], job.candidate.slices[id].hash, id + ' imported byte for byte')
  assert.equal(outfit.avatars.crying, undefined); assert.deepEqual(Object.keys(accept.importedHashes).sort(), [...sheetIds].sort())
  assert.equal((await f.generation.get({jobId: job.jobId})).status, 'accepted'); assert.equal(f.requests.length, 2, 'one request per click')
  // Only 哭泣 is missing now and it has no 立绘 yet: the button stays, waits, and says why (never a crop of the 立绘).
  const left = await f.until(t2 => /生成缺失头像/.test(text(walk(t2).find(n => cls(n, 'ap-gen-avatars')) || {children: []})) && !sheetOf(t2), 'the rest')
  const waits = walk(left).find(n => cls(n, 'ap-gen-avatars')); assert.equal(waits.props['aria-disabled'], true); assert.match(waits.props.title, /还没有立绘/)
  waits.props.onClick(); f.tree = await f.r.settle(); assert.match(text(walk(f.tree).find(n => cls(n, 'ap-gen-gate'))), /先有立绘，才能生成头像/)
  assert.equal(f.requests.length, 2, 'nothing sent')
})

// private fork (owner 2026-10-16 「生成缺失头像」): some avatars exist → one single-avatar request per missing 差分 that has its
// own 立绘, batched like 立绘; an existing avatar is never replaced; nothing missing → no button.
test('「生成缺失头像」 with some avatars present draws only the missing ones, one by one, and never replaces one', async t => {
  const f = await fixture(t, {figure: {outfits: [{key: 'daily', label: '日常', enabled: true, defaultEmotion: 'calm', fallbackEmotions: ['anxious', 'shy', 'disgust', 'love', 'crying']}]}})
  let tree = await f.until(t2 => !!walk(t2).find(n => cls(n, 'ap-gen-fill')), 'the sprite batch')
  walk(tree).find(n => cls(n, 'ap-gen-fill')).props.onClick()
  tree = await f.until(t2 => /4 张待采用/.test(text(walk(t2).find(n => cls(n, 'ap-gen-waiting')) || {children: []})), 'four sprites waiting')
  button(walk(tree).find(n => cls(n, 'ap-gen-waiting')), '全部采用').props.onClick()
  await f.until(t2 => f.count('acceptAssetCandidate') === 4 && !walk(t2).some(n => cls(n, 'ap-gen-fill')), 'sprites adopted')
  await f.view('头像')
  ;(await f.pick('喜悦', '生成…')).props.onClick(); await f.dialog(); await f.send(); await f.waitState('喜悦', 'candidate')
  ;(await f.pick('喜悦', '采用')).props.onClick(); await f.until(() => f.count('acceptAssetCandidate') === 5, 'joy avatar adopted')
  const joy = (await f.outfit()).avatars.joy; assert.match(joy, /^[0-9a-f]{64}$/)
  tree = await f.until(t2 => /只给 3 个没有头像的差分/.test(walk(t2).find(n => cls(n, 'ap-gen-avatars'))?.props.title || ''), 'three missing')
  const fill = walk(tree).find(n => cls(n, 'ap-gen-avatars')); assert.equal(itemText(fill), '生成缺失头像')
  assert.equal(fill.props.title, '只给 3 个没有头像的差分各画一张，已有的头像不动')
  const before = f.requests.length; fill.props.onClick()
  tree = await f.until(t2 => /3 张待采用/.test(text(walk(t2).find(n => cls(n, 'ap-gen-waiting')) || {children: []})), 'three avatars waiting')
  assert.ok(!dialogOf(tree) && !sheetOf(tree), 'no dialog, no sheet')
  const sent = f.all('prepareAssetGeneration').slice(-3).map(p => p.target)
  assert.deepEqual(sent.map(t2 => t2.kind), ['avatar', 'avatar', 'avatar']); assert.deepEqual(sent.map(t2 => t2.emotionId).sort(), ['anger', 'calm', 'sad'])
  assert.equal(f.requests.length - before, 3); assert.ok(f.requests.slice(before).every(r => r.tools[0].size === '1024x1024'), 'single avatars')
  button(walk(tree).find(n => cls(n, 'ap-gen-waiting')), '全部采用').props.onClick()
  tree = await f.until(t2 => f.count('acceptAssetCandidate') === 8 && !walk(t2).some(n => cls(n, 'ap-gen-waiting')), 'avatars adopted')
  const outfit = await f.outfit(); assert.equal(outfit.avatars.joy, joy, 'the existing avatar stays')
  assert.deepEqual(Object.keys(outfit.avatars).sort(), ['anger', 'calm', 'joy', 'sad'])
  await f.until(t2 => !walk(t2).some(n => cls(n, 'ap-gen-fill')), 'nothing missing: no button')
})

test('a failed sheet import resumes from the first slot without a receipt (no slot imported twice)', async t => {
  const f = await fixture(t); let tree = await adoptSettei(f)
  await f.openEdit(); tree = await f.view('头像'); walk(tree).find(n => cls(n, 'ap-gen-avatars')).props.onClick()
  tree = await f.until(t2 => !!button(t2, '采用全部'), 'the sheet candidate')
  const slices = (await f.generation.list({packId: f.packId})).find(j => j.target.kind === 'avatar-sheet').candidate.slices
  assert.equal(new Set(SHEET.map(id => slices[id].hash)).size, 8)
  f.failures.push({method: 'patchPack', when: input => { const bytes = input.fileUpdates?.get('figures/' + f.figureId + '.json'); return bytes && !!JSON.parse(new TextDecoder().decode(bytes)).outfits[0].avatars?.anxious }})
  button(tree, '采用全部').props.onClick(); tree = await f.until(t2 => /写入失败/.test(text(sheetOf(t2) || {children: []})), 'the error')
  const written = id => f.calls.filter(([m, a]) => m === 'patchPack' && a.fileUpdates?.has('media/' + slices[id].hash + '.png')).length
  assert.deepEqual(SHEET.map(written), [1, 1, 1, 1, 0, 0, 0, 0]); assert.equal(f.count('acceptAssetCandidate'), 1, 'the sheet was not finalised')
  button(tree, '采用全部').props.onClick(); tree = await f.until(t2 => !sheetOf(t2), 'resumed adoption')
  assert.deepEqual(SHEET.map(written), [1, 1, 1, 2, 1, 1, 1, 1]); assert.equal(f.count('acceptAssetCandidate'), 2)
  assert.equal(f.requests.length, 2, 'retrying the import never asks for another image')
})

test('a request without an answer asks before the next one (no money talk); cancelling sends nothing', async t => {
  const f = await fixture(t); await f.openGen(); await f.type('外貌', '银色长发')
  f.setMode('500'); tile(f.tree, 'settei').props.onClick(); await f.dialog(); button(dialogOf(f.tree), '生成').props.onClick()
  let tree = await f.until(t2 => tile(t2, 'settei')?.props['data-state'] === 'failed', 'failure in the tile')
  assert.equal(f.requests.length, 1)
  menuOpen(tile(tree, 'settei')); tree = await f.r.settle()
  assert.match(text(walk(tree).find(n => cls(n, 'ap-cell-menu-warn'))), /没有拿到结果，不会自动重试/)
  f.setMode('ok'); menuItems(tree).find(n => itemText(n) === '重试').props.onClick()
  tree = await f.until(t2 => !!confirmOf(t2), 'the confirmation gate')
  assert.match(text(confirmOf(tree)), /上一次请求没有返回结果，不会自动重试。仍要再生成一张吗？/); assert.doesNotMatch(text(tree), MONEY)
  assert.equal(f.count('generateAssetCandidate'), 1, 'the gate stands before generate')
  button(confirmOf(tree), '取消').props.onClick(); tree = await f.until(t2 => !confirmOf(t2), 'gate closed')
  await sleep(20); tree = await f.r.settle(); assert.equal(f.count('generateAssetCandidate'), 1); assert.equal(f.requests.length, 1)
  menuOpen(tile(tree, 'settei')); tree = await f.r.settle(); menuItems(tree).find(n => itemText(n) === '重试').props.onClick()
  tree = await f.until(t2 => !!confirmOf(t2), 'the gate again'); button(confirmOf(tree), '仍要生成').props.onClick()
  tree = await f.until(t2 => tile(t2, 'settei')?.props['data-state'] === 'candidate', 'candidate')
  assert.equal(f.last('generateAssetCandidate').confirmNewRequestIds.length, 1); assert.equal(f.requests.length, 2)
})

test('an unsupported channel shows one ⚠ with the way to settings and sends nothing', async t => {
  const f = await fixture(t); await f.openGen(); await f.type('外貌', '银色长发')
  await f.configure(undefined, 'gemini')
  tile(f.tree, 'settei').props.onClick(); await f.dialog(); button(dialogOf(f.tree), '生成').props.onClick()
  let tree = await f.until(t2 => /当前生图渠道不能生成素材/.test(text(t2)), 'channel warning')
  assert.equal((text(tree).match(/当前生图渠道不能生成素材 · 设置 → 场景生图 → 接口格式选 Responses image tool/g) || []).length, 1, 'said once (in the open dialog)')
  assert.ok(dialogOf(tree), 'the dialog stays open'); assert.equal(f.requests.length, 0); assert.equal(f.count('generateAssetCandidate'), 0)
  byLabel(dialogOf(tree), '关闭').props.onClick(); tree = await f.until(t2 => !dialogOf(t2))
  assert.equal((text(tree).match(/当前生图渠道不能生成素材/g) || []).length, 1); assert.equal(tile(tree, 'settei').props['data-state'], 'empty')
})

test('a failed redraw leaves the waiting picture selectable and adoptable', async t => {
  const f = await fixture(t); await f.openGen(); await f.type('外貌', '银色长发')
  tile(f.tree, 'settei').props.onClick(); await f.dialog(); button(dialogOf(f.tree), '生成').props.onClick()
  let tree = await f.until(t2 => tile(t2, 'settei')?.props['data-state'] === 'candidate', 'candidate')
  const original = (await f.generation.list({packId: f.packId}))[0]
  f.setMode('500'); menuOpen(tile(tree, 'settei')); tree = await f.r.settle(); menuItems(tree).find(n => itemText(n) === '重画…').props.onClick()
  tree = await f.dialog(); f.prompt().props.onChange({target: {value: '更暖的色调'}}); tree = await f.r.settle()
  button(dialogOf(tree), '重画').props.onClick(); await f.until(() => f.requests.length === 2, 'redraw sent')
  for (let i = 0; i < 2000 && !(await f.generation.list({packId: f.packId})).some(j => j.status === 'failed'); i++) await sleep(5)
  tree = await f.until(t2 => !dialogOf(t2) && tile(t2, 'settei')?.props['data-state'] === 'candidate', 'the waiting picture shown after the failure')
  assert.equal((await f.generation.get({jobId: original.jobId})).status, 'candidate'); assert.equal(f.count('rejectAssetCandidate'), 0)
  menuOpen(tile(f.tree, 'settei')); tree = await f.r.settle(); menuItems(tree).find(n => itemText(n) === '采用').props.onClick()
  await f.until(t2 => tile(t2, 'settei')?.props['data-state'] === 'filled', 'original adopted, the failed redraw cleared')
  assert.equal((await f.generation.get({jobId: original.jobId})).status, 'accepted')
})

test('生成背景 creates the entry in the pack that opened it, generates from the description and adopts 16:9', async t => {
  const f = await fixture(t)
  f.setImage(images.background)
  walk(f.tree).find(n => n.props['aria-label'] === '添加文件' && n.type === 'button').props.onClick()
  let tree = await f.r.settle(); button(tree, '生成背景').props.onClick(); tree = await f.until(t2 => !!sheetOf(t2), 'background sheet')
  assert.match(text(sheetOf(tree)), /新背景/); assert.equal(button(tree, '生成').props.disabled, true)
  walk(sheetOf(tree)).find(n => n.type === 'textarea').props.onChange({target: {value: '黄昏的教室，窗外有樱花'}}); tree = await f.r.settle()
  button(tree, '生成').props.onClick(); tree = await f.until(t2 => !!button(t2, '采用'), 'candidate')
  assert.equal((await f.fresh()).manifest.assets.filter(a => a.kind === 'backgrounds').length, 0)
  const prepared = f.last('prepareAssetGeneration'); assert.deepEqual(prepared.target, {packId: f.packId, kind: 'background'}); assert.equal(prepared.userPrompt, '黄昏的教室，窗外有樱花')
  assert.doesNotMatch(text(tree), MONEY)
  button(tree, '采用').props.onClick(); tree = await f.until(t2 => !sheetOf(t2), 'adopted')
  const adopted = (await f.fresh()).manifest.assets.find(a => a.kind === 'backgrounds')
  assert.equal(adopted.name, '黄昏的教室'); assert.match(adopted.media, /^[0-9a-f]{64}$/); assert.equal(adopted.pendingMedia, false)
  assert.equal(f.requests.length, 1)
})

test('rejecting a new background leaves no placeholder entries', async t => {
  const f = await fixture(t)
  walk(f.tree).find(n => n.props['aria-label'] === '添加文件' && n.type === 'button').props.onClick()
  let tree = await f.r.settle(); button(tree, '生成背景').props.onClick(); tree = await f.r.settle()
  walk(sheetOf(tree)).find(n => n.type === 'textarea').props.onChange({target: {value: 'Empty room'}})
  tree = await f.r.settle(); button(tree, '生成').props.onClick(); tree = await f.until(t2 => !!button(t2, '不要'), 'candidate')
  assert.equal((await f.fresh()).manifest.assets.length, 0)
  button(tree, '不要').props.onClick(); await f.until(t2 => !sheetOf(t2), 'discarded')
  assert.equal((await f.fresh()).manifest.assets.length, 0); assert.equal(f.count('patchPack'), 0)
})

test('the 生图 outfit menu scales to a dozen outfits, searches, and shares the selection with 编辑', async t => {
  const outfits = Array.from({length: 12}, (_, i) => ({key: 'o' + i, label: i === 7 ? '月夜兔耳演出服' : '服装' + (i + 1), enabled: true}))
  const f = await fixture(t, {figure: {outfits}}); let tree = await f.openGen()
  const trigger = byLabel(tree, '服装：服装1'); assert.equal(trigger.props['aria-haspopup'], 'menu')
  trigger.props.onClick(); tree = await f.r.settle()
  const items = () => walk(f.tree).filter(n => n.props.role === 'menuitemradio' && cls(n, 'ap-gen-outfit-item'))
  f.tree = tree; assert.equal(items().length, 12); assert.equal(items()[0].props['aria-checked'], true)
  byLabel(tree, '搜索服装').props.onChange({target: {value: '兔耳'}}); f.tree = await f.r.settle()
  assert.deepEqual(items().map(n => text(n)), ['月夜兔耳演出服'])
  items()[0].props.onClick(); tree = await f.until(t2 => !!byLabel(t2, '服装：月夜兔耳演出服'), 'picked')
  await f.type('服装描述', '白色兔耳头饰'); assert.equal((await f.fresh()).figures[f.figureId].outfits[7].outfitAppearance, '白色兔耳头饰')
  tree = await f.openEdit()
  assert.equal(walk(tree).find(n => n.props.role === 'radio' && n.props['aria-checked'] === true && /ap-outfit-face/.test(n.props.className || '')).props.title.split(' · ')[0], '月夜兔耳演出服')
  assert.equal(f.count('prepareAssetGeneration'), 0)
})

// private fork (identity settei ui, owner 2026-10): 人物设定图 in 「生图」's 人物 column — the board and (large view) its
// version; the CLI's palette is data only (settei ui, owner 2026-10: not shown, no replace confirm for it); 上传替换 is the
// full resource write; 删除… is the same write without the field, behind the confirm.
test('人物设定图: shown with its version (no palette), replaced by a full write, removed behind the confirm, uploaded from empty', async t => {
  const f = await fixture(t), sha = v => createHash('sha256').update(v).digest('hex')
  const palette = [{role: '发色', hex: '#c0c0c8', zone: '头发'}, {role: '瞳色', hex: '#b02030', zone: '虹膜'}]
  const pack = await f.fresh(); const first = pack.figures[f.figureId].identitySettei
  await f.library.patchFigure({packId: f.packId, expectedRevision: pack.revision, figureId: f.figureId, patch: {identitySettei: {...first, palette, version: 'palette-v2'}}})
  await f.openGen(); let tree = await f.until(t2 => !!byLabel(t2, '查看人物设定图'), 'the board')
  assert.ok(byLabel(tree, '人物设定图 说明'))
  assert.doesNotMatch(text(tree), /色板|#C0C0C8/i)
  assert.ok(!walk(tree).some(n => /ap-gen-col-head/.test(n.props.className || '') && walk(n).some(c => c.type === 'small')), 'no grey note in a column heading')
  byLabel(tree, '查看人物设定图').props.onClick(); tree = await f.until(t2 => walk(t2).some(n => /ap-identity-sheet/.test(n.props.className || '')), 'the large view')
  const sheet = () => walk(f.tree).find(n => /ap-identity-sheet/.test(n.props.className || ''))
  assert.match(text(sheet()), /版本/); await f.until(t2 => /palette-v2/.test(text(walk(t2).find(n => /ap-identity-sheet/.test(n.props.className || '')))), 'the patched board (its version)'); assert.doesNotMatch(text(sheet()), /色板/)
  const writes = () => f.count('patchPack') + f.count('patchFigure'), board = png(120, 80, {opaque: true}), patchFigures = f.count('patchFigure'), before = writes()
  walk(sheet()).find(n => n.type === 'input' && n.props['aria-label'] === '上传人物设定图').props.onChange({target: {files: [new File([board], 'board.png', {type: 'image/png'})], value: ''}})
  tree = await f.until(t2 => writes() > before && !/版本/.test(text(walk(t2).find(n => /ap-identity-sheet/.test(n.props.className || '')))) && !walk(t2).some(n => n.props.role === 'status' && /正在上传/.test(text(n))), 'replaced')
  let figure = (await f.fresh()).figures[f.figureId]
  assert.deepEqual(figure.identitySettei, {board: sha(board), version: sha(JSON.stringify({board: sha(board), palette: []})), palette: []})
  assert.equal(f.count('patchFigure'), patchFigures, 'a new board is a full resource write (patchPack)')
  assert.doesNotMatch(text(sheet()), /版本/); assert.match(sheet().props.className, /is-wide/, 'nothing beside the picture: it takes the whole width')
  walk(sheet()).find(n => n.type === 'button' && n.props['aria-label'] === '关闭').props.onClick(); tree = await f.until(t2 => !walk(t2).some(n => /ap-identity-sheet/.test(n.props.className || '')), 'closed')
  byLabel(tree, '人物操作').props.onClick(); tree = await f.r.settle(); f.tree = tree
  walk(tree).find(n => n.props.role === 'menuitem' && text(n).includes('删除人物设定图…')).props.onClick(); tree = await f.until(t2 => !!button(t2, '删除'), 'the remove confirm')
  button(tree, '删除').props.onClick(); tree = await f.until(t2 => /还没有人物设定图/.test(text(t2)), 'the empty state')
  const removed = await f.fresh(); assert.equal(removed.figures[f.figureId].identitySettei, undefined); assert.equal(removed.manifest.blobs[sha(board)], undefined)
  byLabel(tree, '上传人物设定图').props.onChange({target: {files: [new File([images.wide], 'wide.png', {type: 'image/png'})], value: ''}})
  tree = await f.until(t2 => !!byLabel(t2, '查看人物设定图'), 'uploaded from empty')
  figure = (await f.fresh()).figures[f.figureId]; assert.equal(figure.identitySettei.board, sha(images.wide))
  assert.equal(f.count('prepareAssetGeneration') + f.count('generateAssetCandidate') + f.count('acceptAssetCandidate'), 0, 'nothing generated or accepted')
})

// private fork (gen prompts, owner 2026-10): 设置 → 生图 edits the shared layer of a kind for every character; 查看全文 in
// the dialog marks what was edited there; 恢复默认 brings the template back; a write keeps the template's {{slots}}.
test('设置 → 生图: an edit reaches the dialog\'s full prompt (marked), slots are kept, 恢复默认 restores the template', async t => {
  const f = await fixture(t), template = await read('../tavern-plugin/presets/asset-gen/templates/sprite.md')
  const edited = template.replace(/^Finish: .*$/m, 'Finish: soft watercolour wash.')
  await f.generation.setPrompt({kind: 'sprite', text: edited, expectedRevision: 0})
  ;(await f.pick('喜悦', '生成…')).props.onClick(); let tree = await f.dialog()
  button(dialogOf(tree), '查看全文').props.onClick(); tree = await f.until(t2 => walk(dialogOf(t2)).some(n => n.type === 'pre'), 'the full prompt')
  const marks = walk(walk(dialogOf(tree)).find(n => n.type === 'pre')).filter(n => n.type === 'mark').map(n => text(n).trim())
  assert.deepEqual(marks, ['Finish: soft watercolour wash.']); assert.match(text(dialogOf(tree)), /标出\s*的部分是在「设置 → 生图」里改过的/)

  f.r.render(f.views.GenPromptSettings, {call: f.binding.rpc})
  const field = label => walk(f.r.render()).find(n => n.type === 'textarea' && n.props['aria-label'] === label)
  tree = await f.until(() => !!field('背景'), 'the settings page')
  assert.deepEqual(walk(tree).filter(n => cls(n, 'ap-section-title')).map(text), ['立绘', '头像', '八个表情', '服装设定图', '人物设定图', '背景'])
  assert.equal(field('立绘').props.value, edited.trimEnd()); assert.ok(byLabel(tree, '已改'), 'the edited kind carries the dot')
  // A slot dropped is refused by the field itself: nothing is written.
  field('背景').props.onChange({target: {value: 'Any scene.'}}); await f.r.settle(); field('背景').props.onBlur(); tree = await f.r.settle()
  assert.match(text(tree), /请保留 \{\{userPrompt\}\}/); assert.equal(f.count('setAssetGenPrompt'), 0)
  field('背景').props.onChange({target: {value: 'Scene: {{userPrompt}}. Painted softly.'}}); await f.r.settle(); field('背景').props.onBlur()
  tree = await f.until(() => f.count('setAssetGenPrompt') === 1 && walk(f.r.render()).filter(n => n.props['aria-label'] === '已改').length === 2, 'the background edit saved')
  assert.deepEqual(f.last('setAssetGenPrompt'), {kind: 'background', text: 'Scene: {{userPrompt}}. Painted softly.', expectedRevision: 1})
  // 恢复默认 (after a one-line confirmation) drops the 立绘 edit: the template text again.
  byLabel(walk(tree).find(n => n.type === 'section' && text(n).startsWith('立绘')), '恢复默认').props.onClick(); tree = await f.r.settle()
  button(confirmOf(tree), '恢复默认').props.onClick()
  await f.until(() => f.count('setAssetGenPrompt') === 2 && field('立绘').props.value === template.trimEnd(), 'reset')
  assert.deepEqual(f.last('setAssetGenPrompt'), {kind: 'sprite', text: null, expectedRevision: 2})
  assert.equal((await f.generation.prompts()).kinds.find(k => k.kind === 'sprite').edited, false)
})
