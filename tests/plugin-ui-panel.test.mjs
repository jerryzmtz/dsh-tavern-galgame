import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const source = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
const start = source.indexOf('function createTavernUiExtensions()')
const factory = source.slice(start, source.indexOf('const tavernUiExtensions = createTavernUiExtensions()', start))

function load() {
  const context = {
    React: { createElement: (type, props, ...children) => ({ type, props, children }) },
    tavernPluginBoundary: () => 'Boundary',
    DshUi: { IconCordisPluginOutline14: () => 'PluginIcon' }
  }
  return vm.runInNewContext(factory + '; createTavernUiExtensions()', context)
}

test('插件面板：注册为当前游戏的侧栏页，卸载时移除；没有打开游戏时给出提示', () => {
  const ui = load()
  const tabs = new Map()
  ui.attachHost({ betterSidebar: { registerTab(tab) { tabs.set(tab.id, tab); return () => tabs.delete(tab.id) } } })
  const plugin = { ctx: { fiber: { name: 'memory-plugin' } } }
  Object.setPrototypeOf(plugin, ui.service)
  const seen = []
  const dispose = plugin.registerPanel({ id: 'state', title: '记忆', render: ({ gameId }) => { seen.push(gameId); return 'panel:' + gameId } })
  const tab = tabs.get('tavern-plugin:memory-plugin:state')
  assert.equal(tab.title, '记忆')
  assert.equal(ui.service.apiVersion, 2)
  const rendered = tab.component({ scope: { sessionId: 'game-1' } })
  assert.equal(rendered.type, 'Boundary')
  assert.equal(rendered.children[0], 'panel:game-1')
  assert.deepEqual(seen, ['game-1'])
  assert.match(tab.component({ scope: {} }).children[0].children[0], /请先打开一局游戏/)
  assert.throws(() => plugin.registerPanel({ id: 'state', title: '重复', render() {} }), /已注册/)
  assert.throws(() => plugin.registerPanel({ id: 'Bad Id', title: 'x', render() {} }), /id/)
  dispose()
  assert.equal(tabs.size, 0)
})

test('开始页分组：插件声明的分组排在 Tavern 自带分组之后，组内的页不再出现在「插件」「其他」里', () => {
  const ui = load()
  const plugin = { ctx: { fiber: { name: 'narrative-anchor' } } }
  Object.setPrototypeOf(plugin, ui.service)
  const dispose = plugin.registerStartGroup({ title: '叙事锚定', tabs: ['narrative-anchor:settings', 'state', 'dsh-tavern:status'] })
  assert.deepEqual(JSON.parse(JSON.stringify(ui.startGroups())), [{ title: '叙事锚定', tabs: ['narrative-anchor:settings', 'tavern-plugin:narrative-anchor:state', 'dsh-tavern:status'] }])
  assert.throws(() => plugin.registerStartGroup({ title: '', tabs: ['a:b'] }), /title/)
  assert.throws(() => plugin.registerStartGroup({ title: 'x', tabs: [] }), /tabs/)

  const start = source.indexOf('function TavernStartCards(props)')
  const body = source.slice(start, source.indexOf('function registerTavernStartPage', start))
  const h = (type, props, ...children) => ({ type, props, children: children.flat() })
  const Cards = vm.runInNewContext(body + '; TavernStartCards', { React: { createElement: h } })
  const options = ['dsh-tavern:status', 'narrative-anchor:settings', 'narrative-anchor:quick', 'tavern-plugin:narrative-anchor:state', 'tavern-plugin:other:x', 'misc:tab'].map(id => ({ id, label: id }))
  const tree = Cards({ newTabOptions: options, onNewTab() {}, pluginGroups: ui.startGroups() })
  const sections = tree.children.filter(child => child && child.type === 'section').map(section => [section.props['aria-label'], section.children[1].children.map(card => card.props.key)])
  assert.deepEqual(sections, [
    ['本局', ['dsh-tavern:status']],
    ['叙事锚定', ['narrative-anchor:settings', 'tavern-plugin:narrative-anchor:state']],
    ['插件', ['tavern-plugin:other:x']],
    ['其他', ['narrative-anchor:quick', 'misc:tab']],
  ])
  dispose()
  assert.equal(ui.startGroups().length, 0)
})

function loadWith(extra) {
  const context = {
    React: { createElement: (type, props, ...children) => ({ type, props, children }) },
    tavernPluginBoundary: () => 'Boundary', tavernErrorHub: { report() {} }, ...extra
  }
  return vm.runInNewContext(factory + '; createTavernUiExtensions()', context)
}

