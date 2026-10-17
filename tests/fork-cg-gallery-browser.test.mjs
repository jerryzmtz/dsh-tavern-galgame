// private fork: independent review probe promoted to a real-CSS/IntersectionObserver regression.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {chromium} from 'playwright'
import {browserReactScript} from './fixtures/browser-react.mjs'
const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8')
test('unlocked thumbnails decode near the viewport and release pins/images offscreen and on close',async t=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});t.after(()=>browser.close())
  const page=await browser.newPage({viewport:{width:600,height:600}}),errors=[];page.on('pageerror',e=>errors.push(e.message))
  await page.setContent('<div id="app"></div>')
  await page.addStyleTag({content:read('tavern-plugin/lib/client-assets/fork-theme.css')+'#scroll{height:400px;overflow:auto;width:400px}.tile{height:240px}'})
  await page.addScriptTag({content:await browserReactScript()+`
const React=modules.react,ReactDOM={...modules['react-dom'],...modules['react-dom/client']};
let pins=0,prepared=0,released=0,maxPins=0,blocked=false,pending=[];
const forkForeground={now:()=>performance.now(),isForeground:()=>true,requestAnimationFrame:f=>requestAnimationFrame(f),cancelAnimationFrame:i=>cancelAnimationFrame(i)};
const url='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
const forkStageSessions={resourceOwner:{async prepare(image){prepared++;if(blocked)await new Promise(r=>pending.push(r));pins++;maxPins=Math.max(maxPins,pins);let active=true;return {value:{...image,media:{identity:image.ref.assetId,url}},release(){if(active){active=false;pins--;released++;}}};}}};
`+read('tavern-plugin/src/client/fork-cg-consumer.cjs')+'\n'+read('tavern-plugin/src/client/fork-cg-stage.js').split('// @include fork-cg-gallery.js')[0]+'\n'+read('tavern-plugin/src/client/fork-cg-gallery.js').split('function ForkCgGallery({')[0]+`
const root=ReactDOM.createRoot(document.querySelector('#app'));
const images=Array.from({length:60},(_,i)=>({ref:{packId:'pack',kind:'cg',assetId:'cg'+i},label:'CG '+i,focus:{x:0.5,y:0.5,zoom:1}}));
root.render(React.createElement('div',{id:'scroll'},images.map((image,i)=>React.createElement('div',{className:'tile',key:i},React.createElement(ForkCgGalleryImage,{image,authority:'session',thumb:true})))));
window.stats=()=>({pins,prepared,released,maxPins});window.cleanup=()=>root.unmount();
window.block=()=>{blocked=true};window.finish=()=>{blocked=false;pending.splice(0).forEach(r=>r())};
`})
  await page.waitForFunction(()=>document.querySelector('.tile img:nth-of-type(2)')?.naturalWidth>0)
  let stats=await page.evaluate(()=>stats());assert.ok(stats.prepared>0&&stats.prepared<=3,JSON.stringify(stats))
  assert.equal(await page.locator('.tile').nth(59).locator('img[src]').count(),0,'offscreen images are not requested')
  for(let i=1;i<60;i++){
    await page.evaluate(i=>{document.querySelector('#scroll').scrollTop=i*240},i)
    await page.waitForTimeout(35)
  }
  await page.waitForFunction(()=>stats().pins<=3&&stats().released>50)
  stats=await page.evaluate(()=>stats());assert.ok(stats.prepared>=55,JSON.stringify(stats));assert.ok(stats.maxPins<=4,JSON.stringify(stats))
  assert.equal(await page.locator('.tile').first().locator('img[src]').count(),0,'offscreen DOM no longer retains decoded image URLs')
  // A late preparation must release after both viewport departure and component disposal.
  await page.evaluate(()=>{block();document.querySelector('#scroll').scrollTop=0})
  await page.waitForTimeout(100)
  await page.evaluate(()=>{cleanup();finish()})
  await page.waitForFunction(()=>stats().pins===0)
  assert.equal((await page.evaluate(()=>stats())).released,(await page.evaluate(()=>stats())).prepared)
  assert.deepEqual(errors,[])
})

// private fork: actual decoded DOM + ResizeObserver, with clock callbacks held until explicitly flushed.
test('ResizeObserver cannot acknowledge a decoded snap before two displayed clock frames',async t=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});t.after(()=>browser.close())
  const page=await browser.newPage({viewport:{width:600,height:600}})
  await page.setContent('<div class="fork-cg-gallery-picture" style="height:400px"><div class="fork-cg-stage"><img><img></div></div>')
  await page.addStyleTag({content:read('tavern-plugin/lib/client-assets/fork-theme.css')})
  await page.addScriptTag({content:read('tavern-plugin/src/client/fork-cg-consumer.cjs')+'\n'+read('tavern-plugin/src/client/fork-cg-stage.js').split('// @include fork-cg-gallery.js')[0]})
  await page.evaluate(async()=>{
    const url='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='
    const image=new Image();image.src=url;await image.decode()
    let played=0,serial=0,executed=0,resizes=0;const queued=new Map(),element=document.querySelector('.fork-cg-stage')
    const clock={now:()=>performance.now(),isForeground:()=>true,requestAnimationFrame:fn=>{queued.set(++serial,fn);return serial},cancelAnimationFrame:id=>queued.delete(id)}
    const consumer=createForkCgConsumer({clock,onFrame:frame=>forkCgPaintFrame(element,frame),onPlayed:()=>played++})
    const resize=new ResizeObserver(()=>{resizes++;consumer.redraw()});resize.observe(element)
    const value={ref:{packId:'pack',kind:'cg',assetId:'rice'},variant:'base',focus:{x:0.5,y:0.5,zoom:1},media:{identity:'rice',url}}
    await consumer.present(value,{snap:true,provenance:{visitId:1}});consumer.redraw()
    window.paintStats=()=>({played,requested:serial,executed,resizes})
    window.paintFrame=()=>new Promise(resolve=>requestAnimationFrame(()=>{const tasks=[...queued.values()];queued.clear();for(const fn of tasks){executed++;fn()}resolve()}))
    window.fastSkip=()=>{void consumer.present(value,{snap:true,provenance:{visitId:2}});consumer.redraw();void consumer.present(null,{snap:true});consumer.dispose();resize.disconnect()}
  })
  // Wait for real observer delivery, not a wall-clock sleep that races under the full suite.
  await page.waitForFunction(()=>paintStats().resizes>0&&document.querySelector('.fork-cg-stage img:nth-of-type(2)').naturalWidth>0)
  await page.evaluate(()=>document.querySelector('.fork-cg-stage img:nth-of-type(2)').decode())
  const before=await page.evaluate(()=>paintStats())
  assert.equal(before.played,0);assert.equal(before.requested,1);assert.equal(before.executed,0)
  await page.evaluate(()=>paintFrame());assert.equal((await page.evaluate(()=>paintStats())).played,0)
  await page.evaluate(()=>paintFrame());const after=await page.evaluate(()=>paintStats());assert.equal(after.played,1,JSON.stringify(after))
  await page.evaluate(()=>fastSkip());await page.evaluate(()=>paintFrame())
  assert.equal((await page.evaluate(()=>paintStats())).played,1,'rapid page replacement/disposal has no acknowledgement')
})
