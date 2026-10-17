// private fork: 舞台设置 r7 (owner review 2026-10) — the r5 host-shaped pane and mock, checking:
// 1. section order (advanced): 基础设置 → 当前素材包 → 人物 → 开场设置 → 读音词典 → 导演指令 → 提示词 → 变量对照 → 导入导出 → 全局设置
//    (变量对照 only shows when the card has display slots; the offline mock has none);
// 2. 导入导出: 「导出卡」 and 「导入卡 ZIP」 side by side; under them every pack the card uses (全局 first, then 本卡), each with
//    its name, its size and a 「一起导出」 switch right after its label, all on; no 「附带 N 个素材包 ›」 link;
//    导出卡 sends exactly the packs left on (exportCardBundle packIds);
// 3. the 提示词 演出指引 pencil still jumps to 导演指令; 「全局读音 ›」 still opens the 配音 tab;
// 4. 人物 ＋ (r8: one green pack → there, several → a menu of them, none → a new pack named after the card; CAS, editor); 0. no page title, 基础 / 高级 on the first heading row, headings at 15px with normal tracking;
// 5. 导演指令 chips without nested rings, 恢复默认 in the heading (private fork: was 恢复全局); 6. 读音词典 without a count, ＋ on its own line;
// 7. the 人物差分 · 通用 prompt row names its covered figures; 8. 引擎设置 shares the headings and chips.
// Usage: node tests/harness/stage-panel-r7.mjs [outDir] [--before]   (--before only shoots, for the old UI)
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { browserReactScript } from '../fixtures/browser-react.mjs'
import { forkThemeCss } from '../helpers/fork-theme-css.mjs'
import { stageSource, pageSetup, THEMES } from './card-centric-stage.mjs'
import { hostPieces, r5Setup } from './stage-panel-r5.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const args = process.argv.slice(2), before = args.includes('--before')
const outDir = args.find(a => !a.startsWith('--')) || path.join(root, '.tmp/stage-panel-r7')
// private fork (stage panel r8): 导演指令 moved into 提示词 (prompt-view-complete); its chips / 引擎设置 / pencil-jump steps are gone.
const ORDER = ['基础设置', '素材包', '人物', '开场设置', '读音词典', '提示词'] // private fork (pack section merge); (engine ui r2): 引擎设置 is a 基础设置 row, no 全局设置 section

