import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { helperClient } from './helper-host-harness.mjs';
// Optional old source lets this browser regression demonstrate the original failure.
const client = process.env.TAVERN_TEXT_COLORS_SOURCE
 ? runInNewContext((await readFile(process.env.TAVERN_TEXT_COLORS_SOURCE, 'utf8')) + ';({installTavernTextColors,findTavernQuoteRanges})')
 : helperClient;
const browser = await chromium.launch({headless:true});
try {
 const page=await browser.newPage();
 const cdp=await page.context().newCDPSession(page);
 await cdp.send('Performance.enable');
 await page.setContent('<style>body{color:#222}p{line-height:1.8}strong{font-weight:bold}</style>'+Array.from({length:32},()=>'<article>'+('<p>这是一段普通的场景叙述。“你好，<strong>欢迎回来</strong>。” <em>他想起昨天的约定。</em></p>'.repeat(5))+'</article>').join(''));
 await page.evaluate(({install,find})=>{window.install=eval('('+install+')');window.find=eval('('+find+')')},{install:client.installTavernTextColors.toString(),find:client.findTavernQuoteRanges.toString()});
 const before=await cdp.send('Performance.getMetrics');
 const mountMs=await page.evaluate(()=>{const start=performance.now();window.controls=Array.from(document.querySelectorAll('article'),root=>install(root,{enabled:true},find));return performance.now()-start});
 await page.waitForTimeout(500);
 const after=await cdp.send('Performance.getMetrics');
 const metrics=Object.fromEntries(after.metrics.map(m=>[m.name,m.value-(before.metrics.find(x=>x.name===m.name)?.value||0)]));
 const highlights=await page.evaluate(()=>Array.from(CSS.highlights.values()).reduce((n,h)=>n+h.size,0));
 console.log(JSON.stringify({mountMs,recalcCount:metrics.RecalcStyleCount,recalcMs:metrics.RecalcStyleDuration*1000,highlights}));
 assert.equal(highlights,32*5*4);
 assert.ok(metrics.RecalcStyleCount<10,'Mounting a batch of messages must not flush styles once per message');
 // Cancellation before the deferred scan must not leave stale colors or timers.
 await page.evaluate(()=>{
   controls.forEach(control=>control.setEnabled(false));
   controls[0].setEnabled(true);
   controls[0].setEnabled(false);
   const root=document.createElement('article');root.textContent='“pending”';document.body.append(root);
   const pending=install(root,{enabled:true},find);pending.dispose();root.remove();
 });
 await page.waitForTimeout(80);
 assert.equal(await page.evaluate(()=>Array.from(CSS.highlights.values()).reduce((n,h)=>n+h.size,0)),0);
 await page.evaluate(()=>controls.forEach(control=>control.setEnabled(true)));
 await page.waitForTimeout(80);
 assert.equal(await page.evaluate(()=>Array.from(CSS.highlights.values()).reduce((n,h)=>n+h.size,0)),32*5*4);
 await page.evaluate(()=>controls.forEach(control=>control.dispose()));
 assert.equal(await page.evaluate(()=>CSS.highlights.size),0);
 assert.equal(await page.locator('style[data-dsh-tavern-text-colors]').count(),0);
} finally {await browser.close()}
