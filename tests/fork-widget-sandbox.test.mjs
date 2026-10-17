import {bubbleResolutionSource} from './helpers/bubble-resolution-source.mjs' // private fork
// private fork: migrated to host presentation/action; legacy size/view/dismiss are rejected.
// private fork: security assertions exercise host-authorized v2 pack widgets.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { browserReactScript } from './fixtures/browser-react.mjs'
import { forkThemeCss } from './helpers/fork-theme-css.mjs' // private fork: include runtime surface tokens.
import { templateFiles, widgetFixture, widgetServer } from './fixtures/widget-harness.mjs'
const read = file => readFile(new URL('../tavern-plugin/src/client/' + file, import.meta.url), 'utf8')
async function sources() {
  let registry = await read('fork-widget-definitions.cjs')
  for (const match of [...registry.matchAll(/require\('\.\/widgets\/([a-z][a-z0-9-]*)\.cjs'\)/g)].reverse()) registry = registry.slice(0, match.index) + (await read('widgets/' + match[1] + '.cjs')).trim() + registry.slice(match.index + match[0].length)
  return bubbleResolutionSource + '\n' + registry + '\n' + (await Promise.all(['fork-foreground.js', 'fork-widget-contracts.cjs', 'fork-stage-widgets.cjs', 'fork-widget-media.cjs', 'fork-widget-theme.cjs','fork-widget-theme.js','fork-widget-setting-images.js','fork-widget-sandbox.js', 'fork-gal-widgets.js', 'fork-widget-source.cjs', 'fork-widget-presentation.cjs', 'fork-widget-thread.cjs', 'fork-widget-source.js'].map(read))).join('\n')
}
async function browserFixture(t, extraScript = '') {
  const f = await widgetFixture(t), files = await templateFiles()
  files.find(file => file.path === 'index.js').content += '\n' + extraScript
  await f.publish(files)
  await f.enable()
  const requests = [], origin = await widgetServer(t, f, (req, res) => {
    requests.push(req.url)
    res.setHeader('Content-Type', 'text/html')
    res.end('<!doctype html><html lang="en"><body><div id="root" class="fork-gal-stage" style="--gal-ui-ink:rgb(10, 20, 30);--gal-ui-surface:rgb(250, 245, 240);--gal-ui-surface-2:rgb(250, 245, 240)"></div></body></html>')
    return true
  })
  const browser = await chromium.launch({ headless: true,args:['--explicitly-allowed-ports='+new URL(origin).port] }); t.after(() => browser.close())
  const page = await browser.newPage(), errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.goto(origin)
  await page.addScriptTag({ content: await browserReactScript() })
  await page.addScriptTag({ content: `const React = modules.react; ${await sources()}
    const root = modules['react-dom/client'].createRoot(document.getElementById('root'));
    window.testMessages = []; window.dismissed = 0; window.expanded = 0;
    window.addEventListener('message', event => { if (event.source === document.querySelector('iframe')?.contentWindow) testMessages.push(event.data); });
    window.widgetCounters = forkWidgetRuntime;
    window.mountWidget = (definition, props = {body:'Hello'}, seconds = 20) => {
      const widget = forkWidgetPresentation({ widgetId:'test', ref:definition.ref, originKey:'test', state:props, slot:'center-card' }, definition);
      widget.presentation={state:'open',bounds:definition.document.presentation.open,surface:'stage',pinned:false,attention:{count:0,changed:false},suspended:false,reducedMotion:true,transitionMs:0};widget.onAction=action=>{if(action==='hide')dismissed++;else if(action==='open')expanded++};
      root.render(React.createElement(ForkWidgetSandbox, {widget, seconds}));
    };
    const fixtureContext={state:null,refs:new Map()},fixtureSource={branchId:'fixture',generation:1},fixturePages=Array.from({length:20},(_,i)=>({para:i+1,text:'Page '+i,kind:'narration'}));
    function StageHarness({widgets,para,paused}){const rootRef=React.useRef(document.getElementById('root'));const owner=useForkWidgetStage({context:fixtureContext,sessionId:'test',source:fixtureSource,turn:1,pages:fixturePages,page:para-1,record:{phase:'done',through:20,token:{sourceKey:'test',generation:1,bindingKey:'test'},entries:[]},widgets,rootRef,enabled:widgets.length>0,paused,mode:'live',revealed:true});window.stageOwner=owner;return React.createElement(React.Fragment,null,React.createElement(ForkWidgetMenu,{owner}),React.createElement(ForkGalWidgets,{owner}));}
    window.mountStage=(widgets,para=1,paused=false)=>root.render(React.createElement(StageHarness,{widgets,para,paused}));
    window.disposeWidget = () => root.unmount();
  ` })
  const definition = (await f.widgets())[0].definition
  await page.evaluate(definition => mountWidget(definition), definition)
  await page.waitForFunction(() => testMessages.some(m => m.type === 'ready'))
  return { ...f, browser, page, requests, origin, definition, errors }
}

