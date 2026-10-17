import {bubbleResolutionSource} from '../helpers/bubble-resolution-source.mjs' // private fork
// private fork: pack-only cards do not persist empty retired character tables.
// private fork: offline harness for the shipped phone widget inside the production widget host (useForkWidgetStage +
// ForkGalWidgets + opaque sandbox + the real reading typewriter). Synthetic pages and avatars only; no DSH, no network
// beyond the in-process server. Writes open / compact / history screenshots (dark, light, 375×740), the chromeless host
// interactions (resting, context menu, dragged, portrait full-bleed, long-press menu) and WebM recordings.
// Usage: node tests/harness/widgets-v3-phone.mjs [outDir] [--chromeless]   --chromeless: only the host interaction shots
// and the drag / right-click / long-press recordings. WIDGETS_PHONE_CSS=<file> appends a stylesheet (design variants).
import {readFile,mkdir,mkdtemp,rename,readdir} from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {chromium} from 'playwright'
import {browserReactScript} from '../fixtures/browser-react.mjs'
import {widgetServer} from '../fixtures/widget-harness.mjs'
import {writePhonePack,PHONE_PACK_ID} from '../fixtures/source-widget/fork-build-phone-widget.mjs'
import {createAssetPackService} from '../../tavern-plugin/packages/dsh-asset-library/src/pack-v2/service.js'
import {createAssetPackPresentation} from '../../tavern-plugin/lib/domain/asset-pack-presentation.js'
import {defaultAssetEngineSettings} from '../../tavern-plugin/lib/domain/asset-engine-settings.js'

const root=new URL('../../',import.meta.url),rootPath=fileURLToPath(root)
const cli=process.argv.slice(2),chromelessOnly=cli.includes('--chromeless'),outDir=cli.find(arg=>!arg.startsWith('--')) || path.join(rootPath,'.tmp/widgets-v3-phone')
const read=name=>readFile(new URL('tavern-plugin/src/client/'+name,root),'utf8')
const STAGES={
 dark:'background:radial-gradient(120% 90% at 70% 10%,#3b5357,#1b2729);--gal-ui-ink:#f2eddf;--gal-ui-ink-2:#c4c9bd;--gal-ui-surface:#26383b;--gal-ui-surface-2:#33494c;--gal-ui-line:#8fa39a;--gal-ui-accent:#e9c58f;--gal-ui-accent-ink:#2a1d0b;--gal-ui-radius:10px;--gal-ui-font:Georgia,"Noto Serif SC",serif;--gal-ui-title-font:Georgia,"Noto Serif SC",serif;--gal-ui-focus:2px solid #e9c58f;--gal-ui-shadow:0 8px 28px rgba(0,0,0,.35)',
 light:'background:radial-gradient(120% 90% at 70% 10%,#fbf3ea,#dfe6ef);--gal-ui-ink:#2a2d34;--gal-ui-ink-2:#555b66;--gal-ui-surface:#fbf8f2;--gal-ui-surface-2:#eee8dd;--gal-ui-line:#9a948a;--gal-ui-accent:#d0617a;--gal-ui-accent-ink:#ffffff;--gal-ui-radius:12px;--gal-ui-font:Georgia,"Noto Serif SC",serif;--gal-ui-title-font:Georgia,"Noto Serif SC",serif;--gal-ui-focus:2px solid #d0617a;--gal-ui-shadow:0 8px 28px rgba(60,40,30,.18)'}

