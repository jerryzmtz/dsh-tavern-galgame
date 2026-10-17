// node tests/browser/confirm-dialog-browser-smoke.mjs; open the loopback URL.
// Uses the shipped implementation and styles; no native browser dialogs.
import http from 'node:http'
import { readFile } from 'node:fs/promises'
const bundle = await readFile(new URL('../../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
const css = await readFile(new URL('../../tavern-plugin/lib/client-assets/tavern.css', import.meta.url), 'utf8')
const implementation = bundle.slice(bundle.indexOf('let activeTavernConfirmation = null;'), bundle.indexOf('function useTavernConfirm(scope)'))
const page = `<!doctype html><html><head><meta charset="utf-8"><title>确认框回归</title><style>${css}</style></head><body>
<h1>页面内确认框回归</h1><label>回复输入框<input aria-label="回复输入框"></label><label>右栏输入框<input aria-label="右栏输入框"></label>
<button id="ask">打开确认框</button><button id="abort">模拟切换会话</button><pre id="result">尚未操作</pre>
<script>${implementation}
const result=document.querySelector('#result');
document.querySelector('#ask').onclick=async()=>{const accepted=await askTavernConfirm('确认测试操作？\\n取消不会执行。');result.textContent='结果：'+accepted+'；残留弹窗：'+document.querySelectorAll('dialog').length+'；焦点：'+document.activeElement.id};
document.querySelector('#abort').onclick=async()=>{const controller=new AbortController();const pending=askTavernConfirm('稍后模拟会话切换并取消',{signal:controller.signal});setTimeout(()=>controller.abort(),200);result.textContent='切换会话后结果：'+await pending+'；残留弹窗：'+document.querySelectorAll('dialog').length};
</script></body></html>`
http.createServer((_req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(page)}).listen(8798,'127.0.0.1',()=>console.log('http://127.0.0.1:8798'))
