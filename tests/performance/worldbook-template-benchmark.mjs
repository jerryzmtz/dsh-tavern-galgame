// Synthetic, isolated timing harness. No model calls or user archives.
// node tests/performance/worldbook-template-benchmark.mjs [output/playwright/issue43-timing] [case-name] [rpc-delay-ms]
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright'
import fs from 'node:fs/promises'
import { syncBuiltinESMExports } from 'node:module'
import { createFullTemplateRuntime } from '../fixtures/browser-template-transport.mjs'
import { createForegroundWorldbook } from '../../tavern-plugin/lib/domain/foreground-worldbook.js'
import { createWorldBookLibrary } from '../../tavern-plugin/lib/domain/worldbook-library.js'
import { createChatJournalStore } from '../../tavern-plugin/lib/domain/chat-journal-store.js'
import { createChatPersistence } from '../../tavern-plugin/lib/domain/chat-persistence.js'
import { createProfileDataStore } from '../../tavern-plugin/lib/profile-data-store.js'
import { createPromptTemplateGlobalVariables } from '../../tavern-plugin/lib/domain/prompt-template-global-variables.js'
import { createTavernExtensionSettings } from '../../tavern-plugin/lib/domain/tavern-extension-settings.js'
import { createTavernScriptHostAdapter } from '../../tavern-plugin/lib/domain/tavern-script-host-adapter.js'
import { readFullPromptTemplateAsset, FULL_PROMPT_TEMPLATE_ASSET_PREFIX as templatePrefix } from '../../tavern-plugin/lib/domain/full-prompt-template-assets.js'
import { readTavernRuntimeAsset, TAVERN_RUNTIME_ASSET_PREFIX as runtimePrefix } from '../../tavern-plugin/lib/domain/tavern-runtime-assets.js'

let syncObserver
const nativeOpen = fs.open
fs.open = async (...args) => {
  const handle = await nativeOpen(...args), sync = handle.sync.bind(handle)
  handle.sync = async () => { const begin=performance.now();try{return await sync()}finally{syncObserver?.(String(args[0]),performance.now()-begin)} }
  return handle
}
syncBuiltinESMExports()