test('sandbox template: real route, init/update/theme/tick, bounded size and validated message source', async t => {
  const f = await browserFixture(t, `window.addEventListener('message', e => { if(e.source === parent && e.data.type === 'tick') parent.postMessage({probeTick:e.data.seconds}, '*'); });`)
  const frame = f.page.frameLocator('iframe')
  assert.equal(await frame.locator('#body').textContent(), 'Hello')
  assert.equal(await frame.locator('body').evaluate(node => getComputedStyle(node).color), 'rgb(10, 20, 30)')
  assert.equal(await f.page.locator('iframe').getAttribute('sandbox'), 'allow-scripts')
  await f.page.evaluate(definition => mountWidget(definition, { body: '<script>plain text</script>' }, 12), f.definition)
  await f.page.waitForFunction(() => testMessages.some(m => m.probeTick === 12))
  assert.equal(await frame.locator('#body').textContent(), '<script>plain text</script>')
  await f.page.locator('#root').evaluate(node => node.style.setProperty('--gal-ui-ink', 'rgb(40, 50, 60)'))
  await f.page.waitForFunction(() => testMessages.filter(m => m.type === 'ready').length >= 1)
  await frame.locator('body').evaluate(async node => { for(let n=0;n<50 && getComputedStyle(node).color !== 'rgb(40, 50, 60)';n++) await new Promise(r=>setTimeout(r,10)); })
  assert.equal(await frame.locator('body').evaluate(node => getComputedStyle(node).color), 'rgb(40, 50, 60)')
  await f.page.evaluate(() => {
    const ready = testMessages.find(m => m.type === 'ready'), source = document.querySelector('iframe').contentWindow;
    window.dispatchEvent(new MessageEvent('message', { source: window, origin:'null', data:{...ready,type:'dismiss'} }));
    window.dispatchEvent(new MessageEvent('message', { source, origin:location.origin, data:{...ready,type:'dismiss'} }));
    window.dispatchEvent(new MessageEvent('message', { source, origin:'null', data:{...ready,token:'wrong',type:'dismiss'} }));
    window.dispatchEvent(new MessageEvent('message', { source, origin:'null', data:{...ready,type:'size',w:100000,h:100000} }));
  })
  assert.equal(await f.page.evaluate(() => dismissed), 0)
  assert.equal(await f.page.locator('iframe').evaluate(node => node.style.width), '280px')
  assert.equal(await f.page.locator('iframe').evaluate(node => node.style.height), '180px')
  await frame.locator('#close').click()
  await f.page.waitForFunction(() => dismissed === 1)
  assert.equal(await f.page.evaluate(() => dismissed), 1)
  await f.page.evaluate(() => disposeWidget())
  assert.equal(await f.page.locator('iframe').count(), 0)
  assert.deepEqual(f.errors, [])
})

test('sandbox isolation: host DOM/storage, fetch, top navigation and window.open are blocked', async t => {
  const f = await browserFixture(t, `
    const probe = {};
    try { void parent.document.body; probe.dom = false; } catch { probe.dom = true; }
    try { localStorage.setItem('bad','1'); probe.storage = false; } catch { probe.storage = true; }
    try { top.location.href = '/top-escaped'; probe.top = 'attempted'; } catch { probe.top = 'blocked'; }
    probe.popup = window.open('/popup-escaped') === null;
    fetch('/fetch-escaped').then(()=>{probe.fetch=false},()=>{probe.fetch=true}).finally(()=>parent.postMessage({probe}, '*'));
  `)
  await f.page.waitForFunction(() => testMessages.some(m => m.probe))
  const probe = await f.page.evaluate(() => testMessages.find(m => m.probe).probe)
  assert.equal(probe.dom, true); assert.equal(probe.storage, true); assert.equal(probe.popup, true); assert.equal(probe.fetch, true)
  assert.equal(f.page.url(), f.origin + '/')
  assert.equal(f.browser.contexts()[0].pages().length, 1)
  assert.ok(!f.requests.some(url => /escaped/.test(url)))
  // private fork: query the real opaque frame policy without reading the clipboard or opening a microphone.
  const child = f.page.frames().find(frame => frame !== f.page.mainFrame())
  const permissions = await child.evaluate(async () => Promise.all(['microphone','clipboard-read','clipboard-write'].map(async name => (await navigator.permissions.query({name})).state)))
  assert.deepEqual(permissions,['denied','denied','denied'])
})

