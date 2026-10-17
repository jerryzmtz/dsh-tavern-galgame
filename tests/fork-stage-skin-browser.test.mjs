// private fork: real React hooks, CSS, font bridge boundary and cached DOM geometry; no DSH service.
import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {chromium} from 'playwright'
import {forkThemeCss} from './helpers/fork-theme-css.mjs'
import {browserReactScript} from './fixtures/browser-react.mjs'
const read=name=>readFile(new URL('../tavern-plugin/'+name,import.meta.url),'utf8')
test('skin page-boundary acceptance, history/refresh restore, film exclusion, and live cached rects', {timeout:30000},async t=>{
 const browser=await chromium.launch({headless:true});t.after(()=>browser.close())
 const page=await browser.newPage({viewport:{width:1000,height:700}}),errors=[];page.on('pageerror',e=>{errors.push(String(e));t.diagnostic(String(e.stack||e))});page.on('console',m=>{if(['warning','error'].includes(m.type()))t.diagnostic(m.text())})
 const skins=await Promise.all(['oktavia','charlotte'].map(async id=>({document:JSON.parse(await readFile(new URL(`./fixtures/stage-skins/${id}.json`,import.meta.url),'utf8'))})))
 await page.setContent('<!doctype html><div id="app"></div>')
 await page.addStyleTag({content:await forkThemeCss()})
 await page.addScriptTag({content:await browserReactScript()+'\nconst React=modules.react; const forkFonts={subscribe:()=>()=>{},getSnapshot:()=>0,resolve:()=>({family:"Georgia,serif"}),ensure:async()=>{}};\n'+(await Promise.all(['packages/dsh-presentation-protocol/src/stage-skin.cjs','src/client/fork-stage-skin.cjs','src/client/fork-stage-skin-ui.js','src/client/fork-foreground.js','src/client/fork-stage-skin-decoration.js','src/client/fork-stage-rects.cjs'].map(read))).join('\n')+`
 let root=modules['react-dom/client'].createRoot(document.getElementById('app'));
 function Stage({skin,page,ready,snap,film}) {const ref=React.useRef(null),appearance=useForkStageSkin(ref,skin,page,film,'classic',{ready,snap});return React.createElement('div',{ref,id:'stage',className:'fork-gal-stage'+(film?' is-film':''),'data-theme':'classic','data-fk-context':'stage-classic',style:{position:'relative',width:'90vw',height:450}},React.createElement('div',{className:'fork-gal-box'},appearance?React.createElement(ForkStageSkinFrame,{skin:appearance}):null,React.createElement('div',{className:'fork-gal-name'},'Name'),React.createElement('div',{className:'fork-gal-text'},'Readable dialogue.',appearance?.cursor?React.createElement('span',{className:'fork-gal-next fork-skin-next'},React.createElement(ForkStageSkinCursor,{cursor:appearance.cursor,active:false,snap:true})):null),React.createElement('div',{className:'fork-gal-controls'},React.createElement('button',{className:'fork-gal-control',id:'qm-idle'},'A'),React.createElement('button',{className:'fork-gal-control is-active',id:'qm-on'},'S'))),React.createElement('div',{className:'fork-gal-side is-on','aria-hidden':true},'Portrait'),React.createElement('article',{className:'fork-widget'},'Widget'))}
 window.renderStage=props=>root.render(React.createElement(Stage,props));
 window.remount=()=>{root.unmount();root=modules['react-dom/client'].createRoot(document.getElementById('app'));};
 `})
 const render=async(skin,key,options={})=>{await page.evaluate(props=>window.renderStage(props),{skin,page:key,ready:true,...options});await page.waitForTimeout(40)}
 const active=()=>page.locator('#stage').getAttribute('data-fk-skin')
 await render(null,'one',{ready:false});await render(skins[0],'one');assert.equal(await active(),'oktavia','first resource hydration restores the current page')
 await render(skins[1],'one');assert.equal(await active(),'oktavia','late live change waits')
 await render(skins[1],'two');assert.equal(await active(),'charlotte')
 await render(skins[0],'two',{snap:true});assert.equal(await active(),'oktavia','history restore does not wait for another page')
 await render(skins[0],'two',{snap:true,film:true});assert.equal(await active(),null)
 await render(skins[0],'two',{snap:true});assert.equal(await active(),'oktavia')
 await render(null,'two');assert.equal(await active(),null,'explicit off is immediate')
 await page.evaluate(()=>window.remount());await render(null,'one',{ready:false});await render(skins[1],'one');assert.equal(await active(),'charlotte')
 const colors=await page.evaluate(()=>{
  const rows=[],stage=document.getElementById('stage'),box=document.querySelector('.fork-gal-box');
  for(const theme of ['classic','gothic','magical','crt','aero']) for(const mode of ['','is-thought','is-narration']) {
   stage.dataset.theme=theme;stage.dataset.fkContext='stage-'+theme;box.className='fork-gal-box '+mode;
   rows.push([getComputedStyle(document.querySelector('.fork-gal-text')).color,getComputedStyle(document.querySelector('.fork-gal-name')).backgroundColor]);
  }
  stage.dataset.theme='classic';box.className='fork-gal-box';return rows;
 });
 assert.ok(colors.every(([text,name])=>text==='rgb(59, 36, 24)'&&name==='rgb(194, 24, 91)'),JSON.stringify(colors));
 // private fork (owner 2026-10): the skin plate (paper, border, rings) is identical on dialogue, thought, narration and
 // awaiting pages in every theme; the classic narration plate used to out-rank it (grey plate, no rings).
 const plateOf=await page.evaluate(()=>{
  const out={},stage=document.getElementById('stage'),box=document.querySelector('.fork-gal-box');
  for(const theme of ['classic','gothic','magical','crt','aero']) for(const mode of ['','is-thought','is-narration','is-awaiting']) {
   stage.dataset.theme=theme;stage.dataset.fkContext='stage-'+theme;box.className='fork-gal-box '+mode;
   const c=getComputedStyle(box);out[theme+':'+(mode||'line')]=[c.backgroundColor,c.backgroundImage,c.borderTopWidth,c.borderTopColor,c.borderTopLeftRadius,c.boxShadow,c.backdropFilter,getComputedStyle(document.querySelector('.fork-gal-text')).color].join(' | ');
  }
  stage.dataset.theme='classic';stage.dataset.fkContext='stage-classic';box.className='fork-gal-box';return out;
 });
 assert.equal(new Set(Object.values(plateOf)).size,1,JSON.stringify(plateOf,null,1));
 assert.match(Object.values(plateOf)[0],/^rgb\(255, 244, 236\) \| none \| 5px \| rgb\(232, 87, 126\) \| 26px \| rgb\(255, 244, 236\) 0px 0px 0px 6px, rgb\(194, 24, 91\) 0px 0px 0px 10px/);
 // private fork (owner 2026-10): no plates behind the face window, the skin cursor or the quick menu, in every theme and
 // with/without a skin; quick-menu icons keep >= 3:1 on the textbox plate (idle) and on their chip (toggled).
 await page.addStyleTag({content:'.fork-gal-stage .fork-gal-control{transition:none!important}'}) // measure settled paints
 const plates=()=>page.evaluate(()=>{
  const paint=document.createElement('canvas').getContext('2d',{willReadFrequently:true});
  const rgb=v=>{paint.clearRect(0,0,1,1);paint.fillStyle='#000';paint.fillStyle=v;paint.fillRect(0,0,1,1);return [...paint.getImageData(0,0,1,1).data].slice(0,3)},lum=c=>c.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
  const contrast=(a,b)=>{const x=lum(rgb(a)),y=lum(rgb(b));return (Math.max(x,y)+.05)/(Math.min(x,y)+.05)};
  const rows=[],stage=document.getElementById('stage'),box=document.querySelector('.fork-gal-box'),cs=s=>getComputedStyle(document.querySelector(s));
  stage.style.setProperty('--bubble-color','#f9fafb') // the live speaker colour (the former grey portrait gradient used it)
  for(const theme of ['classic','gothic','magical','crt','aero']) for(const mode of ['','is-narration']) {
   stage.dataset.theme=theme;stage.dataset.fkContext='stage-'+theme;box.className='fork-gal-box '+mode;
   const side=cs('.fork-gal-side'),before=getComputedStyle(document.querySelector('.fork-gal-side'),'::before'),qm=cs('.fork-gal-controls');
   const next=document.querySelector('.fork-skin-next'),plate=stage.dataset.fkSkin?getComputedStyle(stage).getPropertyValue('--gal-skin-bg').trim():getComputedStyle(stage).getPropertyValue('--fk-s-stage-textbox-bgSolid').trim();
   const plateRgb=(()=>{const n=document.createElement('i');n.style.color=plate;document.body.append(n);const v=getComputedStyle(n).color;n.remove();return v})();
   rows.push({theme,mode,skin:stage.dataset.fkSkin||null,side:[side.backgroundColor,side.backgroundImage],before:before.content==='none'||before.backgroundImage==='none',
    qm:[qm.backgroundColor,qm.backgroundImage],next:next?[getComputedStyle(next).backgroundColor,getComputedStyle(next).backgroundImage]:null,
    idle:contrast(cs('#qm-idle').color,plateRgb),on:contrast(cs('#qm-on').color,cs('#qm-on').backgroundColor)});
  }
  stage.dataset.theme='classic';stage.dataset.fkContext='stage-classic';box.className='fork-gal-box';return rows;
 })
 for(const row of [...await plates(),...(await render(null,'three'),await plates())]) {
  assert.deepEqual(row.side,['rgba(0, 0, 0, 0)','none'],'face window has no plate '+JSON.stringify(row));assert.ok(row.before,'no gradient behind the portrait '+JSON.stringify(row))
  assert.deepEqual(row.qm,['rgba(0, 0, 0, 0)','none'],'quick menu has no plate '+JSON.stringify(row))
  if(row.next)assert.deepEqual(row.next,['rgba(0, 0, 0, 0)','none'],'skin cursor is a cut-out '+JSON.stringify(row))
  assert.ok(row.idle>=3&&row.on>=3,'quick menu icon contrast '+JSON.stringify(row))
 }
 assert.ok((await plates()).every(row=>row.skin===null))
 await render(skins[1],'four',{snap:true});assert.equal(await active(),'charlotte')
 assert.ok((await plates()).every(row=>row.skin==='charlotte'&&row.next))
 await page.evaluate(()=>{window.rects=createStageRects({root:document.getElementById('stage')});window.reads=0;const original=Element.prototype.getBoundingClientRect;Element.prototype.getBoundingClientRect=function(){window.reads++;return original.call(this)}})
 await page.waitForTimeout(50)
 const snapshot=await page.evaluate(()=>{const value=rects.getSnapshot(),before=reads;for(let i=0;i<100;i++)rects.getSnapshot();return{value,frozen:Object.isFrozen(value)&&Object.isFrozen(value.screen)&&Object.isFrozen(value.widgets),sameReads:reads===before}})
 assert.ok(snapshot.frozen);assert.ok(snapshot.sameReads);assert.ok(snapshot.value.text.w>0);assert.ok(snapshot.value.side,'aria-hidden decorative portrait still occupies space');assert.equal(snapshot.value.widgets.length,1)
 await page.setViewportSize({width:390,height:844});await page.waitForTimeout(80)
 assert.ok(await page.evaluate(()=>rects.getSnapshot().screen.w<400))
 assert.equal(await page.locator('.fork-skin-frame > i').count(),2)
 assert.equal(await page.locator('.fork-skin-corner').count(),4)
 assert.equal(await page.locator('.fork-skin-next canvas').count(),1)
 const clearance=await page.evaluate(()=>({text:document.querySelector('.fork-gal-text').getBoundingClientRect().toJSON(),box:document.querySelector('.fork-gal-box').getBoundingClientRect().toJSON(),name:document.querySelector('.fork-gal-name').getBoundingClientRect().toJSON(),bands:[...document.querySelectorAll('.fork-skin-frame > i')].map(node=>node.getBoundingClientRect().toJSON())}))
 assert.ok(clearance.name.width < clearance.box.width/2,'rotated nameplate must wrap its text, not span the dialogue box');
 assert.ok(clearance.name.bottom <= clearance.text.top+2,'nameplate must not cross the dialogue');
 assert.ok(clearance.bands.every(band=>band.bottom<=clearance.text.top||band.top>=clearance.text.bottom),'ornaments never enter the dialogue rectangle: '+JSON.stringify(clearance))
 await page.evaluate(()=>{document.querySelector('.fork-gal-box').classList.add('is-hidden')});await page.waitForTimeout(50)
 assert.equal(await page.evaluate(()=>rects.getSnapshot().text),null)
 await page.evaluate(()=>rects.dispose());assert.deepEqual(errors,[])
})
