import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {chromium} from 'playwright'
import {browserReactScript} from './fixtures/browser-react.mjs'
import {forkThemeCss} from './helpers/fork-theme-css.mjs'

test('normal textbox paginates multiline and oversized prose without losing source or changing director pages', {timeout:30000}, async t => {
  const browser=await chromium.launch({headless:true,args:['--mute-audio']})
  t.after(()=>browser.close())
  const page=await browser.newPage(),errors=[]
  page.on('pageerror',error=>errors.push(error.message))
  const stage=await readFile(new URL('../tavern-plugin/src/client/fork-gal-stage.js',import.meta.url),'utf8')
  await page.setContent('<div id="root"></div>')
  await page.addScriptTag({content:await browserReactScript()+`
    const React=modules.react,ReactDOM=modules['react-dom/client'];
    const forkForeground={requestAnimationFrame:fn=>requestAnimationFrame(fn),cancelAnimationFrame:id=>cancelAnimationFrame(id)};
    ${stage.slice(stage.indexOf('function forkGalSubtitleCards'),stage.indexOf('function forkGalNewEffects'))}
    const source='First line\\nSecond line\\nThird line\\nFourth line\\nFifth line\\nSixth line\\n'+'This long sentence remains one canonical page and must still fit every display card '.repeat(8);
    const pages=[{kind:'narration',text:source}];let view;
    function App(){view=useForkGalSubtitles(false,pages,0,'source:1','classic');return React.createElement('div',{className:'fork-gal-stage','data-theme':'classic'},React.createElement('div',{className:'fork-gal-box'},React.createElement('div',{className:'fork-gal-text',ref:view.textRef},React.createElement('span',null,view.text),React.createElement('span',{className:'fork-gal-next'}))))}
    ReactDOM.createRoot(document.querySelector('#root')).render(React.createElement(App));
    window.probe={get:()=>({cards:view.cards,card:view.card,source,pages:pages.length}),select:n=>view.select(0,n)};
  `})
  await page.waitForSelector('.fork-gal-text')
  await page.waitForTimeout(100)
  assert.equal(await page.evaluate(()=>probe.get().cards.length),1,'unmeasurable fallback keeps readable full pages')
  assert.equal(await page.locator('.fork-gal-text').count(),1,'measurement nodes are not retained as dialogue')
  assert.deepEqual(errors,[])
  await page.addStyleTag({content:await forkThemeCss()})
  for(const width of [1440,375]) {
    await page.setViewportSize({width,height:900})
    await page.waitForFunction(()=>probe.get().cards.length>1)
    await page.waitForTimeout(150)
    const state=await page.evaluate(()=>probe.get())
    assert.equal(state.pages,1)
    assert.equal(state.cards.map(card=>state.source.slice(card.start,card.end)).join(''),state.source)
    for(let i=0;i<state.cards.length;i++) {
      await page.evaluate(n=>probe.select(n),i)
      await page.waitForFunction(n=>probe.get().card===n,i)
      const size=await page.locator('.fork-gal-text:not([aria-hidden])').evaluate(e=>{const range=document.createRange();range.selectNodeContents(e.firstChild);return {bottom:range.getBoundingClientRect().bottom,limit:e.getBoundingClientRect().bottom,text:e.textContent}})
      assert.ok(size.bottom<=size.limit+1,`${width}px card ${i}: ${JSON.stringify(size)}`)
    }
  }
  assert.deepEqual(errors,[])
})
