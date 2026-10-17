// private fork: real React + Chromium regression for the 「文字演出」 stage renderer (fork-textcard-stage.js):
// a flash sequence plays without clicks at its planned timing, a click ends a card, the photosensitivity gate holds
// under a burst, the dialogue box hides only while a card is up, no long task / leaked DOM, optical centring of
// full-width punctuation, and the 履历 line between dialogue lines.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { browserReactScript } from './fixtures/browser-react.mjs'
import {compileTextcard} from '../fork/mods/textcard/templates.js'
const templateExamples=JSON.parse(await readFile(new URL('./fixtures/textcard-templates.json',import.meta.url),'utf8'))

const read = name => readFile(new URL('../' + name, import.meta.url), 'utf8')
const stageSource = await read('tavern-plugin/src/client/fork-gal-stage.js')
const autoEffect = stageSource.slice(stageSource.indexOf('    React.useEffect(function () {\n        if (!auto'), stageSource.indexOf('    React.useEffect(function () {\n        function onKey'))
// Use the same bundled family as a clean install, never the owner's font directory.
const fontDir = process.env.DSH_TAVERN_FONT_DIR || fileURLToPath(new URL('../tavern-plugin/fonts/noto-serif-sc', import.meta.url))
const fontFiles = existsSync(fontDir) ? Object.fromEntries((await readdir(fontDir)).filter(name => /^\d{3}-.*\.woff2$/.test(name)).map(name => [name.slice(0, 3), name])) : {}
const hasFont = ['400', '500', '700'].every(weight => fontFiles[weight])

async function stagePage(browser, viewport = { width: 1280, height: 720 }) {
  const page = await browser.newPage({ viewport })
  const errors = []
  page.on('pageerror', error => errors.push(String(error)))
  await page.route('http://textcard.test/**', async route => {
    const url = new URL(route.request().url())
    if (url.pathname.startsWith('/api/dsh-tavern/fonts/noto-serif-sc/')) return route.fulfill({ path: fontDir + '/' + fontFiles[url.pathname.split('/').at(-1).slice(0, 3)], contentType: 'font/woff2' })
    return route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><body style="margin:0"><div id="root"></div>' })
  })
  await page.goto('http://textcard.test/')
  await page.addStyleTag({ content: await read('tavern-plugin/lib/client-assets/fork-theme.css') })
  await page.addStyleTag({ content: await read('tavern-plugin/lib/client-assets/fork-textcard.css') })
  await page.addScriptTag({ content: await browserReactScript() + `
    const React=modules.react, ReactDOM=modules['react-dom/client'];
    // Use the production cached CSS font registrar, not new full-CJK FontFaces per card.
    function rpc(){return Promise.resolve({fonts:${hasFont} ? [{id:'noto-serif-sc',family:'Tavern noto-serif-sc',files:[400,500,700].map(weight=>({weight,style:'normal',format:'woff2',url:'/api/dsh-tavern/fonts/noto-serif-sc/'+weight+'.woff2'}))}] : []});}
    ` + await read('tavern-plugin/src/client/fork-foreground.js') + '\n' + await read('tavern-plugin/src/client/fork-fonts.js') + '\n' + await read('tavern-plugin/src/client/fork-textcard-presets.cjs') + '\n' + await read('tavern-plugin/src/client/fork-textcard-vert-ink.cjs') + '\n' + await read('tavern-plugin/src/client/fork-textcard-stage.js') + `
    window.longTasks=[]; new PerformanceObserver(list=>{for(const e of list.getEntries()) window.longTasks.push(e.duration)}).observe({entryTypes:['longtask']});
    function Harness(){
      const [reduced,setReduced]=React.useState(false); window.setReduced=setReduced;
      const tc=useForkTextcardStage({sessionId:'s',reducedMotion:reduced,colorOf:()=>'#e0689f',blocked:false});
      const [auto,setAuto]=React.useState(false); window.setAuto=setAuto;
      const presentationBusy=tc.busy,skipping=false,hidden=false,backlog=false,configOpen=false,galleryOpen=false,menuOpen=false,
        typed=true,current={text:'Done'},atEnd=false,film=false,lastCard=true,voice=null,audioBusy=false,turn=1,transitioning=false,
        page=0,card=0,subtitles={text:'Done'},awaiting=false,reading={autoWait:1,autoSpeed:1},sceneHolding=false,handoff={heldMs:0},awaitingDirection=false; // private fork (B4): director-prefix hold
      const forkForeground={setTimeout:(fn,ms)=>setTimeout(fn,ms),clearTimeout:id=>clearTimeout(id)},forkGalHandoffAutoDelay=n=>n,forkGalAutoDelay=()=>100;
      const go=()=>{window.advancedAt=performance.now();setAuto(false);tc.cancel();};
      ` + autoEffect + `
      return React.createElement('div',{className:'fork-gal-stage'+(tc.up?' is-textcard':''),'data-theme':'classic',style:{position:'relative',width:'100vw',height:'100vh',overflow:'hidden'},onClick:()=>tc.skip()},
        React.createElement('div',{className:'fork-gal-box',style:{position:'absolute',left:0,right:0,bottom:0,height:'20vh'}},'line'),tc.node);
    }
    ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Harness));
    // Samples the painted state every frame: background of the shown card (or 'scene') and whether the box is visible.
    window.sample=()=>{ window.samples=[]; const loop=t=>{ const card=document.querySelector('.fork-tc'); const box=document.querySelector('.fork-gal-box');
      window.samples.push({t,bg:card?getComputedStyle(card).backgroundColor:'scene',text:card?card.textContent:'',box:getComputedStyle(box).visibility}); window.sampling=requestAnimationFrame(loop); }; window.sampling=requestAnimationFrame(loop); };
    window.stopSample=()=>{ cancelAnimationFrame(window.sampling); return window.samples; };
  ` })
  await page.waitForFunction(() => !!window.forkTextcardDebug)
  return { page, errors }
}
// Colour changes in any 1 s window, from per-frame paint samples.
function peak(samples) {
  const changes = []
  for (let i = 1; i < samples.length; i++) if (samples[i].bg !== samples[i - 1].bg) changes.push(samples[i].t)
  let best = 0, j = 0
  for (let i = 0; i < changes.length; i++) { while (changes[i] - changes[j] >= 1000) j++; best = Math.max(best, i - j + 1) }
  return { best, changes: changes.length }
}

