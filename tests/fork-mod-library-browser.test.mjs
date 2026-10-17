import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile,mkdtemp,mkdir,rm} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import {chromium} from 'playwright'
import {browserReactScript} from './fixtures/browser-react.mjs'
import {widgetServer} from './fixtures/widget-harness.mjs'
import {stageSource,THEMES,pageSetup} from './harness/card-centric-stage.mjs'
import {forkThemeCss} from './helpers/fork-theme-css.mjs'
import {createFirstPartyMods} from '../tavern-plugin/lib/fork-mod-builtins.js'
import {createModRegistry} from '../tavern-plugin/lib/domain/mods/registry.js'
import {createModRpc} from '../tavern-plugin/lib/fork-mod-rpc.js'
import {createModMediaStore,withModMedia} from '../tavern-plugin/lib/fork-mod-media.js'
import {validateModSettingsSchema} from '../tavern-plugin/lib/domain/mods/settings.js'
const root=new URL('../',import.meta.url)
test('first-party mod library uses global switches and settings at desktop and narrow widths',async t=>{
  const manifest=JSON.parse(await readFile(new URL('tavern-plugin/mods/demo/manifest.json',root))),registry=createModRegistry()
  delete manifest.ui.internal // private fork (engine row, owner 2026-10): the shipped demo is internal (never listed); this test lists it
  manifest.i18n={defaultLocale:'zh-CN',messages:{'zh-CN':{'demo.name':manifest.name}}};manifest.name='demo.name'
  Object.assign(manifest.settingsSchema.fields.find(field=>field.key==='opacity'),{max:.95,default:.9})
  await registry.install({manifest,expectedRevision:registry.snapshot().revision})
  const api=createModRpc({library:registry,authorize:()=>true}),writes=[]
  const origin=await widgetServer(t,{connect(){},serve(){return false}},  (_req,res)=>{res.setHeader('Content-Type','text/html');res.end('<!doctype html><html lang="zh-CN"><div id="root"></div>');return true})
  const browser=await chromium.launch({headless:true,args:['--explicitly-allowed-ports='+new URL(origin).port]});t.after(()=>browser.close())
  const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto(origin)
  await page.exposeFunction('modRpc',async(method,args)=>{if(!method.startsWith('get')&&!method.startsWith('list'))writes.push({method,args});return api[method](args,{origin})})
  await page.addScriptTag({content:await browserReactScript()})
  await page.addStyleTag({content:await readFile(new URL('tavern-plugin/lib/client-assets/fork-theme.css',root),'utf8')+'body{margin:0;padding:16px;box-sizing:border-box;'+THEMES.light+'}'})
  await page.addScriptTag({content:`const React=modules.react,ReactDOM=modules['react-dom'];${(await stageSource()).source}
    const ui=createForkAssetPackUI(React),root=modules['react-dom/client'].createRoot(document.getElementById('root'));
    window.mount=cardId=>root.render(React.createElement(ui.ModDetail,{key:cardId||'global',rpc:window.modRpc,cardId,modId:'dsh.demo',onBack(){}}));mount();`})
  // private fork (one mod entry, owner 2026-10): no 模组库 tab — the mod's page (its head switch) is mounted directly; the
  // 舞台设置 › 模组 rows that open it are covered by the stage panel tests.
  await page.getByRole('switch',{name:'\u6846\u67b6\u6f14\u793a',exact:true}).waitFor({timeout:5000}).catch(async error=>{t.diagnostic(JSON.stringify({errors,body:await page.locator('body').innerText()}));throw error;})
  await page.getByRole('switch',{name:'\u6846\u67b6\u6f14\u793a',exact:true}).click()
  assert.equal(await page.locator('.ap-state-tag').count(),0)
  await page.getByRole('button',{name:'\u5141\u8bb8\u5e76\u542f\u7528',exact:true}).click()
  await page.waitForFunction(()=>document.querySelector('input[role="switch"]')?.checked)
  assert.equal(registry.listMods().mods[0].authorized,true)
  assert.match(await page.locator('.ap-subhead-back').getAttribute('aria-label'),/\u821e\u53f0\u8bbe\u7f6e/,'‹ goes back to 舞台设置')
  await page.getByText('\u6807\u9898',{exact:true}).click()
  const caption=page.getByRole('textbox',{name:'\u6807\u9898',exact:true});await caption.fill('\u5171\u4eab\u6807\u9898');await caption.press('Enter')
  await page.waitForFunction(()=>{const input=document.querySelector('input[aria-label="\u6807\u9898"]');return input?.value==='\u5171\u4eab\u6807\u9898'&&!input.disabled})
  assert.equal(registry.getMod({modId:manifest.id}).settings.values.caption,'\u5171\u4eab\u6807\u9898')
  await page.evaluate(()=>mount('card-a'))
  await page.getByRole('switch',{name:'\u663e\u793a',exact:true}).uncheck()
  await page.waitForFunction(()=>!document.querySelector('input[aria-label="\u663e\u793a"]')?.checked)
  assert.equal(await page.getByRole('radiogroup',{name:'设置归属'}).count(),0)
  assert.equal(registry.getMod({modId:manifest.id,cardId:'card-a'}).settings.values.visible,false)
  assert.equal(registry.getMod({modId:manifest.id,cardId:'card-b'}).settings.values.visible,false)
  assert.deepEqual(registry.getMod({modId:manifest.id,cardId:'card-a'}).settings.storedValues,{caption:'\u5171\u4eab\u6807\u9898',visible:false})
  assert.equal(registry.getMod({modId:manifest.id}).settings.values.caption,'\u5171\u4eab\u6807\u9898')
  const visual=page.getByRole('button',{name:'\u89c6\u89c9',exact:true});await visual.click()
  assert.equal(await page.locator('.ap-mod-field[inert]').count(),1)
  await page.locator('.ap-mod-field').filter({has:page.getByRole('switch',{name:'\u663e\u793a',exact:true})}).getByRole('button',{name:'\u6062\u590d\u9ed8\u8ba4',exact:true}).click()
  await page.waitForFunction(()=>document.querySelector('input[aria-label="\u663e\u793a"]')?.checked)
  await page.getByRole('slider',{name:'\u4e0d\u900f\u660e\u5ea6',exact:true}).press('ArrowLeft')
  await page.waitForFunction(()=>document.querySelector('[role="slider"]')?.getAttribute('aria-valuenow')==='0.8')
  assert.equal(registry.getMod({modId:manifest.id,cardId:'card-a'}).settings.values.opacity,.8)
  await page.getByRole('slider',{name:'\u4e0d\u900f\u660e\u5ea6',exact:true}).press('End')
  await page.waitForFunction(()=>document.querySelector('[role="slider"]')?.getAttribute('aria-valuenow')==='0.9')
  assert.equal(registry.getMod({modId:manifest.id,cardId:'card-a'}).settings.values.opacity,.9)
  await page.getByRole('button',{name:'\u5f3a\u8c03\u8272\uff1a#225566',exact:true}).click()
  assert.equal(await page.getByRole('button',{name:'\u8ddf\u968f\u821e\u53f0\u5f3a\u8c03\u8272',exact:true}).count(),0)
  const colour=page.getByRole('textbox',{name:'\u5f3a\u8c03\u8272\u8272\u503c',exact:true});await colour.fill('#337799');await colour.press('Enter')
  await page.getByRole('button',{name:'\u5f3a\u8c03\u8272\uff1a#337799',exact:true}).waitFor()
  assert.equal(registry.getMod({modId:manifest.id,cardId:'card-a'}).settings.values.accent,'#337799')
  await visual.click();await page.evaluate(()=>mount('card-b'));await page.getByRole('button',{name:'\u89c6\u89c9',exact:true}).waitFor()
  assert.equal(await page.getByRole('button',{name:'\u89c6\u89c9',exact:true}).getAttribute('aria-expanded'),'false')
  await page.setViewportSize({width:375,height:850})
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
  assert.equal(await page.locator('select,input[type="range"],input[type="color"]').count(),0)
  assert.ok(writes.every(row=>typeof row.args.expectedRevision==='string'&&!Object.hasOwn(row.args,'sessionId')&&!Object.hasOwn(row.args,'cardId')))
  assert.deepEqual(errors,[])
})


