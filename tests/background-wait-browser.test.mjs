import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {createRequire} from 'node:module'
import {dirname,join} from 'node:path'
import {chromium} from 'playwright'
const require=createRequire(import.meta.url)
// private fork: the same action also appears for parallel-only director work.
for (const directorOnly of [false,true]) test('working background stop button in Chromium; directorOnly='+directorOnly,async()=>{
 let script='const modules={};\n'
 for(const [name,file] of [['react','react.production.js'],['scheduler','scheduler.production.js'],['react-dom','react-dom.production.js'],['react-dom/client','react-dom-client.production.js']]) {
  script+=`modules[${JSON.stringify(name)}]=(()=>{const module={exports:{}};const exports=module.exports;const require=name=>modules[name];\n${await readFile(join(dirname(require.resolve(name)),'cjs',file),'utf8')}\nreturn module.exports;})();\n`
 }
 const source=await readFile(new URL('../tavern-plugin/lib/client.js',import.meta.url),'utf8')
 const stop=source.slice(source.indexOf('function TavernStopBackgroundAction('),source.indexOf('function TavernConversationPreset('))
 const wait=await readFile(new URL('../tavern-plugin/src/client/modules/background-wait.js',import.meta.url),'utf8')
 script+=`const React=modules.react;window.calls=[];const activity=${directorOnly ? "{busy:false,phase:'idle',operationId:'old-core',director:{busy:true,phase:'running',operationId:'op-1'}}" : "{busy:true,phase:'running',operationId:'op-1',updatedAt:Date.now()-90000}"};
 const useTavernCoordination=()=>({view:{activity}});const liveTavernView={invalidate(){}};const tavernCoordination={invalidate(){}};const tavernErrorHub={report(){throw Error('unexpected error')}};
 async function rpc(method,args,sessionId){window.calls.push({method,args,sessionId});return {progress:{phase:'model',startedAt:Date.now()-90000,lastProgressAt:Date.now()-90000}}}
 ${wait}\n${stop}\nmodules['react-dom/client'].createRoot(document.querySelector('main')).render(React.createElement(${directorOnly ? 'TavernStopBackgroundAction' : 'TavernBackgroundWait'},{sessionId:'game',activity}));`
 const browser=await chromium.launch({headless:true})
 try {
  const page=await browser.newPage();await page.setContent('<main></main>');await page.addScriptTag({content:script})
  if (!directorOnly) await page.getByText(/正在等待模型 API/).waitFor()
  await page.getByRole('button',{name:'停止后台',exact:true}).click()
  const calls=await page.evaluate(()=>window.calls)
  assert.deepEqual(calls.find(call=>call.method==='stopBackground'),{method:'stopBackground',args:{operationId:'op-1'},sessionId:'game'})
 } finally {await browser.close()}
})
