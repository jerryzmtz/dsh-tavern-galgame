// private fork: assert the extracted native service/retained stage owner contract.
// private fork: exercise the extracted upstream owners with the private adapters attached.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { forkTextAreaSource } from './helpers/fork-spinner.mjs' // private fork (UI standard phase 2 batch 16): ForkTextArea
import test from 'node:test'
import vm from 'node:vm'
import { registerTavernHttpRoutes } from '../tavern-plugin/lib/http/routes.js'

const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8')
const h = (type, props, ...children) => ({ type, props: props || {}, children })
const flatten = node => !node || typeof node !== 'object' ? [] : [node, ...node.children.flat(Infinity).flatMap(flatten)]

test('status controller retains upstream identity-based Guide deletion and passes its new actions to the fork view', async () => {
  const source = await read('tavern-plugin/src/client/features/play-controls.js')
  const start = source.indexOf('function TavernStatusPanel(props)')
  const end = source.indexOf('// @include fork-status-panel.js', start)
  const calls = [], invalidated = [], view = { mode: 'story', card: { path: 'cards/a.json' }, guides: [{ id: 'g1', text: 'Keep this guide' }] }
  const context = {
    React: { createElement: h, useState: value => [value, () => {}], useEffect() {}, useRef: value => ({ current: value }) },
    useTavernConfirm: () => async () => true, usePersistentError: () => ['', () => {}],
    useLiveTavernView: () => ({ view, phase: 'ready' }), isMissingTavernCardError: () => false,
    latestTavernAssistantMessageId: () => 'reply', ForkStatusPanelView: 'fork-panel',
    rpc: async (method, args, sessionId) => calls.push({ method, args, sessionId }),
    liveTavernView: { invalidate: id => invalidated.push(id) }
  }
  vm.runInNewContext(source.slice(start, end) + '\nthis.render = TavernStatusPanel', context)
  const node = context.render({ sessionId: 's', useSession: fn => fn({ running: false }), useChat: fn => fn() })
  assert.equal(node.type, 'fork-panel')
  assert.equal(typeof node.props.saveGuideLibrary, 'function')
  assert.equal(typeof node.props.openWorldBookDetail, 'function')
  await node.props.removeGuide(view.guides[0], 0)
  assert.deepEqual(calls.map(call => JSON.parse(JSON.stringify(call))), [{ method: 'deleteGuide', args: { id: 'g1' }, sessionId: 's' }])
  assert.deepEqual(invalidated, ['s'])
})

test('fork panel exposes Guide library, resource details, storage migration and lazy character archives', async () => {
  const context = {
    React: { createElement: h, Fragment: 'fragment', useEffect() {} },
    TavernBackgroundWait: 'wait', TavernStorageMigration: 'migration', TavernCardAppDock: 'dock', TavernLazyDetails: 'lazy', TavernLedger: 'ledger', TavernPluginTasks: 'plugin-tasks'
  }
  vm.runInNewContext(forkTextAreaSource + await read('tavern-plugin/src/client/fork-status-panel.js') + '\nthis.render = ForkStatusPanelView', context)
  const removed = [], opened = [], guide = { id: 'g1', text: 'Guide' }
  const tree = context.render({
    view: { mode: 'story', card: { path: 'cards/a.json' }, guides: [guide], characterDesigns: { characters: [{ name: 'A', sections: [] }] } },
    props: { sessionId: 's', openStyleTab: (...args) => opened.push(args) }, guideInputRef: { current: null },
    currentResourceBinding: {}, removeGuide: (...args) => removed.push(args), removeCharacterDesign: name => removed.push(name), saveGuideLibrary() {}, openWorldBookDetail() {}
  })
  const nodes = flatten(tree)
  nodes.find(node => node.props['aria-label'] === '删除这条指引').props.onClick()
  assert.deepEqual(removed, [[guide, 0]])
  nodes.find(node => node.children.includes('打开 Guide 库 ↗')).props.onClick()
  assert.deepEqual(opened, [['dsh-tavern:guide-library']])
  assert.ok(nodes.some(node => node.type === 'migration'))
  assert.ok(nodes.some(node => node.type === 'ledger'))
  // private fork: manual upstream plugin tasks remain reachable beside the standalone ledger.
  assert.equal(nodes.find(node => node.type === 'plugin-tasks').props.sessionId, 's')
  assert.ok(nodes.some(node => node.props['aria-label'] === '新 Guide 内容'))
  const archive = nodes.find(node => node.type === 'lazy' && typeof node.props.render === 'function')
  assert.ok(archive)
  // private fork: upstream character deletion must also reach the rewritten panel.
  flatten(archive.props.render()).find(node => node.children.includes('删除这个人物档案')).props.onClick()
  assert.equal(removed.at(-1), 'A')
  assert.ok(nodes.some(node => node.children.includes('打开世界书 ↗') && !node.props.disabled))
  assert.ok(nodes.some(node => node.children.includes('保存到 Guide 库') && !node.props.disabled))
})

test('upstream HTTP owner invokes retained handlers, never obsolete asset handlers, before card images', async () => {
  const handlers = new Map(), calls = []
  const adapter = name => ({ serve: async () => { calls.push(name); return false } })
  const ctx = { get: name => name === 'connection' ? {requestRejection:() => undefined} : ({ register: spec => { handlers.set(spec.path, spec.handler); return () => {} } }), effect: fn => fn() }
  registerTavernHttpRoutes({
    ctx, runtimeReadiness: Promise.resolve({ ok: true }), runtimeGeneration: 'test',
    widgetService: adapter('widgets'), fontLibrary: adapter('fonts'), cardAssetImports: adapter('imports'),
    libraryPacks: adapter('libraries'), cardPacks: adapter('packs'), cardAssets: adapter('assets'),
    LIVE2D_ROUTE_PREFIX: '/api/dsh-tavern/live2d/',
    fileResources: { cardImagePreview: async () => undefined }
  })
  let status, body
  await handlers.get('/api/dsh-tavern')({ method: 'GET', url: '/api/dsh-tavern/card-image?path=cards/a.json', headers: {host:'localhost:3081'} }, {
    writeHead: code => { status = code }, end: value => { body = value }
  })
  assert.equal(status, 404)
  assert.equal(body, 'not found')
  assert.deepEqual(calls, ['fonts'])
})
