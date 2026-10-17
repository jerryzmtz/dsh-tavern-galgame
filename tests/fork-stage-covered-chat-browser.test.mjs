// private fork: fullscreen stage rendering must not relayout the covered transcript.
import test from 'node:test'
import assert from 'node:assert/strict'
import {chromium} from 'playwright'
import {browserReactScript} from './fixtures/browser-react.mjs'
import {forkThemeCss} from './helpers/fork-theme-css.mjs'
import {read,between} from './helpers/mounted-stage-shell.mjs'

test('stage portal suspends covered chat rendering without unmounting or losing draft/scroll state',{timeout:30000},async t=>{
  const browser=await chromium.launch({headless:true});t.after(()=>browser.close())
  const page=await browser.newPage({viewport:{width:1600,height:900}}),errors=[]
  page.on('pageerror',error=>errors.push(error.message))
  await page.setContent('<!doctype html><html><head></head><body><div id="root"></div></body></html>')
  await page.addStyleTag({content:await forkThemeCss()+'\n#chat-scroll{height:60vh;overflow:auto}.fixture-row{height:64px}textarea{height:40px} '})
  const host=between(read('fork-gal-stage.js'),'function ForkGalStageHost(props)','// Header button: enter the stage')
  await page.addScriptTag({content:await browserReactScript()+`;const React=modules.react,ReactDOM={...modules['react-dom'],...modules['react-dom/client']};
    let active=false,unmounts=0;const listeners=new Set();
    const forkGalActive={get:()=>active?'session':''},forkGalMenuRequest={request(){}};function forkGalEscapeLock(){}
    function useForkGalOn(){const on=React.useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn)},()=>active);return {on,data:{}}}
    function toggle(on){active=on;ReactDOM.flushSync(()=>listeners.forEach(fn=>fn()))}
    function forkGalLeave(){toggle(false)}
    function ForkGalStage(){return React.createElement('div',{className:'fork-gal-stage'},React.createElement('button',{onClick:forkGalLeave},'Leave'))}
    ${read('fork-gal-entry.js')}
    ${host}
    function Chat(){React.useEffect(()=>()=>{unmounts++},[]);return React.createElement('div',{'data-dsh-fork-session':'play',style:{display:'contents'}},React.createElement('main',null,
      React.createElement('div',{id:'chat-scroll'},...Array.from({length:1000},(_,i)=>React.createElement('article',{key:i,className:'fixture-row'},
        ...Array.from({length:20},(_,j)=>React.createElement('span',{key:j},'Synthetic story '+i+'. '))))),
      React.createElement('textarea',{defaultValue:'Draft survives stage visits'}),React.createElement(ForkGalStageHost,{sessionId:'session'})))}
    ReactDOM.flushSync(()=>ReactDOM.createRoot(document.querySelector('#root')).render(React.createElement(Chat)));
    window.probe={toggle,get unmounts(){return unmounts}};`})
  // private fork (stage perf): the cover keeps the transcript's rendering state (content-visibility:hidden on the
  // session roots, boxes pinned) instead of display:none, so leaving the stage repaints rather than restyling it all.
  for(const [viewport,resized] of [[{width:1600,height:900},{width:375,height:812}],[{width:375,height:812},{width:1600,height:900}]]){
    await page.setViewportSize(viewport)
    const rowWidth=await page.locator('.fixture-row').first().evaluate(n=>n.getBoundingClientRect().width)
    await page.evaluate(()=>{document.querySelector('#chat-scroll').scrollTop=3100;window.savedChat=document.querySelector('main');window.probe.toggle(true)})
    await page.waitForSelector('.fork-gal-stage button')
    assert.equal(await page.locator('main').evaluate(n=>getComputedStyle(n).contentVisibility),'hidden')
    assert.equal(await page.locator('main').evaluate(n=>n.hasAttribute('data-fork-gal-covered')),true)
    // A fullscreen-like resize must not dirty the skipped layout: a forced descendant read stays at the covered geometry.
    await page.setViewportSize(resized)
    assert.equal(await page.locator('.fixture-row').first().evaluate(n=>n.getBoundingClientRect().width),rowWidth, 'forced descendant geometry cannot relayout the covered transcript')
    assert.equal(await page.evaluate(()=>{const t=document.querySelector('textarea');t.focus();return document.activeElement===t}),false, 'covered chat is not focusable')
    assert.equal(await page.locator('.fork-gal-stage').evaluate(n=>Boolean(n.closest('[data-dsh-fork-session]'))),false)
    assert.equal(await page.locator('.fork-gal-stage button').isVisible(),true)
    await page.setViewportSize(viewport)
    await page.locator('.fork-gal-stage button').click()
    await page.waitForFunction(()=>!document.querySelector('.fork-gal-stage'))
    const after=await page.evaluate(()=>({same:window.savedChat===document.querySelector('main'),unmounts:window.probe.unmounts,
      scroll:document.querySelector('#chat-scroll').scrollTop,draft:document.querySelector('textarea').value,
      display:getComputedStyle(document.querySelector('main')).display,visibility:getComputedStyle(document.querySelector('main')).contentVisibility,
      covered:document.querySelector('main').hasAttribute('data-fork-gal-covered'),pinned:document.querySelector('main').style.width,marked:document.documentElement.hasAttribute('data-fork-gal-stage')}))
    assert.deepEqual(after,{same:true,unmounts:0,scroll:3100,draft:'Draft survives stage visits',display:'block',visibility:'visible',covered:false,pinned:'',marked:false})
    assert.equal(await page.locator('.fixture-row').first().evaluate(n=>n.getBoundingClientRect().width),rowWidth)
  }
  assert.deepEqual(errors,[])
})

