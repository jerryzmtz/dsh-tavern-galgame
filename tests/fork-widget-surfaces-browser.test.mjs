// private fork: chromeless widget windows (owner 2026-10, "无感") — no painted host chrome, invisible hit areas that leave
// the screen to the widget, an opaque galgame context menu (pointer, touch sheet, keyboard) and the motion boundaries,
// using the production layer and panel.
import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {chromium} from 'playwright'
import {browserReactScript} from './fixtures/browser-react.mjs'
import surfaces from '../tavern-plugin/src/client/fork-surfaces.cjs'
const read = name => readFile(new URL('../tavern-plugin/'+name,import.meta.url),'utf8')

test('chromeless widget windows paint no host chrome, keep the screen interactive and open one opaque menu',async t=>{
  const browser=await chromium.launch({headless:true});t.after(()=>browser.close())
  const theme=await read('lib/client-assets/fork-theme.css'),code=await read('src/client/fork-gal-widgets.js')
  for (const context of ['stage-classic','stage-gothic','stage-magical']) for (const touch of [false,true]) {
    const page=await browser.newPage({viewport:{width:touch?390:900,height:800},hasTouch:touch,isMobile:touch})
    const errors=[];page.on('pageerror',error=>errors.push(error.message))
    await page.setContent('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+theme+'\n'+surfaces.css()+`body{margin:0}#busy{position:fixed;inset:0;background:white;color:black;font:24px monospace;word-break:break-all}.fork-gal-stage{position:relative;width:100vw;height:100vh}#menu{position:absolute;left:50px;top:520px}.fork-widget-menu-list{position:relative;top:0;left:0}</style><body data-fk-context="${context}"><div id="busy">${'BUSY '.repeat(500)}</div><main class="fork-gal-stage" data-fk-context="${context}" data-theme="${context.slice(6)}"><div id="root"></div><div id="menu" class="fork-widget-menu"><div class="fork-widget-menu-list"><button>Read message</button></div></div></main></body>`)
    await page.addScriptTag({content:await browserReactScript()})
    await page.addScriptTag({content:`const React=modules.react;${code}
      window.calls=[];
      const base={key:'test',identity:'test',bounds:{x:40,y:60,width:280,height:180},placed:true,definition:{title:'Device',document:{presentation:{open:{width:280,height:180},compact:{width:280,height:44}}}},sourceOnly:true,source:{historyStatus:'limited'},requestedState:'open',presentation:{state:'open',surface:'stage',bounds:{width:280,height:180},attention:{count:0},pinned:false,transitionMs:160,reducedMotion:false}};
      const owner={paused:false,narrow:false,portrait:false,viewport:{x:0,y:0,width:innerWidth,height:innerHeight},action(key,type){calls.push(['action',type])},place(key,view,point){calls.push(['place',view,point])},clampPlace:(key,point)=>point,onReady(){},onFailure(){}};
      let set;window.animations=[];const animate=Element.prototype.animate;Element.prototype.animate=function(frames,options){const animation=animate.call(this,frames,options);window.animations.push({frames,options,animation});return animation;};
      function App(){const [item,update]=React.useState(base);set=update;return React.createElement(ForkGalWidgets,{owner:{...owner,items:[item]},onBacklog(){}});}
      window.change=(patch,extra={})=>set(item=>({...item,...extra,presentation:{...item.presentation,...patch}}));
      window.generic=()=>set(item=>({...item,definition:{...item.definition,document:{presentation:{open:base.definition.document.presentation.open}}},presentation:{...item.presentation,state:'compact',surface:'stage'}}));
      modules['react-dom/client'].createRoot(document.querySelector('#root')).render(React.createElement(App));`})
    await page.locator('#root iframe, #root .fork-widget-panel').first().waitFor()
    const panel=page.locator('.fork-widget-panel'),label=context+'/'+touch
    // No painted chrome: no surface, caption, header or tool buttons; the hit areas are transparent.
    assert.equal(await panel.evaluate(el=>getComputedStyle(el).backgroundColor),'rgba(0, 0, 0, 0)','device has no box-in-box panel')
    assert.equal(await panel.locator('header,.fork-widget-caption,.fork-widget-tools,.fork-widget-tool').count(),0,label)
    assert.equal(await page.locator('.fork-widget-grip.is-ring').count(),4)
    for (const style of await page.locator('.fork-widget-grip').evaluateAll(nodes=>nodes.map(node=>{const s=getComputedStyle(node);return [s.backgroundColor,s.backgroundImage,s.boxShadow,s.borderTopStyle,s.outlineStyle]})))
      assert.deepEqual(style,['rgba(0, 0, 0, 0)','none','none','none','none'],label+' grip paint')
    // The ring sits on the edge only: the widget keeps its screen (here: a point 12px inside every edge and the centre).
    const box=await panel.boundingBox()
    for (const [x,y] of [[box.x+box.width/2,box.y+box.height/2],[box.x+box.width/2,box.y+12],[box.x+12,box.y+box.height/2],[box.x+box.width-12,box.y+box.height/2],[box.x+20,box.y+box.height-14]])
      assert.equal(await page.evaluate(([x,y])=>document.elementFromPoint(x,y).className,[x,y]),'fork-widget-panel-body',label+' screen at '+[x-box.x,y-box.y])
    // Focus: no ring at rest or after a pointer press; a keyboard focus shows it; Shift+F10 opens the menu.
    assert.equal(await panel.evaluate(el=>getComputedStyle(el).outlineStyle),'none')
    await page.keyboard.press('Tab');await page.waitForFunction(()=>document.activeElement?.classList.contains('fork-widget-panel'))
    assert.notEqual(await panel.evaluate(el=>getComputedStyle(el).outlineStyle),'none','keyboard focus ring')
    await page.keyboard.press('ArrowLeft');assert.deepEqual(await page.evaluate(()=>calls.at(-1)),['place','open',{x:30,y:60}])
    await page.keyboard.press('Shift+F10');await page.locator('.fork-widget-context').waitFor()
    assert.deepEqual((await page.locator('.fork-widget-context [role^=menuitem]').allInnerTexts()).map(text=>text.split('\n')[0]),['收起','固定','复位位置','关闭'])
    assert.equal(await page.evaluate(()=>document.activeElement.textContent.startsWith('收起')),true,'menu takes focus')
    await page.keyboard.press('ArrowDown');assert.equal(await page.evaluate(()=>document.activeElement.getAttribute('role')),'menuitemcheckbox')
    await page.keyboard.press('Escape');await page.locator('.fork-widget-context').waitFor({state:'detached'})
    assert.equal(await page.evaluate(()=>document.activeElement?.classList.contains('fork-widget-panel')),true,'Esc returns focus')
    // Pointer (or touch hold) opens the menu; its card, the topbar list and the notice chip never let text through.
    if (touch) {
      const cdp=await page.context().newCDPSession(page);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:box.x+box.width/2,y:box.y+2}]})
      await page.waitForTimeout(700);await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach()
      await page.locator('.fork-widget-context.is-sheet').waitFor()
    } else {await page.mouse.click(box.x+box.width/2,box.y+2,{button:'right'});await page.locator('.fork-widget-context').waitFor()}
    await page.waitForTimeout(250)
    assert.equal(await page.evaluate(()=>calls.filter(call=>call[0]==='action').length),0,'opening the menu never acts')
    for (const selector of ['.fork-widget-context','.fork-widget-chip','.fork-widget-menu-list']) {
      const el=page.locator(selector).first(),rect=await el.boundingBox(),clip={x:rect.x+14,y:rect.y+Math.max(16,rect.height-20),width:Math.max(1,rect.width-28),height:8}
      const before=await page.screenshot({clip})
      await page.locator('#busy').evaluate(el=>{el.style.background=el.style.background==='black'?'white':'black';el.style.color='red';el.textContent='WWWW'.repeat(500)})
      assert.deepEqual(await page.screenshot({clip}),before,label+'/'+selector+' bleed')
    }
    if (touch) await page.touchscreen.tap(195,30);else await page.mouse.click(600,30)
    await page.locator('.fork-widget-context').waitFor({state:'detached'})
    assert.equal(await page.evaluate(()=>calls.filter(call=>call[0]==='action').length),0,'dismissing the menu never acts')
    await page.evaluate(()=>change({state:'compact'},{requestedState:'compact'}));await page.waitForFunction(()=>animations.length>0)
    assert.deepEqual(await page.evaluate(()=>animations.at(-1).frames),[{transform:'translateY(4px)'},{transform:'translateY(0)'}])
    await page.evaluate(()=>{for(const row of animations)row.animation.finish()})
    // Compact: one cover; a tap opens.
    assert.equal(await page.locator('.fork-widget-grip.is-cover').count(),1)
    const compact=await panel.boundingBox()
    if (touch) await page.touchscreen.tap(compact.x+compact.width/2,compact.y+compact.height/2);else await page.mouse.click(compact.x+compact.width/2,compact.y+compact.height/2)
    assert.deepEqual(await page.evaluate(()=>calls.at(-1)),['action','open'])
    await page.emulateMedia({reducedMotion:'reduce'})
    const count=await page.evaluate(()=>animations.length)
    await page.evaluate(()=>change({state:'open',surface:'sheet',reducedMotion:true},{fill:true,bounds:{x:0,y:0,width:innerWidth,height:innerHeight},placed:false}))
    await page.waitForFunction(()=>document.querySelector('.fork-widget-panel').classList.contains('is-fill'))
    await page.waitForTimeout(200)
    assert.equal(await page.evaluate(()=>animations.length),count,'reduced motion must snap, not fade text')
    assert.equal(await page.locator('.fork-widget-layer').evaluate(el=>getComputedStyle(el).pointerEvents),'auto')
    assert.equal(await panel.evaluate(el=>getComputedStyle(el).opacity),'1')
    assert.deepEqual(await panel.evaluate(el=>{const r=el.getBoundingClientRect();return [r.x,r.y,r.width,r.height]}),[0,0,touch?390:900,800],'full-bleed sheet fills the reading area')
    assert.equal(await page.locator('.fork-widget-grip').count(),1);assert.equal(await page.locator('.fork-widget-grip.is-edge').count(),1)
    await page.evaluate(()=>generic())
    await page.waitForFunction(()=>document.querySelector('.fork-widget-panel').classList.contains('is-chip'))
    const chip=page.locator('.fork-widget-panel'),chipBox=await chip.boundingBox()
    const clip={x:chipBox.x+22,y:chipBox.y+12,width:chipBox.width-44,height:20},before=await page.screenshot({clip})
    await page.locator('#busy').evaluate(el=>{el.style.background='lime';el.style.color='blue'})
    assert.deepEqual(await page.screenshot({clip}),before,'generic chip retains its solid underlay')
    assert.deepEqual(errors,[])
    await page.close()
  }
})
