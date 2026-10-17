// private fork: real bundled MVU + companion hooks through the production edit executor, fully offline.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { createTavernScriptHostAdapter } from '../tavern-plugin/lib/domain/tavern-script-host-adapter.js'
import { projectTavernHelperContext } from '../tavern-plugin/lib/domain/tavern-helper-context.js'
import { widgetVariableDigest } from '../tavern-plugin/lib/domain/widget-variables.js'
import { TAVERN_RUNTIME_ASSET_PREFIX, readTavernRuntimeAsset } from '../tavern-plugin/lib/domain/tavern-runtime-assets.js'
const root = new URL('../', import.meta.url)

test('official MVU edit clamps through card validation without replaying MESSAGE_RECEIVED', { timeout: 60000 }, async t => {
  const client = await readFile(new URL('tavern-plugin/lib/client.js', root))
  const bundle = await readFile(new URL('tavern-plugin/lib/vendor/magvarupdate/host-build/artifact/bundle.js', root))
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost')
    try {
      if (url.pathname === '/client.js' || url.pathname === '/mvu.js') { res.writeHead(200, { 'content-type': 'text/javascript' }).end(url.pathname === '/client.js' ? client : bundle); return }
      if (url.pathname.startsWith(TAVERN_RUNTIME_ASSET_PREFIX)) {
        const asset = await readTavernRuntimeAsset(url.pathname); res.writeHead(200, { 'content-type': asset.mediaType }).end(asset.body); return
      }
      if (url.pathname === '/version') { res.end(JSON.stringify({ pkgVersion: '1.12.14' })); return }
      if (url.pathname === '/') { res.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><meta charset="utf-8"><script>window.__ModuleLoader__={load(d){window.client=d.factory(()=>({}));}};</script><script src="/client.js"></script>'); return }
      res.writeHead(404).end('Offline fixture: resource unavailable')
    } catch (error) { res.writeHead(500).end(error.message) }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const origin = 'http://127.0.0.1:' + server.address().port
  const browser = await chromium.launch({ headless: true, args: ['--explicitly-allowed-ports=' + server.address().port] })
  t.after(() => browser.close())
  const page = await browser.newPage(), errors = []
  await page.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort())
  page.on('pageerror', error => errors.push(error.message))
  const variables = { stat_data: { hp: 10, bag: {} }, schema: { type: 'object', properties: { hp: { type: 'number' }, bag: { type: 'object', extensible: true, properties: {} } } }, display_data: {}, delta_data: {}, initialized_lorebooks: {} }
  const chat = { id: 'fixture', sessionId: 'fixture', mode: 'story', mvu: { enabled: true, owner: 'official' }, messages: [{ role: 'assistant', turn: 1, text: 'Synthetic opening', swipeId: 0, swipes: ['Synthetic opening'], variables: [variables] }] }
  let adapter, writes = 0, finishChatInitialization
  // private fork: official MVU's detached initial chat-scope cleanup is not part of CHAT_CHANGED's receipt.
  const chatInitialized = new Promise(resolve => { finishChatInitialization = resolve })
  adapter = createTavernScriptHostAdapter({ resolveChat: async () => chat, writeChat: async () => { writes++ }, readCard: async () => ({ name: 'Synthetic card' }), worldBooks: { bound: async () => null },
    scriptDispatch: { status: () => ({ ready: true }), async dispatch(sessionId, name, args, context, work) {
      const result = await page.evaluate(async ({ name, args, context, eventId }) => {
        const diagnostics = []
        try { const result = await runtime.emit(name, args, context, diagnostics, eventId); return { handled: true, args: result, diagnostics } }
        catch (error) { return { handled: false, error: error.message, diagnostics } }
      }, { name, args, context, eventId: work.eventId })
      return result
    } }
  })
  await page.exposeFunction('fixtureRpc', async (method, args) => {
    if (method === 'updateTavernHelperVariables') {
      const result = args.option?.type === 'global' ? { updated: true } : await adapter.updateVariables('fixture', args.option, args.variables, 0, args.eventId)
      if (args.option?.type === 'chat' && !args.eventId) finishChatInitialization()
      return result
    }
    if (method === 'updateTavernHelperMessages') return adapter.updateMessages('fixture', args.messages, 0, args.eventId)
    if (method === 'getTavernHelperContext') return { context: await adapter.context('fixture') }
    if (method === 'getTavernHelperWorldbook') return { worldbook: { name: 'Fixture', entries: [] } }
    return {}
  })
  await page.goto(origin)
  const view = { chatId: 'fixture', card: { name: 'Synthetic card' }, tavernHelper: projectTavernHelperContext(chat), tavernHelperWorldbook: { name: 'Fixture', entries: [] }, tavernRuntimePolicy: { trustedCardMode: true }, tavernMvuRuntime: { owner: 'official', assetUrl: '/mvu.js' },
    tavernHelperScripts: [{ id: 'guard', name: 'Synthetic schema hook', data: {}, buttons: [], content: `
      await waitGlobalInitialized('Mvu');
      window.fixtureReceived=0;window.fixtureBefore=0;
      eventOn('MESSAGE_RECEIVED',()=>{window.fixtureReceived++;});
      eventOn(Mvu.events.VARIABLE_UPDATE_ENDED,(next)=>{next.stat_data.hp=z.number().min(0).max(100).catch(100).parse(next.stat_data.hp);});
      eventOn(Mvu.events.BEFORE_MESSAGE_UPDATE,(context)=>{window.fixtureBefore++;context.message_content='Do not persist hook prose';});
    ` }] }
  await page.evaluate(view => {
    window.runtimeErrors=[];
    window.runtime=client.createTavernHelperScriptRuntime({ rpc: fixtureRpc, onMutation(){}, resolveError(){}, reportError(source,error){runtimeErrors.push(source+': '+error.message);}, async onReady(){await runtime.emit('CHAT_CHANGED',['fixture'],view.tavernHelper);window.fixtureInitialized=true;} });
    runtime.sync('fixture',view)
  }, view)
  await page.waitForFunction(() => window.fixtureInitialized, null, { timeout: 15000 })
  await chatInitialized
  writes = 0
  const declarations = { reads: { hp: { source: 'mvu', path: '/hp' } }, writes: { hp: { source: 'mvu', path: '/hp', scope: 'exact', ops: ['replace'] } } }
  const result = await adapter.editMvuVariables({ operationId: 'edit', sessionId: 'fixture', messageId: 0, swipeId: 0, expectedLifecycleRevision: 0, baselineDigest: widgetVariableDigest(chat.messages[0].variables[0]), declarations, operations: [{ writeId: 'hp', op: 'replace', value: 200 }] })
  assert.equal(result.updated, true, JSON.stringify(result))
  assert.equal(result.variables.stat_data.hp, 100)
  assert.equal(result.editAudit.normalized, true)
  assert.equal(writes, 0)
  assert.equal(chat.messages[0].variables[0].stat_data.hp, 10)
  assert.equal(chat.messages[0].text, 'Synthetic opening')
  const child = page.frames().find(frame => frame !== page.mainFrame())
  assert.deepEqual(await child.evaluate(() => [window.fixtureReceived, window.fixtureBefore]), [0, 1])
  assert.deepEqual(errors, [])
  await page.evaluate(() => runtime.dispose())
})
