// private fork: real React menu/dialog, offline RPCs, keyboard and one-run guidance.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { browserReactScript } from './fixtures/browser-react.mjs'
import { forkSpinnerSource } from './helpers/fork-spinner.mjs' // private fork (UI standard phase 2 batch 8): ForkSegmented lives in fork-inline-field.js

const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8')
const menu = await read('tavern-plugin/src/client/fork-gal-menu.js')
const dialog = await read('tavern-plugin/src/client/fork-gal-regenerate.js')
const controls = await read('tavern-plugin/src/client/features/play-controls.js')
const body = controls.slice(controls.indexOf('async function submitBodyRegeneration('), controls.indexOf('// A failed turn never'))
const css = await read('tavern-plugin/lib/client-assets/fork-theme.css')

async function fixture(t) {
  const browser = await chromium.launch({ headless: true })
  t.after(() => browser.close())
  const page = await browser.newPage()
  await page.setContent('<div class="fork-gal-stage" id="root"></div>')
  await page.addStyleTag({ content: css })
  await page.addScriptTag({ content: await browserReactScript() + `
    const React = modules.react;
    window.calls = []; window.errors = []; window.invalidations = []; window.menuClosed = 0;
    const historyProjection = {};
    let director = {source:{turn:7},director:{phase:'done'}};
    const subscriptions = new Set();
    const forkStageSessions = {get: () => ({select: select => ({
      getSnapshot: () => select(director),
      subscribe: fn => {subscriptions.add(fn); return () => subscriptions.delete(fn);}, dispose() {}
    })})};
    window.setDirectorPhase = phase => {director = {...director,director:{phase}}; for (const fn of subscriptions) fn();};
    const liveTavernView = { invalidate: id => invalidations.push(['view', id]) };
    const forkUiSfx = { play() {}, preload() {}, bind: () => () => {} }, useForkUiSfxControls = () => {}; // private fork: stage UI cues (fork-ui-sfx.js)
    const tavernCoordination = { invalidate: id => invalidations.push(['coordination', id]) };
    const tavernErrorHub = { report: (label, error) => errors.push([label, error.message]) };
    const applyBodyRegenerationResult = result => window.projection = {sessionId:result.sessionId,tail:result.tail};
    const setCandidatePanel = value => window.candidate = value;
    async function rpc(method, args, sessionId) {
      calls.push({method,args,sessionId});
      if (window.hold) await new Promise((resolve,reject) => {window.finish = resolve; window.fail = () => reject(new Error('Offline failure'));});
      return {view:{}};
    }
    ${forkSpinnerSource}\n${body}\n${dialog}\n${menu}
    const root = modules['react-dom/client'].createRoot(document.getElementById('root'));
    window.options = {sessionId:'s',latestTurn:7,historical:false,busy:false,Regenerate:ForkGalRegenerate,onClose:()=>window.menuClosed++};
    window.render = patch => {Object.assign(options,patch); root.render(React.createElement(ForkGalMenu,options));};
    render({});
  ` })
  await page.locator('[data-item="regenerate"]').waitFor()
  return page
}

