// private fork: real stage/choices + session source + host director; no live RPC/model.
import test from 'node:test'
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {chromium} from 'playwright'
import {browserReactScript} from './fixtures/browser-react.mjs'
import {forkTextAreaSource} from './helpers/fork-spinner.mjs' // private fork (UI standard phase 2 batch 16): ForkTextArea
import {transcriptSource} from './helpers/fork-transcript-perf-ui.mjs'
import {fixture,answer,deferred} from './helpers/stage-director-harness.mjs'
import {readStageProjection} from '../tavern-plugin/lib/domain/stage-projection.js'
import {read,between,shell} from './helpers/mounted-stage-shell.mjs'
import {sessionHarness,nativeNode} from './helpers/stage-session-harness.mjs'

const client = name => process.env.STAGE_LIVE_BASELINE
  ? execFileSync('git',['show',process.env.STAGE_LIVE_BASELINE+':tavern-plugin/src/client/'+name],{encoding:'utf8',maxBuffer:8*1024*1024}) : read(name)

test('SEND before a new native node leaves a same-source history cursor',async()=>{
  const h=sessionHarness({nodes:[nativeNode(127,'Previous completed reply.')]})
  try {
    await h.owner.navigate('s',127,0,false)
    assert.equal(h.state().cursor.mode,'history')
    const accepted=h.state().accepted
    h.binding.run(true)
    assert.equal(h.state().cursor.mode,'live')
    h.binding.set([nativeNode(127,'Previous completed reply.'),nativeNode(128,'First bytes',{status:'running'})])
    assert.equal(h.state().source.turn,128)
    assert.equal(h.state().text.pages[0].text,'First bytes')
    assert.equal(h.state().accepted,accepted)
  } finally {h.dispose()}
})

