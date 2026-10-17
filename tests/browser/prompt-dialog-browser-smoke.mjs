// Real browser check for the shared in-app text prompt (askTavernText).
//
// Electron never implements window.prompt, so every entry point that relied on it
// failed silently on desktop: prompt returns undefined (or throws), guards written as
// `value === null` fell through, and the async caller swallowed the result. This pins
// the replacement's keyboard, pointer and async-failure behaviour.
//
// The function source is extracted from the shipped bundle and evaluated as-is, so the
// check covers the real bytes rather than a copy. Set PLAYWRIGHT_CHROMIUM_EXECUTABLE to
// point at a Chromium build when the default Playwright download is unavailable.
import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const bundle = await readFile(new URL('../../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
const css = await readFile(new URL('../../tavern-plugin/lib/client-assets/tavern.css', import.meta.url), 'utf8')

function extractFunction(text, name) {
  const start = text.indexOf('function ' + name + '(options) {')
  if (start < 0) throw new Error('askTavernText is missing from the built client')
  let depth = 0
  for (let index = text.indexOf('{', start); index < text.length; index += 1) {
    if (text[index] === '{') depth += 1
    else if (text[index] === '}') { depth -= 1; if (depth === 0) return text.slice(start, index + 1) }
  }
  throw new Error('askTavernText is not balanced')
}

const dialogSource = extractFunction(bundle, 'askTavernText')
// The host supplies these theme variables in the real client; pin light values here.
const theme = ':root{--dsw-alias-border-l2:#d0d0d8;--dsw-specific-sidebar-fill:#fff;--dsw-alias-label-primary:#111;--dsw-specific-input-major:#f6f6f8;--dsw-alias-label-secondary:#666;--dsw-alias-label-tertiary:#888}body{margin:0}'
const launch = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}
const browser = await chromium.launch(launch)
const page = await browser.newPage({ viewport: { width: 900, height: 700 } })
try {
  await page.setContent(`<style>${theme}</style><style>${css}</style>`)
  await page.evaluate((source) => { window.askTavernText = new Function(source + '; return askTavernText;')() }, dialogSource)

  const input = page.locator('.dsh-tavern-prompt-input')
  const confirmButton = page.locator('.dsh-tavern-prompt-actions button').nth(1)
  const cancelButton = page.locator('.dsh-tavern-prompt-actions button').nth(0)
  const mounted = () => page.locator('dialog.dsh-tavern-prompt').count()
  const outcome = async () => {
    await page.waitForFunction(() => window.__result && window.__result.settled === true, null, { timeout: 4000 })
    return page.evaluate(() => window.__result.value)
  }
  // A closed <dialog> removes itself on a later task, so a new dialog opened too early
  // would leave the previous node behind and the locators above would resolve to it.
  const open = async (config) => {
    await page.waitForFunction(() => !document.querySelector('dialog.dsh-tavern-prompt'))
    await page.evaluate((value) => {
      window.__result = { settled: false, value: undefined }
      window.__pending = window.askTavernText(value).then((resolved) => { window.__result = { settled: true, value: resolved } })
    }, config)
    await page.waitForSelector('dialog.dsh-tavern-prompt')
  }

  await open({ title: '重命名对话', initialValue: '旧名字', maxLength: 80 })
  assert.equal(await page.evaluate(() => { const dialog = document.querySelector('dialog.dsh-tavern-prompt'); return Boolean(dialog && dialog.open && dialog.parentElement === document.body) }), true)
  assert.equal(await page.locator('.dsh-tavern-prompt-title').innerText(), '重命名对话')
  assert.equal(await input.inputValue(), '旧名字')
  assert.equal(await page.evaluate(() => document.activeElement === document.querySelector('.dsh-tavern-prompt-input')), true, 'the input takes focus')
  assert.equal(await page.evaluate(() => { const item = document.querySelector('.dsh-tavern-prompt-input'); return item.selectionStart === 0 && item.selectionEnd === item.value.length }), true, 'the initial value is selected')
  await input.fill('  新名字  ')
  await confirmButton.click()
  assert.equal(await outcome(), '新名字', 'confirm resolves the trimmed value')
  await page.waitForFunction(() => !document.querySelector('dialog.dsh-tavern-prompt'))
  assert.equal(await mounted(), 0, 'the dialog is removed from the DOM')

  await open({ title: '重命名文件', initialValue: 'a.txt' })
  await page.keyboard.press('Escape')
  assert.equal(await outcome(), null, 'Escape cancels')

  await open({ title: '重命名文件', initialValue: 'a.txt' })
  await page.mouse.click(6, 6)
  assert.equal(await outcome(), null, 'a backdrop click cancels')

  await open({ title: '重命名文件', initialValue: 'a.txt' })
  await cancelButton.click()
  assert.equal(await outcome(), null, 'the cancel button cancels')

  await open({ title: '新画像名称', initialValue: '' })
  assert.equal(await confirmButton.isDisabled(), true, 'an empty value keeps confirm disabled')
  await input.fill('我的画像')
  assert.equal(await confirmButton.isDisabled(), false)
  await input.press('Enter')
  assert.equal(await outcome(), '我的画像', 'Enter submits')

  await open({ title: '重命名对话', initialValue: '', maxLength: 5 })
  await input.fill('1234567890')
  assert.equal(await input.inputValue(), '12345', 'maxLength is enforced')
  await cancelButton.click()
  await outcome()

  // A rejected submit keeps the dialog open with an inline error, and a retry succeeds.
  await page.evaluate(() => {
    window.__failOnce = true
    window.__result = { settled: false, value: undefined }
    window.__pending = window.askTavernText({
      title: '修改故事中的玩家称呼',
      description: '仅影响之后生成的内容，不会重写历史消息。',
      initialValue: '测试称呼',
      onSubmit: function () {
        if (window.__failOnce) { window.__failOnce = false; return Promise.reject(new Error('首次保存失败')) }
        return Promise.resolve()
      }
    }).then((value) => { window.__result = { settled: true, value } })
  })
  await page.waitForSelector('dialog.dsh-tavern-prompt')
  await confirmButton.click()
  await page.waitForSelector('.dsh-tavern-prompt-error:not([hidden])')
  assert.equal(await mounted(), 1, 'a failed save keeps the dialog open')
  assert.equal(await page.locator('.dsh-tavern-prompt-error').innerText(), '首次保存失败')
  assert.equal(await input.isDisabled(), false, 'a failed save restores editing')
  assert.equal(await confirmButton.innerText(), '确认')
  await confirmButton.click()
  assert.equal(await outcome(), '测试称呼', 'a retry resolves with the value')

  // While onSubmit is pending the dialog must not be dismissible.
  await page.evaluate(() => {
    window.__release = null
    window.__result = { settled: false, value: undefined }
    window.__pending = window.askTavernText({
      title: '修改故事中的玩家称呼',
      initialValue: '测试称呼',
      onSubmit: function () { return new Promise((resolve) => { window.__release = resolve }) }
    }).then((value) => { window.__result = { settled: true, value } })
  })
  await page.waitForSelector('dialog.dsh-tavern-prompt')
  await confirmButton.click()
  await page.waitForFunction(() => typeof window.__release === 'function')
  await page.mouse.click(6, 6)
  assert.equal(await mounted(), 1, 'a pending save ignores backdrop clicks')
  assert.equal(await confirmButton.innerText(), '保存中…')
  await cancelButton.click({ force: true })
  assert.equal(await mounted(), 1, 'a pending save ignores cancel')
  await page.evaluate(() => window.__release())
  assert.equal(await outcome(), '测试称呼', 'the dialog closes once the save settles')

  // Enter during IME composition must not submit a half-typed name.
  await open({ title: '重命名文件', initialValue: '' })
  await input.fill('测')
  await input.dispatchEvent('keydown', { key: 'Enter', isComposing: true })
  await page.waitForTimeout(150)
  assert.equal(await page.evaluate(() => window.__result.settled), false, 'composition Enter does not submit')
  await input.dispatchEvent('keydown', { key: 'Enter', isComposing: false, keyCode: 229 })
  assert.equal(await page.evaluate(() => window.__result.settled), false, 'WebKit composition confirmation does not submit after compositionend')
  await cancelButton.click()
  await outcome()

  await open({ title: '重新结算变量', allowEmpty: true, confirmLabel: '重新结算' })
  assert.equal(await confirmButton.isEnabled(), true)
  await confirmButton.click()
  assert.equal(await outcome(), '', 'optional guidance accepts an empty value')

  console.log('PASS: askTavernText focuses and preselects, trims on confirm, cancels on Escape/backdrop/button, blocks empty and over-long input, keeps the dialog open across a failed submit, locks while saving, and ignores composition Enter')
} finally {
  await browser.close()
}