test('stage settings lists installed registry mods once under Mods, with accurate count and global-only switches',async t=>{
  const builtins=await createFirstPartyMods(),registry=createModRegistry({capabilities:['stage.place','stage.state','stage.reviseAfterSettlement']})
  for(const row of builtins.catalogue())await registry.install({manifest:builtins.manifest(row.id),expectedRevision:registry.snapshot().revision})
  const api=createModRpc({library:registry,authorize:()=>true}),writes=[]
  const browser=await chromium.launch({headless:true,args:['--mute-audio']});t.after(()=>browser.close())
  const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];page.on('pageerror',error=>errors.push(error.message))
  await page.route('http://stage.test/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="zh-CN"><div id="panel"></div>'}))
  await page.goto('http://stage.test/')
  await page.exposeFunction('modRpc',async(method,args)=>{if(!/^(get|list)/.test(method))writes.push({method,args});return api[method](args,{origin:'http://stage.test'})})
  await page.addStyleTag({content:await forkThemeCss()+'body{margin:0;'+THEMES.light+'}#panel{width:min(560px,100%);margin-left:auto;}'} )
  const {source,picker,playback}=await stageSource()
  await page.addScriptTag({content:await browserReactScript()+';window.React=modules.react;window.ReactDOM=modules["react-dom/client"];'+playback+source+picker})
  await page.evaluate(pageSetup)
  await page.evaluate(methods=>{
    const rpc=window.binding.rpc
    window.binding.engineRpc=(method,args)=>methods.includes(method)?window.modRpc(method,args):rpc(method,args)
    window.binding.rpc=async(method,args)=>{const value=await rpc(method,args);return method==='getCardAssetBindings'?{...value,cardId:'card-a'}:value}
    window.scenario('main');window.show('registry-mods')
  },Object.keys(api))
  const mods=page.locator('.ap-widget-section'),basic=page.locator('.ap-section').filter({has:page.getByRole('button',{name:/^基础设置/})})
  await mods.getByRole('switch',{name:'演出',exact:true}).waitFor()
  const expectedMods=builtins.catalogue().map(row=>row.name)
  assert.equal(await mods.getByRole('switch').count(),expectedMods.length)
  for(const name of expectedMods) assert.equal(await mods.getByRole('switch',{name,exact:true}).count(),1,name)
  assert.equal(await basic.count(),1)
  assert.match(await mods.locator('.ap-section-toggle').innerText(),new RegExp(`模组\\s*${expectedMods.length}`))
  for(const row of builtins.catalogue()) {
    assert.equal(await basic.getByRole('switch',{name:row.name,exact:true}).count(),0)
    assert.equal(await mods.getByRole('button',{name:row.name+' 设置',exact:true}).count(),1)
  }
  assert.equal(await page.getByRole('tab',{name:'模组',exact:true}).count(),0)
  if(process.env.P5_MOD_SETTINGS_SHOTS){await mkdir(process.env.P5_MOD_SETTINGS_SHOTS,{recursive:true});await page.screenshot({path:path.join(process.env.P5_MOD_SETTINGS_SHOTS,'p5-settings-after-preview-desktop.png'),fullPage:true})}
  await mods.getByRole('switch',{name:'文字演出',exact:true}).click()
  await page.getByRole('button',{name:'允许并启用',exact:true}).click()
  await page.waitForFunction(()=>document.querySelector('.ap-widget-section input[aria-label="文字演出"]')?.checked)
  assert.ok(writes.some(row=>row.method==='setModScope'&&row.args.scope==='global'))
  assert.ok(writes.every(row=>!Object.hasOwn(row.args,'cardId')))
  await mods.getByRole('button',{name:'演出 设置',exact:true}).click()
  await page.waitForFunction(()=>document.querySelector('.ap-subhead')?.innerText.includes('演出'))
  assert.match(await page.locator('.ap-subhead').innerText(),/演出/)
  await page.locator('.ap-subhead-back').click()
  await mods.getByRole('switch',{name:'演出',exact:true}).waitFor()
  await page.setViewportSize({width:375,height:850})
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
  if(process.env.P5_MOD_SETTINGS_SHOTS)await page.screenshot({path:path.join(process.env.P5_MOD_SETTINGS_SHOTS,'p5-settings-after-preview-mobile.png'),fullPage:true})
  const future=JSON.parse(await readFile(new URL('tavern-plugin/mods/demo/manifest.json',root)))
  delete future.ui.internal;future.id='test.future';future.name='Future Mod'
  await registry.install({manifest:future,expectedRevision:registry.snapshot().revision})
  await page.evaluate(()=>window.show('new-registry-entry'))
  await mods.getByRole('switch',{name:'Future Mod',exact:true}).waitFor()
  assert.equal(await mods.getByRole('switch').count(),expectedMods.length+1)
  assert.match(await mods.locator('.ap-section-toggle').innerText(),new RegExp(`模组\\s*${expectedMods.length+1}`))
  assert.deepEqual(errors,[])
})

