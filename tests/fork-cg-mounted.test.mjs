// private fork: real CG projection/bytes/consumer with a mounted stage; no live data or model.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {chromium} from 'playwright'
import {browserReactScript} from './fixtures/browser-react.mjs'
import {transcriptSource} from './helpers/fork-transcript-perf-ui.mjs'
import {fixture,answer} from './helpers/stage-director-harness.mjs'
import {readStageProjection} from '../tavern-plugin/lib/domain/stage-projection.js'
import {read,shell} from './helpers/mounted-stage-shell.mjs'
import {PACK_ID} from './fixtures/asset-packs/pack.mjs'
import {createCgGallery} from '../tavern-plugin/lib/fork-cg-gallery.js'
import {createCardStorage} from '../tavern-plugin/lib/fork-card-storage.js'
test('mounted CG loads selected image, preserves dialogue/base scene, gates face, resizes and hides without remounting',async t=>{
  const ref={packId:PACK_ID,kind:'cg',assetId:'rice'},direction=structuredClone(answer);
  direction.beats[0].ops.push({op:'cg.set',cg:ref});direction.beats[1].ops.push({op:'cg.clear'});
  const f=await fixture(request=>request.onToolCall({name:'stage_update',arguments:direction}));t.after(()=>f.dispose());
  const pack=await f.services.get('assetLibrary').getPackSnapshot({packId:PACK_ID});
  pack.manifest.assets.push({kind:'cg',id:'rice',name:'Rice',enabled:true,directorNote:'Eating rice',recall:{mode:'constant',keywords:[]},variants:{default:'base',entries:[{id:'base',name:'Base',content:{description:'Eating',media:pack.manifest.assets[0].variants.entries[0].content.media,focusHints:[]}}]}});
  pack.manifest.assets.at(-1).variants.entries.push({...pack.manifest.assets.at(-1).variants.entries[0],id:'turn',name:'Turn'});
  pack.manifest.assets.push({...structuredClone(pack.manifest.assets.at(-1)),id:'locked',name:'Secret locked title'});
  const data=new Map(),acks=[];
  const gallery=createCgGallery({profileData:{readJson:async key=>data.get(key),writeJson:async(key,value)=>data.set(key,value)},cardStorage:createCardStorage({dataRoot:'C:/synthetic'}),resolveCard:async()=>f.workspace.meta.id,chatForSession:async()=>f.read(),assets:f.assets,readDirection:(chat,turn)=>f.director.get(chat,turn,null,{readOnly:true}),readSettings:()=>f.engineSettings.read()});
  const browser=await chromium.launch({channel:'chrome',headless:true,args:['--mute-audio']});t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.exposeFunction('hostDirection',args=>f.director.get(f.read(),args.turn,null,args));
  await page.exposeFunction('hostCgRpc',async(method,args,sessionId)=>{if(method==='getCgGallery')return gallery.list({...args,sessionId},'http://localhost');if(method==='ackCgPlayed'){acks.push(args);return gallery.ack({...args,sessionId},'http://localhost');}return {};});
  await page.exposeFunction('hostLease',args=>f.services.get('assetLibrary').leaseMedia(args));
  await page.exposeFunction('hostProjection',args=>gallery.project(args,()=>readStageProjection({...args,revision:()=>f.assets.revision,readSettings:()=>f.engineSettings.read(),readConsumer:()=>f.assets.consumer(f.read(),'http://localhost'),readDirection:()=>f.director.get(f.read(),args.turn,null,{readOnly:true})})));
  const stop=f.signals.subscribe('session','stage-direction',()=>{void page.evaluate(()=>window.wakeDirection?.()).catch(()=>{})});t.after(stop);
  await page.route('https://cg.test/**',route=>route.fulfill({contentType:'text/html',body:'<style>body{margin:0}</style>'}));await page.goto('https://cg.test/');
  await page.addStyleTag({content:fs.readFileSync(new URL('../tavern-plugin/lib/client-assets/fork-theme.css',import.meta.url),'utf8')});
  await page.addScriptTag({content:await browserReactScript()+'\nconst React=modules.react,ReactDOM={...modules["react-dom"],...modules["react-dom/client"]};\n'+transcriptSource(read).replaceAll("'offline'","'session'").replace('const rpc = async () => {','const rpc = async (...args) => { if (["getCgGallery","ackCgPlayed"].includes(args[0])) return hostCgRpc(...args);')
    // private fork (owner 2026-10): the shell stubs the system menu; this test only needs its 回想 item (onGallery).
    +shell.replace('ForkGalMenu=()=>null','ForkGalMenu=p=>React.createElement("div",{role:"menu"},React.createElement("button",{type:"button",role:"menuitem",onClick:p.onGallery},"回想"))')});
  assert.ok(shell.includes('ForkGalMenu=()=>null'),'menu stub replaced');
  await f.director.get(f.read(),1);await f.director.drain();
  await page.waitForFunction(()=>stageProbe.state().accepted.cg?.media.url && document.querySelector('.fork-cg-stage img:nth-of-type(2)')?.naturalWidth>0);
  assert.equal(await page.locator('.fork-gal-box.has-face').count(),0);
  assert.equal(await page.locator('.fork-performance-over').evaluate(el=>getComputedStyle(el).zIndex),'1','stage-space decorations stay underneath CG');
  assert.equal(await page.locator('.fork-gal-text').count(),1);
  assert.ok(await page.evaluate(()=>stageProbe.state().accepted.scene.backgroundUrl));
  assert.equal(await page.evaluate(()=>stageProbe.state().accepted.scene.cg),undefined);
  await page.waitForFunction(()=>getComputedStyle(document.querySelector('.fork-cg-stage')).opacity==='1');
  await page.waitForFunction(()=>document.querySelector('.fork-cg-stage')?.style.opacity==='1');
  await assert.doesNotReject(async()=>{for(let i=0;i<50&&!data.size;i++)await new Promise(r=>setTimeout(r,20));assert.equal(data.size,1)});
  assert.equal(acks[0].receipt.page.index,0,'receipt comes from host canonical projection');
  const before=await page.evaluate(()=>JSON.stringify({cursor:stageProbe.state().cursor,cg:stageProbe.state().accepted.cg}));
  for(const theme of ['classic','gothic','magical']) {
    await page.evaluate(theme=>document.querySelector('.fork-gal-stage').dataset.theme=theme,theme);
    // private fork: magical theme has an intentional idle sway; keyboard activation remains stable.
    // private fork (owner 2026-10): 回想 is an item of the system menu (Esc), no longer a control-row button.
    assert.equal(await page.locator('.fork-gal-controls').getByRole('button',{name:'回想'}).count(),0);
    // private fork: the ≡ toolbar button opens the same menu (keyboard Enter on it must not also turn the page).
    if (theme==='gothic') {await page.locator('.fork-gal-controls').getByRole('button',{name:'菜单',exact:true}).focus();await page.keyboard.press('Enter');}
    else await page.keyboard.press('Escape');
    await page.getByRole('menuitem',{name:'回想',exact:true}).focus();
    await page.keyboard.press('Enter');
    await page.getByRole('dialog',{name:'回想'}).waitFor();
    await page.getByRole('button',{name:'Rice',exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'尚未解锁',exact:true}).locator('img').count(),0);
    assert.equal(await page.getByText('Secret locked title').count(),0);
    await page.waitForFunction(()=>document.querySelector('.fork-cg-gallery-cell img:nth-of-type(2)')?.naturalWidth>0);
    await page.getByRole('button',{name:'Rice',exact:true}).click();
    await page.getByRole('button',{name:'Turn',exact:true}).click();
    assert.equal(await page.getByRole('button',{name:'Turn',exact:true}).getAttribute('aria-pressed'),'true');
    await page.getByRole('button',{name:'隐藏控件'}).click();
    await page.keyboard.press('Escape');await page.getByRole('button',{name:'返回图库'}).waitFor();
    await page.keyboard.press('Escape');await page.getByRole('button',{name:'Rice',exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Rice',exact:true}).evaluate(el=>el===document.activeElement),true,'viewer restores its grid cell focus');
    await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog',{name:'回想'}).count(),0);
  }
  assert.equal(await page.evaluate(()=>JSON.stringify({cursor:stageProbe.state().cursor,cg:stageProbe.state().accepted.cg})),before,'gallery does not write stage state');
  assert.equal(data.get('stage/cg-gallery/card-a.json').unlocked.length,1,'preview cannot unlock the other CG');
  await page.setViewportSize({width:430,height:900});
  await page.waitForFunction(()=>document.querySelector('.fork-cg-stage').clientWidth===430);
  assert.equal(await page.locator('.fork-cg-stage img:nth-of-type(2)').evaluate(el=>getComputedStyle(el).objectFit),'contain');
  await page.evaluate(()=>stageProbe.page(1));
  await page.waitForFunction(()=>!stageProbe.state().accepted.cg && getComputedStyle(document.querySelector('.fork-cg-stage')).display==='none');
  assert.equal(await page.locator('.fork-gal-box.has-face').count(),1);
  assert.deepEqual(await page.evaluate(()=>stageProbe.stats()),{mounts:1,unmounts:0});
  assert.deepEqual(errors,[]);await page.evaluate(()=>stageProbe.dispose());
});
