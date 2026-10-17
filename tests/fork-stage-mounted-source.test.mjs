import {officialPhonePack,PHONE_PACK_ID} from './fixtures/source-widget/fork-build-phone-widget.mjs'
// private fork: production session adapter + director/checkpoint/coordinator + resource runner
// drive one mounted ForkGalStage. Renderer is an instrumented DOM handoff seam; GPU is the perf gate.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {chromium} from 'playwright'
import {browserReactScript} from './fixtures/browser-react.mjs'
import {transcriptSource} from './helpers/fork-transcript-perf-ui.mjs'
import {fixture,answer,deferred} from './helpers/stage-director-harness.mjs'
import {figureActorKey} from '../tavern-plugin/lib/domain/figure-catalogue.js'
import {PACK_ID,FIGURE_ID} from './fixtures/asset-packs/pack.mjs'
const actorKey=figureActorKey({packId:PACK_ID,figureId:FIGURE_ID}) // private fork: new commands address the recalled figure, not a removed card alias.
import {readStageProjection} from '../tavern-plugin/lib/domain/stage-projection.js'
import {read,between,shell} from './helpers/mounted-stage-shell.mjs'
test('same mounted stage shows streamed body immediately and late/regenerated real director results at the current page',{timeout:60000},async t=>{
  const checkpoint=deferred(),finish=deferred();let run=0,failProjection=false,warnProjection=false
  const f=await fixture(async request=>{
    if(++run===2){await request.onToolCall({name:'stage_update',arguments:{...answer,through:1,done:false,beats:[answer.beats[0]]}});checkpoint.resolve();await finish.promise
      await request.onToolCall({name:'stage_update',arguments:{sequence:2,through:2,done:true,beats:[answer.beats[1]]}})
    } else await request.onToolCall({name:'stage_update',arguments:run===3 ? {...answer,beats:[answer.beats[0]]} : answer})
  });t.after(async()=>{finish.resolve();await f.dispose()})
  const browser=await chromium.launch({channel:'chrome',headless:true});t.after(()=>browser.close())
  const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message))
  await page.exposeFunction('hostDirection',args=>f.director.get(f.read(),args.turn,null,args))
  await page.exposeFunction('hostLease',args=>f.services.get('assetLibrary').leaseMedia(args))
  await page.exposeFunction('hostProjection',async args=>{
    if(failProjection) return {status:'failed',error:{code:'PROJECTION_FAILED',message:'authority is not defined'}}
    const result=await readStageProjection({...args,
      revision:()=>f.assets.revision,readSettings:()=>f.engineSettings.read(),readConsumer:()=>f.assets.consumer(f.read(),'http://localhost'),readDirection:()=>f.director.get(f.read(),args.turn,null,{readOnly:true})})
    // private fork: reproduce the mixed object/string warning returned by historical playback.
    if(warnProjection && result.status==='ready') result.value.diagnostics=[{code:'time-look-missing',message:'Missing time looks for dusk / night'},'legacy-media-reconstructed: original media versions unknown']
    return result
  })
  const stop=f.signals.subscribe('session','stage-direction',()=>{void page.evaluate(()=>window.wakeDirection?.()).catch(()=>{})});t.after(stop)
  await page.route('https://stage.test/**',route=>route.fulfill({contentType:'text/html',body:'<style>body{color:#222}</style>'}))
  await page.goto('https://stage.test/')
  await page.addScriptTag({content:await browserReactScript()+'\nconst React=modules.react,ReactDOM={...modules["react-dom"],...modules["react-dom/client"]};\n'+transcriptSource(read).replaceAll("'offline'","'session'")+shell})
  await page.waitForFunction(()=>window.stageProbe)
  assert.equal(f.calls.length,0,'mount is read-only')
  await f.director.get(f.read(),1);await f.director.drain()
  await page.waitForFunction(()=>stageProbe.state().accepted.scene?.backgroundUrl)
  const first=await page.evaluate(()=>({identity:stageProbe.state().accepted.scene.backgroundMedia.identity,anchor:stageProbe.state().cursor.anchor,ruler:stageProbe.state().accepted.ruler}))
  f.appendReply(2)
  await page.evaluate(()=>stageProbe.nodes([stageProbe.native(1,'Synthetic fixture.\n\nSynthetic dusk.'),stageProbe.native(2,'Synthetic','running')],true))
  assert.equal(await page.locator('.fork-gal-writing').count(),0)
  assert.match(await page.locator('.fork-gal-text').last().textContent(),/Synthetic/)
  assert.equal(await page.evaluate(()=>stageProbe.state().accepted.scene.backgroundMedia.identity),first.identity)
  assert.deepEqual(await page.evaluate(()=>stageProbe.state().accepted.ruler),first.ruler)
  await page.evaluate(()=>stageProbe.nodes([stageProbe.native(1,'Synthetic fixture.\n\nSynthetic dusk.'),stageProbe.native(2,'Synthetic fixture.\n\nSynthetic dusk.')],false))
  await page.evaluate(()=>stageProbe.page(1))
  const anchor=await page.evaluate(()=>stageProbe.state().cursor.anchor)
  await f.director.get(f.read(),2);await checkpoint.promise
  await page.waitForFunction(()=>stageProbe.state().director.phase==='partial')
  assert.deepEqual(await page.evaluate(()=>stageProbe.state().cursor.anchor),anchor)
  finish.resolve();await f.director.drain()
  await page.waitForFunction(()=>stageProbe.state().director.phase==='done')
  await page.waitForFunction(()=>!stageProbe.state().pending.projection && !stageProbe.state().pending.resources)
  const accepted=await page.evaluate(()=>stageProbe.state().accepted.scene.backgroundMedia.identity)
  assert.notEqual(accepted,first.identity)
  failProjection=true;await page.evaluate(()=>stageProbe.refresh());await page.waitForFunction(()=>stageProbe.state().pending.error?.includes('PROJECTION_FAILED'))
  // private fork: player details are Chinese; raw engine errors remain diagnostic-only.
  assert.equal(await page.locator('.fork-gal-runtime-status strong').textContent(),'演出暂不可用')
  assert.equal(await page.locator('.fork-gal-runtime-status code').textContent(),'舞台资源投影失败')
  assert.equal(await page.locator('.fork-gal-text').count(),1,'structured RPC error leaves the stage mounted')
  assert.equal(await page.evaluate(()=>stageProbe.state().accepted.scene.backgroundMedia.identity),accepted)
  failProjection=false
  await f.director.generate(f.read(),2);await f.director.drain()
  await page.waitForFunction(()=>stageProbe.state().director.generation===1 && stageProbe.state().director.phase==='done')
  await page.waitForFunction(identity=>stageProbe.state().accepted.scene.backgroundMedia.identity===identity,first.identity)
  assert.equal(await page.locator('[data-scene]').getAttribute('data-scene'),await page.evaluate(()=>stageProbe.state().accepted.scene.backgroundUrl))
  assert.deepEqual(await page.evaluate(()=>stageProbe.state().cursor.anchor),anchor)
  assert.deepEqual(await page.evaluate(()=>stageProbe.stats()),{mounts:1,unmounts:0})
  warnProjection=true;await page.evaluate(()=>stageProbe.refresh())
  await page.waitForFunction(()=>stageProbe.state().accepted.scene?.diagnostics?.some(item=>item.code==='time-look-missing'))
  // private fork: scene diagnostics are debug-only; structured details keep their identity.
  const diagnostic = page.locator('.fork-gal-runtime-status[data-tone="debug"]')
  assert.match(await diagnostic.locator('span').textContent(),/缺少对应时段的灯光预设/)
  assert.match(await diagnostic.locator('code').textContent(),/time-look-missing: Missing time looks for dusk \/ night/)
  assert.doesNotMatch(await diagnostic.textContent(),/\[object Object\]/)
  assert.deepEqual(errors,[])
  await page.evaluate(()=>stageProbe.dispose())
})

