// private fork: offline asset review viewer (viewer/template.html) in real headless Chromium via file://.
// One continuous contact sheet. Covers: no network, rendering of review-data v1, missing items never
// borrow another image, filters, section virtualization with stable scroll, stale loads of sections the
// reader already left never paint, decisions persistence/export shape, in-place playback.
import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import {readFile, writeFile, mkdir} from 'node:fs/promises'
import {fileURLToPath, pathToFileURL} from 'node:url'
import {chromium} from 'playwright'
import {buildFixture} from '../tools/asset-viewer/fixture.mjs'
import {injectReviewData, TEMPLATE, PLACEHOLDER} from '../tools/asset-viewer/render.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const DIR = path.join(ROOT, '.tmp', 'asset-viewer-test')   // gitignored; content-addressed, reused between runs
let browser, data, template

const clone = v => JSON.parse(JSON.stringify(v))
async function writeHtml(name, d) { const file = path.join(DIR, name); await writeFile(file, injectReviewData(template, d)); return pathToFileURL(file).href }
function walkItems(d, fn) {
  for (const c of d.characters) {
    fn(c.identity_settei, c)
    for (const o of c.outfits) { fn(o.settei, c, o); for (const s of o.states) { fn(s.sprite, c, o); fn(s.avatar, c, o); if (s.blink) fn(s.blink, c, o); s.mouth.frames.forEach(f => fn(f, c, o)) } }
  }
  for (const s of d.scenes) fn(s)
}
function slotPaths(d) { const m = new Map(); walkItems(d, it => it && m.set(it.slot_id, it.image ? it.image.path : null)); return m }
function outfitPaths(d, ck, ok) {
  const out = new Set()
  walkItems(d, (it, c, o) => { if (it && it.image && c && c.key === ck && o && o.key === ok) out.add(it.image.path) })
  return out
}
// Sample plus filler characters (copies of 白石琴音 with their own slot ids, same files) between
// 白石琴音 and 雨宫凛, so the sheet is many viewports long.
function bigData(d, n = 10) {
  const out = clone(d), k = out.characters.find(c => c.key === 'kotone'), fillers = []
  for (let i = 0; i < n; i++) {
    const c = clone(k)
    c.key = 'f' + i; c.name = '填充' + i; c.id = c.id.slice(0, -2) + String(i).padStart(2, '0')
    walkItems({characters: [c], scenes: []}, it => { if (it) it.slot_id = it.slot_id.replace(/^kotone\//, c.key + '/') })
    fillers.push(c)
  }
  out.characters.splice(2, 0, ...fillers)
  return out
}
async function open(url, {hooks = false, held = [], ctx, viewport = {width: 1600, height: 900}, wait = true} = {}) {
  const context = ctx || await browser.newContext({viewport, acceptDownloads: true})
  if (hooks) await context.addInitScript(held => {
    window.__held = new Set(held); window.__waiters = []; window.__paints = []; window.__release = false
    window.__dshReviewHooks = {
      delay: p => window.__release || !window.__held.has(p) ? Promise.resolve() : new Promise(r => window.__waiters.push(r)),
      onPaint: info => window.__paints.push(info.section)
    }
  }, held)
  const page = await context.newPage(), requests = [], errors = []
  page.on('request', r => requests.push(r.url()))
  page.on('pageerror', e => errors.push(String(e)))
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
  await page.goto(url)
  await page.waitForFunction(() => window.__dshReview && window.__dshReview.model, null, {timeout: 30000})
  if (wait) await page.waitForFunction(() => window.__dshReview.ready(), null, {timeout: 30000})
  return {context, page, requests, errors}
}
async function show(page, id) {
  assert.ok(await page.evaluate(id => window.__dshReview.scrollTo(id), id), 'section exists: ' + id)
  await page.waitForFunction(id => window.__dshReview.visible().includes(id) && window.__dshReview.ready(), id, {timeout: 30000})
}
const sec = id => `[data-sec="${id}"]`
const drawn = page => page.evaluate(() => [...document.querySelectorAll('#sheet canvas')].filter(c => c.width).map(c => c.dataset.src))
const benign = errors => errors.filter(e => !/ERR_FILE_NOT_FOUND|Failed to load resource/.test(e))

test.before(async () => {
  browser = await chromium.launch()
  await mkdir(DIR, {recursive: true})
  const page = await browser.newPage()
  ;({data} = await buildFixture(page, DIR, {}))
  await page.close()
  template = await readFile(TEMPLATE, 'utf8')
})
test.after(async () => { await browser?.close() })

test('template has exactly one data placeholder and degrades without data', async () => {
  assert.equal(template.split(PLACEHOLDER).length, 2)
  const file = path.join(DIR, 'raw-template.html')
  await writeFile(file, template)
  const context = await browser.newContext(), page = await context.newPage(), errors = []
  page.on('pageerror', e => errors.push(String(e)))
  await page.goto(pathToFileURL(file).href)
  await page.waitForSelector('.boot')
  assert.match(await page.textContent('#sheet'), /没有审阅数据/)
  assert.deepEqual(errors, [])
  await context.close()
})

test('renders the whole sheet top to bottom with no network requests and no internal ids', async () => {
  const bad = clone(data)
  // Hostile paths must never be requested: treated as missing, not fetched.
  bad.characters[0].outfits[0].states[1].avatar.image = {path: 'https://example.invalid/x.png', native_size: [512, 512]}
  bad.characters[0].outfits[0].states[2].avatar.image = {path: '//example.invalid/y.png', native_size: [512, 512]}
  bad.characters[0].outfits[0].states[3].avatar.image = {path: 'C:/Windows/z.png', native_size: [512, 512]}
  const {context, page, requests, errors} = await open(await writeHtml('render.html', bad))
  assert.equal(await page.locator('#sheet .overview, #sheet .ov').count(), 0, 'no overview page')
  assert.equal(await page.locator('#bar').getByText(/\d+ \/ \d+/).count(), 0, 'no page counter')
  assert.match(await page.textContent('#filters'), /全部\s*13/)
  const ids = (await page.evaluate(() => window.__dshReview.sections())).map(s => s.id)
  assert.deepEqual(ids.slice(0, 3), ['chr:sumi', 'outfit:sumi/daily', 'outfit:sumi/uniform'])
  assert.ok(ids.some(id => id.startsWith('scenes:')))
  for (const id of ids) {
    await show(page, id)
    const text = await page.evaluate(id => document.querySelector(`[data-sec="${id}"]`).innerText, id)
    assert.doesNotMatch(text, /\/(sprite|avatar|mouth|blink)\/|identity-settei|[0-9a-f]{64}/, 'no internal ids or hashes visible in ' + id)
  }
  await show(page, 'outfit:sumi/daily')
  assert.ok(await page.locator(sec('outfit:sumi/daily') + ' .tile.sprite canvas').count() >= 9)
  assert.equal(await page.locator(sec('outfit:sumi/daily') + ' .av[data-state="joy"] canvas').count(), 0, 'hostile path not drawn')
  // Sprites are large: at least 40% of the viewport height.
  const hh = await page.evaluate(() => document.querySelector('[data-sec="outfit:sumi/daily"] .tile.sprite').getBoundingClientRect().height)
  assert.ok(hh >= 0.4 * 900, 'sprite height ' + hh)
  const remote = requests.filter(u => !/^(file|blob|data):/.test(u))
  assert.deepEqual(remote, [], 'only local file/blob requests')
  assert.ok(requests.some(u => u.startsWith('file:') && u.endsWith('.png')))
  assert.deepEqual(benign(errors), [])
  await context.close()
})

test('hover preview delays original decode, fills the viewport, cancels on leave/scroll and ignores touch', async () => {
  const d = clone(data), it = d.characters[0].identity_settei;
  const source = it.image.path;
  await writeFile(path.join(DIR, 'hover-original.png'), await readFile(path.join(DIR, source)));
  it.preview_image = clone(it.image); it.image.path = 'hover-original.png';
  const url = await writeHtml('hover.html', d), {context, page, requests, errors} = await open(url);
  const tile = page.locator('[data-sec="chr:sumi"] .tile.zoom').first();
  assert.equal(requests.some(u => u.endsWith('/hover-original.png')), false, 'contact sheet only decodes its preview');
  await tile.hover();
  assert.equal(await page.locator('#hoverPreview:not([hidden])').count(), 0, 'not synchronous');
  await page.mouse.move(1, 1);
  await page.waitForTimeout(180);
  assert.equal(requests.some(u => u.endsWith('/hover-original.png')), false, 'leave cancels the delayed original request');
  await tile.hover();
  await page.waitForSelector('#hoverPreview:not([hidden]) img');
  const peek = await page.locator('#hoverPreview').evaluate(el => ({height: el.clientHeight, viewport: innerHeight, backdrop: getComputedStyle(el).backgroundColor, pointer: getComputedStyle(el).pointerEvents, source: el.querySelector('img').src}));
  assert.ok(peek.height >= peek.viewport - 16); assert.match(peek.backdrop, /0, 0, 0/); assert.equal(peek.pointer, 'none'); assert.match(peek.source, /hover-original\.png$/);
  await page.mouse.move(1, 1);
  assert.equal(await page.locator('#hoverPreview').isVisible(), false);
  await tile.hover(); await page.waitForSelector('#hoverPreview:not([hidden]) img');
  await page.evaluate(() => dispatchEvent(new Event('scroll')));
  assert.equal(await page.locator('#hoverPreview').isVisible(), false);
  await page.mouse.move(1, 1);
  await tile.dispatchEvent('pointerenter', {pointerType: 'touch'}); await page.waitForTimeout(180);
  assert.equal(await page.locator('#hoverPreview').isVisible(), false);
  await tile.click(); await page.waitForSelector('#viewer:not([hidden])');
  assert.equal(await page.locator('#hoverPreview').isVisible(), false, 'explicit viewer stays the only modal');
  assert.deepEqual(benign(errors), []); await context.close();
});

test('settei boards pack densely: no mostly-empty side columns on desktop, stacked on phones', async () => {
  const url = await writeHtml('dense.html', data)
  const rowFill = (page, id) => page.evaluate(id => {
    const s = document.querySelector(`[data-sec="${id}"]`), f = s.querySelector('.board'), t = f.querySelector('.tile')
    const sheet = document.getElementById('sheet'), cs = getComputedStyle(sheet)
    const W = sheet.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)
    const m = f.querySelector('.bmeta'), mr = m && m.getBoundingClientRect(), tr = t.getBoundingClientRect()
    return {W, fig: f.getBoundingClientRect().width, tileW: tr.width, tileH: tr.height, side: !!m, metaTop: mr ? mr.top - tr.top : null,
      besideAvatars: !!(m && m.querySelector('.avatars'))}
  }, id)
  const desk = await open(url)
  for (const id of ['chr:sumi', 'outfit:sumi/daily']) {
    await show(desk.page, id)
    const r = await rowFill(desk.page, id)
    assert.ok(r.side, id + ': caption/palette sit beside the board, not under it')
    assert.equal(r.metaTop, 0, id + ': side column is top-aligned with the board')
    assert.ok(r.fig >= 0.8 * r.W, id + ': board row fills the width (' + r.fig + ' of ' + r.W + ')')
  }
  const o = await rowFill(desk.page, 'outfit:sumi/daily')
  assert.ok(o.besideAvatars, 'outfit avatars fill the column beside the settei board')
  assert.equal(await desk.page.locator(sec('outfit:sumi/daily') + ' .avatars').count(), 1, 'avatars are not also rendered as their own row')
  assert.equal(await desk.page.locator(sec('outfit:sumi/daily') + ' .bmeta .av canvas').count() >= 1, true)
  assert.deepEqual(benign(desk.errors), [])
  await desk.context.close()
  const phone = await open(url, {viewport: {width: 375, height: 812}})
  await show(phone.page, 'outfit:sumi/daily')
  const p = await rowFill(phone.page, 'outfit:sumi/daily')
  assert.equal(p.side, false, 'phones stack the board and palette')
  assert.ok(p.tileW <= 375, 'board fits the phone width')
  assert.equal(await phone.page.evaluate(() => document.documentElement.scrollWidth <= 375), true, 'no horizontal overflow at 375 px')
  await phone.context.close()
})

test('missing items show a quiet empty tile in place and never borrow another image', async () => {
  const d = clone(data)
  // A referenced file that is not on disk shows a read failure, never a substitute.
  d.characters[0].outfits[1].states[0].avatar.image = {path: 'images/' + 'f'.repeat(64) + '.png', native_size: [512, 512]}
  const {context, page, errors} = await open(await writeHtml('missing.html', d))
  const paths = slotPaths(d)
  for (const id of (await page.evaluate(() => window.__dshReview.sections())).map(s => s.id)) {
    await show(page, id)
    // Every drawn tile shows exactly the file of its own slot; empty tiles have no pixels.
    const pairs = await page.evaluate(id => [...document.querySelectorAll(`[data-sec="${id}"] .tile[data-slot]`)].map(t => [t.dataset.slot, t.querySelector('canvas')?.dataset.src || null, !!t.querySelector('.empty')]), id)
    for (const [slot, src, empty] of pairs) {
      assert.ok(paths.has(slot), 'known slot ' + slot)
      if (src) assert.equal(src, paths.get(slot), 'tile ' + slot + ' draws its own file')
      else assert.ok(empty, 'tile ' + slot + ' without pixels shows an empty state')
    }
  }
  await show(page, 'outfit:sumi/daily')
  assert.equal(await page.locator(sec('outfit:sumi/daily') + ' [data-state="disgust"] .tile.sprite canvas').count(), 1)
  await show(page, 'outfit:sumi/uniform')
  const tile = page.locator(sec('outfit:sumi/uniform') + ' [data-state="disgust"] .tile.sprite')
  assert.equal(await tile.locator('canvas').count(), 0)
  assert.equal(await tile.locator('.empty').count(), 1)
  assert.match(await tile.innerText(), /^(缺|未开始)$/, 'quiet: one word, reason only in the tooltip')
  assert.match(await page.locator(sec('outfit:sumi/uniform') + ' [data-state="sad"] .cap').first().innerText(), /口型缺 2/)
  const lost = page.locator(sec('outfit:sumi/uniform') + ' .av[data-state="calm"] .tile')
  assert.equal(await lost.locator('canvas').count(), 0)
  assert.match(await lost.innerText(), /读取失败/)
  // Even an entirely absent outfit retains per-slot status placeholders.
  await show(page, 'outfit:rin/daily')
  assert.equal(await page.locator(sec('outfit:rin/daily') + ' .tile.sprite').count(), 9)
  assert.equal(await page.locator(sec('outfit:rin/daily') + ' .tile.sprite .empty').count(), 9)
  assert.deepEqual(benign(errors), [])
  await context.close()
})

test('filters hide non-matching sections; counts live inside the chips', async () => {
  const {context, page, errors} = await open(await writeHtml('filters.html', data))
  const units = []   // [section id or scene slot, items]
  for (const c of data.characters) { units.push(['chr:' + c.key, [c.identity_settei]]); for (const o of c.outfits) { const its = [o.settei]; for (const s of o.states) its.push(s.sprite, s.avatar, ...(s.blink ? [s.blink] : []), ...s.mouth.frames); units.push(['outfit:' + c.key + '/' + o.key, its]) } }
  const scenes = data.scenes.map(s => [s.slot_id, [s]])
  const shownUnits = async () => {
    const ids = (await page.evaluate(() => window.__dshReview.sections())).map(s => s.id).filter(id => !id.startsWith('scenes:'))
    const sceneSlots = await page.evaluate(() => [...document.querySelectorAll('#sheet .scene .tile[data-slot]')].map(t => t.dataset.slot))
    return {ids, sceneSlots}
  }
  const check = async (f, pred) => {
    await page.click(`#filters button[data-f="${f}"]`)
    await page.waitForFunction(f => window.__dshReview.filter === f, f)
    const want = units.filter(([, its]) => pred(its)).map(([id]) => id), wantScenes = scenes.filter(([, its]) => pred(its)).map(([id]) => id)
    const ids = (await page.evaluate(() => window.__dshReview.sections())).map(s => s.id).filter(id => !id.startsWith('scenes:'))
    assert.deepEqual(ids, want, f + ' shows exactly the matching sections')
    // Scenes are chunked by line; walk them so every chunk renders, then compare.
    const chunks = (await page.evaluate(() => window.__dshReview.sections())).filter(s => s.type === 'scenes').map(s => s.id)
    const got = []
    for (const id of chunks) { await show(page, id); got.push(...await page.evaluate(id => [...document.querySelectorAll(`[data-sec="${id}"] .tile[data-slot]`)].map(t => t.dataset.slot), id)) }
    assert.deepEqual(got, wantScenes, f + ' scenes')
    assert.equal(await page.textContent(`#filters button[data-f="${f}"] b`), String(want.length + wantScenes.length), f + ' count')
  }
  await check('refused', its => its.some(i => i.status === 'refused'))
  await check('attention', its => its.some(i => i.warnings.length || i.status === 'refused' || (i.status === 'blocked' && i.blocked.some(b => !/REQUIRED$/.test(b)))))
  await check('missing', its => its.some(i => i.status === 'missing' || (i.status === 'blocked' && i.blocked.every(b => /REQUIRED$/.test(b)))))
  // 需修改: mark one outfit, then only it remains.
  await page.click('#filters button[data-f="all"]')
  await show(page, 'outfit:kotone/stage')
  await page.click(sec('outfit:kotone/stage') + ' .sec-h .gate button.fix')
  assert.equal(await page.textContent('#filters button[data-f="fix"] b'), '1', 'count updates with the decision')
  await page.click('#filters button[data-f="fix"]')
  await page.waitForFunction(() => window.__dshReview.filter === 'fix')
  assert.deepEqual((await page.evaluate(() => window.__dshReview.sections())).map(s => s.id), ['outfit:kotone/stage'])
  // Clicking the active chip again returns to 全部.
  await page.click('#filters button[data-f="fix"]')
  await page.waitForFunction(() => window.__dshReview.filter === 'all')
  assert.equal((await page.evaluate(() => window.__dshReview.sections())).filter(s => s.type !== 'scenes').length, units.length)
  // A filter with no match says so plainly.
  await page.click('#filters button[data-f="changed"]')
  assert.ok(await page.locator('#sheet .sec').count() >= 1)
  assert.deepEqual(benign(errors), [])
  void shownUnits
  await context.close()
})

test('sections virtualize by viewport and the reading position stays put', async () => {
  const big = bigData(data)
  const {context, page, errors} = await open(await writeHtml('virtual.html', big))
  const all = await page.evaluate(() => window.__dshReview.sections())
  assert.ok(all.length >= 35, 'long sheet: ' + all.length)
  const total = await page.evaluate(() => document.documentElement.scrollHeight)
  assert.ok(total > 900 * 30, 'scrollbar reflects the whole sheet')
  const matTop = all.filter(s => s.mat).map(s => s.id)
  assert.ok(matTop.length >= 1 && matTop.length <= 5, 'only near sections are built: ' + matTop)
  const nodes = await page.evaluate(() => document.querySelectorAll('#sheet *').length)
  assert.ok(nodes < 1500, 'DOM stays small: ' + nodes)
  // Jump deep: the target sits right under the bar even as estimated sections above it are
  // replaced by real ones (heights change) — manual scroll anchoring.
  const target = 'outfit:f6/casual'
  await show(page, target)
  await page.waitForTimeout(600)
  const bar = await page.evaluate(() => document.getElementById('bar').getBoundingClientRect().height)
  const pos = await page.evaluate(id => document.querySelector(`[data-sec="${id}"]`).getBoundingClientRect().top, target)
  assert.ok(Math.abs(pos - bar) <= 2, 'target top ' + pos + ' vs bar ' + bar)
  const after = await page.evaluate(() => window.__dshReview.sections())
  assert.ok(after.some(s => s.mat && Math.abs(s.h - s.est) > 1), 'some materialized section differs from its estimate (anchoring was needed)')
  assert.equal(after.find(s => s.id === 'chr:sumi').mat, false, 'far sections are released')
  const far = await page.evaluate(() => [...document.querySelectorAll('.sec.ghost canvas')].length)
  assert.equal(far, 0, 'released sections hold no canvases')
  // Scroll up by wheel through sections that materialize above: what is on screen does not jump.
  const ref = await page.evaluate(id => document.querySelector(`[data-sec="${id}"] .sec-h`).getBoundingClientRect().top, target)
  await page.mouse.move(800, 500)
  await page.mouse.wheel(0, -700)
  await page.waitForTimeout(700)
  const moved = await page.evaluate(id => document.querySelector(`[data-sec="${id}"] .sec-h`).getBoundingClientRect().top, target)
  assert.ok(Math.abs(moved - ref - 700) <= 3, 'wheel moved content by exactly the wheel delta: ' + (moved - ref))
  const s = await page.evaluate(() => window.__dshReview.cache())
  assert.ok(s.bytes <= s.budget, 'decode cache within budget')
  assert.deepEqual(benign(errors), [])
  await context.close()
})

test('fast scrolling discards loads of sections already left; they never paint', async () => {
  const big = bigData(data)
  const daily = outfitPaths(big, 'sumi', 'daily')
  const held = [...outfitPaths(big, 'sumi', 'uniform')].filter(p => !daily.has(p))
  const {context, page, errors} = await open(await writeHtml('stale.html', big), {hooks: true, held})
  await page.evaluate(() => window.__dshReview.scrollTo('outfit:sumi/uniform'))
  await page.waitForFunction(() => window.__dshReview.sections().find(s => s.id === 'outfit:sumi/uniform').mat)
  await page.waitForTimeout(300)
  assert.ok(await page.evaluate(() => window.__waiters.length) > 0, 'its images are being held')
  assert.ok(!(await page.evaluate(() => window.__paints.includes('outfit:sumi/uniform'))))
  // Leave before anything arrived; jump far down to the scenes.
  const last = (await page.evaluate(() => window.__dshReview.sections())).at(-1).id
  await show(page, last)
  await page.waitForFunction(() => !window.__dshReview.sections().find(s => s.id === 'outfit:sumi/uniform').mat, null, {timeout: 10000})
  await page.evaluate(() => { window.__release = true; window.__waiters.splice(0).forEach(r => r()) })
  await page.waitForTimeout(800)
  assert.ok(!(await page.evaluate(() => window.__paints.includes('outfit:sumi/uniform'))), 'the abandoned section never painted')
  const shown = new Set(await drawn(page))
  for (const p of held) assert.ok(!shown.has(p), 'held image never drawn after leaving: ' + p)
  // Coming back paints it normally, with its own images.
  await show(page, 'outfit:sumi/uniform')
  assert.ok(await page.evaluate(() => window.__paints.includes('outfit:sumi/uniform')))
  const back = await page.evaluate(() => [...document.querySelectorAll('[data-sec="outfit:sumi/uniform"] canvas')].map(c => c.dataset.src))
  assert.ok(back.length > 5)
  for (const p of back) assert.ok(outfitPaths(big, 'sumi', 'uniform').has(p), 'own image: ' + p)
  const s = await page.evaluate(() => window.__dshReview.cache())
  assert.ok(s.bytes <= s.budget)
  assert.deepEqual(benign(errors), [])
  await context.close()
})

test('decisions persist per project+revision and export a small JSON', async () => {
  const context = await browser.newContext({viewport: {width: 1600, height: 900}, acceptDownloads: true})
  const url = await writeHtml('decisions.html', data)
  const {page} = await open(url + '#s=outfit:sumi/daily', {ctx: context})
  const head = sec('outfit:sumi/daily') + ' .sec-h .gate'
  await page.click(head + ' button.ok')
  await show(page, 'chr:sumi')
  const idGate = page.locator(sec('chr:sumi') + ' .board .gate')
  await idGate.locator('button.fix').click()
  await idGate.locator('input').fill('发色偏暗')
  await page.waitForTimeout(450)
  await page.reload()
  await page.waitForFunction(() => window.__dshReview && window.__dshReview.ready())
  await show(page, 'outfit:sumi/daily')
  assert.equal(await page.getAttribute(head + ' button.ok', 'aria-pressed'), 'true')
  await show(page, 'chr:sumi')
  assert.equal(await page.locator(sec('chr:sumi') + ' .board .gate input').inputValue(), '发色偏暗')
  assert.equal(await page.getAttribute('#exportBtn', 'class'), 'unsaved')
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#exportBtn')])
  assert.match(download.suggestedFilename(), /^review-decisions-[0-9a-f]{8}-r7\.json$/)
  const out = JSON.parse(await readFile(await download.path(), 'utf8'))
  assert.equal(out.schema, 'dsh-review-decisions')
  assert.equal(out.schema_version, 1)
  assert.deepEqual(out.project, {id: data.project.id, name: data.project.name, revision: 7})
  assert.ok(Date.parse(out.exported_at))
  assert.equal(out.decisions.length, 2)
  const outfit = out.decisions.find(d => d.target === 'outfit'), identity = out.decisions.find(d => d.target === 'identity_settei')
  assert.deepEqual({...outfit, decided_at: 0}, {target: 'outfit', verdict: 'approved', note: '', decided_at: 0, character: 'sumi', character_name: '星野澄', outfit: 'daily', outfit_label: '日常服', slot_prefix: 'sumi/daily/'})
  assert.equal(identity.verdict, 'needs_changes')
  assert.equal(identity.note, '发色偏暗')
  assert.equal(identity.slot_id, 'sumi/identity-settei')
  assert.equal(identity.image, data.characters[0].identity_settei.image.path)
  assert.equal(out.summary.approved, 1)
  assert.equal(out.summary.needs_changes, 1)
  assert.equal(out.summary.targets, out.summary.approved + out.summary.needs_changes + out.summary.unreviewed)
  assert.ok(JSON.stringify(out).length < 4096, 'small')
  assert.equal(await page.getAttribute('#exportBtn', 'class'), '', 'exported')
  // Next revision: unchanged targets carry over; changed content resets and shows under 已改.
  const r8 = clone(data); r8.project.revision = 8
  r8.characters[0].identity_settei.image = clone(r8.characters[0].outfits[0].settei.image)
  await page.goto(await writeHtml('decisions-r8.html', r8) + '#s=outfit:sumi/daily')
  await page.waitForFunction(() => window.__dshReview && window.__dshReview.ready())
  await show(page, 'outfit:sumi/daily')
  assert.equal(await page.getAttribute(head + ' button.ok', 'aria-pressed'), 'true', 'unchanged outfit decision carried over')
  await show(page, 'chr:sumi')
  assert.equal(await page.locator(sec('chr:sumi') + ' .board .gate button.fix').getAttribute('aria-pressed'), 'false', 'changed board needs a fresh decision')
  await page.click('#filters button[data-f="changed"]')
  await page.waitForFunction(() => window.__dshReview.filter === 'changed')
  assert.ok((await page.evaluate(() => window.__dshReview.sections())).some(s => s.id === 'chr:sumi'), 'changed since last review')
  const keys = await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('dsh-review:v1:' + window.__dshReview.model.project.id)))
  assert.equal(keys.length, 2)
  await context.close()
})

