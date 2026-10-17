// private fork: real opaque iframe coverage without connecting to the live app.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const bundle = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')

test('AR-001 real opaque card document: authorized shim, forged widget, cross-card key, flood and navigation', async t => {
  const browser = await chromium.launch({ headless: true })
  t.after(() => browser.close())
  const page = await browser.newPage()
  // No application server, profile, external resources or live browser connection.
  await page.route('**/*', route => route.abort())
  await page.setContent('<!doctype html><body></body>')
  await page.addScriptTag({ content: 'window.__ModuleLoader__ = { load(d) { window.clientDescriptor = d; } };' })
  // Test-only seams into the real factory, not extra exports in the shipped bundle.
  const instrumented = bundle.replace('exports.createTavernMessageFrameLifecycle =', 'exports.storageTest = { storage: forkFrameStorage, install: installForkFrameStorageBridge, setRpc: fn => { rpc = fn; } }; exports.createTavernMessageFrameLifecycle =')
  assert.notEqual(instrumented, bundle)
  await page.addScriptTag({ content: instrumented })
  await page.addScriptTag({ content: `
    const client = clientDescriptor.factory(() => ({}));
    let disk = {}, batches = [];
    async function rpc(method, args) {
      if (method === 'getFrameStorage') return { values: {...disk} };
      batches.push(args.ops);
      for (const op of args.ops) {
        if (op.op === 'set') disk[op.key] = op.value;
        else if (op.op === 'remove') delete disk[op.key];
        else Object.keys(disk).forEach(key => { if (key.startsWith(op.namespace)) delete disk[key]; });
      }
      return { ok: true, applied: args.ops.length };
    }
    client.storageTest.setRpc(rpc);
    const forkFrameStorage = client.storageTest.storage;
    const clock = Date.now(); Date.now = () => clock;
    window.floodDone = new Promise(resolve => addEventListener('message', event => { if (event.data?.type === 'test-flood-complete') resolve(); }));
    window.testStorage = forkFrameStorage;
    window.stopStorage = client.storageTest.install(window);
    window.makeCard = () => {
      const life = client.createTavernMessageFrameLifecycle({sessionId:'session',content:'<p>Card</p>',leanRuntime:true,runtimeReporting:false,eager:true});
      window.cardLife = life;
      const doc = life.snapshot().visibleDocument, cap = doc.storage;
      const frame = document.createElement('iframe'); frame.id = 'card'; frame.sandbox = 'allow-scripts';
      frame.srcdoc = doc.html;
      document.body.append(frame);
      doc.ref(frame);
      window.revokeCard = () => doc.ref(null);
      window.cardCapability = cap;
    };
    window.readDisk = () => disk;
  ` })
  await page.evaluate(async () => { await testStorage.load(); makeCard() })
  const card = page.frameLocator('#card')
  await card.locator('p').waitFor()
  assert.equal(await card.locator('p').evaluate(() => { try { void parent.document; return false } catch { return true } }), true, 'the frame has a real opaque origin')
  await card.locator('p').evaluate(() => localStorage.setItem('theme', 'light'))
  await page.waitForFunction(() => testStorage.snapshot(cardCapability.namespace).theme === 'light')
  await page.evaluate(() => {
    const cap = cardCapability;
    const widget = document.createElement('iframe'); widget.id = 'widget'; widget.sandbox = 'allow-scripts';
    widget.srcdoc = '<script>parent.postMessage(' + JSON.stringify({ type:'dsh-tavern-frame-storage',token:cap.token,namespace:cap.namespace,op:'set',key:cap.namespace+'forged',value:'bad' }) + ',"*");<\/script><p>Widget</p>';
    document.body.append(widget);
  })
  await page.frameLocator('#widget').locator('p').waitFor()
  const cap = await page.evaluate(() => cardCapability)
  await card.locator('p').evaluate((_, cap) => {
    parent.postMessage({ type:'dsh-tavern-frame-storage',token:cap.token,namespace:cap.namespace,op:'set',key:'dsh-card:other:theme',value:'bad' }, '*')
    for (let i = 0; i < 2200; i++) parent.postMessage({ type:'dsh-tavern-frame-storage',token:cap.token,namespace:cap.namespace,op:'set',key:cap.namespace+'flood',value:String(i) }, '*')
    parent.postMessage({ type:'test-flood-complete' }, '*')
  }, cap)
  await page.evaluate(() => floodDone)
  await page.evaluate(() => testStorage.flush())
  let disk = await page.evaluate(() => readDisk())
  assert.equal(disk[cap.namespace + 'theme'], 'light')
  assert.equal(disk[cap.namespace + 'forged'], undefined)
  assert.equal(disk['dsh-card:other:theme'], undefined)
  assert.ok(Number(disk[cap.namespace + 'flood']) < 2199, 'flood is limited')
  await page.evaluate(() => {
    document.querySelector('#card').srcdoc = '<p>New document</p><script>parent.postMessage(' + JSON.stringify({ type:'dsh-tavern-frame-storage',token:cardCapability.token,namespace:cardCapability.namespace,op:'set',key:cardCapability.namespace+'stale',value:'bad' }) + ',"*");<\/script>';
  })
  await card.locator('p').filter({ hasText: 'New document' }).waitFor()
  await page.evaluate(() => stopStorage())
  disk = await page.evaluate(() => readDisk())
  assert.equal(disk[cap.namespace + 'stale'], undefined)
})
