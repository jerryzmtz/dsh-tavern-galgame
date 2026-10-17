import { createServer } from 'node:http'
import { helperClient } from '../fixtures/helper-host-harness.mjs'
const source = helperClient.createTurnErrorControls.toString()
const server = createServer((_request, response) => {
  response.setHeader('Content-Type', 'text/html; charset=utf-8')
  response.end(`<!doctype html><meta charset="utf-8"><title>错误提示验证</title>
  <main id="root"><div data-chat-flow-kind="turn-error" data-chat-turn="8" style="color:#b33"></div></main><pre id="result">RUNNING</pre>
  <script>
  const root=document.querySelector('#root'), row=root.firstElementChild;
  row.textContent='400: message content cannot be empty '+ 'REQUEST_PAYLOAD '.repeat(100);
  const original=row.textContent, create=${source};
  const storage=new Map(), options={sessionId:'smoke',storage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)}};
  const controls=create(root,options); let active=controls, changes=0;
  const observer=new MutationObserver(()=>{changes++; if(changes>10)throw Error('observer loop'); active.apply();});
  observer.observe(root,{childList:true,subtree:true});
  function check(ok,label){if(!ok)throw Error(label)}
  try {
    controls.apply(); check(getComputedStyle(row).display==='none','collapse');
    let buttons=row.nextElementSibling.querySelectorAll('button');
    buttons[0].click(); check(getComputedStyle(row).display!=='none','expand');
    buttons[1].click(); check(getComputedStyle(row).display==='none','hide');
    check(buttons[1].textContent==='恢复错误提示','restore label');
    controls.dispose(); check(row.textContent===original,'preserve source');
    const second=create(root,options); active=second; second.apply();
    check(getComputedStyle(row).display==='none','persist');
    buttons=row.nextElementSibling.querySelectorAll('button'); buttons[1].click();
    check(buttons[1].textContent==='隐藏此错误','restored');
    second.apply();
    setTimeout(()=>{observer.disconnect();document.querySelector('#result').textContent=changes<10?'PASS':'FAIL loop';},50);
  } catch(error) {observer.disconnect(); document.querySelector('#result').textContent='FAIL '+error.message;}
  </script>`)
})
server.listen(0,'127.0.0.1',()=>console.log('http://127.0.0.1:'+server.address().port))