test('回合状态：getTurnState 走宿主，watchTurnState 只在状态变化时通知，卸载后停止', async () => {
  let state = { gameId: 'g', turn: 2, busy: false }, viewListener, sessionListener, running = false
  const calls = []
  const ui = loadWith({
    rpc: async (method, _args, sessionId) => { calls.push([method, sessionId]); return { state: { ...state } } },
    liveTavernView: { subscribe(sessionId, listener) { viewListener = listener; listener({}); return () => { viewListener = null } } }
  })
  ui.attachHost({ sessions: { list: { subscribe(listener) { sessionListener = listener; return () => { sessionListener = null } },
    getSnapshot: () => ({ byId: { g: { running } } }) } } })
  const plugin = { ctx: { fiber: { name: 'battle' } } }
  Object.setPrototypeOf(plugin, ui.service)
  assert.equal((await plugin.getTurnState('g')).turn, 2)
  assert.deepEqual(calls[0], ['pluginTurnState', 'g'])
  const seen = []
  const stop = plugin.watchTurnState('g', value => seen.push(value.turn + ':' + value.busy))
  const flush = () => new Promise(resolve => setTimeout(resolve, 0))
  await flush()
  viewListener({}); await flush()
  assert.deepEqual(seen, ['2:false'], '状态没变不重复通知')
  state = { gameId: 'g', turn: 2, busy: true }; running = true; sessionListener(); await flush()
  const before = calls.length
  sessionListener(); await flush()
  assert.equal(calls.length, before, '同一局运行状态没变时不重新读取')
  state = { gameId: 'g', turn: 3, busy: false }; viewListener({}); await flush()
  assert.deepEqual(seen, ['2:false', '2:true', '3:false'])
  stop()
  assert.equal(viewListener, null); assert.equal(sessionListener, null)
})

test('插件输入：setInput 只填草稿，submitInput 发送；没打开这一局时报错', async () => {
  const actions = []
  const ui = loadWith({})
  ui.attachHost({ sessions: { scope: id => id === 'g' ? { id } : null },
    get: name => name === 'conversation' ? { input: { for: () => ({ setDraft: text => actions.push('draft:' + text), submit: mode => actions.push('submit:' + mode) }) } } : null })
  const plugin = { ctx: { fiber: { name: 'battle' } } }
  Object.setPrototypeOf(plugin, ui.service)
  plugin.setInput({ gameId: 'g', text: '攻击' })
  assert.equal((await plugin.submitInput({ gameId: 'g', text: '防御' })).submitted, true)
  assert.deepEqual(actions, ['draft:攻击', 'draft:防御', 'submit:queue'])
  await assert.rejects(plugin.submitInput({ gameId: 'g', text: '  ' }), /不能为空/)
  assert.throws(() => plugin.setInput({ gameId: 'other', text: 'x' }), /没有在当前页面打开/)
})

test('插件全屏界面：openOverlay 挂到页面上，Esc 或 close 关闭，关闭时回调一次', () => {
  const listeners = new Map(), body = []
  const container = { className: '', attrs: {}, setAttribute(key, value) { this.attrs[key] = value }, remove() { body.splice(body.indexOf(this), 1) } }
  const document = { createElement: () => container, body: { append: node => body.push(node) },
    addEventListener: (type, fn) => listeners.set(type, fn), removeEventListener: type => listeners.delete(type) }
  let rendered = null, unmounted = 0
  const require = name => name === 'react-dom/client' ? { createRoot: () => ({ render: tree => { rendered = tree }, unmount: () => { unmounted++ } }) } : null
  const ui = loadWith({ document, require })
  const plugin = { ctx: { fiber: { name: 'battle' } } }
  Object.setPrototypeOf(plugin, ui.service)
  let closed = 0, received
  const overlay = plugin.openOverlay({ gameId: 'g', render: props => { received = props; return 'screen' }, onClose: () => closed++ })
  assert.equal(body.length, 1); assert.equal(container.className, 'dsh-tavern-plugin-overlay')
  assert.equal(rendered.type, 'Boundary')
  assert.equal(rendered.children[0].type(), 'screen')
  assert.equal(received.gameId, 'g')
  listeners.get('keydown')({ key: 'Escape', stopPropagation() {} })
  assert.equal(body.length, 0); assert.equal(unmounted, 1); assert.equal(closed, 1)
  overlay.close(); received.close()
  assert.equal(closed, 1, '重复关闭无效')
  plugin.openOverlay({ dismissible: false, render: () => 'x' })
  listeners.get('keydown')({ key: 'Escape', stopPropagation() {} })
  assert.equal(body.length, 1, 'dismissible:false 时 Esc 不关闭')
  assert.throws(() => plugin.openOverlay({}), /render/)
})

test('插件资源地址：assetUrl 按插件名指向 assets/ 下的文件，拒绝越界路径', () => {
  const ui = load()
  const plugin = { ctx: { fiber: { name: 'dsh-tavern-battle' } } }
  Object.setPrototypeOf(plugin, ui.service)
  assert.equal(plugin.assetUrl('map/森林 1.png'), '/api/dsh-tavern/plugin-assets/dsh-tavern-battle/map/' + encodeURIComponent('森林 1.png'))
  for (const bad of ['', '../x.png', 'a/../../b', '.env', '/abs.png']) assert.throws(() => plugin.assetUrl(bad), /相对路径/, bad)
})