// Pack sizes for the mock (manifest.files), and a recorder on exportCardBundle.
function r7Setup() {
  const PACK = '11111111-1111-4111-8111-111111111111', GENERAL = '22222222-2222-4222-8222-222222222222', SFX = '44444444-4444-4444-8444-444444444444'
  const sizes = { [PACK]: 38.2 * 1048576, [GENERAL]: 12.6 * 1048576, [SFX]: 860 * 1024 }
  const service = window.binding.service, list = service.listPackSummaries, snapshot = service.getPackSnapshot
  const sized = pack => { if (sizes[pack.manifest.id]) pack.manifest.files = [{ path: 'a.bin', size: Math.round(sizes[pack.manifest.id] * 0.75), sha256: 'x' }, { path: 'b.bin', size: Math.round(sizes[pack.manifest.id] * 0.25), sha256: 'y' }]; return pack }
  service.listPackSummaries = async () => (await list()).map(sized)
  service.getPackSnapshot = async a => sized(await snapshot(a))
  window.exports = []
  service.exportCardBundle = async a => { window.exports.push(JSON.parse(JSON.stringify(a))); return { bytes: new Uint8Array(), filename: 'card.zip' } }
  window.binding.download = () => {}
  // 人物 ＋: packs created here live beside the mock's own (createPack / createFigure / snapshots with CAS revisions).
  const extra = new Map(), copy = v => JSON.parse(JSON.stringify(v)), createFigure = service.createFigure
  window.packCalls = []
  service.createPack = async a => { window.packCalls.push(['createPack', copy(a)]); if (a.expectedRevision !== null) throw Object.assign(new Error('REVISION_CONFLICT'), { code: 'REVISION_CONFLICT' })
    const id = 'c7c7c7c7-0000-4000-8000-' + String(extra.size + 1).padStart(12, '0'), p = { manifest: { id, name: a.name, assets: [], figures: [], files: [] }, figures: {}, sprites: {}, revision: 'x1' }
    extra.set(id, p); window.packCalls.at(-1).push(id); return { status: 'ok', snapshot: copy(p), widgetRisks: [] } } // private fork (stage panel r8): the new id is recorded
  service.createFigure = async a => { const p = extra.get(a.packId); window.packCalls.push(['createFigure', copy(a)]); if (!p) return createFigure(a) // private fork (stage panel r8): every pack recorded
    if (a.expectedRevision !== p.revision) throw Object.assign(new Error('REVISION_CONFLICT'), { code: 'REVISION_CONFLICT' })
    const id = 'f7f7f7f7-0000-4000-8000-' + String(p.manifest.figures.length + 1).padStart(12, '0'); p.figures[id] = { ...copy(a.figure), id }; p.manifest.figures.push(id); p.revision = 'x' + (Number(p.revision.slice(1)) + 1)
    return { status: 'ok', snapshot: copy(p), widgetRisks: [], figureId: id } }
  const list2 = service.listPackSummaries, snap2 = service.getPackSnapshot
  service.listPackSummaries = async () => [...await list2(), ...[...extra.values()].map(copy)]
  service.getPackSnapshot = async a => extra.has(a.packId) ? copy(extra.get(a.packId)) : snap2(a)
  // The combined 「人物差分 · 通用差分人物」 entry (figures from two packs), as getDialogueBubbles sends it.
  const bubbles = window.useForkBubbles, roster = { key: 'figure', figure: 'common-roster', packs: [PACK, GENERAL], name: '通用差分人物', constant: true, text: '以下角色只用通用差分：鹿目圆（ID f_madoka）、店员 C（ID f_clerk）。', tokens: 21 }
  // Global director commands as the engine page lists them (only keys present show; two are off).
  window.engineValues.dimensions = { scene: true, transitions: true, weather: false, 'lighting.time': true, 'lighting.mood': true, camera: true, 'camera.close': false }
  window.useForkBubbles = (...a) => { const d = bubbles(...a); return { ...d, injection: [...(d.injection || []), roster] } }
}

