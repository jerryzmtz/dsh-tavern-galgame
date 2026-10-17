// private fork (engine settings redesign, owner 2026-10): 引擎设置 — the real page (reached from 舞台设置 › 基础设置 ›
// 引擎设置, engine ui r2) in a host-shaped side pane over the in-page mock of card-centric-stage.mjs, with engine values built from the
// real defaults (private fork, owner 2026-10: no vector recall any more). Shoots the whole page at 1600×900 (720px
// pane) and 375, dark and light, and (unless --before) checks:
// 1. every 「label value」 row keeps its value clear of its label (no overlap) on this page and on the card page;
// 2. no internal ids (pack UUIDs, bare kind ids, English dimension keys, phase / code words) are shown;
// 3. sections 导演模型 → 智能判断 → 可用演出 → 每轮上限 → 配音服务 (对话主题 removed, engine page r2); 可用演出 (global only, the one
//    director command setting, CG included) folds each group to a state line, a chip saves at once;
// 4. no native checkboxes / selects, no fieldsets; no ⚠ while nothing is wrong;
// 5. the entry is the one 「引擎设置 ›」 row of 基础设置 (no 全局设置 section); private fork (engine row, owner 2026-10): the row and
//    the page are 「舞台引擎」, sections 模型 → 智能判断 → 可用演出 → 每轮上限 → 对话主题 → 配音服务.
// Usage: node tests/harness/engine-settings.mjs [outDir] [--before]
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { browserReactScript } from '../fixtures/browser-react.mjs'
import { forkThemeCss } from '../helpers/fork-theme-css.mjs'
import { stageSource, pageSetup, THEMES } from './card-centric-stage.mjs'
import { defaultAssetEngineSettings } from '../../tavern-plugin/lib/domain/asset-engine-settings.js'

const root = fileURLToPath(new URL('../../', import.meta.url))
const args = process.argv.slice(2), before = args.includes('--before')
const outDir = args.find(a => !a.startsWith('--')) || path.join(root, '.tmp/engine-settings')

function engineSetup(defaults) {
  const values = JSON.parse(JSON.stringify(defaults))
  values.directionStyles = [
    { format: 'dsh-direction-style', schemaVersion: 1, id: 'galgame', name: 'Galgame 演出', rules: [{ id: 'main', requires: ['scene'], text: '告白、重逢这类情绪高点用近景和转场。' }] },
    { format: 'dsh-direction-style', schemaVersion: 1, id: 'film', name: '电影感', rules: [{ id: 'main', requires: ['camera'], text: '多用镜头语言：推拉、景深。' }] }]
  values.directionStyle = 'galgame'
  values.dimensions = { ...values.dimensions, weather: false, dof: false }
  window.engineValues = values
  window.engineSaves = []
  // The shared mock's entries carry no recall; an opened entry needs one (触发策略).
  const service = window.binding.service, list = service.listPackSummaries, snapshot = service.getPackSnapshot
  const fill = pack => { for (const asset of pack?.manifest?.assets || []) asset.recall ||= { mode: 'keyword', keywords: [] }; for (const figure of Object.values(pack?.figures || {})) figure.recall ||= { mode: 'keyword', keywords: [] }; return pack }
  service.listPackSummaries = async () => (await list()).map(fill); service.getPackSnapshot = async a => fill(await snapshot(a))
  const base = window.engineBase ||= window.binding.rpc
  window.binding.rpc = async (method, a) => {
    if (method === 'getAssetEngineSettings') return { values: JSON.parse(JSON.stringify(window.engineValues)), revision: 'e' + window.engineSaves.length, writable: true }
    if (method === 'saveAssetEngineSettings') {
      window.engineSaves.push(JSON.parse(JSON.stringify(a)))
      const patch = JSON.parse(JSON.stringify(a.patch))
      for (const key of ['dimensions', 'actionCaps']) if (patch[key]) patch[key] = { ...window.engineValues[key], ...patch[key] }
      Object.assign(window.engineValues, patch)
      return { values: JSON.parse(JSON.stringify(window.engineValues)), revision: 'e' + window.engineSaves.length, writable: true }
    }
    // private fork (settings polish): the host's model list (getTavernSettings → modelCatalog) for 导演模型 › 自定义.
    if (method === 'getTavernSettings') return { settings: {}, modelCatalog: [{ provider: 'deepseek', providerName: 'DeepSeek', models: [{ id: 'deepseek-chat', name: 'DeepSeek V3.2' }, { id: 'deepseek-reasoner', name: 'DeepSeek R1' }] }, { provider: 'nien', providerName: 'NienRouter', models: [{ id: 'opus', name: 'Claude Opus 5.5' }] }] }
    if (method === 'getAssetVoiceServices') return { services: [
      { id: 'fish', kind: 'fish-audio', capabilities: { paid: true } }, { id: 'fish-backup', kind: 'fish-audio', capabilities: { paid: true } },
      { id: 'qwen', kind: 'qwen', capabilities: { paid: true } }, { id: 'local', kind: 'reference-api', capabilities: { localEngine: true } }] }
    return base(method, a)
  }
}

