// private fork (engine row, owner 2026-10): 舞台设置 › 基础设置 and the stage mode page over the in-page mock of
// card-centric-stage.mjs / stage-panel-r5.mjs (fake engine / judge RPCs, a real in-memory mod registry; no provider is ever
// called). Shoots the 基础设置 rows, the 模组 section, the 舞台模式 page and a mod page at 1600×900 (720px pane) and 375, dark
// and light, and checks:
// private fork (stage mode entry, owner 2026-10): no 「舞台引擎」 row or model menu on 基础设置 — 「舞台模式 ›」 opens the page,
// titled 舞台模式, whose 导演模型 menu is 跟随前台 (default) + the models (no 跟随后台). (one mod entry) a 模组 row opens the
// mod's page in place (‹ 舞台设置), no dialog and no 模组库 tab.
// private fork (judge key, owner 2026-10): 智能判断 is 「判断模型」 (no provider badge); 「API Key」 replaces 密钥名称 (a pasted key or
// a variable name, saved at once by the host: setJudgeKey); 测试连接 ends the row it tests and never wraps.
// 1. 基础设置 has 「舞台模式」 with its ›, no 舞台引擎 row and no separate 判断模型 row, in 基础 and 高级;
// 2. the sub-page: ‹ 舞台模式 (?), focus on the title; order 导演模型 → 判断模型 → 可用演出 → 每轮上限 (engine page r2: 对话主题 left the page); every
//    section has its (?); 判断模型 edits the page draft (提供方 fills 模型), API Key reads 已配置 · 环境变量 NAME, a pasted key reads
//    已配置 with 更换 / 清除; 测试连接 at the end of the API Key row; 保存 sends judge with the engine patch; Esc / ‹ return with
//    focus on the row's ›; 提示词 › 判断模型 ✎ opens the page at 判断模型;
// 3. the 模组 section never shows an internal (demo) mod; a row opens the mod page in place, Esc returns to the row's ›;
// 4. no native controls, no internal words, no label/value overlap, no horizontal scroll at 375.
// Usage: node tests/harness/engine-row.mjs [outDir] [--before]   (--before only shoots, for the old UI)
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { browserReactScript } from '../fixtures/browser-react.mjs'
import { forkThemeCss } from '../helpers/fork-theme-css.mjs'
import { stageSource, pageSetup, THEMES } from './card-centric-stage.mjs'
import { hostPieces, r5Setup } from './stage-panel-r5.mjs'
import { createEngineJudge, defaultJudgeConfig, validateJudgeConfig } from '../../tavern-plugin/lib/domain/engine-judge.js'
import { readFile } from 'node:fs/promises'
import { createModRegistry } from '../../tavern-plugin/lib/domain/mods/registry.js'
import { createModRpc } from '../../tavern-plugin/lib/fork-mod-rpc.js'

const root = fileURLToPath(new URL('../../', import.meta.url))
const args = process.argv.slice(2), before = args.includes('--before')
const outDir = args.find(a => !a.startsWith('--')) || path.join(root, '.tmp/engine-row')
const prefix = args.find(a => a.startsWith('--prefix='))?.slice(9) || (before ? 'before' : 'after')

// The shipped demo (internal: never listed) plus a listed copy of it.
async function modApi() {
  const demo = JSON.parse(await readFile(path.join(root, 'tavern-plugin/mods/demo/manifest.json'), 'utf8')), registry = createModRegistry()
  await registry.install({ manifest: demo, expectedRevision: registry.snapshot().revision })
  const { internal: _internal, ...ui } = demo.ui
  await registry.install({ manifest: { ...demo, id: 'test.visual', name: '演示模组', ui }, expectedRevision: registry.snapshot().revision })
  return createModRpc({ library: registry, authorize: () => true })
}

function judgePreview() {
  const config = validateJudgeConfig({ provider: 'jev' })
  const judge = createEngineJudge({ getConfig: () => config, credentials: () => null, fetch: async () => { throw new Error('no network in the harness') } })
  return JSON.parse(JSON.stringify(judge.preview({ material: '放学后的教室里，夕阳斜斜地照进来。', questions: [{ id: 'q0', text: '这条素材适合本轮剧情吗？【背景】放学后的教室' }] })))
}

