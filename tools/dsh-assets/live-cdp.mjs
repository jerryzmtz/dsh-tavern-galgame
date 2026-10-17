// Local CDP bridge: use the authenticated live page, never inspect credentials.
export async function connectLive(port=9333) {
  const targets=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json(),target=targets.find(p=>p.type==='page'&&/127\.0\.0\.1:4312\d/.test(p.url))
  if(!target)throw new Error('Live app page missing')
  const ws=new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true})})
  let id=0;const pending=new Map()
  ws.addEventListener('message',event=>{const m=JSON.parse(event.data),p=pending.get(m.id);if(p){pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(new Error(JSON.stringify(m.error))):p.resolve(m.result)}})
  function send(method,params={}){return new Promise((resolve,reject)=>{const key=++id,timer=setTimeout(()=>{pending.delete(key);reject(new Error('CDP timeout: '+method))},120000);pending.set(key,{resolve,reject,timer});ws.send(JSON.stringify({id:key,method,params}))})}
  async function ev(expression){const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result?.value}
  const rpc=(method,args={})=>ev(`(async()=>{const r=await fetch('/api/dsh-asset-library/v2/control',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(${JSON.stringify({method,args})})});const value=await r.json();if(!r.ok)throw new Error(JSON.stringify(value));return value})()`)
  const upload=bytes=>ev(`(async()=>{const bytes=Uint8Array.from(atob(${JSON.stringify(Buffer.from(bytes).toString('base64'))}),c=>c.charCodeAt(0));const r=await fetch('/api/dsh-asset-library/v2/upload',{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:bytes});const value=await r.json();if(!r.ok)throw new Error(JSON.stringify(value));return value})()`)
  return {send,ev,rpc,upload,close(){for(const p of pending.values()){clearTimeout(p.timer);p.reject(new Error('CDP closed'))}pending.clear();ws.close()}}
}
