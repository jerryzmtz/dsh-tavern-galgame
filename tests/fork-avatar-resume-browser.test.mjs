// private fork: foreground transcript avatars use real React effects and browser intersections.
import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {chromium} from 'playwright'
import {browserReactScript} from './fixtures/browser-react.mjs'
const read = name => readFileSync(new URL('../tavern-plugin/src/client/' + name, import.meta.url), 'utf8')
const bubbles = read('fork-bubbles.js')
const slice = bubbles.slice(bubbles.indexOf('function forkBubbleMediaDescriptor'), bubbles.indexOf('// Drop-in for TavernColoredMarkdown'))

test('private fork: visible scroller rows load after stage close and foreground resume', {timeout:30000}, async () => {
  const browser = await chromium.launch({channel:'chrome', headless:true})
  try {
    const page = await browser.newPage({viewport:{width:900,height:700}})
    const errors = []
    page.on('pageerror', e => errors.push(e.message))
    await page.setContent(`<style>body{margin:0}#scroll{height:400px;overflow:auto}.slot{display:contents}.fork-bubble{height:100px}.fork-bubble-avatar img{width:60px;height:60px}</style>
      <div id="scroll"><div class="slot"><div id="root"></div></div></div>`)
    await page.addScriptTag({type:'module',content:await browserReactScript() + `
      const React=modules.react, ReactDOM={...modules['react-dom'],...modules['react-dom/client']};
      ${read('fork-foreground.js')}
      // Model desktop visibility events without depending on headless Chrome's focus policy.
      const events=new EventTarget();let visible=true;
      const doc={get visibilityState(){return visible?'visible':'hidden'},hasFocus:()=>visible,
        getAnimations:()=>[],addEventListener:events.addEventListener.bind(events)};
      const host={performance,console,setTimeout:window.setTimeout.bind(window),clearTimeout:window.clearTimeout.bind(window),
        requestAnimationFrame:window.requestAnimationFrame.bind(window),cancelAnimationFrame:window.cancelAnimationFrame.bind(window),
        addEventListener:events.addEventListener.bind(events)};
      const foreground=createForkForeground(host,doc);
      let stage='s';const listeners=new Set();
      const forkGalActive={get:()=>stage,subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn)}};
      const forkPackListeners=new Set(),useForkPackRevision=()=>0;
      const forkBubbleMood=()=>null,forkBubbleMoodLabel=()=>'',forkBubbleMoodList=()=>[],
        forkBubbleDisplayName=s=>s.name,forkBubbleColor=()=> '#888';
      const image='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="red"/></svg>');
      window.acquired=0;
      const forkStageSessions={get:()=>({subscribe:()=>()=>{},getSnapshot:()=>({source:{sessionId:'s',authorityEpoch:1}})}),
        resourceOwner:{async acquire(d){window.acquired++;return{handle:{identity:d.identity,url:image},release(){}}}}};
      function ForkPackImage(props){return React.createElement('img',{src:props.src,alt:''})}
      ${readFileSync(new URL('../tavern-plugin/packages/dsh-presentation-protocol/src/figure-resolution.cjs',import.meta.url),'utf8')}
      ${read('fork-bubble-line.cjs').slice(read('fork-bubble-line.cjs').indexOf('const forkBubbleCharacterLists'),read('fork-bubble-line.cjs').indexOf('function forkBubbleDisplayName'))}
      ${slice}
      const config={characters:['kyubey','player'].map(alias=>({alias,name:alias,avatarMedia:{default:{identity:alias,revision:'r',ref:{packId:'p',figureId:alias}}}}))};
      const root=ReactDOM.createRoot(document.querySelector('#root'));
      ReactDOM.flushSync(()=>root.render(React.createElement('div',null,config.characters.map(c=>React.createElement(ForkBubbleRow,{key:c.alias,sessionId:'s',config,segment:{alias:c.alias,name:c.name,text:'line'}})))));
      window.closeStage=()=>{stage='';listeners.forEach(fn=>fn())};
      window.openStage=()=>{stage='s';listeners.forEach(fn=>fn())};
      window.resume=()=>{visible=true;events.dispatchEvent(new Event('visibilitychange'))};
      window.pause=()=>{visible=false;events.dispatchEvent(new Event('visibilitychange'))};
      window.foreground=foreground;
      window.ready=true;
    `})
    await page.waitForFunction(() => window.ready)
    assert.equal(await page.locator('.fork-bubble-avatar img').count(), 0)
    assert.equal(await page.evaluate(() => window.acquired), 0, 'stage suspension must not lease transcript images')
    await page.evaluate(() => window.closeStage())
    await page.waitForFunction(() => [...document.querySelectorAll('.fork-bubble-avatar img')].filter(i=>i.complete&&i.naturalWidth).length===2)
    assert.equal(await page.evaluate(() => window.foreground.isForeground()), true)
    await page.evaluate(() => {window.openStage();window.pause();document.querySelector('#scroll').style.display='none'})
    await page.waitForFunction(() => !document.querySelector('.fork-bubble-avatar img'))
    assert.equal(await page.evaluate(() => window.foreground.isForeground()), false)
    await page.evaluate(() => window.closeStage())
    await page.evaluate(() => {document.querySelector('#scroll').style.display='block';window.resume()})
    await page.waitForFunction(() => window.foreground.isForeground())
    await page.waitForFunction(() => [...document.querySelectorAll('.fork-bubble-avatar img')].filter(i=>i.complete&&i.naturalWidth).length===2)
    assert.deepEqual(await page.locator('.fork-bubble-avatar').allTextContents(), ['', ''])
    assert.deepEqual(errors, [])
  } finally { await browser.close() }
})
