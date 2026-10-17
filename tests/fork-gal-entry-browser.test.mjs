import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import {chromium} from 'playwright'
import {browserReactScript} from './fixtures/browser-react.mjs'
import {forkThemeCss} from './helpers/fork-theme-css.mjs'
import {read} from './helpers/mounted-stage-shell.mjs'

const entry=read('fork-gal-entry.js')
test('entry thresholds skip quick loads, fade once, and degrade after ten seconds',()=>{
  const scope={};vm.runInNewContext(entry,scope)
  const phase=scope.forkGalEntryPhase
  assert.equal(phase(100,true,null,false),'ready')
  assert.equal(phase(299,false,null,false),'pending')
  assert.equal(phase(300,false,null,false),'loading')
  assert.equal(phase(800,true,null,true),'revealing')
  assert.equal(phase(1049,true,800,true),'revealing')
  assert.equal(phase(1050,true,800,true),'ready')
  assert.equal(phase(10000,false,null,true),'slow')
})

test('entry waits for presented visuals, not autoplay audio; timeout stays readable',{timeout:30000},async t=>{
  const browser=await chromium.launch({headless:true});t.after(()=>browser.close())
  const page=await browser.newPage({viewport:{width:1280,height:720}})
  const errors=[];page.on('pageerror',e=>errors.push(e.message))
  await page.setContent('<div id="root"></div>')
  await page.addStyleTag({content:await forkThemeCss()})
  await page.addScriptTag({content:await browserReactScript()+`
    const React=modules.react,ReactDOM=modules['react-dom/client'];
    ${read('fork-spinner.js')}
    ${entry}
    const state={source:{sessionId:'s'},accepted:{presentationRevision:1,music:{identity:'track'}},pending:{projection:true,resources:true}};
    const store={getSnapshot:()=>state};let audioReady=false, gate, text=true;
    const forkStageMusic={ready:()=>audioReady};
    function App(){const root=React.useRef(null);gate=useForkGalEntry(store,root);return React.createElement('div',{ref:root,className:'fork-gal-stage','data-theme':'classic','data-entry':gate.phase},
      React.createElement('div',{className:'fork-gal-scene'},'All figures'),text&&React.createElement('div',{className:'fork-gal-box'},'Text ready'),React.createElement(ForkGalEntryOverlay,{phase:gate.phase}));}
    const root=ReactDOM.createRoot(document.querySelector('#root'));root.render(React.createElement(App));
    window.probe={state,present:rev=>gate.onPresented(rev),audio:()=>{audioReady=true},reset(){root.unmount();const root2=ReactDOM.createRoot(document.querySelector('#root'));audioReady=false;root2.render(React.createElement(App));},slow(){const now=performance.now.bind(performance);performance.now=()=>now()+11000;}};
  `})
  await page.waitForSelector('[data-entry="loading"]')
  assert.equal(await page.locator('.fork-gal-scene').evaluate(n=>getComputedStyle(n).opacity),'0')
  assert.equal(await page.locator('.fork-spinner-wheel > i').count(),12)
  await page.setViewportSize({width:375,height:812})
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),375)
  const veil=await page.locator('.fork-gal-entry-overlay').boundingBox()
  assert.deepEqual(veil,{x:0,y:0,width:375,height:812})
  if(process.env.MADOKA_EVIDENCE_DIR) await page.screenshot({path:process.env.MADOKA_EVIDENCE_DIR+'/madoka-entry-mobile-loading.png'})
  await page.setViewportSize({width:1280,height:720})
  if(process.env.MADOKA_EVIDENCE_DIR) await page.screenshot({path:process.env.MADOKA_EVIDENCE_DIR+'/madoka-entry-desktop-loading.png'})
  await page.evaluate(()=>{probe.present(1);probe.state.accepted.presentationRevision=2;probe.state.pending={projection:false,resources:false}})
  await page.waitForTimeout(80)
  assert.equal(await page.locator('.fork-gal-stage').getAttribute('data-entry'),'loading','old rendered revision cannot release new resources')
  await page.evaluate(()=>probe.present(2))
  await page.waitForSelector('[data-entry="revealing"]')
  await page.waitForSelector('[data-entry="ready"]')
  assert.equal(await page.evaluate(()=>forkStageMusic.ready()),false,'stage is visible without an audio gesture or media readiness')
  assert.equal(await page.locator('.fork-gal-scene').evaluate(n=>getComputedStyle(n).opacity),'1')
  await page.evaluate(()=>probe.reset());await page.waitForSelector('[data-entry="loading"]')
  await page.evaluate(()=>probe.slow());await page.waitForSelector('[data-entry="slow"]')
  assert.match(await page.locator('.fork-gal-entry-overlay').textContent(),/仍在载入/)
  await page.waitForFunction(()=>getComputedStyle(document.querySelector('.fork-gal-scene')).opacity==='1')
  await page.evaluate(()=>probe.present(2));await page.waitForSelector('[data-entry="ready"]')
  assert.deepEqual(errors,[])
})

// private fork (perf r5): a cold Live2D bundle must not hold the backdrop and text box behind the veil.
test('entry reveals the backdrop when only figure groups are still loading, after a short grace',{timeout:30000},async t=>{
  const browser=await chromium.launch({headless:true});t.after(()=>browser.close())
  const page=await browser.newPage({viewport:{width:1280,height:720}})
  const errors=[];page.on('pageerror',e=>errors.push(e.message))
  await page.setContent('<div id="root"></div>')
  await page.addScriptTag({content:await browserReactScript()+`
    const React=modules.react,ReactDOM=modules['react-dom/client'];
    ${read('fork-spinner.js')}
    ${entry}
    const state={source:{sessionId:'s'},accepted:{presentationRevision:1},pending:{projection:true,resources:true},projection:{outstanding:['background','figure:a']}};
    const store={getSnapshot:()=>state};let gate;const forkStageMusic={ready:()=>true};
    function App(){const root=React.useRef(null);gate=useForkGalEntry(store,root);return React.createElement('div',{ref:root,'data-entry':gate.phase},React.createElement('div',{className:'fork-gal-box'},'Text'));}
    ReactDOM.createRoot(document.querySelector('#root')).render(React.createElement(App));
    window.probe={state,backdrop:rev=>gate.onBackdrop(rev)};
  `})
  await page.evaluate(()=>probe.backdrop(1));await page.waitForTimeout(400)
  assert.match(await page.locator('[data-entry]').getAttribute('data-entry'),/pending|loading/,'background and figure discovery are still outstanding')
  await page.evaluate(()=>{probe.state.projection={figureKeys:['figure:a'],outstanding:['figure:a']};probe.state.accepted.presentationRevision=2;probe.backdrop(2)})
  await page.waitForTimeout(120)
  assert.match(await page.locator('[data-entry]').getAttribute('data-entry'),/pending|loading/,'figures get a short grace')
  await page.waitForSelector('[data-entry="ready"]',{timeout:3000})
  assert.deepEqual(errors,[])
})