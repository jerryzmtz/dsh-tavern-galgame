// private fork: production consumer CSS, Chromium canvas sampling, and live theme updates; no host/live RPC.
import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {chromium} from 'playwright'
import {browserReactScript} from './fixtures/browser-react.mjs'
const read=name=>readFile(new URL('../'+name,import.meta.url),'utf8')
// private fork (owner 2026-10): names left the helper (no tinted blocks); the stage SKIP label is its only consumer.
test('stage SKIP retains 4.5 contrast in both schemes and mobile',async t=>{
  const browser=await chromium.launch({headless:true});t.after(()=>browser.close())
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)))
  await page.setContent('<!doctype html><div id="root"></div>')
  await page.addStyleTag({content:await read('tavern-plugin/lib/client-assets/fork-theme.css')})
  await page.addStyleTag({content:`body{background:#fff;--fork-surface:#fff;--fk-current-bgSolid:#fff} body[data-ds-dark-theme]{background:#161820;--fork-surface:#161820;--fk-current-bgSolid:#161820} .fork-gal-stage{position:relative!important;min-height:180px;height:180px;width:100%} .fork-gal-box{position:relative!important;inset:auto!important;transform:none!important}.fork-gal-backlog-row{background:var(--fork-surface)}`})
  await page.addScriptTag({content:await browserReactScript()+`
    const React=modules.react,ReactDOM=modules['react-dom/client'];
    const tones=['#eb9b7e','#9ea0d7','#ef9bac','#342034','#638dae','#eec866','#ffffff','#000000'];
    function Sample(){const ref=React.useRef(null);useForkFigureTextContrast(React,ref,true,'sample');return React.createElement('main',{ref},tones.map(color=>React.createElement('section',{key:color},
      ['classic','gothic','magical','film'].map(theme=>React.createElement('div',{key:theme,className:'fork-gal-stage'+(theme==='film'?' is-film':''),'data-theme':theme==='film'?'classic':theme},React.createElement('div',{className:'fork-gal-box is-skipping','data-figure-skip-color':color,style:{'--bubble-color':color}},React.createElement('div',{className:'fork-gal-name'},React.createElement('b',null,'名字'),React.createElement('span',null,'平和'))))))));}
    ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Sample));`})
  await page.waitForSelector('[data-figure-skip-color][style]')
  for(const width of [1280,390])for(const dark of [false,true]){
    await page.setViewportSize({width,height:850})
    await page.evaluate(dark=>{document.body.toggleAttribute('data-ds-dark-theme',dark);document.documentElement.style.colorScheme=dark?'dark':'light'},dark)
    await page.waitForTimeout(40)
    const rows=await page.evaluate(()=>[...document.querySelectorAll('[data-figure-skip-color]')].map(node=>{
      const s=getComputedStyle(node,'::after'),hex=css=>{const c=document.createElement('canvas');c.width=c.height=1;const x=c.getContext('2d');x.fillStyle=css;x.fillRect(0,0,1,1);return '#'+[...x.getImageData(0,0,1,1).data].slice(0,3).map(v=>v.toString(16).padStart(2,'0')).join('')};
      return {kind:node.className,base:node.dataset.figureSkipColor,ratio:figureContrast(hex(s.color),hex(s.backgroundColor)),background:s.backgroundColor};
    }))
    assert.equal(rows.length,32)
    for(const row of rows)assert.ok(row.ratio>=4.5,JSON.stringify({width,dark,...row}))
  }
  assert.deepEqual(errors,[])
})
test('browser sampler handles PNG, WebP and JPEG without persisting a manual value',async t=>{
  const browser=await chromium.launch({headless:true});t.after(()=>browser.close());const page=await browser.newPage()
  await page.addScriptTag({content:await read('tavern-plugin/shared/figure-auto-color.cjs')})
  const results=await page.evaluate(async()=>{
    const canvas=document.createElement('canvas');canvas.width=canvas.height=32;const ctx=canvas.getContext('2d');ctx.fillStyle='#ef9bac';ctx.fillRect(0,0,32,32)
    const rows=[];for(const mime of ['image/png','image/webp','image/jpeg']){
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,mime)),bitmap=await createImageBitmap(blob)
      try{rows.push({mime,color:figureBitmapAutoColor(bitmap,false,document.createElement('canvas'))})}finally{bitmap.close()}
    }return rows
  })
  assert.deepEqual(results.map(row=>row.mime),['image/png','image/webp','image/jpeg'])
  for(const row of results){const [r,g,b]=[1,3,5].map(i=>parseInt(row.color.slice(i,i+2),16));assert.ok(r>g&&r>b&&b>g,row.color)}
})

