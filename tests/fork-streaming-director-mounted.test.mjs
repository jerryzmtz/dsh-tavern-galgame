import {directorPromptData} from './fixtures/asset-packs/prompt.mjs'
// private fork: production foreground observer -> host pack transaction/CAS -> mounted stage.
// Fake story/director transport, actual source/runtime/resource owners; renderer is the DOM handoff seam.
import test from 'node:test'
import assert from 'node:assert/strict'
import {chromium} from 'playwright'
import {browserReactScript} from './fixtures/browser-react.mjs'
import {transcriptSource} from './helpers/fork-transcript-perf-ui.mjs'
import {fixture,answer,deferred} from './helpers/stage-director-harness.mjs'
import {readStageProjection} from '../tavern-plugin/lib/domain/stage-projection.js'
import {createForegroundStageStream} from '../tavern-plugin/lib/domain/foreground-stage-stream.js'
import {read,shell} from './helpers/mounted-stage-shell.mjs'
const paragraphs = n => Array.from({length:n},(_,i)=>'Streaming paragraph '+(i+1)+'.').join('\n\n')

for (const scenario of ['latency-hidden','rewrite','stop','failure','regenerate']) test('mounted streaming direction: '+scenario,{timeout:60000},async t=>{
  const gate=deferred(),started=deferred();let calls=0
  const f=await fixture(async request=>{
    calls++
    if(calls===1) {await request.onToolCall({name:'stage_update',arguments:answer});return}
    if(calls===2) {started.resolve();await gate.promise}
    if(scenario==='failure') throw new Error('Fake director failure')
    const tail=directorPromptData(request), through=tail.first+tail.reply.length-1
    await request.onToolCall({name:'stage_update',arguments:{sequence:1,through,done:true,beats:[{at:tail.first,ops:[{...answer.beats[0].ops[0],time:'night'}]}]}})
  });t.after(async()=>{gate.resolve();await f.dispose()})
  const browser=await chromium.launch({channel:'chrome',headless:true});t.after(()=>browser.close())
  const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message))
  await page.exposeFunction('hostDirection',args=>f.director.get(f.read(),args.turn,null,args))
  await page.exposeFunction('hostLease',args=>f.services.get('assetLibrary').leaseMedia(args))
  await page.exposeFunction('hostProjection',args=>readStageProjection({...args,
    revision:()=>f.assets.revision,readSettings:()=>f.engineSettings.read(),readConsumer:()=>f.assets.consumer(f.read(),'http://localhost'),readDirection:()=>f.director.get(f.read(),args.turn,null,{readOnly:true})}))
  t.after(f.signals.subscribe('session','stage-direction',()=>{void page.evaluate(()=>window.wakeDirection?.()).catch(()=>{})}))
  await page.route('https://stage.test/**',route=>route.fulfill({contentType:'text/html',body:'<style>body{color:#222}</style>'}))
  await page.goto('https://stage.test/')
  await page.addScriptTag({content:await browserReactScript()+'\nconst React=modules.react,ReactDOM={...modules["react-dom"],...modules["react-dom/client"]};\n'+transcriptSource(read).replaceAll("'offline'","'session'")+shell})
  await page.waitForFunction(()=>window.stageProbe)
  await f.director.get(f.read(),1);await f.director.drain()
  // Capture the directed scene, not the transient fallback shown while projection resolves.
  await page.waitForFunction(()=>stageProbe.state().director.phase==='done' && stageProbe.state().accepted.scene?.backgroundUrl)
  const initial=await page.evaluate(()=>stageProbe.state().accepted.scene.backgroundMedia.identity)
  let activeTurn=2, operation=f.beginReply(2)
  const controller=new AbortController()
  let observer=createForegroundStageStream({begin:()=>f.director.beginStream(f.read(),2),signal:controller.signal,warn:error=>errors.push(error.message)})
  await observer.ready
  let body=''
  // The fake story stream has distinct first-token, paragraph and growing-tail deliveries.
  for (const chunk of ['Streaming', paragraphs(7).slice('Streaming'.length)]) {
    body+=chunk;observer.append(chunk)
    await page.evaluate(text=>stageProbe.nodes([stageProbe.native(1,'Synthetic fixture.\n\nSynthetic dusk.'),stageProbe.native(2,text,'running')],true),body)
  }
  await started.promise
  assert.match(await page.locator('.fork-gal-text').last().textContent(),/Streaming/)
  assert.equal(await page.locator('.fork-gal-writing').count(),0)
  const anchor=await page.evaluate(()=>stageProbe.state().cursor.anchor)
  if(scenario==='latency-hidden') await page.evaluate(()=>transcriptProbe.runtime.dispatch({type:'VISIBILITY',visible:false}))
  if(scenario==='stop') {controller.abort();observer.finish(false)}
  if(scenario==='regenerate') {
    controller.abort();f.branch();activeTurn=3;operation=f.beginReply(3)
    observer=createForegroundStageStream({begin:()=>f.director.beginStream(f.read(),3)})
    await observer.ready;body=body.replaceAll('Streaming','Regenerated');observer.append(body)
    await page.evaluate(text=>stageProbe.nodes([stageProbe.native(1,'Synthetic fixture.\n\nSynthetic dusk.'),stageProbe.native(3,text,'running')],true),body)
  }
  gate.resolve();await f.director.drain()
  await page.waitForFunction(kind=>stageProbe.state().director.phase===(['stop','failure'].includes(kind)?'error':'partial'),scenario)
  assert.equal(await page.evaluate(()=>stageProbe.state().accepted.scene.backgroundMedia.identity),initial,'late direction never restages the already-read page')
  if(scenario!=='regenerate') assert.deepEqual(await page.evaluate(()=>stageProbe.state().cursor.anchor),anchor)
  if(scenario==='latency-hidden') {
    assert.equal(await page.evaluate(()=>stageProbe.state().visible),false)
    assert.equal(await page.evaluate(()=>stageProbe.state().director.through),6,'hidden windows still consume director data')
    await page.evaluate(()=>transcriptProbe.runtime.dispatch({type:'VISIBILITY',visible:true}))
  }
  const final=scenario==='rewrite' ? body.replace('paragraph 1.','rewritten paragraph.') : body
  observer.finish(scenario!=='stop')
  f.commitReply(operation,activeTurn,final)
  await page.evaluate(({text,turn})=>stageProbe.nodes([stageProbe.native(1,'Synthetic fixture.\n\nSynthetic dusk.'),stageProbe.native(turn,text)],false),{text:final,turn:activeTurn})
  await f.director.get(f.read(),activeTurn);await f.director.drain()
  await page.waitForFunction(kind=>stageProbe.state().director.phase===(['stop','failure'].includes(kind)?'error':'done'),scenario)
  assert.equal(await page.evaluate(()=>stageProbe.state().accepted.scene.backgroundMedia.identity),initial)
  if(!['stop','failure'].includes(scenario)) {
    await page.evaluate(()=>stageProbe.page(1))
    await page.waitForFunction(identity=>stageProbe.state().accepted.scene.backgroundMedia.identity!==identity,initial)
  }
  assert.ok(calls-1<=(scenario==='regenerate' ? 2 : 1)*(Math.ceil(7/6)+1))
  assert.deepEqual(await page.evaluate(()=>stageProbe.stats()),{mounts:1,unmounts:0})
  assert.deepEqual(errors,[])
  await page.evaluate(()=>stageProbe.dispose())
})
