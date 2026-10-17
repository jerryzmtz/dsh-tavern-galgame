// private fork: offline bridge fixture, not the production Timeline/MVU closed-loop acceptance.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { chromium } from 'playwright'
import { browserReactScript } from './fixtures/browser-react.mjs'
const read = name => readFile(new URL('../tavern-plugin/src/client/' + name, import.meta.url), 'utf8')

test('offline read/write widget: v2 messages, one frame, revocation, latest snapshots and limits', async t => {
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    if (req.url === '/widget') {
      res.end(`<!doctype html><meta charset="utf-8"><p id="balance">loading</p><button id="buy">Buy</button><p id="receipt"></p><script>
      let token='',projection=null,id=0;window.received=[];
      const send=(type,data={})=>parent.postMessage({channel:'dsh-widget',version:2,token,type,...data},'*');
      addEventListener('message',event=>{if(event.source!==parent)return;const m=event.data;if(m.channel!=='dsh-widget')return;
        if(m.type==='init'){token=m.token;send('ready');}
        if(m.variables || m.type==='variables'){projection=m.variables || m;document.querySelector('#balance').textContent=projection.values.balance.status==='ready'?String(projection.values.balance.value):projection.values.balance.status;}
        if(m.type==='variables.result'){received.push(m);document.querySelector('#receipt').textContent=m.status;}
      });
      window.propose=()=>send('variables.propose',{requestId:'r'+(++id),contextKey:projection.contextKey,revision:projection.revision,operations:[{writeId:'balance',op:'delta',value:-5}]});
      document.querySelector('#buy').onclick=propose;
      </script>`)
    } else res.end('<!doctype html><html><body><div id="root"></div></body></html>')
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const origin = 'http://127.0.0.1:' + server.address().port
  const browser = await chromium.launch({ headless: true, args: ['--explicitly-allowed-ports=' + server.address().port] })
  t.after(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 375, height: 740 } })
  await page.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort())
  const errors = []; page.on('pageerror', error => errors.push(error.message))
  await page.goto(origin)
  await page.addScriptTag({ content: await browserReactScript() })
  await page.addScriptTag({ content: `const React=modules.react;
    const forkWidgetCount=()=>{},forkStageAudio={bind(){},release(){}};
    ${await read('fork-widget-contracts.cjs')}
    ${await read('fork-widget-media.cjs')}
    ${await read('fork-widget-theme.cjs')}
    ${await read('fork-widget-theme.js')}
    ${await read('fork-widget-setting-images.js')}
    ${await read('fork-widget-sandbox.js')}
    window.calls=[];window.latest=null;
    const root=modules['react-dom/client'].createRoot(document.querySelector('#root'));
    const declaration={reads:{balance:{source:'mvu',path:'/balance'}},writes:{balance:{source:'mvu',path:'/balance',scope:'exact',ops:['delta']}}};
    const base={definition:{url:'/widget',title:'Synthetic shop',document:{variables:declaration,presentation:{open:{width:280,height:180}}}},presentation:{state:'open',bounds:{width:280,height:180},suspended:false},scopeKey:'fixture',onVariableRequest:async data=>{calls.push(data);return {status:'committed',operationId:'host-operation',revision:'next',schema:'private',currentVariables:{secret:true}};}};
    window.show=(contextKey='turn-2',revision='saved',balance=20,allowed=true,suspended=false)=>{
      const widget={...base,presentation:{...base.presentation,suspended},variables:{contextKey,revision,sequence:1,position:{turn:2,swipeId:0},snapshot:{kind:'exact',turn:2},settlement:'idle',writable:{allowed,reason:allowed?'':'read-only-position'},values:{balance:{status:'ready',value:balance}}}};
      latest=widget;root.render(React.createElement(ForkWidgetSandbox,{widget}));
    };show();` })
  const frame = page.frameLocator('iframe')
  await frame.locator('#buy').waitFor()
  await page.waitForFunction(() => document.querySelector('iframe'))
  const child = page.frames().find(frame => frame !== page.mainFrame())
  await child.waitForFunction(() => document.querySelector('#balance').textContent === '20')
  await page.evaluate(() => { window.originalFrame = document.querySelector('iframe').contentWindow })
  await frame.locator('#buy').click()
  await child.waitForFunction(() => document.querySelector('#receipt').textContent === 'committed')
  assert.equal(await page.evaluate(() => calls.length), 1)
  assert.equal(await child.evaluate(() => received[0].schema), undefined)
  assert.equal(await child.evaluate(() => received[0].currentVariables), undefined)
  await page.evaluate(() => show('turn-2', 'next', 15))
  await child.waitForFunction(() => document.querySelector('#balance').textContent === '15')
  assert.equal(await page.evaluate(() => originalFrame === document.querySelector('iframe').contentWindow), true)
  await page.evaluate(() => show('turn-1', 'old', 99, false))
  await frame.locator('#buy').click()
  await child.waitForFunction(() => document.querySelector('#receipt').textContent === 'rejected')
  assert.equal(await page.evaluate(() => calls.length), 1)
  await page.evaluate(() => show('turn-2', 'next', 15, true, true))
  await child.waitForFunction(() => document.querySelector('#balance').textContent === 'unavailable')
  await child.evaluate(() => propose())
  await child.waitForFunction(() => document.querySelector('#receipt').textContent === 'unavailable')
  assert.equal(await page.evaluate(() => calls.length), 1)
  assert.deepEqual(errors, [])
})
