import { createFullTemplateRuntime } from '../fixtures/browser-template-transport.mjs'
import { createPromptTemplateGlobalVariables } from '../../tavern-plugin/lib/domain/prompt-template-global-variables.js'
import { createServer } from 'node:http'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
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
await persistence.write({id:'test-chat',sessionId:'test-session',cardPath:'cards/test.json',mode:'story',mvu:{enabled:true},
  variables:{},messages:[{role:'assistant',text:'Opening',variables:[{hp:7}]}]})
const adapter=createTavernScriptHostAdapter({resolveChat:()=>persistence.read('test-chat'),writeChat:persistence.write,
 updateChat:persistence.update,readChatRevision:persistence.readRevision,readCard:async()=>({name:'Alice'}),scriptDispatch:{},
 globalVariables:createPromptTemplateGlobalVariables(createProfileDataStore({dataRoot:root})),
    fullExtensionSettings:createTavernExtensionSettings(createProfileDataStore({dataRoot:root})),
 worldBooks:{bound:async()=>({source:{kind:'standalone',path:'book'},view:{displayName:'book'}}),
 export:async()=>({document:{entries:{0:{uid:0,comment:'Guide',key:[],constant:true,content:'HP <%= getMessageVar("hp") %>',position:0,order:100}}}})}
})
const asset= createFullPromptTemplateAssetReader({directory:pathToFileURL(resolve(process.argv[2] || '/tmp/dsh-template-production-assets')+'/')})
const html=`<!doctype html><meta charset="utf-8"><title>Native full template smoke</title><link rel="icon" href="data:,">
<script src="${TAVERN_RUNTIME_ASSET_PREFIX}jquery/jquery.min.js"></script><script src="${TAVERN_RUNTIME_ASSET_PREFIX}lodash/lodash.min.js"></script>
<div id="extensions_settings"></div><pre id="result">Starting</pre>
<script type="module">
import * as YAML from '${TAVERN_RUNTIME_ASSET_PREFIX}yaml/index.mjs';
import {connectTemplateSession} from '${FULL_PROMPT_TEMPLATE_ASSET_PREFIX}index.js';
const output=document.querySelector('#result');
window.addEventListener('unhandledrejection',e=>{window.smoke={ok:false,error:String(e.reason)};output.textContent=JSON.stringify(window.smoke)});
const syncModes=[];
const rpc=async(method,args)=>{const r=await fetch('/api/'+method,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(args)});const result=await r.json();if(!r.ok)throw new Error(result.error);if(method==='getFullPromptTemplateState')syncModes.push(result.delta?'delta':'full');return result};
const assert=(v,label)=>{if(!v)throw new Error(label)};
window.toastr=Object.fromEntries(['info','success','warning','error'].map(k=>[k,message=>console.log(k,message)]));
let context;window.SillyTavern={getContext:()=>context};
try {
 const settingsHtml=await fetch('${FULL_PROMPT_TEMPLATE_ASSET_PREFIX}settings.html').then(r=>r.text());
 const plugin=await connectTemplateSession({sessionId:'test-session',runtimeId:'native-smoke',rpc,settingsHtml,libraries:{yaml:YAML},services:{
   getUserAvatar:()=>'',getThumbnailUrl:()=>'',getCharaFilename:()=> 'alice',getChatCompletionModel:()=> 'fixture-model',
   substituteParams:value=>String(value),getRegexedString:value=>value,getTokenCountAsync:async value=>Array.from(String(value)).length
 }});
 context=plugin.context;window.plugin=plugin;
 const first=await plugin.api.evalTemplate('<%= charName %>:<%= getMessageVar("hp") %>');assert(first==='Alice:7','initial template');
 await plugin.command('ejs',{},'<% setMessageVar("hp", 9) %>');await plugin.api.saveVariables(true);
 const request=await plugin.processChatCompletion({messages:[{role:'user',content:'<%- await getWorldInfo("Guide") %>'}]});
 assert(request.messages[0].content==='HP 9','native request template');
 const persisted=await fetch('/persisted').then(r=>r.json());assert(persisted.hp===9,'journal did not persist');
 await fetch('/enqueue-task');
 assert(await plugin.processNext(),'task not claimed');
 const task=await fetch('/task-result').then(r=>r.json());assert(task.text==='Task HP 9','dispatched template result');
 await plugin.refresh();
 assert(syncModes[0]==='full' && syncModes.slice(1).every(mode=>mode==='delta'),'sync did not use deltas');
 window.smoke={ok:true,syncModes,first,request:request.messages[0].content,persisted,task};output.textContent=JSON.stringify(window.smoke);
}catch(error){window.smoke={ok:false,error:String(error.stack||error)};output.textContent=JSON.stringify(window.smoke)}
</script>`
const server=createServer(async(req,res)=>{
 try {
  const path=new URL(req.url,'http://localhost').pathname
  if(path==='/enqueue-task'){taskResult=runtime.forSession('test-session').render('Task HP <%= getMessageVar("hp") %>');taskResult.catch(()=>{});await new Promise(r=>setImmediate(r));res.end('queued');return}
  if(path==='/task-result'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(await taskResult));return}
  if(path==='/'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(html);return}
  if(path==='/persisted'){const state=await open().read('test-chat');res.setHeader('Content-Type','application/json');res.end(JSON.stringify({hp:state.messages[0].variables[0].hp,revision:state._storageRevision,globalVariables:await createPromptTemplateGlobalVariables(createProfileDataStore({dataRoot:root})).read()}));return}
  if(path.startsWith('/api/')) {
   if(path.startsWith(FULL_PROMPT_TEMPLATE_ASSET_PREFIX) || path.startsWith(TAVERN_RUNTIME_ASSET_PREFIX)) {
    const file=path.startsWith(FULL_PROMPT_TEMPLATE_ASSET_PREFIX)?await asset(path):await readTavernRuntimeAsset(path)
    if(!file){res.writeHead(404);res.end();return}res.writeHead(200,{'Content-Type':file.mediaType});res.end(file.body);return
   }
   let raw='';for await(const chunk of req)raw+=chunk
   const args=JSON.parse(raw),name=path.slice(5)
   let result
   if(name==='claimFullTemplateWork') result=runtime.dispatch.claim('test-session',args.runtimeId,args.ready)
   else if(name==='startFullTemplateWork') result=runtime.dispatch.start('test-session',args.eventId,args.leaseToken,args.runtimeId)
   else if(name==='completeFullTemplateWork') result={completed:runtime.dispatch.complete('test-session',args.eventId,args.args,args.runtimeId,args.leaseToken,args.error)}
   else if(name==='saveFullPromptTemplateGlobals') result=await adapter.saveFullPromptTemplateGlobals(args.sessionId,args.variables,args.expectedVariables)
   else if(name==='getFullPromptTemplateState') result=await adapter.readFullPromptTemplateState(args.sessionId,args.cursor)
   else if(name==='saveFullPromptTemplateState') result=await adapter.saveFullPromptTemplateState(args.sessionId,args.state)
   else if(name==='saveFullPromptTemplateSettings') result=await adapter.saveFullPromptTemplateSettings(args.sessionId,args.settings,args.expectedSettings)
   else throw new Error('Unknown method')
   res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result));return
  }
  res.writeHead(404);res.end()
 }catch(error){res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:String(error.message)}))}
})
server.listen(0,'127.0.0.1',()=>console.log('http://127.0.0.1:'+server.address().port))
