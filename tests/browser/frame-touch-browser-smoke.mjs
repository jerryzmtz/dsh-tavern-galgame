// Manual browser fixture: node tests/browser/frame-touch-browser-smoke.mjs
// Uses synthetic TouchEvents to verify real DOM/layout and postMessage routing.
// Physical-device native gesture behavior still requires Android acceptance.
import http from 'node:http'
import { readFile } from 'node:fs/promises'
const client = await readFile(new URL('../../tavern-plugin/lib/client.js', import.meta.url))
const page = `<!doctype html><meta charset="utf-8"><title>Issue 44 touch relay regression</title>
<style>#conversation{height:400px;overflow:auto;scroll-behavior:smooth}iframe{height:320px;width:95%;border:1px solid}#spacer{height:2000px}</style>
<h1>Issue 44 — browser layout regression</h1><button id="run">运行滚动接力测试</button><pre id="result">等待测试</pre><div id="conversation"><div id="mount"></div><div id="spacer"></div></div>
<script>window.__ModuleLoader__={load(value){window.client=value.factory(()=>({}))}};</script><script src="/client.js"></script>
<script>
const trace=[];addEventListener('message',e=>{if(e.data?.type?.includes('frame-touch')||e.data?.type==='dsh-tavern-frame-scroll')trace.push(e.data)});
const content='<div id="inner" style="height:100px;overflow-y:auto;touch-action:none;scroll-behavior:smooth"><div style="height:200px">测试正文：内层先滚动，剩余交给外层</div></div>';
const life=client.createTavernMessageFrameLifecycle({content,eager:true,runtimeReporting:false},{window});
const release=life.start(()=>{}), doc=life.snapshot().visibleDocument, frame=document.createElement('iframe');
frame.srcdoc=doc.html;document.querySelector('#mount').append(frame);doc.ref(frame);
const pause=()=>new Promise(resolve=>setTimeout(resolve,30));
document.querySelector('#run').onclick=async()=>{
 const out=document.querySelector('#result'),outer=document.querySelector('#conversation'),w=frame.contentWindow,inner=w.document.querySelector('#inner');
 try {
 const gesture=(type,y)=>{const point=new w.Touch({identifier:1,target:inner,screenX:100,screenY:y,clientX:100,clientY:y});inner.dispatchEvent(new w.TouchEvent(type,{bubbles:true,cancelable:true,touches:type==='touchend'?[]:[point],changedTouches:[point]}))};
 outer.scrollTo({top:0,behavior:'instant'});inner.scrollTo({top:90,behavior:'instant'});
 gesture('touchstart',200);gesture('touchmove',100);await pause();
 if(inner.scrollTop!==100||outer.scrollTop!==90)throw Error('partial consumption: '+inner.scrollTop+'/'+outer.scrollTop);
 gesture('touchcancel',100);
 inner.style.touchAction='pan-y';outer.scrollTo({top:0,behavior:'instant'});
 gesture('touchstart',200);gesture('touchmove',150);gesture('touchmove',100);gesture('touchend',100);await pause();
 if(outer.scrollTop!==0)throw Error('native pan received synthetic scroll');
 inner.style.touchAction='none';gesture('touchstart',200);gesture('touchmove',160);await pause();gesture('touchstart',160);gesture('touchmove',140);await pause();gesture('touchmove',120);await pause();
 if(outer.scrollTop!==80)throw Error('fresh gesture cancelled by stale stop: '+outer.scrollTop);
 gesture('touchcancel',120);release();
 out.textContent='PASS: inner 10px + outer 90px; smooth CSS bypassed; native pan untouched; new gesture survives old cancellation; lifecycle disposed';
 }catch(error){out.textContent='FAIL: '+error.stack+' '+JSON.stringify(trace)}
};
</script>`
http.createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/client.js'?'application/javascript':'text/html; charset=utf-8');res.end(req.url==='/client.js'?client:page)}).listen(8796,'127.0.0.1',()=>console.log('http://127.0.0.1:8796'))