// private fork: production ops must reach a mounted GAL, including the real phone hook.
test('mounted camera close-up, specified transition and phone consume a sealed prefix without remounting on done',{timeout:60000},async t=>{
  const finish=deferred(),checkpoint=deferred()
  const text='Synthetic fixture.\n\n@bubble:actor|Actor|calm|[A phone message.]\n\nThree.\n\nFour.\n\nFive.'
  const f=await fixture(async request=>{
    const reply=JSON.parse(await request.onToolCall({name:'stage_update',arguments:{sequence:1,through:2,done:false,beats:[
      {at:1,ops:[answer.beats[0].ops[0],{op:'cast.add',actor:actorKey}]},
      {at:2,ops:[answer.beats[1].ops[0],{op:"transition.play", transition:'iris'},{op:"closeup.play", actor:actorKey} /* private fork: one close-up command */,{op:"widget.testphone.mark",ref:{packId:PHONE_PACK_ID,kind:'widgets',assetId:'phone'}, contact:actorKey, side:'in'}]}
    ]}}))
    assert.equal(reply.ok,true,JSON.stringify(reply));checkpoint.resolve();await finish.promise
    assert.equal(JSON.parse(await request.onToolCall({name:'stage_update',arguments:{sequence:2,through:5,done:true,beats:[]}})).ok,true)
  });t.after(async()=>{finish.resolve();await f.dispose()})
  const phone=await officialPhonePack(),library=f.services.get('assetLibrary'),getPack=library.getPackSnapshot,resolveAssets=library.resolveAssets
  f.workspace.raw.extensions.dsh_tavern.stage={widgets:true} // private fork: phone execution opts in
  f.workspace.raw.extensions.dsh_tavern.assetBindings.boundPackIds.push(PHONE_PACK_ID)
  library.getPackSnapshot=async args=>args.packId===PHONE_PACK_ID?{...phone,revision:'phone-r1'}:getPack(args)
  library.resolveAssets=async ({refs})=>Promise.all(refs.map(async ref=>ref.packId===PHONE_PACK_ID?{ref,revision:'phone-r1',value:phone.manifest.assets.find(asset=>asset.id===ref.assetId),diagnostics:[]}:(await resolveAssets({refs:[ref]}))[0]))
  library.leaseWidget=async()=>({url:'/api/dsh-asset-library/v2/lease/fixture/index.html',ticket:'fixture',expiresAt:Date.now()+60000})
  await f.store.updateChat('chat',chat=>{chat.messages.find(m=>m.role==='assistant').text=text;return chat})
  const browser=await chromium.launch({channel:'chrome',headless:true});t.after(()=>browser.close())
  const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message))
  await page.exposeFunction('hostDirection',args=>f.director.get(f.read(),args.turn,null,args))
  await page.exposeFunction('hostLease',args=>f.services.get('assetLibrary').leaseMedia(args))
  await page.exposeFunction('hostProjection',args=>readStageProjection({...args,revision:()=>f.assets.revision,
    readSettings:()=>f.engineSettings.read(),readConsumer:()=>f.assets.consumer(f.read(),'http://localhost'),readDirection:()=>f.director.get(f.read(),args.turn,null,{readOnly:true})}))
  t.after(f.signals.subscribe('session','stage-direction',()=>{void page.evaluate(()=>window.wakeDirection?.()).catch(()=>{})}))
  await page.route('https://stage.test/**',route=>route.fulfill({contentType:'text/html',body:'<style>body{color:#222}</style>'}))
  await page.goto('https://stage.test/')
  await page.route('https://stage.test/api/dsh-asset-library/v2/lease/fixture/**',route=>{
    const resource=new URL(route.request().url()).pathname.split('/fixture/')[1],file=phone.files.get('bundles/phone/'+resource)
    return route.fulfill({status:file?200:404,contentType:resource.endsWith('.js')?'text/javascript':resource.endsWith('.css')?'text/css':resource.endsWith('.html')?'text/html':'application/octet-stream',body:file || ''})
  })
  await page.addStyleTag({content:'.fork-gal-stage{position:relative;width:1200px;height:850px}.fork-gal-box{position:absolute;bottom:0;height:100px}.fork-gal-topbar{height:44px}.fork-widget-layer{position:absolute;inset:0}'})
  // private fork: late accepted marks now reach widget audio; this DOM fixture supplies the existing mixer port.
  const wiringShell='Object.assign(forkStageAudio,{bind(){},release(){}});\n'+shell.replace('    const wheelGesture', '    window.phoneProbe=sourceWidget; const wheelGesture')
    .replace("characters:[],voice", "characters:[{alias:'actor',name:'Actor'}],voice").replace("stage:{face:'off',music:false}","stage:{face:'off',music:false,widgets:true}")
    .replace("native(1,'Synthetic fixture.\\n\\nSynthetic dusk.')",'native(1,'+JSON.stringify(text)+')')
    .replace("const para = current && current.para || 1;", "window.wiringNext=()=>go(1,true); const para = current && current.para || 1;")
    .replace("function ForkGalScene(props){", "function ForkGalScene(props){ window.sceneProbe=props.scene;")
  await page.addScriptTag({content:await browserReactScript()+'\nconst React=modules.react,ReactDOM={...modules["react-dom"],...modules["react-dom/client"]};\n'+transcriptSource(read).replaceAll("'offline'","'session'")+wiringShell})
  await page.waitForFunction(()=>window.stageProbe)
  assert.equal(f.calls.length,0)
  void f.director.get(f.read(),1)
  await checkpoint.promise
  await page.waitForFunction(()=>stageProbe.state().director.phase==='partial' && sceneProbe.figures.length===1)
  await page.evaluate(()=>wiringNext())
  await page.waitForFunction(()=>sceneProbe.camera.shot==='close' && !('focus' in sceneProbe.figures[0]) && window.phoneProbe?.items.some(item=>item.source?.current))
  assert.equal(await page.evaluate(()=>sceneProbe.background.transition),'iris')
  assert.equal(await page.evaluate(()=>phoneProbe.items[0].source.messages.at(-1).text),'A phone message.')
  const key=await page.evaluate(()=>phoneProbe.items[0].identity)
  finish.resolve();await f.director.drain()
  await page.waitForFunction(()=>stageProbe.state().director.phase==='done')
  assert.equal(await page.evaluate(()=>phoneProbe.items[0].identity),key)
  // private fork: paragraph 2 close-up lasts through paragraph 5 (end-exclusive).
  for (const shot of ['close','close','close']) {
    await page.evaluate(()=>wiringNext())
    await page.waitForFunction(expected=>sceneProbe.camera.shot===expected,shot)
  }
  assert.deepEqual(await page.evaluate(()=>stageProbe.stats()),{mounts:1,unmounts:0})
  assert.deepEqual(errors,[])
  await page.evaluate(()=>stageProbe.dispose())
})