function mockSetup({ judge, preview }) {
  Object.assign(window.engineValues, { directorModel: null, judge, dimensions: { 'scene': true, 'camera': true, 'cg': true, 'music': true, 'sfx': true, 'soundscape': true } })
  window.judgeCalls = []
  window.storedKeys = {}
  const base = window.binding.rpc
  window.binding.rpc = async (method, a) => {
    if (/Judge|Mod/.test(method)) throw new Error('Unknown field')
    if (method === 'getTavernSettings') return { modelCatalog: [{ provider: 'openai', providerName: 'OpenAI', models: [{ id: 'gpt-6-luna', name: 'GPT-6 Luna' }] }] }
    if (method === 'getAssetVoiceServices') return { services: [] }
    // The 模组 section lists first-party mods only for a card with an id.
    if (method === 'getCardAssetBindings') return { ...await base(method, a), cardId: 'card-madoka' }
    return base(method, a)
  }
  window.binding.engineRpc = async (method, a) => {
    if (/Judge/.test(method)) window.judgeCalls.push([method, JSON.parse(JSON.stringify(a ?? null))])
    if (method === 'getJudgeCredentialStatus') return window.storedKeys[a.provider] ? { configured: true, source: 'stored' } : a.keyName === 'TYPESAFE_API_KEY' ? { configured: true, source: 'env', keyName: a.keyName } : { configured: false, source: null }
    // Like the host: an existing variable name becomes the keyName reference; anything else is stored (and never returned).
    if (method === 'setJudgeKey') {
      if (a.value === 'TYPESAFE_API_KEY') { delete window.storedKeys[a.provider]; window.engineValues.judge = { ...window.engineValues.judge, keyName: a.value }; return { status: { configured: true, source: 'env', keyName: a.value }, settings: await window.binding.rpc('getAssetEngineSettings') } }
      if (a.value === null) delete window.storedKeys[a.provider]; else window.storedKeys[a.provider] = true
      return { status: a.value !== null ? { configured: true, source: 'stored' } : window.engineValues.judge.keyName === 'TYPESAFE_API_KEY' ? { configured: true, source: 'env', keyName: 'TYPESAFE_API_KEY' } : { configured: false, source: null } }
    }
    if (method === 'testJudgeConnection') { await new Promise(r => setTimeout(r, 200)); return a.config.provider === 'jev' ? { ok: true, latencyMs: 231 } : { ok: false, latencyMs: 12, error: { code: 'JUDGE_NO_KEY' } } }
    if (/Mod/.test(method)) return window.modRpc(method, a)
    return window.binding.rpc(method, a)
  }
  window.judgePreviewMode = 'none'
  const rpc = window.rpc
  window.rpc = async (method, a) => {
    const result = await rpc(method, a)
    return method === 'previewStageDirectorPrompt' && window.judgePreviewMode === 'full' ? { ...result, judge: preview } : result
  }
}

