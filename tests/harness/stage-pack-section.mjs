// private fork (pack section merge, owner 2026-10): 舞台设置's one 「素材包 N (?)」 section (was 当前素材包 + 导入导出).
// Header: 管理 · 导出 · 导入. One row per pack the card uses (全局 first): name, faces, 全局/本卡 tag, size and a quiet 导出
// icon that exports that pack alone (exportPack, as the 素材库 does). Header 导出 enters selection mode: house-style checks
// (本卡 on, 全局 off), the header becomes 取消 · 导出; confirming runs exportCardBundle with exactly the checked packs.
// Shoots desktop (720 pane) and 375 in dark / light.
// Usage: node tests/harness/stage-pack-section.mjs [outDir] [--before]   (--before only shoots, for the old UI)
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { browserReactScript } from '../fixtures/browser-react.mjs'
import { forkThemeCss } from '../helpers/fork-theme-css.mjs'
import { stageSource, pageSetup, THEMES } from './card-centric-stage.mjs'
import { hostPieces, r5Setup } from './stage-panel-r5.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const args = process.argv.slice(2), before = args.includes('--before')
const outDir = args.find(a => !a.startsWith('--')) || path.join(root, '.tmp/stage-pack-section')
const PACK = '11111111-1111-4111-8111-111111111111', GENERAL = '22222222-2222-4222-8222-222222222222', SFX = '44444444-4444-4444-8444-444444444444'

