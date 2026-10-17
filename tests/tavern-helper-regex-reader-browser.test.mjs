import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { chromium } from 'playwright'
import vm from './fixtures/client-vm.mjs'
import { readTavernRuntimeAsset } from '../tavern-plugin/lib/domain/tavern-runtime-assets.js'

test('status frame reads class regexes before filling data and binding collapsible sections', async t => {
  let descriptor
  vm.runInNewContext(await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8'), {
    window: { __ModuleLoader__: { load(value) { descriptor = value } } }, console
  })
  const client = descriptor.factory(() => ({}))
  const server = createServer(async (req, res) => {
    const asset = await readTavernRuntimeAsset(new URL(req.url, 'http://fixture').pathname)
    if (asset) { res.setHeader('content-type', asset.mediaType); res.end(asset.body); return }
    res.setHeader('content-type', 'text/html; charset=utf-8')
    res.end('<!doctype html><iframe style="width:100%;height:600px;border:0"></iframe>')
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const browser = await chromium.launch({ args: ['--mute-audio', `--explicitly-allowed-ports=${server.address().port}`] })
  t.after(() => browser.close())
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  const doc = client.buildTavernFrameDocument({ token: 'class-status', persistent: true, turn: 1,
    helperContext: { character: { name: '角色' }, messages: [{ role: 'assistant', variables: { stat_data: { level: 70 } } }],
      regexScripts: { character: [{ id: 'class-mage', name: '魔道学者技能树', enabled: true, placement: [2] }] } },
    content: `<button class="section-title">游戏数值</button><div class="section-content" hidden></div><script type="module">
      await waitGlobalInitialized('Mvu');
      const regexes = await getTavernRegexes({scope:'character'});
      const active = regexes.find(r => r.enabled && r.script_name.endsWith('技能树'));
      const data = Mvu.getMvuData({type:'message',message_id:getCurrentMessageId()});
      const body = document.querySelector('.section-content');
      body.textContent = active.script_name + ' / ' + data.stat_data.level;
      $('.section-title').on('click', () => { body.hidden = !body.hidden; });
      document.body.dataset.ready = 'yes';
    </script>` })
  for (const width of [1200, 375]) {
    await page.setViewportSize({ width, height: 800 })
    await page.goto('http://127.0.0.1:' + server.address().port)
    await page.locator('iframe').evaluate((frame, html) => { frame.srcdoc = html }, doc)
    const frame = page.frameLocator('iframe')
    await frame.locator('body[data-ready="yes"]').waitFor()
    await frame.locator('.section-title').click()
    assert.equal(await frame.locator('.section-content').isVisible(), true)
    assert.equal(await frame.locator('.section-content').textContent(), '魔道学者技能树 / 70')
    assert.equal(await frame.locator('body').evaluate(() => TavernHelper.getTavernRegexes({scope:'character'})[0].id), 'class-mage')
    await frame.locator('.section-title').click()
    assert.equal(await frame.locator('.section-content').isVisible(), false)
  }
  assert.deepEqual(errors, [])
})
