// private fork (engine row, owner 2026-10): 智能判断 is now the 「智能判断」 section of 舞台设置 › 基础设置 › 舞台引擎 (no row or
// sub-page of its own; saved with that page's draft) — steps 1–2 below check it there; tests/harness/engine-row.mjs covers the row.
// private fork (judge ui, owner 2026-10): 舞台设置 › 智能判断 and 提示词 › 智能判断 over the in-page mock of
// card-centric-stage.mjs / stage-panel-r5.mjs, with fake judge RPCs (no provider is ever called) and a real preview body
// built by createEngineJudge. Shoots 1600×900 (720px pane) and 375, dark and light, and checks:
// 1. 高级 › 基础设置 has one 「智能判断 ›」 row right after 舞台模型, its state in words (未设置 → OpenAI after a save);
// 2. the sub-page: ‹ header with (?) and focus on the title, Esc back; 提供方 fills model + key name; the key shows only
//    已配置 / 未配置 (never a value); 测试连接 shows latency + ok / a short error inline; 更多 folds 阈值 / 每类上限 / 超时 /
//    前置说明; a compatible endpoint without its URL cannot be saved; 保存 sends exactly the contract config;
// 3. no native controls, no internal ids, no label/value overlap;
// 4. 提示词 › 智能判断: absent without `judge`, one muted line for requests: [], else one row per batch whose body is the
//    sent text verbatim, source right-aligned, ✎ right after the name opening the sub-page.
// Usage: node tests/harness/judge-ui.mjs [outDir]
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { browserReactScript } from '../fixtures/browser-react.mjs'
import { forkThemeCss } from '../helpers/fork-theme-css.mjs'
import { stageSource, pageSetup, THEMES } from './card-centric-stage.mjs'
import { hostPieces, r5Setup } from './stage-panel-r5.mjs'
import { createEngineJudge, defaultJudgeConfig, validateJudgeConfig } from '../../tavern-plugin/lib/domain/engine-judge.js'

const root = fileURLToPath(new URL('../../', import.meta.url))
const outDir = process.argv.slice(2).find(a => !a.startsWith('--')) || path.join(root, '.tmp/judge-ui')

function judgePreview() {
  const config = validateJudgeConfig({ provider: 'jev' })
  const judge = createEngineJudge({ getConfig: () => config, credentials: () => null, fetch: async () => { throw new Error('no network in the harness') } })
  const questions = [['backgrounds', '放学后的教室', '夕阳斜照，课桌整齐'], ['music', '放学路上', '轻快的钢琴'], ['sfx', '门铃', ''], ['outfits', '睡衣', '在家休息时']]
    .map(([kind, title, use], i) => ({ id: 'q' + i, text: `这条素材适合本轮剧情吗？【${{ backgrounds: '背景', music: '音乐', sfx: '音效', outfits: '服装' }[kind]}】${title}；使用情景：${use}` }))
  return JSON.parse(JSON.stringify(judge.preview({ material: '放学后的教室里，夕阳斜斜地照进来。\n\n她把书包放在桌上，回头笑了笑。', questions })))
}

function judgeSetup({ defaults, preview }) {
  window.engineValues.judge = defaults
  window.judgeCalls = []
  // The judge RPCs go out without the session (binding.engineRpc); through the session RPC they would be refused.
  const base = window.binding.rpc
  window.binding.rpc = async (method, a) => {
    if (/Judge/.test(method)) throw new Error('Unknown field')
    if (method === 'getTavernSettings') return { modelCatalog: [] }
    if (method === 'getAssetVoiceServices') return { services: [] }
    return base(method, a)
  }
  window.binding.engineRpc = async (method, a) => {
    if (/Judge/.test(method)) window.judgeCalls.push([method, JSON.parse(JSON.stringify(a ?? null))])
    if (method === 'getJudgeConfig') return { config: JSON.parse(JSON.stringify(window.engineValues.judge)), revision: 'e' + window.engineSaves.length, writable: true }
    if (method === 'saveJudgeConfig') { window.engineSaves.push({ patch: { judge: a.config } }); window.engineValues.judge = JSON.parse(JSON.stringify(a.config)); return { config: JSON.parse(JSON.stringify(a.config)), revision: 'e' + window.engineSaves.length, writable: true } }
    if (method === 'getJudgeCredentialStatus') return a.keyName === 'TYPESAFE_API_KEY' ? { configured: true, source: 'env' } : { configured: false, source: null }
    if (method === 'testJudgeConnection') { await new Promise(r => setTimeout(r, 250)); if (a.config.provider === 'jev') return { ok: true, latencyMs: 231 }; throw Object.assign(new Error('JUDGE_NO_KEY'), { code: 'JUDGE_NO_KEY' }) } // the host rpc rejects a failed test (code as message)
    return base(method, a)
  }
  window.judgePreviewMode = 'none'
  const rpc = window.rpc
  window.rpc = async (method, a) => {
    const result = await rpc(method, a)
    if (method !== 'previewStageDirectorPrompt' || window.judgePreviewMode === 'none') return result
    return { ...result, judge: window.judgePreviewMode === 'empty' ? { ...preview, requests: [] } : preview }
  }
}

