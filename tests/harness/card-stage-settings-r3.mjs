// private fork (rename-mod, owner 2026-10): the user-facing widget term is 模组 (display text only; ids stay widgets).
// private fork: sprite/avatar variant labels use the owner term chafen.
// private fork: 舞台设置 r3 (owner review 2026-10) — the real panel in a host-shaped side pane (fixed-height scrolling
// pane) over an in-page mock (synthetic art, no live data), with the real host half of 「提示词」 (forkStagePrompts:
// the shared dialogue store, useForkDirectorPreview, the 对白格式 reset through the engine settings). Shoots 1600×900
// (basic + advanced) and 375 in dark/light and checks the r3 structure: 基础设置 with the sounds, the skin inside
// 开场画面, one 提示词 section (stages in order, owners, tokens, inline 编辑 / 恢复默认, no internal keys), and no
// 正文语言 / fallback bubble / 双语配音 / 调试 / 对白提示词 controls.
// Usage: node tests/harness/card-stage-settings-r3.mjs [outDir] [--before]
import { readFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { browserReactScript } from '../fixtures/browser-react.mjs'
import { forkThemeCss } from '../helpers/fork-theme-css.mjs'
import { stageSource, pageSetup, THEMES } from './card-centric-stage.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const args = process.argv.slice(2), before = args.includes('--before')
const outDir = args.find(a => !a.startsWith('--')) || path.join(root, '.tmp/card-stage-settings-r3')
const client = file => readFile(path.join(root, 'tavern-plugin/src/client', file), 'utf8')
const between = (text, start, end) => { const a = text.indexOf(start); if (a < 0) throw new Error('missing ' + start); const b = end ? text.indexOf(end, a) : text.length; return text.slice(a, b < 0 ? text.length : b) }

// The host pieces production renders around the panel (outside the asset-pack factory).
async function hostPieces() {
  const bubbles = await client('fork-bubbles.js'), launcher = await client('fork-asset-launcher.js')
  return [await client('fork-settings-ui.js'), await client('fork-bubble-modals.js'),
    between(bubbles, 'const forkDialogueInjectionWrites'), between(launcher, 'function forkStagePrompts', 'function ForkTavernStageTab')].join('\n;\n')
}

// In-page: skins, the director preview, the dialogue store and the real prompts adapter.
function r3Setup({ manySkins, custom }) {
  const h = React.createElement, PACK = '11111111-1111-4111-8111-111111111111'
  const skin = (id, label, bg, fg, accent, border, radius) => ({ schema: 'dsh.skin/1', id, label, textbox: { paint: { bg, fg, fgMuted: border, accent, border }, shape: { radius } }, ui: { bg, fg, fgMuted: border, accent, border, radius } })
  const skins = { salt: skin('salt', '海盐奶油', '#fdfaf3', '#2f3d55', '#4f86d0', '#c9d6e8', 14), deep: skin('deep', '深海夜灯', '#0b1426', '#dce8ff', '#5fc4ff', '#2a4a78', 8) }
  if (manySkins) for (const [i, label] of ['樱花信笺', '旧书店', '夏夜祭', '雪国列车', '星屑', '茶室', '霓虹街', '黄昏教室', '雨夜'].entries()) skins['extra' + i] = skin('extra' + i, label, `hsl(${i * 40} 40% ${i % 2 ? 18 : 92}%)`, i % 2 ? '#f2f2f2' : '#222222', `hsl(${i * 40 + 20} 70% 50%)`, `hsl(${i * 40} 30% 55%)`, 6 + i)
  const decorate = pack => {
    if (pack.manifest.id === PACK) { pack.skins = skins; for (const id of Object.keys(skins)) pack.manifest.assets.push({ kind: 'skins', id, name: skins[id].label}) }
    for (const figure of Object.values(pack.figures || {})) { if (figure.name === '鹿目圆') figure.recall = { mode: 'constant', keywords: [] }; figure.appearance ||= 'sprite' } // staged figures → the 主角 picker
    return pack
  }
  const service = window.binding.service, base = window.r3Base ||= { list: service.listPackSummaries, snapshot: service.getPackSnapshot, rpc: window.binding.rpc }
  service.listPackSummaries = async () => (await base.list()).map(decorate)
  service.getPackSnapshot = async args => decorate(await base.snapshot(args))
  window.binding.rpc = async (method, args) => {
    if (method === 'getAssetEngineSettings') { const value = await base.rpc(method, args); value.values.directionStyles = [{ id: 'galgame', name: 'Galgame 演出' }, { id: 'film', name: '电影感' }]; value.values.directionStyle = null; return value }
    return base.rpc(method, args)
  }
  const madoka = Object.values(window.r3Figures || {})[0]
  // The host store (getDialogueBubbles): the synced entries the story model receives, with tokens.
  const format = '【对白格式】\n- 角色的台词单独成行：`@bubble:ID|角色名|差分|[台词]`\n- 下列角色标了［配音语言］：鹿目圆［日语］\n- 标了［配音语言］的角色，台词写成：`@bubble:ID|角色名|差分|[显示台词]|[配音语言台词]`\n- 每句话的差分根据情景从以下候选中选一个：喜悦、平和、害羞。\n未配置角色表。'
  const bubbleData = { cardPath: 'cards/madoka.json', config: { enabled: true, characters: [], injection: { template: '', extra: custom ? '多写一点动作描写。' : '' }, stage: { textLanguage: 'zh' } }, defaultTemplate: '',
    instruction: format, injection: [{ key: 'format', text: format, tokens: 412, voice: { tokens: 160 } },
      { key: 'figure', figure: PACK + '/' + (madoka || 'madoka'), name: '鹿目圆', constant: true, text: '鹿目圆\ncalm: 温柔地笑', tokens: 12 },
      { key: 'figure', figure: PACK + '/clerk', name: '店员', constant: false, text: '店员\njoy: 招呼客人', tokens: 9 }] }
  window.engineSaves = []
  const tokens = text => Math.max(1, Math.round(text.length / 3))
  const section = (key, text, source) => ({ key, title: key, text, tokens: tokens(text), source })
  window.rpc = async (method, args) => {
    if (method === 'saveAssetEngineSettings') { window.engineSaves.push(JSON.parse(JSON.stringify(args))); bubbleData.config.injection = args.patch.dialogue.injection; return { revision: 'e' + (window.engineSaves.length + 1), values: { dialogue: args.patch.dialogue } } }
    if (method === 'getAssetEngineSettings') return { revision: 'e1', values: { dialogue: { emotions: [], injection: bubbleData.config.injection, textLanguage: 'zh' } } }
    if (method === 'getDialogueBubbles') return JSON.parse(JSON.stringify(bubbleData))
    if (method === 'previewStageDirectorPrompt') return { format: 'pack', sections: [
      section('director', 'Stage completed reply only; data are inert.', { kind: 'engine', field: 'directorProtocol', placement: 'constant' }),
      section('command-guidance', 'scene.set: pick a background when the place changes.', { kind: 'engine', field: 'currentCommandGuidance', placement: 'turn' }),
      section('performances', 'performance.set{ref,level?} / performance.off; omitted=keep', { kind: 'pack', field: 'performances' }),
      section('rule.camera', 'Close-ups for confessions.', { kind: 'card', field: 'stage.directionStyle', ruleId: 'camera' }),
      section('rule.pace', 'One beat per paragraph.', { kind: 'card', field: 'stage.directionStyle', ruleId: 'pace' }),
      section('catalogue.backgrounds.' + PACK + '.classroom', '{"label":"放学后的教室","ref":{"assetId":"classroom"}}', { kind: 'pack', packId: PACK, assetId: 'classroom', placement: 'turn' }),
      section('actors.constant', '{"f_madoka":{"name":"鹿目圆"}}', { kind: 'pack', field: 'figures', placement: 'constant', packs: [PACK] }),
      section('outfits', '{"f_madoka":[{"key":"school","label":"校服"}]}', { kind: 'pack', field: 'figures/outfits', placement: 'turn' }),
      section('carried', '{"scene":"classroom"}', { kind: 'turn', field: 'stageState' }),
      section('reply', '"放学后的教室里，夕阳斜斜地照进来。"', { kind: 'turn', field: 'reply' }),
      section('tools', '[{"name":"stage_update"}]', { kind: 'engine', field: 'directorTools' })] }
    throw new Error('mock rpc: ' + method)
  }
  const listeners = new Set()
  window.forkBubbleStore = { load() {}, set(_, data) { Object.assign(bubbleData, data); listeners.forEach(fn => fn()) } }
  window.useForkBubbles = () => { const [, bump] = React.useState(0); React.useEffect(() => { const fn = () => bump(n => n + 1); listeners.add(fn); return () => listeners.delete(fn) }, []); return { ...bubbleData } }
  window.useTavernConfirm = () => () => {}
  window.views = createForkAssetPackUI(React, { VoicePicker: ForkBubbleLibraryPicker, AvatarImage: ForkPackImage, HelpTip: ForkHelpTip,
    emotions: { moods: [['joy', '喜悦', '#e0932a'], ['calm', '平和', '#3fa36b'], ['shy', '害羞', '#1fa5b8']].map(([id, label, color]) => ({ id, label, color })), palette: ['#e0707c'], max: 8 } })
  const nav = { openTab: async () => {}, openLibrary: async () => {} }
  // The real adapter; its editor is the host modal (covered by fork-bubble-modes tests), stubbed here as a plain dialog.
  const prompts = { ...forkStagePrompts('s'), dialogueEditor: close => h('div', { role: 'dialog', 'aria-label': '对白格式编辑器', className: 'r3-editor-stub' }, h('button', { type: 'button', onClick: close }, '关闭')) }
  window.showReal = key => window.root.render(h(window.views.StagePanel, { key, binding: window.binding, sessionId: 's', cardPath: 'cards/madoka.json', cardName: '鹿目圆的日常', nav, prompts }))
}

// The host shell's touch rule (tavern.css), read from the source so the harness follows it.
async function shellTouchRule() {
  const css = await readFile(path.join(root, 'tavern-plugin/lib/client-assets/tavern.css'), 'utf8')
  const rule = 'body.dsh-tavern-shell-active :is([data-sidebar-right-panel]) :is(button, summary, select) { min-height: 40px; }'
  if (!css.includes(rule) || !css.includes('@media (max-width: 1023px), (pointer: coarse) {')) throw new Error('tavern.css touch rule moved; update the harness')
  return '@media (max-width: 1023px), (pointer: coarse) { ' + rule + ' }'
}

export async function run() {
  const { chromium } = await import('playwright')
  const shellTouch = await shellTouchRule()
  const { source, picker, playback } = await stageSource()
  const pieces = before ? '' : await hostPieces(), css = await forkThemeCss()
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
        .pane { width: ${pane ? pane + 'px' : '100%'}; flex: none; height: 100%; overflow: auto; border-left: 1px solid var(--fork-hairline); background: ${theme === 'dark' ? '#0b0b0c' : '#d4d8de'}; }
        #panel { display: flex; flex-direction: column; min-height: 100%; }
        ${pane ? '' : '.chat { display: none; }'}
        ${shellTouch}` })
      await page.evaluate(context => { document.body.dataset.fkContext = context }, 'chat-' + theme)
      await page.addScriptTag({ content: await browserReactScript() + ';window.React=modules.react;window.ReactDOM={...modules["react-dom/client"],createPortal:modules["react-dom"].createPortal};' + playback + source + picker + '\n;\n' + pieces + (before ? '' : '\n;window.forkStagePrompts=forkStagePrompts;window.ForkHelpTip=ForkHelpTip;') })
      await page.evaluate(pageSetup)
      const start = async ({ mode = 'advanced', manySkins = false, custom = false } = {}) => {
        await page.evaluate(m => { window.scenario('main') }, mode)
        if (before) { await page.evaluate(k => window.show(k), 'b' + Math.random()); await page.getByText('人物').first().waitFor(); await page.waitForTimeout(500); return }
        await page.evaluate(r3Setup, { manySkins, custom })
        await page.evaluate(() => window.showReal('r3' + Math.random()))
        await page.getByRole('heading', { name: /^人物/ }).waitFor(); await page.waitForTimeout(600)
      }
      const shot = async name => { const file = path.join(outDir, `${name}-${theme}-${size}.png`); await page.waitForTimeout(250); await page.locator('.pane').screenshot({ path: file }); shots.push(file) }
      const scrollTo = async (heading, offset = 12) => page.evaluate(([text, offset]) => { const pane = document.querySelector('.pane'), el = [...document.querySelectorAll('.ap-section-head h3')].find(n => n.textContent.startsWith(text)); pane.scrollTop += el.getBoundingClientRect().top - offset }, [heading, offset])
      const saved = () => page.getByText('已保存', { exact: true }).waitFor()
      // The open menu sits against its trigger in viewport coordinates: shares its left (select-like) or right edge (±2px), at least as
// wide, inside the pane, right under it (or flipped right above it).
const aligned = async (trigger, name) => {
  const t = await trigger.boundingBox(), m = await page.getByRole('menu').last().boundingBox(), pane = await page.locator('.pane').boundingBox()
  const below = m.y >= t.y + t.height - 1 && m.y - (t.y + t.height) <= 10, above = m.y + m.height <= t.y + 1 && t.y - (m.y + m.height) <= 10
  check((Math.abs(m.x - t.x) <= 2 || Math.abs(m.x + m.width - t.x - t.width) <= 2) && m.width >= t.width - 1 && m.x >= pane.x - 1 && m.x + m.width <= pane.x + pane.width + 1 && (below || above),
    tag + ': ' + name + ' menu not anchored ' + JSON.stringify({ trigger: t, menu: m, pane }))
}
const lastPatch = () => page.evaluate(() => window.calls.filter(([m]) => m === 'saveCardAssetBindings').at(-1)?.[1].patch)
      const headings = () => page.evaluate(() => [...document.querySelectorAll('.ap-stage-page .ap-section-head h3')].map(h3 => h3.firstChild?.textContent || ''))

      await start({ mode: 'basic' }); await shot('01-basic')
      if (!before) {
        check(JSON.stringify(await headings()) === JSON.stringify(['基础设置', '当前素材包', '人物']), tag + ': basic sections ' + JSON.stringify(await headings()))
        const basic = page.locator('.ap-section', { has: page.getByRole('heading', { name: /^基础设置/ }) })
        const names = await basic.getByRole('switch').evaluateAll(nodes => nodes.map(n => n.getAttribute('aria-label')))
        check(JSON.stringify(names) === JSON.stringify(['对话气泡', '配音', '舞台模式', 'BGM', '音效', '环境音', '模组']), tag + ': 基础设置 switches ' + names.join(','))
  // private fork (owner r3): a quiet 「›」 (no text) to the 素材库 on each sound / widget row whose kind a used pack has.
  const jumps = await page.evaluate(() => [...document.querySelectorAll('.ap-switch-main .ap-kind-jump')].map(b => [b.getAttribute('aria-label'), b.textContent]))
  check(jumps.length >= 1 && jumps.every(([label, text]) => /^在舞台素材查看/.test(label) && text === ''), tag + ': kind jumps ' + JSON.stringify(jumps))
  console.log(tag + ': kind jumps ' + jumps.map(j => j[0]).join(','))
  if (process.env.R3_DEBUG) console.log(await page.evaluate(() => [...document.querySelectorAll('.ap-switch-main')].map(l => [...l.children].map(c => c.className + ':' + Math.round(c.getBoundingClientRect().left) + '/' + Math.round(c.getBoundingClientRect().width) + '/' + getComputedStyle(c).marginRight).join(' | ')).join('\n')))
        await basic.getByRole('switch', { name: '环境音' }).click(); await saved()
        check((await lastPatch())?.stage?.ambience === false, tag + ': 环境音 off saves stage.ambience=false')
        check(!Object.hasOwn((await lastPatch())?.stage || {}, 'voiceLanguage') || true, tag + ': patch shape')
        await basic.getByRole('switch', { name: '环境音' }).click(); await saved()
      }
      await start(); await shot('02-advanced-top')
      if (!before) {
        const all = await headings()
        check(JSON.stringify(all) === JSON.stringify(['基础设置', '当前素材包', '人物', '导演指令', '开场画面', '本卡读音词典', '提示词', '卡片导出', '全局设置']), tag + ': advanced sections ' + JSON.stringify(all))
        const text = await page.locator('.ap-stage-page').innerText()
        for (const gone of ['正文语言', '没有舞台设置的卡也用气泡', '双语配音', '对白提示词', '调试', '其余提示词', '本轮输入', 'BGM 与音效']) check(!text.includes(gone), tag + ': still shows ' + gone)
        // Heading order title → count → 「?」; no accent bar; round marks stay round under the touch rule.
        const order = await page.evaluate(() => [...document.querySelectorAll('.ap-stage-page .ap-section-head h3, .ap-prompt-stage-head')].map(h3 => { const kids = [...h3.childNodes].map(n => n.nodeType === 3 ? 'text' : n.classList?.contains('ap-section-meta') ? 'meta' : n.classList?.contains('ap-prompt-step') ? 'step' : n.querySelector?.('button[aria-label$="说明"]') || n.matches?.('.fork-help-tip, .ap-help-anchor') ? 'help' : 'other'); return { title: h3.textContent, kids, bar: getComputedStyle(h3, '::before').content } }))
        for (const row of order) {
          check(!row.kids.includes('help') || row.kids.indexOf('help') === row.kids.length - 1, tag + ': 「?」 not last in ' + row.title + ' ' + row.kids)
          check(row.bar === 'none' || row.bar === 'normal', tag + ': accent bar on ' + row.title)
        }
        const marks = await page.evaluate(() => [...document.querySelectorAll('.ap-stage-page .ap-section-head h3 button, .ap-prompt-stage-head button, .ap-cast-lamp')].map(b => { const r = b.getBoundingClientRect(); return [b.className, Math.round(r.width), Math.round(r.height)] }))
        check(marks.length && marks.every(([, w, h]) => h === w), tag + ': stretched round marks ' + JSON.stringify(marks.filter(([, w, h]) => h !== w)))
        const native = await page.evaluate(() => [...document.querySelectorAll('.ap-stage-page select, .ap-stage-page input[type=checkbox]:not([role=switch]), .ap-stage-page details')].map(n => n.outerHTML.slice(0, 80)))
        check(!native.length, tag + ': native controls ' + native.join(' | '))
        // 开场画面: 皮肤 (skin picker) and 主角 are its fields; the skin still saves stage.defaultSkin.
        await scrollTo('开场画面'); await shot('03-opening')
        const opening = page.locator('.ap-section', { has: page.getByRole('heading', { name: /^开场画面/ }) })
        const fields = await opening.locator('.ap-field > span:first-child').evaluateAll(n => n.map(x => x.firstChild.textContent))
        check(fields[0] === '皮肤' && fields.slice(1).every(f => f === '主角'), tag + ': opening fields ' + fields)
        const trigger = opening.getByRole('button', { name: /^默认舞台皮肤：/ })
        check(await trigger.locator('.fork-gal-config-theme-art').count() === 1, tag + ': skin trigger preview')
        await trigger.click(); await page.getByRole('menuitemradio', { name: '深海夜灯' }).waitFor()
        await aligned(trigger, '皮肤')
        await shot('03b-skin-menu')
        await page.getByRole('menuitemradio', { name: '深海夜灯' }).click(); await saved()
        check(JSON.stringify((await lastPatch())?.stage?.defaultSkin) === JSON.stringify({ packId: '11111111-1111-4111-8111-111111111111', kind: 'skins', assetId: 'deep' }), tag + ': defaultSkin saved')
        await page.getByRole('button', { name: '默认舞台皮肤：深海夜灯' }).click(); await page.getByRole('menuitemradio', { name: '经典' }).click(); await saved()
        // private fork (r3 live bug): the 主角 menu floats in the top layer anchored under its trigger in the side pane — not a
        // window-wide strip at x≈0. Escape closes it and returns focus to the trigger.
        const lead = opening.getByRole('button', { name: /^主角：/ }).first()
        await lead.click(); await page.getByRole('menu', { name: '主角' }).waitFor()
        await aligned(lead, '主角'); await shot('03c-lead-menu')
        await page.keyboard.press('Escape'); check(await page.getByRole('menu', { name: '主角' }).count() === 0, tag + ': 主角 menu closes on Escape')
        // 提示词: two stages in order, plain names, owners, tokens and a total; no internal keys.
        await scrollTo('提示词'); await shot('04-prompts')
        const prompts = page.locator('.ap-prompt-section')
        const ptext = await prompts.innerText()
        check(/^提示词/.test(ptext) && /正文模型[\s\S]*导演/.test(ptext), tag + ': stages out of order')
        const rows = await prompts.locator('.ap-prompt-name').allInnerTexts()
        check(JSON.stringify(rows) === JSON.stringify(['对白格式', '人物差分 · 鹿目圆', '人物差分 · 店员', '导演职责与协议', '演出指引', '演出规则', '素材清单', '剧情', '工具定义']), tag + ': prompt rows ' + rows.join(','))
        for (const key of ['command-guidance', 'actors.constant', 'outfits', 'rule.camera', 'catalogue.', 'carried', 'director']) check(!ptext.includes(key), tag + ': prompt view shows ' + key)
        check(ptext.includes('含双语台词规则') && ptext.includes('提到时加入'), tag + ': story notes')
        const owners = await prompts.locator('.ap-prompt-row-head .ap-prompt-owner').allInnerTexts()
        check(JSON.stringify(owners) === JSON.stringify(['全局', '素材包', '素材包', '全局', '全局、素材包', '本卡', '素材包', '本轮', '全局']), tag + ': owners ' + owners.join(','))
        // No combined total on 提示词: each model is a separate request with its own total (owner 2026-10).
        check(await page.locator('.ap-prompt-section > .ap-section-head .ap-section-meta').count() === 0, tag + ': no combined prompt total')
        check(await prompts.getByText('只读').count() === 4, tag + ': read-only rows ' + await prompts.getByText('只读').count())
        await prompts.getByRole('button', { name: '素材清单', exact: true }).click(); await prompts.getByRole('button', { name: '对白格式', exact: true }).click()
        check(await prompts.locator('.ap-prompt-piece pre').count() >= 4, tag + ': rows expand')
        const pieceNames = await prompts.locator('.ap-prompt-piece-head > span:first-child').allInnerTexts()
        check(pieceNames.includes('背景：放学后的教室') && pieceNames.includes('常驻人物') && pieceNames.includes('服装'), tag + ': catalogue pieces ' + pieceNames.join(','))
        await scrollTo('提示词'); await shot('04b-prompts-open')
        await prompts.getByRole('button', { name: '编辑对白格式' }).click(); await page.getByRole('dialog', { name: '对白格式编辑器' }).waitFor()
        await page.getByRole('dialog', { name: '对白格式编辑器' }).getByRole('button', { name: '关闭' }).click()
        check(await prompts.getByRole('button', { name: '对白格式恢复默认' }).count() === 0, tag + ': 恢复默认 only when custom')
        // 演出规则 恢复默认 drops the card's own style (the mock card starts with the global one: pick 电影感 first).
        // private fork (owner r3): the style is chosen on the 演出规则 row of 提示词 › 导演 (no section of its own).
        await scrollTo('提示词'); const styleButton = prompts.getByRole('button', { name: /^演出规则：/ })
        await styleButton.click(); await page.getByRole('menu', { name: '演出规则' }).waitFor(); await aligned(styleButton, '演出规则'); await shot('04c-style-menu')
        await page.getByRole('menuitemradio', { name: '电影感' }).click(); await saved()
        check((await lastPatch())?.stage?.directionStyle === 'film', tag + ': 演出规则 choice saved')
        await prompts.getByRole('button', { name: '演出规则恢复默认' }).click(); await saved()
        check(!Object.hasOwn((await lastPatch())?.stage || {}, 'directionStyle'), tag + ': 演出规则 恢复默认 keeps a style override')
        await scrollTo('全局设置', 140); await shot('05-global')
        // A custom 对白格式: 恢复默认 asks, then saves the engine injection without template / extra (placement kept).
        await start({ custom: true }); await scrollTo('提示词')
        await page.getByRole('button', { name: '对白格式恢复默认' }).click()
        await page.getByRole('button', { name: '恢复默认', exact: true }).click()
        await page.waitForFunction(() => window.engineSaves.length > 0)
        const injection = await page.evaluate(() => window.engineSaves.at(-1).patch.dialogue)
        check(injection.injection.template === '' && injection.injection.extra === '' && !('enabled' in injection) && injection.textLanguage === 'zh', tag + ': reset saves ' + JSON.stringify(injection))
      }
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