export async function run() {
 await mkdir(outDir,{recursive:true})
 const work=await mkdtemp(path.join(rootPath,'.tmp/widgets-v3-phone-')),service=createAssetPackService({assetRoot:work+'/store',authorizeLease:async()=>true})
 const cleanup=[()=>service.dispose()],t={after:fn=>cleanup.push(fn)},shots=[],errors=[]
 try {
  await writePhonePack(work+'/phone.zip');const preview=await service.inspectImport({bytes:await readFile(work+'/phone.zip')});await service.applyImport({inspectionId:preview.inspectionId,expectedRevision:null,decision:'install',acceptScriptRisk:true})
  let origin
  origin=await widgetServer(t,{connect(value){origin=value},async serve(req,res){const url=new URL(req.url,origin),match=/^\/api\/dsh-asset-library\/v2\/lease\/([^/]+)\/(.+)$/.exec(url.pathname);if(!match)return false;const response=await service.respondLease({ticket:match[1],resource:decodeURIComponent(match[2]),request:new Request(url,{headers:req.headers})});res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));return true}},(_req,res)=>{res.setHeader('Content-Type','text/html');res.end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div>');return true})
  const presentation=createAssetPackPresentation({raw:{extensions:{dsh_tavern:{schemaVersion:1,assetBindings:{boundPackIds:[PHONE_PACK_ID]}}}},getService:()=>service,origin,scope:'harness'});cleanup.push(()=>presentation.dispose())
  const [phone]=await presentation.widgets({widgets:{}},{sourceRefs:[{packId:PHONE_PACK_ID,kind:'widgets',assetId:'phone'}],engine:defaultAssetEngineSettings(),isCurrent:()=>true})
  const files=['fork-widget-contracts.cjs','fork-widget-media.cjs','fork-widget-theme.cjs','fork-widget-theme.js','fork-widget-setting-images.js','fork-widget-sandbox.js','fork-gal-widgets.js','fork-widget-source.cjs','fork-widget-presentation.cjs','fork-widget-thread.cjs','fork-widget-source.js']
  const code=bubbleResolutionSource+'\n'+(await Promise.all(files.map(read))).join('\n'),stage=await read('fork-gal-stage.js'),typewriter=stage.slice(stage.indexOf('function ForkGalTypewriter('),stage.indexOf('function useForkGalFontsReady('))
  const css=await readFile(new URL('tavern-plugin/lib/client-assets/fork-theme.css',root),'utf8')+(process.env.WIDGETS_PHONE_CSS?'\n'+await readFile(process.env.WIDGETS_PHONE_CSS,'utf8'):'')
  const browser=await chromium.launch({headless:true,args:['--autoplay-policy=no-user-gesture-required','--explicitly-allowed-ports='+new URL(origin).port]});cleanup.push(()=>browser.close())
  const setup=async(page,scheme)=>{
   page.on('pageerror',e=>errors.push(scheme+': '+e.message));await page.goto(origin);await page.addScriptTag({content:await browserReactScript()})
   await page.addStyleTag({content:css+'body{margin:0;overflow:hidden}.fork-gal-stage{position:relative;width:100vw;height:100vh;'+STAGES[scheme]+'}.fork-gal-topbar{position:absolute;top:0;right:0;left:0;height:48px;display:flex;justify-content:flex-end;padding:2px 10px}.fork-gal-stage .harness-box{position:absolute!important;inset:auto 24px 14px 24px!important;width:auto!important;height:110px!important;transform:none!important;visibility:visible;padding:16px 22px;border-radius:14px;background:color-mix(in srgb,var(--gal-ui-surface) 88%,transparent);color:var(--gal-ui-ink);font:17px/1.7 var(--gal-ui-font);box-shadow:0 0 0 1px color-mix(in srgb,var(--gal-ui-line) 40%,transparent)}.harness-box b{display:block;font-size:14px;color:var(--gal-ui-accent)}.fork-widget-layer{position:absolute;inset:0}.figure{position:absolute;left:12%;bottom:0;width:300px;height:640px;pointer-events:none}'})
   await page.addScriptTag({content:`const React=modules.react,FORK_WIDGET_SLOTS=['top-center','corner-left','corner-right','center-card'];const forkForeground={now:()=>performance.now(),setTimeout:(...a)=>setTimeout(...a),clearTimeout:id=>clearTimeout(id),setInterval:(...a)=>setInterval(...a),clearInterval:id=>clearInterval(id),requestAnimationFrame:fn=>requestAnimationFrame(fn),cancelAnimationFrame:id=>cancelAnimationFrame(id)};const forkStageAudio={bind:()=>{},release:()=>{}};const forkGalFigureSources=new WeakMap();function useForkGalFontsReady(){return true}const FORK_STAGE_READING_DEFAULTS={textSpeed:20};${code}\n${typewriter}
 const phone=${JSON.stringify(phone)};const context={state:null,refs:new Map()};const source={branchId:'branch',generation:1,sourceKey:'native',turn:1};
 const rpc=async()=>({status:'ready',widgets:[phone]});const forkStageSessions={get:()=>({getSnapshot:()=>({source:window.activeSource})})};
 const P=(para,alias,name,text)=>({para,kind:alias?'line':'narration',alias,name,text});
 const turn1=[P(1,null,null,'放学的铃声响过，手机在口袋里震了一下。'),P(2,'mika','美香','下课了吗？'),P(3,'me','我','刚下课，怎么了？'),P(4,'mika','美香','我在天台等你，有件事想当面说。'),P(5,'me','我','马上到！'),P(6,null,null,'推开天台的门，风把她的头发吹乱了。')];
 const turn2=[P(1,null,null,'她把一封信塞到我手里，又低头看着手机。'),P(2,'mika','美香','🌸'),P(3,'mika','美香','……其实，刚才那封信是我写的。不许笑哦。'),P(4,null,null,'屏幕的光映在她发红的脸上。')];
 const mark=(at,side)=>({at,ops:[{op:'widget.source',ref:phone.ref,contact:'mika',side}]});
 const records={1:{phase:'done',through:6,token:{bindingKey:'binding',sourceKey:'story-1',generation:1},entries:[mark(2,'in'),mark(3,'out'),mark(4,'in'),mark(5,'out')]},2:{phase:'done',through:4,token:{bindingKey:'binding',sourceKey:'story-2',generation:1},entries:[mark(2,'in'),mark(3,'in')]}};
 const avatar=(()=>{const c=document.createElement('canvas');c.width=c.height=64;const g=c.getContext('2d');g.fillStyle='#6b3f4f';g.beginPath();g.ellipse(32,30,22,24,0,0,7);g.fill();g.fillStyle='#f6dccb';g.beginPath();g.ellipse(32,33,14,16,0,0,7);g.fill();g.fillStyle='#6b3f4f';g.beginPath();g.ellipse(32,20,17,9,0,Math.PI,0);g.fill();g.fillStyle='#e58aa0';g.beginPath();g.moveTo(10,64);g.quadraticCurveTo(32,44,54,64);g.fill();g.fillStyle='#3a2a30';g.fillRect(25,33,3,3);g.fillRect(36,33,3,3);return c.toDataURL()})();
 function App(){const [at,setAt]=React.useState(0),[turn,setTurn]=React.useState(1),[done,setDone]=React.useState(false),[speed,setSpeed]=React.useState(28),rootRef=React.useRef(null);
  const activeSource=React.useMemo(()=>({...source,turn,sourceKey:'native'}),[turn]);window.activeSource=activeSource;const pages=turn===1?turn1:turn2;
  const owner=useForkWidgetStage({context,sessionId:'harness',source:activeSource,turn,pages,page:at,record:records[turn],widgets:[phone],rootRef,config:{characters:[{alias:'f_friend',aliases:['friend'],ref:{packId:'fixture',figureId:'friend'}}]},avatarOf:()=>({src:avatar}),film:false,enabled:true,paused:false,mode:'live',revealed:done,reducedMotion:false,onPause:()=>{},
   readHistory:async()=>({rows:turn===1?[]:[{turn:1,sourceKey:'story-1',pages:turn1,record:records[1]}],limited:false,unavailable:false})});
  window.harness={owner,go:n=>{setDone(false);setAt(n)},setTurn,setSpeed,get page(){return at}};
  const line=pages[at];
  return React.createElement('main',{ref:rootRef,className:'fork-gal-stage'},React.createElement('div',{className:'fork-gal-topbar'},React.createElement(ForkWidgetMenu,{owner})),React.createElement(ForkGalWidgets,{owner,onBacklog:()=>{}}),
   React.createElement('div',{className:'fork-gal-box harness-box','data-claim':owner.claim,style:owner.claim?{visibility:'hidden'}:undefined},line.name?React.createElement('b',null,line.name):null,React.createElement(ForkGalTypewriter,{key:turn+':'+at,text:line.text,speed,instant:false,visibleKey:owner.readingKey,onVisible:owner.onVisible,onDone:()=>setDone(true)})));}
 modules['react-dom/client'].createRoot(document.getElementById('root')).render(React.createElement(App));`})
   await page.waitForFunction(()=>!!window.harness)
  }
  const key=page=>page.evaluate(()=>harness.owner.items[0]?.key)
  const action=async(page,type)=>page.evaluate(([k,type])=>harness.owner.action(k,type),[await key(page),type])
  const state=page=>page.evaluate(()=>harness.owner.items[0]?.presentation.state)
  const settle=async(page,ms=500)=>{await page.waitForTimeout(ms)}
  const reveal=async page=>{await page.waitForFunction(()=>document.querySelector('.fork-gal-type')?.dataset.done==='true' || true);await settle(page,1400)}
  const shot=async(page,name)=>{const file=path.join(outDir,name+'.png');await page.screenshot({path:file});shots.push(file)}
  const frame=page=>page.frameLocator('iframe[title="手机"]')
  // Chromeless host checks. Hit areas must be invisible: the stage pixels are identical with and without them.
  const panelBox=page=>page.locator('.fork-widget-panel').boundingBox()
  const invisible=async(page,label)=>{
   const box=await panelBox(page),clip={x:Math.max(0,box.x-16),y:Math.max(0,box.y-16),width:Math.min(box.width+32,page.viewportSize().width-Math.max(0,box.x-16)),height:Math.min(box.height+32,page.viewportSize().height-Math.max(0,box.y-16))}
   const before=await page.screenshot({clip}),hide=await page.addStyleTag({content:'.fork-widget-grip{display:none!important}'}),after=await page.screenshot({clip})
   await hide.evaluate(el=>el.remove())
   const diff=await page.evaluate(async urls=>{const data=await Promise.all(urls.map(async url=>{const image=new Image();image.src=url;await image.decode();const c=document.createElement('canvas');c.width=image.width;c.height=image.height;const g=c.getContext('2d');g.drawImage(image,0,0);return g.getImageData(0,0,c.width,c.height).data}));let worst=0,count=0;for(let i=0;i<data[0].length;i++){const d=Math.abs(data[0][i]-data[1][i]);worst=Math.max(worst,d);if(d>8)count++}return {worst,count}},[before,after].map(png=>'data:image/png;base64,'+png.toString('base64')))
   if (diff.count) errors.push(label+': host hit areas paint pixels '+JSON.stringify(diff))
   if (await page.locator('.fork-widget-panel header,.fork-widget-tools,.fork-widget-chrome,.fork-widget-panel button:not(.fork-widget-chip)').count()) errors.push(label+': host chrome rendered at rest')
  }
  const menuRows=page=>page.locator('.fork-widget-context [role^=menuitem]').allInnerTexts()
  const longPress=async(page,x,y,{ms=800,moveBy=0}={})=>{
   const cdp=await page.context().newCDPSession(page);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]})
   for (let i=1;moveBy && i<=5;i++) {await page.waitForTimeout(16);await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y+moveBy*i/5}]})}
   await page.waitForTimeout(ms);await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach()
  }
  const places=page=>page.evaluate(()=>localStorage.getItem('fork-widget-places'))
  for (const scheme of ['dark','light']) for (const [size,viewport] of [['desktop',{width:1280,height:800}],['375',{width:375,height:740}]]) {
   // 375 is a touch phone (hover:none, coarse pointer); desktop keeps a mouse.
   const page=await browser.newPage({viewport,colorScheme:scheme,deviceScaleFactor:size==='375'?2:1,...(size==='375'?{isMobile:true,hasTouch:true}:{})});await setup(page,scheme)
   const label=scheme+'/'+size
   // Turn 1: compact island while lines arrive; the host never opens it by itself.
   for (const n of [1,2,3]) {await page.evaluate(n=>harness.go(n),n);await reveal(page)}
   await page.waitForSelector('iframe[title="手机"]');await frame(page).locator('#island').waitFor();await settle(page,300)
   if (await state(page)!=='compact') errors.push(label+': new content changed the presentation to '+await state(page))
   await invisible(page,label+' compact');await shot(page,`phone-compact-${scheme}-${size}`)
   if (size==='desktop') {
    // Click on the island opens it (the host cover forwards the tap); no chrome appears around the open device.
    const compact=await panelBox(page);await page.mouse.click(compact.x+compact.width/2,compact.y+compact.height/2);await settle(page,700)
    if (await state(page)!=='open') errors.push(label+': clicking the compact view did not open it')
    await page.evaluate(()=>harness.go(4));await reveal(page);await page.mouse.move(2,400);await invisible(page,label+' open');await shot(page,`phone-open-${scheme}-${size}`)
    const box=await panelBox(page)
    if (!await page.evaluate(([x,y])=>document.elementFromPoint(x,y)?.tagName==='IFRAME',[box.x+box.width/2,box.y+box.height/2])) errors.push(label+': the screen is covered by a host hit area')
    // Right-click on the bezel: one galgame menu at the pointer.
    await page.mouse.click(box.x+box.width/2,box.y+3,{button:'right'});await page.locator('.fork-widget-context').waitFor();await settle(page,250)
    if ((await menuRows(page)).map(text=>text.split('\n')[0]).join('/')!=='收起/固定/关闭') errors.push(label+': open menu rows '+JSON.stringify(await menuRows(page)))
    await shot(page,`phone-menu-${scheme}-${size}`)
    await page.keyboard.press('Escape');await page.locator('.fork-widget-context').waitFor({state:'detached'})
    if (!await page.evaluate(()=>document.activeElement?.classList.contains('fork-widget-panel'))) errors.push(label+': Esc did not return focus to the widget')
    // Drag the device by its bezel; the spot is remembered and offered for reset.
    await page.mouse.move(box.x+box.width/2,box.y+4);await page.mouse.down();for (let i=1;i<=12;i++) await page.mouse.move(box.x+box.width/2-30*i,box.y+4+3*i);await page.mouse.up();await settle(page,400)
    const moved=await panelBox(page)
    if (Math.abs(moved.x-(box.x-360))>1 || Math.abs(moved.y-(box.y+36))>1) errors.push(label+': drag landed at '+JSON.stringify([moved.x-box.x,moved.y-box.y]))
    if (!(await places(page) || '').includes('open')) errors.push(label+': dragged position not stored')
    await page.mouse.move(2,400);await invisible(page,label+' dragged');await shot(page,`phone-dragged-${scheme}-${size}`)
    // Keyboard: Shift+F10 opens the same menu (now with reset); arrows nudge; a smaller stage clamps the spot inside.
    await page.locator('.fork-widget-panel').focus();await page.keyboard.press('Shift+F10');await page.locator('.fork-widget-context').waitFor()
    if (!(await menuRows(page)).some(text=>text.startsWith('复位位置'))) errors.push(label+': reset missing after drag')
    await page.keyboard.press('Escape');await page.keyboard.press('ArrowRight');await settle(page,200)
    if (Math.abs((await panelBox(page)).x-(moved.x+10))>1) errors.push(label+': arrow key did not move the widget')
    await page.setViewportSize({width:760,height:700});await settle(page,500)
    const clamped=await panelBox(page);if (clamped.x<0 || clamped.y<0 || clamped.x+clamped.width>760 || clamped.y+clamped.height>700) errors.push(label+': position not clamped on resize '+JSON.stringify(clamped))
    await page.setViewportSize(viewport);await settle(page,500)
    await page.mouse.click((await panelBox(page)).x+20,(await panelBox(page)).y+3,{button:'right'});await page.locator('.fork-widget-context').waitFor()
    await page.getByRole('menuitem',{name:'复位位置',exact:true}).click();await settle(page,400)
    const back=await panelBox(page);if (Math.abs(back.x-box.x)>1 || Math.abs(back.y-box.y)>1) errors.push(label+': reset did not restore the automatic spot')
    await page.mouse.move(2,400)
   } else {
    // Portrait phone: a tap on the island opens the phone screen itself, edge to edge, with no frame.
    const compact=await panelBox(page);await page.touchscreen.tap(compact.x+compact.width/2,compact.y+compact.height/2);await settle(page,700)
    if (await state(page)!=='open' || !await page.locator('.fork-widget-panel.is-fill').count()) errors.push(label+': tap did not open the full-bleed phone')
    await page.evaluate(()=>harness.go(4));await reveal(page)
    const fill=await panelBox(page);if (fill.x!==0 || fill.y!==0 || fill.width!==375 || fill.height!==740) errors.push(label+': phone does not fill the reading area '+JSON.stringify(fill))
    if (await frame(page).locator('#phone').evaluate(el=>getComputedStyle(el).borderTopWidth)!=='0px') errors.push(label+': phone frame still painted in the sheet')
    await shot(page,`phone-open-${scheme}-${size}`)
    // Moving finger cancels the hold; a still hold on the top edge opens the bottom menu.
    await longPress(page,187,12,{moveBy:40});if (await page.locator('.fork-widget-context').count()) errors.push(label+': a moving touch opened the menu')
    await longPress(page,187,12);await page.locator('.fork-widget-context.is-sheet').waitFor();await settle(page,300)
    if ((await menuRows(page)).map(text=>text.split('\n')[0]).join('/')!=='收起/固定/关闭') errors.push(label+': sheet menu rows '+JSON.stringify(await menuRows(page)))
    await shot(page,`phone-longpress-${scheme}-${size}`)
    await page.getByRole('menuitem',{name:'收起',exact:true}).tap();await settle(page,500)
    if (await state(page)!=='compact') errors.push(label+': 收起 from the long-press menu did not collapse')
    const island=await panelBox(page);await longPress(page,island.x+island.width/2,island.y+island.height/2);await page.locator('.fork-widget-context.is-sheet').waitFor()
    if ((await menuRows(page))[0]?.split('\n')[0]!=='打开') errors.push(label+': compact long-press menu '+JSON.stringify(await menuRows(page)))
    await page.touchscreen.tap(187,120);await page.locator('.fork-widget-context').waitFor({state:'detached'})
    if (await state(page)!=='compact') errors.push(label+': dismissing the menu changed the widget')
   }
   if (chromelessOnly) {await page.close();continue}
   if (size==='375' && await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)) errors.push(scheme+': horizontal overflow at 375')
   // Turn 2: the thread keeps the earlier turn (bounded history window) and continues.
   await page.evaluate(()=>{harness.setTurn(2);harness.go(0)});await settle(page,600);await page.evaluate(()=>harness.go(1));await reveal(page);await action(page,'open');await settle(page,700);await page.evaluate(()=>harness.go(2));await settle(page,500)
   await shot(page,`phone-history-typing-${scheme}-${size}`)
   await reveal(page);await settle(page,800);await shot(page,`phone-history-${scheme}-${size}`)
   const text=await frame(page).locator('#messages').innerText()
   if (!/下课了吗/.test(text) || !/那封信是我写的/.test(text)) errors.push(scheme+'/'+size+': cross-turn history missing')
   if (/\d{1,2}:\d{2}/.test(text)) errors.push(scheme+'/'+size+': message timestamp leaked')
   await page.close()
  }
  // Chromeless recordings with a drawn pointer (headless video has no cursor): drag, right-click, long-press.
  const pointerMark=`(()=>{const dot=document.createElement('i');dot.style.cssText='position:fixed;z-index:99;left:0;top:0;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;border:2px solid #fff;box-shadow:0 0 0 2px #0008;pointer-events:none;transition:transform .12s;display:none';document.body.append(dot);
   const at=e=>{dot.style.display='block';dot.style.left=e.clientX+'px';dot.style.top=e.clientY+'px';};addEventListener('pointermove',at,true);addEventListener('pointerdown',e=>{at(e);dot.style.transform='scale(.7)'},true);addEventListener('pointerup',()=>dot.style.transform='',true)})()`
  for (const [name,options] of [['desktop',{viewport:{width:1280,height:800},hasTouch:true}],['375',{viewport:{width:375,height:740},isMobile:true,hasTouch:true,deviceScaleFactor:2}]]) {
   const videoDir=path.join(outDir,'video-tmp');await mkdir(videoDir,{recursive:true})
   const context=await browser.newContext({...options,colorScheme:'dark',recordVideo:{dir:videoDir,size:options.viewport}})
   const page=await context.newPage();await setup(page,'dark');await page.evaluate(pointerMark)
   for (const n of [1,2,3]) {await page.evaluate(n=>harness.go(n),n);await settle(page,900)}
   await page.waitForSelector('iframe[title="手机"]');await settle(page,500)
   if (name==='desktop') {
    let box=await panelBox(page);await page.mouse.move(box.x+box.width/2,box.y+box.height/2,{steps:8});await page.mouse.down();await page.mouse.move(box.x+box.width/2-420,box.y+box.height/2-260,{steps:30});await page.mouse.up();await settle(page,700)
    box=await panelBox(page);await page.mouse.click(box.x+box.width/2,box.y+box.height/2,{button:'right'});await settle(page,1200)
    await page.getByRole('menuitem',{name:'打开',exact:true}).hover();await settle(page,300);await page.getByRole('menuitem',{name:'打开',exact:true}).click();await settle(page,900)
    await page.evaluate(()=>harness.go(4));await settle(page,1500)
    box=await panelBox(page);await page.mouse.move(box.x+box.width-3,box.y+box.height/2,{steps:10});await page.mouse.down();await page.mouse.move(box.x+box.width+160,box.y+box.height/2+20,{steps:30});await page.mouse.up();await settle(page,700)
    box=await panelBox(page);await page.mouse.click(box.x+box.width/2,box.y+3,{button:'right'});await settle(page,1200)
    await page.getByRole('menuitem',{name:'复位位置',exact:true}).click();await settle(page,900)
    box=await panelBox(page);await longPress(page,box.x+box.width/2,box.y+2,{ms:900});await settle(page,1200)
    await page.getByRole('menuitem',{name:'收起',exact:true}).tap();await settle(page,1000)
   } else {
    let box=await panelBox(page);await page.touchscreen.tap(box.x+box.width/2,box.y+box.height/2);await settle(page,900)
    await page.evaluate(()=>harness.go(4));await settle(page,1600)
    await longPress(page,187,12,{ms:900});await settle(page,1300)
    await page.getByRole('menuitem',{name:'收起',exact:true}).tap();await settle(page,900)
    box=await panelBox(page);await longPress(page,box.x+box.width/2,box.y+box.height/2,{ms:900});await settle(page,1200)
    await page.touchscreen.tap(187,120);await settle(page,800)
   }
   const video=page.video();await context.close();const recorded=await video.path()
   await rename(recorded,path.join(outDir,`phone-chromeless-${name}.webm`));shots.push(path.join(outDir,`phone-chromeless-${name}.webm`))
  }
  if (chromelessOnly) return {shots,errors}
  // Motion: compact → arrival pulse → open → typing → collapse (dark, desktop). Recorded at 1×.
  const videoDir=path.join(outDir,'video-tmp');await mkdir(videoDir,{recursive:true})
  const context=await browser.newContext({viewport:{width:1280,height:800},colorScheme:'dark',recordVideo:{dir:videoDir,size:{width:1280,height:800}}})
  const page=await context.newPage();await setup(page,'dark')
  await page.evaluate(()=>harness.go(1));await reveal(page);await page.evaluate(()=>harness.go(2));await settle(page,1600)
  await page.evaluate(()=>harness.go(3));await settle(page,1200)
  await action(page,'open');await settle(page,900)
  await page.evaluate(()=>harness.go(4));await settle(page,2600)
    if(await state(page)==='open')await frame(page).getByRole('button',{name:'收起',exact:true}).click();else errors.push('video: phone left open state before the collapse step');await settle(page,900)
  await page.evaluate(()=>{harness.setTurn(2);harness.go(0)});await settle(page,900);await page.evaluate(()=>harness.go(1));await settle(page,1400)
  await action(page,'open');await settle(page,700);await page.evaluate(()=>harness.go(2));await settle(page,2600)
  const video=page.video();await context.close();const recorded=await video.path()
  await rename(recorded,path.join(outDir,'phone-motion.webm'));shots.push(path.join(outDir,'phone-motion.webm'))
  // Reduced motion: the island never scales and bubbles only fade.
  const reduced=await browser.newPage({viewport:{width:1280,height:800},reducedMotion:'reduce'});await setup(reduced,'dark')
  await reduced.evaluate(()=>harness.go(2));await reveal(reduced);await reduced.waitForSelector('iframe[title="手机"]')
  const animations=await frame(reduced).locator('body').evaluate(()=>document.getAnimations().map(a=>a.animationName))
  if (animations.some(name=>['nudge','rise','sent'].includes(name))) errors.push('reduced motion still plays '+animations.join(','))
  await reduced.close()
 } finally { for (const fn of cleanup.reverse()) await Promise.resolve().then(fn).catch(()=>{}) }
 return {shots,errors}
}

if (process.argv[1] && fileURLToPath(import.meta.url)===path.resolve(process.argv[1])) {
 const {shots,errors}=await run()
 console.log(shots.length+' files → '+outDir)
 if (errors.length) { console.error(errors.join('\n')); process.exitCode=1 }
}
