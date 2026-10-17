// private fork (direction styles, owner 2026-10): 演出风格 as a 素材库 kind — 舞台设置 › 提示词 › 导演 › 演出风格 with a real director
// request (production buildAssetPackRequest over the synthetic pack fixture, prepared.styles set: one card author style from
// the card's 绿灯 pack, one player style from a 蓝灯 pack) and the pack window at 演出风格 (list, the dashed ＋, a draft, an
// entry). Shoots 1600×900 and 375 in dark / light and checks: the row's name and scope; opened, the lead-in, the
// entry names and each text verbatim; the pencil offers the packs that hold styles; the
// pack window lists the styles with 启用 / 关闭 dots and ends with an unlabelled ＋; a draft writes nothing until its text.
// Usage: node tests/harness/direction-styles.mjs [outDir]
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
const outDir = process.argv.slice(2).find(a => !a.startsWith('--')) || path.join(root, '.tmp/direction-styles')
// The harness packs (card-centric-stage.mjs): 鹿目圆素材 is bound to the card (绿灯), 通用音效 is global (蓝灯).
const CARD_PACK = '11111111-1111-4111-8111-111111111111', GLOBAL_PACK = '44444444-4444-4444-8444-444444444444'
const CARD_TEXT = '进入魔女结界时，先换成结界背景并用情绪调色压暗画面，再震屏一次。'
const PLAYER_TEXT = '多数段落不写指令；安全上限是限制，不是预算。画面效果（震屏、闪光）只用在身体或情绪的顶点，每个场景至多约一次；镜头变化每轮至多一两次；漫符每轮至多一两个，严肃或悲伤时不用。'
const LIVELY_TEXT = '演出可以更积极：换人说话或情绪明显时，可以给镜头、视线、动作或漫符；动作场面可以配音效和画面效果。每处演出都要对应正文里真实发生的事。'

async function directorPreview() {
  const pack = await syntheticPack(), snapshots = [{ manifest: pack.manifest, figures: pack.figures, widgets: pack.widgets, revision: 'r0' }], assetStatus = {}
  for (const asset of pack.manifest.assets) assetStatus[assetRefKey({ packId: PACK_ID, kind: asset.kind, assetId: asset.id })] = { available: true, executableDigest: 'a'.repeat(64) }
  const prepared = structuredClone(prepareAssetPackDirector({ snapshots, assetStatus, raw: { extensions: { dsh_tavern: cardExtension() } }, cardRevision: 'c1', engine: {},
    target: { sourceKey: 'reply-1', branchId: 'b', revision: 1 }, units: ['放学后的教室里，夕阳斜斜地照进来。', '她把书包放在桌上，回头笑了笑。'],
    baseline: initialAssetPackStage({ actor: { figure: { packId: PACK_ID, figureId: FIGURE_ID }, outfits: [] } }) }))
  prepared.styles = { card: [{ ref: { packId: CARD_PACK, kind: 'directions', assetId: 'barrier' }, name: '结界演出', text: CARD_TEXT, packName: '鹿目圆素材' }],
    player: [{ ref: { packId: GLOBAL_PACK, kind: 'directions', assetId: 'restrained' }, name: '演出风格·克制', text: PLAYER_TEXT, packName: '通用音效' }] }
  const request = buildAssetPackRequest(prepared, true, undefined, '', true)
  return JSON.parse(JSON.stringify({ ok: true, format: request.format, system: request.system, messages: request.messages, tools: request.tools, sections: request.sections, commands: request.commands, inputBytes: request.inputBytes }))
}

