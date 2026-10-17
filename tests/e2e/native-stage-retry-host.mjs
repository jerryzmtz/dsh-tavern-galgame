import { spawn } from 'node:child_process'
import { readFile, writeFile, mkdir, cp, mkdtemp, rename, readdir, symlink, access } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
// Full official DSH CLI + production Tavern HTTP API. Only LLM output is scripted.
// No browser shim, user profile, live credentials, paid API, or synthetic host is used.
const source=resolve(dirname(fileURLToPath(import.meta.url)),'../..')
const runtime=resolve(process.env.TAVERN_E2E_RUNTIME || join(homedir(),'.dsh-tavern/runtime'))
const modules=join(runtime,'lib/node_modules')
const output=resolve(process.env.TAVERN_E2E_OUTPUT || join(source,'output/e2e-native-stage-retry'))
await mkdir(output,{recursive:true})
const root=await mkdtemp(join(output,'run-')),home=join(root,'home'),profile=join(home,'profiles/tavern')
await mkdir(join(root,'logs'),{recursive:true});await mkdir(join(profile,'node_modules'),{recursive:true})
await access(join(modules,'@deepseek-ai/dsh/lib/bin.js'))
assert.equal(JSON.parse(await readFile(join(modules,'@deepseek-ai/dsh/package.json'),'utf8')).version,'0.1.5-rc.2')
for(const [name,target] of Object.entries({'dsh-tavern-plugin':join(source,'tavern-plugin'),'dsh-tavern-remote':join(source,'tavern-plugin/packages/dsh-tavern-remote'),'dsh-web-mobile':join(source,'node_modules/dsh-web-mobile'),'@deepseek-ai':join(modules,'@deepseek-ai')}))await symlink(target,join(profile,'node_modules',name))
await cp(join(source,'node_modules/dsh-better-sidebar'),join(profile,'node_modules/dsh-better-sidebar'),{recursive:true,dereference:true})
for(const name of await readdir(join(source,'node_modules'))){if(name.startsWith('.')||['@deepseek-ai','dsh-tavern-plugin','dsh-tavern-remote','dsh-web-mobile','dsh-better-sidebar'].includes(name))continue;await symlink(join(source,'node_modules',name),join(profile,'node_modules',name))}
await writeFile(join(profile,'package.json'),JSON.stringify({name:'tavern-native-stage-e2e',private:true,dsh:{profile:{bundles:['@deepseek-ai/dsh-base','@deepseek-ai/dsh-web-app','dsh-web-mobile','dsh-better-sidebar','dsh-tavern-plugin','dsh-tavern-remote']}}}))
const passed=[]
let completed=false, failure=''
const mark=name=>{passed.push(name);console.log('PASS',name)}
await mkdir(home+'/profile-data/tavern/data/resources/cards',{recursive:true})
await writeFile(home+'/profile-data/tavern/data/resources/cards/native.json',JSON.stringify({spec:'chara_card_v2',spec_version:'2.0',data:{name:'原生后台验收',description:'NATIVE_CARD_CONTEXT_SENTINEL。普通合成验收人物。',personality:'NATIVE_PERSONALITY_SENTINEL',scenario:'NATIVE_SCENARIO_SENTINEL',first_mes:'这是合成测试开场。',mes_example:'',system_prompt:'NATIVE_CARD_SYSTEM_SENTINEL',post_history_instructions:'NATIVE_POST_HISTORY_SENTINEL',character_book:{name:'原生世界书',entries:[{id:1,keys:[],comment:'固定常驻背景',content:'NATIVE_WORLDBOOK_SENTINEL',enabled:true,constant:true,insertion_order:1}]},extensions:{}}}))
await writeFile(home+'/profiles/tavern/cordis.patch.yml',`- id: agent-default-model\n  config:\n    provider: tavern-e2e\n    model: fixed\n- insert:\n    - id: tavern-e2e-model\n      name: ${JSON.stringify(source+'/tests/e2e/native-stage-model.mjs')}\n`)
async function control(value){await writeFile(home+'/control.tmp',JSON.stringify(value));await rename(home+'/control.tmp',home+'/control.json')}
await control({holdDirector:true,holdSettlement:true});await writeFile(home+'/requests.jsonl','')
let child, log='', u, cookie
const wait=ms=>new Promise(r=>setTimeout(r,ms))
async function launch(resumeSession){
 const offset=log.length
 child=spawn(process.execPath,[modules+'/@deepseek-ai/dsh/lib/bin.js','--profile','tavern','--host','127.0.0.1','--port','0','--no-open'],{cwd:source,env:{PATH:process.env.PATH,HOME:home,LANG:'C.UTF-8',DSH_HOME:home,DSH_CWD:home,NATIVE_AUDIT:home+'/requests.jsonl',NATIVE_RESUME_SESSION:resumeSession||'',NATIVE_CONTROL:home+'/control.json',TAVERN_E2E_LLM_MODULE:modules+'/@deepseek-ai/dsh-llm/lib/index.js'},stdio:['ignore','pipe','pipe']})
 child.stdout.on('data',x=>log+=x);child.stderr.on('data',x=>log+=x)
 let url
 for(let i=0;i<300;i++){url=log.slice(offset).match(/http:\/\/127\.0\.0\.1:\d+\/\?token=([^\s]+)/)?.[0];if(url)break;if(child.exitCode!==null)throw Error('Host exited '+child.exitCode);await wait(100)}
 if(!url)throw Error('Host startup timed out')
 u=new URL(url);console.log('HOST_LISTENING',u.origin)
 const auth=await fetch(url,{redirect:'manual'});assert.equal(auth.status,303);cookie=auth.headers.get('set-cookie')?.split(';')[0]
 const h=await fetch(u.origin,{headers:{cookie}});const html=await h.text();console.log('HTML',h.status,html.length);assert.equal(h.status,200);const client=html.match(/(\/plugins\/\?\?dsh-tavern-plugin\/client\.js&rev=[a-z0-9-]+)/);assert.ok(client,'missing Tavern web client');const asset=await fetch(u.origin+client[1].replaceAll('&amp;','&'),{headers:{cookie}});assert.equal(asset.status,200);assert.ok((await asset.text()).length>100000);mark('official-web-shell-and-fork-client-http-200');await writeFile(root+'/logs/native-client.html',html)
}
async function stop(signal='SIGTERM'){child.kill(signal);await new Promise(r=>child.once('exit',r))}
async function rpc(method,args={},quiet=false){const r=await fetch(u.origin+'/api/dsh-tavern/'+method,{method:'POST',headers:{'content-type':'application/json',cookie},body:JSON.stringify(args)});const t=await r.text();if(!quiet)console.log('RPC',method,r.status,t.slice(0,600));if(!r.ok)throw Error(t);const data=JSON.parse(t);if(data.ok===false)throw Error(t);return data}
async function requests(){return (await readFile(home+'/requests.jsonl','utf8')).trim().split('\n').filter(Boolean).map(JSON.parse)}

