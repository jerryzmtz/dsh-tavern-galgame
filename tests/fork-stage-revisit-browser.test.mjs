// private fork: offline Back/forward-boundary paint harness. No live CDP, paid model or live RPC.
// Production reducer, validated direction cache and resource owner; a minimal image sink,
// not the full Gal/Live2D renderer. Session hydration is covered by session-cache.test.
import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {chromium} from 'playwright'
import {fixture,answer} from './helpers/stage-director-harness.mjs'
import {runtimeSource,runtimePage,runtimeText} from './helpers/stage-runtime-harness.mjs'
import {readStageProjection} from '../tavern-plugin/lib/domain/stage-projection.js'
const read=name=>readFileSync(new URL('../tavern-plugin/src/client/'+name,import.meta.url),'utf8')

test('prefetched Back boundary and repeated completed-turn paint stay below 100 ms with zero revisit RPC/decode',{timeout:30000},async t=>{
  const f=await fixture(request=>request.onToolCall({name:'stage_update',arguments:answer}))
  t.after(()=>f.dispose())
  const rows=[],projections={}
  for(let turn=1;turn<=3;turn++) {
    if(turn>1) f.appendReply(turn)
    await f.director.get(f.read(),turn);await f.director.drain()
    const envelope=await f.director.get(f.read(),turn,null,{readOnly:true})
    rows.push({source:runtimeSource({sessionId:'session',turn}),text:{...runtimeText(1,[runtimePage(1),runtimePage(2)]),units:envelope.displayUnits},envelope})
    for(const at of [1,2]) projections[turn+':'+at]=await readStageProjection({at,expectedDirectionToken:envelope.token,
      readDirection:()=>f.director.get(f.read(),turn,null,{readOnly:true}),readConsumer:()=>f.assets.consumer(f.read(),'http://localhost'),
      readSettings:f.engineSettings.read,revision:()=>f.assets.revision})
  }
  const browser=await chromium.launch({channel:'chrome',headless:true});t.after(()=>browser.close())
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message))
  await page.route('https://revisit.test/**',route=>route.fulfill({contentType:'text/html',body:'<img id="visual" width="300" height="200"><output id="notice"></output>'}))
  await page.goto('https://revisit.test/')
  await page.evaluate(data=>{window.fixtures=data},{rows,projections})
  await page.addScriptTag({content:readFileSync(new URL('../tavern-plugin/packages/dsh-presentation-protocol/src/director-commands.cjs',import.meta.url),'utf8')+'\n'+['fork-stage-page-index.cjs','../../../fork/mods/performance/state.cjs','../../../fork/mods/performance/timeline.cjs','fork-stage-runtime.cjs','fork-stage-runtime-store.cjs','fork-stage-director-source.cjs','fork-stage-resources.cjs','fork-stage-resource-runner.cjs'].map(read).join('\n')+`
    const counts={direction:0,projection:0,bytes:0,decode:0},notices=[],samples=[];
    const png=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aLFcAAAAASUVORK5CYII='),c=>c.charCodeAt(0));
    const clock={setTimeout:()=>1,clearTimeout(){}};
    const owner=createStageResourceOwner({service:{async leaseMedia(){return {ticket:1,revision:'pack-1',url:'/image'}},releaseLease(){}},
      fetch:async()=>{counts.bytes++;return new Response(png,{headers:{'Content-Type':'image/png'}})},
      async decode(blob,url){counts.decode++;const image=new Image();image.src=url;await image.decode();return image;}});
    const resources=createStageResourceRunner({owner,clock,read:async args=>{counts.projection++;return fixtures.projections[args.turn+':'+args.at]},
      present:(_id,intent)=>{if(intent.accepted?.scene?.backgroundUrl) document.querySelector('#visual').src=intent.accepted.scene.backgroundUrl;}});
    const director=createStageDirectorSource({clock,onEffect:resources.onEffect,watch:()=>()=>{},read:async args=>{counts.direction++;return fixtures.rows[args.turn-1].envelope}});
    const store=createStageRuntimeStore({runEffect:(...args)=>director.runEffect('session',...args)});
    let at=3,started=0,measuring=false;
    const source=store.select(state=>({projection:state.projection,director:state.director,source:state.source,pending:state.pending}));
    source.subscribe(()=>{
      const state=store.getSnapshot(),notice=stageRuntimeIndicators(state);notices.push(notice);
      document.querySelector('#notice').textContent=notice.spinner?'directing':notice.loading?'loading':'';
      if(started&&!measuring&&!state.projection&&state.director.complete&&state.source.turn===at) {
        measuring=true;
        requestAnimationFrame(()=>requestAnimationFrame(()=>{
          const image=document.querySelector('#visual');
          samples.push({ms:performance.now()-started,ready:image.complete&&image.naturalWidth>0,turn:at});
          started=0;measuring=false;
        }));
      }
    });
    store.dispatch({type:'TURN_CHANGED',...fixtures.rows[2]});
    function navigate(delta){
      const turn=Math.max(1,Math.min(3,at+delta));if(turn===at||started)return;
      started=performance.now();at=turn;
      store.dispatch({type:turn===3?'RESUME_LIVE':'HISTORY_JUMP',...fixtures.rows[turn-1]});
    }
    window.addEventListener('wheel',event=>{if(event.deltaY>0)navigate(1)});
    window.addEventListener('keydown',event=>{if(event.key==='PageUp')navigate(-1)});
    window.probe={counts,notices,samples,state:()=>store.getSnapshot(),async prefetch(){
      for(const row of fixtures.rows.slice(0,2)) {
        counts.direction++;
        const envelope=await director.prime(row.source,row.text,row.envelope);
        await resources.prefetch(row.source,envelope);
      }
    },dispose(){source.dispose();store.dispose();director.dispose();resources.dispose()}};
  `})
  await page.waitForFunction(()=>window.probe?.state().director.complete&&!probe.state().projection)
  await page.evaluate(()=>probe.prefetch())
  // Wait for current-turn whole-timeline warming as well as explicit adjacent prefetch.
  await page.waitForFunction(()=>probe.counts.projection===6)
  const before=await page.evaluate(()=>({...probe.counts}))
  for(const delta of [-1,-1,1,1,-1,-1,1,1]) {
    const count=await page.evaluate(()=>probe.samples.length)
    if(delta<0) await page.keyboard.press('PageUp')
    else await page.mouse.wheel(0,120)
    await page.waitForFunction(n=>probe.samples.length>n,count)
  }
  const result=await page.evaluate(()=>({counts:{...probe.counts},samples:probe.samples,notices:probe.notices}))
  assert.deepEqual(result.counts,before)
  assert.ok(result.samples.every(s=>s.ready&&s.ms<100),JSON.stringify(result.samples))
  assert.ok(result.notices.every(n=>!n.spinner&&!n.loading))
  assert.deepEqual(errors,[])
  t.diagnostic(JSON.stringify({firstPrefetchedPaintMs:result.samples[0].ms,revisitPaintMaxMs:Math.max(...result.samples.slice(1).map(s=>s.ms)),
    revisitPaintMeanMs:result.samples.slice(1).reduce((n,s)=>n+s.ms,0)/(result.samples.length-1),before,after:result.counts}))
  await page.evaluate(()=>probe.dispose())
})