export async function run() {
  const { chromium } = await import('playwright')
  const { source, picker, playback } = await stageSource()
  const pieces = await hostPieces(), css = await forkThemeCss()
  await mkdir(outDir, { recursive: true })
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  const shots = [], errors = [], prefix = before ? 'before-' : 'after-'
  const check = (ok, message) => { if (!ok) errors.push(message) }
  try {
    for (const [theme, tokens] of Object.entries(THEMES)) for (const [size, viewport, pane] of [['desktop', { width: 1600, height: 900 }, 720], ['375', { width: 375, height: 812 }, 0]]) {
      const page = await browser.newPage({ viewport, deviceScaleFactor: size === '375' ? 2 : 1 })
      const tag = theme + '/' + size
      page.on('pageerror', e => errors.push(tag + ': ' + e.message))
      await page.route('http://stage.test/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"></head><body class="dsh-tavern-shell-active"><div class="host"><main class="chat"></main><section class="pane" data-sidebar-right-panel><div id="panel"></div></section></div></body></html>' }))
      await page.goto('http://stage.test/')
      await page.addStyleTag({ content: css + `
        html, body { margin: 0; height: 100%; } body { ${tokens} background: var(--page); font-family: "Microsoft YaHei UI", "PingFang SC", sans-serif; }
        .host { display: flex; height: 100vh; } .chat { flex: 1; background: var(--page); }
        .pane { width: ${pane ? pane + 'px' : '100%'}; flex: none; height: 100%; overflow: auto; border-left: 1px solid var(--fork-hairline); background: ${theme === 'dark' ? '#0b0b0c' : '#d4d8de'}; container-type: inline-size; }
        #panel { display: flex; flex-direction: column; min-height: 100%; }
        ${pane ? '' : '.chat { display: none; }'}` })
      await page.evaluate(context => { document.body.dataset.fkContext = context }, 'chat-' + theme)
      await page.addScriptTag({ content: await browserReactScript() + ';window.React=modules.react;window.ReactDOM={...modules["react-dom/client"],createPortal:modules["react-dom"].createPortal};' + playback + source + picker + '\n;\n' + pieces + '\n;window.forkStagePrompts=forkStagePrompts;window.ForkHelpTip=ForkHelpTip;' })
      await page.evaluate(pageSetup)
      await page.evaluate(() => { window.scenario('main') })
      await page.evaluate(r5Setup)
      await page.evaluate(r7Setup)
      await page.evaluate(() => window.showReal('r7' + Math.random()))
      await page.getByRole('heading', { name: /^人物/ }).waitFor(); await page.waitForTimeout(900)
      const paneShot = async name => { const file = path.join(outDir, `${prefix}${name}-${theme}-${size}.png`); await page.waitForTimeout(250); await page.locator('.pane').screenshot({ path: file }); shots.push(file) }
      // The whole page: the pane grows to its content for one full-page shot.
      const fullShot = async name => {
        const file = path.join(outDir, `${prefix}${name}-${theme}-${size}.png`)
        await page.addStyleTag({ content: '.host, .pane { height: auto !important; overflow: visible !important; } html, body { height: auto !important; }' }); await page.waitForTimeout(300)
        await page.screenshot({ path: file, fullPage: true }); shots.push(file)
        await page.evaluate(() => document.head.lastElementChild.remove()); await page.waitForTimeout(200)
      }
      const scrollTo = async (heading, offset = 12) => page.evaluate(([text, offset]) => { const pane = document.querySelector('.pane'), el = [...document.querySelectorAll('.ap-section-head h3')].find(n => n.textContent.startsWith(text)); if (el) pane.scrollTop += el.getBoundingClientRect().top - offset }, [heading, offset])
      const step = async (name, fn) => { try { await fn() } catch (e) { errors.push(tag + ' ' + name + ': ' + e.message.split('\n')[0]) } }
      const headings = () => page.evaluate(() => [...document.querySelectorAll('.ap-stage-page > .ap-section > .ap-section-head h3')].map(n => n.childNodes[0]?.textContent?.trim() || n.textContent.trim()))

      // 0. The top of the panel: no page title, 基础 / 高级 on the first heading row; headings read as titles.
      await step('top', async () => {
        await paneShot('00a-top')
        if (before) return
        const titles = await page.locator('.ap-stage h2').evaluateAll(n => n.filter(x => !x.classList.contains('ap-sr-only')).map(x => x.textContent))
        check(titles.length === 0, tag + ': visible page title ' + titles)
        const first = page.locator('.ap-stage-page > section.ap-section').first()
        check(await page.getByRole('radiogroup', { name: '显示模式' }).count() === 0, tag + ': no 基础 / 高级 switch (owner 2026-10, option A)')
        const top = await first.locator('.ap-section-head h3').evaluate(n => Math.round(n.getBoundingClientRect().top - document.querySelector('.pane').getBoundingClientRect().top))
        check(top < 48, tag + ': content starts at the top (' + top + ')')
        const heads = await page.locator('.ap-stage-page .ap-section-head h3').evaluateAll(n => n.map(x => { const s = getComputedStyle(x); return [x.textContent.slice(0, 6), parseFloat(s.fontSize), s.letterSpacing, Number(s.fontWeight)] }))
        check(heads.every(([, size, spacing, weight]) => size >= 15 && (spacing === 'normal' || spacing === '0px') && weight >= 600), tag + ': headings ' + JSON.stringify(heads.filter(([, s, l, w]) => !(s >= 15 && (l === 'normal' || l === '0px') && w >= 600))))
        const pads = await page.locator('.ap-stage-page > section.ap-section').evaluateAll(n => n.slice(1).map(x => { const s = getComputedStyle(x); return parseFloat(s.paddingTop) - parseFloat(s.paddingBottom) }))
        check(pads.every(v => v > 0), tag + ': more room above sections ' + pads)
      })
      // 1. Section order.
      await step('order', async () => {
        await fullShot('00-page')
        const all = (await headings()).map(text => ORDER.find(name => text.startsWith(name)) || text)
        if (before) return
        check(JSON.stringify(all) === JSON.stringify(ORDER), tag + ': sections ' + JSON.stringify(all))
      })
      // 2. 导入导出.
      await step('export', async () => {
        await scrollTo(before ? '卡片导出' : '素材包', 12); await paneShot('01-export')
        return // private fork (pack section merge, owner 2026-10): 导入导出 is part of 素材包 — checked by stage-pack-section.mjs
        const section = page.locator('.ap-export-section')
        check(await section.getByRole('button', { name: /附带|不附带/ }).count() === 0, tag + ': no 附带 link')
        const row = section.locator('.ap-export-row'), buttons = await row.evaluate(node => [...node.querySelectorAll(':scope > button')].map(b => { const r = b.getBoundingClientRect(); return [b.textContent, Math.round(r.left), Math.round(r.right), Math.round(r.top)] }))
        check(buttons.length === 2 && buttons[0][0] === '导出卡' && buttons[1][0] === '导入卡 ZIP' && Math.abs(buttons[0][3] - buttons[1][3]) < 4 && buttons[1][1] - buttons[0][2] < 40, tag + ': export + import side by side ' + JSON.stringify(buttons))
        const rows = await section.locator('.ap-export-pack').evaluateAll(nodes => nodes.map(n => ({ name: n.querySelector('.ap-export-pack-name')?.textContent, size: n.querySelector('.ap-export-pack-size')?.textContent, lamp: n.querySelector('.ap-lamp-dot')?.closest('[data-mode]')?.dataset.mode,
          checked: n.querySelector('input[role=switch]')?.checked, label: n.querySelector('input[role=switch]')?.getAttribute('aria-label'),
          gap: (() => { const t = n.querySelector('.ap-export-pack-toggle > span')?.getBoundingClientRect(), s = n.querySelector('input[role=switch]')?.getBoundingClientRect(); return t && s ? Math.round(s.left - t.right) : -1 })(),
          native: getComputedStyle(n.querySelector('input[role=switch]')).appearance })))
        check(JSON.stringify(rows.map(r => r.name)) === JSON.stringify(['通用音效', '鹿目圆素材', '通用素材']), tag + ': packs 全局 first ' + JSON.stringify(rows.map(r => r.name)))
        check(JSON.stringify(rows.map(r => r.lamp)) === JSON.stringify(['constant', 'keyword', 'keyword']), tag + ': lamps ' + JSON.stringify(rows.map(r => r.lamp)))
        check(JSON.stringify(rows.map(r => r.size)) === JSON.stringify(['860 KB', '38.2 MB', '12.6 MB']), tag + ': sizes ' + JSON.stringify(rows.map(r => r.size)))
        // private fork (stage panel r8, owner 2026-10): 本卡 (green) packs start on, 全局 (blue) ones are listed but off.
        check(JSON.stringify(rows.map(r => r.checked)) === JSON.stringify([false, true, true]), tag + ': green on, global off by default ' + JSON.stringify(rows.map(r => r.checked)))
        check(rows.every(r => r.label === '一起导出 ' + r.name), tag + ': switch names ' + JSON.stringify(rows.map(r => r.label)))
        check(rows.every(r => r.gap >= 0 && r.gap <= 12), tag + ': switch right after 一起导出 ' + JSON.stringify(rows.map(r => r.gap)))
        check(rows.every(r => r.native === 'none'), tag + ': no native switch')
        // No box-in-box: the list rows carry no border box of their own.
        const boxed = await section.locator('.ap-export-packs, .ap-export-pack').evaluateAll(nodes => nodes.filter(n => { const s = getComputedStyle(n); return parseFloat(s.borderLeftWidth) > 0 || parseFloat(s.borderTopWidth) > 0 && parseFloat(s.borderBottomWidth) > 0 }).length)
        check(boxed === 0, tag + ': boxed pack rows ' + boxed)
        // Toggle 鹿目圆素材 off and tick 通用音效 (global) on: 导出卡 sends exactly those left on. // private fork (stage panel r8)
        await section.getByRole('switch', { name: '一起导出 通用音效' }).click()
        await section.getByRole('switch', { name: '一起导出 鹿目圆素材' }).click()
        check(await section.getByRole('switch', { name: '一起导出 鹿目圆素材' }).isChecked() === false, tag + ': toggles off')
        await paneShot('01b-export-one-off')
        await section.getByRole('button', { name: '导出卡' }).click()
        await page.waitForFunction(() => window.exports.length > 0)
        const sent = await page.evaluate(() => window.exports.at(-1))
        check(JSON.stringify(sent.packIds) === JSON.stringify(['44444444-4444-4444-8444-444444444444', '22222222-2222-4222-8222-222222222222']) && Object.keys(sent).sort().join() === 'expectedRevision,packIds,path', tag + ': export args ' + JSON.stringify(sent))
        await section.getByRole('switch', { name: '一起导出 鹿目圆素材' }).click()
        await section.getByRole('switch', { name: '一起导出 通用音效' }).click() // private fork (stage panel r8): back to the defaults
        await section.getByRole('button', { name: '导出卡' }).click(); await page.waitForFunction(n => window.exports.length > n, 1)
        const plain = await page.evaluate(() => window.exports.at(-1).packIds)
        check(JSON.stringify(plain) === JSON.stringify(['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222']), tag + ': default export = green packs ' + JSON.stringify(plain)) // private fork (stage panel r8)
      })
      // 4. 人物 ＋: same tile size as the avatars; creates a figure in a 绿灯 pack of the card and opens the figure editor.
      // private fork (stage panel r8): two green packs here → a menu of them; the no-green-pack path is step 4b (last).
      await step('cast add', async () => {
        await scrollTo('人物')
        if (before) return
        const cast = page.locator('.ap-cast'), tiles = cast.locator(':scope > li')
        const add = cast.getByRole('button', { name: '新建原创人物' })
        check(await add.count() === 1 && (await add.innerText()).trim() === '', tag + ': one unlabeled ＋ tile')
        const boxes = await tiles.evaluateAll(nodes => nodes.map(li => { const b = li.querySelector('button.ap-cast-row').getBoundingClientRect(), f = li.querySelector('.ap-cast-face').getBoundingClientRect(); return [Math.round(b.width), Math.round(b.height), Math.round(b.top), Math.round(f.top), Math.round(f.width), Math.round(f.height), li.querySelector('.ap-cast-add') ? 1 : 0] }))
        const last = boxes.at(-1), first = boxes[0]
        check(last[6] === 1 && boxes.length >= 2, tag + ': ＋ is the last tile')
        check(last[0] === first[0] && last[1] === first[1] && last[4] === first[4] && last[5] === first[5] && (last[2] !== first[2] || last[3] === first[3]), tag + ': ＋ matches the avatar tiles ' + JSON.stringify(boxes))
        const ring = await add.locator('.ap-cast-face > .ap-glyph').evaluate(n => { const s = getComputedStyle(n); return [s.borderTopStyle, Math.round(n.getBoundingClientRect().width)] })
        check(ring[0] === 'dashed' && ring[1] >= 48, tag + ': dashed circle ' + ring)
        await paneShot('03-cast-add')
        // private fork (stage panel r8, owner 2026-10): the card has two 绿灯 packs (鹿目圆素材, 通用素材) → the ＋ opens a menu of
        // them by name (the 全局 通用音效 is not offered); the pick gets the figure. No pack is created, nothing matched by name.
        const closeDialog = async () => { await page.keyboard.press('Escape'); await page.waitForTimeout(400)
          if (await page.getByRole('dialog').count()) { await page.getByRole('dialog').last().getByRole('button', { name: '关闭' }).first().click().catch(() => {}); await page.waitForTimeout(300) } }
        const binds = () => page.evaluate(() => window.calls.filter(([m]) => m === 'saveCardAssetBindings').length)
        const bindsBefore = await binds()
        check(await add.getAttribute('aria-haspopup') === 'menu', tag + ': ＋ is a menu trigger with several green packs')
        await add.click()
        const menu = page.getByRole('menu', { name: '新人物放进哪个素材包' }); await menu.waitFor({ timeout: 4000 })
        const items = await menu.getByRole('menuitem').allInnerTexts()
        check(JSON.stringify(items.map(s => s.trim())) === JSON.stringify(['鹿目圆素材', '通用素材']), tag + ': menu lists the green packs ' + JSON.stringify(items))
        check(await page.evaluate(() => document.activeElement?.getAttribute('role')) === 'menuitem', tag + ': keyboard lands in the menu')
        await page.screenshot({ path: path.join(outDir, `${prefix}03a-cast-add-menu-${theme}-${size}.png`) }); shots.push('03a')
        await page.keyboard.press('Escape'); await page.waitForTimeout(200)
        check(await menu.count() === 0 && (await page.evaluate(() => window.packCalls.length)) === 0, tag + ': Escape closes the menu, nothing written')
        await add.click(); await menu.getByRole('menuitem', { name: '鹿目圆素材' }).click()
        const dialog = page.getByRole('dialog').last(); await dialog.waitFor({ timeout: 8000 }); await page.waitForTimeout(600)
        const calls = await page.evaluate(() => window.packCalls)
        const figure = calls.find(([m]) => m === 'createFigure')
        check(!calls.some(([m]) => m === 'createPack') && await binds() === bindsBefore, tag + ': no pack created, no binding written ' + JSON.stringify(calls.map(c => c[0])))
        check(figure && figure[1].packId === '11111111-1111-4111-8111-111111111111' && typeof figure[1].expectedRevision === 'string' && figure[1].figure.name === '新人物', tag + ': createFigure in the picked pack with CAS ' + JSON.stringify(figure))
        check(await page.getByLabel('人物名称').count() > 0 && await page.getByLabel('人物名称').first().inputValue() === '新人物', tag + ': figure editor open on the new figure')
        await page.screenshot({ path: path.join(outDir, `${prefix}03b-cast-add-editor-${theme}-${size}.png`) }); shots.push('03b')
        await closeDialog()
        check(await cast.getByText('新人物', { exact: true }).count() === 1, tag + ': new figure in the row')
        await cast.getByRole('button', { name: '新建原创人物' }).click(); await menu.getByRole('menuitem', { name: '通用素材' }).click()
        await page.getByRole('dialog').last().waitFor(); await page.waitForTimeout(500)
        const again = (await page.evaluate(() => window.packCalls)).filter(([m]) => m === 'createFigure').at(-1)
        check(again[1].packId === '22222222-2222-4222-8222-222222222222' && again[1].figure.name === '新人物', tag + ': second pick goes to 通用素材 ' + JSON.stringify(again))
        await closeDialog()
      })
      // 6. 读音词典: no count; the dashed ＋ on its own line; 读音 runs to the row's end.
      await step('readings', async () => {
        await scrollTo('读音词典'); await paneShot('05-readings')
        if (before) return
        const section = page.locator('.ap-section', { has: page.getByRole('heading', { name: /^读音词典/ }) })
        check(await section.locator('.ap-section-head .ap-section-meta').count() === 0 && await section.locator('.ap-section-head h3 .ap-help-anchor, .ap-section-head h3 .fork-help-tip, .ap-section-head h3 button').count() > 0, tag + ': no count, (?) kept')
        const row = await section.locator('.ap-readings-row.is-new').boundingBox(), add = await section.getByRole('button', { name: '添加读音' }).boundingBox(), field = await section.locator('.ap-readings-row.is-new .ap-reading-field').nth(1).boundingBox()
        check(add.y >= row.y + row.height - 1, tag + ': ＋ below the add row')
        check(Math.abs(field.x + field.width - (row.x + row.width)) <= 2, tag + ': 读音 spans to the end ' + JSON.stringify([field, row]))
        check((await section.getByRole('button', { name: '添加读音' }).innerText()).trim() === '', tag + ': unlabeled ＋')
      })
      // private fork: the common roster names its covered figures, with no internal IDs.
      await step('roster scope', async () => {
        await scrollTo('提示词'); await paneShot('06-prompts')
        if (before) return
        const row = page.locator('.ap-prompt-row', { has: page.locator('.ap-prompt-name', { hasText: '人物差分 · 通用' }) })
        check(await row.count() === 1, tag + ': roster row present')
        const owner = row.locator('.ap-prompt-owner')
        // private fork: the full figure list is available in the tooltip when the source column truncates it.
        check(await owner.innerText() === '鹿目圆、店员 C' && await owner.getAttribute('title') === '鹿目圆、店员 C', tag + ': roster scope ' + await owner.innerText() + ' / ' + await owner.getAttribute('title'))
        check(await row.locator('.ap-prompt-actions button').count() === 0, tag + ': no pencil on the roster row')
      })
      // 3. Jumps.
      await step('jumps', async () => {
        if (before) return
        await scrollTo('读音词典'); await page.locator('.ap-section', { has: page.getByRole('heading', { name: /^读音词典/ }) }).getByRole('button', { name: '全局读音 ›' }).click()
        check((await page.evaluate(() => window.opened.at(-1)))?.[0] === 'tab', tag + ': 全局读音 opens the voice tab')
        await paneShot('02-readings')
      })
      // 4b. private fork (stage panel r8): a card without a 绿灯 pack — the ＋ creates a pack named after the card, lights it
      // green for this card (card CAS) and creates the figure there (pack CAS). Last step: it changes the card's bindings.
      await step('cast add none', async () => {
        if (before) return
        await page.evaluate(async () => { const card = await window.binding.rpc('getCardAssetBindings', {}); await window.binding.rpc('saveCardAssetBindings', { expectedRevision: card.revision, patch: { assetBindings: { ...card.extension.assetBindings, boundPackIds: [] } } }); window.showReal('r8-none' + Math.random()) })
        await page.getByRole('heading', { name: /^人物/ }).waitFor(); await page.waitForTimeout(900); await scrollTo('人物')
        const add = page.locator('.ap-cast').getByRole('button', { name: '新建原创人物' })
        check(await add.getAttribute('aria-haspopup') === null, tag + ': ＋ acts at once without green packs')
        const start = await page.evaluate(() => window.packCalls.length)
        await add.click(); await page.getByRole('dialog').last().waitFor({ timeout: 8000 }); await page.waitForTimeout(600)
        const calls = (await page.evaluate(() => window.packCalls)).slice(start)
        const created = calls.find(([m]) => m === 'createPack'), figure = calls.find(([m]) => m === 'createFigure')
        check(created && created[1].name === '鹿目圆的日常' && created[1].expectedRevision === null, tag + ': createPack named after the card ' + JSON.stringify(created))
        const bind = await page.evaluate(() => window.calls.filter(([m]) => m === 'saveCardAssetBindings').at(-1)?.[1])
        check(JSON.stringify(bind?.patch?.assetBindings?.boundPackIds) === JSON.stringify([created?.[2]]) && typeof bind.expectedRevision === 'string', tag + ': new pack lit green (card CAS) ' + JSON.stringify(bind?.patch))
        check(figure && figure[1].packId === created?.[2] && figure[1].expectedRevision === 'x1' && figure[1].figure.name === '新人物', tag + ': createFigure in the new pack with CAS ' + JSON.stringify(figure))
        await page.screenshot({ path: path.join(outDir, `${prefix}03c-cast-add-none-${theme}-${size}.png`) }); shots.push('03c')
      })
      await page.close()
    }
  } finally { await browser.close() }
  return { shots, errors }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const { shots, errors } = await run()
  console.log(shots.length + ' screenshots → ' + outDir)
  if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1 }
}
