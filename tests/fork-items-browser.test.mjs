import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {chromium} from 'playwright'
import {browserReactScript} from './fixtures/browser-react.mjs'
test('item reader never replays initial/history facts; late facts wait for forward page; mobile shows at most two cards', {timeout:30000},async t=>{
 const browser=await chromium.launch({headless:true});t.after(()=>browser.close())
 const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];page.on('pageerror',error=>errors.push(error.message))
 await page.setContent('<div id="root" style="position:relative;height:800px"></div>')
 await page.addStyleTag({content:await readFile(new URL('../tavern-plugin/lib/client-assets/fork-theme.css',import.meta.url),'utf8')})
 await page.addScriptTag({content:await browserReactScript()})
 await page.addScriptTag({content:`const React=modules.react,ReactDOM=modules['react-dom/client'];
 const forkStageSessions={resourceOwner:null};let calls=0,data={},props={sessionId:'session',enabled:true,turn:1,para:1,page:0,live:true,skipping:false,overlay:false,sourceKey:'source-1'};
 async function rpc(_name,args){calls++;return data[args.turn]||{branchId:'branch',records:[],pending:true};}
 ${await readFile(new URL('../tavern-plugin/src/client/fork-item-showcase.cjs',import.meta.url),'utf8')}
 ${await readFile(new URL('../tavern-plugin/src/client/fork-mod-performance.js',import.meta.url),'utf8')}
 ${await readFile(new URL('../tavern-plugin/src/client/fork-item-performance.js',import.meta.url),'utf8')}
 const root=ReactDOM.createRoot(document.getElementById('root'));window.update=value=>{Object.assign(props,value);root.render(React.createElement(ForkItemPerformance,props));};
 window.facts=(turn,status,count=1)=>{data[turn]={branchId:'branch',sourceKey:'source-'+turn,pending:status==='HELD',records:Array.from({length:count},(_,i)=>({intentId:turn+':'+i,op:{op:'item.play',action:'gain',name:'key',at:1},status,bound:{item:{name:'key '+i,delta:2}}}))};};window.callCount=()=>calls;window.update({});`})
 await page.evaluate(()=>window.facts(1,'READY'));await page.waitForTimeout(450);assert.equal(await page.locator('.fork-item-show').count(),0)
 await page.evaluate(()=>{window.facts(2,'HELD',3);window.update({turn:2,sourceKey:'source-2'});})
 await page.waitForTimeout(650);await page.evaluate(()=>window.facts(2,'READY',3));await page.waitForTimeout(450)
 assert.equal(await page.locator('.fork-item-show').count(),0,'late receipt cannot jump into the current paragraph')
 // private fork (item showcase B1): cards are floating items with their names, no card box.
 await page.evaluate(()=>window.update({page:1,para:2}));await page.waitForSelector('.fork-item-showcase:not(.is-measuring) .fork-item-cap')
 assert.equal(await page.locator('.fork-item-show').count(),2)
 assert.match(await page.locator('.fork-item-showcase').textContent(),/另有 1 项/)
 assert.ok(await page.locator('.fork-item-cap').evaluateAll(nodes=>nodes.every(node=>{const r=node.getBoundingClientRect();return r.left>=0 && r.right<=innerWidth;})))
 await page.evaluate(()=>window.update({live:false,page:0,para:1}));await page.waitForSelector('.fork-item-history')
 assert.equal(await page.locator('.fork-item-show').count(),0)
 await page.evaluate(()=>window.update({enabled:false}));await page.waitForTimeout(50)
 const count=await page.evaluate(()=>window.callCount());await page.waitForTimeout(1250);assert.equal(await page.evaluate(()=>window.callCount()),count)
 assert.deepEqual(errors,[])
})
