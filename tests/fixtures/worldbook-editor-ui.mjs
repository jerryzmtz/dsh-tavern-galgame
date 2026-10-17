// Actual editor + resource mutation + foreground projector; isolated fixture data.
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { inspectWorldBookDocument, updateWorldBookDocument } from '../../tavern-plugin/lib/domain/worldbook-resource.js'
import { createForegroundWorldbook } from '../../tavern-plugin/lib/domain/foreground-worldbook.js'
const require = createRequire(join(process.env.DSH_ROOT, 'node_modules/@deepseek-ai/dsh-client-ui-trajectory/package.json'))
const runtime = { render() { throw new Error('This editor fixture contains no templates') } }
let document = { name: '世界书改造验证', entries: {
  0: { uid: 0, comment: '角色库开头', content: '<角色库>', constant: true, order: 10, position: 0 },
  1: { uid: 1, comment: 'Alice', content: 'Alice 在钟楼值班。', key: ['Alice'], order: 20, position: 0 },
  2: { uid: 2, comment: '角色库结尾', content: '</角色库>', constant: true, order: 30, position: 0 }
} }
const record = () => ({ source: { kind: 'standalone', path: 'fixture.json' }, view: inspectWorldBookDocument(document) })
const project = createForegroundWorldbook({ bound: async () => record(), runtime: async () => runtime, globalVariables: async () => ({}) })
const source = await readFile(new URL('../../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
const editor = source.slice(source.indexOf('function WorldBookEditor('), source.indexOf('function WorldBookLibraryTab('))
const groups = source.slice(source.indexOf('function groupWorldBookEditorEntries('), source.indexOf('function createWorldBookLibraryFeatureModule('))
let script = 'const modules={};\n'
for (const [name, file] of [['react', 'react.production.js'], ['scheduler', 'scheduler.production.js'], ['react-dom', 'react-dom.production.js'], ['react-dom/client', 'react-dom-client.production.js']]) {
  script += `modules[${JSON.stringify(name)}]=(()=>{const module={exports:{}};const exports=module.exports;const require=name=>modules[name];\n${await readFile(join(dirname(require.resolve(name)), 'cjs', file), 'utf8')}\nreturn module.exports;})();\n`
}
script += `const React=modules.react,h=React.createElement;
const usePersistentError=()=>React.useState('');const useTavernConfirm=()=>async()=>true;const notifyTavernDataChanged=()=>{};
async function rpc(method,args){const response=await fetch('/rpc',{method:'POST',body:JSON.stringify({method,args})});const data=await response.json();if(data.error)throw Error(data.error);return data;}
${groups}\n${editor}
function App(){const [record,setRecord]=React.useState(${JSON.stringify(record())}),[result,setResult]=React.useState('');return h(React.Fragment,null,h(WorldBookEditor,{record,sessionId:'fixture',onBack:()=>{},onSaved:setRecord}),h('button',{onClick:async()=>setResult((await rpc('preview',{})).context)},'验证当前输入：找 Alice'),h('pre',{id:'preview'},result));}
modules['react-dom/client'].createRoot(document.querySelector('#app')).render(h(App));`
const css = await readFile(new URL('../../tavern-plugin/lib/client-assets/tavern.css', import.meta.url), 'utf8')
const page = `<!doctype html><meta charset="utf-8"><title>世界书编辑验证</title><style>${css}\nbody{font:16px system-ui;background:#222;color:#eee;margin:30px}input,textarea,select{color:#eee;background:#333}button{cursor:pointer}#preview{white-space:pre-wrap}</style><div id="app"></div><script>${script.replaceAll('</script', '<\\/script')}</script>`
const server = createServer(async (req,res) => {
  if(req.url === '/favicon.ico') return res.writeHead(204).end()
  if(req.url === '/') return res.writeHead(200,{'content-type':'text/html; charset=utf-8'}).end(page)
  try {
    let body='';for await(const chunk of req)body+=chunk
    const {method,args}=JSON.parse(body)
    let result
    if(method==='updateWorldBook'){document=updateWorldBookDocument(document,args.update).document;result=record()}
    else if(method==='preview') result=await project({chat:{messages:[{role:'assistant',text:'天气晴朗',turn:1}]},card:{},userText:'找 Alice'})
    else throw Error('Unsupported method')
    res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify(result))
  }catch(error){res.writeHead(400,{'content-type':'application/json'}).end(JSON.stringify({error:error.message}))}
})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
console.log(`http://127.0.0.1:${server.address().port}/`)
process.on('SIGINT',()=>server.close(()=>process.exit(0)))
