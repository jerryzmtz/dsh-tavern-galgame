// private fork (prompt view r2, owner 2026-10): 舞台设置 › 提示词 readability pass. A real director request (production
// buildAssetPackRequest over the synthetic pack, with the 物品演出 mod's own prompt files, a candidate and a kept state), a
// real judge body (createEngineJudge preview, jev) and a merged 人物差分 entry that is recalled by trigger words.
// Shoots the opened rows in dark / light at a 720 px pane and at 375, and (without --before) checks:
// 1. every row head is one line: name, its tokens, the scope at the right; 人物差分 has no 「提到时加入」 but a (?);
// 2. the mod pieces are in 模组, labelled 「物品演出 · 命令说明」…, and each label opens that mod;
// 3. 判断请求 is structured (state as text, questions as a counted list) and 「原始」 shows the body as sent.
// Usage: node tests/harness/prompt-view-r2.mjs [outDir] [--before]
import { mkdir, readFile } from 'node:fs/promises'
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
import { compileModPrompts } from '../../tavern-plugin/lib/domain/mods/prompts.js'
import { createEngineJudge, validateJudgeConfig } from '../../tavern-plugin/lib/domain/engine-judge.js'
import * as director from '../../tavern-plugin/lib/domain/stage-asset-pack-director.js'

const root = fileURLToPath(new URL('../../', import.meta.url))
const args = process.argv.slice(2), before = args.includes('--before')
const outDir = args.find(a => !a.startsWith('--')) || path.join(root, '.tmp/prompt-view-r2')
const REPLY = ['放学后的教室里，夕阳斜斜地照进来。', '她把一枚旧怀表放在桌上：“这个给你。”\n\n我接过怀表，表盖上刻着一行小字。']

export async function itemModFragments() {
  const dir = path.join(root, 'fork/mods/items'), manifest = JSON.parse(await readFile(path.join(dir, 'manifest.json'), 'utf8'))
  const texts = new Map([['prompts/items.txt', await readFile(path.join(dir, 'prompts/items.txt'), 'utf8')], ['prompts/inventory.txt', '背包：旧怀表、学生证']])
  const fragments = [...compileModPrompts([manifest], (_, file) => texts.get(file), 'director')]
  const ref = { modId: manifest.id, packId: 'items-basic', entryId: 'pocket-watch' }
  fragments.push({ modId: manifest.id, id: 'items-basic.pocket-watch', type: 'catalogue', source: 'library', placement: { section: 'director.catalogue', order: 0 }, text: JSON.stringify({ ref, name: '旧怀表', directorNote: '有人郑重地交出或收下怀表时' }) },
    { modId: manifest.id, id: 'persistent-keep', type: 'prompt', source: 'stage.modState', placement: { section: 'director.rules.presentation', order: 0 }, text: manifest.id + ': keep shown; omission preserves stage state.' })
  return { manifest, fragments }
}

export async function directorPreview() {
  const pack = await syntheticPack(), snapshots = [{ manifest: pack.manifest, figures: pack.figures, widgets: pack.widgets, revision: 'r0' }], assetStatus = {}
  for (const asset of pack.manifest.assets) assetStatus[assetRefKey({ packId: PACK_ID, kind: asset.kind, assetId: asset.id })] = { available: true, executableDigest: 'a'.repeat(64) }
  const { manifest, fragments } = await itemModFragments()
  const prepared = prepareAssetPackDirector({ snapshots, assetStatus, raw: { extensions: { dsh_tavern: cardExtension() } }, cardRevision: 'c1', engine: { dimensions: {} },
    target: { sourceKey: 'reply-1', branchId: 'b', revision: 1 }, units: REPLY, modPrompts: fragments,
    baseline: initialAssetPackStage({ actor: { figure: { packId: PACK_ID, figureId: FIGURE_ID }, outfits: [] } }) })
  const request = buildAssetPackRequest(prepared, true, undefined, '', true)
  const sections = director.nameModSections ? director.nameModSections(request.sections, { [manifest.id]: manifest.name }) : request.sections
  const config = validateJudgeConfig({ provider: 'jev', preamble: '' })
  const judge = createEngineJudge({ getConfig: () => config, credentials: () => null, fetch: async () => { throw new Error('no network') } })
  const kinds = ['背景', '音乐', '人物', 'CG']
  const questions = Array.from({ length: 12 }, (_, i) => ({ id: i % 3 ? 'asset:' + PACK_ID + '/' + ['backgrounds', 'music', 'cg'][i % 3] + '/a' + i : 'figure:' + PACK_ID + '/f' + i,
    text: '这条素材适合本轮剧情吗？【' + kinds[i % 4] + '】素材 ' + (i + 1) + '；使用情景：放学后、教室、夕阳' }))
  const preview = judge.preview({ material: REPLY.join('\n\n'), questions })
  return JSON.parse(JSON.stringify({ ok: true, format: request.format, system: request.system, messages: request.messages, tools: request.tools, sections, commands: request.commands, inputBytes: request.inputBytes, judge: preview }))
}