test('sandbox self-navigation: accepted outbound request, second-load watchdog removes iframe and counts failure', async t => {
  const f = await browserFixture(t, `window.addEventListener('message', e => { if(e.source === parent && e.data.type === 'init') setTimeout(()=>location.replace('/self-escaped?ownProps=hello'), 150); });`)
  await f.page.waitForFunction(() => widgetCounters.navigations === 1)
  assert.equal(await f.page.locator('iframe').count(), 0)
  assert.ok(f.requests.includes('/self-escaped?ownProps=hello'))
  assert.equal(await f.page.evaluate(() => widgetCounters.errors), 1)
  assert.equal(f.page.url(), f.origin + '/')
})


test('sandbox: malformed cyclic messages fail only the widget; readiness timeout clears a fresh iframe', async t => {
  const f = await browserFixture(t)
  const child = f.page.frames().find(frame => frame !== f.page.mainFrame())
  await child.evaluate(() => {
    const message = { channel:'dsh-widget', version:2, token, type:'size', w:300, h:100 };
    message.cycle = message;
    parent.postMessage(message, hostOrigin);
  })
  await f.page.waitForFunction(() => widgetCounters.floods === 1)
  assert.equal(await f.page.locator('iframe').count(), 0)
  const files = await templateFiles()
  files.find(file => file.path === 'index.js').content = '// deliberately never ready'
  await f.publish(files); await f.enable()
  const definition = (await f.widgets())[0].definition
  await f.page.evaluate(definition => {
    const widget = forkWidgetPresentation({ widgetId:'timeout', ref:definition.ref, originKey:'timeout', state:{body:'Hi'}, slot:'center-card' }, definition);
    root.render(React.createElement(ForkWidgetSandbox, { key:'timeout', widget }));
  }, definition)
  await f.page.waitForFunction(() => widgetCounters.timeouts === 1)
  assert.equal(await f.page.locator('iframe').count(), 0)
  assert.deepEqual(f.errors, [])
})

test('preview helper: sample and edited props, declared settings, theme and film mode use the sandbox', async t => {
  const f = await browserFixture(t)
  await f.page.addStyleTag({ content: await forkThemeCss() })
  const count = await f.page.evaluate(() => testMessages.filter(m => m.type === 'ready').length)
  await f.page.evaluate(definition => {
    root.render(React.createElement(ForkWidgetPreview, { definition, theme:'magical', film:true, settings:{signature:'Alice'} }));
  }, f.definition)
  await f.page.waitForFunction(count => testMessages.filter(m => m.type === 'ready').length > count, count)
  const frame = f.page.frameLocator('iframe')
  assert.equal(await frame.locator('#body').textContent(), 'Meet me by the old gate.')
  assert.equal(await frame.locator('#signature').textContent(), 'Alice')
  assert.equal(await f.page.locator('.fork-widget-preview').getAttribute('data-film'), 'true')
  const expectedInk = await f.page.locator('.fork-widget-preview').evaluate(node => {
    const sample = document.createElement('span'); sample.style.color = 'var(--gal-ui-ink)'; node.append(sample)
    const color = getComputedStyle(sample).color; sample.remove(); return color
  })
  assert.equal(await frame.locator('body').evaluate(node => getComputedStyle(node).color), expectedInk)
  assert.equal(await f.page.locator('iframe').evaluate(node => node.style.width), String(f.definition.document.presentation.open.width)+'px') // private fork: no transform scaling of text
  await f.page.evaluate(definition => root.render(React.createElement(ForkWidgetPreview, { definition, state:{body:55} })), f.definition)
  await f.page.getByRole('status').waitFor()
  assert.equal(await f.page.locator('iframe').count(), 0)
  assert.deepEqual(f.errors, [])
})


