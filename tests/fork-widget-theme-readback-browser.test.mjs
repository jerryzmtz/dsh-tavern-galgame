// private fork: builtin theme token sampling stays on a tiny CPU readback surface.
import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {chromium} from 'playwright'

test('builtin widget colors use a one-pixel readback canvas and update with their CSS',async t=>{
  const browser=await chromium.launch({headless:true});t.after(()=>browser.close())
  const page=await browser.newPage()
  await page.setContent('<main style="--gal-ui-accent:#123456;--gal-ui-accent-ink:#ffffff;--gal-ui-surface:rgb(16,32,48);--gal-ui-ink:#eeeeee;--gal-ui-ink-2:#aaaaaa;--gal-ui-line:rgba(1,2,3,.5);--gal-ui-radius:14"></main>')
  const source=await readFile(new URL('../tavern-plugin/src/client/fork-widget-theme.js',import.meta.url),'utf8')
  await page.addScriptTag({content:'function forkWidgetThemeHex(rgb){return "#"+rgb.map(v=>Math.round(v*255).toString(16).padStart(2,"0")).join("");}\n'+source})
  const result=await page.evaluate(()=>{
    const original=HTMLCanvasElement.prototype.getContext,contexts=[]
    HTMLCanvasElement.prototype.getContext=function(kind,options){contexts.push({width:this.width,height:this.height,kind,options});return original.call(this,kind,options)}
    try{
      const node=document.querySelector('main'),first=forkWidgetBuiltinTheme(node)
      node.style.setProperty('--gal-ui-surface','#ffeedd')
      return {first,second:forkWidgetBuiltinTheme(node),contexts}
    }finally{HTMLCanvasElement.prototype.getContext=original}
  })
  assert.deepEqual(result.first,{accent:'#123456',accentText:'#ffffff',surface:'#102030',surfaceText:'#eeeeee',muted:'#aaaaaa',radius:14})
  assert.equal(result.second.surface,'#ffeedd')
  assert.deepEqual(result.contexts,Array.from({length:2},()=>({width:1,height:1,kind:'2d',options:{willReadFrequently:true}})))
})
