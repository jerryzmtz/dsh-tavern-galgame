// Run: node tests/performance/long-template-benchmark.mjs 1800 output/issue25-synthetic
// Open the printed local URL in a real browser; results are written to OUTPUT/COUNT.json.
// Uses production journal, template adapter, dispatch and official browser artifact.
// Excludes DSH conversation UI, model calls and user-card scripts. Temporary data only.
import { estimateWorldBookTokens } from '../../tavern-plugin/lib/domain/worldbook-activation.js'
import { createFullTemplateRuntime } from '../fixtures/browser-template-transport.mjs'
import { createPromptTemplateGlobalVariables } from '../../tavern-plugin/lib/domain/prompt-template-global-variables.js'
import { createServer } from 'node:http'
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { createChatJournalStore } from '../../tavern-plugin/lib/domain/chat-journal-store.js'
import { createChatPersistence } from '../../tavern-plugin/lib/domain/chat-persistence.js'
import { createProfileDataStore } from '../../tavern-plugin/lib/profile-data-store.js'
import { createTavernExtensionSettings } from '../../tavern-plugin/lib/domain/tavern-extension-settings.js'
import { createTavernScriptHostAdapter } from '../../tavern-plugin/lib/domain/tavern-script-host-adapter.js'
import { createFullPromptTemplateAssetReader, FULL_PROMPT_TEMPLATE_ASSET_PREFIX } from '../../tavern-plugin/lib/domain/full-prompt-template-assets.js'
import { readTavernRuntimeAsset, TAVERN_RUNTIME_ASSET_PREFIX } from '../../tavern-plugin/lib/domain/tavern-runtime-assets.js'
const runtime=createFullTemplateRuntime({publishSignal(){}})
runtime.dispatch.touch('test-session','native-smoke',true)
let taskResult
const root=await mkdtemp(join(tmpdir(),'full-template-browser-native-'))
const open=()=>createChatPersistence({store:createChatJournalStore({dataRoot:root})})
const persistence=open()
const count=Number(process.argv[2]||20)
if(!Number.isInteger(count)||count<2||count>2000)throw new Error('Message count must be 2..2000')
const outputRoot=resolve(process.argv[3]||'output/issue25-synthetic')
await mkdir(outputRoot,{recursive:true})
const prose='林川沿河堤走向渡口，询问道路和天气。店主交代行程，旅人整理行囊。'.repeat(150)
const snapshot={hp:7,records:Array.from({length:170},(_,i)=>({id:i,description:'虚构历史中的人物状态与物品记录。'.repeat(5),value:i}))}
const seeded={id:'test-chat',sessionId:'test-session',cardPath:'cards/test.json',mode:'story',mvu:{enabled:true},variables:{},messages:Array.from({length:count},(_,i)=>({id:'m'+i,turn:Math.floor(i/2)+1,role:i%2?'assistant':'user',text:i+':'+prose,variables:[{...snapshot,hp:7}]}))}
const dataBytes=Buffer.byteLength(JSON.stringify(seeded))
await persistence.write(seeded)
const serverMetrics=[]
const adapter=createTavernScriptHostAdapter({resolveChatSlice:(_id,indices)=>persistence.readSlice('test-chat',indices),resolveChangedChatSlice:(_id,revision)=>persistence.readChangedSlice('test-chat',revision),patchChat:persistence.patch,resolveChat:()=>persistence.read('test-chat'),writeChat:persistence.write,
 updateChat:persistence.update,readChatRevision:persistence.readRevision,readCard:async()=>({name:'Alice',description:'虚构旅行者',personality:'谨慎',mes_example:'',scenario:'河边小镇',first_mes:'旅人抵达',data:{name:'Alice',description:'虚构旅行者',personality:'谨慎',mes_example:'',scenario:'河边小镇',first_mes:'旅人抵达'}}),scriptDispatch:{},
 globalVariables:createPromptTemplateGlobalVariables(createProfileDataStore({dataRoot:root})),
    fullExtensionSettings:createTavernExtensionSettings(createProfileDataStore({dataRoot:root})),
 worldBooks:{bound:async()=>({source:{kind:'standalone',path:'book'},view:{displayName:'book'}}),
 export:async()=>({document:{entries:{0:{uid:0,comment:'Guide',key:[],constant:true,content:'HP <%= getMessageVar("hp") %>',position:0,order:100}}}})}
})
const asset=createFullPromptTemplateAssetReader()
const html=`<!doctype html><meta charset="utf-8"><title>长对话模板性能复测</title><link rel="icon" href="data:,">
<script src="${TAVERN_RUNTIME_ASSET_PREFIX}jquery/jquery.min.js"></script><script src="${TAVERN_RUNTIME_ASSET_PREFIX}lodash/lodash.min.js"></script>
<div id="extensions_settings"></div><pre id="result">Starting</pre>
<script type="module">
import * as YAML from '${TAVERN_RUNTIME_ASSET_PREFIX}yaml/index.mjs';
import {connectTemplateSession,createTemplateServices,templateHost} from '${FULL_PROMPT_TEMPLATE_ASSET_PREFIX}index.js';
const output=document.querySelector('#result');
window.addEventListener('unhandledrejection',e=>{window.smoke={ok:false,error:String(e.reason)};output.textContent=JSON.stringify(window.smoke)});
const syncModes=[],wire=[];const COUNT=${count},BYTES=${dataBytes};
const rpc=async(method,args)=>{const r=await fetch('/api/'+method,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(args)});const text=await r.text();wire.push({method,bytes:new TextEncoder().encode(text).length});const result=JSON.parse(text);if(!r.ok)throw new Error(result.error);if(method==='getFullPromptTemplateState')syncModes.push(result.delta?'delta':'full');return result};
const assert=(v,label)=>{if(!v)throw new Error(label)};
window.toastr=Object.fromEntries(['info','success','warning','error'].map(k=>[k,message=>console.log(k,message)]));
let context;window.SillyTavern={getContext:()=>Object.assign({},context,templateHost)};
try {
 const settingsHtml=await fetch('${FULL_PROMPT_TEMPLATE_ASSET_PREFIX}settings.html').then(r=>r.text());
 const connectStart=performance.now();const plugin=await connectTemplateSession({sessionId:'test-session',runtimeId:'native-smoke',rpc,settingsHtml,libraries:{yaml:YAML},services:createTemplateServices(()=>context,rpc)});
 const connectMs=performance.now()-connectStart;context=plugin.context;window.plugin=plugin;
  const measures=[];
 const measure=async(name,action)=>{const start=performance.now();const result=await action();measures.push({name,ms:performance.now()-start});output.textContent=JSON.stringify({count:COUNT,stage:name,measures});return result};
 assert(context.chat.length===COUNT,'wrong history length');
 await measure('cold synchronize',()=>plugin.synchronize());
 for(let i=0;i<3;i++)await measure('unchanged synchronize '+i,()=>plugin.synchronize());
 for(let i=0;i<3;i++){
  await measure('append journal '+i,()=>fetch('/append').then(r=>r.json()));
  await measure('append synchronize '+i,()=>plugin.synchronize());
  await measure('dispatched render '+i,async()=>{await plugin.processNext();await fetch('/enqueue-task');assert(await plugin.processNext(),'task not claimed');const task=await fetch('/task-result').then(r=>r.json());assert(task.text==='Task HP 7','wrong rendered state')});
  const result=await measure('request '+i,()=>plugin.project('request',{request:{messages:[{role:'user',content:'<%- await getWorldInfo("Guide") %>'}]}}));
  assert(result.messages[0].content==='HP 7','request template not evaluated');
  await measure('variable write '+i,async()=>{await plugin.command('ejs',{},'<% setMessageVar("round", '+i+') %>');await plugin.api.saveVariables(true);await plugin.flush()});
 }
 await fetch('/prepare-input');await plugin.refresh();
 await measure('virtual variable write',async()=>{await plugin.command('ejs',{},'<% setMessageVar("inputCheck", 1) %>');await plugin.api.saveVariables(true);await plugin.flush()});
 const persisted=await fetch('/persisted').then(r=>r.json());assert(persisted.inputCheck===1 && persisted.firstHp===7 && persisted.lastRound===2 && persisted.messages===COUNT+3,'persisted state mismatch');
 const report={ok:true,persisted,count:COUNT,dataBytes:BYTES,measures,syncModes,wire,connectMs,server:await fetch('/metrics').then(r=>r.json())};
 await fetch('/report',{method:'POST',body:JSON.stringify(report)});output.textContent=JSON.stringify(report);await plugin.dispose();
}catch(error){window.smoke={ok:false,error:String(error.stack||error)};output.textContent=JSON.stringify(window.smoke);await fetch('/report',{method:'POST',body:JSON.stringify(window.smoke)})}
</script>`
const server=createServer(async(req,res)=>{
 try {
  const path=new URL(req.url,'http://localhost').pathname
  if(path==='/report'){let body='';for await(const chunk of req)body+=chunk;await writeFile(join(outputRoot,count+'.json'),body);res.end('ok');return}
  if(path==='/metrics'){res.end(JSON.stringify(serverMetrics));return}
  if(path==='/prepare-input'){await persistence.update('test-chat',c=>{c.promptTemplateInput={message:{role:'user',text:'合成待提交输入',variables:[{hp:7}]}};return c});res.end('ok');return}
  if(path==='/append'){const start=performance.now();await persistence.update('test-chat',chat=>{chat.messages.push({id:'extra-'+chat.messages.length,role:'assistant',text:prose,variables:[{hp:7}]});return chat});res.end(JSON.stringify({ms:performance.now()-start}));return}
  if(path==='/enqueue-task'){taskResult=runtime.forSession('test-session').render('Task HP <%= getMessageVar("hp") %>');taskResult.catch(()=>{});await new Promise(r=>setImmediate(r));res.end('queued');return}
  if(path==='/task-result'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(await taskResult));return}
  if(path==='/'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(html);return}
  if(path==='/persisted'){const state=await open().read('test-chat');res.setHeader('Content-Type','application/json');res.end(JSON.stringify({inputCheck:state.promptTemplateInput?.message.variables[0].inputCheck,firstHp:state.messages[0].variables[0].hp,lastRound:state.messages.at(-1).variables[0].round,messages:state.messages.length,revision:state._storageRevision}));return}
  if(path.startsWith('/api/')) {
   if(path.startsWith(FULL_PROMPT_TEMPLATE_ASSET_PREFIX) || path.startsWith(TAVERN_RUNTIME_ASSET_PREFIX)) {
    const file=path.startsWith(FULL_PROMPT_TEMPLATE_ASSET_PREFIX)?await asset(path):await readTavernRuntimeAsset(path)
    if(!file){res.writeHead(404);res.end();return}res.writeHead(200,{'Content-Type':file.mediaType});res.end(file.body);return
   }
   let raw='';for await(const chunk of req)raw+=chunk
   const args=JSON.parse(raw),name=path.slice(5),began=performance.now(),requestBytes=Buffer.byteLength(raw)
   let result
   if(name==='countFullTemplateTokens') result={tokens:estimateWorldBookTokens(args.text),estimator:'unicode-estimate'}
   else if(name==='claimFullTemplateWork') result=runtime.dispatch.claim('test-session',args.runtimeId,args.ready)
   else if(name==='startFullTemplateWork') result=runtime.dispatch.start('test-session',args.eventId,args.leaseToken,args.runtimeId)
   else if(name==='completeFullTemplateWork') result={completed:runtime.dispatch.complete('test-session',args.eventId,args.args,args.runtimeId,args.leaseToken,args.error)}
   else if(name==='saveFullPromptTemplateGlobals') result=await adapter.saveFullPromptTemplateGlobals(args.sessionId,args.variables,args.expectedVariables)
   else if(name==='getFullPromptTemplateState') result=await adapter.readFullPromptTemplateState(args.sessionId,args.cursor)
   else if(name==='saveFullPromptTemplateState') result=await adapter.saveFullPromptTemplateState(args.sessionId,args.state)
   else if(name==='saveFullPromptTemplateSettings') result=await adapter.saveFullPromptTemplateSettings(args.sessionId,args.settings,args.expectedSettings)
   else throw new Error('Unknown method')
   const payload=JSON.stringify(result);serverMetrics.push({method:name,requestBytes,ms:performance.now()-began,bytes:Buffer.byteLength(payload)});res.setHeader('Content-Type','application/json');res.end(payload);return
  }
  res.writeHead(404);res.end()
 }catch(error){res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:String(error.message)}))}
})
server.listen(0,'127.0.0.1',()=>console.log('http://127.0.0.1:'+server.address().port))