test('Module revocation tears down widgets and routes; published updates require no new grants', async t => {
  const f = await browserFixture(t)
  const old = f.definition.url
  assert.equal((await fetch(f.origin + old)).status,200)
  f.disable()
  assert.deepEqual(await f.widgets(),[])
  assert.equal((await fetch(f.origin + old)).status,403)
  await f.enable()
  assert.equal((await f.widgets()).length,1)
  const files = await templateFiles()
  files.find(file => file.path === 'index.js').content += '\n// changed executable digest'
  await f.publish(files)
  assert.equal((await f.widgets()).length,1)
  const widget = (await f.widgets())[0]
  await f.page.evaluate(widget => {document.getElementById('root').style.cssText += ';height:700px;width:1000px';mountStage([widget])},widget)
  await f.page.waitForFunction(()=>stageOwner.items.length===1);await f.page.evaluate(()=>stageOwner.action(stageOwner.items[0].key,'open'));await f.page.locator('iframe').waitFor()
  f.disable()
  await f.page.evaluate(widgets => mountStage(widgets),await f.widgets())
  assert.equal(await f.page.locator('iframe').count(),0)
})


// private fork: one instance container changes surface; no reader transfer or second iframe.
test('stage reader changes to sheet and back without changing frame or token',async t=>{
 const f=await browserFixture(t),widget={ref:f.definition.ref,state:{body:'Hello'},definition:f.definition}
 await f.page.evaluate(widget=>{document.getElementById('root').style.cssText+=';position:relative;width:1000px;height:800px';mountStage([widget])},widget)
 await f.page.waitForFunction(()=>stageOwner?.items.length===1);await f.page.evaluate(()=>stageOwner.action(stageOwner.items[0].key,'open'));await f.page.locator('iframe').waitFor()
 await f.page.evaluate(()=>{window.savedFrame=document.querySelector('iframe');window.savedWindow=savedFrame.contentWindow;stageOwner.action(stageOwner.items[0].key,'sheet')})
 await f.page.waitForSelector('.is-sheet');assert.equal(await f.page.evaluate(()=>savedFrame===document.querySelector('iframe')&&savedWindow===savedFrame.contentWindow),true)
 await f.page.evaluate(()=>stageOwner.action(stageOwner.items[0].key,'collapse'));await f.page.waitForTimeout(30)
 assert.equal(await f.page.locator('iframe').count(),1);assert.deepEqual(f.errors,[])
})
test('pinned stage instances survive ten pages; hidden content and overlays cannot force open',async t=>{
 const f=await browserFixture(t),widget={ref:f.definition.ref,state:{body:'Hello'},definition:f.definition}
 await f.page.evaluate(widget=>{window.activeWidget=widget;document.getElementById('root').style.cssText+=';position:relative;width:1200px;height:800px';mountStage([widget])},widget)
 await f.page.waitForFunction(()=>stageOwner?.items.length===1);await f.page.evaluate(()=>{stageOwner.action(stageOwner.items[0].key,'open');stageOwner.action(stageOwner.items[0].key,'pin')});await f.page.locator('iframe').waitFor()
 await f.page.evaluate(()=>{window.savedFrame=document.querySelector('iframe')})
 for(let para=2;para<=11;para++)await f.page.evaluate(para=>mountStage([activeWidget],para),para)
 assert.equal(await f.page.evaluate(()=>savedFrame===document.querySelector('iframe')),true)
 await f.page.evaluate(()=>stageOwner.action(stageOwner.items[0].key,'hide'))
 for(let para=12;para<=16;para++)await f.page.evaluate(para=>mountStage([{...activeWidget,state:{body:'Updated'}}],para),para)
 for(const paused of [true,false])await f.page.evaluate(paused=>mountStage([activeWidget],16,paused),paused)
 await f.page.waitForTimeout(30);assert.equal(await f.page.locator('.fork-widget-panel').getAttribute('data-presentation'),'hidden');assert.equal(await f.page.evaluate(()=>savedFrame===document.querySelector('iframe')),true)
 assert.deepEqual(f.errors,[])
})
