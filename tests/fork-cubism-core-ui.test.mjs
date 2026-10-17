// private fork: real React + browser, fake RPC and fake renderer; no remote Core or live data.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { browserReactScript } from './fixtures/browser-react.mjs'
import { forkThemeCss } from './helpers/fork-theme-css.mjs'
const source = name => readFile(new URL('../tavern-plugin/src/client/' + name, import.meta.url), 'utf8')

// private fork (owner 2026-10): no app-side download; the entry links the official page and imports the user's file.
test('missing Core is quiet; official page, failed import retry and an imported Core restore mounted previews', async t => {
  const browser = await chromium.launch({ headless: true })
  t.after(() => browser.close())
  const runtime = await source('fork-live2d.js'), scene = await source('fork-gal-scene.js'), settingsUi = await source('fork-settings-ui.js')
  const scripts = await browserReactScript() + '\nconst React=modules.react,ReactDOM=modules["react-dom/client"];\n' +
    await source('fork-spinner.js') + '\n' + settingsUi.slice(settingsUi.indexOf('function forkPopoverPlace'), settingsUi.indexOf('function ForkHelpTip')) +
    settingsUi.slice(settingsUi.indexOf('function ForkHelpTip')).split('\nfunction ')[0] + '\n' + await source('fork-cubism-core.js') + '\n' +
    runtime.slice(runtime.indexOf('let forkLive2dRuntime'), runtime.indexOf('function forkLive2dLoadError')) + '\n' + await source('fork-live2d-preview.js') + '\n' + scene.slice(scene.indexOf('function ForkGalScene(props)'))
  for (const width of [1200, 375]) {
    const page = await browser.newPage({ viewport: { width, height: 812 } })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => { if (['error', 'warning'].includes(message.type())) errors.push(message.text()) })
    await page.route('**/*', route => route.abort())
    await page.setContent('<div id="root"></div>')
    await page.addStyleTag({ content: await forkThemeCss() + '\nbody{margin:0} #settings{padding:16px} #preview{position:relative;width:260px;height:280px}' })
    await page.addScriptTag({ content: scripts + `
      window.calls=[];window.opened=0;window.leasesClosed=0;window.loads=0;window.fail=true;window.present=false;
      window.stageCores=[];const originalScene={core:'',figures:[]};
      forkLoadPixiRuntime=async()=>({});
      function forkGalCreateScene(){return {set(value){stageCores.push(value.core);},debug:{},destroy(){}};}
      window.display=false;async function rpc(method,args){calls.push({method,args});if(method==='importLive2dRuntime'){
        if(args.consent!==true)throw Error('bad import');
        await new Promise(r=>setTimeout(r,250));if(fail)throw Error('不是 Cubism Core 文件');
        if(args.name==='live2dcubismcore.min.js'&&atob(args.base64)==='var Live2DCubismCore={};')present=true;
        else if(args.name==='pixi-live2d-display-0.4.0.tgz')display=true;else throw Error('bad file');
      }else if(method!=='getLive2dCoreStatus')throw Error('unexpected '+method);
      return {core:present?'/core.js':'',display:display?'/display.js':'',installed:present&&display,coreInstalled:present,displayInstalled:display,
        missing:[...(present?[]:['core']),...(display?[]:['display'])],importSupported:true,
        downloadUrl:'https://www.live2d.com/en/sdk/download/web/',licenseUrl:'https://www.live2d.com/eula/live2d-proprietary-software-license-agreement_en.html',
        displayDownloadUrl:'https://github.com/guansss/pixi-live2d-display/releases/tag/v0.4.0',displayLicenseUrl:'https://www.live2d.com/eula/live2d-open-software-license-agreement_en.html'};}
      const source={identity:'test/model',open:async()=>{opened++;return {url:'/model.json',core:'',close(){leasesClosed++;}};}};
      const nativeLoad=forkLoadLive2dRuntime;
      forkLoadLive2dRuntime=async core=>{if(!core&&!forkCubismCore.core)return nativeLoad(core);loads++;return {Application:function(){
        const app={view:document.createElement('canvas'),screen:{width:200,height:240},renderer:{gl:{},on(){},once(_,fn){queueMicrotask(fn)}},
          stage:{addChild(){}},ticker:{add(fn){setTimeout(fn,20)},start(){},stop(){}},destroy(){}};return app;},
        live2d:{Live2DModel:{from:async()=>({scale:{set(){}},destroy(){},internalModel:{coreModel:{},settings:{motions:{},expressions:[]},motionManager:{groups:{}},originalWidth:200,originalHeight:400}})}}};};
      function forkLive2dUseContext(){} function forkLive2dDropContext(){} function forkLive2dStartIdle(){}
      ReactDOM.createRoot(document.querySelector('#root')).render(React.createElement(React.Fragment,null,
        React.createElement(ForkGalScene,{scene:originalScene}),
        React.createElement('div',{id:'settings'},React.createElement(ForkCubismCoreEntry,{request:rpc})),
        React.createElement('div',{id:'preview'},React.createElement(ForkLive2dFigurePreview,{source,fallback:React.createElement('span',null,'静态立绘')}))));
    ` })
    await page.waitForSelector('[data-status="missing"]')
    assert.equal(await page.locator('#preview').getByText('静态立绘', { exact: true }).count(), 1)
    assert.equal(await page.evaluate(() => loads), 0)
    assert.equal(await page.evaluate(() => leasesClosed), 1, 'missing preview releases its lease')
    assert.deepEqual(await page.evaluate(() => forkLive2dSnapshots.request(source, ['neutral'])), {})
    assert.equal(await page.evaluate(() => leasesClosed), 2, 'missing snapshots also release their lease')
    assert.equal(await page.evaluate(() => calls.filter(c => c.method === 'importLive2dRuntime').length), 0)
    // private fork (owner 2026-10): one entry, both pieces with their official pages while missing.
    assert.deepEqual(await page.locator('#settings .fork-runtime-link').evaluateAll(links => links.map(a => [a.closest('[data-piece]').dataset.piece, a.href, a.target])),
      [['core', 'https://www.live2d.com/en/sdk/download/web/', '_blank'], ['display', 'https://github.com/guansss/pixi-live2d-display/releases/tag/v0.4.0', '_blank']])
    // C1: the licence pages are links in the (?), reachable from it with Tab.
    await page.locator('#settings .fork-help-tip-button').focus()
    await page.keyboard.press('Tab')
    assert.equal(await page.evaluate(() => document.activeElement.href), 'https://www.live2d.com/eula/live2d-proprietary-software-license-agreement_en.html')
    assert.deepEqual(await page.locator('.fork-help-tip-body.is-interactive a').evaluateAll(links => links.map(a => a.href)),
      ['https://www.live2d.com/eula/live2d-proprietary-software-license-agreement_en.html', 'https://www.live2d.com/eula/live2d-open-software-license-agreement_en.html'])
    await page.keyboard.press('Escape')
    assert.equal(await page.locator('.fork-help-tip-body').count(), 0)
    assert.equal(await page.locator('#preview .fork-spinner-wheel').count(), 0)
    const file = { name: 'live2dcubismcore.min.js', mimeType: 'text/javascript', buffer: Buffer.from('var Live2DCubismCore={};') }
    const archive = { name: 'pixi-live2d-display-0.4.0.tgz', mimeType: 'application/gzip', buffer: Buffer.from('tgz') }
    const input = page.locator('#preview input[type=file]')
    assert.ok(await page.locator('#preview').getByRole('button', { name: '同意许可并导入…' }).isVisible())
    await input.setInputFiles(file)
    await page.locator('#preview .fork-runtime[data-state=importing]').waitFor()
    await page.locator('#preview').getByRole('alert').waitFor()
    assert.match(await page.locator('#preview').getByRole('alert').textContent(), /不是 Cubism Core/)
    await page.evaluate(() => { fail = false })
    // Only the Core: the entry names the piece still missing; the renderer hears nothing yet.
    await input.setInputFiles(file)
    await page.locator('#preview [data-piece=core][data-installed]').waitFor()
    assert.equal(await page.locator('#preview [data-piece=display] .fork-runtime-link').count(), 1)
    assert.equal(await page.evaluate(() => loads), 0)
    await input.setInputFiles([archive])
    await page.waitForSelector('[data-status="ready"]')
    await page.locator('#settings').getByText('✓ 已安装', { exact: true }).waitFor()
    assert.equal(await page.locator('#settings input[type=file]').count(), 0, 'an installed Core is not replaced')
    assert.equal(await page.evaluate(() => loads), 1, 'mounted preview loads without restart')
    assert.equal(await page.evaluate(() => stageCores.at(-1)), '/core.js', 'mounted stage receives runtime without replaying state')
    assert.equal(await page.evaluate(() => originalScene.core), '', 'availability never mutates the persistent scene')
    assert.equal(await page.evaluate(() => calls.filter(c => c.method === 'importLive2dRuntime').length), 3)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'no horizontal overflow')
    assert.deepEqual(errors, [])
    await page.close()
  }
})

