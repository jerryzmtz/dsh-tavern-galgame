import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright'
const css = await readFile(new URL('../../tavern-plugin/lib/client-assets/tavern.css', import.meta.url), 'utf8')
const themes = JSON.parse(await readFile(new URL('../../tavern-plugin/packages/dsh-dream-skin/tavern-themes.json', import.meta.url), 'utf8'))
const browser = await chromium.launch()
try {
 const page = await browser.newPage()
 await page.setContent('<style id="theme"></style><style>'+css+'</style><main class="dsh-tavern-status"><button class="dsh-card-primary">添加 Guide</button><button class="dsh-tavern-btn">重新加载</button></main>')
 for (const theme of [...themes, { tokens: { '--dsw-alias-brand-primary': '#2196f3', '--dsw-alias-label-primary': '#102030', '--dsw-alias-bg-base': '#fff', '--dsw-alias-bg-layer-1': '#eee', '--dsw-alias-border-l2': '#ddd' }}]) {
  await page.evaluate(tokens => document.querySelector('#theme').textContent = 'body{'+Object.entries(tokens).map(([k,v])=>k+':'+v).join(';')+'}', theme.tokens)
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.dsh-tavern-btn')).color === getComputedStyle(document.querySelector('.dsh-card-primary')).backgroundColor)
  const result = await page.evaluate(() => {
   const primary = document.querySelector('.dsh-card-primary'), secondary = document.querySelector('.dsh-tavern-btn')
   const probe=document.createElement('span');probe.style.color='var(--dsw-alias-brand-primary)';document.body.append(probe)
   const accent=getComputedStyle(probe).color;probe.remove()
   return { accent, primary:getComputedStyle(primary).backgroundColor, secondary:getComputedStyle(secondary).color }
  })
  assert.equal(result.primary,result.accent);assert.equal(result.secondary,result.accent)
 }
 await page.setViewportSize({width:390,height:844})
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
 console.log('PASS: light/dark Terracotta, blue skin, primary/secondary controls and narrow viewport')
} finally { await browser.close() }
