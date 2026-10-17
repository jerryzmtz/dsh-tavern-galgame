import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {chromium} from 'playwright'
import {browserReactScript} from './fixtures/browser-react.mjs'
import {widgetServer} from './fixtures/widget-harness.mjs'
import {bubbleResolutionSource} from './helpers/bubble-resolution-source.mjs'
import {createFirstPartyMods} from '../tavern-plugin/lib/fork-mod-builtins.js'
import {phoneViewDocument,phonePresentation} from '../tavern-plugin/lib/domain/mods/phone-presentation.js'
const root=new URL('../',import.meta.url)

test('opaque phone sandbox mounts once without authenticated API requests and never reads future or legacy messages',async t=>{
  const builtin=await createFirstPartyMods(),manifest=builtin.manifest('dsh.phone')
  const device={modId:'dsh.phone',packId:'7a71f7c4-e47f-46c7-a710-275e5c0f0579',kind:'device',entryId:'phone'}
  const item=phonePresentation({view:{device,wallpapers:[]},settings:Object.fromEntries(manifest.settingsSchema.fields.map(row=>[row.key,row.default])),document:phoneViewDocument(builtin.files('dsh.phone')),version:manifest.version})
  const origin=await widgetServer(t,{connect(){},async serve(req,res){if(!req.url.startsWith('/api/'))return false;res.writeHead(403);res.end('cross-site API denied');return true}}, (_req,res)=>{res.end('<!doctype html><html lang="zh-CN"><div id="root"></div>');return true})
  const browser=await chromium.launch({headless:true,args:['--mute-audio','--explicitly-allowed-ports='+new URL(origin).port]})
  t.after(()=>browser.close())
  const page=await browser.newPage({viewport:{width:1300,height:900}}),errors=[],apiRequests=[]
  page.on('pageerror',error=>errors.push(error.message))
  page.on('request',request=>{if(new URL(request.url()).pathname.startsWith('/api/'))apiRequests.push(request.url())})
  await page.goto(origin)
  await page.addScriptTag({content:await browserReactScript()})
  await page.addStyleTag({content:await readFile(new URL('tavern-plugin/lib/client-assets/fork-theme.css',root),'utf8')+'body{margin:0}.fork-gal-stage{position:relative;width:100vw;height:100vh}.fork-gal-box{position:absolute;bottom:0;left:0;width:100%;height:60px}.fork-widget-layer{position:absolute;inset:0}'})
  const files=['fork-inline-field.js','fork-spinner.js','fork-widget-contracts.cjs','fork-widget-media.cjs','fork-widget-theme.cjs','fork-widget-theme.js','fork-widget-setting-images.js','fork-widget-sandbox.js','fork-gal-widgets.js','fork-widget-source.cjs','fork-widget-presentation.cjs','fork-widget-thread.cjs','fork-phone-beat.cjs','fork-widget-source.js']
  const code=bubbleResolutionSource+'\n'+(await Promise.all(files.map(file=>readFile(new URL('tavern-plugin/src/client/'+file,root),'utf8')))).join('\n')
  await page.addScriptTag({content:`const React=modules.react,ReactDOM=modules['react-dom'];${code}
    const forkForeground={setInterval:(...args)=>setInterval(...args),clearInterval:id=>clearInterval(id)},forkStageAudio={bind(){},release(){}},forkGalFigureSources=new WeakMap();
    const context={state:null,refs:new Map()},item=${JSON.stringify(item)},token={bindingKey:'bound',sourceKey:'source',generation:1};
    const pages=[{para:1,kind:'line',alias:'Canonical',name:'Contact',text:'Current source text'},{para:2,kind:'line',alias:'Canonical',text:'Future source text'},{para:3,kind:'line',alias:'Player',name:'Me',text:'Sent by me'}];
    const record={phase:'done',through:2,token,entries:[{at:1,ops:[{op:'widget.source',ref:{packId:'legacy',kind:'widgets',assetId:'phone'},contact:'Wrong',side:'in'},{op:'mod.command',modId:'dsh.phone',commandId:'mark',params:{contact:'Canonical',side:'in'}}]},{at:2,ops:[{op:'mod.command',modId:'dsh.phone',commandId:'mark',params:{contact:'Canonical',side:'in'}}]}]};
    window.messages=[];window.addEventListener('message',event=>messages.push(event.data));
    record.through=3;record.entries.push({at:3,ops:[{op:'mod.command',modId:'dsh.phone',commandId:'mark',params:{contact:'Canonical',side:'out',form:'text'}}]});
    function App(){const rootRef=React.useRef(null),[index,setIndex]=React.useState(0),[text,setText]=React.useState('Current'),[enabled,setEnabled]=React.useState(true),[projection,setProjection]=React.useState(item);
      useForkWidgetTheme(rootRef,null,null);
      const owner=useForkWidgetStage({sessionId:'phone-test',source:{branchId:'branch',generation:1},turn:1,pages,page:index,record,widgets:[projection],rootRef,context,enabled,mode:'live',revealed:false,reducedMotion:true,readHistory:async()=>({rows:[]}),wallpaperRpc:async args=>{window.selectionRequest=args;return {status:'ready',widgets:[window.selectedProjection]};}});
      React.useLayoutEffect(()=>owner.onVisible(text),[owner.readingKey,text]);
      window.harness={owner,setText,setEnabled,setProjection,setIndex};
      return React.createElement('main',{ref:rootRef,className:'fork-gal-stage'},React.createElement(ForkGalWidgets,{owner}),React.createElement('div',{className:'fork-gal-box'},'Original reading controls'));
    }modules['react-dom/client'].createRoot(document.getElementById('root')).render(React.createElement(App));`})
  await page.waitForFunction(()=>window.harness?.owner.items.length===1 && harness.owner.items[0].bounds)
  const banner=await page.evaluate(()=>harness.owner.items[0].bounds)
  assert.equal(banner.x+banner.width/2,650,'Heads-up is centred in the stage, not beside a figure')
  // private fork (owner 2026-10): a real phone banner, as wide as the phone's screen at this stage size (900 px tall:
  // 0.85 x the 280-wide phone, less its bezel), at the top centre; no longer the 320-wide strip.
  assert.ok(Math.abs(banner.width-(238-15*.85))<.5 && Math.abs(banner.y-8.5)<.01,JSON.stringify(banner))
  await page.evaluate(()=>harness.owner.action(harness.owner.items[0].key,'open'))
  await page.waitForFunction(()=>harness.owner.items[0].presentation.state==='open')
  const open=await page.evaluate(()=>harness.owner.items[0].bounds)
  // private fork (owner 2026-10): the open phone is centred and fits above the dialogue box (top 840 here).
  assert.ok(Math.abs(open.x+open.width/2-650)<.01 && open.y+open.height<=828.01 && Math.abs(open.width-238)<.5,JSON.stringify(open))
  assert.equal(await page.evaluate(()=>harness.owner.phoneOpen),true)
  const phone=page.frameLocator('iframe[title="手机"]')
  await phone.locator('#messages p').filter({hasText:'Current'}).waitFor()
  await page.waitForFunction(()=>harness.owner.items[0].isReady)
  assert.equal(await page.locator('iframe').count(),1)
  assert.equal(await page.locator('iframe').getAttribute('sandbox'),'allow-scripts')
  assert.equal(await phone.locator('html').evaluate(()=>self.origin),'null')
  assert.deepEqual(await phone.locator('html').evaluate(()=>[...document.querySelectorAll('script[src],link[href]')].map(node=>node.src || node.href)),[])
  assert.deepEqual(apiRequests,[],'Opaque phone sandbox must not request authenticated API routes')
  assert.equal(await phone.locator('#messages').innerText(),'Current')
  assert.equal(await phone.locator('#clock').innerText(),'09:41')
  assert.doesNotMatch(await phone.locator('body').innerText(),/Future|Wrong/)
  assert.equal(await phone.locator('#phone').evaluate(node=>getComputedStyle(node).backgroundImage),'none')
  await page.evaluate(()=>harness.setText('Current source'))
  await phone.locator('#messages p').filter({hasText:'Current source'}).waitFor()
  assert.equal(await page.evaluate(()=>messages.filter(row=>row.type==='ready').length),1)
  assert.equal(await page.getByRole('button',{name:/换壁纸/}).count(),0,'Empty turn choices hide the picker')
  const wallpaper={kind:'image',identity:'selected-wallpaper',url:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWf0AAAAASUVORK5CYII='}
  const choice={id:JSON.stringify(['dsh.phone',device.packId,'wallpaper','blue']),ref:{...device,kind:'wallpaper',entryId:'blue'},name:'蓝色纸张',image:'media/blue.png'}
  const eligible={...item,wallpaperChoices:[choice]}
  await page.evaluate(value=>harness.setProjection(value),eligible)
  await page.evaluate(value=>{window.selectedProjection=value},{...eligible,wallpaperSelection:choice.id,definition:{...item.definition,inlineSettingAssets:{wallpaper}}})
  await page.getByRole('button',{name:'换壁纸：纯底色',exact:true}).click()
  if(process.env.MOD_PHONE_EVIDENCE)await page.screenshot({path:process.env.MOD_PHONE_EVIDENCE+'-desktop-picker.png'})
  await page.getByRole('menuitemradio',{name:'蓝色纸张',exact:true}).click()
  await page.waitForFunction(()=>window.selectionRequest?.choice)
  assert.deepEqual(await page.evaluate(()=>selectionRequest),{sessionId:'phone-test',turn:1,at:1,expectedDirectionToken:{bindingKey:'bound',sourceKey:'source',generation:1},choice:choice.id})
  await phone.locator('body[data-wallpaper="image"]').waitFor()
  assert.equal(await phone.locator('#phone').evaluate(node=>getComputedStyle(node).backgroundImage),'url("'+wallpaper.url+'")')
  assert.equal(await phone.locator('body').evaluate(async()=>{const image=new Image();image.src=document.getElementById('phone').style.backgroundImage.slice(5,-2);await image.decode();return image.naturalWidth}),1)
  assert.equal(await page.evaluate(()=>messages.filter(row=>row.type==='ready').length),1,'Parent-delivered wallpaper updates do not remount the phone')
  if(process.env.MOD_PHONE_EVIDENCE)await page.screenshot({path:process.env.MOD_PHONE_EVIDENCE+'-desktop.png'})
  await page.setViewportSize({width:375,height:812})
  await page.getByRole('button',{name:'换壁纸：蓝色纸张',exact:true}).click()
  await page.getByRole('menuitemradio',{name:'蓝色纸张',exact:true}).waitFor()
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
  if(process.env.MOD_PHONE_EVIDENCE)await page.screenshot({path:process.env.MOD_PHONE_EVIDENCE+'-375-picker.png'})
  await page.keyboard.press('Escape')
  if(process.env.MOD_PHONE_EVIDENCE)await page.screenshot({path:process.env.MOD_PHONE_EVIDENCE+'-375.png'})
  await page.evaluate(()=>harness.owner.action(harness.owner.items[0].key,'collapse'))
  await page.waitForFunction(()=>harness.owner.items[0].presentation.state==='hidden',{},{timeout:7000})
  // private fork (owner 2026-10): the dialogue box no longer hides for a phone line; the stage shows its held line instead.
  assert.equal(await page.evaluate(()=>harness.owner.claim),false,'A phone line never hides the dialogue box')
  assert.equal(await page.evaluate(()=>harness.owner.phoneLine),true,'The line itself still belongs to the phone')
  await page.evaluate(()=>{harness.setText('Sent by me');harness.setIndex(2)})
  await page.waitForFunction(()=>harness.owner.items[0].presentation.state==='open')
  await phone.getByText('Sent by me',{exact:true}).waitFor()
  assert.equal(await phone.locator('#island').isVisible(),false,'Outgoing beat opens the conversation, never an incoming notification')
  assert.equal(await page.evaluate(()=>harness.owner.phoneLine && !harness.owner.claim),true,'Outgoing line belongs to the phone; the box stays up (private fork, owner 2026-10)')
  await page.evaluate(()=>harness.setEnabled(false))
  await page.waitForFunction(()=>!document.querySelector('iframe'))
  assert.deepEqual(errors,[])
  assert.deepEqual(apiRequests,[],'Streaming and teardown also make no direct authenticated API requests')
})


// Offline transport/audio ports; browser input and the phone owner/sandbox are production code.
test('real phone clicks keep text and two independent voice transcripts separate without consuming controls',async t=>{
  const builtin=await createFirstPartyMods(),manifest=builtin.manifest('dsh.phone');
  const device={modId:'dsh.phone',packId:'7a71f7c4-e47f-46c7-a710-275e5c0f0579',kind:'device',entryId:'phone'};
  const item=phonePresentation({view:{device,wallpapers:[]},settings:Object.fromEntries(manifest.settingsSchema.fields.map(row=>[row.key,row.default])),document:phoneViewDocument(builtin.files('dsh.phone')),version:manifest.version});
  const origin=await widgetServer(t,{connect(){},serve(){return false}},(_req,res)=>{res.end('<!doctype html><html lang="zh-CN"><div id="root"></div>');return true});
  const browser=await chromium.launch({headless:true,args:['--mute-audio','--explicitly-allowed-ports='+new URL(origin).port]});t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:1300,height:900}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(origin);await page.addScriptTag({content:await browserReactScript()});
  await page.addStyleTag({content:await readFile(new URL('tavern-plugin/lib/client-assets/fork-theme.css',root),'utf8')+'body{margin:0}.fork-gal-stage{position:relative;width:100vw;height:100vh}.fork-gal-box{position:absolute;bottom:0;left:0;width:100%;height:60px}.fork-widget-layer{position:absolute;inset:0}#previous{position:fixed;bottom:0;left:0;z-index:99}'});
  const files=['fork-inline-field.js','fork-spinner.js','fork-widget-contracts.cjs','fork-widget-media.cjs','fork-widget-theme.cjs','fork-widget-theme.js','fork-widget-setting-images.js','fork-widget-sandbox.js','fork-gal-widgets.js','fork-widget-source.cjs','fork-widget-presentation.cjs','fork-widget-thread.cjs','fork-phone-beat.cjs','fork-widget-source.js'];
  const code=bubbleResolutionSource+'\n'+(await Promise.all(files.map(file=>readFile(new URL('tavern-plugin/src/client/'+file,root),'utf8')))).join('\n');
  await page.addScriptTag({content:'const React=modules.react,ReactDOM=modules["react-dom"];'+code+'\nconst item='+JSON.stringify(item)+';'+
    'const forkForeground={setInterval:(...args)=>setInterval(...args),clearInterval:id=>clearInterval(id)},forkStageAudio={bind(){},release(){}},forkGalFigureSources=new WeakMap();'+
    'const context={state:null,refs:new Map()},token={bindingKey:"bound",sourceKey:"forms",generation:1};window.played=[];window.wheels=[];window.advances=0;'+
    'const pages=[{para:1,kind:"line",alias:"Canonical",name:"Contact",text:"Plain text"},{para:2,kind:"line",alias:"Canonical",name:"Contact",text:"First voice transcript",voice:{click:()=>played.push(2)}},{para:3,kind:"line",alias:"Canonical",name:"Contact",text:"Second voice transcript",voice:{click:()=>played.push(3)}},{para:4,kind:"narration",text:"Ordinary narration"}];'+
    'const record={phase:"done",through:4,token,entries:[1,2,3].map(at=>({at,ops:[{op:"mod.command",modId:"dsh.phone",commandId:"mark",params:{contact:"Canonical",side:"in",form:at===1?"text":"voice"}}]}))};'+
    'function App(){const rootRef=React.useRef(null),[index,setIndex]=React.useState(0);useForkWidgetTheme(rootRef,null,null);'+
    'const owner=useForkWidgetStage({sessionId:"forms",source:{branchId:"branch",generation:1},turn:2,pages,page:index,record,widgets:[item],rootRef,context,enabled:true,mode:"live",revealed:true,reducedMotion:true,historyVoice:line=>({click:()=>played.push("history-"+line.para)}),readHistory:async()=>({rows:window.historyEnabled?[{turn:1,sourceKey:"earlier",record:{...record,token:{...token,sourceKey:"earlier"},through:1,entries:[{at:1,ops:[{op:"mod.command",modId:"dsh.phone",commandId:"mark",params:{contact:"Canonical",side:"in",form:"voice"}}]}]},pages:[{para:1,kind:"line",alias:"Canonical",name:"Contact",text:"Earlier voice transcript",voice:{text:"Earlier voice transcript"}}]}]:[]})});'+
    'React.useLayoutEffect(()=>owner.onVisible(pages[index].text),[owner.readingKey]);window.formProbe={owner,index};'+
    'return React.createElement("main",{ref:rootRef,className:"fork-gal-stage","data-page":index},React.createElement(ForkGalWidgets,{owner,onAdvance:()=>{advances++;setIndex(i=>Math.min(3,i+1))},onWheel:event=>wheels.push([event.deltaY,event.deltaMode])}),React.createElement("div",{className:"fork-gal-box",hidden:owner.claim},pages[index].text),React.createElement("button",{id:"previous",onClick:()=>setIndex(i=>Math.max(0,i-1))},"Previous"));}modules["react-dom/client"].createRoot(document.getElementById("root")).render(React.createElement(App));'});
  await page.waitForFunction(()=>window.formProbe?.owner.items[0]?.isReady);
  const phone=page.frameLocator('iframe[title="手机"]');
  // private fork (owner 2026-10): the dialogue box stays up through phone beats (the stage holds the last outside line).
  assert.equal(await page.locator('.fork-gal-box').isVisible(),true,'A phone beat keeps the dialogue box')
  assert.equal(await page.evaluate(()=>formProbe.owner.phoneBeat),true)
  await page.locator('.fork-widget-grip.is-cover').click();await phone.locator('#messages p').filter({hasText:'Plain text'}).waitFor();
  assert.equal(await phone.locator('.voice:visible').count(),0,'Text has no phone play control');
  await phone.locator('#messages p').filter({hasText:'Plain text'}).click();
  await page.waitForFunction(()=>formProbe.index===1 && formProbe.owner.items[0].source.messages.at(-1).voice);
  const voices=phone.locator('article[data-form="voice"]');
  await voices.nth(0).locator('.voice').click();await page.waitForFunction(()=>played.length===1);assert.deepEqual(await page.evaluate(()=>played),[2]);
  assert.equal(await page.evaluate(()=>formProbe.index),1);
  assert.equal(await voices.nth(0).locator('p').getAttribute('aria-hidden'),'true');
  await voices.nth(0).locator('.transcript-toggle').click();
  await voices.nth(0).locator('p.is-expanded').waitFor();
  assert.equal(await page.evaluate(()=>formProbe.index),1,'Transcript and voice controls never advance');
  await phone.locator('#clock').click();await page.waitForFunction(()=>formProbe.index===2);
  await voices.nth(1).locator('.voice').click();await page.waitForFunction(()=>played.length===2);assert.deepEqual(await page.evaluate(()=>played),[2,3]);
  assert.equal(await voices.nth(0).locator('.transcript-toggle').getAttribute('aria-expanded'),'true');
  assert.equal(await voices.nth(1).locator('.transcript-toggle').getAttribute('aria-expanded'),'false');
  await voices.nth(1).locator('.transcript-toggle').click();await voices.nth(1).locator('p.is-expanded').waitFor();
  assert.equal(await phone.locator('#messages article').count(),3,'Consecutive messages append');
  await page.locator('#previous').click();await page.waitForFunction(()=>formProbe.index===1);
  await phone.locator('#clock').click();await page.waitForFunction(()=>formProbe.index===2);
  assert.equal(await voices.nth(1).locator('.transcript-toggle').getAttribute('aria-expanded'),'true','Per-message reveal survives replay');
  await voices.nth(0).locator('.transcript-toggle').click();
  await page.waitForFunction(()=>!formProbe.owner.items[0].source.messages[1].transcript);
  await voices.nth(0).locator('p').waitFor({state:'hidden'});
  assert.equal(await voices.nth(1).locator('.transcript-toggle').getAttribute('aria-expanded'),'true');
  if(process.env.MOD_PHONE_EVIDENCE)await page.screenshot({path:process.env.MOD_PHONE_EVIDENCE+'-voice-offline.png'});
  await phone.locator('#clock').hover();await page.mouse.wheel(0,180);await page.waitForFunction(()=>wheels.length===1);
  assert.deepEqual(await page.evaluate(()=>wheels[0]),[180,0],'Wheel reaches the stage gesture owner');
  await page.locator('#previous').click();await page.waitForFunction(()=>formProbe.index===1);
  await phone.locator('#clock').click();await page.waitForFunction(()=>formProbe.index===2);
  await page.keyboard.press('Enter');await page.waitForFunction(()=>formProbe.index===3 && !formProbe.owner.claim && formProbe.owner.items[0].requestedState==='compact');
  assert.equal(await page.evaluate(()=>formProbe.owner.phoneOpen),false,'The phone is put away after the run\'s last phone line');
  assert.equal(await page.locator('.fork-gal-box').innerText(),'Ordinary narration');
  assert.equal(await page.locator('.fork-gal-box').isVisible(),true,'Ordinary narration returns after the phone beat');
  await page.locator('#previous').click();await page.locator('#previous').click();await page.waitForFunction(()=>formProbe.index===1);
  // private fork (owner 2026-10): returning into a run takes the phone out without a banner and without pausing AUTO.
  await page.waitForFunction(()=>formProbe.owner.items[0].presentation.state==='open');
  await phone.locator('#clock').click();await page.waitForFunction(()=>formProbe.index===2);
  await page.keyboard.press('Space');await page.waitForFunction(()=>formProbe.index===3);
  await page.locator('#previous').click();await page.waitForFunction(()=>formProbe.index===2);
  await page.waitForFunction(()=>formProbe.owner.items[0].presentation.state==='open');
  const advanced=await page.evaluate(()=>advances);
  await phone.locator('#toggle').click();await page.waitForFunction(()=>formProbe.owner.items[0].presentation.state==='compact');
  assert.equal(await page.evaluate(()=>advances),advanced,'Phone back arrow only collapses');
  await page.evaluate(()=>window.historyEnabled=true);
  await page.locator('.fork-widget-grip.is-cover').click();
  const earlier=phone.locator('article').filter({hasText:'Earlier voice transcript'});
  await earlier.locator('.voice').click();await page.waitForFunction(()=>played.length===3);
  assert.deepEqual(await page.evaluate(()=>played),[2,3,'history-1'],'Earlier-turn voice uses the history audio owner, not the current paragraph');
  await earlier.locator('.transcript-toggle').click();await earlier.locator('p.is-expanded').waitFor();
  assert.equal(await page.evaluate(()=>advances),advanced,'Historical playback and transcript controls do not advance');
  await page.setViewportSize({width:375,height:812});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.deepEqual(errors,[]);
});

