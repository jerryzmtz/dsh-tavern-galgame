import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
const repository = fileURLToPath(new URL('../../', import.meta.url))
const artifact = resolve(process.argv[2] || '/tmp/dsh-full-template-build')
const html = `<!doctype html><meta charset="utf-8"><title>Full prompt template smoke</title>
<link rel="icon" href="data:,"><script src="/assets/jquery/jquery.min.js"></script><script src="/assets/lodash/lodash.min.js"></script>
<div id="extensions_settings"></div><pre id="result">Starting</pre>
<script type="module">
import * as YAML from '/assets/yaml/index.mjs';
import { initializeTemplatePlugin } from '/bundle/index.js';
const result = document.querySelector('#result');
window.addEventListener('unhandledrejection', event=>{window.smoke={ok:false,error:String(event.reason)};result.textContent=JSON.stringify(window.smoke)});
const assert = (condition, label) => { if (!condition) throw new Error(label) };
window.toastr = Object.fromEntries(['info','success','warning','error'].map(k => [k, text => { console[k==='error'?'error':'log'](text) }]));
const snapshot = {sessionId:'full-template-smoke',selected_world_info:['book'],world_names:['book'],chat:[{mes:'hello',is_user:false,swipe_id:0,variables:[{hp:7}]}],characters:[{name:'Alice',avatar:'alice.png',data:{name:'Alice',extensions:{world:'book'}}}],chat_metadata:{variables:{}},extension_settings:{regex:[],variables:{global:{}}},name1:'Player',name2:'Alice'};
window.SillyTavern={getContext:()=>snapshot};
const saves=[];
try {
 const settingsHtml=await fetch('/settings.html').then(r=>r.text());
 const plugin=await initializeTemplatePlugin({snapshot,libraries:{yaml:YAML},callbacks:{
   renderExtensionTemplateAsync:async()=>settingsHtml,
   loadWorldInfo:async name=>{ assert(name==='book','unexpected worldbook'); return {entries:{0:{uid:0,comment:'Guide',key:[],content:'HP <%= getMessageVar("hp") %>',disable:false,constant:true,position:0,order:100}}}; },
   saveSettingsDebounced:settings=>{ saves.push(structuredClone(settings)); },
   getUserAvatar:()=>'', getThumbnailUrl:()=>'', getCharaFilename:()=> 'alice', getChatCompletionModel:()=> 'smoke-model',
   // Deterministic test tokenizer; production must supply the active model tokenizer.
   getTokenCountAsync:async text=>Array.from(String(text)).length,
   substituteParams:value=>String(value).replaceAll('{{user}}',snapshot.name1).replaceAll('{{char}}',snapshot.name2),
   getRegexedString:value=>value,
   saveChatConditional:data=>{ saves.push(structuredClone(data)); }
 }});
 window.plugin=plugin;
 assert(plugin.commands.includes('ejs') && plugin.commands.includes('ejs-refresh'),'official commands missing');
 assert(document.querySelector('#pt_enabled'),'official settings missing');
 const value=await plugin.api.evalTemplate('<%= charName %>:<%= getMessageVar("hp") %>');
 assert(value==='Alice:7','official context/variable evaluation: '+value);
 const command=await plugin.command('ejs',{},'<% setMessageVar("hp", 9) %><%= getMessageVar("hp") %>');
 assert(command==='9','official slash command failed');
 const nested=await plugin.api.evalTemplate('<%- await getWorldInfo("Guide") %>');
 assert(nested==='HP 9','nested official worldbook template: '+nested);
 const original=[{role:'user',content:'<%= charName %> / <%= getMessageVar("hp") %>'}];
 const prepared=await plugin.processChatCompletion({messages:original});
 assert(prepared.messages[0].content==='Alice / 9','official generation lifecycle');
 assert(original[0].content.includes('<%'),'request input was modified');
 const toggle=document.querySelector('#pt_enabled'); toggle.click();
 assert(plugin.api.getFeatures().enabled===false,'settings toggle ignored');
 assert(saves.at(-1).EjsTemplate.enabled===false,'settings did not reach persistence callback');
 toggle.click();
 await plugin.api.saveVariables(true);
 assert(saves.at(-1).chat[0].variables[0].hp===9,'variable save did not reach host');
 window.smoke={ok:true,version:plugin.version,commands:plugin.commands,value,command,settingsSaved:true,variablesSaved:true,nested,prepared:prepared.messages[0].content};
 result.textContent=JSON.stringify(window.smoke);
} catch(error) { window.smoke={ok:false,error:String(error.stack||error)}; result.textContent=JSON.stringify(window.smoke); }
</script>`;
const server=createServer(async(req,res)=>{
 try {
  let body,type='text/javascript; charset=utf-8';
  const path=new URL(req.url,'http://localhost').pathname;
  if(path==='/'){body=html;type='text/html; charset=utf-8'}
  else if(path==='/settings.html'){body=await readFile(resolve(repository,'tavern-plugin/lib/vendor/st-prompt-template/upstream/settings.html'));type='text/html; charset=utf-8'}
  else {
   const base=path.startsWith('/assets/')?resolve(repository,'tavern-plugin/lib/vendor/runtime-assets'):artifact;
   const name=path.replace(/^\/(assets|bundle)\//,''); const file=resolve(base,name);
   if(!file.startsWith(base+sep))throw new Error('Invalid path');
   body=await readFile(file); if(file.endsWith('.ttf'))type='font/ttf';
  }
  res.writeHead(200,{'Content-Type':type});res.end(body);
 }catch{res.writeHead(404);res.end('Not found')}
});
server.listen(0,'127.0.0.1',()=>console.log('http://127.0.0.1:'+server.address().port));