test('contrast shares canvas readbacks within a batch but resolves changed surfaces next time',async t=>{
  const browser=await chromium.launch({headless:true});t.after(()=>browser.close())
  const page=await browser.newPage()
  await page.setContent('<!doctype html><main id="root" style="background:#fff"></main>')
  await page.addScriptTag({content:await browserReactScript()})
  const result=await page.evaluate(()=>{
    const root=document.getElementById('root')
    for(let i=0;i<500;i++){const node=document.createElement('div');node.dataset.figureSkipColor='#ef9bac';root.append(node)}
    const original=CanvasRenderingContext2D.prototype.getImageData;let reads=0
    CanvasRenderingContext2D.prototype.getImageData=function(...args){reads++;return original.apply(this,args)}
    try{
      applyForkFigureTextContrast([root]);const firstReads=reads,first=getComputedStyle(root.firstChild).getPropertyValue('--figure-skip-surface')
      root.style.background='#101020';applyForkFigureTextContrast([root])
      return {firstReads,secondReads:reads-firstReads,first,second:getComputedStyle(root.firstChild).getPropertyValue('--figure-skip-surface')}
    }finally{CanvasRenderingContext2D.prototype.getImageData=original}
  })
  assert.ok(result.firstReads<10,JSON.stringify(result));assert.ok(result.secondReads<10,JSON.stringify(result))
  assert.equal(result.first,'#ffffff');assert.equal(result.second,'#101020')
})

test('contrast ignores no-op ancestor mutations and coalesces real updates before the next frame',async t=>{
  const browser=await chromium.launch({headless:true});t.after(()=>browser.close())
  const page=await browser.newPage();await page.setContent('<!doctype html><div id="root"></div>')
  await page.addScriptTag({content:await browserReactScript()+`
    const React=modules.react,ReactDOM=modules['react-dom/client'];window.runs=0;
    const original=applyForkFigureTextContrast;applyForkFigureTextContrast=(...args)=>{runs++;return original(...args)};
    function Sample(){const ref=React.useRef(null);useForkFigureTextContrast(React,ref,true);return React.createElement('main',{ref},React.createElement('div',{'data-figure-skip-color':'#ef9bac'},'Skip'))}
    ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Sample));`})
  await page.waitForFunction(()=>window.runs===1)
  const result=await page.evaluate(async()=>{
    const frame=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))
    document.body.setAttribute('class','sample');await frame();const before=runs
    document.body.setAttribute('class','sample');await frame();const noop=runs
    document.body.style.background='#101020';document.body.style.background='#ffffff';await frame()
    const after=runs
    // private fork (perf round 3): per-frame look/performance variables never reach a background.
    for(let i=1;i<=3;i++){document.body.style.setProperty('--look-shake-x',i+'px');document.body.style.setProperty('--look-vig',String(i/10));document.body.style.setProperty('--performance-shake-y',i+'px');await frame()}
    const animated=runs
    document.body.style.setProperty('--look-vig','0.9');document.body.style.background='#101020';await frame()
    return {before,noop,after,animated,mixed:runs,background:getComputedStyle(document.querySelector('[data-figure-skip-color]')).getPropertyValue('--figure-skip-surface')}
  })
  assert.equal(result.noop,result.before);assert.equal(result.after,result.before+1)
  assert.equal(result.animated,result.after);assert.equal(result.mixed,result.after+1);assert.equal(result.background,'#101020')
})

test('offscreen consumers defer contrast and resolve the current theme when activated',async t=>{
  const browser=await chromium.launch({headless:true});t.after(()=>browser.close())
  const page=await browser.newPage();await page.setContent('<!doctype html><div id="root"></div>')
  await page.addScriptTag({content:await browserReactScript()+`
    const React=modules.react,ReactDOM=modules['react-dom/client'];window.runs=0;
    const original=applyForkFigureTextContrast;applyForkFigureTextContrast=(...args)=>{runs++;return original(...args)};
    function Sample(){const ref=React.useRef(null),[visible,setVisible]=React.useState(false);window.setVisible=setVisible;useForkFigureTextContrast(React,ref,visible);return React.createElement('main',{ref},React.createElement('div',{'data-figure-skip-color':'#ef9bac'},'Skip'))}
    ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Sample));`})
  await page.waitForSelector('[data-figure-skip-color]');assert.equal(await page.evaluate(()=>runs),0)
  await page.evaluate(()=>{document.body.style.background='#101020';setVisible(true)})
  await page.waitForFunction(()=>runs===1)
  assert.equal(await page.locator('[data-figure-skip-color]').evaluate(n=>getComputedStyle(n).getPropertyValue('--figure-skip-surface')),'#101020')
  await page.evaluate(()=>setVisible(false));await page.waitForTimeout(40)
  await page.evaluate(()=>document.body.style.background='#ffffff');await page.waitForTimeout(40)
  assert.equal(await page.evaluate(()=>runs),1)
  await page.evaluate(()=>setVisible(true));await page.waitForFunction(()=>runs===2)
  assert.equal(await page.locator('[data-figure-skip-color]').evaluate(n=>getComputedStyle(n).getPropertyValue('--figure-skip-surface')),'#ffffff')
})

