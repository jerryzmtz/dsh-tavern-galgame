// private fork: same-origin phone deliberately shares the stage thread; no process-isolation assumption.
import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {chromium} from 'playwright'
import {widgetServer} from './fixtures/widget-harness.mjs'
test('phone history construction and streaming yield without a stage-thread long task',async t=>{
 const files=Object.fromEntries(await Promise.all(['index.html','style.css','battery.js','index.js'] /* private fork (settings-ux r2): shared battery levels */.map(async name=>[name,await readFile(new URL('../fork/mods/phone/view/'+name,import.meta.url),'utf8')])))
 const origin=await widgetServer(t,{connect(){},serve(){return false}}, (req,res)=>{const name=req.url.slice(1);res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html');res.end(files[name] || '<!doctype html><iframe src="/index.html" style="width:280px;height:607px;border:0"></iframe>');return true})
 const browser=await chromium.launch({headless:true,args:['--mute-audio']});t.after(()=>browser.close());const page=await browser.newPage({viewport:{width:1200,height:850}})
 const errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto(origin);const frame=page.frames().find(frame=>frame.parentFrame());await frame.waitForSelector('#messages',{state:'attached'})
 const session=await page.context().newCDPSession(page);await session.send('Emulation.setCPUThrottlingRate',{rate:4})
 await page.evaluate(()=>{window.longTasks=[];new PerformanceObserver(list=>longTasks.push(...list.getEntries().map(e=>e.duration))).observe({type:'longtask'});window.framesMs=[];let last;function frame(now){if(last)framesMs.push(now-last);last=now;requestAnimationFrame(frame)}requestAnimationFrame(frame);window.send=(type,data={})=>document.querySelector('iframe').contentWindow.postMessage({channel:'dsh-widget',version:2,token:'perf',type,...data},'*');send('init',{presentation:{state:'open',suspended:false,attention:{}},playback:{mode:'live'}})})
 await frame.evaluate(()=>{window.longTasks=[];new PerformanceObserver(list=>longTasks.push(...list.getEntries().map(e=>e.duration))).observe({type:'longtask'})})
 await page.waitForTimeout(250)
 await page.evaluate(()=>{longTasks.length=0;framesMs.length=0;window.rows=Array.from({length:80},(_,i)=>({id:'m'+i,turn:i<40?1:2,para:i+1,side:i%2?'out':'in',alias:'friend',contact:'f_friend',name:'Friend',text:'A bounded history message '+i, revealed:true}));window.source={threadKey:'thread',messages:rows,current:{id:'m79',revealed:true},historyStatus:'ready'};send('source',{source})})
 await frame.waitForFunction(()=>document.querySelectorAll('#messages article').length===80)
 await frame.evaluate(()=>window.firstRow=document.querySelector('#messages article'))
 for(let i=0;i<50;i++){await page.evaluate(i=>{rows[79].text='A streaming message '+'.'.repeat(i+1);send('source',{source});send('playback',{playback:{mode:'live'}})},i);await page.waitForTimeout(40)}
 await page.waitForTimeout(150)
 const parent=await page.evaluate(()=>({longTasks,framesMs})),child=await frame.evaluate(()=>({longTasks,preserved:firstRow===document.querySelector('#messages article')}))
 const sorted=parent.framesMs.sort((a,b)=>a-b),report={cpuRate:4,rows:80,updates:50,sameOriginSameThread:true,frameP95:sorted[Math.floor(sorted.length*.95)],longTasks:[...parent.longTasks,...child.longTasks],preserved:child.preserved,errors}
 await mkdir(new URL('../.tmp/',import.meta.url),{recursive:true})
 await writeFile(new URL('../.tmp/phone-performance.json',import.meta.url),JSON.stringify(report,null,2)+'\n')
 assert.deepEqual(errors,[]);assert.equal(child.preserved,true);assert.deepEqual(report.longTasks.filter(ms=>ms>50),[])
})

// private fork: compact incoming summaries are static, not a scale/notification pulse.
test('compact new messages and streamed text never animate the island or summary',async t=>{
 const files=Object.fromEntries(await Promise.all(['index.html','style.css','battery.js','index.js'] /* private fork (settings-ux r2): shared battery levels */.map(async name=>[name,await readFile(new URL('../fork/mods/phone/view/'+name,import.meta.url),'utf8')])))
 const origin=await widgetServer(t,{connect(){},serve(){return false}},(req,res)=>{const name=req.url.slice(1);res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html');res.end(files[name] || '<iframe src="/index.html"></iframe>');return true})
 const browser=await chromium.launch({headless:true,args:['--mute-audio']});t.after(()=>browser.close());const page=await browser.newPage();await page.goto(origin)
 const frame=page.frames().find(frame=>frame.parentFrame());await frame.waitForSelector('#island',{state:'attached'})
 await page.evaluate(()=>{window.send=(type,data={})=>document.querySelector('iframe').contentWindow.postMessage({channel:'dsh-widget',version:2,token:'motion',type,...data},'*');send('init',{presentation:{state:'compact',suspended:false,attention:{count:0},reducedMotion:false},playback:{mode:'live'}});window.row={id:'first',turn:1,para:1,side:'in',alias:'friend',contact:'f_friend',name:'Friend',text:'First',revealed:true};send('source',{source:{threadKey:'t',messages:[row],current:row,historyStatus:'ready'}})})
 await frame.locator('#island-preview').filter({hasText:'First'}).waitFor()
 await frame.evaluate(()=>{window.motion=[];document.addEventListener('animationstart',event=>{if(['island','island-preview'].includes(event.target.id))motion.push(event.animationName)});window.transforms=[];const until=performance.now()+700;function sample(){transforms.push(getComputedStyle(document.getElementById('island')).transform);if(performance.now()<until)requestAnimationFrame(sample)}sample()})
 for(let i=0;i<4;i++){await page.evaluate(i=>{const next={...row,id:'second',para:2,text:'Incoming '+i};send('source',{source:{threadKey:'t',messages:[row,next],current:next,historyStatus:'ready'}})},i);await page.waitForTimeout(80)}
 await page.waitForTimeout(420)
 const motion=await frame.evaluate(()=>({animations:motion,transforms}));assert.deepEqual(motion.animations,[]);assert.ok(motion.transforms.length>10)
 assert.ok(motion.transforms.every(value=>value==='none'||value==='matrix(1, 0, 0, 1, 0, 0)'))
})
