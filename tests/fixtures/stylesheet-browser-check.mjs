import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const source=await readFile(new URL('../../tavern-plugin/lib/client.js',import.meta.url),'utf8');
let requests=0;
const server=createServer((req,res)=>{
 if(req.url.startsWith('/api/')){requests++;res.writeHead(502);res.end('Bad Gateway');return}
 res.end('<button class="dsh-tavern-btn">DSH Tavern</button>');
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch();
try{
 const page=await browser.newPage();await page.goto('http://127.0.0.1:'+server.address().port);
 await page.evaluate(()=>{window.__ModuleLoader__={load(value){window.descriptor=value}}});
 await page.addScriptTag({content:source});
 await page.evaluate(()=>descriptor.factory(()=>({})));
 const styles=page.locator('style[data-plugin-css]');
 assert.equal(await styles.count(),1);
 assert.equal(await page.locator('button').evaluate(e=>getComputedStyle(e).borderRadius),'6px');
 await page.evaluate(()=>{descriptor.factory(()=>({}));descriptor.factory(()=>({}))});
 assert.equal(await styles.count(),1);
 // A live upgrade must cancel the former retry loader and remove its link.
 await page.evaluate(()=>{
   const link=document.createElement('link');link.dataset.pluginCss='dsh-tavern-plugin/tavern.css';document.head.appendChild(link);
   window.disposed=false;document.__dshTavernStylesheet={dispose(){window.disposed=true}};
   document.querySelector('style[data-plugin-css]').textContent='button{border-radius:0}';
   descriptor.factory(()=>({}));
 });
 assert.equal(await page.evaluate(()=>window.disposed),true);
 assert.equal(await page.locator('link[data-plugin-css]').count(),0);
 assert.equal(await page.locator('button').evaluate(e=>getComputedStyle(e).borderRadius),'6px');
 assert.equal(await styles.count(),1);
 assert.equal(requests,0,'core styles never request the failing CSS endpoint');
 console.log('PASS: bundled production CSS applies without requests; repeated load and live upgrade preserve one style');
}finally{await browser.close();server.close()}