// In the page: the pack styles (an overlay over the harness packs) with patchPack / createPack, the new engine contract
// (no directionStyle / directionStyles) and the real director preview.
function styleSetup([preview, cardPack, globalPack, texts]) {
  const service = window.binding.service, base = { list: service.listPackSummaries, snapshot: service.getPackSnapshot }, overlay = new Map(), revisions = new Map()
  overlay.set(cardPack, [{ kind: 'directions', id: 'barrier', name: '结界演出', enabled: true, recall: { mode: 'constant', keywords: [] }, directorNote: '', text: texts[0] }])
  overlay.set(globalPack, [{ kind: 'directions', id: 'restrained', name: '演出风格·克制', enabled: true, recall: { mode: 'constant', keywords: [] }, directorNote: '', text: texts[1] },
    { kind: 'directions', id: 'lively', name: '演出风格·丰富', enabled: false, recall: { mode: 'constant', keywords: [] }, directorNote: '', text: texts[2] }])
  const inject = pack => { if (!pack) return pack; const own = overlay.get(pack.manifest.id) || []; pack.manifest.assets = [...pack.manifest.assets.filter(a => a.kind !== 'directions'), ...JSON.parse(JSON.stringify(own))]; if (revisions.has(pack.manifest.id)) pack.revision = revisions.get(pack.manifest.id); return pack }
  service.listPackSummaries = async () => (await base.list()).map(inject)
  service.getPackSnapshot = async a => inject(await base.snapshot(a))
  window.stylePatches = []
  service.patchPack = async ({ packId, patch }) => {
    window.stylePatches.push(JSON.parse(JSON.stringify({ packId, patch })))
    if (patch.assets) overlay.set(packId, patch.assets.filter(a => a.kind === 'directions'))
    revisions.set(packId, 'd' + window.stylePatches.length)
    return { status: 'ok', snapshot: await service.getPackSnapshot({ packId }), widgetRisks: [] }
  }
  delete window.engineValues.directionStyle; delete window.engineValues.directionStyles
  const mock = window.rpc
  window.rpc = async (method, a) => method === 'previewStageDirectorPrompt' ? JSON.parse(JSON.stringify(preview)) : mock(method, a)
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
      await page.evaluate(styleSetup, [preview, CARD_PACK, GLOBAL_PACK, [CARD_TEXT, PLAYER_TEXT, LIVELY_TEXT]])
      await page.evaluate(() => window.showReal('ds' + Math.random()))
      await page.getByRole('heading', { name: /^人物/ }).waitFor(); await page.waitForTimeout(700)
      const paneShot = async name => { const file = path.join(outDir, `${name}-${theme}-${size}.png`); await page.waitForTimeout(250); await page.locator('.pane').screenshot({ path: file }); shots.push(file) }
      const viewShot = async name => { const file = path.join(outDir, `${name}-${theme}-${size}.png`); await page.waitForTimeout(300); await page.screenshot({ path: file }); shots.push(file) }
      const scrollTo = async (selector, offset = 12) => page.evaluate(([selector, offset]) => { const pane = document.querySelector('.pane'), el = document.querySelector(selector); if (el) pane.scrollTop += el.getBoundingClientRect().top - offset }, [selector, offset])
      const step = async (name, fn) => { try { await fn() } catch (e) { errors.push(tag + ' ' + name + ': ' + e.message.split('\n')[0]) } }
      const prompts = page.locator('.ap-prompt-section'), row = prompts.locator('.ap-prompt-row[data-row=styles]')
      await step('row', async () => {
        await scrollTo('.ap-prompt-section'); await prompts.locator('.ap-prompt-rows').nth(1).waitFor(); await page.waitForTimeout(300)
        const names = await prompts.locator('ul[aria-label=导演提示词] .ap-prompt-name').allInnerTexts()
        check(names.slice(0, 3).join() === '导演职责与协议,导演指令,演出风格' && !names.includes('演出规则'), tag + ': director rows ' + names.join(','))
        const head = (await row.locator('.ap-prompt-row-head').innerText()).replace(/\s+/g, ' ').trim()
        check(/^演出风格 鹿目圆素材、通用音效 约 [\d,]+ tokens$/.test(head), tag + ': head ' + JSON.stringify(head))
        check(await page.locator('.ap-style-editor, .ap-json-field').count() === 0, tag + ': old style editor gone')
        await row.getByRole('button', { name: '演出风格', exact: true }).click(); await page.waitForTimeout(250)
        const raw = await row.locator('.ap-prompt-piece pre').allInnerTexts()
        // private fork: equal styles carry names, never priority labels.
        check(JSON.stringify(raw) === JSON.stringify(['本局还有以下额外演出指导：', '【结界演出】\n' + CARD_TEXT, '【演出风格·克制】\n' + PLAYER_TEXT]), tag + ': verbatim ' + JSON.stringify(raw))
        const heads = await row.locator('.ap-prompt-piece-head').allInnerTexts()
        check(heads.some(t => /结界演出 · 鹿目圆素材/.test(t)) && heads.some(t => /演出风格·克制 · 通用音效/.test(t)), tag + ': entry heads ' + JSON.stringify(heads))
        await scrollTo('.ap-prompt-row[data-row=styles]'); await paneShot('01-prompt-styles')
      })
      await step('pencil', async () => {
        await row.getByRole('button', { name: '编辑演出风格' }).click(); await page.waitForTimeout(250)
        const menu = page.getByRole('menu', { name: '在哪个素材包里编辑演出风格' })
        const items = await menu.getByRole('menuitem').allInnerTexts()
        check(JSON.stringify(items.map(t => t.trim())) === JSON.stringify(['通用音效', '鹿目圆素材']), tag + ': pencil packs ' + JSON.stringify(items))
        await viewShot('02-pencil-menu')
        await menu.getByRole('menuitem', { name: '通用音效' }).click()
        await page.getByRole('tab', { name: '演出风格' }).waitFor(); await page.waitForTimeout(500)
      })
      await step('library', async () => {
        const modal = page.locator('.ap-pack-modal')
        check(await page.getByRole('tab', { name: '演出风格' }).getAttribute('aria-selected') === 'true', tag + ': opens at 演出风格')
        const add = modal.getByRole('button', { name: '新建演出风格' })
        check((await add.innerText()).trim() === '', tag + ': ＋ has no label')
        if (size === '375') { await viewShot('03-library-list'); await modal.getByRole('option').first().click(); await page.waitForTimeout(300) }
        check(await modal.getByRole('textbox', { name: '正文' }).inputValue() === PLAYER_TEXT, tag + ': text field')
        await viewShot(size === '375' ? '04-library-entry' : '03-library-entry')
        if (size === '375') { await modal.getByRole('button', { name: '演出风格', exact: true }).click(); await page.waitForTimeout(300) }
        await add.click(); await page.waitForTimeout(300)
        check(await modal.getByRole('textbox', { name: '名称' }).inputValue() === '新演出风格', tag + ': draft name')
        check(await page.evaluate(() => window.stylePatches.length) === 0, tag + ': draft writes nothing')
        await viewShot('05-library-draft')
        await modal.getByRole('textbox', { name: '正文' }).fill('雨天的场景多用环境音。'); await modal.getByRole('textbox', { name: '正文' }).press('Enter'); await page.waitForTimeout(500)
        const patch = await page.evaluate(() => window.stylePatches.at(-1))
        const made = patch?.patch.assets.filter(a => a.kind === 'directions').at(-1)
        check(made?.text === '雨天的场景多用环境音。' && made.enabled === true && made.recall.mode === 'constant', tag + ': created ' + JSON.stringify(made))
        await viewShot('06-library-created')
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
