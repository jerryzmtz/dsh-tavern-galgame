// private fork: real React and Chromium regression for the virtual backlog's layout feedback.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { browserReactScript } from './fixtures/browser-react.mjs'

const read = name => readFile(new URL('../' + name, import.meta.url), 'utf8')
test('backlog settles when opened, resized and rapidly scrolled with 1000 rows', async t => {
  const browser = await chromium.launch({ headless: true })
  t.after(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 1100, height: 700 } })
  const errors = []
  page.on('pageerror', error => errors.push(String(error)))
  await page.setContent('<!doctype html><div id="root" class="fork-gal-stage" data-theme="classic"></div>')
  await page.addStyleTag({ content: await read('tavern-plugin/lib/client-assets/fork-theme.css') })
  await page.addStyleTag({ content: '.fork-gal-backlog-text { font-size: 17px; line-height: 23.37px; }' })
  await page.addScriptTag({ content: await browserReactScript() + `
    const React=modules.react, ReactDOM=modules['react-dom/client'];
    const forkVoicePlayer={subscribe:()=>()=>{},get:()=>null};
    function useLiveTavernView(){return null}
    function ForkHelpTip(){return null}
    function ForkIcon(){return null}
    ` + await read('tavern-plugin/src/client/fork-gal-backlog.js') })
  await page.evaluate(() => {
    const root = ReactDOM.createRoot(document.getElementById('root'))
    const pages = Array.from({length:1000}, (_,i) => ({kind:'narration',text:'Row '+i+' '+('Some text to wrap. '.repeat(i%7+1)),para:i+1}))
    const index = new Map(Array.from({length:100},(_,i)=>[i+1,{units:pages.slice(i*10,i*10+10)}]))
    window.mount = () => modules['react-dom'].flushSync(() => root.render(React.createElement(ForkGalBacklog, {
      sessionId:'offline',turn:101,pages:pages.slice(0,10),page:9,textIndex:index,onClose(){},onJump(){}
    })))
    window.mount()
  })
  await page.waitForTimeout(300)
  assert.deepEqual(errors, [])
  for (const height of [0, 333, 601, 700]) {
    await page.evaluate(height => {
      document.getElementById('root').style.height = height+'px'
      const box = document.querySelector('.fork-gal-backlog-list')
      for(let i=0;i<15;i++) { box.scrollTop = (i%3)*box.scrollHeight/3; box.dispatchEvent(new Event('scroll')) }
    },height)
    await page.waitForTimeout(100)
    assert.deepEqual(errors, [])
  }
  for (let i = 0; i < 80; i++) {
    await page.setViewportSize({width:700+i*7,height:400+i%17*13})
    await page.evaluate(i => {
      document.querySelector('.fork-gal-backlog-list').scrollTop = i%2 ? 1e9 : 35000+i*13
    }, i)
    await page.waitForTimeout(20)
    assert.deepEqual(errors, [], 'resize '+i)
  }
  // Crossing turn separators changes collapsed margins at the leading spacer. Native scroll
  // anchoring used to fight the component's pendingScroll correction until React threw #185.
  await page.evaluate(async () => {
    for(let i=0;i<400;i++) {
      const box=document.querySelector('.fork-gal-backlog-list'); if(!box) break;
      box.scrollTop= i*41;
      await new Promise(requestAnimationFrame);
    }
  })
  assert.deepEqual(errors, [])
  assert.ok(await page.locator('.fork-gal-backlog-row').count() < 100)
})