export async function run() {
  const { chromium } = await import('playwright')
  const { source, picker, playback } = await stageSource()
  const pieces = await hostPieces(), css = await forkThemeCss(), preview = judgePreview()
  await mkdir(outDir, { recursive: true })
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  const shots = [], errors = []
  const check = (ok, message) => { if (!ok) errors.push(message) }
  try {
    for (const [theme, tokens] of Object.entries(THEMES).filter(([t]) => !process.env.JUDGE_UI_THEME || t === process.env.JUDGE_UI_THEME)) for (const [size, viewport, pane] of [['1600x900', { width: 1600, height: 900 }, 720], ['375', { width: 375, height: 812 }, 0]]) {
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
      await page.evaluate(judgeSetup, { defaults: defaultJudgeConfig(), preview })
      const show = async () => { await page.evaluate(() => window.showReal('judge' + Math.random())); await page.getByRole('heading', { name: /^人物/ }).waitFor(); await page.waitForTimeout(500) }
      await show()
      const paneShot = async name => { const file = path.join(outDir, `${name}-${theme}-${size}.png`); await page.waitForTimeout(250); await page.locator('.pane').screenshot({ path: file }); shots.push(file) }
      const scrollTo = async (selector, offset = 12) => page.evaluate(([selector, offset]) => { const pane = document.querySelector('.pane'), el = document.querySelector(selector); if (el) pane.scrollTop += el.getBoundingClientRect().top - offset }, [selector, offset])
      const step = async (name, fn) => { try { await fn() } catch (e) { errors.push(tag + ' ' + name + ': ' + e.message.split('\n')[0]) } }
      const overlaps = scope => page.evaluate(scope => [...document.querySelectorAll(scope + ' .fork-inline-field')].filter(field => field.offsetParent).flatMap(field => {
        const label = field.querySelector(':scope > .fork-inline-label:not(.is-hidden) > .fork-inline-label-text'), value = field.querySelector(':scope > .fork-inline-value')
        if (!label || !value) return []
        const a = label.getBoundingClientRect(), b = value.firstElementChild?.getBoundingClientRect() || value.getBoundingClientRect()
        return a.right > b.left + 1 && a.top < b.bottom && b.top < a.bottom ? [label.textContent] : []
      }), scope)
      const subpage = page.locator('.ap-engine-judge'), engine = page.locator('.ap-engine')
      const pick = async (label, option) => { await subpage.getByRole('button', { name: new RegExp('^' + label + '：') }).click(); await page.getByRole('menuitemradio', { name: option, exact: true }).click(); await page.waitForTimeout(200) }
      const text = async (label, value) => { const input = subpage.getByRole('textbox', { name: label, exact: true }); await input.fill(value); await input.press('Enter'); await page.waitForTimeout(150) }

      // private fork (engine row, owner 2026-10): no row of its own — 智能判断 is a section of 舞台引擎 (the 基础设置 row).
      await step('row', async () => {
        const basic = page.locator('.ap-section').first(), rows = await basic.locator('.ap-switch-row').evaluateAll(n => n.map(r => r.className))
        check(rows.at(-1)?.includes('ap-model-row') && !rows.some(r => r.includes('ap-judge-row')), tag + ': no 智能判断 row ' + rows.slice(-2).join(' | '))
        const file = path.join(outDir, `row-${theme}-${size}.png`); await basic.screenshot({ path: file }); shots.push(file)
      })
      const openEngine = async () => { await page.getByRole('button', { name: '舞台引擎', exact: true }).click(); await page.getByRole('button', { name: '返回舞台设置' }).waitFor(); await page.waitForTimeout(400) }
      await step('unset', async () => {
        await openEngine()
        check(/^未设置$/.test((await subpage.locator('.ap-section-meta').innerText()).trim()), tag + ': heading state 未设置')
        check(await subpage.locator('.ap-section-head button[aria-label$="说明"]').count() === 1, tag + ': one (?) on the heading')
        const labels = await subpage.locator('.fork-inline-label-text').evaluateAll(n => n.filter(x => x.offsetParent).map(x => x.textContent))
        check(JSON.stringify(labels) === JSON.stringify(['提供方']), tag + ': unset fields ' + labels.join(','))
        check(await subpage.getByRole('button', { name: '测试连接' }).count() === 0, tag + ': no test while unset')
        await paneShot('subpage-unset')
        await page.locator('.ap-subhead-title').focus(); await page.keyboard.press('Escape'); await page.getByRole('heading', { name: /^人物/ }).waitFor(); await page.waitForTimeout(300)
        check(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')) === '舞台引擎', tag + ': Esc back, focus on the row')
      })
      await step('jev', async () => {
        await openEngine()
        await pick('提供方', 'Jev')
        check(await subpage.getByRole('textbox', { name: '模型', exact: true }).inputValue() === 'jev-1.13.0', tag + ': jev model')
        check(await subpage.getByRole('textbox', { name: '密钥名称', exact: true }).inputValue() === 'TYPESAFE_API_KEY', tag + ': jev key name')
        await subpage.locator('.ap-judge-key').waitFor()
        check((await subpage.locator('.ap-judge-key').innerText()).trim() === '已配置 · 环境变量', tag + ': key status ' + await subpage.locator('.ap-judge-key').innerText())
        await subpage.getByRole('button', { name: '测试连接' }).click(); await subpage.locator('.ap-judge-test-result.is-ok').waitFor()
        check((await subpage.locator('.ap-judge-test-result').innerText()).trim() === '连接成功 · 231 毫秒', tag + ': test ok ' + await subpage.locator('.ap-judge-test-result').innerText())
        const sent = await page.evaluate(() => window.judgeCalls.filter(([m]) => m === 'testJudgeConnection').at(-1)?.[1])
        check(sent?.config?.provider === 'jev' && Object.keys(sent.config).sort().join() === Object.keys(defaultJudgeConfig()).sort().join(), tag + ': test sends the draft')
        // private fork (engine page r2, owner 2026-10): no 对话主题 on 舞台引擎 and no 「更多」 fold.
        const labels = await subpage.locator('.fork-inline-label-text').evaluateAll(n => n.filter(x => x.offsetParent).map(x => x.textContent))
        check(JSON.stringify(labels) === JSON.stringify(['提供方', '模型', '密钥名称', '门槛', '每类上限', '超时', '附加说明']), tag + ': fields ' + labels.join(','))
        check(await subpage.locator('textarea').count() === 1 && await subpage.getByRole('textbox', { name: '附加说明' }).inputValue() === '', tag + ': empty 附加说明 text area')
        await paneShot('subpage-jev')
        const overlap = await overlaps('.ap-engine'); check(!overlap.length, tag + ': overlaps ' + overlap.join(' | '))
        check(await subpage.locator('fieldset, legend, select, input[type=checkbox], input[type=number], input[type=range]').count() === 0, tag + ': native controls')
        const body = await subpage.innerText()
        check(!/[0-9a-f]{8}-[0-9a-f]{4}-|\bunset\b|openai-compatible|JUDGE_|capPerKind|timeoutMs|sk-/.test(body), tag + ': internal words shown')
        check((await subpage.locator('.ap-help, .fork-help-tip, button[aria-label$="说明"]').count()) >= 6, tag + ': (?) per field')
      })
      await step('compatible', async () => {
        await pick('提供方', 'OpenAI 兼容')
        check(await engine.getByRole('button', { name: '保存' }).isDisabled(), tag + ': no save without a URL')
        check(/请填写接口地址/.test(await engine.locator('.ap-engine-foot').innerText()), tag + ': says why')
        await text('接口地址', 'https://key@fake.example/v1')
        check(await subpage.getByRole('alert').filter({ hasText: '不能带账号' }).count() === 1, tag + ': URL with credentials refused')
        await text('接口地址', 'https://judge.fake.example/v1')
        await pick('提供方', 'OpenAI')
        check(await subpage.getByRole('textbox', { name: '接口地址' }).count() === 0, tag + ': URL only for compatible')
        await subpage.locator('.ap-judge-key.is-missing').waitFor()
        await subpage.getByRole('textbox', { name: '门槛', exact: true }).fill('0.7'); await subpage.getByRole('textbox', { name: '门槛', exact: true }).press('Enter')
        await subpage.getByRole('button', { name: '测试连接' }).click(); await subpage.locator('.ap-judge-test-result.is-error').waitFor()
        check((await subpage.locator('.ap-judge-test-result').innerText()).trim() === '找不到这个密钥', tag + ': test error ' + await subpage.locator('.ap-judge-test-result').innerText())
        await paneShot('subpage-openai-error')
        await engine.getByRole('button', { name: '保存' }).click(); await page.waitForTimeout(300)
        // private fork (engine row): 智能判断 is part of the 舞台引擎 draft — one 保存 (saveAssetEngineSettings) sends it.
        const saved = await page.evaluate(() => { const last = window.engineSaves.at(-1); return last && { config: last.patch.judge, expectedRevision: last.expectedRevision } })
        check(JSON.stringify(saved?.config) === JSON.stringify({ enabled: true, provider: 'openai', model: 'gpt-6-luna', baseUrl: '', keyName: 'OPENAI_API_KEY', threshold: 0.7, capPerKind: 8, timeoutMs: 1500, preamble: '' }), tag + ': saved ' + JSON.stringify(saved))
        check(!!saved?.expectedRevision, tag + ': CAS revision')
        check((await subpage.locator('.ap-section-meta').innerText()).trim() === 'OpenAI', tag + ': heading says OpenAI')
        await page.getByRole('button', { name: '返回舞台设置' }).click(); await page.getByRole('heading', { name: /^人物/ }).waitFor(); await page.waitForTimeout(400)
        check(await page.evaluate(() => !JSON.stringify(window.judgeCalls).match(/sk-|Bearer/)), tag + ': no key values')
      })
      await step('prompt view', async () => {
        await scrollTo('.ap-prompt-section'); await page.locator('.ap-prompt-section .ap-prompt-rows').nth(1).waitFor(); await page.waitForTimeout(300)
        const stages = () => page.locator('.ap-prompt-stage-title > span:first-child').allInnerTexts()
        check(!(await stages()).includes('智能判断'), tag + ': no group without judge')
        await page.evaluate(() => { window.judgePreviewMode = 'empty' }); await page.getByRole('button', { name: '重新读取提示词' }).click(); await page.waitForTimeout(500)
        check((await stages()).includes('智能判断') && await page.getByText('本轮没有要判断的素材').count() === 1, tag + ': empty group is one muted line')
        await page.evaluate(() => { window.judgePreviewMode = 'full' }); await page.getByRole('button', { name: '重新读取提示词' }).click(); await page.waitForTimeout(500)
        const group = page.locator('ul[aria-label=智能判断请求]')
        await group.getByRole('button', { name: '判断请求', exact: true }).click(); await page.waitForTimeout(200)
        // private fork (prompt view r2): the body reads structurally; 「原始」 shows it as sent.
        await group.getByRole('button', { name: '原始' }).click(); await page.waitForTimeout(100)
        const body = await group.locator('.ap-prompt-piece pre.ap-json-raw').innerText()
        await group.getByRole('button', { name: '原始' }).click()
        check(body === preview.requests[0].body, tag + ': body verbatim')
        check((await group.locator('.ap-prompt-piece-head').innerText()).includes('POST https://api.typesafe.ai/v1/systemone'), tag + ': method and URL')
        const head = await group.locator('.ap-prompt-row-head').evaluate(n => { const name = n.querySelector('.ap-prompt-name').getBoundingClientRect(), edit = n.querySelector('.ap-prompt-actions').getBoundingClientRect(), owner = n.querySelector('.ap-prompt-owner').getBoundingClientRect(), row = n.getBoundingClientRect(); return { editAfterName: edit.left >= name.right - 1 && edit.left - name.right < 40, ownerRight: row.right - owner.right < 4, owner: n.querySelector('.ap-prompt-owner').textContent } })
        check(head.editAfterName && head.ownerRight && head.owner === '全局、本轮', tag + ': row head ' + JSON.stringify(head))
        await scrollTo('ul[aria-label=智能判断请求]', 80); await paneShot('prompt-judge')
        await group.getByRole('button', { name: '编辑智能判断' }).click(); await page.getByRole('button', { name: '返回舞台设置' }).waitFor()
        check(await subpage.count() === 1 && await subpage.locator('.ap-section-toggle').getAttribute('aria-expanded') === 'true', tag + ': ✎ opens 舞台引擎 at 智能判断')
        await page.getByRole('button', { name: '返回舞台设置' }).click(); await page.getByRole('heading', { name: /^人物/ }).waitFor()
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