test('textcard: dialogue visibility follows the mounted card before React commits', { timeout: 30000 }, async t => {
  const browser = await chromium.launch({ headless: true, args: ['--mute-audio'] })
  t.after(() => browser.close())
  const { page, errors } = await stagePage(browser)
  const result = await page.evaluate(async () => {
    const root = document.createElement('div')
    root.className = 'fork-gal-stage'
    root.innerHTML = '<div class="fork-tc-layer"><div class="fork-tc-host"></div></div><div class="fork-gal-box">line</div><div class="fork-gal-choices">choice</div>'
    document.body.append(root)
    let clock = performance.now()
    const player = createTextcardPlayer({ fontsLoaded: () => true, now: () => clock })
    player.attach(root.querySelector('.fork-tc-host'))
    const visibility = () => [...root.querySelectorAll('.fork-gal-box,.fork-gal-choices')].map(node => getComputedStyle(node).visibility)
    try {
      const before = visibility()
      const done = player.play(planTextcard({ style: 'word', parts: ['test'] }))
      const mounted = !!root.querySelector('.fork-tc'), during = visibility(), mirrored = root.classList.contains('is-textcard')
      clock += 500
      player.skip()
      await done
      return { before, mounted, during, mirrored, after: visibility() }
    } finally { player.dispose(); root.remove() }
  })
  assert.deepEqual(result, { before: ['visible', 'visible'], mounted: true, during: ['hidden', 'hidden'], mirrored: false, after: ['visible', 'visible'] })
  assert.deepEqual(errors, [])
})

