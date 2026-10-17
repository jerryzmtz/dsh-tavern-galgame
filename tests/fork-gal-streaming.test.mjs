// private fork: F's stream source is the session adapter, never transcript publication.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {chromium} from 'playwright'
import {browserReactScript} from './fixtures/browser-react.mjs'
import {transcriptSource} from './helpers/fork-transcript-perf-ui.mjs'
const read=name=>fs.readFileSync(new URL('../tavern-plugin/src/client/'+name,import.meta.url),'utf8')
test('streaming changes only the active session tail while frozen transcript and historical anchors stay unchanged',{timeout:30000},async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true})
  try {
    const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message))
    await page.setContent('<style>body{color:#222}</style>')
    await page.addScriptTag({content:await browserReactScript()+'\nconst React=modules.react,ReactDOM={...modules["react-dom"],...modules["react-dom/client"]};\n'+transcriptSource(read)})
    const result=await page.evaluate(async()=>{
      const p=transcriptProbe,wait=()=>new Promise(resolve=>setTimeout(resolve,40)),old=p.runtime.getSnapshot().textIndex.get(1)
      p.reset();for(let i=0;i<8;i++){p.tick();await wait()}
      const visible={...p.counts,messages:{...p.counts.messages}}
      p.active(true);await wait();p.reset()
      for(let i=0;i<10;i++){p.tick();await wait()}
      const hidden={...p.counts},state=p.runtime.getSnapshot(),retained=state.textIndex.get(1)===old
      const text=state.textIndex.get(141).parts[0].text,anchors=state.text.pages.map(page=>page.anchor)
      p.active(false);await wait();const restored=p.mount.textContent
      p.dispose();await wait();return {visible,hidden,retained,text,anchors,restored,remaining:CSS.highlights.size}
    })
    assert.deepEqual(errors,[])
    assert.deepEqual(Object.keys(result.visible.messages),['141:0:n140'])
    assert.equal(result.hidden.markdown,0);assert.equal(result.hidden.host,0)
    assert.equal(result.retained,true);assert.match(result.text,/Latest 18/);assert.match(result.restored,/Latest 18/)
    assert.ok(result.anchors.every(anchor=>anchor.paragraphId && anchor.para>0))
    assert.equal(result.remaining,0)
  } finally {await browser.close()}
})