const config={enabled:true,characters:[{alias:'alice',name:'Alice',offstage:false,voice:''}],voice:{enabled:false},stage:{director:true,directorModel:{provider:'tavern-e2e',model:'fixed'},music:false,widgets:false,directorBudget:{maxToolCalls:6,maxBeatsPerCall:8,maxOpsPerCall:32}}}
let sessionId
const stageCalls=async()=> (await requests()).filter(x=>x.role==='director')
async function stateUntil(test){let state;for(let i=0;i<200;i++){state=await rpc('gameplay.state',{sessionId},true);if(test(state))return state;await wait(50)}throw Error('State wait timed out: '+JSON.stringify(state.chat.messages.at(-1)))}
async function failAfterPrefix(turn){
 await control({holdDirector:false,holdSettlement:true,failDirectorAfterPrefix:true})
 await rpc('gameplay.send',{sessionId,input:'Synthetic quota test round '+turn})
 const state=await stateUntil(s=>s.chat.messages.at(-1)?.turn===turn&&s.chat.messages.at(-1)?.stageDirectionFailureV1)
 const message=state.chat.messages.at(-1)
 assert.equal(message.stageDirectionDraftV1.checkpoint.state.through,1)
 assert.match(message.stageDirectionFailureV1.error,/quota_exceeded/)
 assert.equal(message.stageDirectionV1,undefined)
 return state
}
async function finishCore(){await control({holdDirector:false,holdSettlement:false});const state=await rpc('gameplay.state',{sessionId},true);if(state.chat.settleStatus!=='done'&&!state.activity.busy)await rpc('retrySettlement',{sessionId,turn:state.chat.messages.at(-1).turn});await stateUntil(s=>s.chat.settleStatus==='done')}
try {
 await launch()
 const created=await rpc('gameplay.create',{sourceCard:'native.json',mode:'story',model:{provider:'tavern-e2e',model:'fixed'}});sessionId=created.sessionId
 await rpc('addGuide',{sessionId,text:'NATIVE_GUIDE_SENTINEL: synthetic retry validation'})
 await rpc('saveDialogueBubbles',{sessionId,config})
 const failed=await failAfterPrefix(2)
 await writeFile(root+'/logs/quota-before-reload.json',JSON.stringify(failed,null,2))
 const checkpoint=failed.chat.messages.at(-1).stageDirectionDraftV1.checkpoint,countBefore=(await stageCalls()).length
 await stop()
 await rename(home+'/profile-data/tavern/data/stage/direction',root+'/logs/optional-cache-before-failure')
 await writeFile(home+'/profile-data/tavern/data/stage/direction','Synthetic unavailable optional cache')
 await launch(sessionId)
 let state=await rpc('gameplay.state',{sessionId},true)
 assert.deepEqual(state.chat.messages.at(-1).stageDirectionDraftV1.checkpoint,checkpoint)
 assert.equal((await stageCalls()).length,countBefore)
 await control({holdDirector:false,holdSettlement:true})
 await rpc('retryStageDirection',{sessionId,turn:2});await rpc('retryStageDirection',{sessionId,turn:2})
 assert.deepEqual((await rpc('gameplay.state',{sessionId},true)).chat.messages.at(-1).stageDirectionDraftV1.checkpoint,checkpoint)
 await rpc('getStageDirection',{sessionId,turn:2})
 state=await stateUntil(s=>s.chat.messages.at(-1)?.stageDirectionV1)
 const resumed=(await stageCalls()).slice(countBefore),effect=state.chat.messages.at(-1).stageDirectionV1
 assert.equal(resumed.length,1);assert.match(JSON.stringify(resumed[0].input.messages),/nextSequence\\\":2/)
 assert.equal(effect.presentation.stats.resumed,true);assert.equal(effect.presentation.stats.submissions,2);assert.equal(effect.entries.filter(e=>e.ops.some(o=>o.op==='actor.enter')).length,1)
 mark('429-cold-reload-broken-cache-duplicate-retry-resumes-only-sequence-2')
 await writeFile(root+'/logs/quota-resumed.json',JSON.stringify(state,null,2))
 await finishCore()
 // Explicit generation of a failed turn deliberately rebuilds the entire presentation.
 await failAfterPrefix(3);const beforeGenerate=(await stageCalls()).length
 await control({holdDirector:true,holdSettlement:true})
 await rpc('generateStageDirection',{sessionId,turn:3})
 await stateUntil(s=>s.chat.messages.at(-1)?.stageDirectionDraftV1?.checkpoint?.state?.through===1&&!s.chat.messages.at(-1)?.stageDirectionFailureV1)
 assert.match(JSON.stringify((await stageCalls())[beforeGenerate].input.messages),/nextSequence\\\":1/)
 await control({holdDirector:false,holdSettlement:true});state=await stateUntil(s=>s.chat.messages.at(-1)?.stageDirectionV1)
 assert.equal(state.chat.messages.at(-1).stageDirectionV1.presentation.stats.resumed,false)
 assert.equal((await stageCalls()).length-beforeGenerate,2);mark('explicit-generate-after-failure-starts-at-sequence-1')
 await finishCore()
 // A changed rule cannot reuse an otherwise intact accepted prefix.
 await failAfterPrefix(4);const beforeChanged=(await stageCalls()).length
 await rpc('saveDialogueBubbles',{sessionId,config:{...config,stage:{...config.stage,directorPrompt:'Changed synthetic stage direction rules.'}}})
 await control({holdDirector:true,holdSettlement:true});await rpc('retryStageDirection',{sessionId,turn:4});await rpc('getStageDirection',{sessionId,turn:4})
 await stateUntil(s=>s.chat.messages.at(-1)?.stageDirectionDraftV1?.checkpoint?.state?.through===1&&!s.chat.messages.at(-1)?.stageDirectionFailureV1)
 assert.match(JSON.stringify((await stageCalls())[beforeChanged].input.messages),/nextSequence\\\":1/)
 await control({holdDirector:false,holdSettlement:true});state=await stateUntil(s=>s.chat.messages.at(-1)?.stageDirectionV1)
 assert.equal(state.chat.messages.at(-1).stageDirectionV1.presentation.stats.resumed,false)
 mark('changed-rules-invalidate-checkpoint-before-retry')
 await writeFile(root+'/logs/stale-rule-result.json',JSON.stringify(state,null,2));completed=true
}catch(error){failure=String(error.stack||error);throw error}
finally{if(child&&child.exitCode===null)await stop();await writeFile(root+'/logs/api-host.log',log.replace(/token=[^\s]+/g,'token=REDACTED'));await writeFile(root+'/report.json',JSON.stringify({status:completed?'passed':'failed',scope:'official full DSH host; synthetic 429 and deterministic provider only; no external LLM calls',passed,...(failure?{error:failure}:{}),home},null,2));console.log('ARTIFACTS',root)}
