// private fork: the adopted upstream image controls must survive the fork's CSS.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright'

for (const touch of [false, true]) test('upstream image action and redraw controls remain visible: ' + (touch ? 'touch' : 'desktop'), async t => {
  const browser = await chromium.launch({ headless: true })
  t.after(() => browser.close())
  const page = await browser.newPage({ viewport: { width: touch ? 390 : 1280, height: 800 }, hasTouch: touch, isMobile: touch })
  const read = file => readFile(new URL('../tavern-plugin/' + file, import.meta.url), 'utf8')
  const css = await read('lib/client-assets/tavern.css') + '\n' + await read('lib/client-assets/fork-theme.css')
  await page.setContent('<html><head><style>' + css + '</style></head><body class="dsh-tavern-shell-active"><main data-dsh-fork-session="play"><div data-turn-tail><div><div data-slot="conversation.chat.assistant-actions"><button class="dsh-tavern-message-fork">fork</button><button class="dsh-tavern-message-fork dsh-tavern-message-illustrate">image</button></div></div></div><div class="dsh-tavern-illustration"><a href="#"><img alt="fixture" src="data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'320\' height=\'180\'%3E%3Crect width=\'320\' height=\'180\' fill=\'gray\'/%3E%3C/svg%3E"></a><div class="dsh-tavern-image-actions"><button data-fork-image-action="redraw" aria-label="redraw">redraw</button></div><div class="dsh-tavern-image-adjust dsh-tavern-image-repaint"><textarea aria-label="prompt">test prompt</textarea><div class="dsh-tavern-image-repaint-actions"><button>cancel</button><button>repaint</button><button>replan</button></div></div></div></main></body></html>')
  assert.equal(await page.locator('.dsh-tavern-message-illustrate').isVisible(), true)
  assert.equal(await page.locator('.dsh-tavern-message-fork:not(.dsh-tavern-message-illustrate)').isVisible(), false)
  if (!touch) await page.locator('.dsh-tavern-illustration img').hover()
  assert.equal(await page.getByRole('button', { name: 'redraw', exact: true }).isVisible(), true)
  for (const name of ['cancel', 'repaint', 'replan']) assert.equal(await page.getByRole('button', { name, exact: true }).isVisible(), true)
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
})
