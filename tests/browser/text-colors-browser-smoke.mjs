import { createServer } from 'node:http'
import { helperClient as client } from '../fixtures/helper-host-harness.mjs'
const sample = `<p>走廊里很安静。她停下脚步，轻声说：<br>“你好，<strong>很高兴</strong>见到你。”</p>
<p><em>他会记得昨天的约定吗？</em> 她望向窗外。</p>
<p><q>这是 HTML 引用。</q> <span style="color:#4aa696">“人物卡指定的颜色”</span></p>
<p><code>const text = "代码保持原样";</code> <a href="#link">“链接保持原样”</a></p>
<p><button>“按钮保持原样”</button> <span class="own-color">“CSS 指定的颜色”</span></p>`;
let frame = client.buildTavernFrameDocument({ content: '<style>.cote-content{color:#d4d4d8;background:#20212c;padding:16px;font:17px/1.8 sans-serif}.own-color{color:#4aa696}</style><div class="cote-content">'+sample+'</div>', token:'color-smoke' });
frame = frame.replace(/<link\b[^>]*>/g,'');
const inside = `<script>window.cardLoadCount=1;parent.postMessage({type:'color-test-boot'},'*');
addEventListener('message',event=>{if(event.data?.type!=='inspect-colors')return;
setTimeout(()=>parent.postMessage({type:'frame-colors', count:Array.from(CSS.highlights.values()).reduce((sum,h)=>sum+h.size,0), loads:window.cardLoadCount, styles:document.querySelector('style[data-dsh-tavern-text-colors]')?.textContent},'*'),60);});<\/script>`;
frame = frame.replace('</body>', inside+'</body>');
const server=createServer((request,response)=>{
 if(request.url.startsWith('/api/')) {response.writeHead(200,{'Content-Type':'text/css'});response.end('');return;}
 response.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});
 response.end(`<!doctype html><meta charset="utf-8"><title>正文分色验证</title>
 <style>body{background:#f5f3ee;color:#252830;font:17px/1.8 sans-serif;max-width:1100px;margin:30px auto}h1{font-size:24px}main{display:grid;grid-template-columns:1fr 1fr;gap:24px}article{padding:20px;background:white;border-radius:12px}iframe{width:100%;height:390px;border:0}button{padding:4px 12px}code{font-size:13px}.own-color{color:#458270}pre{font-size:12px}#result{margin-top:20px}</style>
 <h1>正文分色</h1><p>普通文字保持原色 · 对白与斜体跟随主题强调色</p>
 <p><label>对白颜色 <input id=quote type=color value="#e8a882"></label>　<label>斜体颜色 <input id=em type=color value="#c4b5d4"></label>　<button id=reset>恢复默认配色</button></p><main><article><h2>普通正文 · 浅色</h2><div id="prose">${sample}</div></article><article style="background:#20212c;color:#d4d4d8"><h2>人物卡 HTML · 深色</h2><iframe id="frame" sandbox="allow-scripts"></iframe></article></main><pre id="result">RUNNING</pre>
 <script type="module">
 const create=${client.installTavernTextColors.toString()}, find=${client.findTavernQuoteRanges.toString()};
 const prose=document.querySelector('#prose'), original=prose.innerHTML, controls=create(prose,{enabled:true},find);
 const textRanges=()=>Array.from(CSS.highlights.values()).flatMap(h=>Array.from(h,r=>r.toString()));
 const check=(ok,label)=>{if(!ok)throw Error(label)};
 let frameStep=0; const frame=document.querySelector('#frame');
 let overrides={};
 function send(enabled){frame.contentWindow.postMessage({type:'dsh-tavern-text-colors',token:'color-smoke',enabled,textColorOverrides:overrides},'*');frame.contentWindow.postMessage({type:'inspect-colors'},'*');}
 try {
  await new Promise(resolve=>setTimeout(resolve,80));
  const ranges=textRanges();
  check(ranges.some(x=>x.includes('很高兴')),'quote across inline markup');
  check(ranges.some(x=>x.includes('昨天的约定')),'emphasis');
  check(!ranges.some(x=>/保持原样|指定的颜色/.test(x)),'preserve code UI links and author colors');
  check(prose.innerHTML===original,'DOM/source unchanged');
  controls.setColors({quote:'#112233',em:'#445566'});
  check(document.querySelector('style[data-dsh-tavern-text-colors]').textContent.includes('#112233'),'custom quote color');
  check(document.querySelector('style[data-dsh-tavern-text-colors]').textContent.includes('#445566'),'custom emphasis color');
  check(prose.innerHTML===original,'color change preserves DOM');
  controls.setColors({});
  check(document.querySelector('style[data-dsh-tavern-text-colors]').textContent.includes('var(--dsw-alias-brand-primary, currentColor)'),'restore theme accent');
  const theme = document.createElement('style');document.head.appendChild(theme);
  const highlighted = () => getComputedStyle(prose, '::highlight(' + CSS.highlights.keys().next().value + ')').color;
  theme.textContent = 'body{--dsw-alias-brand-primary:#0071e3}';
  check(highlighted()==='rgb(0, 113, 227)','theme accent inherited');
  theme.textContent = 'body{--dsw-alias-brand-primary:#e91e63}';
  check(highlighted()==='rgb(233, 30, 99)','theme stylesheet change updates immediately');
  theme.remove();check(highlighted()===getComputedStyle(prose).color,'missing token keeps readable text');
  controls.setEnabled(false);check(textRanges().length===0,'disable');controls.setEnabled(true);
  const stream=document.createElement('p');stream.textContent='“还没说完';prose.appendChild(stream);
  setTimeout(()=>{try{
   check(!textRanges().some(x=>x.includes('还没说完')),'incomplete quote');
   stream.firstChild.data+='的话。”';
   setTimeout(()=>{try {check(textRanges().some(x=>x.includes('还没说完')),'streaming refresh');stream.remove();}catch(error){document.querySelector('#result').textContent='FAIL '+error.message}},80);
  }catch(error){document.querySelector('#result').textContent='FAIL '+error.message}},80);
  addEventListener('message',event=>{try {
   if(event.source!==frame.contentWindow)return;
   if(['dsh-tavern-frame-ready','color-test-boot'].includes(event.data?.type)&&frameStep===0){frameStep=1;document.querySelector('#result').textContent='RUNNING ready';send(true);}
   if(event.data?.type==='frame-colors'&&frameStep<4){document.querySelector('#result').textContent='RUNNING frame phase '+frameStep;
    check(event.data.loads===1,'toggle does not reload card');
    if(frameStep===1){check(event.data.count>0,'isolated iframe enabled');frameStep=2;send(false);}
    else if(frameStep===2){check(event.data.count===0,'isolated iframe disabled');frameStep=3;overrides={quote:'#112233',em:'#445566'};send(true);}
    else if(frameStep===3){check(event.data.count>0,'isolated iframe restored');check(event.data.styles.includes('#112233')&&event.data.styles.includes('#445566'),'iframe custom colors');frameStep=4;overrides={};send(true);setTimeout(()=>{if(!document.querySelector('#result').textContent.startsWith('FAIL'))document.querySelector('#result').textContent='PASS — 分色、原卡颜色、流式更新、开关、独立 iframe 均通过';},200);}
   }
  } catch(error){document.querySelector('#result').textContent='FAIL '+error.message}});
  for(const key of ['quote','em'])document.querySelector('#'+key).addEventListener('input',event=>{overrides={...overrides,[key]:event.target.value};controls.setColors(overrides);send(true);});
  document.querySelector('#reset').onclick=()=>{overrides={};controls.setColors(overrides);send(true);document.querySelector('#quote').value='#e8a882';document.querySelector('#em').value='#c4b5d4';};
  frame.srcdoc=${JSON.stringify(frame).replace(/</g,'\\u003c')};
 }catch(error){document.querySelector('#result').textContent='FAIL '+error.message}
 </script>`);
});
server.listen(0,'127.0.0.1',()=>console.log('http://127.0.0.1:'+server.address().port));
