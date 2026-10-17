// private fork (rename-mod, owner 2026-10): the user-facing widget term is 模组 (display text only; ids stay widgets).
// private fork: real browser decode/budget/refcount/cancellation, no untrusted URL or live data.
import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {chromium} from 'playwright'
import {browserReactScript} from './fixtures/browser-react.mjs'
import {widgetServer} from './fixtures/widget-harness.mjs'
import {syntheticPack} from './fixtures/asset-packs/pack.mjs'
import {stageSource} from './harness/card-centric-stage.mjs'
test('authorized raster projections reject unsafe images, bound four images and release/cancel on suspension and unmount',async t=>{
 const fixture=await syntheticPack(),png=fixture.files.get('media/'+fixture.manifest.assets[0].variants.entries[0].content.media+'.png'),routes=new Map([['good',png],['decode',png.subarray(0,24)],['invalid',Buffer.from('not an image')]])
 for(const [name,w,h] of [['wide',4097,8],['pixels',4001,4000]]){const bytes=Buffer.from(png);bytes.writeUInt32BE(w,16);bytes.writeUInt32BE(h,20);routes.set(name,bytes)}
 let started=false,aborted=false,requests=0
 const origin=await widgetServer(t,{connect(){},serve(req,res){if(!req.url.startsWith('/api/'))return false;requests++;const name=req.url.split('/').at(-1);res.setHeader('Content-Type','image/png');if(name==='slow'){started=true;res.write(png.subarray(0,24));res.on('close',()=>{aborted=true});return true}if(name==='revoked'){res.writeHead(403);res.end();return true}res.end(routes.get(name));return true}},(_req,res)=>{res.end('<!doctype html><div id="root"></div>');return true})
 const browser=await chromium.launch({headless:true,args:['--explicitly-allowed-ports='+new URL(origin).port]});t.after(()=>browser.close());const page=await browser.newPage();await page.goto(origin);await page.addScriptTag({content:await browserReactScript()})
 const ui=(await stageSource()).source.replace('return {App,Home','return {WidgetSettingsForm,App,Home'),phone=JSON.parse(await readFile(new URL('./fixtures/source-widget/widget.json',import.meta.url),'utf8'))
 await page.addScriptTag({content:`const React=modules.react;{${ui}\nwindow.views=createForkAssetPackUI(React);}const declaration=${JSON.stringify(phone)};${await readFile(new URL('../tavern-plugin/src/client/fork-widget-setting-images.js',import.meta.url),'utf8')}
 window.asset=(name,size=${png.length},mime='image/png')=>({identity:name,url:'/api/dsh-asset-library/v2/lease/test/'+name,size,mime});
 function App(){const [assets,setAssets]=React.useState({}),[active,setActive]=React.useState(true),[suspended,setSuspended]=React.useState(false);const items=active?[{identity:'widget',settings:{},definition:{settingAssets:assets},presentation:{suspended}}]:[];useForkWidgetSettingImages(items);window.harness={setAssets,setActive,setSuspended,items,cache:forkWidgetSettingImages};return React.createElement(views.WidgetSettingsForm,{declaration,feedback:{fields:items[0]?.settingsFeedback},onChange(){},onReset(){}});}window.root=modules['react-dom/client'].createRoot(document.getElementById('root'));root.render(React.createElement(App));window.project=forkWidgetRasterImage;`})
 await page.waitForFunction(()=>!!window.harness)
 for(const [name,size,mime,status] of [['wide',png.length,'image/png','image-pixels'],['pixels',png.length,'image/png','image-pixels'],['invalid',12,'image/png','image-format'],['decode',24,'image/png','image-decode'],['good',png.length-1,'image/png','image-bytes'],['good',8388609,'image/png','image-bytes'],['good',png.length,'image/svg+xml','image-format'],['revoked',png.length,'image/png','asset-unavailable']]){
  // private fork (card import r3): the UI calls widgets 模组.
  await page.evaluate(([name,size,mime])=>{harness.setAssets({wallpaper:{...asset(name,size,mime),identity:[name,size,mime].join(':')}})},[name,size,mime]);await page.waitForFunction(status=>harness.items[0].settingsFeedback.wallpaper.status===status,status);assert.equal(await page.evaluate(()=>harness.items[0].settingAssets.wallpaper),null);assert.match(await page.locator('[data-setting-status="'+status+'"]').innerText(),/图片.*；当前显示：模组默认/)
 }
 const before=requests;assert.equal(await page.evaluate(async()=>{try{await project({...asset('good'),url:'https://invalid.example/image.png'},new AbortController().signal)}catch(error){return error.code}}),'asset-unavailable');assert.equal(requests,before)
 await page.evaluate(()=>{window.savedEncode=HTMLCanvasElement.prototype.toDataURL;HTMLCanvasElement.prototype.toDataURL=()=> 'data:image/webp;base64,'+'A'.repeat(1048576);window.closedBitmaps=0;const create=window.createImageBitmap;window.createImageBitmap=async(...args)=>{const bitmap=await create(...args),close=bitmap.close;bitmap.close=()=>{closedBitmaps++;close.call(bitmap)};return bitmap};harness.setAssets({wallpaper:{...asset('good'),identity:'encode-too-large'}})})
 await page.waitForFunction(()=>harness.items[0].settingsFeedback.wallpaper.status==='image-projection');assert.equal(await page.evaluate(()=>closedBitmaps),1);await page.evaluate(()=>{HTMLCanvasElement.prototype.toDataURL=savedEncode})
 const large=await page.evaluate(async()=>{const canvas=document.createElement('canvas');canvas.width=canvas.height=2048;canvas.getContext('2d').fillRect(0,0,2048,2048);return canvas.toDataURL('image/png').split(',')[1]});routes.set('large',Buffer.from(large,'base64'))
 await page.evaluate(size=>harness.setAssets(Object.fromEntries(['a','b','c','d'].map(key=>[key,asset('large',size)]))),routes.get('large').length)
 await page.waitForFunction(()=>Object.values(harness.items[0].settingAssets).filter(Boolean).length===4)
 const values=await page.evaluate(()=>({images:harness.items[0].settingAssets,refs:[...harness.cache.values()].map(entry=>entry.refs)}));assert.deepEqual(values.refs,[4]);assert.ok(Object.values(values.images).every(image=>image.url.length<=1048576));assert.ok(Object.values(values.images).reduce((n,image)=>n+image.url.length,0)<=4194304)
 assert.equal(await page.evaluate(async url=>{const bitmap=await createImageBitmap(await (await fetch(url)).blob());const size=Math.max(bitmap.width,bitmap.height);bitmap.close();return size},values.images.a.url),1536)
 const count=requests;await page.evaluate(size=>harness.setAssets(Object.fromEntries(['a','b','c','d'].map(key=>[key,{...asset('large',size),url:'/api/dsh-asset-library/v2/lease/renewed/large'}]))),routes.get('large').length);await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve)));assert.equal(requests,count,'renewal reuses decoded content')
 await page.evaluate(()=>harness.setSuspended(true));await page.waitForFunction(()=>harness.cache.size===0);assert.deepEqual(await page.evaluate(()=>harness.items[0].settingAssets),{})
 await page.evaluate(()=>{harness.setSuspended(false);harness.setAssets({wallpaper:asset('slow')})});for(let i=0;i<200&&!started;i++)await new Promise(r=>setTimeout(r,5));assert.equal(started,true)
 await page.evaluate(()=>harness.setActive(false));await page.waitForFunction(()=>harness.cache.size===0);for(let i=0;i<100&&!aborted;i++)await new Promise(r=>setTimeout(r,5));assert.equal(aborted,true)
 await page.evaluate(()=>{harness.setActive(true);harness.setAssets({wallpaper:asset('good')})});await page.waitForFunction(()=>harness.items[0]?.settingAssets.wallpaper);await page.evaluate(()=>{window.cache=harness.cache;root.unmount()});assert.equal(await page.evaluate(()=>cache.size),0)
})
