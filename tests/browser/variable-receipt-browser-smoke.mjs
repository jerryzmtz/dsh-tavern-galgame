// Disposable production adapter/journal + browser runtime. No user data or model.
import {createServer} from 'node:http'
import {readFile} from 'node:fs/promises'
import {createHelperChatDataHost} from '../fixtures/helper-chat-data-host.mjs'
const host=await createHelperChatDataHost(), receipts=[]
await host.persistence.update('audit',chat=>({...chat,messages:Array.from({length:600},(_,i)=>({role:i%2?'assistant':'user',text:'正文'.repeat(2000),variables:[{stat_data:{hp:10,details:'历史变量'.repeat(1000)},schema:{}}]}))}))
let client=await readFile(new URL('../../tavern-plugin/lib/client.js',import.meta.url),'utf8')
for(const name of ['tavernIconDependencies','tavernStaticAssetShim','tavernHelperScriptDependencies']) client=client.replaceAll('+ '+name+'()',"+ ''")
const server=createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://localhost');res.setHeader('Access-Control-Allow-Origin','*')
  const prefix='/api/dsh-tavern/vendor/runtime-assets/'
  if(url.pathname.startsWith(prefix)){
   const asset=url.pathname.slice(prefix.length)
   if(!['zod/index.mjs','yaml/index.mjs','fontawesome/css/all.min.css'].includes(asset)){res.writeHead(404);res.end();return}
   res.setHeader('Content-Type',asset.endsWith('.css')?'text/css':'text/javascript');res.end(await readFile(new URL('../../tavern-plugin/lib/vendor/runtime-assets/'+asset,import.meta.url)));return
  }
  if(url.pathname==='/client.js'){res.setHeader('Content-Type','text/javascript');res.end(client);return}
  if(url.pathname==='/rpc'){
   let body='';for await(const chunk of req)body+=chunk
   const {method,args,full}=JSON.parse(body);let result
   if(method==='updateTavernHelperVariables')result=await host.adapter.updateVariables(args.sessionId,args.option,args.variables,args.expectedLifecycleRevision,args.eventId,full?undefined:args.contextBaseline)
   else if(method==='getTavernHelperContext')result={context:await host.context()}
   else if(method==='recordMvuRuntimeDiagnostic')result={recorded:true}
   else result=await host.invoke(method,args)
   const encoded=JSON.stringify(result)
   if(method==='updateTavernHelperVariables')receipts.push({full,type:args.option.type,bytes:Buffer.byteLength(encoded),delta:!!result.contextDelta})
   res.setHeader('Content-Type','application/json');res.end(encoded);return
  }
  if(url.pathname==='/proof'){
   const saved=await host.open().read('audit')
   res.setHeader('Content-Type','application/json');res.end(JSON.stringify({receipts,persisted:{message:saved.messages.at(-1).variables[0].hp,chat:saved.variables.hp,script:saved.tavernHelperScriptVariables.smoke.hp},history:saved.messages[0].variables[0].stat_data.hp}));return
  }
  if(url.pathname!=='/'){res.writeHead(204);res.end();return}
  const content=`const results=[];const ctx=SillyTavern.getContext(),held=ctx.chat[0];
   for(const type of ['message','chat','script']){
    const samples=[];for(let i=0;i<6;i++){
     const start=performance.now();await replaceVariables({hp:20+i,payload:'变量'.repeat(1000)},{type,message_id:599,script_id:'smoke'});samples.push(performance.now()-start);
     if(getVariables({type,message_id:599,script_id:'smoke'}).hp!==20+i)throw Error('state mismatch');
    }
    const measured=samples.slice(1).sort((a,b)=>a-b);results.push({type,medianMs:measured[2],samples});
   }
   if(ctx.chat[0]!==held || held.variables[0].stat_data.hp!==10)throw Error('history changed');
   if(ctx.chat[599].variables[0].hp!==25)throw Error('facade not synchronized');
   parent.postMessage({type:'variable-smoke',results},'*');`
  const view={chatId:'audit',card:{name:'变量测试'},tavernHelper:await host.context(),tavernHelperScripts:[{id:'smoke',content}]}
  res.setHeader('Content-Type','text/html;charset=utf-8');res.end(`<!doctype html><title>Variable receipt benchmark</title><pre id="result">RUNNING</pre><script>window.__ModuleLoader__={load(value){window.descriptor=value}}</script><script src="/client.js"></script><script>
   const client=descriptor.factory(()=>({}));addEventListener('message',e=>{if(e.data?.type==='variable-smoke'){window.smokeResult=e.data;document.querySelector('#result').textContent=JSON.stringify(e.data)}});
   window.runtime=client.createTavernHelperScriptRuntime({window,document,rpc:async(method,args,sessionId)=>{args={...args,sessionId};const r=await fetch('/rpc',{method:'POST',body:JSON.stringify({method,args,full:${url.searchParams.has('full')}})});if(!r.ok)throw Error(await r.text());return r.json()},reportError:(s,e)=>{window.smokeError=e.message;document.querySelector('#result').textContent='FAIL '+e.message},resolveError(){},onMutation(){}});
   runtime.sync('audit',${JSON.stringify(view).replace(/</g,'\\u003c')});</script>`)
 }catch(e){res.writeHead(500);res.end(e.message)}
})
server.listen(0,'127.0.0.1',()=>console.log('http://127.0.0.1:'+server.address().port))
async function close(){server.close();await host.cleanup();process.exit(0)}
process.on('SIGINT',close);process.on('SIGTERM',close)
