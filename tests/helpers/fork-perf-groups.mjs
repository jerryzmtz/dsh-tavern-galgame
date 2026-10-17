// Self-contained offline settings harness; ephemeral HTTP server, no host RPCs.
import { chromium } from 'playwright'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { browserReactScript } from '../fixtures/browser-react.mjs'
import path from 'node:path'
const repo = path.resolve('.')
const react = await browserReactScript()
const html = '<!doctype html><html><head><link rel="stylesheet" href="/css/fork-theme.css"></head><body><div id="root"></div><script>' + react + '\nconst React=modules["react"],ReactDOMClient=modules["react-dom/client"];</script><script src="/bundle.js"></script></body></html>'
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x')
    if (url.pathname.startsWith('/css/')) { res.setHeader('Content-Type', 'text/css'); res.end(await readFile(path.join(repo, 'tavern-plugin/lib/client-assets', url.pathname.slice(5)))); return }
    res.setHeader('Content-Type', 'text/html'); res.end(html)
  } catch (error) { res.statusCode = 500; res.end(String(error)) }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
// private fork: the performance fixture uses the actual package grouping views.
const source = (await readFile(new URL('../../tavern-plugin/packages/dsh-asset-library/src/client/groups.js', import.meta.url), 'utf8')).replace(/^export /gm, '')
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio'] })
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
  await page.route('**/bundle.js', route => route.fulfill({ contentType: 'text/javascript', body: source + `
    const {SourceGroups:ForkAssetSourceGroups} = createAssetGroupViews(React, {Icon:() => null, Help:() => null});
    window.runGroups = (count) => {
      const libraries = Array.from({length: 5}, (_, i) => ({id: 'lib'+i, label: 'Library '+i}));
      const items = Array.from({length: count}, (_, i) => ({id: 'item'+i, source: 'library', libraryId: 'lib'+(i%5)}));
      const h = React.createElement;
      const groups = forkAssetSourceGroups(items, libraries);
      ReactDOMClient.createRoot(document.getElementById('root')).render(h('div', {className:'fork-modal-body', style:{height:650, overflow:'auto'}}, h(ForkAssetSourceGroups, {section:'music',groups,render: group => h('div', {className:'fork-music-list'},group.items.map(item => h('div',{key:item.id, className:'fork-music-item',style:{height:68}},h('button',null,'Play'),h('b',null,item.id),h('input',{defaultValue:item.id}),h('button',null,'Edit'),h('span',null,'Music'))))})));
    };` }))
  await page.goto('http://127.0.0.1:' + server.address().port + '/')
  await page.evaluate(() => { window.tasks = []; new PerformanceObserver(list => tasks.push(...list.getEntries().map(e => e.duration))).observe({ type: 'longtask' }); })
  await page.evaluate(() => runGroups(1000))
  await page.waitForTimeout(2000)
  console.log('groups 1000 initial', await page.evaluate(() => ({ longTasks: tasks, rows: document.querySelectorAll('.fork-music-item').length, nodes: document.querySelectorAll('*').length, groups: [...document.querySelectorAll('[data-group]')].map(n => [n.dataset.group, n.classList.contains('is-open')]) })))
  while (await page.locator('[data-group-head][aria-expanded="false"]').count()) await page.locator('[data-group-head][aria-expanded="false"]').first().click()
  for (let i = 0; i < 100 && await page.locator('.fork-asset-load-more').count(); i++) {
    await page.locator('.fork-asset-load-more').first().click(); await page.waitForTimeout(30)
  }
  await page.waitForTimeout(300)
  console.log('groups fully revealed', await page.evaluate(() => ({ longTasks: tasks, rows: document.querySelectorAll('.fork-music-item').length, nodes: document.querySelectorAll('*').length })))
} finally { await browser.close(); server.close() }
