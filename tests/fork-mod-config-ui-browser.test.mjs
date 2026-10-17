// private fork (mod settings UI, owner 2026-10; docs/fork/ui-design.md §三.25–28): the generic settings editor in a real
// browser with the in-page RPC fake (docs/fork/mod-config.md shapes). (1) ForkDataPicker under a bound field's one source
// menu (no 自动 / 固定 mode layer): drill down and filter with the keyboard, Enter writes {ref}, Esc closes only the topmost popup; thousands of nodes stay
// windowed. (2) ForkFormulaInput: the picker inserts a chip at the caret, the live result follows, an error shows its
// position.
import test from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { modConfigScript, modConfigCss, HOST } from './fixtures/fork-mod-config-page.mjs'

async function mount(t, extraSources = []) {
  const browser = await chromium.launch({ headless: true }); t.after(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } }), errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.setContent(`<!doctype html><html lang="zh-CN"><head><style>${await modConfigCss()}</style></head><body data-fk-context="chat-dark" style="${HOST.dark}"><div id="root" class="ap-ui"></div></body></html>`)
  await page.addScriptTag({ content: await modConfigScript() })
  await page.addScriptTag({ content: `
    const h = React.createElement, fake = window.fake = createForkModConfigFake({ bulk: 1200, latency: 5 })
    const call = async (method, args) => {
      const result = await fake.call(method, args)
      if (method === 'listModConfigSources') for (const extra of ${JSON.stringify(extraSources)}) {
        const source = result.sources.find(row => row.id === extra.id)
        if (source) source.tree.push(...extra.tree); else result.sources.push(extra)
      }
      return result
    }
    function App() {
      const config = window.config = useForkModConfig({ call, modId: 'dsh.phone', cardId: 'card-a', cardName: '小圆', fileUrl: fake.fileUrl })
      return h('div', null, h(ForkScopeSwitch, { value: config.scope, onChange: config.setScope, cardName: config.cardName }),
        h('div', { style: { width: 260 } }, h(ForkPreviewHotspots, { config, width: 260, height: 520, label: '手机预览',
          hotspots: [{ key: 'battery', label: '电量', rect: [220, 8, 30, 24] }, { key: 'signal', label: '信号', rect: [190, 8, 26, 24] }] }, h('div', { style: { position: 'absolute', inset: 0 } }))))
    }
    modules['react-dom/client'].createRoot(document.getElementById('root')).render(h(App))` })
  await page.locator('.fork-cfg-hotspot:not([disabled])').first().waitFor()
  return { page, errors }
}
const activeLabel = page => page.locator('.fork-cfg-opt.is-active .fork-cfg-opt-label').innerText()
async function arrowTo(page, label) { for (let i = 0; i < 60; i++) { if (await activeLabel(page) === label) return; await page.keyboard.press('ArrowDown') } assert.fail('no row ' + label) }
const lastSet = page => page.evaluate(() => fake.log.filter(([m]) => m === 'setModConfig').map(([, a]) => ({ key: a.key, layer: a.layer, value: a.value })).at(-1))
// private fork (mod-settings-simple): a bound field's popover opens its one source menu at once; choose an entry of it.
async function choose(page, pop, name) {
  const item = page.getByRole('menuitemradio', { name, exact: true })
  if (!await item.count()) await pop.locator('button.fork-inline-trigger').first().click()
  await item.click()
}