test('textcard: flash plays without clicks, click ends a card, gate holds, box hides only while up, no leak', { timeout: 60000 }, async t => {
  const browser = await chromium.launch({ headless: true, args: ['--mute-audio'] })
  t.after(() => browser.close())
  const { page, errors } = await stagePage(browser)
  const words = ['黑发', '盾', '(0401)', '齿轮', '崩塌', '回头', '名字是——', '想不起来']

  // Warm the font once (the stage registers it on mount; the first card may wait for it at most 600 ms).
  await page.evaluate(() => window.forkTextcardDebug.play({ style: 'word', parts: ['冥土'] }))

  // The playback budget excludes initial React/font setup, as the stage perf harness does.
  await page.evaluate(() => { window.longTasks.length = 0; window.sample() })

  // 1. A flash sequence needs no clicks: eight words, planned whole-frame timing, one background.
  const flash = await page.evaluate(async words => {
    const plan = window.forkTextcardDebug.plan({ style: 'flash', parts: words })
    const skipped = await window.forkTextcardDebug.play({ style: 'flash', parts: words })
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
    return { skipped, plan: plan.frames.map(f => [f.state.text, Math.round(f.ms)]), record: window.forkTextcardDebug.log().cards.at(-1) }
  }, words)
  const flashSamples = await page.evaluate(() => window.stopSample())
  assert.equal(flash.skipped, false)
  assert.equal(flash.plan.length, 8, 'every word, no silent truncation')
  const shown = [...new Set(flashSamples.filter(s => s.text).map(s => s.text))]
  assert.deepEqual(shown, flash.plan.map(([text]) => text), 'every word is painted, in order')
  // Each state lasts its planned time within one 60 Hz frame (plus the 8 ms early swap).
  const durations = flash.record.frames.slice(1).map((at, i) => at - flash.record.frames[i])
  durations.forEach((ms, i) => assert.ok(Math.abs(ms - flash.plan[i][1]) <= 25, `state ${i}: ${ms} vs ${flash.plan[i][1]}`))
  assert.equal(new Set(flashSamples.filter(s => s.text).map(s => s.bg)).size, 1, 'flash keeps one background')
  assert.ok(flashSamples.filter(s => s.text).every(s => s.box === 'hidden'), 'box hidden while the card is up')
  assert.equal(flashSamples.at(-1).box, 'visible', 'box back after the card')

  // 2. A click during a card ends it at once (in + out = 2 changes, the gate has room) and leaves no DOM.
  const skip = await page.evaluate(async () => {
    const done = window.forkTextcardDebug.play({ style: 'title', parts: ['ひたぎクラブ'], sub: '其ノ壹' })
    // Measure skip after a painted card, not while font loading/the entry gate is pending.
    while (!document.querySelector('.fork-tc')) await new Promise(r => requestAnimationFrame(r))
    await new Promise(r => setTimeout(r, 1000))
    // The live region repeats the kana in the card face: a system fallback font loaded here was the 70–120 ms long task.
    const fonts = [document.querySelector('.fork-tc-sr'), document.querySelector('.fork-tc')].map(node => getComputedStyle(node).fontFamily)
    const clickedAt = performance.now()
    document.querySelector('.fork-tc-layer').click()
    const skipped = await done
    return { skipped, after: performance.now() - clickedAt, nodes: document.querySelector('.fork-tc-host').childElementCount, fonts }
  })
  assert.equal(skip.fonts[0], skip.fonts[1], 'the live region uses the loaded card face')
  assert.equal(skip.skipped, true)
  assert.ok(skip.after < 120, 'ended within a frame or two: ' + skip.after)
  assert.equal(skip.nodes, 0)

  // 3. Gate: a burst of colour-changing cards (inverting pair, coloured count, cards) never exceeds 3 changes/s.
  await page.waitForTimeout(1100)
  await page.evaluate(() => window.sample())
  const burst = await page.evaluate(async () => {
    const d = window.forkTextcardDebug
    const all = [d.play({ style: 'pair', parts: ['關', '絹'], intensity: 'intense' }), d.play({ style: 'colour', parts: ['赤', '白', '黒', '金'] }),
      d.play({ style: 'word', parts: ['冥土'] }), d.play({ style: 'marker', parts: ['recall'] }), d.play({ style: 'punct', parts: ['赤齣'] }),
      ...Array.from({length:7}, (_,i) => d.play({style:'word',parts:['第'+i+'幕']}))]
    const skipped = await Promise.all(all)
    return {...d.log(), skipped}
  })
  const burstSamples = await page.evaluate(() => window.stopSample())
  const painted = peak(burstSamples)
  assert.ok(painted.changes >= 8, 'the burst really changes colour: ' + painted.changes)
  assert.ok(painted.best <= 3, 'painted colour changes per second: ' + painted.best)
  assert.ok(burst.peak <= 3)
  assert.ok(burst.skipped.every(value => value === false), 'all 12 admitted cards play; the queue drops none')

  const cancelled = await page.evaluate(async () => {
    const d = window.forkTextcardDebug;
    const pending = d.play({style:'title',parts:['记忆']});
    while (!document.querySelector('.fork-tc')) await new Promise(r => requestAnimationFrame(r));
    d.cancel();
    await pending;
    await d.play({style:'punct',parts:['赤齣']});
    return d.log().changes;
  });
  assert.ok(cancelled.slice(1).every((at,i)=>at-cancelled[i]>=375), 'cancellation also respects the 375ms colour floor');

  // 4. 减少闪烁 follows the stage setting: ≤ 4 states, each ≥ 458 ms, no inversion.
  await page.evaluate(() => window.setReduced(true))
  await page.waitForTimeout(50)
  const reduced = await page.evaluate(async words => { await window.forkTextcardDebug.play({ style: 'flash', parts: words }); return window.forkTextcardDebug.log().cards.at(-1) }, words)
  assert.ok(reduced.planned.length <= 4 && reduced.planned.every(ms => ms >= 458), JSON.stringify(reduced.planned))
  await page.evaluate(() => window.setReduced(false))

  // 5. Performance: no long task over 50 ms while cards show; nothing left in the layer.
  assert.deepEqual(await page.evaluate(() => window.longTasks.filter(ms => ms > 50)), [])
  if (hasFont) assert.equal(await page.evaluate(() => document.querySelector('[data-fork-font-faces]').sheet.cssRules.length), 3, 'burst playback must not reinstall font faces')
  assert.equal(await page.evaluate(() => document.querySelector('.fork-tc-host').childElementCount), 0)
  assert.deepEqual(errors, [])
})

