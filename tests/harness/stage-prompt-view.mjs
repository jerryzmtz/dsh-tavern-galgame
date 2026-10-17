// private fork (prompt view complete, owner 2026-10): 舞台设置 › 提示词 with a real director request (built by the production
// buildAssetPackRequest over the synthetic pack fixture) and a worldbook holding a bubble entry another card left behind.
// Shoots 1600×900 and 375 in dark / light and checks: no 导演指令 section; 导演 rows in send order with 导演指令 a plain row
// (name, ✎, scope 全局, tokens); opened, it shows only the raw text (private fork, global only: no card chips or reset);
// its ✎ and 演出指引's open 舞台引擎 at 可用演出; 结构与分隔 outlines the joins; 正文模型 lists the 旧条目.
// Usage: node tests/harness/stage-prompt-view.mjs [outDir] [--before]   (--before only shoots, for the old UI)
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { browserReactScript } from '../fixtures/browser-react.mjs'
import { forkThemeCss } from '../helpers/fork-theme-css.mjs'
import { stageSource, pageSetup, THEMES } from './card-centric-stage.mjs'
import { hostPieces, r5Setup } from './stage-panel-r5.mjs'
import { syntheticPack, cardExtension, PACK_ID, FIGURE_ID } from '../fixtures/asset-packs/pack.mjs'
import { assetRefKey } from '../../tavern-plugin/packages/dsh-presentation-protocol/src/asset-packs.js'
import { initialAssetPackStage } from '../../tavern-plugin/lib/domain/stage-asset-pack-tools.js'
import { prepareAssetPackDirector, buildAssetPackRequest } from '../../tavern-plugin/lib/domain/stage-asset-pack-director.js'

const root = fileURLToPath(new URL('../../', import.meta.url))
const args = process.argv.slice(2), before = args.includes('--before')
const outDir = args.find(a => !a.startsWith('--')) || path.join(root, '.tmp/stage-prompt-view')

async function directorPreview(dimensions = {}) {
  const pack = await syntheticPack(), snapshots = [{ manifest: pack.manifest, figures: pack.figures, widgets: pack.widgets, revision: 'r0' }], assetStatus = {}
  for (const asset of pack.manifest.assets) assetStatus[assetRefKey({ packId: PACK_ID, kind: asset.kind, assetId: asset.id })] = { available: true, executableDigest: 'a'.repeat(64) }
  const prepared = structuredClone(prepareAssetPackDirector({ snapshots, assetStatus, raw: { extensions: { dsh_tavern: cardExtension() } }, cardRevision: 'c1', engine: { dimensions },
    target: { sourceKey: 'reply-1', branchId: 'b', revision: 1 }, units: ['放学后的教室里，夕阳斜斜地照进来。', '她把书包放在桌上，回头笑了笑。'],
    baseline: initialAssetPackStage({ actor: { figure: { packId: PACK_ID, figureId: FIGURE_ID }, outfits: [] } }) }))
  prepared.rules = [{ id: 'main', text: '告白、重逢这类差分高点用近景和慢转场。\n日常对话少换背景。' }]
  const request = buildAssetPackRequest(prepared, true, undefined, '', true)
  return JSON.parse(JSON.stringify({ ok: true, format: request.format, system: request.system, messages: request.messages, tools: request.tools, sections: request.sections, commands: request.commands, inputBytes: request.inputBytes }))
}