export async function run() {
  const { chromium } = await import('playwright')
  const { source, picker, playback } = await stageSource()
  const css = await forkThemeCss(), defaults = defaultAssetEngineSettings()
  await mkdir(outDir, { recursive: true })
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  const shots = [], errors = []
  const check = (ok, message) => { if (!ok) errors.push(message) }
  try {
    for (const [theme, tokens] of Object.entries(THEMES)) for (const [size, viewport, pane] of [['1600x900', { width: 1600, height: 900 }, 720], ['375', { width: 375, height: 812 }, 0]]) {
      const page = await browser.newPage({ viewport, deviceScaleFactor: size === '375' ? 2 : 1 })
      const tag = theme + '/' + size
      page.on('pageerror', e => errors.push(tag + ': ' + e.message))
      await page.route('http://stage.test/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"></head><body class="dsh-tavern-shell-active"><div class="host"><main class="chat"></main><section class="pane" data-sidebar-right-panel><div id="panel"></div></section></div></body></html>' }))
      await page.goto('http://stage.test/')
      await page.addStyleTag({ content: css + `
        html, body { margin: 0; } body { ${tokens} background: var(--page); font-family: "Microsoft YaHei UI", "PingFang SC", sans-serif; }
        .host { display: flex; min-height: 100vh; } .chat { flex: 1; background: var(--page); }
        .pane { width: ${pane ? pane + 'px' : '100%'}; flex: none; border-left: 1px solid var(--fork-hairline); background: ${theme === 'dark' ? '#0b0b0c' : '#d4d8de'}; container-type: inline-size; }
        #panel { display: flex; flex-direction: column; min-height: 100vh; }
        ${pane ? '' : '.chat { display: none; }'}` })
      await page.evaluate(context => { document.body.dataset.fkContext = context }, 'chat-' + theme)
      await page.addScriptTag({ content: await browserReactScript() + ';window.React=modules.react;window.ReactDOM={...modules["react-dom/client"],createPortal:modules["react-dom"].createPortal};' + playback + source + picker })
      await page.evaluate(pageSetup)
      await page.evaluate(engineSetup, defaults)
      await page.evaluate(() => { window.scenario('main'); window.show('engine' + Math.random()) })
      await page.getByRole('heading', { name: /^人物/ }).waitFor(); await page.waitForTimeout(500)
      const shot = async name => { const file = path.join(outDir, `${name}-${theme}-${size}.png`); await page.waitForTimeout(300); await page.locator('.pane').screenshot({ path: file }); shots.push(file) }
      const step = async (name, fn) => { try { await fn() } catch (e) { errors.push(tag + ' ' + name + ': ' + e.message.split('\n')[0]) } }
      // Rows whose label runs into the value: the label's right edge past the value's left edge on the same line.
      const overlaps = scope => page.evaluate(scope => [...document.querySelectorAll(scope + ' .fork-inline-field')].filter(field => field.offsetParent).flatMap(field => {
        const label = field.querySelector(':scope > .fork-inline-label:not(.is-hidden) > .fork-inline-label-text'), value = field.querySelector(':scope > .fork-inline-value')
        if (!label || !value) return []
        const a = label.getBoundingClientRect(), b = value.firstElementChild?.getBoundingClientRect() || value.getBoundingClientRect()
        return a.right > b.left + 1 && a.top < b.bottom && b.top < a.bottom ? [label.textContent + ' ↔ ' + (value.textContent || '').slice(0, 30)] : []
      }), scope)

      // private fork (engine ui r2): the entry is the last 基础设置 row (高级), the only one; the card's 导演指令 now lives in
      // 提示词 (prompt view complete), so the old card-dimensions step is gone.
      await step('entry', async () => {
        const basic = page.locator('.ap-section').first()
        check(await page.getByRole('button', { name: /^舞台引擎/ }).count() === 1, tag + ': one 舞台引擎 entry')
        check(await basic.getByRole('button', { name: /^舞台引擎/ }).count() === 1, tag + ': the entry is a 基础设置 row')
        check(!(await page.getByRole('heading', { name: /^全局设置/ }).count()), tag + ': no 全局设置 section')
        if (!before) { const file = path.join(outDir, `stage-basic-${theme}-${size}.png`); await basic.screenshot({ path: file }); shots.push(file) }
      })
      // The overlap fix is the shared inline field: sweep the pack modal too (an entry, a figure, its voice page).
      if (!before) await step('other pages', async () => {
        await page.locator('.ap-pack-list').getByRole('button', { name: /通用素材/ }).first().click(); const modal = page.getByRole('dialog').last(); await modal.waitFor(); await page.waitForTimeout(400)
        const sweep = async name => { const overlap = await overlaps('.ap-modal'); check(!overlap.length, tag + ': ' + name + ' overlaps ' + overlap.join(' | ')) }
        for (const kind of ['音乐', '背景', '音效']) { const tab = modal.getByRole('tab', { name: kind }).first(); if (await tab.count()) { await tab.click(); await page.waitForTimeout(150); const item = modal.locator('.ap-item').first(); if (await item.count()) { await item.click(); await page.waitForTimeout(250) } await sweep(kind) } }
        const figures = modal.getByRole('tab', { name: '人物' }).first(); if (await figures.count()) { await figures.click(); await page.waitForTimeout(150); await modal.locator('.ap-item').first().click(); await page.waitForTimeout(400); await sweep('人物')
          const file = path.join(outDir, `figure-basics-${theme}-${size}.png`); await page.screenshot({ path: file }); shots.push(file) }
      })
      if (!before) { await page.evaluate(() => window.show('engine' + Math.random())); await page.getByRole('heading', { name: /^人物/ }).waitFor(); await page.waitForTimeout(300) }
      await page.getByRole('button', { name: /^舞台引擎/ }).first().click()
      await page.getByRole('button', { name: before ? '‹ 舞台设置' : '返回舞台设置' }).waitFor(); await page.waitForTimeout(600) // private fork (settings polish): the sub-page ‹
      if (!before) check(await page.evaluate(() => document.activeElement?.classList.contains('ap-subhead-title')), tag + ': focus lands on the title')
      await shot('engine-page')

      if (!before) await step('structure', async () => {
        const body = page.locator('.ap-engine')
        const text = await body.innerText()
        const headings = await body.locator('.ap-section-head h3 .ap-section-title').allInnerTexts()
        // private fork (engine page r2, owner 2026-10): no 对话主题 on 舞台引擎 and no 「更多」 fold. private fork (global only,
        // owner 2026-10): 可用演出 is back — the one director command setting.
        check(JSON.stringify(headings) === JSON.stringify(['导演模型', '智能判断', '可用演出', '每轮上限', '配音服务']), tag + ': sections ' + headings.join(' / '))
        check(!/[0-9a-f]{8}-[0-9a-f]{4}-/.test(text), tag + ': internal pack id shown')
        check(!/\b(focus|ready|fallback|indexing|backgrounds|performances|skins|fish-audio|reference-api)\b/.test(text), tag + ': internal words shown')
        check(!/\d+ B\b/.test(text), tag + ': raw byte size shown')
        check(!/绿灯语义补位|Embedding 提供方|补齐目标|允许替换同 ID|智能匹配|向量|每类补到|重建索引|全局默认/.test(text), tag + ': retired labels ' + (text.match(/绿灯语义补位|Embedding 提供方|补齐目标|允许替换同 ID|智能匹配|向量|每类补到|重建索引|全局默认/g) || []).join(','))
        check(await body.locator('.ap-hint-mark').count() === 0, tag + ': no ⚠ while nothing is wrong — ' + await body.locator('.ap-hint-mark').count())
        check(await body.locator('fieldset, legend, select, input[type=checkbox]:not([role=switch])').count() === 0, tag + ': native controls or fieldsets')
        check(await body.locator('input[type=file]').count() === 0 && !/对话主题|导入主题/.test(text), tag + ': no theme import here')
        const overlap = await overlaps('.ap-engine'); check(!overlap.length, tag + ': engine overlaps ' + overlap.join(' | '))
        const groups = await body.locator('.ap-engine-commands .ap-engine-group-name').allInnerTexts()
        check(JSON.stringify(groups) === JSON.stringify(['场景与转场', '镜头', '人物', '效果', 'CG']), tag + ': command groups ' + groups.join(' / '))
        const states = await body.locator('.ap-engine-commands .ap-engine-group-state').allInnerTexts()
        check(states[0] === '部分 4/5' && states[1] === '部分 2/3' && states[4] === '全部', tag + ': group states ' + states.join(' / '))
        check((await body.locator('.ap-engine-commands .ap-section-meta').innerText()).trim() === '16 / 18', tag + ': 16 / 18')
        check(await body.locator('.ap-dim-chip:visible').count() === 0, tag + ': chips folded by default')
        // The caret sits right after the title (StageSection), the group value underlines on hover.
        const caret = await body.locator('.ap-engine-commands .ap-section-head').evaluate(head => { const t = head.querySelector('.ap-section-title').getBoundingClientRect(), c = head.querySelector('.ap-section-chevron').getBoundingClientRect(); return c.left - t.right })
        check(caret >= 0 && caret < 60, tag + ': caret after the title ' + caret)
        await body.getByRole('button', { name: /^场景与转场/ }).hover(); await page.waitForTimeout(150)
        const line = await body.locator('.ap-engine-group-value').first().evaluate(n => getComputedStyle(n).borderBottomColor)
        check(!/rgba\(0, 0, 0, 0\)|transparent/.test(line), tag + ': hover underline ' + line)
        // A chip saves the global value at once (its group unfolds first).
        await body.getByRole('button', { name: /^场景与转场/ }).click(); await page.waitForTimeout(150)
        await shot('engine-page-unfolded')
        const saves = await page.evaluate(() => window.engineSaves.length)
        await body.getByRole('checkbox', { name: '天气' }).click(); await page.waitForFunction(n => window.engineSaves.length > n, saves)
        check(JSON.stringify(await page.evaluate(() => window.engineSaves.at(-1).patch)) === JSON.stringify({ dimensions: { weather: true } }), tag + ': chip patch')
      })
      // private fork (settings polish, owner 2026-10): one sub-page header (‹ on the title's row, no breadcrumb line); 导演模型 is
      // 跟随前台 / 跟随后台 / 自定义 (default 跟随后台), 自定义 lists the host's models by provider and saves {provider, model}; Esc and
      // ‹ return to 舞台设置 with the focus on the 引擎设置 row.
      if (!before) await step('subpage', async () => {
        const geo = await page.evaluate(() => { const r = s => document.querySelector(s)?.getBoundingClientRect(); const b = r('.ap-engine > .ap-subhead > .ap-subhead-back'), t = r('.ap-engine > .ap-subhead > .ap-subhead-title'); return b && t && { sameRow: Math.abs((b.top + b.bottom) / 2 - (t.top + t.bottom) / 2) < 3, leftOf: b.right <= t.left + 1, gap: t.left - b.right, crumbs: document.querySelectorAll('.ap-stage button.ap-back').length } })
        check(geo && geo.sameRow && geo.leftOf && geo.gap < 10 && geo.crumbs === 0, tag + ': subpage head ' + JSON.stringify(geo))
        // 舞台模型 lives in 基础设置 now (both modes): one grouped menu, a pick saves at once.
        check(!(await page.locator('.ap-engine').getByText('导演模型').count()), tag + ': no 导演模型 section on the engine page')
        await page.getByRole('button', { name: '返回舞台设置' }).click(); await page.getByRole('heading', { name: /^人物/ }).waitFor(); await page.waitForTimeout(300)
        const menu = page.getByRole('button', { name: /^模型：/ })
        check(await menu.innerText() === '跟随后台', tag + ': unset reads 跟随后台 — ' + await menu.innerText())
        const row = await page.evaluate(() => { const r = s => document.querySelector(s)?.getBoundingClientRect(); const row = r('.ap-model-row'), name = r('.ap-model-row .ap-switch-name'), jump = r('.ap-model-row .ap-kind-jump'), value = r('.ap-model-row-value'); return { right: Math.round(row.right - value.right), jumpAfterName: jump.left >= name.right - 1 && jump.left - name.right < 12 } })
        check(row.right <= 2 && row.jumpAfterName, tag + ': › right after the name, menu right-aligned ' + JSON.stringify(row))
        await menu.click(); await page.waitForTimeout(250)
        check(JSON.stringify(await page.locator('.fork-inline-pop .fork-inline-option').allInnerTexts()) === JSON.stringify(['跟随前台', '跟随后台', 'DeepSeek V3.2', 'DeepSeek R1', 'Claude Opus 5.5']), tag + ': options ' + (await page.locator('.fork-inline-pop .fork-inline-option').allInnerTexts()).join(' / '))
        check(JSON.stringify(await page.locator('.fork-inline-pop .fork-inline-group').allInnerTexts()) === JSON.stringify(['DeepSeek', 'NienRouter']), tag + ': provider groups')
        await shot('stage-model-menu')
        const saved = await page.evaluate(() => window.engineSaves.length)
        await page.getByRole('menuitemradio', { name: 'Claude Opus 5.5' }).click(); await page.waitForFunction(n => window.engineSaves.length > n, saved)
        check(JSON.stringify(await page.evaluate(() => window.engineSaves.at(-1).patch)) === JSON.stringify({ directorModel: { provider: 'nien', model: 'opus' } }), tag + ': saved at once')
        await page.waitForTimeout(200); check(await menu.innerText() === 'Claude Opus 5.5', tag + ': the chosen model shows its name')
        await shot('stage-model-chosen')
        await page.evaluate(() => window.show('basic' + Math.random())); await page.getByRole('heading', { name: /^人物/ }).waitFor(); await page.waitForTimeout(300)
        check(await page.getByRole('button', { name: /^模型：/ }).count() === 1, tag + ': 舞台模型 in 基础 mode too')
        await page.getByRole('button', { name: /^舞台引擎/ }).first().click(); await page.getByRole('button', { name: '返回舞台设置' }).waitFor(); await page.waitForTimeout(300)
        await page.locator('.ap-subhead-title').focus(); await page.keyboard.press('Escape'); await page.getByRole('heading', { name: /^人物/ }).waitFor(); await page.waitForTimeout(300)
        check(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')) === '舞台引擎', tag + ': Esc returns with focus on the 舞台引擎 ›')
        await page.getByRole('button', { name: /^舞台引擎/ }).first().click(); await page.getByRole('button', { name: '返回舞台设置' }).click(); await page.getByRole('heading', { name: /^人物/ }).waitFor()
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