for (const outcome of ['partial','hidden','failure','submit-failure','provider-refusal']) test('stage submit -> status -> streamed pages -> '+outcome+' -> final',{timeout:60000},async t=>{
  const sealed=deferred(),finish=deferred()
  const f=await fixture(async request=>{
    if(outcome==='failure') throw new Error('Synthetic director failure')
    assert.deepEqual(request.tools.map(tool=>tool.name),['stage_update'])
    assert.equal(JSON.parse(await request.onToolCall({name:'stage_update',arguments:{...answer,through:1,done:false,beats:[answer.beats[0]]}})).ok,true)
    sealed.resolve();await finish.promise
    assert.equal(JSON.parse(await request.onToolCall({name:'stage_update',arguments:{sequence:2,through:2,done:true,beats:[answer.beats[1]]}})).ok,true)
  });t.after(async()=>{finish.resolve();await f.dispose()})
  const browser=await chromium.launch({channel:'chrome',headless:true});t.after(()=>browser.close())
  const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message))
  await page.exposeFunction('hostDirection',args=>f.director.get(f.read(),args.turn,null,args))
  await page.exposeFunction('hostLease',args=>f.services.get('assetLibrary').leaseMedia(args))
  await page.exposeFunction('hostProjection',args=>readStageProjection({...args,revision:()=>f.assets.revision,
    readSettings:()=>f.engineSettings.read(),readConsumer:()=>f.assets.consumer(f.read(),'http://localhost'),readDirection:()=>f.director.get(f.read(),args.turn,null,{readOnly:true})}))
  t.after(f.signals.subscribe('session','stage-direction',()=>{void page.evaluate(()=>window.wakeDirection?.()).catch(()=>{})}))
  await page.route('https://stage.test/**',route=>route.fulfill({contentType:'text/html',body:'<style>body{color:#222}</style>'}))
  await page.goto('https://stage.test/')
  let mounted=shell.replace(between(read('fork-gal-stage.js'),'function ForkGalStage(props)','// Name plate of the text box'),between(client('fork-gal-stage.js'),'function ForkGalStage(props)','// Name plate of the text box'))
  mounted=mounted.replace('function useTavernCoordination(){return {}}', `
    let coordinationView={};const coordinationListeners=new Set();
    window.setCoordination=value=>{coordinationView=value;coordinationListeners.forEach(fn=>fn())};
    function useTavernCoordination(){return React.useSyncExternalStore(fn=>{coordinationListeners.add(fn);return()=>coordinationListeners.delete(fn)},()=>coordinationView)}
  `)
  mounted=mounted.replace('const target=document.createElement',`
    function useFixtureSession(select){return React.useSyncExternalStore(nativeSession.subscribe,()=>select(nativeSession.getSnapshot()))}
    const choiceProps={useSession:useFixtureSession,useChat:()=> 'last-message',executeSlash:async command=>{window.submittedCommand=command;await new Promise((resolve,reject)=>{window.finishSubmit=resolve;window.failSubmit=reject})}};
    const useCandidatePanel=()=>null,setCandidatePanel=()=>{},useForkUiSfxControls=()=>{},latestTavernAssistantMessageId=()=> 'last-message';
    ${forkTextAreaSource}${client('fork-gal-choices.js')}
    const target=document.createElement`)
    .replace("{sessionId:'session',data:","{sessionId:'session',Choices:ForkGalChoices,choiceProps,data:")
  const {readFileSync}=await import('node:fs')
  const refusal=readFileSync(new URL('../tavern-plugin/lib/domain/response-refusal.js',import.meta.url),'utf8').replace(/export \{[^}]+\}/,'')+'\n'+client('refusal-notice.js')
  await page.addScriptTag({content:await browserReactScript()+'\nconst React=modules.react,ReactDOM={...modules["react-dom"],...modules["react-dom/client"]};\n'+refusal+'\n'+transcriptSource(client).replaceAll("'offline'","'session'")+mounted})
  await page.waitForFunction(()=>window.stageProbe)
  await page.evaluate(()=>stageProbe.page(1))
  await page.getByRole('menuitem',{name:'自由输入'}).click()
  await page.getByRole('textbox',{name:'自由输入下一步'}).fill('Offline next turn')
  // Observe from the actual Enter event, not from a later host acknowledgement.
  await page.evaluate(()=>{window.submitAt=0;window.statusMs=null;document.addEventListener('keydown',()=>{window.submitAt=performance.now()},{once:true,capture:true});new MutationObserver(()=>{if(window.submitAt&&window.statusMs===null&&document.querySelector('.is-awaiting'))window.statusMs=performance.now()-window.submitAt}).observe(document.body,{subtree:true,childList:true,attributes:true})})
  await page.getByRole('textbox',{name:'自由输入下一步'}).press('Enter')
  await page.waitForFunction(()=>window.statusMs!==null,{},{timeout:1000})
  assert.ok(await page.evaluate(()=>statusMs<150),'submit status appears within 150 ms, before slash resolves')
  assert.equal(await page.locator('[aria-label="正在书写下一幕"]').count(),1)
  assert.equal(await page.evaluate(()=>submittedCommand),'/send Offline next turn|/trigger')
  if(outcome==='partial') {
    await page.evaluate(()=>setCoordination({view:{activity:{role:'settlement',phase:'running',busy:true}}}))
    await page.getByRole('status',{name:'正在等待上一轮后台结算，完成后开始正文'}).waitFor()
    assert.match(await page.locator('.fork-gal-writing').textContent(),/等待上一轮后台结算/)
    await page.evaluate(()=>setCoordination({view:{activity:{role:'settlement',phase:'failed',busy:false}}}))
    await page.getByRole('status',{name:'正在书写下一幕'}).waitFor()
  }
  if(outcome==='submit-failure') {
    await page.evaluate(()=>failSubmit(new Error('Synthetic admission failure')))
    await page.getByRole('alert').waitFor()
    assert.match(await page.getByRole('alert').textContent(),/Synthetic admission failure/)
    assert.equal(await page.getByRole('textbox',{name:'自由输入下一步'}).inputValue(),'Offline next turn')
    assert.equal(await page.locator('.is-awaiting').count(),0)
    assert.equal(f.calls.length,0)
    await page.evaluate(()=>stageProbe.dispose());return
  }
  // Reproduce the session ACK-before-node race with a history cursor.
  await page.evaluate(async()=>{await transcriptProbe.owner.navigate('session',1,1,false);stageProbe.nodes([stageProbe.native(1,'Synthetic fixture.\n\nSynthetic dusk.')],true)})
  if(outcome==='hidden') await page.evaluate(()=>{
    Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'});
    document.dispatchEvent(new Event('visibilitychange'));transcriptProbe.runtime.dispatch({type:'VISIBILITY',visible:false})
  })
  f.appendReply(2)
  await page.evaluate(()=>stageProbe.nodes([stageProbe.native(1,'Synthetic fixture.\n\nSynthetic dusk.'),stageProbe.native(2,'Synthetic','running')],true))
  assert.equal(await page.evaluate(()=>stageProbe.state().source.turn),2)
  assert.equal(await page.evaluate(()=>stageProbe.state().text.pages[0].text),'Synthetic')
  assert.match(await page.locator('.fork-gal-text').last().textContent(),/Synthetic/)
  assert.equal(await page.locator('.fork-gal-waiting').count(),0)
  await page.evaluate(()=>stageProbe.nodes([stageProbe.native(1,'Synthetic fixture.\n\nSynthetic dusk.'),stageProbe.native(2,'Synthetic fixture.\n\nSynthetic dusk.','running')],true))
  assert.equal(await page.evaluate(()=>stageProbe.state().text.pages.length),2)
  assert.equal(await page.evaluate(()=>stageProbe.state().text.streaming),true)
  if(outcome==='provider-refusal') {
    await page.evaluate(()=>{
      transcriptProbe.runtime.dispatch({type:'SEND_FAILED',source:stageProbe.state().source,error:'PI_AI_ERROR: Response incomplete: content_filter'})
    })
    await page.getByText('正文模型被服务商内容审核拒绝',{exact:true}).waitFor()
    assert.doesNotMatch(await page.locator('.fork-gal-notices').textContent(),/演出暂不可用|正文不受影响/)
    assert.match(await page.locator('.fork-gal-text').last().textContent(),/Synthetic/)
    assert.deepEqual(errors,[])
    await page.evaluate(()=>stageProbe.dispose());return
  }
  // Host contract starts direction after the canonical reply is committed.
  await page.evaluate(()=>{stageProbe.nodes([stageProbe.native(1,'Synthetic fixture.\n\nSynthetic dusk.'),stageProbe.native(2,'Synthetic fixture.\n\nSynthetic dusk.')],false);finishSubmit()})
  const job=f.director.get(f.read(),2)
  if(outcome==='failure') {
    await job;await f.director.drain()
    await page.waitForFunction(()=>stageProbe.state().director.phase==='error')
    // private fork: merged main keeps raw diagnostics out of player-facing details.
    assert.match(JSON.stringify(await page.evaluate(()=>stageProbe.state().pending.error)),/Synthetic director failure/)
    assert.match(await page.locator('.fork-gal-runtime-status').textContent(),/演出暂不可用.*本轮演出没能套用/)
    assert.doesNotMatch(await page.locator('.fork-gal-runtime-status').textContent(),/Synthetic director failure/)
  } else {
    await sealed.promise
    if(outcome==='hidden') {
      await page.waitForFunction(()=>stageProbe.state().director.phase==='partial'&&stageProbe.state().director.through===1)
      finish.resolve();await job;await f.director.drain()
      await page.waitForFunction(()=>stageProbe.state().director.phase==='done')
      assert.equal(await page.evaluate(()=>stageProbe.state().visible),false,'director progresses before visibility restore')
      await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'visible'});document.dispatchEvent(new Event('visibilitychange'));transcriptProbe.runtime.dispatch({type:'VISIBILITY',visible:true})})
    } else {
      await page.waitForFunction(()=>stageProbe.state().director.phase==='partial'&&stageProbe.state().accepted.scene?.backgroundUrl)
      assert.equal(await page.evaluate(()=>stageProbe.state().director.through),1)
      finish.resolve();await job;await f.director.drain()
    }
    await page.waitForFunction(()=>stageProbe.state().director.phase==='done')
  }
  assert.equal(await page.evaluate(()=>stageProbe.state().text.pages.length),2)
  assert.equal(await page.locator('.fork-gal-waiting').count(),0)
  assert.match(await page.locator('.fork-gal-text').last().textContent(),/Synthetic/)
  assert.deepEqual(await page.evaluate(()=>stageProbe.stats()),{mounts:1,unmounts:0})
  assert.equal(f.calls.length,1,'reads and visibility do not create paid/model work')
  assert.deepEqual(errors,[])
  await page.evaluate(()=>stageProbe.dispose())
})
