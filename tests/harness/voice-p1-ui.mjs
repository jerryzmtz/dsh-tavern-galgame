// private fork (voice v4 P1): screenshot harness for the figure voice page (docs/fork/voice-p1-ui.md). Real client
// sources and stylesheet, the in-page fake backend of tests/helpers/voice-p1-fake.mjs (synthetic canvas figures, silent
// WAV clips, no live data, no TTS). Usage: node tests/harness/voice-p1-ui.mjs [outDir] [--only=a,b] [--theme=light|dark]
// [--size=1600|375]. Writes <name>-<theme>-<size>.png and prints guard metrics (native controls, internal ids, overflow).
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { openVoicePage, guardVoiceUi } from '../helpers/voice-p1-fake.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const args = process.argv.slice(2), option = name => args.find(a => a.startsWith('--' + name + '='))?.split('=').slice(1).join('=')
const outDir = args.find(a => !a.startsWith('--')) || path.join(root, '.tmp/voice-p1-ui')
const guard = guardVoiceUi

export async function run({ only, themes = ['light', 'dark'], sizes = ['1600', '375'] } = {}) {
  const { chromium } = await import('playwright')
  const browser = await chromium.launch({ headless: true })
  const shots = [], errors = []
  await mkdir(outDir, { recursive: true })
  const want = name => !only || only.includes(name)
  try {
    for (const theme of themes) for (const size of sizes) {
      const viewport = size === '375' ? { width: 375, height: 812 } : { width: 1600, height: 900 }, narrow = size === '375'
      const fresh = async world => { const { page, errors: pageErrors } = await openVoicePage(browser, { viewport, theme, world, scale: narrow ? 2 : 1 }); return { page, pageErrors } }
      const tag = theme + '/' + size
      const shot = async (page, name, { full = false } = {}) => { const file = path.join(outDir, `${name}-${theme}-${size}.png`); await page.mouse.move(viewport.width - 2, 1); await page.waitForTimeout(350); await page.screenshot({ path: file, fullPage: full }); shots.push(file) }
      const openFigure = async (page, key, name) => { await page.evaluate(k => window.openFigure(k), key); await page.getByRole('dialog').waitFor(); await page.waitForTimeout(300)
        if (narrow && !(await page.locator('.ap-figure-pane').isVisible())) await page.getByRole('option', { name: new RegExp(name) }).first().click(); await page.locator('.ap-figure-pane').waitFor(); await page.waitForTimeout(300) }
      const openVoice = async page => { await page.locator('.ap-voice-pill').click(); await page.locator('.ap-voice-page').waitFor(); await page.waitForTimeout(300) }
      const scrollTo = async (page, selector) => { await page.locator(selector).first().scrollIntoViewIfNeeded(); await page.waitForTimeout(200) }
      const way = async (page, title) => { await page.getByRole('button', { name: new RegExp('^' + title) }).first().click(); await page.waitForTimeout(350) }
      const finish = async (page, pageErrors) => { for (const e of pageErrors) errors.push(tag + ': ' + e); await page.close() }

      if (want('field')) { const { page, pageErrors } = await fresh({ missingKeys: [] })
        await openFigure(page, 'aoi', '朝雾葵'); await scrollTo(page, '.ap-voice-pill'); await guard(page, tag + ' field', errors); await shot(page, '01-figure-voice-field'); await finish(page, pageErrors) }
      if (want('empty')) { const { page, pageErrors } = await fresh({})
        await openFigure(page, 'mei', '芽衣'); await openVoice(page); await page.locator('.ap-voice-tile').first().waitFor(); await guard(page, tag + ' empty', errors); await shot(page, '02-new-figure-recommended')
        await page.locator('.ap-voice-tile-play').first().click(); await page.waitForTimeout(250); await shot(page, '03-recommended-preview')
        await page.locator('.ap-voice-tile-main').nth(1).click(); await page.locator('.ap-voice-hero:not(.is-empty)').waitFor(); await page.waitForTimeout(300); await guard(page, tag + ' chosen', errors); await shot(page, '04-recommended-chosen')
        await finish(page, pageErrors) }
      if (want('missing-key')) { const { page, pageErrors } = await fresh({ missingKeys: ['fish-audio'] })
        await openFigure(page, 'aoi', '朝雾葵'); await scrollTo(page, '.ap-voice-pill'); await page.locator('.ap-voice-pill .ap-hint-mark').waitFor(); await shot(page, '05-field-missing-key')
        await openVoice(page); await page.locator('.ap-voice-hero .ap-voice-warn').waitFor(); await guard(page, tag + ' missing-key', errors); await shot(page, '06-voice-missing-key'); await finish(page, pageErrors) }
      if (want('fish')) { const { page, pageErrors } = await fresh({})
        await openFigure(page, 'aoi', '朝雾葵'); await openVoice(page); await way(page, 'Fish 声音')
        await page.getByLabel('Fish 声音编号或名字').fill('女仆'); await page.getByRole('button', { name: '搜索' }).click(); await page.locator('.ap-voice-finder .ap-voice-row').first().waitFor()
        await guard(page, tag + ' fish-search', errors); await shot(page, '07-fish-search')
        await page.getByLabel('Fish 声音编号或名字').fill('ffffffffffffffffffffffffffffffff'); await page.getByRole('button', { name: '查找编号' }).click(); await page.getByText('没有找到这个编号').waitFor(); await shot(page, '08-fish-id-missing'); await finish(page, pageErrors) }
      if (want('online')) { const { page, pageErrors } = await fresh({})
        await openFigure(page, 'aoi', '朝雾葵'); await openVoice(page); await way(page, '在线 TTS'); await page.locator('.ap-voice-online .ap-voice-row').first().waitFor(); await guard(page, tag + ' online', errors); await shot(page, '09-online-qwen')
        await page.locator('.ap-voice-online .ap-voice-play').nth(1).click(); await page.getByRole('dialog', { name: '付费试听' }).waitFor(); await shot(page, '10-billing-confirm')
        await page.getByRole('button', { name: '取消' }).click(); await finish(page, pageErrors) }
      if (want('references')) { const { page, pageErrors } = await fresh({})
        await openFigure(page, 'rin', '雨宫凛'); await openVoice(page); await guard(page, tag + ' rin', errors); await shot(page, '11-rin-hero')
        await way(page, '参考音频'); await page.locator('.ap-clip').first().waitFor(); await page.waitForTimeout(600); await scrollTo(page, '.ap-voice-refs'); await guard(page, tag + ' references', errors); await shot(page, '12-reference-list')
        await page.locator('.ap-clip-menu').nth(1).getByRole('button').click(); await page.getByRole('menuitem', { name: '上移' }).waitFor(); await shot(page, '13-reference-menu'); await page.keyboard.press('Escape')
        await way(page, '参考音频'); await way(page, '本地引擎'); await page.locator('.ap-voice-slots').waitFor(); await page.getByRole('radio', { name: /喜悦/ }).click(); await page.waitForTimeout(500); await scrollTo(page, '.ap-voice-local'); await guard(page, tag + ' local', errors); await shot(page, '14-local-pools')
        await finish(page, pageErrors) }
      if (want('tuning')) { const { page, pageErrors } = await fresh({})
        await openFigure(page, 'sora', '空'); await openVoice(page); await way(page, '声音预设'); await page.locator('.ap-voice-moods').waitFor(); await page.waitForTimeout(400)
        await scrollTo(page, '.ap-voice-bymood'); await guard(page, tag + ' tuning', errors); await shot(page, '15-tuning-azure-by-mood')
        await finish(page, pageErrors) }
      if (want('shared')) { const { page, pageErrors } = await fresh({})
        await openFigure(page, 'mei', '芽衣'); await openVoice(page); await way(page, '声音预设'); await page.locator('.ap-voice-preset').first().waitFor(); await page.waitForTimeout(300); await guard(page, tag + ' existing', errors); await shot(page, '16-existing-voices')
        await page.getByRole('radio', { name: '温柔少女 · 原声' }).click(); await page.locator('.ap-voice-hero:not(.is-empty)').waitFor(); await page.getByRole('button', { name: '预设操作 温柔少女 · 原声' }).click(); await page.getByRole('menuitem', { name: '调整参数' }).click(); await page.getByRole('slider').first().focus(); await page.keyboard.press('ArrowRight')
        await page.getByRole('dialog', { name: '这个声音还有别的人物在用' }).waitFor(); await shot(page, '17-shared-confirm'); await page.getByRole('button', { name: '取消' }).click(); await finish(page, pageErrors) }
    }
  } finally { await browser.close() }
  return { shots, errors }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const { shots, errors } = await run({ only: option('only')?.split(','), themes: option('theme') ? [option('theme')] : undefined, sizes: option('size') ? option('size').split(',') : undefined })
  console.log(shots.length + ' screenshots → ' + outDir)
  if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1 }
}
