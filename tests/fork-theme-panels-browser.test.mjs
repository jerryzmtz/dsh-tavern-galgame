// private fork: ordinary light/dark skins use the actual stage CSS and hook, without DSH or a model.
import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {chromium} from 'playwright'
import {browserReactScript} from './fixtures/browser-react.mjs'
import {forkThemeCss} from './helpers/fork-theme-css.mjs'
const read=p=>readFile(new URL('../tavern-plugin/'+p,import.meta.url),'utf8')
const skin=(id,bg,fg,accent)=>({schema:'dsh.skin/1',id,label:id,textbox:{paint:{bg:'#eeeeee',fg:'#111111'}},nameplate:{shape:'pill',paint:{bg:'#111111',fg:'#ffffff'}},font:{body:'neo-xihei-screen',name:'neo-xihei-screen',ui:'neo-xihei-screen'},textFx:{reveal:'type'},ui:{bg,fg,fgMuted:fg,accent,onAccent:bg,border:fg,radius:13}})
test('light/dark skin themes choices, backlog, config and menu on desktop/mobile and in film mode',{timeout:30000},async t=>{
 const browser=await chromium.launch({headless:true});t.after(()=>browser.close())
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)))
 await page.setContent('<!doctype html><div id="app"></div>')
 await page.addStyleTag({content:await forkThemeCss()})
 await page.addScriptTag({content:await browserReactScript()+'\nconst React=modules.react; const forkFonts={subscribe:()=>()=>{},getSnapshot:()=>0,resolve:()=>({family:"Georgia,serif"}),ensure:async()=>{}};\n'+(await Promise.all(['packages/dsh-presentation-protocol/src/stage-skin.cjs','src/client/fork-stage-skin.cjs','src/client/fork-stage-skin-ui.js'].map(read))).join('\n')+`
 const h=React.createElement,root=modules['react-dom/client'].createRoot(document.getElementById('app'));
 function Stage({skin,film,theme='classic'}) {const ref=React.useRef(null);useForkStageSkin(ref,skin,'page',film,theme,{snap:true});return h('div',{ref,className:'fork-gal-stage'+(film?' is-film':''),'data-theme':theme,'data-fk-context':'stage-'+theme},
 h('button',{id:'choice',className:'fork-gal-choice'},'Choice'),h('div',{id:'backlog',className:'fork-gal-backlog'},'Backlog'),
 h('div',{className:'fork-gal-config'},h('div',{id:'config',className:'fork-gal-config-sheet'},'Config')),
 h('div',{className:'fork-gal-menu'},h('div',{id:'menu',className:'fork-gal-menu-sheet'},'Menu')));}
 window.render=props=>root.render(h(Stage,props));
 `})
 const fixtures=[skin('test-light','#fffaf2','#1b2552','#1f5fc4'),skin('test-dark','#121a3a','#eef3ff','#ffa66b')]
 for(const width of [1280,390])for(const document of fixtures)for(const film of [false,true]) {
  await page.setViewportSize({width,height:850});await page.evaluate(props=>window.render(props),{skin:{document},film});await page.waitForTimeout(35)
  const actual=await page.evaluate(()=>Object.fromEntries(['choice','backlog','config','menu'].map(id=>{const s=getComputedStyle(document.getElementById(id));return [id,{ink:s.color,surface:s.getPropertyValue('--gal-ui-surface').trim(),accent:s.getPropertyValue('--gal-ui-accent').trim(),radius:s.getPropertyValue('--gal-ui-radius').trim(),hover:s.getPropertyValue('--gal-ui-hover').trim(),active:s.getPropertyValue('--gal-ui-active').trim(),shadow:s.getPropertyValue('--gal-ui-text-shadow').trim(),titleShadow:s.getPropertyValue('--gal-ui-title-shadow').trim()}]})))
  for(const [id,values] of Object.entries(actual)) {
   assert.notEqual(values.hover,values.surface,id);assert.notEqual(values.active,values.surface,id);assert.notEqual(values.hover,values.active,id);assert.equal(values.shadow,'none');assert.equal(values.titleShadow,'none');
   assert.equal(values.surface,document.ui.bg,id);assert.equal(values.accent,document.ui.accent,id);assert.equal(values.radius,'13px',id)
   assert.equal(values.ink,document.id==='test-light'?'rgb(27, 37, 82)':'rgb(238, 243, 255)',id)
  }
 }
 // private fork: built-in magical decoration survives the production hook, including library -> built-in cleanup.
 for(const film of [false,true]) {
  const decoration=()=>page.evaluate(()=>{const node=document.querySelector('.fork-gal-stage'),style=getComputedStyle(node);return Object.fromEntries(['--gal-ui-veil','--gal-ui-title-font','--gal-ui-title-shadow'].map(key=>[key,{inline:node.style.getPropertyValue(key),computed:style.getPropertyValue(key).trim()}]))})
  await page.evaluate(film=>window.render({skin:null,theme:'magical',film}),film);await page.waitForTimeout(35)
  const css=await decoration();assert.ok(Object.values(css).every(value=>value.computed&&value.inline===''))
  await page.evaluate(props=>window.render(props),{skin:{document:fixtures[0]},film,theme:'magical'});await page.waitForTimeout(35)
  assert.equal((await decoration())['--gal-ui-title-shadow'].inline,'none')
  await page.evaluate(film=>window.render({skin:{builtin:true,document:BUILTIN_STAGE_SKINS.magical},film,theme:'magical'}),film);await page.waitForTimeout(35)
  assert.deepEqual(await decoration(),css,'Built-in CSS texture/title/font must survive inline panel colors')
 }
 assert.deepEqual(errors,[])
})
