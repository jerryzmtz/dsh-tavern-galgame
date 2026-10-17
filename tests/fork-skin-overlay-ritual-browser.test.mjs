import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {chromium} from 'playwright'
test('authored cover entrance, transient items, reveal axes and torn paper mats render without extra surfaces',async t=>{
  const browser=await chromium.launch({headless:true});t.after(()=>browser.close());const page=await browser.newPage()
  await page.setContent('<canvas id="under"></canvas><canvas id="over"></canvas>')
  const names=['fork-stage-resources.cjs','fork-skin-overlay-motion.cjs','fork-skin-overlay-phase.cjs','fork-skin-overlay-timing.cjs','fork-skin-overlay-player.cjs']
  await page.addScriptTag({content:(await Promise.all(names.map(name=>readFile(new URL('../tavern-plugin/src/client/'+name,import.meta.url),'utf8')))).join('\n')+`
    let time=0,jobs=[],player;const owner=createStageResourceOwner({service:{}});
    const foreground={now:()=>time,requestAnimationFrame:fn=>{jobs.push(fn);return fn},cancelAnimationFrame:fn=>{jobs=jobs.filter(f=>f!==fn)}};
    const geometry={revision:1,screen:{x:0,y:0,w:1600,h:900},box:{x:200,y:700,w:1200,h:160}},rects={getSnapshot:()=>geometry,subscribe:()=>()=>{}};
    const texture=document.createElement('canvas');texture.width=texture.height=40;texture.getContext('2d').fillStyle='#0000ff';texture.getContext('2d').fillRect(0,0,40,40);
    window.sample=(kind,ms,options={})=>{
      player?.dispose();time=0;jobs=[];
      const ritual={cover:{fill:'#ff0000',in:'top',inSteps:2,items:[{frame:'blue',x:800,y:450,w:300,h:300,at:0,from:'left',steps:4,until:500}]},revealAt:500,reveal:{kind,edge:'smooth',steps:5}};
      player=createSkinOverlayPlayer({definition:{id:'test',pieces:[],paper:options.paper,cues:{entry:{ritual}}},textures:{blue:[texture]},rects,foreground,owner,under,over,snap:!!options.snap});
      time=ms;const pending=jobs;jobs=[];pending.forEach(fn=>fn());
      const c=(options.paper?under:over).getContext('2d'),pixel=(x,y)=>[...c.getImageData(x,y,1,1).data];
      return {top:pixel(800,100),bottom:pixel(800,800),left:pixel(100,450),right:pixel(1500,450),center:pixel(800,450),mat:pixel(190,740),allocated:owner.snapshot().bytes};
    };window.finish=()=>{player.dispose();return owner.snapshot().bytes};
  `})
  let value=await page.evaluate(()=>sample('quarters',0));assert.equal(value.top[0],255);assert.equal(value.bottom[3],0,'cover slides from the authored top edge');assert.equal(value.center[2],0,'item has not reached its target')
  value=await page.evaluate(()=>sample('quarters',400));assert.deepEqual(value.center,[0,0,255,255],'stepped cover item reaches its authored position')
  value=await page.evaluate(()=>sample('split-v',625));assert.equal(value.center[3],0);assert.equal(value.left[3],0,'split-v opens vertically (top/bottom sheets)')
  value=await page.evaluate(()=>sample('split-h',625));assert.equal(value.center[3],0);assert.equal(value.top[3],0,'split-h opens horizontally')
  value=await page.evaluate(()=>sample('scanline',750));assert.equal(value.top[3],0);assert.equal(value.bottom[3],0);assert.ok(value.center[3]>0,'CRT collapse retains its central line')
  value=await page.evaluate(()=>sample('quarters',1500,{snap:true,paper:{mat:{outer:'#00ff00',inner:'#0000ff'}}}));assert.ok(value.mat[3]>0,'paper mat surrounds the measured dialogue box');assert.equal(value.allocated,1600*900*8,'only the two accounted surfaces are allocated')
  assert.equal(await page.evaluate(()=>finish()),0)
})