export async function run() {
  const { chromium } = await import('playwright')
  const { source, picker, playback } = await stageSource()
  const pieces = await hostPieces(), css = await forkThemeCss(), preview = judgePreview(), mods = await modApi()
  await mkdir(outDir, { recursive: true })
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  const shots = [], errors = []
  const check = (ok, message) => { if (!ok) errors.push(message) }
  try {
    for (const [theme, tokens] of Object.entries(THEMES)) for (const [size, viewport, pane] of [['1600x900', { width: 1600, height: 900 }, 720], ['375', { width: 375, height: 812 }, 0]]) {
      const page = await browser.newPage({ viewport, deviceScaleFactor: size === '375' ? 2 : 1 })
      const tag = theme + '/' + size
      page.on('pageerror', e => errors.push(tag + ': ' + e.message))
      await page.exposeFunction('modRpc', async (method, a) => { try { return { ok: await mods[method](a, { origin: 'http://stage.test' }) } } catch (e) { return { error: { code: e.code, message: e.message } } } })
      await page.addInitScript(() => { const call = window.modRpc; window.modRpc = async (m, a) => { const r = await call(m, a); if (r.error) throw Object.assign(new Error(r.error.message), r.error); return r.ok } })
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
      await page.evaluate(mockSetup, { judge: { ...defaultJudgeConfig(), provider: 'jev', model: 'jev-1.13.0', keyName: 'TYPESAFE_API_KEY' }, preview })
      const show = async () => { await page.evaluate(() => window.showReal('engine' + Math.random())); await page.getByRole('heading', { name: /^人物/ }).waitFor(); await page.waitForTimeout(500) }
      await show()
      const file = name => { const f = path.join(outDir, `${prefix}-${name}-${theme}-${size}.png`); shots.push(f); return f }
      const shot = async (locator, name) => { await page.waitForTimeout(250); await locator.screenshot({ path: file(name) }) }
      // A page taller than the viewport is shot whole: the viewport grows for the shot, then returns.
      const tall = async (locator, name) => { await page.setViewportSize({ width: viewport.width, height: 2600 }); await page.waitForTimeout(250); await locator.screenshot({ path: file(name) }); await page.setViewportSize(viewport) }
      const step = async (name, fn) => { try { await fn() } catch (e) { errors.push(tag + ' ' + name + ': ' + e.message.split('\n')[0]) } }
      const basic = page.locator('.ap-section').first(), engine = page.locator('.ap-engine')
      const overlaps = () => page.evaluate(() => [...document.querySelectorAll('.ap-engine .fork-inline-field')].filter(field => field.offsetParent).flatMap(field => {
        const label = field.querySelector(':scope > .fork-inline-label:not(.is-hidden) > .fork-inline-label-text'), value = field.querySelector(':scope > .fork-inline-value')
        if (!label || !value) return []
        const a = label.getBoundingClientRect(), b = value.firstElementChild?.getBoundingClientRect() || value.getBoundingClientRect()
        return a.right > b.left + 1 && a.top < b.bottom && b.top < a.bottom ? [label.textContent] : []
      }))
      const noHScroll = () => page.evaluate(() => { const pane = document.querySelector('.pane'); return pane.scrollWidth <= pane.clientWidth + 1 })
      const back = async () => { await page.getByRole('heading', { name: /^人物/ }).waitFor(); await page.waitForTimeout(300) }

      await step('rows', async () => {
        await shot(basic, 'basic')
        await shot(page.locator('.ap-widget-section'), 'mods')
        if (before) return
        const rows = await basic.locator('.ap-switch-row').evaluateAll(n => n.map(r => r.innerText.trim().split('\n')[0]))
        check(!rows.some(r => /舞台引擎/.test(r)) && await page.locator('.ap-model-row').count() === 0, tag + ': no 舞台引擎 row ' + rows.join(','))
        check(!rows.some(r => /智能判断|判断模型/.test(r)) && await page.locator('.ap-judge-row').count() === 0, tag + ': no 判断模型 row')
        check(await basic.getByRole('button', { name: '舞台模式设置', exact: true }).count() === 1, tag + ': 舞台模式 ›')
        check(await basic.getByRole('button', { name: /^模型：/ }).count() === 0, tag + ': no model menu on 基础设置')
        const modText = await page.locator('.ap-widget-section').innerText()
        check(!/框架演示/.test(modText) && /演示模组/.test(modText), tag + ': mods ' + JSON.stringify(modText))
        await show()
        check(await basic.getByRole('button', { name: '舞台模式设置', exact: true }).count() === 1, tag + ': 基础 mode has the ›')
        await show()
      })
      await step('page', async () => {
        await (before ? basic.locator('.ap-model-row .ap-kind-jump').first() : basic.getByRole('button', { name: '舞台模式设置', exact: true })).click(); await engine.waitFor(); await page.waitForTimeout(500)
        await tall(engine, 'engine')
        if (before) {
          await page.keyboard.press('Escape'); await back()
          const row = page.locator('.ap-judge-row')
          if (await row.count()) { await row.locator('.ap-kind-jump').click(); await page.locator('.ap-judge').waitFor(); await page.waitForTimeout(400); await page.locator('.ap-judge').screenshot({ path: file('judge') }); await page.keyboard.press('Escape'); await back() }
          return
        }
        check((await engine.locator('.ap-subhead-text').innerText()).trim() === '舞台模式', tag + ': title')
        check(await page.evaluate(() => document.activeElement?.classList.contains('ap-subhead-title')), tag + ': focus on the title')
        check(await page.getByRole('button', { name: '返回舞台设置' }).count() === 1, tag + ': ‹ back')
        const titles = await engine.locator('.ap-section-title').allInnerTexts()
        // private fork (engine page r2, owner 2026-10): no 对话主题 on the page and no 「更多」 fold; (global only) 可用演出 is here.
        check(JSON.stringify(titles) === JSON.stringify(['导演模型', '判断模型', '可用演出', '每轮上限']), tag + ': sections ' + titles.join(','))
        check(await engine.locator('.ap-section-head button[aria-label$="说明"]').count() === titles.length, tag + ': (?) per section')
        check(await engine.getByRole('button', { name: '模型：跟随前台', exact: true }).count() === 1, tag + ': model menu (unset = 跟随前台)')
        const judge = engine.locator('.ap-engine-judge')
        check(await judge.locator('.ap-section-meta').count() === 0, tag + ': no provider badge')
        await judge.locator('.ap-judge-key').waitFor()
        check((await judge.locator('.ap-judge-key').innerText()).trim() === '已配置 · 环境变量 TYPESAFE_API_KEY', tag + ': key status ' + await judge.locator('.ap-judge-key').innerText())
        await judge.getByRole('button', { name: '测试连接' }).click(); await judge.locator('.ap-judge-test-result.is-ok').waitFor()
        const labels = await judge.locator('.fork-inline-label-text').evaluateAll(n => n.filter(x => x.offsetParent).map(x => x.textContent))
        check(JSON.stringify(labels) === JSON.stringify(['提供方', '模型', 'API Key', '门槛', '每类上限', '超时', '附加说明']), tag + ': judge fields ' + labels.join(','))
        // 测试连接 (both) ends the row it tests on one line: the button sits inside its row's box and is one line high.
        const tests = await engine.locator('button.ap-engine-test').evaluateAll(n => n.map(b => { const row = b.closest('.fork-inline-field').getBoundingClientRect(), r = b.getBoundingClientRect(), label = b.closest('.fork-inline-field').querySelector('.fork-inline-label-text').textContent; return { label, inRow: r.top >= row.top - 1 && r.bottom <= row.bottom + 1 && (innerWidth <= 720 || r.top - row.top < 12), oneLine: r.height <= 37 } }))
        check(tests.length === 2 && JSON.stringify(tests.map(x => x.label)) === JSON.stringify(['模型', 'API Key']) && tests.every(x => x.inRow && x.oneLine), tag + ': 测试连接 ' + JSON.stringify(tests))
        await tall(engine, 'engine-judge-open')
        // A pasted key: masked while typing, then 「已配置」 with 更换 / 清除; the value never comes back.
        await judge.getByRole('button', { name: '更换', exact: true }).click()
        const box = judge.getByLabel('API Key', { exact: true })
        check(await box.getAttribute('type') === 'password', tag + ': masked input')
        await box.fill('sk-harness-0123456789'); await box.press('Enter'); await page.waitForTimeout(300)
        check((await judge.locator('.ap-judge-key').innerText()).trim() === '已配置', tag + ': stored key status')
        check(await judge.getByRole('button', { name: '清除', exact: true }).count() === 1 && await judge.getByRole('button', { name: '更换', exact: true }).count() === 1, tag + ': 更换 / 清除')
        check(!(await engine.innerHTML()).includes('sk-harness'), tag + ': key not in the page')
        await shot(judge, 'judge-key-stored')
        await judge.getByRole('button', { name: '清除', exact: true }).click(); await page.waitForTimeout(300)
        check((await judge.locator('.ap-judge-key').innerText()).trim() === '已配置 · 环境变量 TYPESAFE_API_KEY', tag + ': cleared back to the env reference')
        await judge.getByRole('button', { name: '更换', exact: true }).click(); await shot(judge, 'judge-key-edit')
        await judge.getByRole('button', { name: '取消', exact: true }).click()
        const overlap = await overlaps(); check(!overlap.length, tag + ': overlaps ' + overlap.join(' | '))
        check(await noHScroll(), tag + ': horizontal scroll')
        check(await engine.locator('select, input[type=checkbox], input[type=range], input[type=number]').count() === 0, tag + ': native controls')
        check(!/\bunset\b|openai-compatible|JUDGE_|capPerKind|timeoutMs|directorModel|Decisions/.test(await engine.innerText()), tag + ': internal words shown')
        // A provider change is part of the page draft; one 保存 sends it with the engine patch.
        await judge.getByRole('button', { name: /^提供方：/ }).click(); await page.getByRole('menuitemradio', { name: 'OpenAI', exact: true }).click(); await page.waitForTimeout(200)
        check(await judge.getByRole('textbox', { name: '模型', exact: true }).inputValue() === 'gpt-6-luna', tag + ': provider fills the model')
        check(/有未保存的修改/.test(await engine.locator('.ap-engine-foot').innerText()), tag + ': dirty')
        await page.keyboard.press('Escape'); await page.waitForTimeout(200)
        check(await engine.count() === 1, tag + ': Esc keeps an unsaved draft')
        await engine.getByRole('button', { name: '保存', exact: true }).click(); await page.waitForTimeout(400)
        const saved = await page.evaluate(() => window.engineSaves.at(-1)?.patch?.judge)
        check(saved?.provider === 'openai' && saved.keyName === 'OPENAI_API_KEY', tag + ': saved judge ' + JSON.stringify(saved))
        // The model menu saves at once and keeps the rest of the draft.
        await engine.getByRole('button', { name: '模型：跟随前台', exact: true }).click()
        const options = await page.locator('.fork-inline-pop .fork-inline-option').allInnerTexts()
        check(JSON.stringify(options.map(o => o.trim())) === JSON.stringify(['跟随前台', 'GPT-6 Luna']), tag + ': options ' + JSON.stringify(options))
        await page.getByRole('menuitemradio', { name: 'GPT-6 Luna' }).click(); await page.waitForTimeout(300)
        check(JSON.stringify(await page.evaluate(() => window.engineValues.directorModel)) === JSON.stringify({ provider: 'openai', model: 'gpt-6-luna' }), tag + ': model saved')
        await engine.getByRole('button', { name: /^模型：GPT-6 Luna/ }).click(); await page.getByRole('menuitemradio', { name: '跟随前台' }).click(); await page.waitForTimeout(300)
        check(await page.evaluate(() => window.engineValues.directorModel) === null, tag + ': 跟随前台 saves null')
        await engine.locator('.ap-subhead-title').focus(); await page.keyboard.press('Escape'); await back()
        check(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')) === '舞台模式设置', tag + ': Esc back, focus on the 舞台模式 ›')
        // reset for the other runs
        await page.evaluate(() => { window.engineValues.directorModel = null })
      })
      await step('prompt ✎', async () => {
        if (before) return
        await page.evaluate(() => { window.judgePreviewMode = 'full' }); await show()
        const pane = page.locator('.pane'); await page.evaluate(() => { const p = document.querySelector('.pane'), el = document.querySelector('.ap-prompt-section'); if (el) p.scrollTop += el.getBoundingClientRect().top })
        const group = page.locator('ul[aria-label=判断模型请求]'); await group.waitFor()
        await group.getByRole('button', { name: '编辑判断模型' }).click(); await engine.waitFor(); await page.waitForTimeout(500)
        const at = await page.evaluate(() => { const s = document.querySelector('.ap-engine-judge'); const r = s.getBoundingClientRect(), p = document.querySelector('.pane').getBoundingClientRect(); return { top: r.top - p.top, expanded: s.querySelector('.ap-section-toggle').getAttribute('aria-expanded'), focus: document.activeElement === s.querySelector('.ap-section-toggle') } })
        check(at.expanded === 'true' && at.top >= -2 && at.top < 200 && at.focus, tag + ': ✎ opens at 判断模型 ' + JSON.stringify(at))
        await shot(pane, 'engine-from-prompt')
        await page.getByRole('button', { name: '返回舞台设置' }).click(); await back()
        await page.evaluate(() => { window.judgePreviewMode = 'none' })
      })
      await step('mod page', async () => {
        if (before) return
        await page.locator('.ap-widget-section').getByRole('button', { name: '演示模组 设置', exact: true }).click()
        const detail = page.locator('.ap-mod-detail'); await detail.waitFor(); await page.waitForTimeout(500)
        check(await page.getByRole('dialog').count() === 0, tag + ': mod page is not a dialog')
        check(await page.getByRole('button', { name: '返回舞台设置' }).count() === 1, tag + ': ‹ 舞台设置')
        check(await noHScroll(), tag + ': mod page horizontal scroll')
        await tall(page.locator('.ap-stage-page'), 'mod-page')
        await page.locator('.ap-subhead-back').focus(); await page.keyboard.press('Escape'); await back()
        check(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')) === '演示模组 设置', tag + ': Esc back, focus on the mod row ›')
      })
      await step('375', async () => { check(await noHScroll(), tag + ': page horizontal scroll') })
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