test('textcard: full-width punctuation is optically centred (ink margins within 2% of the card)', { timeout: 60000, skip: !hasFont && 'Noto Serif SC is not installed in the font library' }, async t => {
  const browser = await chromium.launch({ headless: true, args: ['--mute-audio'] })
  t.after(() => browser.close())
  for (const viewport of [{ width: 1280, height: 720 }, { width: 390, height: 844 }]) {
    const { page, errors } = await stagePage(browser, viewport)
    await page.evaluate(() => window.forkTextcardDebug.play({ style: 'word', parts: ['冥土'] }))
    for (const payload of [{ style: 'kanji', parts: ['？'] }, { style: 'word', parts: ['真的？'] }, { style: 'name', parts: ['真的？'] },
      { style: 'vertical', parts: ['真的？'] }, { style: 'flash', parts: ['真的？', '？'], stepFrames: [240, 240] }, { style: 'title', parts: ['真的？'] }]) {
      const margins = await page.evaluate(async payload => {
        const hold = { ...payload }
        window.forkTextcardDebug.play(hold)
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
        return true
      }, payload)
      assert.ok(margins)
      const card = page.locator('.fork-tc')
      const png = (await card.screenshot()).toString('base64')
      const ink = await page.evaluate(async png => {
        const image = new Image(); image.src = 'data:image/png;base64,' + png; await image.decode()
        const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height
        const c = canvas.getContext('2d'); c.drawImage(image, 0, 0)
        const { data } = c.getImageData(0, 0, image.width, image.height)
        const bg = [data[0], data[1], data[2]]
        let left = image.width, right = -1, top = image.height, bottom = -1
        for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
          const i = (y * image.width + x) * 4
          if (Math.abs(data[i] - bg[0]) + Math.abs(data[i + 1] - bg[1]) + Math.abs(data[i + 2] - bg[2]) > 60) { left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y) }
        }
        return { width: image.width, height: image.height, left, right: image.width - 1 - right, top, bottom: image.height - 1 - bottom }
      }, png)
      await page.evaluate(() => window.forkTextcardDebug.skip())
      await page.waitForTimeout(1100) // let the gate window pass between samples
      const skew = Math.abs(ink.left - ink.right) / ink.width
      t.diagnostic(viewport.width + 'px ' + payload.style + ' ' + payload.parts[0] + ' L/R ' + (skew * 100).toFixed(2) + '% T/B ' + (Math.abs(ink.top - ink.bottom) / ink.height * 100).toFixed(2) + '%')
      assert.ok(ink.right >= 0 && ink.left < ink.width, JSON.stringify(payload) + ' has ink')
      if (payload.style !== 'title') assert.ok(skew <= 0.02, `${viewport.width}px ${JSON.stringify(payload)}: left ${ink.left} right ${ink.right} (${(skew * 100).toFixed(2)}%)`)
      if (payload.style === 'vertical' || payload.style === 'kanji') {
        const vskew = Math.abs(ink.top - ink.bottom) / ink.height
        assert.ok(vskew <= 0.02, `${viewport.width}px ${JSON.stringify(payload)} vertical: top ${ink.top} bottom ${ink.bottom}`)
      }
    }
    assert.deepEqual(errors, [])
    await page.close()
  }
})

