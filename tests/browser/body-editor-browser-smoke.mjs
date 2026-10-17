// Manual browser verification of the production controls against a real native Session.
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { Session } from '../fixtures/dsh-session-host.mjs'
import { createBodyEditor } from '../../tavern-plugin/lib/domain/body-editor.js'
import { createStoryTimeline } from '../../tavern-plugin/lib/domain/story-timeline.js'
import { projectReplyLayers, projectReplyHistory } from '../../tavern-plugin/lib/domain/reply-presentation.js'
const pluginRequire = createRequire(new URL('../../tavern-plugin/package.json', import.meta.url))
const hostRequire = createRequire(pluginRequire.resolve('@deepseek-ai/dsh-tools'))
const reactDomFile = hostRequire.resolve('react-dom/client')
const reactRequire = createRequire(reactDomFile)
const reactFile = reactRequire.resolve('react')
const modules = new Map()
async function bundle(file) {
  if (modules.has(file)) return
  modules.set(file, '')
  let code = await readFile(file, 'utf8')
  const local = createRequire(file)
  const requires = [...code.matchAll(/require\(['"]([^'"]+)['"]\)/g)]
  for (const match of requires) {
    const target = match[1] === 'react' ? reactFile : local.resolve(match[1])
    await bundle(target)
    code = code.replaceAll(match[0], 'require(' + JSON.stringify(target) + ')')
  }
  modules.set(file, 'function(module,exports,require){' + code + '\n}')
}
await bundle(reactFile); await bundle(reactDomFile)
const libraries = 'const process={env:{NODE_ENV:"production"}};const modules={' + [...modules].map(([file, code]) => JSON.stringify(file) + ':' + code).join(',') + '};const cache={};function require(id){if(cache[id])return cache[id].exports;const m=cache[id]={exports:{}};modules[id](m,m.exports,require);return m.exports;}const React=require(' + JSON.stringify(reactFile) + ');const ReactDOM=require(' + JSON.stringify(reactDomFile) + ');'
const client = await readFile(new URL('../../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
const controls = client.slice(client.indexOf('const bodyEditPanel ='), client.indexOf('function CandidateDockActions('))
let session = Session.create('body-editor-browser')
const text = '<dream_plot>\n<dream_body>\n雨停了。\n\n```html\n<div style="padding:12px;background:#e8eef6">HTML 状态：体力 9</div>\n```\n\n他走向灯塔。\n</dream_body>\n</dream_plot>'
session.append('user/message', { id: 'u', role: 'user', content: [{ type: 'text', text: '继续' }], source: { kind: 'user' } }, { surfaceOp: 'append' })
session.append('assistant/message', { turn: 2, step: 1, message: { id: 'a', role: 'assistant', content: [{ type: 'text', text }], source: { kind: 'model', provider: 'test', model: 'test' } } }, { surfaceOp: 'append', sourceEventSeqs: [] })
let chat = { id: 'browser-test', sessionId: session.id, mode: 'story', _storageRevision: 1, messages: [{ role: 'user', text: '继续' }, { role: 'assistant', text, sourceText: text, turn: 2 }], posture: '体力 9', variables: { hp: 9 }, settleStatus: 'done' }
const present = async chat => ({ ...chat, canRollback: true, replyProjections: projectReplyHistory(chat.messages).projections, nativeText: session.deriveMessages().at(-1).content[0].text })
const editor = createBodyEditor({ chats: { forSession: async () => structuredClone(chat), update: async (_id, fn) => { chat = fn(structuredClone(chat)); chat._storageRevision++; return structuredClone(chat) } }, sessions: { get: () => ({ session, phase: { kind: 'idle' } }), flush: async () => {} }, timeline: createStoryTimeline(), activity: () => ({ busy: false }), project: async text => projectReplyLayers(text), present })
const script = libraries + `
let currentView = null, refresh = () => {};
async function rpc(method,args){const r=await fetch('/'+method,{method:'POST',body:JSON.stringify(args||{})});const v=await r.json();if(v.error)throw Error(v.error);return v;}
const liveTavernView={setView(id,view){currentView=view;refresh();}};
const tavernCoordination={invalidate(){}};
const useLiveTavernView=()=>({view:currentView}), useTavernCoordination=()=>({view:{activity:{busy:false}}}), describeTavernActivity=x=>x;
const latestTavernAssistantMessageId=()=> 'a';
const setRegenPanel=()=>{},setCandidatePanel=()=>{},setCandidateGuidePanel=()=>{},notifyTavernDataChanged=()=>{};
const tavernErrorHub={report:(name,e)=>alert(e.message)};
const TavernRollbackAction=()=>null,TavernCompactionAction=()=>null;
` + controls + `
function App(){const [v,set]=React.useState(0);refresh=()=>set(x=>x+1);React.useEffect(()=>{rpc('view').then(r=>liveTavernView.setView('',r.view));},[]);
const props={sessionId:'body-editor-browser',useSession:fn=>fn({running:false}),useChat:fn=>fn()};
return React.createElement('main',null,React.createElement('h2',null,'正文编辑验证'),currentView?React.createElement('div',null,projectDisplay(currentView),React.createElement('p',null,'状态保持：'+currentView.posture),React.createElement(TavernMoreActions,props),React.createElement(BodyEditPanel,props)):null);}
function projectDisplay(v){const p=v.replyProjections[0];return p?p.parts.map((p,i)=>p.kind==='html'?React.createElement('iframe',{key:i,srcDoc:p.content,title:'只读 HTML',style:{height:65,border:0}}):React.createElement('p',{key:i},p.text)):React.createElement('p',null,v.messages.at(-1).text);}
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(App));`
const css = await readFile(new URL('../../tavern-plugin/lib/client-assets/tavern.css', import.meta.url), 'utf8')
const server = createServer(async (req, res) => {
  try {
    if (req.url === '/app.js') { res.setHeader('content-type', 'text/javascript'); return res.end(script) }
    if (req.method === 'POST') {
      let body = ''; for await (const chunk of req) body += chunk
      const input = JSON.parse(body || '{}')
      const result = req.url === '/getBodyEdit' ? { edit: await editor.read(session.id) } : req.url === '/saveBodyEdit' ? { view: await editor.save(session.id, input) } : { view: await present(chat) }
      res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify(result))
    }
    res.setHeader('content-type','text/html;charset=utf-8');res.end('<!doctype html><html lang="zh"><style>'+css+':root{--dsw-alias-border-l2:#ddd;--dsw-specific-tip:#f8f8f8;--dsw-alias-label-primary:#222;--dsw-alias-label-secondary:#666;--dsw-alias-bg-base:#fff;--dsw-alias-button-info-fill:#a66b35}main{max-width:760px;margin:40px auto;font:18px sans-serif}textarea{box-sizing:border-box;width:100%;padding:12px;font:18px sans-serif}button{padding:10px;margin:5px;cursor:pointer}iframe{width:100%}</style><div id="root"></div><script src="/app.js"></script>')
  } catch(error) { res.setHeader('content-type','application/json');res.end(JSON.stringify({error:error.message})) }
})
server.listen(Number(process.env.DSH_BODY_EDIT_TEST_PORT) || 0, '127.0.0.1', () => console.log('http://127.0.0.1:' + server.address().port))
