// private fork: backlog and lip-sync must share canonical figure resolution.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { browserReactScript } from './fixtures/browser-react.mjs'

const read = name => readFile(new URL('../' + name, import.meta.url), 'utf8')

test('backlog resolves authored aliases and names before selecting pack avatars and figure colors', async t => {
  const stage = await read('tavern-plugin/src/client/fork-gal-stage.js')
  const callbacks = ['colorOf', 'avatarOf', 'nameOf'].map(name => stage.match(new RegExp('    function ' + name + '\\([^\\n]+'))[0]).join('\n')
  const browser = await chromium.launch({ headless: true })
  t.after(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } })
  const errors = []
  page.on('pageerror', error => errors.push(String(error)))
  await page.setContent('<!doctype html><div id="root" class="fork-gal-stage" data-theme="classic"></div>')
  await page.addStyleTag({ content: await read('tavern-plugin/lib/client-assets/fork-theme.css') })
  await page.addScriptTag({ content: await browserReactScript() + `
    const React=modules.react, ReactDOM=modules['react-dom/client'];
    const forkVoicePlayer={subscribe:()=>()=>{},get:()=>null};
    function useLiveTavernView(){return null}
    function ForkHelpTip(){return null}
    function ForkIcon(){return null}
    function forkBubbleColor(){return '#777777'}
    ` + await read('tavern-plugin/packages/dsh-presentation-protocol/src/figure-resolution.cjs')
      + await read('tavern-plugin/src/client/fork-bubble-line.cjs')
      + await read('tavern-plugin/src/client/fork-pack-playback.cjs')
      + await read('tavern-plugin/src/client/fork-gal-backlog.js') + `
    const config={characters:[
      {alias:'f_efed52c1c67556e0',name:'Whale',aliases:['dafeiyu'],ref:{packId:'pack',figureId:'whale'},color:'#8eeadf'},
      {alias:'f_madoka',name:'Madoka',aliases:['madoka'],ref:{packId:'pack',figureId:'madoka'},color:'#ee99bb'},
      {alias:'f_neuro',name:'Neuro',aliases:['neuro'],ref:{packId:'pack',figureId:'neuro'},color:'#99ee88'},
      {alias:'f_disabled',name:'Disabled',aliases:['disabled'],ref:{packId:'pack',figureId:'disabled'},enabled:false,color:'#ffffff'}
    ]};
    const image='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="100"><rect width="80" height="100" fill="teal"/></svg>');
    const portraits=new Map(config.characters.map(row=>[row.alias,{identity:row.alias,src:image,crop:{x:0,y:0,w:0.5,h:0.5}}]));
    ${callbacks}
    const root=ReactDOM.createRoot(document.getElementById('root'));
    window.mountBacklog=(characters,rows)=>{
      if(characters) config.characters=characters;
      const units=rows.map((row,i)=>({kind:'line',para:i+1,text:'Read line '+i,...row}));
      modules['react-dom'].flushSync(()=>root.render(React.createElement(ForkGalBacklog,{
        sessionId:'offline',config,textIndex:new Map([[1,{units:units.slice(0,3)}]]),turn:2,
        pages:units.slice(3),page:units.length-4,colorOf,avatarOf,nameOf,onJump(){},onClose(){}
      })));
    };
    window.mountBacklog(null,[{alias:'dafeiyu'},{alias:'madoka'},{alias:'neuro'},
      {alias:'unlisted',name:'Whale'},{alias:'f_efed52c1c67556e0'},
      {alias:'unknown'},{alias:'disabled'},{kind:'narration',alias:'dafeiyu'}]);
  ` })
  await page.waitForTimeout(150)
  assert.deepEqual(errors, [])
  const rows = page.locator('.fork-gal-backlog-row')
  assert.equal(await rows.count(), 8)
  for (const [index, color, name] of [[0,'#8eeadf','Whale'],[1,'#ee99bb','Madoka'],[2,'#99ee88','Neuro'],[3,'#8eeadf','Whale'],[4,'#8eeadf','Whale']]) {
    const row = rows.nth(index)
    assert.equal(await row.locator('.fork-gal-backlog-face img').count(), 1, 'avatar for row '+index)
    await row.locator('img').evaluate(image => image.decode())
    assert.ok(await row.locator('img').evaluate(image => image.complete && image.naturalWidth > 0))
    // private fork: canonical colour stays on the row; the name-band fix removes the inline name hook.
    assert.equal(await row.evaluate(node => node.style.getPropertyValue('--row-color')), color)
    assert.equal(await row.locator('.fork-gal-backlog-name b').getAttribute('data-figure-text-color'), null)
    assert.equal(await row.locator('.fork-gal-backlog-name b').textContent(), name)
    assert.equal(await row.locator('.fork-pack-crop').getAttribute('data-avatar-crop'), '{"x":0,"y":0,"w":0.5,"h":0.5}')
  }
  for (const index of [5,6,7]) assert.equal(await rows.nth(index).locator('img').count(), 0, 'never borrow another figure for row '+index)
  assert.equal(await rows.nth(7).locator('.fork-gal-backlog-name').count(), 0)
  await page.evaluate(() => window.mountBacklog([{alias:'f_neuro',name:'Legacy',color:'#99ee88'}],
    [{alias:'f_neuro'},{kind:'narration'},{kind:'narration'},{alias:'f_neuro'}]))
  assert.equal(await page.locator('.fork-gal-backlog-face img').count(), 2, 'legacy exact aliases still resolve')
  assert.deepEqual(errors, [])
  assert.match(stage, /h\(ForkGalBacklog, \{ sessionId, config,/, 'mounted stage supplies its resolver config')
})