test('履历: explicit echoes follow their line; legacy cards precede it; a flash sequence is one line', { timeout: 30000 }, async t => {
  const browser = await chromium.launch({ headless: true, args: ['--mute-audio'] })
  t.after(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 1100, height: 700 } })
  const errors = []
  page.on('pageerror', error => errors.push(String(error)))
  await page.setContent('<!doctype html><meta charset="utf-8"><div id="root" class="fork-gal-stage" data-theme="classic" style="position:relative;height:700px"></div>')
  await page.addStyleTag({ content: await read('tavern-plugin/lib/client-assets/fork-theme.css') })
  await page.addScriptTag({ content: await browserReactScript() + `
    const React=modules.react, ReactDOM=modules['react-dom/client'];
    const forkVoicePlayer={subscribe:()=>()=>{},get:()=>null};
    function useLiveTavernView(){return null}
    function ForkHelpTip(){return null}
    function ForkIcon(){return null}
    const words=['黑发','盾','(0401)','齿轮','崩塌','回头','名字是——','想不起来'];
    function useForkStageModHistory(){ return [{turn:2,performances:[
      {id:'a',kind:'dsh.textcard.card',at:2,payload:{version:1,style:'flash',parts:words,steps:words,history:{kind:'textcard',style:'flash',text:words.join(' / '),parts:words}}},
      {id:'b',kind:'dsh.textcard.card',at:3,payload:{version:1,style:'punct',parts:['赤齣'],history:{kind:'textcard',style:'punct',text:'赤齣',parts:['赤齣']}}},
      {id:'c',kind:'dsh.textcard.card',at:3,payload:{version:1,placement:'after',style:'word',parts:['冥土'],history:{kind:'textcard',style:'word',text:'冥土',parts:['冥土']}}}]}]; }
    ` + await read('tavern-plugin/src/client/fork-textcard-presets.cjs') + '\n' + await read('tavern-plugin/src/client/fork-textcard-vert-ink.cjs') + '\n' + await read('tavern-plugin/src/client/fork-textcard-stage.js') + '\n' + await read('tavern-plugin/src/client/fork-gal-backlog.js') })
  await page.evaluate(() => {
    const pages = [1, 2, 3, 4].map(para => ({ kind: 'narration', text: 'line ' + para, para, anchor: { para, offset: 0 } }))
    ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(ForkGalBacklog, {
      sessionId: 's', turn: 2, pages, page: 3, textIndex: new Map(), onClose() {}, onJump() {} }))
  })
  await page.waitForSelector('.fork-gal-backlog-card')
  const rows = await page.$$eval('.fork-gal-backlog-col > div', nodes => nodes.map(node => node.className.includes('backlog-card') ? 'card:' + node.textContent : node.className.includes('backlog-row') ? node.textContent : null).filter(Boolean))
  assert.deepEqual(rows, ['line 1', 'card:快闪黑发 / 盾 / (0401) / 齿轮 / 崩塌 / 回头 / 名字是—— / 想不起来', 'line 2', 'card:齣赤齣', 'line 3', 'card:字卡冥土', 'line 4'])
  const style = await page.$eval('.fork-gal-backlog-card', node => ({ cursor: getComputedStyle(node).cursor, tab: node.tabIndex }))
  assert.equal(style.tab, -1, 'not a jump target')
  assert.deepEqual(errors, [])
})


test('auto advance waits for the textcard style clock, while a manual click can end the hold', {timeout:30000}, async t=>{
  const browser=await chromium.launch({headless:true,args:['--mute-audio']});t.after(()=>browser.close());
  const {page,errors}=await stagePage(browser);
  const result=await page.evaluate(async()=>{
    const payload={style:'word',parts:['Read this'],intensity:'standard'};
    const planned=forkTextcardDebug.plan(payload).frames.reduce((sum,f)=>sum+f.ms,0);
    const start=performance.now(),playing=forkTextcardDebug.play(payload);setAuto(true);
    await playing;
    const elapsed=performance.now()-start,earlyAdvance=window.advancedAt;
    await new Promise(resolve=>setTimeout(resolve,250));
    const advanced=window.advancedAt;
    const manualStart=performance.now(),manual=forkTextcardDebug.play(payload);
    document.querySelector('.fork-gal-stage').click();await manual;
    return {planned,elapsed,earlyAdvance,advanced,start,manual:performance.now()-manualStart};
  }).catch(error=>{throw new Error(error.message+'; browser errors: '+errors.join('; '));});
  assert.equal(result.earlyAdvance,undefined);
  assert.ok(result.elapsed>=result.planned-60,JSON.stringify(result));
  assert.ok(result.advanced-result.start>=result.planned-60);
  assert.ok(result.manual<result.planned);
  assert.deepEqual(errors,[]);
});