// private fork (owner 2026-10): Spine links the licence page and the pixi-spine release page, imports only when the host
// takes it, and tells installing to every subscriber (the stage binding re-reads on it).
test('Spine runtime entry: licence and pixi-spine pages, import only when supported, then installed', async t => {
  const browser = await chromium.launch({ headless: true })
  t.after(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 375, height: 700 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/*', route => route.abort())
  await page.setContent('<div id="root"></div>')
  await page.addStyleTag({ content: await forkThemeCss() })
  await page.addScriptTag({ content: await browserReactScript() + '\nconst React=modules.react,ReactDOM=modules["react-dom/client"];\n' +
    await source('fork-spinner.js') + '\n' + await source('fork-cubism-core.js') + `
    window.calls=[];window.supported=false;window.present=false;window.told=0;forkSpineRuntimeState.subscribe(()=>told++);
    async function rpc(method,args){calls.push({method,args});
      if(method==='importSpineRuntime'){if(args.consent!==true||args.name!=='pixi-spine.umd.js')throw Error('bad import');present=true;}
      return {installed:present,runtime:present?'/spine.js':'',downloadUrl:'https://www.npmjs.com/package/pixi-spine/v/3.1.2',purchaseUrl:'https://esotericsoftware.com/spine-purchase',importSupported:supported};}
    window.mount=()=>{const root=ReactDOM.createRoot(document.querySelector('#root'));root.render(React.createElement(ForkSpineRuntimeEntry,{request:rpc}));return root;};
    window.view=mount();` })
  await page.locator('.fork-runtime[data-state=missing]').waitFor()
  assert.deepEqual(await page.locator('.fork-runtime-link').evaluateAll(links => links.map(a => a.href)),
    ['https://esotericsoftware.com/spine-purchase', 'https://www.npmjs.com/package/pixi-spine/v/3.1.2'])
  assert.equal(await page.locator('.fork-runtime button').count(), 0, 'no import button while the host cannot take one')
  await page.evaluate(() => { view.unmount(); supported = true; window.view = mount() })
  await page.getByRole('button', { name: '同意许可并导入…' }).waitFor()
  await page.locator('input[type=file]').setInputFiles({ name: 'pixi-spine.umd.js', mimeType: 'text/javascript', buffer: Buffer.from('PIXI.spine') })
  await page.getByText('✓ 已安装', { exact: true }).waitFor()
  assert.equal(await page.evaluate(() => told), 1)
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  assert.deepEqual(errors, [])
})
