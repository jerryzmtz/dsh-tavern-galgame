// private fork: real Pixi renderer, local PNGs, no live host or model requests.
import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {chromium} from 'playwright'
const root=new URL('../tavern-plugin/',import.meta.url)
async function source(name){
  let text=await readFile(new URL('src/client/'+name,root),'utf8')
  const bridge=text.match(/module\.exports = require\('\.\.\/\.\.\/packages\/dsh-presentation-protocol\/src\/([^']+)'\)/)
  if(bridge)text=await readFile(new URL('packages/dsh-presentation-protocol/src/'+bridge[1],root),'utf8')
  for(const match of [...text.matchAll(/^\s*\/\/ @include(-protocol)? (\S+)\s*$/gm)])text=text.replace(match[0],match[1]?
    await readFile(new URL('packages/dsh-presentation-protocol/src/'+match[2],root),'utf8'):await source(match[2]))
  return text
}

test('historical renderer reveals background and ready figure without a whole-frame load barrier',{timeout:30000},async t=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});t.after(()=>browser.close())
  const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message))
  let unblock;const blocked=new Promise(resolve=>{unblock=resolve});t.after(unblock)
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aLFcAAAAASUVORK5CYII=','base64')
  await page.route('http://renderer.test/**',async route=>{
    const pathname=new URL(route.request().url()).pathname
    if(pathname.startsWith('/api/dsh-tavern/vendor/'))return route.fulfill({contentType:'text/javascript',body:await readFile(new URL('lib/vendor/'+pathname.split('/vendor/')[1],root))})
    if(pathname==='/slow.png')await blocked
    if(pathname.endsWith('.png'))return route.fulfill({contentType:'image/png',body:png})
    return route.fulfill({contentType:'text/html',body:'<style>#host{position:fixed;inset:0}</style><div id="host"></div>'})
  })
  await page.goto('http://renderer.test/')
  // private fork: include the extracted empty-paint contract used by the renderer.
  const files=['fork-foreground.js','fork-stage-empty.js','fork-figure-scale.cjs','fork-figure-measure.js','fork-stage-light.cjs','fork-gal-motion.js','fork-live2d.js','fork-gal-scene.js','fork-gal-effects.js']
  await page.addScriptTag({content:`window.React={useSyncExternalStore:(_s,g)=>g()};const forkStageReading={get:()=>({frameCap:60})};\n`+(await Promise.all(files.map(source))).join('\n;\n')})
  await page.evaluate(async()=>{
    await forkLoadPixiRuntime()
    window.scene=forkGalCreateScene(document.getElementById('host'),{quality:'high'})
    scene.set(window.plan={visit:1,snap:true,quality:'high',background:{identity:'background',url:'/background.png',transition:'cut'},
      figures:[{key:'left',alias:'left',kind:'static',src:'/ready.png',x:1/3,visible:true,enter:'soft'},
        {key:'right',alias:'right',kind:'static',src:'/slow.png',x:2/3,visible:true,enter:'soft'}],effects:[],preload:[]})
  })
  await page.waitForFunction(()=>scene.debug.stats().layers.some(layer=>layer.url)&&scene.debug.stats().figures.some(figure=>figure.key==='left'&&figure.ready))
  const during=await page.evaluate(()=>({visible:scene.layers.world.visible,stats:scene.debug.stats(),error:scene.debug.error()}))
  assert.equal(during.visible,true,'background is not hidden by a pending historical figure')
  assert.equal(during.stats.figures.find(figure=>figure.key==='right').ready,false)
  assert.equal(during.error,'')
  // private fork: a CG hides the entire layer, even when a pending figure arrives underneath it.
  await page.evaluate(()=>scene.set(window.plan={...plan,hideFigures:true}))
  await page.waitForFunction(()=>!scene.layers.figures.visible && !scene.layers.emotes.visible)
  unblock()
  await page.waitForFunction(()=>scene.debug.stats().figures.every(figure=>figure.ready))
  assert.equal(await page.evaluate(()=>scene.layers.figures.visible),false) // private fork
  await page.evaluate(()=>scene.set(window.plan={...plan,figures:plan.figures.filter(f=>f.key==='right')}))
  await page.waitForFunction(()=>scene.debug.stats().figures.length===1)
  assert.equal(await page.evaluate(()=>scene.layers.figures.visible),false) // private fork
  await page.evaluate(()=>scene.set({...plan,hideFigures:false}))
  await page.waitForFunction(()=>scene.layers.figures.visible && scene.layers.emotes.visible)
  assert.deepEqual(await page.evaluate(()=>scene.debug.stats().figures.map(f=>f.key)),['right']) // private fork
  assert.deepEqual(errors,[])
  await page.evaluate(()=>scene.destroy())
})
