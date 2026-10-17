// private fork (owner 2026-10): the stage textbox name row carries no figure-colour background band. The real
// ForkGalNamePlate, production CSS and the contrast hook (still mounted for SKIP) render in headless Chromium.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { browserReactScript } from './fixtures/browser-react.mjs'

const read = name => readFile(new URL('../' + name, import.meta.url), 'utf8')
const between = (text, a, b) => { const i = text.indexOf(a), j = text.indexOf(b, i); assert.ok(i >= 0 && j > i, a); return text.slice(i, j) }

test('textbox name row: no figure-colour background; classic name keeps the pre-v3.1 CSS tint; skins keep their plate', { timeout: 60000 }, async t => {
  const stage = await read('tavern-plugin/src/client/fork-gal-stage.js')
  const plate = between(stage, 'function ForkGalNamePlate(props)', '// Mounted in the session shell')
  assert.doesNotMatch(plate, /data-figure-text-color/)
  assert.match(stage, /h\(ForkGalNamePlate, \{ name, mood:/)
  const css = await read('tavern-plugin/lib/client-assets/fork-theme.css')
  const skinName = between(css, '.fork-gal-stage[data-theme][data-fk-skin]:not(.is-film) .fork-gal-box .fork-gal-name {', '}')
  assert.doesNotMatch(skinName, /--figure-skin-text-color/)
  const browser = await chromium.launch({ headless: true })
  t.after(() => browser.close())
  const errors = []
  for (const viewport of [{ width: 1600, height: 900 }, { width: 375, height: 812 }]) {
    const page = await browser.newPage({ viewport, colorScheme: 'dark' })
    page.on('pageerror', error => errors.push(String(error)))
    await page.setContent('<!doctype html><meta charset="utf-8"><body data-ds-dark-theme><div id="root"></div></body>')
    await page.addStyleTag({ content: css })
    await page.addScriptTag({ content: await browserReactScript() + ';const React=modules.react,ReactDOM=modules["react-dom/client"];\n' +
      'function ForkIcon(p){return React.createElement("i",{style:{display:"inline-block",width:p.size,height:p.size}})}\n' + plate + `
      const h=React.createElement;
      function Stage({theme,mood,film,skin}){const ref=React.useRef(null),color='#5f9a6e';
        useForkFigureTextContrast(React,ref,true,theme,film,color,mood,skin);
        return h('div',{ref,className:'fork-gal-stage'+(film?' is-film':''),'data-theme':theme,'data-fk-skin':skin?'fixture':undefined,
            style:{position:'fixed',inset:0,'--fk-s-stage-textbox-bgSolid':'#1c1926','--gal-skin-name-bg':'#c2185b','--gal-skin-name-fg':'#ffffff'}},
          h('div',{className:'fork-gal-box','data-figure-skip-color':color,style:{'--bubble-color':color}},
            h(ForkGalNamePlate,{name:'志筑仁美',mood,classic:theme==='classic',film,voiceState:'',onReplay(){}}),
            h('div',{className:'fork-gal-text'},'「早上好。」')));}
      const root=ReactDOM.createRoot(document.getElementById('root'));
      window.show=props=>new Promise(resolve=>{root.render(h(Stage,props));setTimeout(resolve,120)});
      window.probe=()=>{const n=document.querySelector('.fork-gal-name'),s=getComputedStyle(n),ref=document.createElement('i');
        ref.style.color='color-mix(in srgb, #5f9a6e 42%, #fff)';document.body.append(ref);const tint=getComputedStyle(ref).color;ref.remove();
        return {bg:s.backgroundColor,image:s.backgroundImage,color:s.color,tint,inline:[n,...n.querySelectorAll('*')].map(x=>x.getAttribute('style')).filter(Boolean)}};` })
    for (const mood of ['平静', '开心']) {
      for (const theme of ['classic', 'gothic', 'magical', 'crt']) {
        await page.evaluate(props => window.show(props), { theme, mood, film: false, skin: false })
        const row = await page.evaluate(() => window.probe())
        assert.deepEqual(row.inline, [], theme + ' ' + mood + ': helper writes nothing on the name row')
        if (theme === 'classic') {
          assert.equal(row.bg, 'rgba(0, 0, 0, 0)', 'classic name row has no band')
          assert.equal(row.image, 'none')
          assert.equal(row.color, row.tint, 'classic name text keeps the figure tint from theme CSS')
        }
      }
      await page.evaluate(props => window.show(props), { theme: 'classic', mood, film: true, skin: false })
      assert.equal((await page.evaluate(() => window.probe())).bg, 'rgba(0, 0, 0, 0)', 'film subtitle name has no band')
      await page.evaluate(props => window.show(props), { theme: 'classic', mood, film: false, skin: true })
      const skinned = await page.evaluate(() => window.probe())
      assert.deepEqual({ bg: skinned.bg, color: skinned.color, inline: skinned.inline }, { bg: 'rgb(194, 24, 91)', color: 'rgb(255, 255, 255)', inline: [] }, 'authored skin plate is kept')
    }
    await page.close()
  }
  assert.deepEqual(errors, [])
})

// private fork (owner 2026-10): backlog names return to the pre-v3.1 CSS tint; no contrast hook, no inline block.
test('backlog names: no figure-colour block; CSS row tint only; the contrast helper serves SKIP alone', { timeout: 60000 }, async t => {
  const backlog = await read('tavern-plugin/src/client/fork-gal-backlog.js')
  assert.doesNotMatch(backlog, /useForkFigureTextContrast|data-figure-text-color/)
  const contrast = await read('tavern-plugin/src/client/fork-figure-color-contrast.js')
  assert.doesNotMatch(contrast, /data-figure-text-color|figure-skin-text-color|backgroundColor=/)
  const css = await read('tavern-plugin/lib/client-assets/fork-theme.css'), skinTokens = await read('tavern-plugin/src/client/fork-stage-skin.cjs')
  assert.doesNotMatch(css + skinTokens, /figure-skin-text-color|gal-skin-panel-name-fg/)
  const browser = await chromium.launch({ headless: true })
  t.after(() => browser.close())
  const errors = []
  for (const viewport of [{ width: 1600, height: 900 }, { width: 375, height: 812 }]) {
    const page = await browser.newPage({ viewport, colorScheme: 'dark' })
    page.on('pageerror', error => errors.push(String(error)))
    await page.setContent('<!doctype html><meta charset="utf-8"><body data-ds-dark-theme><div id="root" class="fork-gal-stage" data-theme="classic" style="position:fixed;inset:0;--fk-s-stage-panel-bgSolid:#1d1a28;--fk-s-stage-panel-fg:#ece8f4;--fk-s-stage-panel-accent:#b9a2ff"></div></body>')
    await page.addStyleTag({ content: css })
    await page.addScriptTag({ content: await browserReactScript() + `
      const React=modules.react, ReactDOM=modules['react-dom/client'];
      const forkVoicePlayer={subscribe:()=>()=>{},get:()=>null};
      function useLiveTavernView(){return null}
      function ForkHelpTip(){return null}
      function ForkIcon(){return null}
      function ForkPackImage(){return null}
      function forkGalQuoted(t){return t}
      ` + await read('tavern-plugin/packages/dsh-presentation-protocol/src/figure-resolution.cjs')
        + await read('tavern-plugin/src/client/fork-bubble-line.cjs') + backlog })
    await page.evaluate(() => {
      // private fork: render the name-band contract through the production canonical resolver.
      const cast = { f_hitomi: ['志筑仁美', '#5f9a6e'], f_madoka: ['鹿目圆', '#ef9bac'] }
      const config = { characters: Object.entries(cast).map(([alias, [name]]) => ({ alias, name, aliases: [alias.slice(2)], ref: { packId: 'pack', figureId: alias.slice(2) } })) }
      const pages = [{ kind: 'line', alias: 'hitomi', text: '「早上好。」', para: 1 }, { kind: 'line', alias: 'madoka', text: '「早上好！」', para: 2, thought: true }]
      ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(ForkGalBacklog, { sessionId: 'offline', config, turn: 1, pages, page: 1,
        textIndex: new Map([[1, { units: pages }]]), colorOf: a => cast[a][1], nameOf: a => cast[a][0], avatarOf: () => '', onClose() {}, onJump() {} }))
    })
    await page.waitForTimeout(300)
    const rows = await page.evaluate(() => [...document.querySelectorAll('.fork-gal-backlog-name b')].map(n => {
      const s = getComputedStyle(n), ref = document.createElement('b'), row = n.closest('.fork-gal-backlog-row')
      ref.style.color = 'color-mix(in srgb, ' + row.style.getPropertyValue('--row-color') + ' 48%, #ece8f4)'; document.body.append(ref)
      const tint = getComputedStyle(ref).color; ref.remove()
      return { bg: s.backgroundColor, color: s.color, tint, inline: n.getAttribute('style') }
    }))
    assert.equal(rows.length, 2)
    for (const row of rows) assert.deepEqual({ bg: row.bg, inline: row.inline, color: row.color }, { bg: 'rgba(0, 0, 0, 0)', inline: null, color: row.tint })
    await page.close()
  }
  assert.deepEqual(errors, [])
})
