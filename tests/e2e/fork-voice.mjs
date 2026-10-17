// Opt-in: run only against an isolated DSH fixture, never the live desktop.
import { chromium } from 'playwright'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
const url = process.env.TAVERN_VOICE_E2E_URL
if (process.env.TAVERN_VOICE_E2E_ISOLATED !== '1' || !url || new URL(url).hostname !== '127.0.0.1' || ['43120','43121'].includes(new URL(url).port)) throw new Error('Set TAVERN_VOICE_E2E_ISOLATED=1 and TAVERN_VOICE_E2E_URL to an isolated preview')
const root = await mkdtemp(join(tmpdir(), 'tavern-voice-e2e-'))
async function chat(page) {
  const welcome = page.getByRole('button', { name: 'Continue', exact: true })
  if (await welcome.isVisible().catch(() => false)) await welcome.click()
  const group = page.locator('.dsh-tavern-history-group').filter({ hasText: process.env.TAVERN_VOICE_E2E_CARD || '见泷原' }).first()
  const row = group.locator('.dsh-tavern-side-row-main').first()
  if (!await row.isVisible().catch(() => false)) await group.locator('.dsh-tavern-history-group-toggle').click()
  await row.click()
  await page.locator('.dsh-tavern-assistant').first().waitFor({ timeout: 20000 })
  await page.waitForTimeout(1000)
}
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } })
const errors = [], audio = []
page.on('pageerror', error => errors.push(error.message))
page.on('response', response => { if (response.url().includes('/voice-audio')) audio.push(response.status()) })
try {
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await chat(page)
  await page.locator('[data-slot="rightbar"] button[aria-label="新标签页"]').first().click()
  await page.locator('.fork-guide-tile[data-sidebar-right-guide-entry="dsh-tavern:bubbles"]').click()
  const panel = page.locator('.fork-voice-settings')
  const enabled = panel.getByRole('checkbox', { name: '启用配音' })
  if (!await enabled.isChecked()) await panel.locator('label:has(input[aria-label="启用配音"])').click()
  assert.equal(await enabled.isChecked(), true)
  const start = panel.getByRole('button', { name: '启动 / 重试', exact: true })
  const ready = panel.getByRole('status').filter({ hasText: '服务就绪' })
  await start.or(ready).first().waitFor()
  if (await start.isVisible()) await start.click()
  await ready.waitFor({ timeout: 60000 })
  await panel.getByRole('button', { name: '试听晓美焰' }).click()
  await panel.locator('.fork-voice-button[data-voice-state="ready"]').waitFor({ timeout: 120000 })
  assert.equal(await panel.locator('.fork-bubble-portrait > .fork-voice-button').count(), 1)
  assert.equal(await panel.locator('.fork-bubble-head .fork-voice-button').count(), 0)
  assert.equal(await panel.locator('.fork-voice-button').textContent(), '')
  const badgeBox = await panel.locator('.fork-voice-button').evaluate(button => {
    const style = getComputedStyle(button), disc = getComputedStyle(button, '::before');
    return { width: style.width, height: style.height, padding: style.padding, minWidth: style.minWidth, radius: disc.borderRadius, disc: disc.width };
  })
  assert.deepEqual(badgeBox, { width: '30px', height: '30px', padding: '0px', minWidth: '0px', radius: '50%', disc: '22px' }, 'real host button styles must not reshape the corner badge')
  const enlargedDisc = await panel.locator('.fork-voice-button').evaluate(button => {
    const bubble = button.closest('.fork-bubble'), before = bubble.style.fontSize;
    try { bubble.style.fontSize = '30px'; return getComputedStyle(button, '::before').width; }
    finally { bubble.style.fontSize = before; }
  })
  assert.equal(enlargedDisc, '22px')
  assert.equal(await panel.locator('.fork-bubble-line').textContent(), '小圆，不用担心。我会陪在你身边。')
  assert.equal(audio.length, 0, 'Preparing must not autoplay or fetch playback audio')
  let releaseAudio
  const heldAudio = new Promise(resolve => { releaseAudio = resolve })
  await page.route('**/api/dsh-tavern/voice-audio?*', async route => { await heldAudio; await route.continue() })
  await panel.locator('.fork-voice-button').click()
  await panel.locator('.fork-voice-button[data-voice-state="loading"] .fork-voice-spinner').waitFor()
  assert.equal(await panel.locator('.fork-voice-button').isDisabled(), true)
  releaseAudio()
  await panel.getByRole('button', { name: '暂停播放', exact: true }).waitFor({ timeout: 20000 })
  await panel.locator('.fork-voice-button').click()
  await panel.getByRole('button', { name: '继续播放', exact: true }).waitFor()
  assert(audio.includes(200))
  await panel.getByRole('textbox', { name: '试音气泡' }).fill('@bubble:homura|晓美焰|平静|[不用担心，我会在这里。]')
  await panel.getByRole('button', { name: '用这句试听' }).click()
  await panel.locator('.fork-voice-button[data-voice-state="ready"]').waitFor({ timeout: 120000 })
  if (process.env.TAVERN_VOICE_E2E_STREAM === '1') {
  const before = audio.length
  const composer = page.locator('[data-composer-card] textarea, [data-composer-card] [contenteditable="true"]').first()
  await composer.fill('VOICE_E2E 本地配音流水线测试')
  await composer.press('Enter')
  await page.locator('.dsh-tavern-assistant[data-streaming="true"]').waitFor({ timeout: 30000 })
  await page.waitForFunction(() => !document.querySelector('.dsh-tavern-assistant[data-streaming="true"]'), { timeout: 60000 })
  await page.waitForFunction(() => { const a = [...document.querySelectorAll('.dsh-tavern-assistant')].at(-1); return a && [...a.querySelectorAll('.fork-voice-button')].filter(b => b.dataset.voiceState === 'ready').length === 2 }, { timeout: 90000 })
  assert.equal(audio.length, before, 'New replies must prepare without autoplay')
  }
  await page.screenshot({ path: root + '/voice-desktop.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: root + '/voice-mobile.png', fullPage: true })
  assert.deepEqual(errors, [])
  await writeFile(root + '/voice-results.json', JSON.stringify({ errors, audio, passed: true }, null, 2))
  console.log('PASS: DSH voice integration; artifacts:', root)
} catch (error) {
  await page.screenshot({ path: root + '/voice-failed.png', fullPage: true })
  console.log('PAGE_ERRORS', errors)
  throw error
} finally { await browser.close() }