const rpcDelayMs = Math.max(0, Number(process.argv[4]) || 0)
const output = resolve(process.argv[2] || 'output/playwright/issue43-timing')
await mkdir(output, { recursive: true })
const sourceRoot = new URL('../../tavern-plugin/lib/', import.meta.url)
const sourceFiles = new Set(['vendor/st-prompt-template/host-build/native-connection.js', 'vendor/st-prompt-template/host-build/session-tasks.js', 'domain/template-state-patch.js', 'domain/json-mutation.js'])
const median = values => [...values].sort((a,b) => a-b)[Math.floor(values.length / 2)]
function summary(rows) {
  return Object.fromEntries([...new Set(rows.map(row => row.name))].map(name => {
    const items = rows.filter(row => row.name === name)
    return [name, { count: items.length, totalMs: items.reduce((n,row) => n+row.ms,0), medianMs: median(items.map(row=>row.ms)), bytes: items.reduce((n,row)=>n+(row.bytes||0),0) }]
  }))
}
const html = mode => `<!doctype html><meta charset="utf-8"><div id="extensions_settings"></div>
<script src="${runtimePrefix}jquery/jquery.min.js"></script><script src="${runtimePrefix}lodash/lodash.min.js"></script>
<script type="module">
import * as YAML from '${runtimePrefix}yaml/index.mjs';
import {initializeTemplatePlugin,createTemplateServices,templateHost} from '${templatePrefix}index.js';
import {createNativeTemplateConnection} from '/source/vendor/st-prompt-template/host-build/native-connection.js';
import {createTemplateSessionTasks} from '/source/vendor/st-prompt-template/host-build/session-tasks.js';
window.rows=[];let measuring=false;
const timed=async(name,fn)=>{const begin=performance.now();try{return await fn()}finally{if(measuring)window.rows.push({name,ms:performance.now()-begin})}};
const rpc=async(name,args)=>timed('rpc:'+name,async()=>{const r=await fetch('/rpc/'+name,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(args)});const value=await r.json();if(!r.ok)throw Error(value.error);return value});
window.toastr=Object.fromEntries(['info','success','warning','error'].map(k=>[k,()=>{}]));
let connection,plugin,tasks;window.SillyTavern={getContext:()=>Object.assign({},connection?.snapshot,templateHost)};
try {
const settingsHtml=await fetch('${templatePrefix}settings.html').then(r=>r.text());
connection=await createNativeTemplateConnection({sessionId:'s',rpc,settingsHtml,services:createTemplateServices(()=>connection?.snapshot,rpc)});
plugin=await initializeTemplatePlugin({...connection,libraries:{yaml:YAML}});
await connection.flush();
const refresh=connection.refresh.bind(connection);
connection.refresh=()=>timed('connection.refresh',()=>${JSON.stringify(mode)}==='pinned' && measuring ? Promise.resolve(connection.snapshot) : refresh());
for(const method of ['refresh','project']){const original=plugin[method];plugin[method]=(...args)=>timed('plugin.'+method,()=>original(...args))}
const flush=connection.flush;connection.flush=()=>timed('connection.flush',()=>flush());
tasks=createTemplateSessionTasks({connection,plugin,dispatch:{claim:()=>rpc('claim',{}),start:w=>rpc('start',{eventId:w.event.id,leaseToken:w.leaseToken}),complete:(w,r)=>rpc('complete',{eventId:w.event.id,leaseToken:w.leaseToken,...r})}});
let draining=false,again=false;
const drain=async()=>{again=true;if(draining)return;draining=true;try{do{again=false;while(await tasks.processNext()){} }while(again)}catch(error){window.failure=String(error.stack||error)}finally{draining=false}};
const signals=new EventSource('/signals');signals.onmessage=()=>drain();
await new Promise(resolve=>signals.onopen=resolve);
window.run=async()=>{window.rows=[];measuring=true;const begin=performance.now();const response=await fetch('/run');const result=await response.json();while(draining)await new Promise(r=>setTimeout(r,1));measuring=false;if(!response.ok||window.failure)throw Error(window.failure||result.error);return {...result,browserWallMs:performance.now()-begin,browser:window.rows}};
window.closeBenchmark=async()=>{signals.close();await tasks.dispose()};window.ready=true;
}catch(error){window.failure=String(error.stack||error)}
</script>`