test('compound renderer paints all nine plans and directed labels without exposing local IDs, on desktop and mobile', {timeout:60000}, async t=>{
  const browser=await chromium.launch({headless:true,args:['--mute-audio']})
  t.after(()=>browser.close())
  const payloads=Object.entries(templateExamples).map(([id,params])=>compileTextcard(id,params))
  payloads.push(compileTextcard('read',{code:'CASE-LONG',body:'档'.repeat(800),heading:'档案'}))
  for(const viewport of [{width:1280,height:720},{width:375,height:812}]) {
    const {page,errors}=await stagePage(browser,viewport)
    const result=await page.evaluate(async payloads=>{
      await forkTextcardFonts()
      const results=[]
      const host=document.querySelector('.fork-tc-host')
      for(const payload of payloads) {
        const plan=forkTextcardPlan(payload,false,'')
        await forkTextcardFontsReady(plan,await forkTextcardFonts())
        const states=[]
        for(const frame of plan.frames) {
          const {card}=forkTextcardNode(document,plan,frame,{})
          host.replaceChildren(card);forkTextcardFit(card);forkTextcardCenter(card)
          const body=card.querySelector('.fork-tc-page-text')
          states.push({text:card.textContent,people:card.querySelectorAll('.fork-tc-relate-person').length,
            links:card.querySelectorAll('path[marker-end]').length,body:body?{chars:body.textContent.length,fontSize:parseFloat(getComputedStyle(body).fontSize),width:body.clientWidth,scrollWidth:body.scrollWidth,height:body.clientHeight,scrollHeight:body.scrollHeight}:null})
        }
        results.push({template:payload.template,states})
      }
      host.replaceChildren()
      return results
    },payloads)
    assert.equal(result.length,10)
    const relation=result.find(row=>row.template==='relate').states
    assert.deepEqual(relation.map(row=>[row.people,row.links]),[[1,0],[2,0],[2,1],[2,1]])
    assert.ok(relation.at(-1).text.includes('反复拯救'))
    assert.ok(relation.every(row=>!row.text.includes('p-01') && !row.text.includes('p-02')))
    const shortDossier=result.find(row=>row.template==='read').states.at(-1).body
    assert.ok(shortDossier.fontSize>=(viewport.width>720?20:12),JSON.stringify({viewport,shortDossier}))
    const dossier=result.at(-1).states.at(-1).body
    assert.equal(dossier.chars,800)
    assert.ok(dossier.scrollWidth<=dossier.width+1 && dossier.scrollHeight<=dossier.height+1,JSON.stringify({viewport,dossier}))
    assert.deepEqual(errors,[])
    await page.close()
  }
})

test('compound count follows the real foreground active-time clock and shares the colour gate with v1 cards', {timeout:30000}, async t=>{
  const browser=await chromium.launch({headless:true,args:['--mute-audio']})
  t.after(()=>browser.close())
  const {page,errors}=await stagePage(browser)
  await page.evaluate(()=>forkTextcardDebug.play({style:'word',parts:['暖场']}))
  await page.evaluate(payload=>{window.countDone=forkTextcardDebug.play(payload)},compileTextcard('count',{from:2,label:'关门'},'intense'))
  await page.waitForFunction(()=>document.querySelector('.fork-tc-fl-word')?.textContent==='2')
  await page.waitForTimeout(250)
  const frozen=await page.evaluate(()=>{
    window.tcHidden=true
    Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>window.tcHidden?'hidden':'visible'})
    forkForeground.refresh()
    return forkForeground.now()
  })
  await page.waitForTimeout(1250)
  const during=await page.evaluate(()=>({now:forkForeground.now(),text:document.querySelector('.fork-tc-fl-word').textContent}))
  assert.deepEqual(during,{now:frozen,text:'2'})
  await page.evaluate(()=>{window.tcHidden=false;forkForeground.refresh()})
  await page.evaluate(()=>window.countDone)
  const log=await page.evaluate(()=>forkTextcardDebug.log())
  const count=log.cards.at(-1)
  assert.equal(count.style,'count')
  assert.deepEqual(count.planned,[1000,1000,500])
  assert.ok(Math.abs(count.frames[1]-1000)<45,JSON.stringify(count))
  assert.ok(Math.abs(count.frames[2]-2000)<70,JSON.stringify(count))
  assert.ok(log.peak<=3)
  assert.deepEqual(errors,[])
})
