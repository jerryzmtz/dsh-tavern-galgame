// private fork (O29): the recorded finished fish-18 inner thought, rendered by the real chat bubble row and the
// real 履历 in Chromium. Before the fix both lost the closing bracket and the 履历 row showed the typing dots.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { browserReactScript } from './fixtures/browser-react.mjs'
import { FISH_18 } from './fixtures/o29-fish-18.mjs'

const read = name => readFile(new URL('../' + name, import.meta.url), 'utf8')

test('O29 browser: finished inner thought keeps both brackets in chat and 履历; a live tail still types', async t => {
  const browser = await chromium.launch({ headless: true, args: ['--mute-audio'] })
  t.after(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 1100, height: 700 } })
  const errors = []
  page.on('pageerror', error => errors.push(String(error)))
  await page.route('**/*', route => route.abort())
  await page.setContent('<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><div id="chat"></div><div id="backlog" class="fork-gal-stage" data-theme="classic"></div></html>')
  await page.addStyleTag({ content: await read('tavern-plugin/lib/client-assets/fork-theme.css') })
  const bubbles = await read('tavern-plugin/src/client/fork-bubbles.js'), stage = await read('tavern-plugin/src/client/fork-gal-stage.js')
  await page.addScriptTag({ content: await browserReactScript() + `
    const React=modules.react, ReactDOM=modules['react-dom/client'], flushSync=modules['react-dom'].flushSync;
    const forkVoicePlayer={subscribe:()=>()=>{},get:()=>null};
    function useLiveTavernView(){return null} function ForkHelpTip(){return null} function ForkIcon(){return null}
    const forkBubbleColor=()=>'#8b8f99',forkBubbleMoodList=()=>[],forkBubbleMood=()=>null,forkBubbleMoodLabel=()=>'',forkBubbleViewport={watch:()=>()=>{}},useForkBubbleMedia=()=>null,ForkBubbleAvatar=()=>null;
    ${await read('tavern-plugin/packages/dsh-presentation-protocol/src/figure-resolution.cjs')}
    ${await read('tavern-plugin/src/client/fork-bubble-line.cjs')}
    ${bubbles.slice(bubbles.indexOf('function ForkBubbleRow('), bubbles.indexOf('// Drop-in for TavernColoredMarkdown'))}
    ${stage.slice(stage.indexOf('function forkGalPlain'), stage.indexOf('// Film cards'))}
    ${await read('tavern-plugin/src/client/fork-gal-backlog.js')}
    const chat=ReactDOM.createRoot(document.getElementById('chat')), backlog=ReactDOM.createRoot(document.getElementById('backlog'));
    window.mount=(raw,streaming)=>{
      const segments=forkParseBubbles(raw,streaming), units=forkGalParagraphs([{segments,streaming}]);
      flushSync(()=>chat.render(React.createElement('div',null,segments.map((segment,i)=>React.createElement(ForkBubbleRow,{key:i,segment,config:{characters:[]},sessionId:'offline'})))));
      flushSync(()=>backlog.render(React.createElement(ForkGalBacklog,{sessionId:'offline',turn:19,pages:units,page:0,textIndex:new Map([[18,{units}]]),
        config:{characters:[]},colorOf:()=>'',avatarOf:()=>null,nameOf:()=>'',onJump(){},onClose(){}})));
    };` })
  const inspect = () => page.evaluate(() => {
    const line = document.querySelector('#chat .fork-bubble-line')
    return { chat: line.textContent, after: getComputedStyle(line, '::after').content,
      rows: [...document.querySelectorAll('.fork-gal-backlog-row')].map(row => ({ text: row.querySelector('.fork-gal-backlog-text').textContent,
        thought: !!row.querySelector('.fork-gal-backlog-tag'), typing: !!row.querySelector('.fork-gal-typing') })) }
  })
  await page.evaluate(raw => window.mount(raw, false), FISH_18)
  const done = await inspect()
  assert.match(done.chat, /^（哼哼.*大道理！）$/, 'chat bubble closes the inner thought')
  assert.equal(done.rows.length, 2, 'previous turn and current turn rows')
  for (const row of done.rows) {
    assert.equal(row.thought, true)
    assert.match(row.text, /^（哼哼.*大道理！）$/)
    assert.equal(row.typing, false, 'no 「正在生成」 on a finished turn')
  }
  // Genuine stream: the live tail is still open and typing.
  await page.evaluate(raw => window.mount(raw, true), FISH_18)
  const live = await inspect()
  assert.doesNotMatch(live.chat, /）$/)
  assert.ok(live.rows.some(row => row.typing))
  assert.deepEqual(errors, [])
})
