// private fork: real figure editor, metadata-only snapshots, and network/DOM identity checks.
import test from 'node:test'
import assert from 'node:assert/strict'
import {chromium} from 'playwright'
import {browserReactScript} from './fixtures/browser-react.mjs'
import {forkThemeCss} from './helpers/fork-theme-css.mjs'
import {stageSource} from './harness/card-centric-stage.mjs'
import {syntheticPack,PACK_ID,FIGURE_ID} from './fixtures/asset-packs/pack.mjs'

for (const kind of ['sprite','live2d']) test(`figure and outfit lamps preserve ${kind} images`,async t=>{
  const fixture=await syntheticPack(),{files,...pack}=fixture;pack.revision='r1'
  const figure=pack.figures[FIGURE_ID];delete figure.voice
  if(kind==='live2d') { figure.outfits.reverse();delete figure.outfits[0].sprite;delete figure.outfits[0].avatars }
  const {source,playback}=await stageSource()
  const browser=await chromium.launch({headless:true});t.after(()=>browser.close())
  const page=await browser.newPage({viewport:{width:1400,height:1200}}),requests=[],errors=[]
  page.setDefaultTimeout(5000)
  page.on('request',r=>{if(r.resourceType()==='image')requests.push(r.url())});page.on('pageerror',e=>errors.push(e.message))
  await page.route('http://lamp.test/**',route=>{
    const url=new URL(route.request().url())
    if(url.pathname==='/')return route.fulfill({contentType:'text/html',body:'<!doctype html><div id="root"></div>'})
    const image=files.get([...files.keys()].find(p=>p.startsWith('media/')&&p.endsWith('.png')))
    return route.fulfill({contentType:'image/png',body:image,headers:{'cache-control':'no-store'}})
  })
  await page.goto('http://lamp.test/')
  await page.addStyleTag({content:await forkThemeCss()})
  await page.addScriptTag({content:await browserReactScript()+';window.React=modules.react;window.ReactDOM=modules["react-dom/client"];'+playback+source})
  await page.evaluate(({pack,packId,figureId})=>{
    const clone=v=>structuredClone(v),h=React.createElement,listeners=new Set();let rev=1
    window.saved=0;window.opens=0;window.shots=0
    const binding={service:{subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn)},getPackSnapshot:async()=>clone(pack),
      patchFigure:async({patch})=>{Object.assign(pack.figures[figureId],clone(patch));pack.revision='r'+(++rev);listeners.forEach(fn=>fn({packId,revision:pack.revision}));window.saved++;return {snapshot:clone(pack)}},
      leaseBundle:async()=>{window.opens++;return {ticket:'ticket'+opens,url:'/model/'+opens}},releaseLease(){}},
      previewMedia:async({hash})=>({url:'/media/'+hash,release(){}}),rpc:async()=>({core:'/core.js'})}
    // The model adapter records opens; the real editor and its snapshot hooks own their identities.
    const cache=new Map(),live2d={Preview:({source})=>{React.useEffect(()=>{source.open().then(x=>{window.preview=x.url})},[source.identity]);return h('canvas')},snapshots:{
      peek:(identity,names,frame)=>Object.fromEntries(names.filter(n=>cache.has(identity+frame+n)).map(n=>[n,cache.get(identity+frame+n)])),
      request:async(source,names,frame)=>{await source.open();window.shots++;const values=Object.fromEntries(names.map(n=>[n,'/shots/'+window.shots+'/'+frame+'/'+n]));for(const [n,url]of Object.entries(values))cache.set(source.identity+frame+n,url);return values}}}
    const views=createForkAssetPackUI(React,{live2d,emotions:{moods:[{id:'calm',label:'Calm'},{id:'joy',label:'Joy'},{id:'crying',label:'Crying'}]}})
    ReactDOM.createRoot(document.getElementById('root')).render(h(views.PackModal,{binding,packId,initial:{kind:'figures',figureId},packs:[pack],onClose(){}}))
    window.replaceImage=async()=>{const f=pack.figures[figureId];if(f.outfits[0].live2d)pack.manifest.bundles[f.outfits[0].live2d.bundleKey].contentHash='changed-bundle-hash';else f.outfits[0].sprite.assets['assets/stage.png']='changed-hash';pack.revision='r'+(++rev);listeners.forEach(fn=>fn({packId,revision:pack.revision}))}
  },{pack,packId:PACK_ID,figureId:FIGURE_ID})
  await page.waitForSelector('.ap-figure-editor img');await page.waitForTimeout(300)
  await page.waitForFunction(()=>[...document.querySelectorAll('.ap-figure-editor img')].every(n=>n.complete&&n.naturalWidth))
  for(const label of ['人物灯','服装触发策略'])for(const mode of ['绿灯','关闭','蓝灯']){
    const before=requests.length,counts=await page.evaluate(()=>({opens,shots,saved}))
    await page.evaluate(()=>{window.images=[...document.querySelectorAll('.ap-pack-modal img')];window.removed=[];window.observer=new MutationObserver(records=>{for(const r of records)for(const node of r.removedNodes)for(const img of images)if(node===img||node.contains?.(img))removed.push(img.src)});observer.observe(document.querySelector('.ap-pack-modal'),{childList:true,subtree:true})})
    // private fork (figure-editor r7): an outfit's lamp is its tile's dot, which opens 蓝灯 / 绿灯 / 关闭.
    if(label==='服装触发策略'){await page.locator('.ap-outfit-lamp-button').first().click();await page.getByRole('menuitemradio',{name:mode,exact:true}).click()}
    else{await page.locator('.ap-figure-lamp-slot button[aria-haspopup=menu]').click();await page.getByRole('menuitemradio',{name:mode,exact:true}).click()} // private fork (UI standard phase 2 batch 6): the 人物灯 is the one LampMenu
    await page.waitForFunction(n=>saved>n,counts.saved);await page.waitForTimeout(100)
    const result=await page.evaluate(()=>{observer.disconnect();return {same:images.every(n=>n.isConnected),removed,opens,shots}})
    assert.deepEqual(errors,[])
    assert.equal(requests.length-before,0,`${label}/${mode}: ${requests.slice(before)}`)
    assert.equal(result.same,true);assert.deepEqual(result.removed,[])
    assert.equal(result.opens,counts.opens);assert.equal(result.shots,counts.shots)
  }
  assert.ok(await page.locator('.ap-figure-editor img').count()>=4)
  const before=requests.length,opens=await page.evaluate(()=>window.opens)
  await page.evaluate(()=>replaceImage())
  if(kind==='sprite')await page.waitForFunction(()=>[...document.images].some(n=>n.src.includes('changed-hash')))
  else await page.waitForFunction(n=>window.opens>n,opens)
  await page.waitForTimeout(100)
  assert.ok(requests.length>before,'replacing media still loads the changed content')
})
