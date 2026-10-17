import {tmpdir as publicTmpdir} from 'node:os';
import {join as publicJoin} from 'node:path';
import {bubbleResolutionSource} from './helpers/bubble-resolution-source.mjs' // private fork
// private fork: pack-only cards do not persist empty retired character tables.
// private fork: actual host hook, one reading typewriter and the shipped opaque phone bundle.
import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile,mkdir} from 'node:fs/promises'
import {chromium} from 'playwright'
import {browserReactScript} from './fixtures/browser-react.mjs'
import {widgetServer,templateFiles} from './fixtures/widget-harness.mjs'
import {writePhonePack,PHONE_PACK_ID} from './fixtures/source-widget/fork-build-phone-widget.mjs'
import {createAssetPackService} from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/service.js'
import {createAssetPackPresentation} from '../tavern-plugin/lib/domain/asset-pack-presentation.js'
import {defaultAssetEngineSettings} from '../tavern-plugin/lib/domain/asset-engine-settings.js'
import {mkdtemp} from 'node:fs/promises'
const root=new URL('../',import.meta.url),read=name=>readFile(new URL('tavern-plugin/src/client/'+name,root),'utf8')
test('hidden/compact/open and sheet share one frame, preserve reading progress, respect fresh content and revocation',async t=>{
 const dir=await mkdtemp(publicJoin(publicTmpdir(), 'presentation-browser-')),service=createAssetPackService({assetRoot:dir+'/store',authorizeLease:async()=>true});t.after(()=>service.dispose())
 await writePhonePack(dir+'/phone.zip');const preview=await service.inspectImport({bytes:await readFile(dir+'/phone.zip')});await service.applyImport({inspectionId:preview.inspectionId,expectedRevision:null,decision:'install',acceptScriptRisk:true})
 let origin
 origin=await widgetServer(t,{connect(value){origin=value},async serve(req,res){const url=new URL(req.url,origin),match=/^\/api\/dsh-asset-library\/v2\/lease\/([^/]+)\/(.+)$/.exec(url.pathname);if(!match)return false;const response=await service.respondLease({ticket:match[1],resource:decodeURIComponent(match[2]),request:new Request(url,{headers:req.headers})});res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));return true}},(_req,res)=>{res.setHeader('Content-Type','text/html');res.end('<!doctype html><div id="root"></div>');return true})
 const letter=(await service.createPack({name:'Lifecycle letters',expectedRevision:null})).snapshot,letterFiles=await templateFiles()
 const assets=Array.from({length:4},(_,i)=>({kind:'widgets',id:'letter-'+i,name:'Letter '+i,enabled:true,recall:{mode:'constant',keywords:[]},directorNote:'',bundleKey:'letter-'+i,entry:'widget.json'}))
 const bundles=Object.fromEntries(assets.map(asset=>[asset.bundleKey,{kind:'widget',entry:'widget.json',contentHash:'0'.repeat(64)}]))
 const fileUpdates=new Map(assets.flatMap(asset=>letterFiles.map(file=>['bundles/'+asset.bundleKey+'/'+file.path,Buffer.from(file.path==='widget.json'?JSON.stringify({...JSON.parse(file.content),namespace:asset.id}):file.content)])))
 await service.patchPack({packId:letter.manifest.id,expectedRevision:letter.revision,patch:{assets,bundles},fileUpdates})
 const presentation=createAssetPackPresentation({raw:{extensions:{dsh_tavern:{schemaVersion:1,stage:{widgets:true},assetBindings:{boundPackIds:[PHONE_PACK_ID,letter.manifest.id]}}}},getService:()=>service,origin,scope:'browser'});t.after(()=>presentation.dispose())
 const [phone]=await presentation.widgets({widgets:{}},{sourceRefs:[{packId:PHONE_PACK_ID,kind:'widgets',assetId:'phone'}],engine:defaultAssetEngineSettings(),isCurrent:()=>true})
 const states=await presentation.widgets({widgets:Object.fromEntries(assets.map((asset,i)=>['w'+i,{ref:{packId:letter.manifest.id,kind:'widgets',assetId:asset.id},state:{body:'Accepted letter '+i},bornStoryTime:0}]))},{engine:defaultAssetEngineSettings(),isCurrent:()=>true})
 const browser=await chromium.launch({headless:true,args:['--autoplay-policy=no-user-gesture-required','--explicitly-allowed-ports='+new URL(origin).port]});t.after(()=>browser.close())
 const page=await browser.newPage({viewport:{width:1200,height:850}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(origin);await page.addScriptTag({content:await browserReactScript()})
 await page.addStyleTag({content:await readFile(new URL('tavern-plugin/lib/client-assets/fork-theme.css',root),'utf8')+await readFile(new URL('tavern-plugin/lib/client-assets/fork-phone.css',root),'utf8')+'body{margin:0}.fork-gal-stage{position:relative;width:100vw;height:100vh;background:#263b3e;--gal-ui-ink:#f4efdf;--gal-ui-surface:#314d51;--gal-ui-surface-2:#416166;--gal-ui-line:#a6b5a6;--gal-ui-accent:#eac994;--gal-ui-radius:8px;--gal-ui-font:Georgia;--gal-ui-focus:2px solid #edc88c}.fork-gal-topbar{height:48px;top:0!important;right:0!important;left:0!important}.fork-gal-box{position:absolute;bottom:0;left:24px;right:24px;height:110px;visibility:visible;color:white} .fork-widget-layer{position:absolute;inset:0}'})
 const files=['fork-widget-contracts.cjs','fork-widget-media.cjs','fork-widget-theme.cjs','fork-widget-theme.js','fork-widget-setting-images.js','fork-widget-sandbox.js','fork-gal-widgets.js','fork-widget-source.cjs','fork-widget-presentation.cjs','fork-widget-thread.cjs','fork-widget-source.js']
 const code=bubbleResolutionSource+'\n'+(await Promise.all(files.map(read))).join('\n'),stage=await read('fork-gal-stage.js'),typewriter=stage.slice(stage.indexOf('function ForkGalTypewriter('),stage.indexOf('function useForkGalFontsReady('))
 await page.addScriptTag({content:`const React=modules.react,FORK_WIDGET_SLOTS=['top-center','corner-left','corner-right','center-card'];const forkForeground={now:()=>performance.now(),setTimeout:(...a)=>setTimeout(...a),clearTimeout:id=>clearTimeout(id),setInterval:(...a)=>setInterval(...a),clearInterval:id=>clearInterval(id),requestAnimationFrame:fn=>requestAnimationFrame(fn),cancelAnimationFrame:id=>cancelAnimationFrame(id)};const forkStageAudio={bind:()=>{},release:()=>{}};const forkGalFigureSources=new WeakMap();function useForkGalFontsReady(){return true}const FORK_STAGE_READING_DEFAULTS={textSpeed:20};${code}\n${typewriter}
 const phone=${JSON.stringify(phone)},states=${JSON.stringify(states)};const context={state:null,refs:new Map()};const source={branchId:'branch',generation:1,sourceKey:'native',turn:1};
 window.windowReads=[];const rpc=async(_name,args)=>{windowReads.push(args);return {status:'ready',widgets:[{...phone,historyAvatars:{'1:2':{url:avatarData},'1:3':{url:avatarData}}}]}};const forkStageSessions={get:()=>({getSnapshot:()=>({source:window.activeSource})})};
 const config={characters:[{alias:'f_friend',aliases:['friend'],name:'Friend',ref:{packId:'fixture',figureId:'friend'}}]};
 const pages=[{para:1,kind:'narration',text:'Before the message.'},{para:2,kind:'line',alias:'friend',name:'Friend',mood:'开心',text:'Visible phone text, still revealing.'},{para:3,kind:'line',alias:'friend',name:'Friend',mood:'喜悦',text:'SECOND_MESSAGE'},{para:4,kind:'narration',text:'Ordinary prose again.'}];
 const record={phase:'done',through:4,token:{bindingKey:'binding',sourceKey:'story',generation:1},entries:[2,3].map(at=>({at,ops:[{op:'widget.source',ref:phone.ref,contact:'f_friend',side:'in'}]}))};
 const avatarCanvas=document.createElement('canvas');avatarCanvas.width=avatarCanvas.height=64;avatarCanvas.getContext('2d').fillRect(0,0,64,64);const avatarData=avatarCanvas.toDataURL();
 let api;window.pauseCount=0;window.typewriterMounts=0;window.voiceReplays=0;pages[1].voice={click:()=>voiceReplays++};window.audioRequests=[];window.addEventListener('message',e=>{if(e.data?.type==='audio.play')audioRequests.push(e.data)});function Reading(props){React.useEffect(()=>{typewriterMounts++},[]);return React.createElement(ForkGalTypewriter,props)}
 function App(){const [at,setAt]=React.useState(0),[enabled,setEnabled]=React.useState(true),[paused,setPaused]=React.useState(false),[done,setDone]=React.useState(false),[renew,setRenew]=React.useState(0),[mixed,setMixed]=React.useState(false),[turn,setTurn]=React.useState(1),[branch,setBranch]=React.useState('branch'),[withheld,setWithheld]=React.useState(true),rootRef=React.useRef(null);
 const activeSource=React.useMemo(()=>({...source,turn,branchId:branch}),[turn,branch]);window.activeSource=activeSource;const currentRecord=turn===1?{...record,entries:record.entries.filter(entry=>!withheld||entry.at!==2)}:{...record,entries:[],token:{...record.token,sourceKey:'next-story',turn}};
 const owner=useForkWidgetStage({context,config,sessionId:'test',source:activeSource,turn,pages,page:at,record:currentRecord,widgets:turn===1 && at>0?[{...phone,definition:{...phone.definition,url:phone.definition.url+(renew?'?renew='+renew:'')}},...(mixed?[...states.slice(0,3),{...states[3],performance:true},{...states[0],performance:true}]:[])]:turn===2?[phone]:[],rootRef,avatarOf:(alias,mood)=>{if(alias!=='f_friend'||mood!=='joy')throw Error('Unresolved avatar identity or mood');return turn===1?({src:avatarData}):null},film:mixed,enabled,paused,mode:'live',revealed:done,reducedMotion:false,onPause:()=>pauseCount++,readHistory:async()=>({rows:turn===1?[]:[{turn:1,sourceKey:'story',pages,record}],limited:false,unavailable:false})});
 React.useLayoutEffect(()=>{forkGalFigureSources.set(rootRef.current,()=>mixed?[{body:{x:450,y:180,width:270,height:620},head:{x:500,y:80,width:170,height:170}}]:[])},[mixed]);
 api=owner;window.harness={owner,go:n=>{setDone(false);setAt(n)},setEnabled,setPaused,setRenew,setMixed,setTurn,setBranch,setWithheld};
 return React.createElement('main',{ref:rootRef,className:'fork-gal-stage'+(mixed?' is-film':'')},mixed?React.createElement('div',{className:'figure-fixture','aria-hidden':true,style:{position:'absolute',left:450,top:180,width:270,height:620,background:'linear-gradient(#65817a,#445d59)',borderRadius:'45% 45% 12% 12%',pointerEvents:'none'}},React.createElement('i',{style:{position:'absolute',left:50,top:-100,width:170,height:170,borderRadius:'50%',background:'#829b89'}})):null,mixed?React.createElement('div',{className:'fork-gal-letterbox'},...['top','bottom'].map(edge=>React.createElement('i',{key:edge,style:{position:'absolute',[edge]:0,left:0,right:0,height:56,background:'#111',pointerEvents:'none'}}))):null,React.createElement('div',{className:'fork-gal-topbar'},React.createElement(ForkWidgetMenu,{owner})),React.createElement(ForkGalWidgets,{owner,onBacklog:()=>{}}),React.createElement('div',{className:'fork-gal-box'+(owner.claim?' is-source-widget-line':''),'data-claim':owner.claim},React.createElement(Reading,{key:at,text:pages[at].text,speed:45,instant:false,visibleKey:owner.readingKey,onVisible:owner.onVisible,onDone:()=>setDone(true)})));}
 modules['react-dom/client'].createRoot(document.getElementById('root')).render(React.createElement(App));`})
 await page.waitForFunction(()=>!!window.harness);await page.evaluate(()=>harness.go(1));await page.waitForTimeout(120);assert.equal(await page.evaluate(()=>harness.owner.items.length),0);await page.evaluate(()=>harness.setWithheld(false));await page.waitForSelector('iframe',{timeout:6000}).catch(async error=>{throw new Error(error.message+' errors='+JSON.stringify(errors)+' state='+await page.evaluate(()=>JSON.stringify(harness.owner.items.map(i=>({p:i.presentation,b:i.bounds,failed:i.failed}))))+' DOM='+await page.locator('#root').innerHTML())})
 // private fork: compact is the phone's own Dynamic-Island strip (latest accepted line), not a shrunken thread.
 const frame=page.frameLocator('iframe');await frame.locator('#island-preview').filter({hasText:'Visible'}).waitFor();await frame.locator('#messages article').waitFor({state:'attached'});assert.equal(await page.locator('.fork-widget-panel').getAttribute('data-presentation'),'compact')
 // private fork: navigation preceded the streamed mark; badge and audio share the same acceptance.
 assert.equal(await page.evaluate(()=>harness.owner.items[0].presentation.attention.count),1);assert.equal(await page.evaluate(()=>harness.owner.items[0].playback.fresh),true);await page.waitForFunction(()=>audioRequests.length===1);
 assert.equal(await page.locator('.fork-gal-box').getAttribute('data-claim'),'false');assert.equal(await frame.locator('body').textContent().then(s=>s.includes('SECOND_MESSAGE')),false)
 await page.evaluate(()=>{window.frameBefore=document.querySelector('iframe');window.winBefore=frameBefore.contentWindow;window.readingBefore=document.querySelector('.fork-gal-type');window.mountBefore=typewriterMounts;harness.owner.action(harness.owner.items[0].key,'open')})
 await page.waitForFunction(()=>document.querySelector('.fork-gal-box').dataset.claim==='true')
 assert.equal(await page.evaluate(()=>document.querySelector('.fork-gal-type')===readingBefore&&typewriterMounts===mountBefore),true)
 await frame.locator('#messages p').filter({hasText:'still revealing.'}).waitFor();assert.equal(await frame.locator('#clock').textContent(),'09:41');await frame.locator('article img:not([hidden])').waitFor();assert.equal(await page.evaluate(()=>Object.keys(harness.owner.items[0].source.avatars).length),1);await frame.getByRole('button',{name:'重播语音'}).click();await page.waitForFunction(()=>voiceReplays===1)
 const out=new URL('output/widget-settings/browser/',root);await mkdir(out,{recursive:true})
 await page.waitForTimeout(220);await page.screenshot({path:new URL('lifecycle-desktop-open.png',out).pathname.replace(/^\/(\w:)/,'$1')})
 await frame.getByRole('button',{name:'收起',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.fork-widget-panel').dataset.presentation==='compact')
 await page.waitForTimeout(220);await page.screenshot({path:new URL('lifecycle-desktop-compact.png',out).pathname.replace(/^\/(\w:)/,'$1')})
 const audioBefore=await page.evaluate(()=>audioRequests.length)
 await page.evaluate(()=>harness.owner.action(harness.owner.items[0].key,'hide'));await page.evaluate(()=>harness.go(2));await page.waitForTimeout(200)
 assert.equal(await page.locator('.fork-widget-panel').getAttribute('data-presentation'),'hidden');assert.equal(await page.locator('.fork-gal-box').getAttribute('data-claim'),'false')
 await page.waitForTimeout(220);await page.screenshot({path:new URL('lifecycle-desktop-hidden.png',out).pathname.replace(/^\/(\w:)/,'$1')})
 await page.evaluate(()=>{harness.owner.action(harness.owner.items[0].key,'open');harness.setRenew(1)})
 await page.waitForFunction(()=>document.querySelector('.fork-gal-box').dataset.claim==='true');assert.equal(await page.evaluate(()=>document.querySelector('iframe')===frameBefore&&frameBefore.contentWindow===winBefore),true)
 assert.equal(await page.evaluate(()=>audioRequests.length),audioBefore,'opening a hidden update never replays its notification sound')
 await page.evaluate(()=>harness.setPaused(true));await page.waitForFunction(()=>document.querySelector('.fork-gal-box').dataset.claim==='false');await page.evaluate(()=>harness.setPaused(false))
 for(const [width,height] of [[375,740],[320,568],[640,320]]){
  await page.setViewportSize({width,height});await page.waitForTimeout(150);await page.evaluate(()=>harness.owner.action(harness.owner.items[0].key,'open'))
  // private fork: a portrait phone opens straight into the full-bleed sheet (the phone itself); landscape keeps the space notice.
  if(height>width)await page.waitForSelector('.is-sheet.is-fill');else{await page.getByRole('button',{name:'空间不足，打开阅读面板'}).click();await page.waitForSelector('.is-sheet')}
  assert.equal(await page.evaluate(()=>document.querySelector('iframe')===frameBefore),true)
  await page.waitForTimeout(220);await page.screenshot({path:new URL('lifecycle-sheet-'+width+'x'+height+'.png',out).pathname.replace(/^\/(\w:)/,'$1')})
  if(width===375){
   await page.evaluate(()=>{for(const [key,value] of Object.entries({width:320,height:300,offsetLeft:20,offsetTop:24}))Object.defineProperty(visualViewport,key,{configurable:true,value});visualViewport.dispatchEvent(new Event('resize'))});await page.waitForFunction(()=>harness.owner.viewport.height===300)
   const visible=await page.locator('.is-sheet.fork-widget-panel').boundingBox();assert.ok(visible.x>=20 && visible.y>=24 && visible.x+visible.width<=340 && visible.y+visible.height<=324,'sheet respects zoom/keyboard visual viewport without shrinking its text')
   await page.evaluate(()=>{for(const key of ['width','height','offsetLeft','offsetTop'])delete visualViewport[key];visualViewport.dispatchEvent(new Event('resize'))})
  }
  await frame.getByRole('button',{name:'收起',exact:true}).press('Escape');await page.waitForFunction(()=>harness.owner.items[0].requestedState==='compact');await page.waitForFunction(()=>!!document.activeElement.closest('.fork-widget-panel,.fork-widget-menu'))
 }
 await page.emulateMedia({reducedMotion:'reduce'});await page.evaluate(()=>harness.owner.action(harness.owner.items[0].key,'open'));await page.waitForFunction(()=>harness.owner.items[0].presentation.reducedMotion===true,{},{timeout:5000}).catch(async()=>{throw new Error(JSON.stringify({errors,state:await page.evaluate(()=>({query:matchMedia('(prefers-reduced-motion: reduce)').matches,p:harness.owner.items[0].presentation}))}))})
 await page.setViewportSize({width:1440,height:1000});await page.evaluate(()=>harness.setMixed(true));await page.waitForFunction(()=>harness.owner.items.length===5)
 await page.evaluate(()=>{const p=harness.owner.items.find(i=>i.sourceOnly);harness.owner.action(p.key,'open');harness.owner.action(p.key,'pin');const letter=harness.owner.items.find(i=>!i.sourceOnly);harness.owner.action(letter.key,'open')})
 await page.waitForFunction(()=>harness.owner.items.filter(i=>i.requestedState==='open').length===1 && harness.owner.items.find(i=>i.sourceOnly).presentation.pinned===false)
 assert.equal(await page.locator('iframe').count(),2,'source and state each have one execution instance; duplicate performance ref does not mount twice')
 await page.waitForTimeout(250)
 const boxes=await page.evaluate(()=>harness.owner.items.filter(i=>i.bounds && i.presentation.state!=='hidden').map(i=>({...i.bounds})))// private fork: chromeless windows reserve no caption band
 for(const box of boxes)assert.ok(box.y>=56 && box.y+box.height<=944,'real film bars remain protected')
 for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++)assert.ok(boxes[i].x+boxes[i].width<=boxes[j].x || boxes[j].x+boxes[j].width<=boxes[i].x || boxes[i].y+boxes[i].height<=boxes[j].y || boxes[j].y+boxes[j].height<=boxes[i].y)
 for(const box of boxes)for(const obstacle of [{x:450,y:180,width:270,height:620},{x:500,y:80,width:170,height:170}])assert.ok(box.x+box.width<=obstacle.x || obstacle.x+obstacle.width<=box.x || box.y+box.height<=obstacle.y || obstacle.y+obstacle.height<=box.y,'panels never cover the figure or head')
 await page.waitForFunction(()=>harness.owner.items.some(i=>!i.sourceOnly && i.presentation.state==='open' && i.isReady));await page.waitForTimeout(220)
 await page.waitForTimeout(220);await page.screenshot({path:new URL('lifecycle-mixed.png',out).pathname.replace(/^\/(\w:)/,'$1')})
 assert.equal(await page.evaluate(()=>harness.owner.items.filter(i=>i.presentation.state==='compact').length),3)
 await page.evaluate(()=>harness.owner.action(harness.owner.items.find(i=>i.performance).key,'open'));await page.waitForFunction(()=>harness.owner.items.find(i=>i.performance).isReady)
 assert.equal(await page.locator('iframe').count(),3);assert.equal(await page.evaluate(()=>harness.owner.items.find(i=>i.performance).presentation.attention.changed),false);assert.equal(await page.evaluate(()=>document.querySelector('iframe[title="手机"]')===frameBefore),true)
 await page.evaluate(()=>document.querySelector('.fork-gal-stage').style.cssText='background:#eef2e8;--gal-ui-ink:#213a37;--gal-ui-surface:#f7f6ec;--gal-ui-surface-2:#d8e2d7;--gal-ui-line:#6d8774');await page.evaluate(()=>harness.owner.action(harness.owner.items.find(i=>i.sourceOnly).key,'open'));await page.waitForFunction(()=>harness.owner.items.find(i=>i.sourceOnly).presentation.state==='open');await page.waitForTimeout(220);await page.screenshot({path:new URL('lifecycle-mixed-light.png',out).pathname.replace(/^\/(\w:)/,'$1')})
 await page.evaluate(()=>{harness.setMixed(false);harness.setTurn(2);harness.go(0)});await page.waitForFunction(()=>harness.owner.items.length===1 && !harness.owner.items[0].checking)
 await page.evaluate(()=>harness.owner.action(harness.owner.items[0].key,'open'));await page.waitForFunction(()=>harness.owner.items[0].source?.messages.length===2)
 assert.equal(await page.evaluate(()=>harness.owner.claim),false,'historical conversation cannot claim an unmarked current turn, even with a carried source DTO');// private fork: history decorates from the read-only window grant, even without today's avatar.
 await page.waitForFunction(()=>Object.keys(harness.owner.items[0].source.avatars).length===1);assert.ok(await page.evaluate(()=>harness.owner.items[0].source.messages.every(row=>row.avatar)));assert.ok((await page.evaluate(()=>windowReads)).some(args=>args.turn===2 && args.widgetWindow.ref.assetId==='phone'));assert.equal(await page.evaluate(()=>document.querySelector('iframe')===frameBefore),true)
 await page.evaluate(()=>{harness.setTurn(1);harness.go(1)});await page.waitForFunction(()=>harness.owner.items.length===1);await page.evaluate(()=>harness.owner.action(harness.owner.items[0].key,'open'));await page.waitForFunction(()=>harness.owner.claim,{},{timeout:5000}).catch(async()=>{throw new Error(JSON.stringify(await page.evaluate(()=>({items:harness.owner.items.map(i=>({source:i.source,ready:i.isReady,failed:i.failed,p:i.presentation})),html:document.body.innerHTML,errors:forkWidgetRuntime}))))})
 await page.locator('iframe').evaluate(frame=>{frame.src=frame.src+'&second-navigation=1'});await page.waitForFunction(()=>!harness.owner.claim && !document.querySelector('iframe'))
 await page.evaluate(()=>harness.setBranch('branch-replaced'));await page.waitForFunction(()=>document.querySelector('iframe') && document.querySelector('iframe')!==frameBefore && harness.owner.claim)
 // private fork: resuming the same visited page does not make a late mark fresh.
 await page.evaluate(()=>{harness.setBranch('resume-control');harness.setWithheld(true);harness.go(0)});await page.waitForTimeout(80)
 await page.evaluate(()=>{harness.setPaused(true);harness.go(1)});await page.waitForTimeout(80)
 await page.evaluate(()=>harness.setPaused(false));await page.waitForTimeout(80)
 const resumeAudio=await page.evaluate(()=>audioRequests.length)
 await page.evaluate(()=>harness.setWithheld(false));await page.waitForFunction(()=>harness.owner.items.length===1 && harness.owner.items[0].isReady)
 assert.equal(await page.evaluate(()=>harness.owner.items[0].presentation.attention.count),0);assert.equal(await page.evaluate(()=>harness.owner.items[0].playback.fresh),false)
 await page.waitForTimeout(120);assert.equal(await page.evaluate(()=>audioRequests.length),resumeAudio)
 // The session owner clears presentation state on close before React finishes unmounting.
 await page.evaluate(()=>{context.state=null;harness.setRenew(2)});await page.waitForTimeout(150)
 assert.equal(await page.locator('iframe').count(),1,'an owner reset rebuilds the unchanged widget input without crashing')
 assert.equal(await page.evaluate(()=>harness.owner.items[0].presentation.attention.count),0,'reset does not replay a consumed notification')
 await page.evaluate(()=>harness.setEnabled(false));await page.waitForFunction(()=>!document.querySelector('iframe'));assert.deepEqual(errors,[])
})