// private fork (mod library P2): the mod's own asset library — packs, the genre list (label + icon per genre,
// CONTRACT-P4-PREP), image tiles with lamps, real media through the host media store, multi-select delete.
// MOD_P2_SHOTS=<dir> also saves PC / 375 px screenshots.
test('mod asset library edits packs, genre lists with icons and director entries through the media store',async t=>{
  const base=JSON.parse(await readFile(new URL('tavern-plugin/mods/demo/manifest.json',root))),modId='test.items'
  const genreId={key:'genreId',type:'reference',label:'分类',default:null,target:{library:'pack',field:'genres'}}
  // The pack-list reference validator lands with P4's backend; until then the item kind omits genreId.
  const packRefs=(()=>{try{validateModSettingsSchema({fields:[genreId]},'$',false,modId);return true}catch{return false}})()
  const genres={key:'genres',type:'list',label:'分类',default:[],maxItems:32,item:{type:'object',label:'分类',default:{id:'misc',label:'杂物',icon:null},fields:[
    {key:'id',type:'text',label:'标识',default:'misc',maxLength:64},{key:'label',type:'text',label:'名称',default:'杂物',maxLength:40},
    {key:'icon',type:'reference',label:'图标',default:null,target:{library:'mod',modId,kinds:['icon']}}]}}
  const manifest={...base,id:modId,name:'物品演出',summary:'获得、失去或展示物品时，在舞台上亮出物品卡。',permissions:{stage:[]},commands:[],prompts:[],uiPages:[],packSchema:{fields:[genres]},
    assetKinds:[{id:'icon',label:'图标',fields:{fields:[]},directorSelectable:false,mediaSlots:[{id:'image',type:'image'}]},
      {id:'item',label:'物品',fields:{fields:[...(packRefs?[genreId]:[]),{key:'inventoryId',type:'text',label:'库存关联',default:'',maxLength:120}]},directorSelectable:true,mediaSlots:[{id:'image',type:'image'}]},
      {id:'tone',label:'提示音',fields:{fields:[]},directorSelectable:false,mediaSlots:[{id:'audio',type:'audio'}]}],
    settingsSchema:{fields:base.settingsSchema.fields.map(field=>field.key==='image'?{...field,kind:'item'}:field),sections:base.settingsSchema.sections},
    ui:{layout:[{host:'assets',title:'图标包'},{section:'appearance'},{host:'advanced'}]}}
  delete manifest.i18n
  const registry=createModRegistry(),temp=await mkdtemp(path.join(os.tmpdir(),'mod-media-'));t.after(()=>rm(temp,{recursive:true,force:true}))
  await registry.install({manifest,expectedRevision:registry.snapshot().revision})
  const media=createModMediaStore({root:temp}),api=createModRpc({library:withModMedia(registry,media),authorize:()=>true})
  const origin=await widgetServer(t,{connect(){},serve(){return false}},(_req,res)=>{res.setHeader('Content-Type','text/html');res.end('<!doctype html><html lang="zh-CN"><div id="root"></div>');return true})
  const browser=await chromium.launch({headless:true,args:['--explicitly-allowed-ports='+new URL(origin).port]});t.after(()=>browser.close())
  const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto(origin)
  await page.exposeFunction('modRpc',async(method,args)=>api[method](args,{origin}))
  await page.addScriptTag({content:await browserReactScript()})
  const shots=process.env.MOD_P2_SHOTS,theme=shots?THEMES.dark:THEMES.light
  await page.addStyleTag({content:await readFile(new URL('tavern-plugin/lib/client-assets/fork-theme.css',root),'utf8')+'body{margin:0;padding:16px;box-sizing:border-box;background:var(--page);'+theme+'}'})
  await page.addScriptTag({content:`const React=modules.react,ReactDOM=modules['react-dom'];${(await stageSource()).source}
    const ui=createForkAssetPackUI(React),root=modules['react-dom/client'].createRoot(document.getElementById('root'));
    window.mount=(cardId,key)=>root.render(React.createElement(ui.ModDetail,{key:(cardId||'global')+(key||''),rpc:window.modRpc,cardId,modId:'${modId}',onBack(){}}));mount('card-a');`})
  const fail=async error=>{t.diagnostic(JSON.stringify({errors,body:await page.locator('body').innerText()}));throw error}
  await page.getByRole('button',{name:'图标包',exact:true}).waitFor({timeout:5000}).catch(fail)
  await page.getByRole('button',{name:'新建素材包',exact:true}).click()
  await page.locator('.ap-mod-pack').waitFor()
  const packId=()=>Object.keys(registry.snapshot().mods[modId].packs)[0],pack=()=>registry.snapshot().mods[modId].packs[packId()]
  await page.locator('.ap-mod-pack .ap-state-tag').click();await page.locator('.ap-state-opt[data-state="card"]').click()
  await page.locator('.ap-mod-pack .ap-state-tag[data-state="card"]').waitFor()
  assert.equal(registry.listModPacks({modId,cardId:'card-a'}).packs[0].scope,'card')
  assert.equal(registry.listModPacks({modId,cardId:'card-b'}).packs[0].scope,'off')
  const png=async colour=>Buffer.from((await page.evaluate(fill=>{const c=document.createElement('canvas');c.width=c.height=64;const g=c.getContext('2d');g.fillStyle=fill;g.fillRect(8,8,48,48);return c.toDataURL('image/png')},colour)).split(',')[1],'base64')
  // A genre: dashed ＋ adds a row with a generated id; uploading its icon creates the owned icon entry and the ref.
  await page.getByRole('button',{name:'添加分类',exact:true}).click()
  await page.locator('.ap-mod-entry').waitFor()
  const [genre]=pack().fields.genres
  assert.match(genre.id,/^g[0-9a-f]{8}$/);assert.equal(genre.label,'新分类');assert.equal(genre.icon,null)
  await page.locator('.ap-mod-entry input[type="file"]').setInputFiles({name:'g.png',mimeType:'image/png',buffer:await png('#c33')})
  await page.locator('.ap-mod-hero-art img').waitFor().catch(fail)
  const icon=pack().entries[0]
  assert.equal(icon.kind,'icon');assert.match(icon.media.image,/^media\/[0-9a-f-]{36}\.(webp|png)$/)
  assert.deepEqual(pack().fields.genres[0].icon,{modId,packId:packId(),kind:'icon',entryId:icon.id})
  assert.deepEqual(pack().files.map(file=>file.path),[icon.media.image])
  assert.equal(await page.locator('.ap-mod-tiles[aria-label="图标"]').count(),0)
  // Only media the host store wrote (exact size) may be referenced; callers cannot claim verification or escape the pack.
  const unstored={...pack(),files:[...pack().files,{path:'media/'+crypto.randomUUID()+'.png',size:10}]}
  await assert.rejects(api.saveModPack({modId,pack:unstored,expectedRevision:registry.snapshot().revision}),{code:'MOD_RESOURCE_UNAVAILABLE'})
  await assert.rejects(api.saveModPack({modId,pack:pack(),expectedRevision:registry.snapshot().revision,mediaVerified:true},{origin}))
  await assert.rejects(api.putModMedia({modId,packId:packId(),mime:'image/png',data:Buffer.from('not a png').toString('base64')},{origin}))
  await assert.rejects(api.readModMedia({modId,packId:packId(),path:'../../state.json'},{origin}),{code:'MOD_RESOURCE_UNAVAILABLE'})
  await page.locator('.ap-mod-entry .fork-inline-field').first().click()
  const rename=page.getByRole('textbox',{name:'新分类 名称',exact:true});await rename.fill('药品');await rename.press('Enter')
  await page.getByRole('button',{name:'药品',exact:true}).click()
  await page.getByRole('button',{name:'添加物品',exact:true}).click()
  await page.getByRole('button',{name:'触发策略：绿灯',exact:true}).waitFor()
  const item=()=>pack().entries.find(entry=>entry.kind==='item')
  assert.deepEqual(item().recall,{mode:'keyword',keywords:[]})
  if(packRefs) {
    assert.equal(item().fields.genreId,genre.id)
    await page.getByRole('button',{name:'分类：药品',exact:true}).waitFor()
  }
  await page.getByRole('button',{name:'触发策略：绿灯',exact:true}).click();await page.getByRole('menuitemradio',{name:'蓝灯'}).click()
  await page.getByRole('button',{name:'触发策略：蓝灯',exact:true}).waitFor()
  assert.equal(item().recall.mode,'constant')
  // ⋯ → 删除… selects genres and entries together; a removed genre takes its own icon entry and clears item refs.
  await page.getByRole('button',{name:'新素材包 更多操作',exact:true}).click();await page.getByRole('menuitem',{name:'删除…'}).click()
  await page.getByRole('checkbox',{name:'药品'}).click()
  await page.locator('.ap-pick-action').click();await page.getByRole('dialog').getByRole('button',{name:'删除',exact:true}).click()
  await page.waitForFunction(()=>!document.querySelector('.ap-select-count'))
  assert.deepEqual(pack().fields.genres,[]);assert.deepEqual(pack().entries.map(entry=>entry.kind),['item']);assert.deepEqual(pack().files,[])
  if(packRefs)assert.equal(item().fields.genreId,null)
  await page.getByRole('button',{name:'新素材包 更多操作',exact:true}).click();await page.getByRole('menuitem',{name:'删除…'}).click()
  await page.getByRole('checkbox',{name:'新物品'}).click();await page.keyboard.press('Escape')
  assert.equal(await page.locator('.ap-select-count').count(),0)
  await page.setViewportSize({width:375,height:850})
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
  assert.equal(await page.locator('select,input[type="range"],input[type="color"]').count(),0)
  assert.deepEqual(errors,[])
  if(!shots)return
  // Screenshot state: three icon packs (全局 / 本卡 / 关), emoji art drawn by the browser, one item selected.
  const emoji=async glyph=>Buffer.from((await page.evaluate(g=>{const c=document.createElement('canvas');c.width=c.height=128;const x=c.getContext('2d');x.font='96px "Segoe UI Emoji"';x.textAlign='center';x.textBaseline='middle';x.fillText(g,64,70);return c.toDataURL('image/png')},glyph)).split(',')[1],'base64')
  const make=async(name,genreRows,items)=>{
    const id=crypto.randomUUID(),entries=[],files=[],rows=[]
    const put=async glyph=>{const stored=await media.put({modId,packId:id,mime:'image/png',data:(await emoji(glyph)).toString('base64')});files.push(stored);return stored.path}
    for(const [key,label,glyph] of genreRows){entries.push({id:'i'+key,kind:'icon',name:label,enabled:true,fields:{},media:{image:await put(glyph)}});rows.push({id:key,label,icon:{modId,packId:id,kind:'icon',entryId:'i'+key}})}
    for(const [key,label,glyph,genreKey,lamp] of items)entries.push({id:key,kind:'item',name:label,enabled:lamp!=='off',recall:{mode:lamp==='constant'?'constant':'keyword',keywords:lamp==='keyword'?[label]:[]},fields:{...(packRefs?{genreId:genreKey}:{}),inventoryId:''},media:{image:await put(glyph)}})
    await registry.saveModPack({modId,pack:{format:'dsh-mod-pack',schemaVersion:1,id,modId,requiresModVersion:'>=1.0.0 <2.0.0',name,fields:{genres:rows},entries,files},expectedRevision:registry.snapshot().revision,mediaVerified:true})
    return id
  }
  await registry.deleteModPack({modId,packId:packId(),confirmed:true,expectedRevision:registry.snapshot().revision})
  const rows=[['weapon','武器','⚔️'],['food','食物','🍙'],['medicine','药品','💊'],['paper','文书','📜'],['jewel','饰品','💍'],['money','货币','🪙'],['key','钥匙','🔑'],['misc','杂物','📦']]
  const general=await make('通用',rows,[])
  const city=await make('中国现代都市',rows,[['phone','手机','📱','misc','constant'],['power','充电宝','🔋','misc','keyword'],['badge','门禁卡','🪪','paper','keyword'],['transit','交通卡','💳','paper','off'],
    ['keys','钥匙串','🔑','key','keyword'],['pill','感冒药','💊','medicine','keyword'],['rice','饭团','🍙','food','keyword'],['receipt','收据','🧾','paper','off'],['cash','现金','💴','money','constant'],['phones','耳机','🎧','misc','keyword'],['umbrella','雨伞','☂️','misc','keyword'],['note','笔记本','📓','paper','keyword']])
  const fantasy=await make('西幻',[['weapon','武器','🗡️']],[['sword','长剑','🗡️','weapon','keyword'],['potion','药水','🧪','weapon','keyword'],['gold','金币袋','💰','weapon','keyword']])
  for(const [id,scope] of [[general,'global'],[city,'card'],[fantasy,'off']])await registry.setModPackScope({modId,packId:id,cardId:'card-a',scope,expectedRevision:registry.snapshot().revision})
  await registry.authorize({modId,allowed:true,expectedRevision:registry.snapshot().revision})
  await registry.setModScope({modId,scope:'global',expectedRevision:registry.snapshot().revision})
  await page.evaluate(()=>localStorage.clear())
  const capture=async(width,name,select)=>{
    await page.setViewportSize({width,height:900});await page.evaluate(w=>mount('card-a',String(w)),name)
    await select()
    await page.waitForFunction(()=>[...document.querySelectorAll('.ap-mod-detail img')].every(img=>img.complete&&img.naturalWidth>0)&&document.querySelectorAll('.ap-mod-detail img').length>10)
    await page.waitForTimeout(400);await page.screenshot({path:path.join(shots,name),fullPage:true})
  }
  const item_=()=>page.getByRole('radio',{name:'充电宝',exact:true}).click()
  const genre_=()=>page.locator('.ap-mod-pack').nth(1).getByRole('button',{name:'药品',exact:true}).click()
  await mkdir(shots,{recursive:true})
  await capture(1280,'mod-page-pc.png',item_);await capture(375,'mod-page-375.png',item_)
  await capture(1280,'mod-genre-pc.png',genre_);await capture(375,'mod-genre-375.png',genre_)
  assert.deepEqual(errors,[])
})
