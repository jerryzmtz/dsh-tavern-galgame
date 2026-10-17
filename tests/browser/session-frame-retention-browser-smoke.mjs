// Real React + Tavern iframe, no model calls or user data. Open the printed URL
// with Playwright. DSH_BROWSER_ROOT points to the installed DSH package.
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'

const dsh = process.env.DSH_BROWSER_ROOT
if (!dsh) throw new Error('Set DSH_BROWSER_ROOT to the installed DSH package')
const require = createRequire(path.join(dsh, 'node_modules/@deepseek-ai/dsh-client-ui-trajectory/package.json'))
const names = ['react', 'scheduler', 'react-dom', 'react-dom/client']
const files = ['react.production.js', 'scheduler.production.js', 'react-dom.production.js', 'react-dom-client.production.js']
let bundle = 'const modules={};\n'
for (let i = 0; i < names.length; i++) {
  const text = await readFile(path.join(path.dirname(require.resolve(names[i])), 'cjs', files[i]), 'utf8')
  bundle += `modules[${JSON.stringify(names[i])}]=(function(){const module={exports:{}},exports=module.exports,require=name=>modules[name];\n${text}\nreturn module.exports;})();\n`
}
const source = await readFile(new URL('../../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
const main = await readFile(new URL('../../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
const hook = main.slice(main.indexOf('function useLiveTavernView('), main.indexOf('function useTavernCoordination('))
const wizard = `<input id="name"><input id="chosen" type="checkbox"><button onclick="window.steps++">下一步</button><script>window.steps=0;window.instance=Math.random();<\/script>`;
const content = `<script>setTimeout(()=>{document.open();document.write(${JSON.stringify(wizard).replaceAll("<", "\\u003c")});document.close();},0);<\/script>`;
const script = `${bundle}
const epoch=Date.now(),realTimeout=window.setTimeout.bind(window),realClear=window.clearTimeout.bind(window);
let offset=0,nextTimer=-1;const deadlines=new Map();
Date.now=()=>epoch+offset;
window.setTimeout=(fn,ms,...args)=>{if(ms>=599000){const id=nextTimer--;deadlines.set(id,{fn,at:Date.now()+ms,args});return id;}return realTimeout(fn,ms,...args);};
window.clearTimeout=id=>{deadlines.delete(id);realClear(id);};
window.advanceRetention=ms=>{offset+=ms;for(const [id,t] of deadlines){if(t.at<=Date.now()){deadlines.delete(id);t.fn(...t.args);}}};
window.__ModuleLoader__={load(d){window.client=d.factory(name=>modules[name]||{});}};
${source}
const React=modules.react,root=modules['react-dom/client'].createRoot(document.querySelector('#app'));
const content=${JSON.stringify(content)};
const snapshots={A:{view:{id:'A'}},B:{view:{id:'B'}}};
const liveTavernView={getSnapshot:id=>snapshots[id],subscribe(id,notify){notify();return ()=>{};},invalidate(){}};
${hook}
const commits=[];
function Probe({id}){const state=useLiveTavernView(id,0);React.useLayoutEffect(()=>{commits.push({selected:id,view:state.view.id});});return React.createElement('div',{'data-selected':id},state.view.id);}
window.verifyViewSwitch=async()=>{
 for(let i=0;i<20;i++){
  const id=i%2?'B':'A';root.render(React.createElement(Probe,{id}));
  for(let n=0;n<100 && document.querySelector('[data-selected]')?.dataset.selected!==id;n++)await new Promise(r=>setTimeout(r,10));
  if(document.querySelector('[data-selected]')?.dataset.selected!==id)throw Error('render timed out');
 }
 if(commits.some(c=>c.selected!==c.view))throw Error('old session committed under new session');
 return {switches:20,noStaleCommit:true};
};
window.mountSession=id=>root.render(React.createElement(client.TavernMessageFrame,{key:id,sessionId:id,turn:1,partIndex:0,content,eager:true,trustedCardMode:true,runtimeReporting:false}));
window.mountSession('A');
window.verifySessionRetention=async()=>{
 const wait=async fn=>{for(let i=0;i<200;i++){const x=fn();if(x)return x;await new Promise(r=>setTimeout(r,20));}throw Error('timeout');};
 const first=await wait(()=>{const f=document.querySelector('#app iframe');return f?.contentWindow?.document.querySelector('#name')&&f;});
 const win=first.contentWindow,identity=win.instance;
 win.document.querySelector('#name').value='已选择的人物';win.document.querySelector('#chosen').click();win.document.querySelector('button').click();
 window.mountSession('B');await wait(()=>document.querySelector('#app iframe')!==first && document.querySelector('#app iframe'));
 if(!first.isConnected)throw Error('A iframe was destroyed on session switch');
 window.mountSession('A');await wait(()=>document.querySelector('#app iframe')===first);
 if(first.contentWindow.instance!==identity || win.steps!==1 || win.document.querySelector('#name').value!=='已选择的人物' || !win.document.querySelector('#chosen').checked)throw Error('formal conversation lost wizard state');
 window.mountSession('B');
 const second=await wait(()=>{const f=document.querySelector('#app iframe');return f!==first&&f?.contentWindow?.document.querySelector('#name')&&f;});
 window.advanceRetention(599999);
 if(!first.isConnected)throw Error('expired before ten minutes');
 window.advanceRetention(2);
 if(first.isConnected || !second.isConnected)throw Error('expiry removed wrong conversation');
 window.mountSession('A');
 const fresh=await wait(()=>{const f=document.querySelector('#app iframe');return f!==second&&f?.contentWindow?.document.querySelector('#name')&&f;});
 if(fresh===first || fresh.contentWindow.instance===identity)throw Error('expired frame was reused');
 return {sameIframe:true,sameDocument:true,formRetained:true,scriptStateRetained:true,replacedDocument:true,tenMinuteExpiry:true,otherSessionSafe:true};
};
document.querySelector('#run').onclick=async()=>{const output=document.querySelector('#result');try{output.textContent=JSON.stringify({retention:await window.verifySessionRetention(),switching:await window.verifyViewSwitch()});}catch(error){output.textContent='FAIL: '+error.message;}};
`;
const server=createServer((req,res)=>{
 if(req.url==='/runner.js')return res.writeHead(200,{'Content-Type':'text/javascript'}).end(script);
 if(req.url.includes('static-assets') || req.url.includes('vendor'))return res.writeHead(200,{'Content-Type':'text/javascript'}).end('');
 if(req.url.startsWith('/api/'))return res.writeHead(200,{'Content-Type':'application/json'}).end('{"ok":true}');
 if(req.url!=='/')return res.writeHead(200,{'Content-Type':'text/javascript'}).end('');
 res.writeHead(200,{'Content-Type':'text/html;charset=utf-8'}).end('<!doctype html><button id="run">运行保留与切换测试</button><pre id="result"></pre><div id="app"></div><script src="/runner.js"></script>');
});
server.listen(0,'127.0.0.1',()=>console.log('http://127.0.0.1:'+server.address().port));
