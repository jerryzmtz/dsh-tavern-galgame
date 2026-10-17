// private fork (rename-mod, owner 2026-10): the user-facing widget term is 模组 (display text only; ids stay widgets).
// private fork: pack-only cards do not persist empty retired character tables.
// private fork: real CAS/presentation, generic form and shipped phone in an opaque frame; offline only.
import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile,mkdtemp,mkdir} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {chromium} from 'playwright'
import {browserReactScript} from './fixtures/browser-react.mjs'
import {widgetServer} from './fixtures/widget-harness.mjs'
import {stageSource} from './harness/card-centric-stage.mjs'
import {syntheticPack} from './fixtures/asset-packs/pack.mjs'
import {writePhonePack,PHONE_PACK_ID} from './fixtures/source-widget/fork-build-phone-widget.mjs'
import {createAssetPackService} from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/service.js'
import {createAssetPackPresentation} from '../tavern-plugin/lib/domain/asset-pack-presentation.js'
import {createCardAssetBoundary} from '../tavern-plugin/lib/fork-card-asset-bindings.js'
import {defaultAssetEngineSettings} from '../tavern-plugin/lib/domain/asset-engine-settings.js'
const root=new URL('../',import.meta.url),read=name=>readFile(new URL('tavern-plugin/src/client/'+name,root),'utf8')
test('generic settings save updates clock/colour/assets and scene theme without another load, init, token or content event',async t=>{
 const directory=await mkdtemp(new URL('.tmp/widget-settings-browser-',root)),service=createAssetPackService({assetRoot:directory+'/store',authorizeLease:async()=>true});t.after(()=>service.dispose())
 await writePhonePack(directory+'/phone.zip');const inspection=await service.inspectImport({bytes:await readFile(directory+'/phone.zip')});let pack=(await service.applyImport({inspectionId:inspection.inspectionId,expectedRevision:null,decision:'install',acceptScriptRisk:true})).snapshot
 const art=await syntheticPack(),background=art.manifest.assets[0].variants.entries[0].content,blob=art.manifest.blobs[background.media]
 // private fork: image bytes and owning asset enter in one CAS write.
 pack=(await service.patchPack({packId:PHONE_PACK_ID,expectedRevision:pack.revision,patch:{blobs:{...pack.manifest.blobs,[background.media]:blob},assets:[...pack.manifest.assets,{kind:'backgrounds',id:'paper',name:'Sky paper',enabled:true,recall:{mode:'keyword',keywords:[]},directorNote:'',media:background.media}]},fileUpdates:new Map([['media/'+background.media+'.png',art.files.get('media/'+background.media+'.png')]])})).snapshot
 const ref={packId:PHONE_PACK_ID,kind:'widgets',assetId:'phone'},image={packId:PHONE_PACK_ID,kind:'backgrounds',assetId:'paper'}
 let workspace={raw:{extensions:{dsh_tavern:{schemaVersion:1,stage:{widgets:true},assetBindings:{boundPackIds:[PHONE_PACK_ID]}}}}}
 let origin,consumer
 const boundary=createCardAssetBoundary({ctx:{get:name=>name==='assetLibrary'?service:null},listCards:async()=>[{path:'synthetic'}],readWorkspace:async()=>workspace,updateCard:async(_p,_a,_b,ops)=>{workspace={raw:{extensions:{dsh_tavern:ops[0].value}}};consumer.rebind(workspace.raw)}})
 origin=await widgetServer(t,{connect(value){origin=value},async serve(req,res){const url=new URL(req.url,origin),match=/^\/api\/dsh-asset-library\/v2\/lease\/([^/]+)\/(.+)$/.exec(url.pathname);if(!match)return false;const response=await service.respondLease({ticket:match[1],resource:decodeURIComponent(match[2]),request:new Request(url,{headers:req.headers})});res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));return true}},(_req,res)=>{res.setHeader('Content-Type','text/html');res.end('<!doctype html><html lang="zh-CN"><div id="root"></div>');return true})
 consumer=createAssetPackPresentation({raw:workspace.raw,getService:()=>service,origin,scope:'settings-browser'});t.after(()=>consumer.dispose())
 const get=async()=>({widget:(await consumer.widgets({widgets:{}},{engine:defaultAssetEngineSettings(),sourceRefs:[ref],isCurrent:()=>true}))[0],card:(await boundary.snapshot('synthetic')).extension,pack:await service.getPackSnapshot({packId:PHONE_PACK_ID})})
 const initial=await get(),browser=await chromium.launch({headless:true,args:['--explicitly-allowed-ports='+new URL(origin).port]});t.after(()=>browser.close())
 const page=await browser.newPage({viewport:{width:1000,height:800}}),errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto(origin);await page.addScriptTag({content:await browserReactScript()})
 await page.addStyleTag({content:await readFile(new URL('tavern-plugin/lib/client-assets/fork-theme.css',root),'utf8')+'body{margin:0;background:#efece5;color:#242321}.fixture{display:grid;grid-template-columns:1fr 340px;gap:16px}.fixture>.ap-ui{height:100vh;overflow:auto;padding:16px}.fork-gal-stage{position:relative;height:800px;--gal-ui-surface:#ffffff;--gal-ui-ink:#202020;--gal-ui-accent:#bd7047;--gal-ui-accent-ink:#ffffff;--gal-ui-line:#6a625b} iframe{position:relative;z-index:10;max-width:100%}'} )
 await page.exposeFunction('previewImage',args=>service.leaseMedia({...args,origin,scope:'settings-picker'}))
 await page.exposeFunction('releasePreviewImage',ticket=>service.releaseLease(ticket))
 await page.exposeFunction('saveSetting',async(scope,key,type,value)=>{
   const current=await service.getPackSnapshot({packId:PHONE_PACK_ID});await service.patchPack({packId:PHONE_PACK_ID,expectedRevision:current.revision,patch:{assets:current.manifest.assets.map(asset=>{if(asset.kind!=='widgets')return asset;const settingsDefaults={...asset.settingsDefaults};if(type)settingsDefaults[key]=value;else delete settingsDefaults[key];return {...asset,settingsDefaults}})}})
  return get()
 })
 const ui=(await stageSource()).source.replace('return {App,Home','return {WidgetSettingsForm,App,Home')
 const files=['fork-widget-contracts.cjs','fork-widget-media.cjs','fork-widget-theme.cjs','fork-widget-theme.js','fork-widget-setting-images.js','fork-widget-sandbox.js']
 const code=(await Promise.all(files.map(read))).join('\n')
 await page.addScriptTag({content:`const React=modules.react;{${ui}\nwindow.settingsUI=createForkAssetPackUI(React);} ${code}
 const forkStageAudio={bind(){},release(){}},counts={};function forkWidgetCount(key){counts[key]=(counts[key]||0)+1;}
 window.received=[];window.sounds=[];window.addEventListener('message',event=>{if(event.source===document.querySelector('iframe')?.contentWindow){received.push(event.data);if(event.data.type==='audio.play')sounds.push(event.data);}});
 const initial=${JSON.stringify(initial)},image=${JSON.stringify(image)};
 function App(){const [data,setData]=React.useState(initial),[scope,setScope]=React.useState('shared'),[scene,setScene]=React.useState(null),[fixed,setFixed]=React.useState(false),rootRef=React.useRef(null);
 const p={state:'open',bounds:{width:280,height:607},surface:'stage',pinned:false,attention:{count:0,changed:false},suspended:false,reducedMotion:false,transitionMs:0};
 const widget={...data.widget,settings:{...data.widget.definition.settings},presentation:p,scopeKey:'phone',sourceOnly:true,source:{threadKey:'same',current:{id:'one'},messages:[{id:'one',turn:1,para:1,side:'in',contact:'friend',name:'Friend',alias:'friend',text:'Keep this message and its scroll position.',revealed:true}]},playback:{mode:'live',eventToken:'event-one',fresh:false}};
 useForkWidgetSettingImages([widget]);useForkWidgetTheme(rootRef,scene,null,{snap:fixed});
 window.harness={setScope,setScene,setFixed,data,widget,themeOwners:forkWidgetThemeOwners,paletteCache:forkWidgetPaletteCache,rootRef,async save(key,type,value){setData(await saveSetting(scope,key,type,value));}};
 const override=data.card.assetBindings.widgets?.[0] || {};
 return React.createElement('div',{className:'fixture'},React.createElement('div',{className:'ap-ui'},React.createElement('button',{onClick:()=>setScope(scope==='card'?'shared':'card')},scope==='card'?'编辑共享默认':'编辑本卡'),React.createElement(settingsUI.WidgetSettingsForm,{declaration:data.widget.definition.document,defaults:data.pack.manifest.assets.find(asset=>asset.kind==='widgets').settingsDefaults,override,card:scope==='card',binding:{previewMedia:async args=>{const lease=await previewImage(args);return {url:lease.url,release:()=>releasePreviewImage(lease.ticket)}}},packs:[data.pack],onChange:async(key,type,value)=>setData(await saveSetting(scope,key,type,value)),onReset:()=>{}})),React.createElement('main',{ref:rootRef,className:'fork-gal-stage'},React.createElement(ForkWidgetSandbox,{widget})));
 }modules['react-dom/client'].createRoot(document.getElementById('root')).render(React.createElement(App));`})
 const frame=page.frameLocator('iframe');await frame.locator('#clock').waitFor({timeout:6000}).catch(async error=>{throw new Error(error.message+' errors='+JSON.stringify(errors)+' DOM='+await page.locator('#root').innerHTML())});assert.equal(await frame.locator('#clock').textContent(),'09:41')
 await page.waitForFunction(()=>received.some(value=>value.type==='ready'))
 await page.evaluate(()=>{window.frameBefore=document.querySelector('iframe');window.windowBefore=frameBefore.contentWindow;window.tokenBefore=received.find(value=>value.type==='ready').token})
 await frame.locator('#messages p').evaluate(node=>{window.messageBefore=node;window.loads=0;window.inits=0;window.settingsMessages=0;window.themes=[];window.addEventListener('message',event=>{if(event.data.type==='init')inits++;if(event.data.type==='settings')settingsMessages++;if(event.data.type==='theme')themes.push(event.data);});})
 await page.getByRole('textbox',{name:'状态栏文字',exact:true}).fill('13:57');await page.getByRole('textbox',{name:'状态栏文字',exact:true}).press('Enter');await frame.locator('#clock').filter({hasText:'13:57'}).waitFor()
 assert.equal(await frame.locator('#messages p').evaluate(node=>node===window.messageBefore),true)
 await page.evaluate(()=>harness.save('clockText',null));await frame.locator('#clock').filter({hasText:'09:41'}).waitFor()
 await page.getByRole('textbox',{name:'状态栏文字',exact:true}).fill('shared');await page.getByRole('textbox',{name:'状态栏文字',exact:true}).press('Enter');await frame.locator('#clock').filter({hasText:'shared'}).waitFor()
 // private fork: 壁纸 is one control (current choice) opening the shared background picker, never an inline grid.
 assert.equal(await page.locator('.ap-widget-setting[data-type=pack-asset] [role=menuitemradio], .ap-widget-setting[data-type=pack-asset] .ap-thumb').count(),0)
 // private fork (card import r3): the UI calls widgets 模组.
 await page.getByRole('button',{name:'壁纸：模组默认',exact:true}).click();assert.equal(await page.getByRole('group',{name:'通用模组'}).getByRole('menuitemradio').count(),1)
 assert.equal(await page.getByRole('menuitemradio',{name:'模组默认'}).getAttribute('aria-checked'),'true')
 await page.getByRole('menuitemradio',{name:'Sky paper',exact:true}).click();await page.getByRole('button',{name:'壁纸：Sky paper',exact:true}).waitFor();await frame.locator('#phone').evaluate(async node=>{for(let i=0;i<100&&!node.style.backgroundImage.includes('data:image');i++)await new Promise(resolve=>setTimeout(resolve,10));});assert.match(await frame.locator('#phone').evaluate(node=>node.style.backgroundImage),/data:image\/webp/)
 const data=await get(),selected=data.widget.definition.settingAssets.wallpaper
 await page.evaluate(asset=>harness.setScene({backgroundMedia:{identity:'pack:backgrounds:paper:'+asset.identity},backgroundUrl:asset.url,stageTheme:{accent:'#118844',surface:'#f8f5e8'}}),selected)
 await frame.locator('html').evaluate(async node=>{for(let i=0;i<100&&getComputedStyle(node).getPropertyValue('--gal-ui-accent')!=='#118844';i++)await new Promise(resolve=>setTimeout(resolve,10));})
 assert.equal(await frame.locator('html').evaluate(node=>getComputedStyle(node).getPropertyValue('--gal-ui-accent')),'#118844')
 assert.equal(await frame.locator('html').evaluate(()=>themes.at(-1).transitionMs),200)
 await page.getByRole('button',{name:/^强调色：/}).click(); // private fork (inline-field sweep): the colour is an inline field; its popup holds the palette and the hex
 await page.getByRole('textbox',{name:'强调色色值',exact:true}).fill('#aa2244');await page.getByRole('textbox',{name:'强调色色值',exact:true}).press('Enter')
 // private fork: wait for the actual iframe publication, not a one-second loop that silently expires under full-suite load.
 const widgetFrame=page.frames().find(child=>child.parentFrame()===page.mainFrame())
 await widgetFrame.waitForFunction(()=>getComputedStyle(document.documentElement).getPropertyValue('--gal-ui-accent')==='#aa2244')
 await page.evaluate(()=>harness.setScene(null))
 await page.waitForFunction(()=>harness.themeOwners.get(harness.rootRef.current)?.theme.surface==='#ffffff')
 await widgetFrame.waitForFunction(()=>getComputedStyle(document.documentElement).getPropertyValue('--gal-ui-accent')==='#aa2244')
 assert.equal(await frame.locator('html').evaluate(node=>getComputedStyle(node).getPropertyValue('--gal-ui-accent')),'#aa2244')
 assert.equal(await page.evaluate(()=>harness.paletteCache.size),1)
 await page.evaluate(()=>harness.setFixed(true));await page.evaluate(asset=>harness.setScene({backgroundMedia:{identity:'pack:backgrounds:paper:'+asset.identity},backgroundUrl:asset.url,stageTheme:{surface:'#efefef'}}),selected)
 await page.waitForFunction(()=>harness.themeOwners.get(harness.rootRef.current)?.theme.surface==='#efefef')
 assert.equal(await frame.locator('html').evaluate(()=>themes.at(-1).transitionMs),0)
 assert.equal(await page.evaluate(()=>harness.paletteCache.size),1)
 assert.equal(await page.evaluate(()=>document.querySelector('iframe')===frameBefore && frameBefore.contentWindow===windowBefore && received.filter(value=>value.type==='ready').length===1 && received[0].token===tokenBefore),true)
 assert.equal(await frame.locator('html').evaluate(()=>inits),0);assert.equal(await page.evaluate(()=>sounds.length),0)
 assert.ok(await frame.locator('html').evaluate(()=>settingsMessages)>=4)
 await page.getByRole('slider',{name:'装饰电量',exact:true}).press('Home');await frame.locator('#battery').filter({hasText:'5%'}).waitFor();assert.equal(await frame.locator('#battery').getAttribute('data-level'),'low') // private fork (settings-ux r2): three shared battery levels
 await page.getByRole('button',{name:'刘海',exact:true}).click();await frame.locator('#cutout[data-kind=notch]').waitFor()
 await page.getByRole('switch',{name:'显示状态栏',exact:true}).click();await frame.locator('#status-bar').waitFor({state:'hidden'});await page.getByRole('switch',{name:'显示状态栏',exact:true}).click();await frame.locator('#status-bar').waitFor()
 await page.getByRole('switch',{name:'来信提示音',exact:true}).click();await page.waitForFunction(()=>harness.widget.settings.sound===false)
 await page.evaluate(()=>harness.save('bodyColor','settings','#334455'));await page.evaluate(()=>harness.save('surfaceColor','settings','#ffffff'))
 assert.equal(await frame.locator('#phone').evaluate(node=>getComputedStyle(node).borderTopColor),'rgb(51, 68, 85)');assert.equal(await frame.locator('html').evaluate(node=>getComputedStyle(node).getPropertyValue('--gal-ui-ink-2')),'#000000')
 assert.equal(await page.locator('select,input[type=color],input[type=range],input[type=checkbox]').count(),0)
 assert.doesNotMatch(await page.locator('.ap-ui').innerText(),new RegExp(PHONE_PACK_ID+'|clockText|settingsSchema'))
 const out=new URL('output/widget-settings/browser/',root);await mkdir(out,{recursive:true});await page.screenshot({path:fileURLToPath(new URL('settings-functional-desktop.png',out)),fullPage:true})
 await page.setViewportSize({width:375,height:740});await page.addStyleTag({content:'@media(max-width:420px){.fixture{grid-template-columns:1fr}.fixture>.ap-ui{height:auto;max-width:100vw}.fork-gal-stage{height:640px}}'})
 assert.ok(await page.locator('.ap-ui').evaluate(node=>node.scrollWidth<=375))
 await page.screenshot({path:fileURLToPath(new URL('settings-functional-375.png',out)),fullPage:true})
 assert.deepEqual(errors,[])
})
