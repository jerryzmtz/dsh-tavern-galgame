// Synthetic DOM regression for issue #19. No server, model, credentials or user data.
// Run separately from concurrent unit tests: node tests/browser/long-conversation-browser-smoke.mjs
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright'
const css = await readFile(process.env.TAVERN_PERF_CSS || new URL('../../tavern-plugin/lib/client-assets/tavern.css', import.meta.url), 'utf8')
const installer = await readFile(new URL('../../tavern-plugin/src/client/landing-styles.js', import.meta.url), 'utf8')
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Performance.enable')
  await page.setContent(`<!doctype html><style>${css}</style><style>
    #conversation {height:900px;display:flex;flex-direction:column}
    .native_body {min-height:0;flex:1;display:flex;flex-direction:column}
    [data-conversation-scroll] {overflow:auto;flex:1}
    [role=textbox] {position:fixed;bottom:0;background:white;width:600px;min-height:40px}
  </style><body class="dsh-tavern-shell-active"><div id="root"><div data-slot="main.conversation"><div id="conversation" data-phase="hero"><div class="native_body"><div data-conversation-scroll><div id="preset-row"><span>workspace</span><div data-slot="conversation.hero.agentPreset">preset</div></div><div data-composer-seat><div role="textbox" aria-label="输入" contenteditable="true"><p><br></p></div></div></div></div></div></div></div></body>`)
  await page.addScriptTag({ content: process.env.TAVERN_PERF_SKIP_INSTALLER ? 'function installTavernLandingStyles(){return ()=>{}}' : installer })
  await page.evaluate(() => { window.disposeLanding = installTavernLandingStyles(document) })
  const flush = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  await flush()
  assert.equal(await page.locator('.native_body').evaluate(el => getComputedStyle(el).display), 'none', 'landing should hide its composer')
  await page.evaluate(() => { const header = document.createElement('div'); header.dataset.slot = 'conversation.session.header'; document.querySelector('#conversation').prepend(header) })
  await flush()
  assert.notEqual(await page.locator('.native_body').evaluate(el => getComputedStyle(el).display), 'none', 'blank session must retain its composer')
  assert.equal(await page.locator('#preset-row').evaluate(el => getComputedStyle(el).display), 'none', 'hero preset row should remain hidden')
  await page.evaluate(() => {
    const root = document.querySelector('#conversation'); root.dataset.phase = 'active'
    const flow = document.createElement('div'); flow.dataset.chatFlow = ''
    // A similar DOM count to the native 365-message projection, with plain synthetic prose.
    for (let i=0; i<365; i++) {
      const row=document.createElement('div');row.dataset.chatFlowKey=String(i)
      for(let p=0;p<12;p++) { const para=document.createElement('p');para.innerHTML='<span>雨停以后，街道重新安静下来。</span><em>我翻开书页。</em><span>这是完全虚构的性能测试记录。</span>';row.append(para) }
      flow.append(row)
    }
    root.querySelector('[data-conversation-scroll]').prepend(flow)
  })
  await flush()
  const input = page.getByRole('textbox', { name: '输入' })
  await input.click()
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
  await page.evaluate(() => { const root=document.querySelector('#conversation'),query=root.querySelector;window.activeScans=0;root.querySelector=function(...args){window.activeScans++;return query.apply(this,args)} })
  const samples=[]
  for(let i=0;i<3;i++) {
    const before=await cdp.send('Performance.getMetrics')
    await input.fill('测试输入');await input.fill('');await flush()
    const after=await cdp.send('Performance.getMetrics')
    samples.push((after.metrics.find(m=>m.name==='RecalcStyleDuration').value-before.metrics.find(m=>m.name==='RecalcStyleDuration').value)*1000)
  }
  const median=samples.slice().sort((a,b)=>a-b)[1]
  console.log(JSON.stringify({dom:await page.locator('*').count(),styleMs:samples,medianStyleMs:median}))
  assert.ok(median<20, `input/clear causes ${median.toFixed(1)} ms of style work in an inactive landing page`)
  assert.equal(await page.evaluate(() => window.activeScans), 0, 'active input must not scan conversation descendants')
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })
  await page.evaluate(() => {
    const previous=document.querySelector('#conversation');window.retiredRoot=previous
    const next=document.createElement('div');next.id='next';next.dataset.phase='hero'
    next.innerHTML='<div class="native_body"><div data-conversation-scroll></div></div>'
    previous.replaceWith(next)
  })
  await flush()
  assert.equal(await page.locator('#next').evaluate(el=>el.classList.contains('dsh-tavern-landing')), false)
  await page.evaluate(() => { const seat=document.createElement('div');seat.dataset.composerSeat='';document.querySelector('#next [data-conversation-scroll]').append(seat) })
  await flush()
  assert.equal(await page.locator('#next .native_body').evaluate(el=>getComputedStyle(el).display), 'none', 'late composer mount should activate the landing page')
  await page.evaluate(() => window.disposeLanding())
  assert.equal(await page.locator('.dsh-tavern-landing,.dsh-tavern-hero-preset-row').count(), 0, 'dispose removes only owned markers')
  await page.evaluate(() => {
    const picker=document.createElement('div');picker.className='dsh-tavern-card-picker'
    picker.innerHTML='<div class="dsh-tavern-card-picker-head">开场白</div><div class="dsh-tavern-greeting-preview">预览正文</div><button>开始新游戏</button>';document.body.append(picker)
  })
  assert.deepEqual(await page.locator('.dsh-tavern-card-picker').evaluate(el=>({display:getComputedStyle(el).display,shrink:[...el.children].map(child=>getComputedStyle(child).flexShrink)})),{display:'flex',shrink:['0','0','0']})
  await browser.close()
} finally { await browser.close() }
