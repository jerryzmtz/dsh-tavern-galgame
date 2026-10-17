// private fork: production overlay components and stage wheel handler, real browser bubbling/scrolling.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {chromium} from 'playwright'
import {browserReactScript} from './fixtures/browser-react.mjs'
const read = name => fs.readFileSync(new URL('../tavern-plugin/src/client/'+name,import.meta.url),'utf8')
const stage = read('fork-gal-stage.js'), widgets = read('fork-gal-widgets.js')
const between = (s,a,b) => s.slice(s.indexOf(a),s.indexOf(b,s.indexOf(a)))
test('warning details and component list retain wheel at both edges; background navigation is unchanged',{timeout:30000},async t=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});t.after(()=>browser.close())
  const page=await browser.newPage()
  await page.setContent('<main></main><style>code{display:block;white-space:pre;max-height:100px;overflow:auto}.fork-widget-menu-list{overflow:auto;height:100px;width:320px}.fork-widget-menu-list button{display:block;height:30px}#background{height:150px}</style>')
  const handler=between(stage,'    function wheel(event) {','    // Mixer and Config:')
  await page.addScriptTag({content:await browserReactScript()+`
    const React=modules.react,ReactDOM=modules['react-dom/client'],h=React.createElement;
    const stageDiagnosticText=x=>typeof x==='string'?x:x.message,stageRuntimeErrorText=x=>x;
    const directorCommands={dimensions:{}},ForkSpinner=()=>null,ForkWidgetIcon=()=>null;
    ${between(stage,'const FORK_GAL_DIAGNOSTIC_TEXT','// private fork: HUD change moments')}
    ${between(widgets,'function ForkWidgetMenu','function ForkGalWidgets')}
    ${between(stage,'function forkGalReadThrough','function forkGalSubtitleCache')}
    // private fork: no active textcard in this overlay-only fixture.
    const textcard={skip:()=>false};
    let backlog=false,configOpen=false,galleryOpen=false,menuOpen=false,hidden=false,typed=true;
    const wheelGesture={current:null},backlogClosedAt={current:0},readState={readThrough:null};
    const skipStopped={current:false}; // private fork (reading controls): no fast-forward was just stopped
    const nextPosition=()=>({turn:1,page:1,textDigest:'x'}),setAuto=()=>{},setSkipping=()=>{};
    window.actions=[];const openBacklog=()=>actions.push('backlog'),input=()=>actions.push('advance'),go=input;
    const owner={paused:false,items:Array.from({length:30},(_,i)=>({key:String(i),presentation:{attention:{count:0},state:'hidden'},definition:{title:'Component '+i}})),action(){actions.push('choose')}};
    ${handler}
    ReactDOM.createRoot(document.querySelector('main')).render(h('section',{onWheel:wheel},
      h(ForkGalRuntimeStatus,{error:Array.from({length:50},(_,i)=>'Detail '+i).join('\\n')}),
      h(ForkWidgetMenu,{owner}),h('div',{id:'background'},'Background')));
  `})
  await page.locator('summary').click()
  await page.locator('.fork-widget-menu-trigger').click()
  for(const selector of ['code','.fork-widget-menu-list']) {
    const target=page.locator(selector)
    for(const edge of ['top','middle','bottom']) {
      await target.evaluate((el,edge)=>{el.scrollTop=edge==='top'?0:edge==='middle'?50:el.scrollHeight},edge)
      for(const [deltaMode,deltaY] of [[0,-120],[0,120],[0,-24],[0,24],[1,-3],[1,3],[2,-1],[2,1]]) {
        await target.dispatchEvent('wheel',{bubbles:true,deltaMode,deltaY})
      }
      assert.deepEqual(await page.evaluate(()=>actions),[],selector+' '+edge)
    }
    await target.evaluate(el=>el.scrollTop=0)
    await target.hover();await page.mouse.wheel(0,120)
    await page.waitForFunction(selector=>document.querySelector(selector).scrollTop>0,selector)
    assert.deepEqual(await page.evaluate(()=>actions),[],'native scroll does not navigate')
  }
  await page.locator('#background').dispatchEvent('wheel',{bubbles:true,deltaY:-120})
  assert.deepEqual(await page.evaluate(()=>actions),['backlog'])
  await page.evaluate(()=>wheelGesture.current=null)
  await page.locator('#background').dispatchEvent('wheel',{bubbles:true,deltaY:120})
  assert.deepEqual(await page.evaluate(()=>actions),['backlog','advance'])
})