test('blink/mouth playback and native viewer frames work in place', async () => {
  const {context, page, errors} = await open(await writeHtml('play.html', data) + '#s=outfit:sumi/daily')
  const joy = sec('outfit:sumi/daily') + ' [data-state="joy"]'
  await page.click(joy + ' .play')
  assert.equal(await page.getAttribute(joy + ' .play', 'aria-pressed'), 'true')
  await page.waitForTimeout(600)
  assert.ok((await page.evaluate(() => window.__dshReview.frames())).bytes > 0, 'frames composited for playback')
  await page.click(joy + ' .tile.sprite')
  await page.waitForSelector('#vLayer canvas')
  assert.deepEqual(await page.locator('#vFrames button[data-f]').allInnerTexts(), ['原图', '闭眼', '闭', '小', '中', '开'])
  await page.click('#vFrames button[data-f="mouth:open"]')
  assert.equal(await page.getAttribute('#vFrames button[data-f="mouth:open"]', 'aria-pressed'), 'true')
  assert.equal(await page.evaluate(() => [document.querySelector('#vLayer canvas').width, document.querySelector('#vLayer canvas').height].join('x')), '1024x1536', 'composited at native size')
  await page.keyboard.press('Escape')
  assert.equal(await page.isHidden('#viewer'), true)
  // The viewer walks the whole sheet: past the last image of one section into the next.
  await page.click(sec('outfit:sumi/daily') + ' .boards .tile')
  await page.waitForSelector('#vLayer > *')
  await page.keyboard.press('ArrowRight')
  await page.waitForFunction(() => /冬季制服/.test(document.getElementById('vTitle').textContent))
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => window.__dshReview.visible().includes('outfit:sumi/uniform'))
  assert.deepEqual(errors, [])
  await context.close()
})