test('heads-up shows only the current incoming sender, not the outgoing line or stale history',async t=>{
  const builtin=await createFirstPartyMods(),document=phoneViewDocument(builtin.files('dsh.phone'));
  const browser=await chromium.launch({headless:true,args:['--mute-audio']});t.after(()=>browser.close());
  const page=await browser.newPage();await page.setContent('<iframe title="phone" sandbox="allow-scripts"></iframe>');
  await page.locator('iframe').evaluate((node,html)=>node.srcdoc=html,document);
  const phone=page.frameLocator('iframe');await phone.locator('#island').waitFor({state:'attached'});
  const send=data=>page.evaluate(data=>document.querySelector('iframe').contentWindow.postMessage({channel:'dsh-widget',version:2,token:'test',...data},'*'),data);
  await send({type:'init',presentation:{state:'compact',suspended:false,attention:{count:0}},playback:{mode:'live'}});
  const incoming={id:'in',side:'in',name:'Actual Sender',alias:'sender-id',contact:'sender-id',text:'Hello',form:'text',revealed:true};
  const outgoing={id:'out',side:'out',name:'Player',alias:'player-id',contact:'sender-id',text:'Sent by me',form:'text',revealed:true};
  await send({type:'source',source:{threadKey:'test',messages:[incoming],current:{id:'in',revealed:true},avatars:{}}});
  await phone.locator('#island').waitFor({state:'visible'});
  assert.equal(await phone.locator('#island-name').innerText(),'Actual Sender');
  assert.equal(await phone.locator('#island-preview').innerText(),'Hello');
  for(const current of [{id:'out',revealed:true},null]){
    await send({type:'source',source:{threadKey:'test',messages:[incoming,outgoing],current,avatars:{}}});
    await phone.locator('#island').waitFor({state:'hidden'});
    assert.equal(await phone.locator('#island-preview').textContent(),'');
  }
});