test('a bound number: one source menu, no mode layer; the data picker opens under it, keyboard drill-down and fuzzy filter, windowed', async t => {
  const { page, errors } = await mount(t), pop = page.locator('.fork-cfg-pop')
  await page.getByRole('button', { name: '电量', exact: true }).click(); await pop.waitFor()
  assert.equal(await pop.getByRole('radio').count(), 0, 'no 自动 / 固定 / 引用 / 公式 segmented layer')
  // A bound field's popover keeps its source menu closed (its fixed control is what is wanted most).
  assert.equal(await page.getByRole('menuitemradio').count(), 0)
  await pop.locator('button.fork-inline-trigger').first().click(); await page.getByRole('menuitemradio').first().waitFor()
  assert.deepEqual(await page.getByRole('menuitemradio').allInnerTexts(), ['自动（跟随状态）', '固定', '选择变量…', '公式…'])
  await choose(page, pop, '选择变量…')
  const combo = pop.getByRole('combobox'); await page.locator('.fork-cfg-opt').first().waitFor()
  assert.equal(await combo.getAttribute('aria-expanded'), 'true', 'the list opens on focus')
  assert.match(await page.locator('.fork-cfg-crumbs').innerText(), /全部/)
  // ↓ to a branch, → drills in, ← goes back to it, Enter on a branch drills too.
  await arrowTo(page, '活跃魔法少女'); await page.keyboard.press('ArrowRight')
  assert.match(await page.locator('.fork-cfg-crumbs').innerText(), /变量\s*›\s*活跃魔法少女/)
  await page.keyboard.press('ArrowLeft'); assert.equal(await activeLabel(page), '活跃魔法少女')
  await page.keyboard.press('Enter'); await arrowTo(page, '晓美焰（眼镜）'); await page.keyboard.press('ArrowRight')
  const row = page.locator('.fork-cfg-opt', { hasText: 'SG浑浊度' })
  assert.match(await row.innerText(), /0–100，越高越危险/, 'an MVU tuple shows its description as a hint')
  assert.equal(await page.locator('.fork-cfg-opt', { hasText: '状态' }).first().getAttribute('aria-disabled'), 'true', 'a text leaf cannot be a number')
  await arrowTo(page, 'SG浑浊度'); await page.keyboard.press('Enter')
  await page.waitForFunction(() => /12%/.test(document.querySelector('.fork-cfg-pop').textContent))
  assert.deepEqual(await lastSet(page), { key: 'battery', layer: 'card', value: { ref: { source: 'mvu', path: '/活跃魔法少女/晓美焰（眼镜）/SG浑浊度' } } })
  assert.match(await pop.locator('button.fork-inline-trigger').first().innerText(), /跟随 .*SG浑浊度/, 'the menu reads the chosen variable')
  assert.equal(await pop.getByRole('combobox').count(), 0, 'the picker closes once a leaf is chosen')
  // Typing filters every full path fuzzily; Esc closes the list only, the next Esc the editor.
  await choose(page, pop, '选择变量…'); await page.keyboard.type('sg浑')
  await page.waitForFunction(() => /匹配 3 项/.test(document.querySelector('.fork-cfg-crumbs')?.textContent))
  assert.ok(await page.locator('.fork-cfg-opt mark').count() >= 3)
  assert.match(await page.locator('.fork-cfg-opt-pre').first().innerText(), /变量\s*›\s*活跃魔法少女/)
  await page.keyboard.press('Escape'); assert.equal(await combo.getAttribute('aria-expanded'), 'false'); assert.equal(await pop.count(), 1)
  await page.keyboard.press('Escape'); await pop.waitFor({ state: 'detached' })
  // Thousands of nodes: a broad filter and a 1200-item array render only a window of rows.
  await page.getByRole('button', { name: '电量', exact: true }).click(); await choose(page, pop, '选择变量…'); await combo.click()
  await page.keyboard.type('姓名'); await page.waitForFunction(() => /匹配 1200 项/.test(document.querySelector('.fork-cfg-crumbs')?.textContent))
  assert.ok(await page.locator('.fork-cfg-opt').count() < 60, 'windowed rows')
  await combo.fill(''); await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowLeft')
  await arrowTo(page, '路人档案'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('End')
  assert.equal(await activeLabel(page), '[1199]'); assert.ok(await page.locator('.fork-cfg-opt').count() < 60)
  assert.deepEqual(errors, [])
})

test('reference and formula pickers reject own dependencies, not another mod with the same setting key', async t => {
  const nodes = prefix => [
    {name: prefix + 'Battery', path: '/battery', type: 'number', value: 50, settingKey: 'battery'},
    {name: prefix + 'ComputedBattery', path: '/computed', type: 'number', value: 100, settingsKeys: ['battery']}
  ]
  const {page, errors} = await mount(t, [
    {id: 'mod:dsh.phone', tree: nodes('Own')},
    {id: 'mod:test.other', label: 'Other mod', tree: nodes('Other')}
  ])
  await page.getByRole('button', {name: '电量', exact: true}).click()
  const pop = page.locator('.fork-cfg-pop')
  for (const mode of ['选择变量…', '公式…']) {
    await choose(page, pop, mode)
    await pop.getByRole('combobox').fill('Battery')
    for (const label of ['OwnBattery', 'OwnComputedBattery']) {
      const row = pop.getByRole('option').filter({has: page.locator('.fork-cfg-opt-label', {hasText: new RegExp('^' + label + '$')})})
      await row.waitFor()
      assert.equal(await row.getAttribute('aria-disabled'), 'true', mode + ': ' + label)
    }
    for (const label of ['OtherBattery', 'OtherComputedBattery']) {
      const row = pop.getByRole('option').filter({has: page.locator('.fork-cfg-opt-label', {hasText: new RegExp('^' + label + '$')})})
      await row.waitFor()
      assert.equal(await row.getAttribute('aria-disabled'), null, mode + ': ' + label)
    }
    await page.keyboard.press('Escape')
  }
  assert.deepEqual(errors, [])
})

test('formula box: the picker inserts a chip at the caret; live result and error position', async t => {
  const { page, errors } = await mount(t), pop = page.locator('.fork-cfg-pop')
  await page.getByRole('button', { name: '信号', exact: true }).click(); await pop.waitFor()
  await choose(page, pop, '公式…')
  const box = pop.getByRole('textbox', { name: '公式' }), result = pop.locator('.fork-cfg-result')
  await page.waitForFunction(() => /=\s*4/.test(document.querySelector('.fork-cfg-pop .fork-cfg-result')?.textContent || ''))
  // Caret before the 4: the chip goes there, not at the end.
  await box.click(); await page.keyboard.press('End'); await page.keyboard.type(' + 1')
  await page.keyboard.press('Home')
  await pop.getByRole('combobox').click(); await page.keyboard.type('鹿目圆魔力'); await page.keyboard.press('Enter')
  await page.keyboard.type('/ 30 + ')
  await page.waitForFunction(() => /=\s*8\s*格/.test(document.querySelector('.fork-cfg-pop .fork-cfg-result')?.textContent || ''))
  assert.equal(await box.locator('.fork-cfg-chip').count(), 1)
  assert.match(await result.innerText(), /超出 0–4，按 4/, 'the result is clamped to the field range')
  // An error names its position and marks it.
  await page.keyboard.press('End'); await page.keyboard.type(' /'); await page.waitForFunction(() => document.querySelector('.fork-cfg-pop .fork-cfg-result.is-warn'))
  assert.match(await result.innerText(), /没写完/)
  await page.keyboard.type(' 0')
  await page.waitForFunction(() => /除以 0/.test(document.querySelector('.fork-cfg-pop .fork-cfg-result')?.textContent || ''))
  assert.match(await result.innerText(), /第 \d+ 个字/)
  assert.equal(await page.evaluate(() => CSS.highlights.has('fork-formula-error')), true)
  assert.equal(await box.getAttribute('aria-invalid'), 'true')
  for (let i = 0; i < 4; i++) await page.keyboard.press('Backspace')
  await page.waitForFunction(() => /=\s*8\s*格/.test(document.querySelector('.fork-cfg-pop .fork-cfg-result')?.textContent || ''))
  await page.keyboard.press('Escape'); await pop.waitFor({ state: 'detached' })
  await page.waitForFunction(() => fake.state.card.signal && /^\{mvu:/.test(fake.state.card.signal.formula))
  assert.deepEqual(await page.evaluate(() => fake.state.card.signal), { formula: '{mvu:/活跃魔法少女/鹿目圆/魔力} / 30 + 4 + 1' })
  assert.deepEqual(errors, [])
})
