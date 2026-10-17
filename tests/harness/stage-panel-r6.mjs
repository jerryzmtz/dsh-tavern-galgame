// private fork: 舞台设置 r6 (owner review 2026-10) — the r5 host-shaped pane and mock, checking:
// 1. 本卡读音词典: the whole 写法 / 读音 cell edits (a click at the far end of a column focuses its field), the add row has a
//    full-width target; ForkInlineField in general: a click on the empty part of the value cell reaches the control
//    (开场设置 links / menus, the 演出规则 editor's name field);
// 2. 提示词: aligned row token/source columns, heading totals, the pencil at the far right;
// 3. 导入导出: 「导出卡」 and 「导入卡 ZIP」 side by side, pack switches below (r7/r8);
// (the 演出指引 / 演出规则 rename was withdrawn by the owner: labels stay as they are.)
// Usage: node tests/harness/stage-panel-r6.mjs [outDir] [--before]   (--before only shoots, for the old UI)
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { browserReactScript } from '../fixtures/browser-react.mjs'
import { forkThemeCss } from '../helpers/fork-theme-css.mjs'
import { stageSource, pageSetup, THEMES } from './card-centric-stage.mjs'
import { hostPieces, r5Setup } from './stage-panel-r5.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const args = process.argv.slice(2), before = args.includes('--before')
const outDir = args.find(a => !a.startsWith('--')) || path.join(root, '.tmp/stage-panel-r6')

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
      await page.evaluate(() => window.showReal('r6' + Math.random()))
      await page.getByRole('heading', { name: /^人物/ }).waitFor(); await page.waitForTimeout(700)
      const paneShot = async name => { const file = path.join(outDir, `${prefix}${name}-${theme}-${size}.png`); await page.waitForTimeout(250); await page.locator('.pane').screenshot({ path: file }); shots.push(file) }
      const viewShot = async name => { const file = path.join(outDir, `${prefix}${name}-${theme}-${size}.png`); await page.waitForTimeout(250); await page.screenshot({ path: file }); shots.push(file) }
      const scrollTo = async (heading, offset = 12) => page.evaluate(([text, offset]) => { const pane = document.querySelector('.pane'), el = [...document.querySelectorAll('.ap-section-head h3')].find(n => n.textContent.startsWith(text)); if (el) pane.scrollTop += el.getBoundingClientRect().top - offset }, [heading, offset])
      const step = async (name, fn) => { try { await fn() } catch (e) { errors.push(tag + ' ' + name + ': ' + e.message.split('\n')[0]) } }
      const focusedLabel = () => page.evaluate(() => document.activeElement?.getAttribute('aria-label') || document.activeElement?.tagName)
      // A click near the far end of a box (its right edge minus `inset`), at its vertical middle.
      const clickEnd = async (locator, inset = 6) => { const b = await locator.boundingBox(); await page.mouse.click(b.x + b.width - inset, b.y + b.height / 2) }
      const blur = () => page.evaluate(() => document.activeElement?.blur?.())

      // 1. 本卡读音词典.
      await step('readings', async () => {
        // private fork: r7 renamed the heading; scroll the fields into view before coordinate clicks.
        await scrollTo('读音词典'); await paneShot('01-readings')
        if (before) return
        const table = page.locator('.ap-readings'), row = table.locator('.ap-readings-row:not(.is-new)').first(), add = table.locator('.ap-readings-row.is-new')
        const cells = row.locator('.ap-reading-field'), draft = add.locator('.ap-reading-field')
        // Each column cell spans its grid track; the input inside spans the cell.
        for (const [name, cell] of [['entry 写法', cells.nth(0)], ['entry 读音', cells.nth(1)], ['new 写法', draft.nth(0)], ['new 读音', draft.nth(1)]]) {
          const [cellBox, inputBox] = [await cell.boundingBox(), await cell.locator('input').boundingBox()]
          check(inputBox.width >= cellBox.width - 2, tag + ': ' + name + ' input spans its cell ' + Math.round(inputBox.width) + '/' + Math.round(cellBox.width))
          await clickEnd(cell); const focused = await focusedLabel()
          check(focused === await cell.locator('input').getAttribute('aria-label'), tag + ': click at the end of ' + name + ' focuses it (got ' + focused + ')')
          await blur()
        }
        await clickEnd(draft.nth(0)); await page.waitForTimeout(100); await paneShot('01b-readings-add-focused'); await blur()
        // The add row: clicking its arrow (not a field) starts at 写法.
        await add.locator('.ap-reading-arrow').click(); check(await focusedLabel() === '新写法', tag + ': add row arrow focuses 新写法'); await blur()
        const addBox = await add.boundingBox(), tableBox = await table.boundingBox()
        check(addBox.width >= tableBox.width - 2, tag + ': add row spans the table')
      })
      // ForkInlineField elsewhere: 开场设置 (link + menu), a click on the empty end of the value cell reaches the control.
      await step('inline elsewhere', async () => {
        if (before) return
        await scrollTo('开场设置'); const section = page.locator('.ap-opening-section')
        await section.getByRole('button', { name: /^开场设置/ }).click(); await section.getByRole('button', { name: /^开场白：/ }).waitFor()
        const field = section.locator('.ap-opening-field', { has: page.getByRole('button', { name: /^时段/ }) })
        if (await field.count()) {
          await clickEnd(field.locator('.fork-inline-value'), 4)
          check(await page.getByRole('menu', { name: '时段' }).count() === 1, tag + ': far end of 时段 opens its menu')
          await page.keyboard.press('Escape')
        }
        const voiceless = section.locator('.fork-inline-field[data-kind=link]').first()
        if (await voiceless.count()) {
          const opened = await page.evaluate(() => document.querySelectorAll('[role=dialog]').length)
          await clickEnd(voiceless.locator('.fork-inline-value'), 4); await page.waitForTimeout(300)
          check(await page.evaluate(() => document.querySelectorAll('[role=dialog]').length) > opened, tag + ': far end of a link field opens it')
          await page.keyboard.press('Escape'); await page.waitForTimeout(200)
        }
        await section.getByRole('button', { name: /^开场设置/ }).click()
      })
      // 2. 提示词.
      await step('prompts', async () => {
        await scrollTo('提示词'); await paneShot('02-prompts')
        if (before) return
        const prompts = page.locator('.ap-prompt-section')
        // private fork (prompt totals): only the rows share the token column; the heading totals sit right after their titles.
        const lefts = await prompts.evaluate(node => [...node.querySelectorAll('.ap-prompt-row-head > .ap-prompt-tokens')].map(x => [x.textContent, Math.round(x.getBoundingClientRect().left)]))
        check(lefts.length >= 8 && lefts.every(([, x]) => Math.abs(x - lefts[0][1]) <= 1), tag + ': token column ' + JSON.stringify(lefts))
        const heads = await prompts.evaluate(node => [...node.querySelectorAll(':scope > .ap-section-head h3, .ap-prompt-stage-title')].map(t => [...t.children].map(c => c.classList.contains('ap-section-meta') ? 'meta' : c.matches('.fork-help-tip, .ap-help-anchor') || c.querySelector('button[aria-label$="说明"]') ? 'help' : 'title')))
        check(heads.length === 3 && heads.every(kids => kids.join() === 'meta,help' || kids.join() === 'title,meta,help'), tag + ': heading totals ' + JSON.stringify(heads))
        const scopes = await prompts.evaluate(node => [...node.querySelectorAll('.ap-prompt-row-head > .ap-prompt-owner')].map(x => [x.textContent, Math.round(x.getBoundingClientRect().left)]))
        check(scopes.length >= 8 && scopes.every(([, x]) => Math.abs(x - scopes[0][1]) <= 1), tag + ': scope column ' + JSON.stringify(scopes))
        const rights = await prompts.evaluate(node => [...node.querySelectorAll('.ap-prompt-row-head')].map(head => { const a = head.querySelector('.ap-prompt-actions'); return Math.round(head.getBoundingClientRect().right - a.getBoundingClientRect().right) }))
        check(rights.every(v => v === 0), tag + ': actions at the far right ' + rights)
        const pencil = await prompts.evaluate(node => [...node.querySelectorAll('.ap-prompt-actions button')].map(b => Math.round(b.getBoundingClientRect().right)))
        const edits = await prompts.evaluate(node => [...node.querySelectorAll('.ap-prompt-actions button[aria-label^="编辑"]')].map(b => Math.round(b.getBoundingClientRect().right)))
        check(edits.length >= 3 && edits.every(x => x === edits[0]), tag + ': pencils share the right edge ' + edits + ' / ' + pencil)
        const names = await prompts.locator('.ap-prompt-name').allInnerTexts()
        check(names.includes('演出指引') && names.includes('演出规则'), tag + ': rows keep their names ' + names)
        const note = await prompts.locator('.ap-prompt-row', { has: page.locator('.ap-prompt-name', { hasText: '演出规则' }) }).locator('.ap-prompt-note').innerText()
        check(note === 'Galgame 演出', tag + ': 演出规则 shows the style name ' + note)
      })
      // 3. 卡片导出.
      await step('export', async () => {
        // private fork: r7 moved pack selection to switches below the two import/export actions.
        await scrollTo('导入导出', 160); await paneShot('03-export')
        if (before) return
        return // private fork (pack section merge, owner 2026-10): checked by stage-pack-section.mjs
        const section = page.locator('.ap-export-section'), group = section.locator('.ap-export-row')
        // private fork: pack switches are not a third action button (r7/r8).
        check(await group.getByRole('button', { name: '导出卡' }).count() === 1 && await group.getByRole('button', { name: '导入卡 ZIP' }).count() === 1, tag + ': export and import in one group')
        check(await section.getByRole('switch', { name: /^一起导出 / }).count() > 0, tag + ': pack selection uses switches')
        check(await section.locator('.ap-section-head').getByRole('button', { name: '导入卡 ZIP' }).count() === 0, tag + ': import left the heading')
        const order = await group.evaluate(node => [...node.querySelectorAll('button')].map(b => b.getAttribute('aria-label') || b.textContent))
        // private fork: keep checking the action order under the current two-button contract.
        check(order.length === 2 && order[0] === '导出卡' && order[1] === '导入卡 ZIP', tag + ': order ' + JSON.stringify(order))
        const boxes = await group.evaluate(node => [...node.querySelectorAll(':scope button')].map(b => { const r = b.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.right), Math.round(r.top)] }))
        // private fork: the two actions share a line; packs have their own list below.
        check(boxes.length === 2 && boxes[1][0] >= boxes[0][1] && boxes[1][0] - boxes[0][1] < 40 && Math.abs(boxes[1][2] - boxes[0][2]) < 8, tag + ': side by side ' + JSON.stringify(boxes))
      })
      // 4. 演出规则 editor (its name field's hit area).
      await step('style editor', async () => {
        await scrollTo('提示词')
        await page.locator('.ap-prompt-section').getByRole('button', { name: '编辑演出规则' }).click(); await page.waitForTimeout(400)
        await viewShot('04-style-editor')
        if (before) return
        const dialog = page.getByRole('dialog', { name: '演出规则' }); await dialog.waitFor()
        const names = await dialog.locator('.ap-style-name > span:first-child').allInnerTexts()
        check(JSON.stringify(names) === JSON.stringify(['跟随全局', '不附加', 'Galgame 演出', '电影感']), tag + ': style rows ' + names)
        await dialog.getByRole('button', { name: '编辑 电影感' }).click()
        const nameField = dialog.locator('.ap-style-name-field')
        await nameField.locator('input').evaluate(n => n.blur())
        await clickEnd(nameField, 4); check(await focusedLabel() === '规则名称', tag + ': far end of the style name field focuses it')
        await viewShot('04b-style-edit')
        await page.keyboard.press('Escape'); await dialog.getByRole('button', { name: '关闭', exact: true }).click()
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