for (const [target, method] of [['body', 'regenBody'], ['mvu', 'retryMvuSettlement'], ['director', 'retryStageDirection']]) {
  test(`stage regeneration ${target}: trimmed guidance, shared RPC, busy deduplication and focus return`, async t => {
    const page = await fixture(t)
    await page.locator('[data-item="regenerate"]').click()
    assert.equal(await page.locator('[role="dialog"]').count(), 1)
    assert.equal(await page.locator('[role="menu"]').isVisible(), false)
    assert.equal(await page.locator('[role=radio][data-target="body"]').evaluate(el => el === document.activeElement), true) // private fork (batch 8)
    await page.locator(`[role=radio][data-target="${target}"]`).click() // private fork (UI standard phase 2 batch 8): the target is the shared ForkSegmented
    await page.locator('textarea').fill('  一次指导 \n ')
    await page.evaluate(() => { window.hold = true })
    await page.getByRole('button', { name: '确定', exact: true }).click()
    assert.equal(await page.getByRole('button', { name: '执行中…' }).isDisabled(), true)
    await page.keyboard.press('Tab')
    assert.equal(await page.getByRole('button', {name:'取消',exact:true}).evaluate(el => el === document.activeElement), true)
    await page.locator('form').evaluate(form => form.requestSubmit())
    assert.deepEqual(await page.evaluate(() => calls), [{ method, args: { ...(target === 'body' ? {} : { turn: 7 }), guidance: '一次指导' }, sessionId: 's' }])
    await page.evaluate(() => window.finish())
    await page.locator('[role="dialog"]').waitFor({ state: 'detached' })
    assert.equal(await page.locator('[role="menu"]').isVisible(), true)
    assert.equal(await page.locator('[data-item="regenerate"]').evaluate(el => el === document.activeElement), true)
    assert.deepEqual(await page.evaluate(() => invalidations), [['view', 's'], ['coordination', 's']])
    if (target === 'body') assert.deepEqual(await page.evaluate(() => projection), { sessionId: 's', tail: null })
    await page.locator('[data-item="regenerate"]').click()
    assert.equal(await page.locator('textarea').inputValue(), '', 'guidance does not survive reopening')
  })
}

test('stage regeneration: latest-only, disabled activation, Esc returns to menu, Tab trapped and errors use hub', async t => {
  const page = await fixture(t)
  await page.evaluate(() => render({ historical: true }))
  await page.locator('[data-item="regenerate"]').waitFor({ state: 'detached' })
  await page.evaluate(() => render({ historical: false, busy: true }))
  const action = page.locator('[data-item="regenerate"]')
  await action.waitFor()
  assert.equal(await action.getAttribute('aria-disabled'), 'true')
  await action.evaluate(el => { el.focus(); el.click() })
  await page.keyboard.press('Enter')
  assert.equal(await page.locator('[role="dialog"]').count(), 0)
  await page.evaluate(() => render({ busy: false }))
  for (const phase of ['running', 'partial']) {
    await page.evaluate(phase => setDirectorPhase(phase), phase)
    await page.waitForFunction(() => document.querySelector('[data-item="regenerate"]').getAttribute('aria-disabled') === 'true')
    assert.equal(await action.getAttribute('aria-disabled'), 'true', 'runtime direction observation gates retries')
  }
  await page.evaluate(() => setDirectorPhase('done'))
  await action.click()
  await page.keyboard.press('Shift+Tab')
  assert.equal(await page.getByRole('button', { name: '确定', exact: true }).evaluate(el => el === document.activeElement), true)
  await page.keyboard.press('Tab')
  assert.equal(await page.locator('[role=radio][aria-checked=true]').evaluate(el => el === document.activeElement), true) // private fork (batch 8)
  await page.keyboard.press('Escape')
  await page.locator('[role="dialog"]').waitFor({ state: 'detached' })
  assert.equal(await page.evaluate(() => menuClosed), 0)
  assert.equal(await action.evaluate(el => el === document.activeElement), true)
  await action.click()
  await page.evaluate(() => { window.hold = true })
  await page.getByRole('button', { name: '确定', exact: true }).click()
  await page.evaluate(() => window.fail())
  await page.waitForFunction(() => errors.length === 1)
  assert.deepEqual(await page.evaluate(() => errors), [['重新生成', 'Offline failure']])
  assert.equal(await page.getByRole('button', { name: '确定', exact: true }).isEnabled(), true)
  await page.setViewportSize({ width: 360, height: 640 })
  const box = await page.locator('[role="dialog"]').boundingBox()
  assert.ok(box.x >= 0 && box.x + box.width <= 360 && box.y >= 0 && box.y + box.height <= 640)
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await page.locator('[role="dialog"]').waitFor({ state: 'detached' })
  assert.equal(await page.evaluate(() => menuClosed), 0)
})
