// private fork (rename-mod, owner 2026-10): the user-facing widget term is 模组 (display text only; ids stay widgets).
// private fork: sprite/avatar variant labels use the owner term chafen.
// private fork: 舞台设置 r5 (owner review 2026-10) — the real panel in a host-shaped side pane over an in-page mock
// (synthetic art, no live data) with the real host half of 「提示词」 (forkStagePrompts). Shoots 1600×900 and 375 in dark /
// light and checks the r5 structure:
// 1. 提示词 rows: quiet pencil / reset icons only (no 编辑 / 只读 text), the source column names packs (never the bare 素材包),
//    the 演出规则 row has no inline picker;
// 2. 素材清单 opened: one region per kind (人物 first) with count, packs, tokens and the 「›」 jump; entries are verbatim;
// 3. 演出规则 editor: 跟随全局 first, then 不附加 and the styles with their first line; the card's choice is marked, the
//    global one tagged; a style's text edits inline and saves the engine settings;
// 4. 开场设置: closed = title + summary (no greeting text); open = 主角, 皮肤, 开场白, the scene fields, one control width;
// 5. 卡片导出: 「导出卡」 + 「附带 N 个素材包 ›」 (menu of checked rows), 「导入卡 ZIP」 opens a .zip picker (r6).
// Usage: node tests/harness/stage-panel-r5.mjs [outDir] [--before]   (--before only shoots, for the old UI)
import { readFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { browserReactScript } from '../fixtures/browser-react.mjs'
import { forkThemeCss } from '../helpers/fork-theme-css.mjs'
import { stageSource, pageSetup, THEMES } from './card-centric-stage.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const args = process.argv.slice(2), before = args.includes('--before')
const outDir = args.find(a => !a.startsWith('--')) || path.join(root, '.tmp/stage-panel-r5')
const client = file => readFile(path.join(root, 'tavern-plugin/src/client', file), 'utf8')
const between = (text, start, end) => { const a = text.indexOf(start); if (a < 0) throw new Error('missing ' + start); const b = end ? text.indexOf(end, a) : text.length; return text.slice(a, b < 0 ? text.length : b) }

export async function hostPieces() {
  const bubbles = await client('fork-bubbles.js'), launcher = await client('fork-asset-launcher.js')
  return [await client('fork-settings-ui.js'), await client('fork-bubble-modals.js'),
    between(bubbles, 'const forkDialogueInjectionWrites'), between(launcher, 'function forkStagePrompts', 'function ForkTavernStageTab')].join('\n;\n')
}

export function r5Setup() {
  const h = React.createElement
  const PACK = '11111111-1111-4111-8111-111111111111', GENERAL = '22222222-2222-4222-8222-222222222222', SFX = '44444444-4444-4444-8444-444444444444'
  const service = window.binding.service, base = window.r5Base ||= { list: service.listPackSummaries, snapshot: service.getPackSnapshot, rpc: window.binding.rpc }
  const decorate = pack => {
    for (const figure of Object.values(pack.figures || {})) { if (figure.name === '鹿目圆') figure.recall = { mode: 'constant', keywords: [] }; figure.appearance ||= 'sprite' }
    if (pack.manifest.id === GENERAL && !pack.manifest.assets.some(a => a.kind === 'cg')) pack.manifest.assets.push({ kind: 'cg', id: 'cg0', name: '雨中的约定', enabled: true, variants: { default: 'a', entries: [{ id: 'a', name: '默认', content: { media: null, pendingMedia: true } }] } }, { kind: 'widgets', id: 'phone', name: '手机', enabled: true })
    return pack
  }
  service.listPackSummaries = async () => (await base.list()).map(decorate)
  service.getPackSnapshot = async a => decorate(await base.snapshot(a))
  const styles = [
    { format: 'dsh-direction-style', schemaVersion: 1, id: 'galgame', name: 'Galgame 演出', rules: [{ id: 'main', requires: ['scene'], text: '告白、重逢这类差分高点用近景和慢转场。\n日常对话少换背景。' }] },
    { format: 'dsh-direction-style', schemaVersion: 1, id: 'film', name: '电影感', rules: [{ id: 'main', requires: ['camera'], text: '多用镜头语言：推拉、景深，少用特效。' }] }]
  window.engineValues = { dialogue: { textLanguage: 'zh', emotions: [] }, directionStyle: 'galgame', directionStyles: styles, dimensions: {}, widgetExecutionEnabled: false, dialogueThemes: [], actionCaps: { backgrounds: 4, music: 2 }, voiceServices: {} }
  window.engineSaves = []
  window.binding.rpc = async (method, a) => {
    if (method === 'getAssetEngineSettings') return { values: JSON.parse(JSON.stringify(window.engineValues)), revision: 'e' + window.engineSaves.length, writable: true }
    if (method === 'saveAssetEngineSettings') { window.engineSaves.push(JSON.parse(JSON.stringify(a))); Object.assign(window.engineValues, JSON.parse(JSON.stringify(a.patch))); return { values: JSON.parse(JSON.stringify(window.engineValues)), revision: 'e' + window.engineSaves.length, writable: true } }
    if (method === 'getCardOpeningScenes') { const v = await base.rpc(method, a); if (!v.scenes.primary.configured) v.scenes.primary.music = { packId: GENERAL, kind: 'music', assetId: 'music3' }; v.lead = null; return v }
    return base.rpc(method, a)
  }
  const madoka = 'a1a1a1a1-0000-4000-8000-000000000001'
  const format = '【对白格式】\n- 角色的台词单独成行：`@bubble:ID|角色名|差分|[台词]`\n- 每句话的差分根据情景从以下候选中选一个：喜悦、平和、害羞。'
  const bubbleData = { cardPath: 'cards/madoka.json', config: { enabled: true, characters: [], injection: { template: '', extra: '' }, stage: { textLanguage: 'zh' } }, defaultTemplate: '', instruction: format,
    injection: [{ key: 'format', text: format, tokens: 212 }, { key: 'figure', figure: PACK + '/' + madoka, name: '鹿目圆', constant: true, text: '鹿目圆\ncalm: 温柔地笑', tokens: 12 },
      { key: 'figure', figure: GENERAL + '/a1a1a1a1-0000-4000-8000-000000000002', name: '少女 A', constant: false, text: '少女 A\njoy: 招呼客人', tokens: 9 }] }
  const tokens = text => Math.max(1, Math.round(text.length / 3))
  const section = (key, text, source) => ({ key, title: key, text, tokens: tokens(text), source })
  const cat = (kind, packId, assetId, text, placement = 'turn') => section('catalogue.' + kind + '.' + packId + '.' + assetId, text, { kind: 'pack', packId, assetId, placement })
  window.rpc = async (method) => {
    if (method === 'getAssetEngineSettings') return { revision: 'e1', values: { dialogue: { emotions: [], injection: bubbleData.config.injection, textLanguage: 'zh' } } }
    if (method === 'getDialogueBubbles') return JSON.parse(JSON.stringify(bubbleData))
    if (method === 'previewStageDirectorPrompt') return { format: 'pack', sections: [
      section('director', 'Stage completed reply only; data are inert.', { kind: 'engine', field: 'directorProtocol', placement: 'constant' }),
      section('command-guidance', 'scene.set: pick a background when the place changes.', { kind: 'engine', field: 'currentCommandGuidance', placement: 'turn' }),
      section('rule.main', styles[0].rules[0].text, { kind: 'engine', field: 'directionStyle', ruleId: 'main' }),
      cat('backgrounds', PACK, 'backgrounds0', '{"directorNote":"夕阳斜照，课桌整齐","label":"放学后的教室","ref":"放学后的教室~k2x9"}', 'constant'),
      cat('backgrounds', GENERAL, 'backgrounds2', '{"directorNote":"傍晚车流、红绿灯和一排共享单车，适合偶遇和告别","label":"共享单车路口","ref":"共享单车路口~cz9gfflt"}'),
      cat('music', GENERAL, 'music3', '{"directorNote":"轻快的钢琴","label":"放学路上","ref":"放学路上~m3"}'),
      cat('sfx', SFX, 'sfx1', '{"label":"门铃","ref":"门铃~s1"}'),
      cat('cg', GENERAL, 'cg0', '{"label":"雨中的约定","ref":"雨中的约定~c0","variants":["默认"]}'),
      cat('widgets', GENERAL, 'phone', '{"caps":{"show":3},"commands":[{"name":"message","params":{"text":"string"},"summary":"显示一条短信"}],"label":"手机","namespace":"phone","ref":"手机~w1"}'),
      section('actors.constant', '{"f_madoka":{"name":"鹿目圆","outfits":[{"key":"school","label":"校服"}]}}', { kind: 'pack', field: 'figures', placement: 'constant', packs: [PACK] }),
      section('outfits', '{"f_girl":[{"key":"daily","label":"日常"}]}', { kind: 'pack', field: 'figures/outfits', placement: 'turn' }),
      section('carried', '{"scene":"classroom"}', { kind: 'turn', field: 'stageState' }),
      section('reply', '"放学后的教室里，夕阳斜斜地照进来。"', { kind: 'turn', field: 'reply' }),
      section('tools', '[{"name":"stage_update"}]', { kind: 'engine', field: 'directorTools' })] }
    throw new Error('mock rpc: ' + method)
  }
  const listeners = new Set()
  window.forkBubbleStore = { load() {}, set(_, data) { Object.assign(bubbleData, data); listeners.forEach(fn => fn()) } }
  window.useForkBubbles = () => { const [, bump] = React.useState(0); React.useEffect(() => { const fn = () => bump(n => n + 1); listeners.add(fn); return () => listeners.delete(fn) }, []); return { ...bubbleData } }
  window.useTavernConfirm = () => () => {}
  window.views = createForkAssetPackUI(React, { VoicePicker: ForkBubbleLibraryPicker, AvatarImage: ForkPackImage, HelpTip: window.ForkHelpTip,
    emotions: { moods: [['joy', '喜悦', '#e0932a'], ['calm', '平和', '#3fa36b'], ['shy', '害羞', '#1fa5b8']].map(([id, label, color]) => ({ id, label, color })), palette: ['#e0707c'], max: 8 } })
  window.opened = []
  const nav = { openTab: async type => { window.opened.push(['tab', type]) }, openLibrary: async target => { window.opened.push(['library', target]) } }
  const prompts = window.forkStagePrompts ? { ...window.forkStagePrompts('s'), dialogueEditor: close => h('div', { role: 'dialog', 'aria-label': '对白格式编辑器' }, h('button', { type: 'button', onClick: close }, '关闭')) } : undefined
  window.showReal = key => window.root.render(h(window.views.StagePanel, { key, binding: window.binding, sessionId: 's', cardPath: 'cards/madoka.json', cardName: '鹿目圆的日常', nav, prompts }))
}

export async function run() {
  const { chromium } = await import('playwright')
  const { source, picker, playback } = await stageSource()
  const pieces = await hostPieces(), css = await forkThemeCss()
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
      await page.evaluate(() => window.showReal('r5' + Math.random()))
      await page.getByRole('heading', { name: /^人物/ }).waitFor(); await page.waitForTimeout(700)
      const paneShot = async name => { const file = path.join(outDir, `${name}-${theme}-${size}.png`); await page.waitForTimeout(250); await page.locator('.pane').screenshot({ path: file }); shots.push(file) }
      const viewShot = async name => { const file = path.join(outDir, `${name}-${theme}-${size}.png`); await page.waitForTimeout(250); await page.screenshot({ path: file }); shots.push(file) }
      const scrollTo = async (heading, offset = 12) => page.evaluate(([text, offset]) => { const pane = document.querySelector('.pane'), el = [...document.querySelectorAll('.ap-section-head h3')].find(n => n.textContent.startsWith(text)); if (el) pane.scrollTop += el.getBoundingClientRect().top - offset }, [heading, offset])
      const saved = () => page.getByText('已保存', { exact: true }).waitFor()
      const lastPatch = () => page.evaluate(() => window.calls.filter(([m]) => m === 'saveCardAssetBindings').at(-1)?.[1].patch)
      const step = async (name, fn) => { try { await fn() } catch (e) { errors.push(tag + ' ' + name + ': ' + e.message.split('\n')[0]) } }

      // 4. 开场设置 (before: 开场画面).
      await step('opening', async () => {
        await scrollTo(before ? '开场画面' : '开场设置'); await paneShot('01-opening-collapsed')
        if (before) return
        const section = page.locator('.ap-opening-section'), toggle = section.getByRole('button', { name: /^开场设置/ })
        check(await toggle.getAttribute('aria-expanded') === 'false', tag + ': opening starts closed')
        const summary = await section.locator('.ap-opening-summary').innerText()
        check(/鹿目圆/.test(summary) && /music 3/.test(summary) && /经典/.test(summary) && !/放学后的教室里/.test(summary), tag + ': summary ' + JSON.stringify(summary))
        check(await section.locator('.ap-opening-summary-thumb').count() === 1, tag + ': summary picture')
        await toggle.click(); await section.getByRole('button', { name: /^开场白：/ }).waitFor(); await paneShot('02-opening-open')
        const fields = await section.locator('.ap-opening-field .fork-inline-label-text').evaluateAll(n => n.map(x => x.textContent)) // private fork (inline-field sweep): inline rows
        check(JSON.stringify(fields) === JSON.stringify(['主角', '皮肤', '开场白', '背景', '时段', 'CG', '人物', 'BGM']), tag + ': opening fields ' + fields)
        const widths = await page.evaluate(() => ['主角：', '默认舞台皮肤：', '开场白：', '背景：', 'BGM：'].map(p => { const b = [...document.querySelectorAll('.ap-opening-section button[aria-label]')].find(x => x.getAttribute('aria-label').startsWith(p)); return b ? Math.round(b.getBoundingClientRect().width) : -1 }))
        check(widths.every(w => w > 0), tag + ': control widths ' + widths) // private fork (inline-field sweep): pickers are sized by their text
        const boxed = await page.evaluate(() => [...document.querySelectorAll('.ap-opening-section .fork-inline-field button[aria-haspopup]')].filter(b => parseFloat(getComputedStyle(b).borderTopWidth) > 0 || getComputedStyle(b).backgroundColor !== 'rgba(0, 0, 0, 0)').length)
        check(boxed === 0, tag + ': boxed pickers ' + boxed)
        const heights = await page.evaluate(() => ['主角：', '默认舞台皮肤：', '开场白：', '背景：', 'BGM：'].map(p => Math.round([...document.querySelectorAll('.ap-opening-section button[aria-label]')].find(x => x.getAttribute('aria-label').startsWith(p))?.getBoundingClientRect().height || -1)))
        check(heights.every(v => v === heights[0]), tag + ': control heights ' + heights)
        check(!(await section.locator('select, input[type=checkbox]:not([role=switch]), details').count()), tag + ': native controls in opening')
        await section.getByRole('button', { name: '黄昏', exact: true }).click(); await saved()
        const scene = (await lastPatch())?.openings?.scenes?.primary
        check(scene?.timeOfDay === 'dusk' && scene?.music?.assetId === 'music3', tag + ': 时段 saves the whole scene ' + JSON.stringify(scene))
        await section.getByRole('button', { name: '开场白：开场白 · 自定义' }).waitFor()
        await page.evaluate(() => { const pane = document.querySelector('.pane'); pane.scrollTop += document.querySelector('.ap-opening-section').getBoundingClientRect().top - 12 })
        await paneShot('02b-opening-custom')
        await section.getByRole('button', { name: '使用默认', exact: true }).click(); await saved()
        check(!Object.hasOwn((await lastPatch())?.openings?.scenes || {}, 'primary'), tag + ': 使用默认 drops the scene')
        await toggle.click()
      })
      // 1 + 2. 提示词 rows and 素材清单.
      await step('prompts', async () => {
        await scrollTo('提示词'); await paneShot('03-prompts')
        const prompts = page.locator('.ap-prompt-section')
        await prompts.getByRole('button', { name: '素材清单', exact: true }).click(); await page.waitForTimeout(200)
        await page.evaluate(() => { const pane = document.querySelector('.pane'), row = [...document.querySelectorAll('.ap-prompt-name')].find(n => n.textContent === '素材清单'); pane.scrollTop += row.getBoundingClientRect().top - 12 })
        await paneShot('04-catalogue-open')
        if (before) return
        const ptext = await prompts.innerText()
        check(!/只读|(^|\n)编辑/.test(ptext), tag + ': text actions remain')
        const owners = await prompts.locator('.ap-prompt-row-head .ap-prompt-owner').allInnerTexts()
        check(!owners.some(o => o.split('、').includes('素材包')), tag + ': bare 素材包 owner ' + owners.join(' | '))
        check(owners[1] === '鹿目圆素材' && owners[2] === '通用素材', tag + ': emotion owners ' + owners.join(' | '))
        check(await prompts.locator('.ap-prompt-row-head .ap-target-button, .ap-prompt-row-head [aria-haspopup=menu]').count() === 0, tag + ': inline picker on a row')
        const actions = await prompts.locator('.ap-prompt-actions button').evaluateAll(n => n.map(b => [b.getAttribute('aria-label'), b.textContent]))
        check(actions.length >= 4 && actions.every(([, text]) => text === ''), tag + ': actions are icons ' + JSON.stringify(actions))
        const groups = await prompts.locator('.ap-prompt-group-name').allInnerTexts()
        check(JSON.stringify(groups) === JSON.stringify(['人物', '背景', 'CG', '音乐', '音效', '模组']), tag + ': groups ' + groups)
        const jumps = await prompts.locator('.ap-prompt-group .ap-kind-jump').count()
        check(jumps === groups.length, tag + ': group jumps ' + jumps)
        const bg = prompts.locator('.ap-prompt-group', { has: page.locator('.ap-prompt-group-name', { hasText: '背景' }) })
        check(/鹿目圆素材、通用素材/.test(await bg.locator('.ap-prompt-owner').innerText()), tag + ': background packs')
        // private fork (catalogue view, owner 2026-10): entries read as a list; 「查看原文」 gives the verbatim texts.
        check(!(await bg.innerText()).includes('{"directorNote"'), tag + ': readable catalogue entries')
        await prompts.locator('.ap-prompt-row[data-row=catalogue] .ap-schema-toggle').click()
        check((await bg.innerText()).includes('{"directorNote":"傍晚车流'), tag + ': verbatim catalogue text')
        await bg.locator('button.ap-prompt-raw').first().click(); await page.waitForTimeout(150)
        await paneShot('04b-catalogue-entry-open')
        await prompts.locator('.ap-prompt-group', { has: page.locator('.ap-prompt-group-name', { hasText: '音乐' }) }).locator('.ap-kind-jump').click()
        check((await page.evaluate(() => window.opened.at(-1)))?.[1]?.kind === 'music', tag + ': music jump')
      })
      // 3. 演出规则 editor.
      await step('style editor', async () => {
        await scrollTo('提示词')
        await page.locator('.ap-prompt-section').getByRole('button', { name: '编辑演出规则' }).click(); await page.waitForTimeout(400)
        if (before) { await page.evaluate(() => { document.querySelector('.pane').scrollTop = 0 }); await paneShot('05-style-editor'); return }
        const dialog = page.getByRole('dialog', { name: '演出规则' }); await dialog.waitFor(); await viewShot('05-style-editor')
        const names = await dialog.locator('.ap-style-name > span:first-child').allInnerTexts()
        check(JSON.stringify(names) === JSON.stringify(['跟随全局', '不附加', 'Galgame 演出', '电影感']), tag + ': style rows ' + names)
        check(await dialog.getByRole('radio', { name: /跟随全局/ }).getAttribute('aria-checked') === 'true', tag + ': follows global')
        check((await dialog.locator('.ap-style-tag').allInnerTexts()).length === 1, tag + ': one global tag')
        await dialog.getByRole('radio', { name: /电影感/ }).click(); await saved()
        check((await lastPatch())?.stage?.directionStyle === 'film', tag + ': card style saved')
        check(await dialog.getByRole('radio', { name: /电影感/ }).getAttribute('aria-checked') === 'true', tag + ': marks the chosen style')
        await dialog.getByRole('button', { name: '编辑 电影感' }).click(); await dialog.getByLabel('规则内容').waitFor(); await viewShot('05b-style-edit')
        await dialog.getByLabel('规则内容').fill('多用镜头语言：推拉、景深。'); await dialog.getByRole('button', { name: '保存', exact: true }).click()
        await page.waitForFunction(() => window.engineSaves.length > 0)
        const save = await page.evaluate(() => window.engineSaves.at(-1).patch)
        check(save.directionStyles?.find(s => s.id === 'film')?.rules[0].text === '多用镜头语言：推拉、景深。' && !('directionStyle' in save), tag + ': style text saved ' + JSON.stringify(save))
        await dialog.getByRole('button', { name: '新建规则' }).click(); await viewShot('05c-style-new')
        await dialog.getByRole('radio', { name: /跟随全局/ }).click(); await saved()
        check(!Object.hasOwn((await lastPatch())?.stage || {}, 'directionStyle'), tag + ': back to global')
        await dialog.getByRole('button', { name: '关闭', exact: true }).click()
      })
      // 5. 卡片导出.
      await step('export', async () => {
        await page.keyboard.press('Escape').catch(() => {})
        await scrollTo('卡片导出', 160); await paneShot('06-export')
        if (before) return
        const section = page.locator('.ap-export-section')
        check(!(await page.locator('input[type=file]').count()), tag + ': file input remains')
        check(await section.locator('button.ap-primary').innerText() === '导出卡', tag + ': primary export')
        const packs = section.getByRole('button', { name: /^不附带素材包/ }); await packs.click(); await page.getByRole('menu', { name: '附带素材包' }).waitFor()
        await page.getByRole('menuitemcheckbox', { name: /通用素材/ }).click(); await viewShot('06b-export-packs')
        await page.keyboard.press('Escape')
        check(await section.getByRole('button', { name: /^附带 1 个素材包/ }).count() === 1, tag + ': summary updates')
        // private fork (card import r6): 「导入卡 ZIP」 opens the file picker (zip only), never a tab
        check(await section.getByRole('button', { name: '导入卡 ZIP' }).count() === 1, tag + ': zip import link present')
        check(await section.locator('input[type=file][accept=".zip"]').count() === 1, tag + ': zip input is .zip only')
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