// private fork (owner 2026-10): skin lifecycle with the contrast hook mounted; names keep CSS ink and never get backings.
test('authored skin inks win and stage/backlog names stay untouched by the contrast hook',async t=>{
  const browser=await chromium.launch({headless:true});t.after(()=>browser.close())
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)))
  page.on('console',m=>{if(m.type()==='warning')t.diagnostic(m.text())})
  const skin=JSON.parse(await read('tests/fixtures/stage-skins/oktavia.json'))
  skin.nameplate.paint={bg:'#121a3a',fg:'#8eeadf'}
  skin.ui={bg:'#0e1530',fg:'#eeeeee',accent:'#8eeadf'}
  await page.setContent('<!doctype html><div id="root"></div>')
  await page.addStyleTag({content:await read('tavern-plugin/lib/client-assets/fork-theme.css')})
  await page.addScriptTag({content:await browserReactScript()+'\n'+(await Promise.all([
    'tavern-plugin/packages/dsh-presentation-protocol/src/stage-skin.cjs',
    'tavern-plugin/src/client/fork-stage-skin.cjs','tavern-plugin/src/client/fork-stage-skin-ui.js'].map(read))).join('\n')+`
    const React=modules.react,fonts={subscribe:()=>()=>{},getSnapshot:()=>0,resolve:()=>({family:'serif'}),ensure:async()=>{}},forkFonts=fonts;
    function Stage({skin,film=false}){
      const ref=React.useRef(null);useForkStageSkin(ref,skin,0,film,'classic',{snap:true});
      useForkFigureTextContrast(React,ref,true,film);
      const h=React.createElement;
      return h('main',{ref,className:'fork-gal-stage'+(film?' is-film':''),'data-theme':'classic'},
        h('div',{className:'fork-gal-box is-skipping','data-figure-skip-color':'#4d6bfe',style:{'--bubble-color':'#4d6bfe'}},h('div',{className:'fork-gal-name'},h('b',null,'Name'),h('span',null,'Mood'))),
        h('div',{className:'fork-gal-backlog-row',style:{'--row-color':'#4d6bfe'}},h('div',{className:'fork-gal-backlog-name'},h('b',null,'Backlog'))));
    }
    const root=modules['react-dom/client'].createRoot(document.getElementById('root'));
    window.renderStage=props=>root.render(React.createElement(Stage,props));`})
  const render=async(value,film=false)=>{await page.evaluate(props=>renderStage(props),{skin:value,film});await page.waitForTimeout(60)}
  const names=()=>page.evaluate(()=>({
    inline:[...document.querySelectorAll('.fork-gal-name, .fork-gal-name *, .fork-gal-backlog-name, .fork-gal-backlog-name *')].map(n=>n.getAttribute('style')).filter(Boolean),
    plate:getComputedStyle(document.querySelector('.fork-gal-name')).color,
    backlog:getComputedStyle(document.querySelector('.fork-gal-backlog-name b')).backgroundColor,
    skip:getComputedStyle(document.querySelector('.fork-gal-box')).getPropertyValue('--figure-skip-ink')}))
  for(const [value,film] of [[null,false],[{document:skin},false],[{document:skin},true],[{document:skin,builtin:true},false],[null,false]]){
    await render(value,film)
    const row=await names()
    assert.deepEqual(row.inline,[],'no inline name styles '+JSON.stringify({film,builtin:value?.builtin}))
    assert.equal(row.backlog,'rgba(0, 0, 0, 0)','backlog name has no block')
    assert.ok(row.skip,'SKIP is still resolved')
  }
  await render({document:skin})
  assert.equal((await names()).plate,'rgb(142, 234, 223)','authored nameplate ink comes from skin CSS')
  const light=structuredClone(skin);light.nameplate.paint={bg:'#fffaf2',fg:'#155c55'};light.ui={bg:'#fffaf2',fg:'#241e37',accent:'#155c55'}
  await render({document:light})
  assert.equal((await names()).plate,'rgb(21, 92, 85)')
  assert.deepEqual(errors,[])
})
