// Real assistant renderer + dock with a fixture plugin using the public `tavernUi`
// service: anchored media, text markers inside markdown and card HTML, a custom
// media renderer, message and composer buttons, and the built-in scene picture placed at its anchor.
// DSH_BOOT_MODULE=/path/dsh-app-boot/lib/index.js node tests/browser/plugin-api-browser-smoke.mjs
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const bootUrl = pathToFileURL(process.env.DSH_BOOT_MODULE)
const hostRequire = createRequire(new URL('../../dsh-client-ui-trajectory/package.json', bootUrl))
const localRequire = createRequire(import.meta.url)
const require = { resolve(name) { try { return hostRequire.resolve(name) } catch { return localRequire.resolve(name) } } }
let bundle = 'const modules={};\n'
const modules = ['react', 'scheduler', 'react-dom', 'react-dom/client']
const files = [['react.production.js', 'react.production.min.js'], ['scheduler.production.js', 'scheduler.production.min.js'], ['react-dom.production.js', 'react-dom.production.min.js'], ['react-dom-client.production.js', 'react-dom-client.production.min.js']]
for (let i = 0; i < modules.length; i++) {
  let source
  for (const file of files[i]) {
    try { source = await readFile(join(dirname(require.resolve(modules[i])), 'cjs', file), 'utf8'); break } catch (error) { if (error.code !== 'ENOENT') throw error }
  }
  if (!source && modules[i] === 'react-dom/client') {
    bundle += `modules['react-dom/client']={createRoot:modules['react-dom'].createRoot,hydrateRoot:modules['react-dom'].hydrateRoot};\n`
    continue
  }
  if (!source) throw new Error('Missing production bundle for ' + modules[i])
  bundle += `modules[${JSON.stringify(modules[i])}]=(()=>{const module={exports:{}};const exports=module.exports;const require=name=>modules[name];\n${source}\nreturn module.exports;})();\n`
}
const client = await readFile(new URL('../../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
const fixtureClient = client
  .replace('const tavernSessionModes = { values: {},', 'const tavernSessionModes = { values: {"plugin-game":"story"},')
  .replace('let tavernSessionSignals;', 'let tavernSessionSignals = { subscribe: () => () => {} };')
  .replace('\t\treturn module.exports;\n\t}\n});', '\t\texports.__tavernUi = tavernUiExtensions.service;\n\t\treturn module.exports;\n\t}\n});')
if (!fixtureClient.includes('__tavernUi')) throw new Error('fixture could not expose tavernUi')
const css = await readFile(new URL('../../tavern-plugin/lib/client-assets/tavern.css', import.meta.url), 'utf8')
const story = [
  '雨夜，林岚推开酒馆的门，**风**卷着雨丝灌进来。',
  '她抖落斗篷上的水珠，朝吧台走去。image###1girl, cloak, tavern, rain###',
  '老板抬头看了她一眼，没有说话。'
].join('\n\n')
const statusBar = '<div class="status" style="border:1px solid #ccc;padding:6px">状态栏：HP 10 image###status icon###</div>'
const svg = color => `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="${color}"/><text x="20" y="100" font-size="28" fill="#fff">plugin image</text></svg>`
const items = [
  { id: 'anchored', owner: 'demo-plugin', turn: 1, kind: 'image', status: 'ready', anchor: '林岚推开酒馆的门，风卷着雨丝灌进来。', caption: '锚在第一段之后', attachment: { attachmentId: 'a', mediaType: 'image/png' }, updatedAt: 1 },
  { id: 'unplaced', owner: 'demo-plugin', turn: 1, kind: 'image', status: 'ready', anchor: '正文里没有这句', caption: '找不到锚点，放在末尾', attachment: { attachmentId: 'b', mediaType: 'image/png' }, updatedAt: 1 },
  { id: 'pending', owner: 'demo-plugin', turn: 1, kind: 'image', status: 'pending', progress: 0.4, anchor: '', caption: '', attachment: null, updatedAt: 1 },
  { id: 'failed', owner: 'demo-plugin', turn: 1, kind: 'video', status: 'failed', error: '上游超时', anchor: '', caption: '', attachment: null, updatedAt: 1 },
  { id: 'custom', owner: 'demo-plugin', turn: 1, kind: 'demo-plugin/card', status: 'ready', anchor: '老板抬头看了她一眼，没有说话。', caption: '', attachment: null, data: { mood: '警惕' }, updatedAt: 1 }
]
const script = `${bundle}
const React=modules.react;
const primitives={MarkdownText:props=>React.createElement('p',null,props.text)};
window.__ModuleLoader__={load(d){window.client=d.factory(name=>modules[name]||primitives);}};
${fixtureClient}
const ui=client.__tavernUi;
const log=text=>{document.querySelector('#log').textContent+=text+'\\n';};
ui.registerTextMarker({pattern:/image###(.+?)###/,render:({groups,streaming})=>React.createElement('span',{className:'demo-marker','data-tags':groups[0]},'［插件标记：'+groups[0]+(streaming?'（生成中）':'')+'］')});
ui.registerMediaRenderer('demo-plugin/card',({item})=>React.createElement('div',{className:'demo-card'},'自定义卡片：情绪 '+item.data.mood));
ui.registerMessageAction({id:'redraw',label:'配图',when:({turn})=>turn>0,run:async ctx=>log('message action '+JSON.stringify(ctx))});
ui.registerComposerAction({id:'gen',label:'插件生图',run:async ctx=>log('composer action '+JSON.stringify(ctx))});
const components={};
client.createTavernAssistantRendererFeatureModule().register({ctx:{effect:(fn,label)=>label==='dsh-tavern: game script owner'?()=>{}:fn()},slots:{inject:(_name,fn)=>fn(),register:(spec,component)=>{components[spec.key||spec.id]=component;return ()=>{};}}});
const dockSlots={};
client.createPlayControlsFeatureModule().register({ctx:{get:()=>undefined,effect:fn=>fn(),betterSidebar:{registerTab:()=>()=>{}},sessions:{refresh:async()=>{},subagentAddress:()=>null},remote:{commands:{execute:async()=>({ok:true})}}},slots:{inject:(_name,fn)=>fn(),register:(spec,component)=>{dockSlots[spec.id]=component;return ()=>{};}}});
const props={sessionId:'plugin-game',node:{data:{status:'completed',blocks:[],finalNode:{seq:1}},location:{kind:'turn',turn:{turn:1,status:'closed'}}},useTurnData:()=>null,fileMentions:()=>undefined};
modules['react-dom/client'].createRoot(document.querySelector('#app')).render(React.createElement(components['assistant-step'],props));
const dockProps={sessionId:'plugin-game',useSession:select=>select({running:false}),useChat:select=>select({legacy:{nodes:[{kind:'assistant',messageId:'fixture-reply'}]}})};
modules['react-dom/client'].createRoot(document.querySelector('#dock')).render(React.createElement(dockSlots['dsh-tavern-candidate-actions'],dockProps));
`
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1')
    if (url.pathname === '/runner.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }).end(script); return }
    if (url.pathname === '/api/dsh-tavern/events') { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.write(': ready\n\n'); return }
    if (url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>插件接口验证</title><style>:root{--dsw-alias-label-primary:#222;--dsw-alias-label-secondary:#666;--dsw-alias-border-l2:#ddd}body{font:16px sans-serif;max-width:880px;margin:32px auto;padding:12px}.demo-marker{color:#a33}.demo-card{padding:8px;border:1px dashed #999}${css}</style><h1>插件接口验证</h1><div id="app"></div><div id="dock"></div><pre id="log"></pre><script src="/runner.js"></script>`)
      return
    }
    if (url.pathname === '/api/dsh-tavern/scene-image') { res.writeHead(200, { 'Content-Type': 'image/svg+xml' }).end(svg('#a60')); return }
    if (url.pathname === '/api/dsh-tavern/plugin-media') {
      res.writeHead(200, { 'Content-Type': 'image/svg+xml' }).end(svg(url.searchParams.get('id') === 'anchored' ? '#2a6' : '#36c')); return
    }
    const method = url.pathname.split('/').pop()
    let result = {}
    if (method === 'getSession') result = { view: { mode: 'story', latestAssistantTurn: 1, releaseCapabilities: { sceneImages: true }, card: { name: '测试卡' },
      replyProjections: [{ version: 2, turn: 1, parts: [{ kind: 'markdown', text: story }, { kind: 'html', content: statusBar }] }] } }
    else if (method === 'sceneImageStatus') result = { illustration: { key: 'k1', turn: 1, status: 'succeeded', enabled: true, versions: [{ id: 'v1', anchor: '她抖落斗篷上的水珠，朝吧台走去。' }], reference: {} } }
    else if (method === 'getSceneImageSettings') result = { settings: { enabled: false } }
    else if (method === 'pluginMediaTurns') result = { turns: [1] }
    else if (method === 'pluginMediaForTurn') result = { key: 'k1', items }
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: true, ...result }))
  } catch (error) { res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: false, error: error.message })) }
})
await new Promise(resolve => server.listen(Number(process.env.PORT) || 0, '127.0.0.1', resolve))
console.log('http://127.0.0.1:' + server.address().port)
