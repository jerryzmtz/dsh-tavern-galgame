// private fork (owner 2026-10): the accent glyphs of a bubble name are drawn with the character's image colour, in the readable
// ink the host projected for each chat scheme (WCAG 4.5 on the chat background token). No contrast helper, no inline backing.
import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {createRequire} from 'node:module'
import {chromium} from 'playwright'
import {browserReactScript} from './fixtures/browser-react.mjs'
const require=createRequire(import.meta.url)
const {figureInks,figureContrast}=require('../tavern-plugin/shared/figure-auto-color.cjs')
const forkSurfaces=require('../tavern-plugin/src/client/fork-surfaces.cjs')
const read=name=>readFile(new URL('../'+name,import.meta.url),'utf8')
const BG={light:forkSurfaces.SURFACES['chat-light'].base.bgSolid,dark:forkSurfaces.SURFACES['chat-dark'].base.bgSolid}
const INK={light:forkSurfaces.SURFACES['chat-light'].base.fg,dark:forkSurfaces.SURFACES['chat-dark'].base.fg}
const rgb=hex=>'rgb('+[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)).join(', ')+')'

test('bubble name accent glyphs use the projected scheme ink; a speaker without a figure keeps the reading ink',async t=>{
  const browser=await chromium.launch({headless:true});t.after(()=>browser.close())
  const css=await read('tavern-plugin/lib/client-assets/fork-theme.css')
  const bubbles=await read('tavern-plugin/src/client/fork-bubbles.js')
  const row=bubbles.slice(bubbles.indexOf('function ForkBubbleRow('),bubbles.indexOf('// Drop-in for TavernColoredMarkdown'))
  assert.doesNotMatch(row,/useForkFigureTextContrast|data-figure-text-color/)
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)))
  await page.setContent('<!doctype html><div id="root"></div>')
  await page.addStyleTag({content:css})
  await page.addStyleTag({content:`body{--fork-ink:${INK.light};background:${BG.light}}body[data-ds-dark-theme]{--fork-ink:${INK.dark};background:${BG.dark}}`})
  await page.addScriptTag({content:await browserReactScript()+'\n'+await read('tavern-plugin/packages/dsh-presentation-protocol/src/figure-resolution.cjs')+'\n'+await read('tavern-plugin/src/client/fork-bubble-line.cjs')+`
    const React=modules.react,ReactDOM=modules['react-dom/client'];
    const forkBubbleColor=c=>c&&c.color||'var(--fork-figure-fallback)',forkBubbleMoodList=()=>[],forkBubbleMood=()=>null,forkBubbleMoodLabel=()=>'';
    const useForkBubbleMedia=()=>null,ForkBubbleAvatar=()=>null;
    const forkBubbleViewport={watch(node,notify){notify(true);return()=>{}}};
    ${row}
    const root=ReactDOM.createRoot(document.getElementById('root'));
    window.renderNames=character=>root.render(React.createElement(React.Fragment,null,
      ['\\u5927\\u80a5\\u9c7c','AB'].map((name,i)=>React.createElement(ForkBubbleRow,{key:i,sessionId:'offline',
        config:{characters:character?[{alias:'fish',name,...character}]:[]},segment:{alias:'fish',name,text:'\\u54fc\\u54fc'}}))));`})
  const inspect=()=>page.evaluate(()=>[...document.querySelectorAll('.fork-bubble-name')].map(n=>[n,...n.children].map(el=>({inline:el.getAttribute('style'),color:getComputedStyle(el).color,bg:getComputedStyle(el).backgroundColor}))))
  // 大肥鱼 blue, 高坂月's pale peach, 小圆 pink: pale colours become darker on light and stay or lighten on dark.
  for(const color of ['#4d6bfe','#fdd4b4','#e0689f',null])for(const scheme of ['light','dark']){
    const ink=color&&figureInks(color,BG)
    await page.evaluate(({scheme,character})=>{document.body.toggleAttribute('data-ds-dark-theme',scheme==='dark');renderNames(character)},{scheme,character:color?{color,ink}:null})
    await page.waitForFunction(color=>document.querySelector('.fork-bubble')?.style.getPropertyValue('--bubble-color')===(color||'var(--fork-figure-fallback)'),color)
    for(const nodes of await inspect()){
      assert.equal(nodes[0].color,rgb(INK[scheme]))
      for(const [i,glyph] of nodes.slice(1).entries()){
        assert.equal(glyph.inline,null);assert.equal(glyph.bg,'rgba(0, 0, 0, 0)')
        assert.equal(glyph.color,i===0||i===2?rgb(ink?ink[scheme]:INK[scheme]):nodes[0].color,JSON.stringify({color,scheme,i}))
      }
    }
    if(ink)assert.ok(figureContrast(ink[scheme],BG[scheme])>=4.5,color+' '+scheme)
  }
  assert.deepEqual(errors,[])
})