export async function run() {
  const { chromium } = await import('playwright')
  const { source, picker, playback } = await stageSource()
  const pieces = await hostPieces(), css = await forkThemeCss()
  const previews = { on: await directorPreview(), off: await directorPreview({ camera: false, 'camera.close': false }) }
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
      // The real request; the preview follows the card's camera chips. The worldbook also holds another card's 对白格式.
      await page.evaluate(previews => {
        const mock = window.rpc; window.previewCalls = 0
        window.rpc = async (method, a) => {
          if (method === 'previewStageDirectorPrompt') { window.previewCalls++; const dims = window.calls.filter(([m]) => m === 'saveCardAssetBindings').at(-1)?.[1].patch?.stage?.dimensions || {}; return JSON.parse(JSON.stringify(dims.camera === false ? previews.off : previews.on)) }
          return mock(method, a)
        }
      }, previews)
      await page.evaluate(() => { const data = window.forkBubbleStore; const format = '【对白格式】\n- 角色的台词单独成行：`@bubble:ID|角色名|情绪|[台词]`\n- {{user}} 的台词不加标记。'
        data.set('s', { userName: '阿月', placement: { books: [], current: null, manual: false, entries: [{ book: 'card', bookName: '鹿目圆的日常', comment: '对白格式（由「对话气泡」设置维护）', text: format, constant: true, own: false }] } }) })
      await page.evaluate(() => window.showReal('pv' + Math.random()))
      await page.getByRole('heading', { name: /^人物/ }).waitFor(); await page.waitForTimeout(700)
      const paneShot = async name => { const file = path.join(outDir, `${name}-${theme}-${size}.png`); await page.waitForTimeout(250); await page.locator('.pane').screenshot({ path: file }); shots.push(file) }
      const scrollTo = async (selector, offset = 12) => page.evaluate(([selector, offset]) => { const pane = document.querySelector('.pane'), el = document.querySelector(selector); if (el) pane.scrollTop += el.getBoundingClientRect().top - offset }, [selector, offset])
      const step = async (name, fn) => { try { await fn() } catch (e) { errors.push(tag + ' ' + name + ': ' + e.message.split('\n')[0]) } }
      const prompts = page.locator('.ap-prompt-section')
      await step('sections', async () => {
        const titles = await page.locator('.ap-stage-page .ap-section-head h3').evaluateAll(n => n.map(h => h.firstChild?.textContent))
        if (before) { await page.evaluate(() => { const pane = document.querySelector('.pane'), el = [...document.querySelectorAll('.ap-section-head h3')].find(n => n.textContent.startsWith('导演指令')); if (el) pane.scrollTop += el.getBoundingClientRect().top - 12 }); await paneShot('00-dimensions-section'); return }
        check(!titles.includes('导演指令') && titles.includes('提示词'), tag + ': sections ' + titles.join(','))
      })
      await step('rows', async () => {
        await scrollTo('.ap-prompt-section'); await prompts.locator('.ap-prompt-rows').nth(1).waitFor(); await page.waitForTimeout(300)
        await paneShot('01-prompts')
        if (before) { await prompts.getByRole('button', { name: '工具定义', exact: true }).click(); await scrollTo('.ap-prompt-row:has(button[aria-expanded=true])'); await paneShot('02-tool-open'); return }
        const names = await prompts.locator('ul[aria-label=导演提示词] .ap-prompt-name').allInnerTexts()
        check(JSON.stringify(names) === JSON.stringify(['导演职责与协议', '导演指令', '演出风格', '素材清单', '剧情', '演出指引', '工具定义', '结构与分隔']), tag + ': director rows ' + names.join(','))
        const head = await prompts.locator('.ap-prompt-row[data-row=commands] .ap-prompt-row-head').innerText()
        check(/^导演指令\s*约 [\d,]+ tokens\s*全局\s*$/.test(head.trim()) /* private fork (global only, owner 2026-10): 舞台引擎 › 可用演出 */, tag + ': commands head ' + JSON.stringify(head)) // private fork (prompt view r2): name, tokens, scope
        check(await prompts.getByRole('button', { name: /全局默认|恢复全局|恢复默认/ }).count() === 0, tag + ': links outside the open row')
        const story = await prompts.locator('ul[aria-label=正文模型提示词] .ap-prompt-row-head').allInnerTexts()
        check(story.some(text => /^对白格式\s*旧条目/.test(text.trim())), tag + ': leftover entry ' + JSON.stringify(story))
        // private fork (prompt sources, owner 2026-10): no per-row tokens; the three heading totals stay; a pack-derived
        // source is pack counts by lamp with the names only in its tooltip.
        // private fork (prompt view r2, owner 2026-10): every non-empty row shows its tokens on its head line.
        check(await prompts.locator('.ap-prompt-row-head .ap-prompt-tokens').count() >= 8, tag + ': row tokens on the head')
        check(await page.locator('.ap-prompt-stage-head .ap-prompt-tokens').count() === 2 && /tokens/.test(await prompts.locator('.ap-section-head .ap-section-meta').first().innerText()), tag + ': heading totals')
        const owners = await prompts.evaluate(node => [...node.querySelectorAll('.ap-prompt-row-head > .ap-prompt-owner')].map(x => [x.closest('.ap-prompt-row').dataset.row, x.textContent, x.title]))
        const catalogue = owners.find(([row]) => row === 'catalogue'), figure = owners.find(([row]) => /^figure:/.test(row))
        for (const owner of [catalogue, figure]) check(owner && /^(全局素材包 \d+(，本卡素材包 \d+)?|本卡素材包 \d+)$/.test(owner[1]) && /^(全局|本卡)：/.test(owner[2]) && !/^p_|^pack/.test(owner[2]), tag + ': pack source ' + JSON.stringify(owner))
        check(owners.find(([row]) => row === 'format')?.[1] === '全局', tag + ': 对白格式 keeps 全局')
      })
      if (!before) await step('commands', async () => {
        const row = prompts.locator('.ap-prompt-row[data-row=commands]')
        await row.getByRole('button', { name: '导演指令', exact: true }).click(); await page.waitForTimeout(200)
        await scrollTo('.ap-prompt-row[data-row=commands]'); await paneShot('02-commands-open')
        // private fork (global only, owner 2026-10, AGENTS rule 15): no card chips or reset — the text as sent, and a ✎ that
        // opens 舞台引擎 at 可用演出 (演出指引's ✎ too). Nothing here writes stage.dimensions.
        check(await row.getByRole('checkbox').count() === 0, tag + ': no card chips')
        check(await row.getByRole('button', { name: /全局默认|恢复默认|恢复全局/ }).count() === 0, tag + ': no reset')
        const raw = await row.locator('.ap-prompt-piece pre').allInnerTexts()
        check(raw.length === 2 && /use only|scene:set/.test(raw[0]) && /"const":"camera\.set"/.test(raw[1]), tag + ': raw index + schema')
        await row.getByRole('button', { name: '导演指令', exact: true }).click()
        for (const name of ['编辑导演指令', '编辑演出指引']) {
          await prompts.getByRole('button', { name }).click(); await page.getByRole('button', { name: '返回舞台设置' }).waitFor(); await page.waitForTimeout(400)
          check(await page.evaluate(() => !!document.activeElement?.closest('.ap-engine-commands')), tag + ': ' + name + ' focuses 可用演出')
          check(await page.locator('.ap-engine-commands .ap-section-toggle').getAttribute('aria-expanded') === 'true', tag + ': 可用演出 unfolded')
          if (name === '编辑导演指令') await paneShot('03-commands-engine')
          await page.getByRole('button', { name: '返回舞台设置' }).click(); await page.waitForTimeout(400)
        }
        check(!(await page.evaluate(() => window.calls.some(([m, a]) => m === 'saveCardAssetBindings' && a?.patch?.stage?.dimensions))), tag + ': no stage.dimensions write')
      })
      if (!before) await step('frame', async () => {
        const row = prompts.locator('.ap-prompt-row[data-row=frame]')
        await row.getByRole('button', { name: '结构与分隔', exact: true }).click(); await page.waitForTimeout(200)
        await scrollTo('.ap-prompt-row[data-row=frame]'); await paneShot('04-frame-open')
        const text = await row.locator('.ap-prompt-body').innerText()
        check(/<stage_assets>/.test(text) && /⟨素材清单⟩/.test(text) && /"role":"user"/.test(text), tag + ': frame outline')
        await row.getByRole('button', { name: '结构与分隔', exact: true }).click()
        const story = prompts.locator('.ap-prompt-row[data-row=story]')
        await story.getByRole('button', { name: '剧情', exact: true }).click(); await scrollTo('.ap-prompt-row[data-row=story]'); await paneShot('05-story-open')
        check(/用户消息/.test(await story.locator('.ap-prompt-body').innerText()), tag + ': 剧情 says where it goes')
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