async function runCase(browser, name, { large=true, journal=true, mode='normal', skipQueued=false, batch=true }={}) {
  const root = await mkdtemp(join(tmpdir(),'tavern-worldbook-bench-'))
  const metrics=[]; let measuring=false, signals
  syncObserver=(path,ms)=>{if(measuring&&path.includes('template-work'))metrics.push({name:path.endsWith('.write-lock')?'fsync.lock':path.includes('.staging-')?'fsync.data':'fsync.directory',ms})}
  const timed = (name, fn) => async (...args) => {
    const begin=performance.now();try{return await fn(...args)}finally{if(measuring)metrics.push({name,ms:performance.now()-begin})}
  }
  const card={name:'Synthetic',description:'x'.repeat(large?770000:128),extensions:{}}
  const document={name:'book',entries:Object.fromEntries(Array.from({length:266},(_,i)=>[i,{uid:i,comment:'entry-'+i,key:[],keysecondary:[],constant:i<20,disable:i>=20,order:100,position:0,
    content:i<20?'<% incvar("counter"); %><%= getvar("counter") %>:<%= (await getwi("entry-265")).length %>':'x'.repeat(large?3800:32)}]))}
  await writeFile(join(root,'card.json'),JSON.stringify(card));await writeFile(join(root,'book.json'),JSON.stringify(document))
  const data=createProfileDataStore({dataRoot:root})
  const jobStore={readJson:timed('journal.read',data.readJson),writeJson:async(path,value)=>{
    if(skipQueued && value.phase==='queued')return
    const begin=performance.now();await data.writeJson(path,value);if(measuring)metrics.push({name:'journal.write',ms:performance.now()-begin,bytes:Buffer.byteLength(JSON.stringify(value))})
  }}
  const persistence=createChatPersistence({store:createChatJournalStore({dataRoot:root})})
  await persistence.write({id:'chat',sessionId:'s',mode:'story',cardPath:'card.json',mvu:{enabled:true},variables:{},messages:Array.from({length:26},(_,i)=>({role:i%2?'assistant':'user',text:'history '.repeat(80),turn:Math.floor(i/2)+1,variables:[{hp:7}]}))})
  const readCard=timed('resource.card',async()=>JSON.parse(await readFile(join(root,'card.json'),'utf8')))
  const library=createWorldBookLibrary({normalizePath:path=>path,removeStandalone:async()=>{throw Error('read only benchmark')},
    resources:{readText:timed('resource.readText',()=>readFile(join(root,'book.json'),'utf8')),bindingForCard:async()=>({kind:'standalone',path:'book.json',available:true})},cards:{read:readCard}})
  const books={bound:timed('resource.bound',library.bound),export:timed('resource.export',library.export),
    ...(library.templateSnapshot ? {templateSnapshot:timed('resource.templateSnapshot',library.templateSnapshot)} : {})}
  const globalVariables=createPromptTemplateGlobalVariables(data),settings=createTavernExtensionSettings(data)
  const adapter=createTavernScriptHostAdapter({resolveChat:timed('chat.read',()=>persistence.read('chat')),resolveChatSlice:timed('chat.slice',(_id,indices)=>persistence.readSlice('chat',indices)),
    resolveChangedChatSlice:(_id,revision)=>persistence.readChangedSlice('chat',revision),writeChat:persistence.write,updateChat:persistence.update,patchChat:persistence.patch,readChatRevision:persistence.readRevision,
    readCard,worldBooks:books,scriptDispatch:{},globalVariables:{...globalVariables,read:timed('globals.read',globalVariables.read)},fullExtensionSettings:{...settings,read:timed('settings.read',settings.read)}})
  const runtime=createFullTemplateRuntime({store:journal?jobStore:undefined,publishSignal:()=>signals?.write('data: work\n\n')})
  runtime.heartbeat('s','browser','ready')
  const foreground=createForegroundWorldbook({bound:books.bound,runtime:async()=>{const engine=runtime.forSession('s');if(!batch)delete engine.renderProjections;return engine},globalVariables:globalVariables.read})
  const server=createServer(async(req,res)=>{
    try{
      const path=new URL(req.url,'http://localhost').pathname
      if(path==='/signals'){signals=res;res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache'});res.write(': connected\n\n');return}
      if(path==='/'){res.setHeader('Content-Type','text/html');res.end(html(mode));return}
      if(path.startsWith('/source/')){const relative=path.slice(8);if(!sourceFiles.has(relative))throw Error('unknown source');res.setHeader('Content-Type','text/javascript');res.end(await readFile(new URL(relative,sourceRoot)));return}
      if(path.startsWith(templatePrefix)||path.startsWith(runtimePrefix)){const asset=await (path.startsWith(templatePrefix)?readFullPromptTemplateAsset(path):readTavernRuntimeAsset(path));res.setHeader('Content-Type',asset.mediaType);res.end(asset.body);return}
      if(path==='/run'){
        metrics.length=0;measuring=true;runtime.heartbeat('s','browser','ready');const begin=performance.now()
        const result=await foreground({chat:await persistence.read('chat'),card:await readCard(),userText:'continue'})
        const ms=performance.now()-begin;measuring=false
        assert.equal(result.error,null);assert.equal(result.renderedEntries.length,20);assert.deepEqual(result.log.templateDiagnostics,[]);assert.equal(result.prefixContext,Array.from({length:20},(_,i)=>(i+1)+':'+(large?3800:32)).join('\n\n'))
        assert.equal((await persistence.read('chat')).variables.counter,undefined)
        // Exercise the production opt-in, not the no-journal benchmark variant.
        if (journal && typeof runtime.forSession('s').renderProjection === 'function') {
          assert.equal(metrics.filter(row=>row.name==='journal.write').length,0)
          assert.equal(metrics.filter(row=>row.name==='journal.read').length,0)
        }
        res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ms,refs:result.refs,context:result.prefixContext,server:metrics}));return
      }
      if(path.startsWith('/rpc/')){
        if(rpcDelayMs)await new Promise(resolve=>setTimeout(resolve,rpcDelayMs))
        let body='';for await(const chunk of req)body+=chunk
        const args=JSON.parse(body),method=path.slice(5),begin=performance.now();let result
        if(method==='claim')result=runtime.dispatch.claim('s','browser',true)
        else if(method==='start')result=await runtime.start('s',args.eventId,args.leaseToken,'browser')
        else if(method==='complete')result={completed:await runtime.complete('s',args.eventId,args.args,'browser',args.leaseToken,args.error)}
        else if(method==='getFullPromptTemplateState')result=await adapter.readFullPromptTemplateState('s',args.cursor)
        else if(method==='saveFullPromptTemplateState')result=await adapter.saveFullPromptTemplateState('s',args.state)
        else if(method==='saveFullPromptTemplateGlobals')result=await adapter.saveFullPromptTemplateGlobals('s',args.variables,args.expectedVariables)
        else if(method==='saveFullPromptTemplateSettings')result=await adapter.saveFullPromptTemplateSettings('s',args.settings,args.expectedSettings)
        else if(method==='countFullTemplateTokens')result={tokens:Math.ceil(args.text.length/4)}
        else throw Error(method)
        const payload=JSON.stringify(result);if(measuring)metrics.push({name:'rpc:'+method,ms:performance.now()-begin,bytes:Buffer.byteLength(payload)})
        res.setHeader('Content-Type','application/json');res.end(payload);return
      }
      res.writeHead(404);res.end()
    }catch(error){res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:String(error.stack||error)}))}
  })
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  const page=await browser.newPage()
  try{
    await page.goto('http://127.0.0.1:'+server.address().port)
    await page.waitForFunction(()=>window.ready||window.failure)
    assert.equal(await page.evaluate(()=>window.failure),undefined)
    const rounds=[]
    for(let i=0;i<4;i++){
      const result=await page.evaluate(()=>window.run())
      assert.equal(result.server.filter(row=>row.name==='rpc:start').length,batch?2:40)
      rounds.push({...result,summary:{server:summary(result.server),browser:summary(result.browser)}})
      console.log(name,i,Math.round(result.ms)+' ms',result.server.filter(row=>row.name==='rpc:start').length+' jobs')
    }
    const report={name,large,journal,mode,skipQueued,batch,rpcDelayMs,cardBytes:Buffer.byteLength(JSON.stringify(card)),worldbookBytes:Buffer.byteLength(JSON.stringify(document)),rounds,medianMs:median(rounds.slice(1).map(round=>round.ms))}
    await writeFile(join(output,name+'.json'),JSON.stringify(report,null,2))
    await page.evaluate(()=>window.closeBenchmark())
    return report
  }finally{await page.close();runtime.dispose();signals?.end();await new Promise(resolve=>server.close(resolve));await rm(root,{recursive:true,force:true})}
}
const browser=await chromium.launch({headless:true})
try{
  const reports=[]
  for(const [name,config] of [['small', {large:false}],['large',{}],['large-sequential',{batch:false}],['large-no-job-journal',{journal:false}],['large-pinned-snapshot',{mode:'pinned'}],['large-no-queued-record',{skipQueued:true}]])if(!process.argv[3] || name===process.argv[3])reports.push(await runCase(browser,name,config))
  const large=reports.find(report=>report.name==='large')
  for(const report of reports.filter(report=>report.large))for(const round of report.rounds)assert.equal(round.context,(large||report).rounds[0].context)
  const result={experiment:process.env.DSH_TAVERN_BENCH_EXPERIMENT || null,revision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),warmupRounds:1,measuredRounds:3,platform:process.platform,arch:process.arch,node:process.version,browser:browser.version(),results:reports.map(({rounds,...report})=>report)}
  await writeFile(join(output,'summary.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2))
}finally{await browser.close();fs.open=nativeOpen;syncBuiltinESMExports()}