// private fork (owner 2026-10 regression): Esc in system full screen flashed twice - Electron shrinks the window, then
// fires fullscreenchange 50-100 ms later, and the menu only came after that. The first shrinking resize opens the menu
// (once); the late fullscreenchange does not open it again. Entering full screen (window fills the screen) opens nothing.
test('stage host opens the menu once on the full-screen exit resize, before fullscreenchange',{timeout:30000},async t=>{
  const browser=await chromium.launch({headless:true});t.after(()=>browser.close())
  const page=await browser.newPage({viewport:{width:1600,height:900}}),errors=[]
  page.on('pageerror',error=>errors.push(error.message))
  await page.setContent('<!doctype html><html><head></head><body><div id="root"></div></body></html>')
  const host=between(read('fork-gal-stage.js'),'function ForkGalStageHost(props)','// Header button: enter the stage')
  await page.addScriptTag({content:await browserReactScript()+`;const React=modules.react,ReactDOM={...modules['react-dom'],...modules['react-dom/client']};
    window.locks=[];Object.defineProperty(navigator,'keyboard',{value:{lock:keys=>{window.locks.push('lock:'+keys.join());return Promise.resolve()},unlock:()=>window.locks.push('unlock')}});
    ${between(read('fork-gal-stage.js'),'function forkGalEscapeLock(on)','// 「返回主页面」')}
    let full=null,outer={w:1600,h:900};window.requests=[];
    Object.defineProperty(document,'fullscreenElement',{get:()=>full});
    Object.defineProperty(window,'outerWidth',{get:()=>outer.w});Object.defineProperty(window,'outerHeight',{get:()=>outer.h});
    Object.defineProperty(screen,'width',{get:()=>1600});Object.defineProperty(screen,'height',{get:()=>900});
    const forkGalActive={get:()=>'session'},forkGalMenuRequest={request(){window.requests.push(full?'resize':'fullscreenchange')}};
    function useForkGalOn(){return {on:true,data:{}}}
    function forkGalLeave(){}
    function ForkGalStage(){return React.createElement('div',{className:'fork-gal-stage'})}
    function forkGalCoverChat(){} let forkGalUncover=null;
    ${host}
    ReactDOM.flushSync(()=>ReactDOM.createRoot(document.querySelector('#root')).render(React.createElement(ForkGalStageHost,{sessionId:'session'})));
    window.fs={enter(){full=document.documentElement;outer={w:1600,h:900};dispatchEvent(new Event('resize'));document.dispatchEvent(new Event('fullscreenchange'))},
      shrink(){outer={w:1612,h:868};dispatchEvent(new Event('resize'))},exit(){full=null;document.dispatchEvent(new Event('fullscreenchange'))}};`})
  const run=steps=>page.evaluate(steps=>{window.requests=[];window.locks=[];for(const step of steps)window.fs[step]();return window.requests},steps)
  assert.deepEqual(await run(['enter']),[])
  // In full screen the stage holds Esc (a press opens the menu in place); leaving full screen releases it.
  assert.deepEqual(await page.evaluate(()=>window.locks),['lock:Escape'])
  assert.deepEqual(await run(['shrink','exit']),['resize'])
  assert.deepEqual(await page.evaluate(()=>window.locks),['unlock'])
  // Without an early resize (a browser that reports the exit first) fullscreenchange still opens it, once.
  assert.deepEqual(await run(['enter','exit']),['fullscreenchange'])
  assert.deepEqual(errors,[])
})