function sizesSetup() {
  const PACK = '11111111-1111-4111-8111-111111111111', GENERAL = '22222222-2222-4222-8222-222222222222', SFX = '44444444-4444-4444-8444-444444444444'
  const sizes = { [PACK]: 38.2 * 1048576, [GENERAL]: 12.6 * 1048576, [SFX]: 860 * 1024 }
  const service = window.binding.service, list = service.listPackSummaries, snapshot = service.getPackSnapshot
  const sized = pack => { if (sizes[pack.manifest.id]) pack.manifest.files = [{ path: 'a.bin', size: Math.round(sizes[pack.manifest.id]), sha256: 'x' }]; return pack }
  service.listPackSummaries = async () => (await list()).map(sized)
  service.getPackSnapshot = async a => sized(await snapshot(a))
  window.exports = []; window.packExports = []
  service.exportCardBundle = async a => { window.exports.push(JSON.parse(JSON.stringify(a))); return { bytes: new Uint8Array(), filename: 'card.zip' } }
  service.exportPack = async a => { window.packExports.push(JSON.parse(JSON.stringify(a))); return { bytes: new Uint8Array(), filename: 'pack.zip' } }
  window.binding.download = () => {}
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
      await page.evaluate(sizesSetup)
      await page.evaluate(() => window.showReal('ps' + Math.random()))
      await page.getByRole('heading', { name: /^人物/ }).waitFor(); await page.waitForTimeout(900)
      const sectionShot = async (name, locator) => { const file = path.join(outDir, `${prefix}${name}-${theme}-${size}.png`); await page.waitForTimeout(250); await locator.scrollIntoViewIfNeeded(); await locator.screenshot({ path: file }); shots.push(file) }
      const step = async (name, fn) => { try { await fn() } catch (e) { errors.push(tag + ' ' + name + ': ' + e.message.split('\n')[0]) } }
      if (before) {
        await step('before', async () => {
          await sectionShot('01-packs', page.locator('.ap-pack-section'))
          await sectionShot('02-export', page.locator('.ap-export-section'))
        })
        await page.close(); continue
      }
      const section = page.locator('.ap-pack-section')
      await step('merged', async () => {
        await sectionShot('01-packs', section)
        const titles = await page.locator('.ap-stage-page > .ap-section > .ap-section-head h3').evaluateAll(n => n.map(h => h.childNodes[0]?.textContent?.trim()))
        check(titles.includes('素材包') && !titles.includes('当前素材包') && !titles.includes('导入导出'), tag + ': sections ' + JSON.stringify(titles))
        check(await page.locator('.ap-export-section').count() === 0, tag + ': old 导入导出 section gone')
        const head = await section.locator('.ap-pack-head-actions button').allInnerTexts()
        check(JSON.stringify(head.map(s => s.trim())) === JSON.stringify(['管理', '导出', '导入']), tag + ': header ' + JSON.stringify(head))
        check(await section.locator('.ap-section-meta').innerText() === '3', tag + ': count')
        const rows = await section.locator('li.ap-pack-row').evaluateAll(nodes => nodes.map(n => ({ name: n.querySelector('.ap-pack-name')?.textContent, size: n.querySelector('.ap-pack-size')?.textContent, state: n.querySelector('.ap-state-tag')?.textContent,
          exp: n.querySelector('button.ap-pack-export')?.getAttribute('title'), checks: n.querySelectorAll('[role=checkbox]').length })))
        check(JSON.stringify(rows.map(r => r.name)) === JSON.stringify(['通用音效', '鹿目圆素材', '通用素材']), tag + ': rows ' + JSON.stringify(rows))
        check(JSON.stringify(rows.map(r => r.size)) === JSON.stringify(['860 KB', '38.2 MB', '12.6 MB']), tag + ': sizes ' + JSON.stringify(rows.map(r => r.size)))
        check(JSON.stringify(rows.map(r => r.state)) === JSON.stringify(['全局', '本卡', '本卡']), tag + ': tags')
        check(rows.every(r => r.exp === '导出' && r.checks === 0), tag + ': row export icons, no checks')
        check(!/一起导出/.test(await section.innerText()) && await section.locator('input:not([type=file])').count() === 0, tag + ': no 一起导出 / native inputs')
        const overflow = await section.evaluate(n => [...n.querySelectorAll('li.ap-pack-row')].some(r => r.scrollWidth > r.clientWidth + 1))
        check(!overflow, tag + ': row overflow')
      })
      await step('row export', async () => {
        await section.getByRole('button', { name: '导出 鹿目圆素材' }).click(); await page.waitForFunction(() => window.packExports.length > 0)
        const sent = await page.evaluate(() => window.packExports.at(-1))
        check(sent.packId === '11111111-1111-4111-8111-111111111111' && await page.evaluate(() => window.exports.length) === 0, tag + ': single pack export ' + JSON.stringify(sent))
      })
      await step('select', async () => {
        await section.locator('.ap-section-head').getByRole('button', { name: '导出', exact: true }).click(); await page.waitForTimeout(200)
        const head = await section.locator('.ap-pack-head-actions button').allInnerTexts()
        check(JSON.stringify(head.map(s => s.trim())) === JSON.stringify(['取消', '导出']), tag + ': selection header ' + JSON.stringify(head))
        const checks = await section.getByRole('checkbox').evaluateAll(n => n.map(c => [c.getAttribute('aria-label'), c.getAttribute('aria-checked')]))
        check(JSON.stringify(checks) === JSON.stringify([['通用音效', 'false'], ['鹿目圆素材', 'true'], ['通用素材', 'true']]), tag + ': default checks ' + JSON.stringify(checks))
        check(await section.locator('button.ap-pack-export').count() === 0, tag + ': no row export while selecting')
        await sectionShot('02-select', section)
        await section.getByRole('checkbox', { name: '通用音效' }).click(); await section.getByRole('checkbox', { name: '鹿目圆素材' }).click()
        await sectionShot('03-select-changed', section)
        await section.locator('.ap-section-head').getByRole('button', { name: '导出', exact: true }).click(); await page.waitForFunction(() => window.exports.length > 0)
        const sent = await page.evaluate(() => window.exports.at(-1))
        check(JSON.stringify(sent.packIds) === JSON.stringify(['44444444-4444-4444-8444-444444444444', '22222222-2222-4222-8222-222222222222']), tag + ': card export packs ' + JSON.stringify(sent))
        await page.waitForTimeout(200)
        check(await section.getByRole('checkbox').count() === 0 && await section.locator('button.ap-pack-export').count() === 3, tag + ': back to normal rows')
        await section.locator('.ap-section-head').getByRole('button', { name: '导出', exact: true }).click(); await page.waitForTimeout(100)
        await section.getByRole('button', { name: '取消', exact: true }).click(); await page.waitForTimeout(100)
        check(await section.getByRole('checkbox').count() === 0, tag + ': 取消 leaves selection')
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