test('sprite-only delivery keeps missing/retry placeholders and uses WebP previews with original zoom', async () => {
  const d=clone(data);d.scope='sprite';d.scenes=[]
  const c=d.characters.find(c=>c.key==='sumi');d.characters=[c];c.outfits=[c.outfits[0]]
  const states=c.outfits[0].states, first=states.find(s=>s.sprite.image), original=first.sprite.image
  const encoder=await browser.newPage()
  const png=await readFile(path.join(DIR,original.path))
  const webp=await encoder.evaluate(async b64=>{
    const image=new Image();image.src='data:image/png;base64,'+b64;await image.decode()
    const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height
    canvas.getContext('2d').drawImage(image,0,0);return canvas.toDataURL('image/webp',.88).split(',')[1]
  },png.toString('base64'))
  await encoder.close();await writeFile(path.join(DIR,'preview.webp'),Buffer.from(webp,'base64'))
  first.sprite.preview_image={path:'preview.webp',native_size:original.native_size}
  const others=states.filter(s=>s!==first)
  for(const [i,status]of ['missing','retry-pending'].entries()){delete others[i].sprite.image;others[i].sprite.status=status}
  const {context,page,errors,requests}=await open(await writeHtml('sprite-scope.html',d)+'#s=outfit:sumi/daily')
  assert.equal(await page.locator('.tile.avatar').count(),0)
  assert.equal(await page.locator('.boards').count(),0)
  assert.match(await page.locator('[data-empty="'+others[0].sprite.slot_id+'"]').innerText(),/缺/)
  assert.match(await page.locator('[data-empty="'+others[1].sprite.slot_id+'"]').innerText(),/等待补交/)
  assert.ok(requests.some(url=>url.endsWith('/preview.webp')))
  await page.click('[data-slot="'+first.sprite.slot_id+'"]')
  await page.waitForSelector('#vLayer > *')
  assert.deepEqual(await page.evaluate(()=>[document.querySelector('#vLayer > *').width,document.querySelector('#vLayer > *').height]),original.native_size)
  assert.deepEqual(errors,[])
  await context.close()
})
