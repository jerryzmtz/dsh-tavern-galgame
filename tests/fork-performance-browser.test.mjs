import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {chromium} from 'playwright'
import {forkThemeCss} from './helpers/fork-theme-css.mjs'
const read=name=>readFile(new URL('../tavern-plugin/'+name,import.meta.url),'utf8')
test('production overlay adapter borrows atlas pixels, keeps canvases across phases and releases allocations', {timeout:30000},async t=>{
  const browser=await chromium.launch({headless:true});t.after(()=>browser.close())
  const page=await browser.newPage({viewport:{width:1000,height:700}}),errors=[];page.on('pageerror',error=>errors.push(String(error)))
  await page.setContent('<div id="stage" class="fork-gal-stage" data-theme="classic" style="position:relative;width:950px;height:600px"><div class="fork-gal-box"><div class="fork-gal-text">Readable text remains above the performance.</div><div class="fork-gal-controls">Controls</div></div></div>')
  await page.addStyleTag({content:await forkThemeCss()+'\n'+await read('lib/client-assets/tavern.css')})
  const sources=['fork-foreground.js','fork-stage-resources.cjs','fork-stage-rects.cjs','fork-skin-overlay-motion.cjs','fork-skin-overlay-phase.cjs','fork-skin-overlay-timing.cjs','fork-skin-overlay-script.cjs','fork-skin-overlay-player.cjs','fork-skin-overlay-loader.cjs','fork-performance-layer.js']
  await page.addScriptTag({content:(await Promise.all(sources.map(name=>read('src/client/'+name)))).join('\n')+`
  const root=document.getElementById('stage'),owner=createStageResourceOwner({service:{}}),rects=createStageRects({root});
  const image=document.createElement('canvas');image.width=image.height=32;image.getContext('2d').fillRect(0,0,32,32);
  const textureAllocation=owner.reserveBytes(32*32*4),handle={identity:'skin',files:{'atlas.json':{json:{meta:{image:'atlas.png'},frames:{piece:{frame:{x:0,y:0,w:32,h:32},sourceSize:{w:32,h:32}}}}},'atlas.png':{image}}};
  const definition={atlases:['atlas.json'],glyphs:'unused',pieces:[{id:'piece',frame:'piece',h:60,pivot:[0,1],at:{r:'screen',u:.25,v:.25},enter:{at:0,steps:1}}],cues:{entry:{ms:100},turn:{ms:100},exit:{ms:100}}};
  const ref={packId:'p',kind:'skins',assetId:'skin'},dependency={ref,identity:'skin',entry:'skin.json',document:{id:'fixture',overlay:definition}};
  const value={instanceKey:['instance'],phaseKey:['entry'],phase:'entry',level:2,dependencies:[dependency],executionDependencies:[]};
  const states=[],cues=[];let policy={photosensitive:true,reducedMotion:false};
  const adapter=createPerformanceSkinLayer({root,owner,rects,foreground:forkForeground,onChange:value=>states.push(value),onCue:cue=>cues.push(cue),safety:()=>policy,load:async()=>({createSkinOverlayPlayer,createDecorativeScript})});
  const token={phaseKey:['entry']};
  window.apply=options=>adapter.apply({type:'layer',value,layer:{skin:{ref,level:2},widgets:{}},token,handles:[handle],descriptor:{do:'skin',block:'entry',ordinal:0},...options});
  window.debug={owner,adapter,rects,states,value,token,handle,ref,policy,textureAllocation};
  `})
  await page.waitForTimeout(50);await page.evaluate(()=>window.apply());await page.waitForTimeout(100)
  const before=await page.evaluate(()=>{window.canvases=[...document.querySelectorAll('canvas.fork-performance-under,canvas.fork-performance-over')];return {count:canvases.length,allocated:debug.owner.snapshot().bytes,textZ:getComputedStyle(document.querySelector('.fork-gal-box')).zIndex,overZ:getComputedStyle(canvases[1]).zIndex}})
  assert.equal(before.count,2);assert.ok(before.allocated>1024);assert.ok(Number(before.textZ)>Number(before.overZ))
  await page.evaluate(()=>window.apply({token:{phaseKey:['turn']},value:{...debug.value,phase:'turn',level:3},layer:{skin:{ref:debug.ref,level:3},widgets:{}},descriptor:{do:'skin',block:'turn',ordinal:0}}));await page.waitForTimeout(100)
  assert.ok(await page.evaluate(()=>canvases.every((node,index)=>node===[...document.querySelectorAll('canvas.fork-performance-under,canvas.fork-performance-over')][index])))
  await page.evaluate(()=>window.apply({descriptor:{do:'flash',color:'#ffffff',alpha:.8,ms:300}}))
  const flash=await page.locator('.fork-performance-flash').evaluate(node=>({color:node.style.background,opacity:node.style.opacity}))
  assert.equal(flash.color,'rgb(0, 0, 0)');assert.equal(flash.opacity,'0.5')
  const preserved=await page.evaluate(async()=>{
    const blocker=debug.owner.reserveBytes(2*1024**3-debug.owner.snapshot().bytes-32);
    const dependency={...debug.value.dependencies[0],identity:'replacement'};
    await window.apply({value:{...debug.value,dependencies:[dependency]},handles:[{...debug.handle,identity:'replacement'}]});
    blocker.release();return debug.states.at(-1).skin.identity;
  });assert.equal(preserved,'skin','budget refusal preserves the last-good visual layer');
  await page.evaluate(()=>window.apply({snap:true}));await page.waitForTimeout(50)
  // private fork: OS reduced motion (calm) keeps the performance but drops shake and uses the safe dark pulse.
  const calm=await page.evaluate(async()=>{
    Object.assign(debug.policy,{photosensitive:false,calm:true});
    await window.apply({descriptor:{do:'shake',amp:20,ms:400}});await new Promise(r=>setTimeout(r,60));
    const shake=root.style.getPropertyValue('--performance-shake-x');
    await window.apply({descriptor:{do:'flash',color:'#ffffff',alpha:.9,ms:300}});
    const node=document.querySelector('.fork-performance-flash');
    const safety=forkPerformanceSafety({reducedMotion:false},true),explicit=forkPerformanceSafety({reducedMotion:true},true);
    Object.assign(debug.policy,{photosensitive:true,calm:false});
    return {shake,color:node.style.background,canvases:document.querySelectorAll('canvas.fork-performance-over').length,safety,explicit};
  })
  assert.equal(calm.shake,'');assert.equal(calm.color,'rgb(0, 0, 0)');assert.equal(calm.canvases,1)
  assert.deepEqual([calm.safety.calm,calm.safety.reducedMotion],[true,false],'the OS preference softens, it does not disable')
  assert.deepEqual([calm.explicit.calm,calm.explicit.reducedMotion],[false,true])
  await page.evaluate(()=>{debug.adapter.dispose();debug.rects.dispose();debug.textureAllocation.release()})
  assert.equal(await page.locator('.fork-performance-under,.fork-performance-over,.fork-performance-flash').count(),0)
  const memory=await page.evaluate(()=>debug.owner.snapshot());assert.equal(memory.bytes,0)
  assert.deepEqual(errors,[])
})
