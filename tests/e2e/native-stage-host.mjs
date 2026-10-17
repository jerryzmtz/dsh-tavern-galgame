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
const output=resolve(process.env.TAVERN_E2E_OUTPUT || join(source,'output/e2e-native-stage'))
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
try{
 await launch()
 await rpc('gameplay.capabilities');await rpc('listCards');const c=await rpc('gameplay.create',{sourceCard:'native.json',mode:'story',model:{provider:'tavern-e2e',model:'fixed'}});await writeFile(root+'/logs/api-create.json',JSON.stringify(c,null,2));assert.ok(!c.error,c.error)
 const sessionId=c.sessionId
 await rpc('addGuide',{sessionId,text:'NATIVE_GUIDE_SENTINEL：保留前文事实。'})
 await rpc('saveDialogueBubbles',{sessionId,config:{enabled:true,characters:[{alias:'alice',name:'Alice',offstage:false,voice:''}],voice:{enabled:false},stage:{director:true,directorModel:{provider:'tavern-e2e',model:'fixed'},music:false,widgets:false,directorBudget:{maxToolCalls:6,maxBeatsPerCall:8,maxOpsPerCall:32}}}})
 await rpc('gameplay.send',{sessionId,input:'NATIVE_USER_SENTINEL：继续测试'})
 let state,trace=[];for(let i=0;i<100;i++){state=await rpc('gameplay.state',{sessionId},true);trace=(await readFile(home+'/requests.jsonl','utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);if(trace.some(r=>r.role==='director')&&trace.some(r=>r.role==='settlement'))break;if(Object.values(state.chat.timeline.operations).some(x=>x.role==='stage-director'&&x.status==='failed')){await rpc('getStageDirection',{sessionId,turn:2,readOnly:true});break};await wait(100)}
 console.log('ROLES',trace.map(r=>r.role));await writeFile(root+'/logs/native-running-state.json',JSON.stringify(state,null,2));assert.ok(trace.some(r=>r.role==='director'),'no director request');assert.ok(trace.some(r=>r.role==='settlement'),'no settlement request')
 for(let i=0;i<100;i++){state=await rpc('gameplay.state',{sessionId},true);if(state.chat.messages.some(m=>m.stageDirectionDraftV1?.checkpoint?.state?.through===1))break;await wait(100)}
 await writeFile(root+'/logs/native-checkpoint.json',JSON.stringify(state,null,2));console.log('CHECKPOINT',state.chat.messages.map(m=>m.stageDirectionDraftV1));
 await control({holdDirector:false,holdSettlement:true})
 for(let i=0;i<200;i++){state=await rpc('gameplay.state',{sessionId},true);if(state.chat.messages.some(m=>m.stageDirectionV1))break;await wait(100)}
 await writeFile(root+'/logs/native-director-first.json',JSON.stringify(state,null,2));console.log('DIRECTOR_FIRST',state.chat.settleStatus,state.chat.messages.map(m=>m.stageDirectionV1?.end));assert.ok(state.chat.messages.some(m=>m.stageDirectionV1),'director did not commit');assert.notEqual(state.chat.settleStatus,'done','settlement unexpectedly finished')
 await control({holdDirector:false,holdSettlement:false})
 for(let i=0;i<200;i++){state=await rpc('gameplay.state',{sessionId},true);if(state.chat.settleStatus==='done')break;await wait(100)}
 await writeFile(root+'/logs/native-final-state.json',JSON.stringify(state,null,2));assert.equal(state.chat.settleStatus,'done');mark('parallel-director-two-tools-durable-checkpoint-and-posture-settlement')

 const captured=(await requests()).filter(x=>x.role==='director')
 for(const marker of ['NATIVE_CARD_CONTEXT_SENTINEL','NATIVE_PERSONALITY_SENTINEL','NATIVE_SCENARIO_SENTINEL','NATIVE_WORLDBOOK_SENTINEL','NATIVE_GUIDE_SENTINEL','NATIVE_CARD_SYSTEM_SENTINEL','NATIVE_POST_HISTORY_SENTINEL','这是合成测试开场。','第一段测试正文','第二段测试正文'])assert.ok(JSON.stringify(captured[0].input).includes(marker),'Missing context: '+marker)
 assert.deepEqual(captured[0].input.tools.map(x=>x.name),['stage_update']);mark('actual-llm-request-full-context-and-director-tool-whitelist')
 assert.equal(state.chat.timeline.participants['stage-director'],undefined)
 assert.ok(state.chat.timeline.participants.background)
 const effect=state.chat.messages.at(-1).stageDirectionV1;assert.equal(effect.through,2);assert.equal(effect.presentation.stats.submissions,2);assert.equal(effect.end.weather,'rain')
 // Cold restart must retain canonical completion without another director call.
 await stop();await launch();const beforeReload=(await requests()).filter(x=>x.role==='director').length
 const reload=await rpc('getStageDirection',{sessionId,turn:2,readOnly:true});assert.equal(reload.status,'done')
 state=await rpc('gameplay.state',{sessionId},true);assert.deepEqual(state.chat.messages.at(-1).stageDirectionV1,effect)
 assert.equal((await requests()).filter(x=>x.role==='director').length,beforeReload)
 mark('cold-reload-canonical-result-no-repeat-model-call')
 await writeFile(root+'/logs/native-reload.json',JSON.stringify(state,null,2))
 // Resume through the production Session controller, then hold both task roles.
 await rpc('gameplay.native',{sessionId})
 await control({holdDirector:true,holdSettlement:true})
 await rpc('gameplay.send',{sessionId,input:'NATIVE_SECOND_ROUND：再继续'})
 for(let i=0;i<150;i++){state=await rpc('gameplay.state',{sessionId},true);if(state.chat.messages.at(-1)?.stageDirectionDraftV1?.checkpoint?.state?.through===1&&state.activity.busy)break;await wait(100)}
 assert.equal(state.chat.messages.at(-1).turn,3)
 assert.equal(state.chat.messages.at(-1).stageDirectionDraftV1?.checkpoint?.state?.through,1)
 assert.ok(JSON.stringify((await requests()).filter(x=>x.role==='director').at(-1).input).includes('NATIVE_POSTURE_SENTINEL'),'latest settled posture missing from director request')
 const runningDirector=Object.values(state.chat.timeline.operations).find(x=>x.role==='stage-director'&&x.status==='running');assert.ok(runningDirector)
 await rpc('stopBackground',{sessionId,operationId:state.activity.operationId})
 state=await rpc('gameplay.state',{sessionId},true);assert.equal(state.chat.timeline.operations[runningDirector.id].status,'running');assert.equal(state.activity.phase,'failed')
 await control({holdDirector:false,holdSettlement:true})
 for(let i=0;i<100;i++){state=await rpc('gameplay.state',{sessionId},true);if(state.chat.messages.at(-1).stageDirectionV1)break;await wait(100)}
 assert.ok(state.chat.messages.at(-1).stageDirectionV1);assert.equal(state.activity.phase,'failed');mark('core-cancel-preserves-parallel-director')
 await control({holdDirector:false,holdSettlement:false})
 await rpc('retrySettlement',{sessionId,turn:3})
 for(let i=0;i<150;i++){state=await rpc('gameplay.state',{sessionId},true);if(state.chat.settleStatus==='done')break;await wait(100)}
 assert.equal(state.chat.settleStatus,'done');mark('core-retry-success')
 await writeFile(root+'/logs/native-cancel-retry.json',JSON.stringify(state,null,2))
 // A killed host leaves the accepted prefix on disk for the original runner to resume.
 await control({holdDirector:true,holdSettlement:true});await rpc('gameplay.send',{sessionId,input:'NATIVE_THIRD_ROUND：恢复保存点'})
 for(let i=0;i<150;i++){state=await rpc('gameplay.state',{sessionId},true);if(state.chat.messages.at(-1)?.turn===4&&state.chat.messages.at(-1)?.stageDirectionDraftV1?.checkpoint?.state?.through===1)break;await wait(100)}
 assert.equal(state.chat.messages.at(-1).stageDirectionDraftV1?.checkpoint?.state?.through,1)
 const superseded=state.chat.messages.at(-1).stageDirectionDraftV1.operationId
 const coreOperation=state.activity.operationId
 await rpc('retryStageDirection',{sessionId,turn:4})
 await rpc('getStageDirection',{sessionId,turn:4})
 for(let i=0;i<150;i++){state=await rpc('gameplay.state',{sessionId},true);const draft=state.chat.messages.at(-1)?.stageDirectionDraftV1;if(draft?.operationId!==superseded&&draft?.checkpoint?.state?.through===1)break;await wait(100)}
 assert.notEqual(state.chat.messages.at(-1).stageDirectionDraftV1?.operationId,superseded)
 assert.equal(state.chat.messages.at(-1).stageDirectionDraftV1?.checkpoint?.state?.through,1)
 assert.equal(state.chat.timeline.operations[coreOperation].status,'running')
 mark('director-cancel-and-explicit-retry-preserve-core-task')
 await writeFile(root+'/logs/native-before-crash.json',JSON.stringify(state,null,2));const countBeforeCrash=(await requests()).filter(x=>x.role==='director').length
 await stop('SIGKILL');await control({holdDirector:false,holdSettlement:true});await launch(sessionId)
 await rpc('getStageDirection',{sessionId,turn:4})
 for(let i=0;i<150;i++){state=await rpc('gameplay.state',{sessionId},true);if(state.chat.messages.at(-1)?.stageDirectionV1||state.chat.messages.at(-1)?.stageDirectionFailureV1)break;await wait(100)}
 await writeFile(root+'/logs/native-after-crash.json',JSON.stringify(state,null,2));assert.ok(state.chat.messages.at(-1).stageDirectionV1,JSON.stringify(state.chat.messages.at(-1).stageDirectionFailureV1))
 const resumed=(await requests()).filter(x=>x.role==='director').slice(countBeforeCrash);assert.equal(resumed.length,1);assert.ok(resumed[0].input.messages.flatMap(m=>m.content||[]).some(b=>b.type==='text'&&b.text.includes('"nextSequence":2')))
 mark('crashed-host-resumes-prefix-at-next-sequence-with-one-model-call')
 await control({holdDirector:false,holdSettlement:false})
 completed=true
}catch(error){failure=String(error.stack||error);throw error}
finally{if(child&&child.exitCode===null)await stop();await writeFile(root+'/logs/api-host.log',log.replace(/token=[^\s]+/g,'token=REDACTED'));await writeFile(join(root,'report.json'),JSON.stringify({status:completed?'passed':'failed',scope:'official DSH 0.1.5-rc.2 CLI + full Tavern plugin + production HTTP/native Sessions; deterministic provider only',passed,home,...(failure?{error:failure}:{}),limitations:['browser rendering blocked by environment','official browser MVU settlement not executed','no real LLM provider configured']},null,2));console.log('ARTIFACTS',root);}