export async function run() {
  const { chromium } = await import('playwright')
  const { source, picker, playback } = await stageSource()
  const pieces = await hostPieces(), css = await forkThemeCss(), preview = await directorPreview()
  await mkdir(outDir, { recursive: true })
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  const shots = [], errors = []
  const check = (ok, message) => { if (!ok) errors.push(message) }
  try {
    for (const [theme, tokens] of Object.entries(THEMES)) for (const [size, viewport, pane] of [['720', { width: 1600, height: 1000 }, 720], ['375', { width: 375, height: 812 }, 0]]) {
      if (size === '375' && theme !== 'dark') continue
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
      await page.evaluate(preview => {
        const mock = window.rpc
        window.rpc = async (method, a) => method === 'previewStageDirectorPrompt' ? JSON.parse(JSON.stringify(preview)) : mock(method, a)
        const base = window.binding.rpc
        window.binding.rpc = async (method, a) => method === 'getCardAssetBindings' ? { ...(await base(method, a)), cardId: 'card-1' } : base(method, a)
        window.binding.engineRpc = window.binding.engineRpc || (async (method, a) => {
          if (method === 'listMods') return { revision: '1', mods: [{ id: 'dsh.items', name: '物品演出', scope: 'global', authorized: true }] }
          if (method === 'getMod') { window.openedMods = [...(window.openedMods || []), a.modId]; throw Object.assign(new Error('offline'), { code: 'MOD_RESOURCE_UNAVAILABLE' }) }
          return base(method, a)
        })
      }, preview)
      await page.evaluate(() => {
        const format = '【对白格式】\n- 角色的台词单独成行：`@bubble:ID|角色名|差分|[台词]`\n- {{user}} 的台词不加标记。'
        window.forkBubbleStore.set('s', { userName: '阿月', injection: [{ key: 'format', text: format, tokens: 41 },
          { key: 'figure', figure: 'common-roster', packs: ['11111111-1111-4111-8111-111111111111'], name: '人物差分', text: '- 每句按情景选一个差分（立绘的表情、神态或动作）。\n鹿目圆（ID f_madoka）：喜悦、平和、害羞（低头不看对方）', tokens: 38 }] })
      })
      await page.evaluate(() => window.showReal('pv' + Math.random()))
      await page.locator('.ap-prompt-section').waitFor(); await page.waitForTimeout(800)
      const paneShot = async name => { const file = path.join(outDir, `${name}-${theme}-${size}.png`); await page.waitForTimeout(250); await page.locator('.pane').screenshot({ path: file }); shots.push(file) }
      const scrollTo = async (selector, offset = 12) => page.evaluate(([selector, offset]) => { const pane = document.querySelector('.pane'), el = document.querySelector(selector); if (el) pane.scrollTop += el.getBoundingClientRect().top - offset }, [selector, offset])
      const step = async (name, fn) => { try { await fn() } catch (e) { errors.push(tag + ' ' + name + ': ' + e.message.split('\n')[0]) } }
      const prompts = page.locator('.ap-prompt-section')
      const open = async (row, name) => { const button = prompts.locator(`.ap-prompt-row[data-row="${row}"] .ap-prompt-toggle`).first(); if (await button.getAttribute('aria-expanded') !== 'true') await button.click(); await page.waitForTimeout(200) }
      await step('story', async () => {
        await prompts.locator('ul[aria-label=正文模型提示词]').waitFor()
        await open('format'); await open('figure:common-roster')
        await scrollTo('.ap-prompt-section'); await paneShot('01-story')
        if (before) return
        const heads = await prompts.locator('ul[aria-label=正文模型提示词] > li > .ap-prompt-row-head').evaluateAll(n => n.map(x => ({ text: x.innerText, height: x.getBoundingClientRect().height })))
        check(heads.every(x => /约 [\d,]+ tokens/.test(x.text)), tag + ': story row tokens ' + JSON.stringify(heads))
        check(heads.every(x => x.height < 48), tag + ': story heads one line ' + JSON.stringify(heads))
        check(!heads.some(x => /提到时加入/.test(x.text)), tag + ': no 提到时加入')
        check(await prompts.locator('.ap-prompt-row[data-row="figure:common-roster"] .ap-prompt-row-head [aria-label="人物差分 说明"]').count() === 1, tag + ': 人物差分 (?)')
        check(await prompts.locator('ul[aria-label=正文模型提示词] .ap-prompt-body .ap-prompt-tokens').count() === 0, tag + ': no separate token line under a single-piece row')
      })
      await step('mods', async () => {
        await open('protocol'); if (!before) await open('mods')
        await scrollTo(before ? '.ap-prompt-row[data-row="protocol"]' : '.ap-prompt-row[data-row="mods"]'); await paneShot('02-mods')
        if (before) return
        const labels = await prompts.locator('.ap-prompt-row[data-row="mods"] .ap-prompt-mod-link').allInnerTexts()
        check(labels.length >= 4 && labels.every(text => /^物品演出 · (命令说明|候选素材|当前状态|使用规则|上下文)/.test(text.trim())), tag + ': mod labels ' + JSON.stringify(labels))
        check(!(await prompts.innerText()).includes('其他内容'), tag + ': no 其他内容')
        await prompts.locator('.ap-prompt-row[data-row="mods"] .ap-prompt-mod-link').first().click(); await page.waitForTimeout(400)
        check(await page.locator('.ap-mod-modal').count() === 1 && (await page.evaluate(() => window.openedMods || [])).includes('dsh.items'), tag + ': label opens the mod')
        await paneShot('02b-mod-opened')
        await page.keyboard.press('Escape'); await page.waitForTimeout(200)
      })
      await step('judge', async () => {
        await open('judge:0'); await scrollTo('.ap-prompt-row[data-row="judge:0"]'); await paneShot('03-judge')
        if (before) return
        const row = prompts.locator('.ap-prompt-row[data-row="judge:0"]')
        check(await row.locator('.ap-json-text').count() >= 1, tag + ': state as text')
        const list = row.locator('.ap-json-list').first()
        check(/questions\s*12/.test(await list.locator('.ap-json-list-head').innerText()), tag + ': questions count')
        await list.locator('.ap-json-list-head button').first().click(); await page.waitForTimeout(150)
        check(await list.locator('.ap-json-item').count() === 12, tag + ': one row per question')
        await scrollTo('.ap-prompt-row[data-row="judge:0"]'); await paneShot('04-judge-questions')
        await row.getByRole('button', { name: '原始' }).click(); await page.waitForTimeout(150)
        const raw = await row.locator('pre.ap-json-raw').innerText()
        check(raw === preview.judge.requests[0].body, tag + ': raw body exact')
        await paneShot('05-judge-raw')
        await row.getByRole('button', { name: '原始' }).click()
      })
      await step('catalogue', async () => {
        await open('catalogue'); await scrollTo('.ap-prompt-row[data-row="catalogue"]'); await paneShot('06-catalogue')
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
