// private fork (owner 2026-10): the witch-barrier textbox reveal is cut-out animation on twos (fork-stage-skin.cjs
// STAGE_SKIN_TEXT_FPS, ForkGalTypewriter hop clock in fork-gal-stage.js, fork-theme.css data-hop poses). Real React
// and the real stage CSS in headless Chromium on a virtual presentation clock: every display frame is advanced by
// hand, so step timing is exact and the painted pixels can be compared frame by frame. Offline only.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { chromium } from 'playwright'
import { browserReactScript } from './fixtures/browser-react.mjs'
import { forkThemeCss } from './helpers/fork-theme-css.mjs'

const require = createRequire(import.meta.url)
const { STAGE_SKIN_TEXT_FPS, stageSkinReveal, stageSkinRevealCount } = require('../tavern-plugin/src/client/fork-stage-skin.cjs')
const read = name => readFile(new URL('../' + name, import.meta.url), 'utf8')
const between = (text, a, b) => { const i = text.indexOf(a), j = text.indexOf(b, i); assert.ok(i >= 0 && j > i, a); return text.slice(i, j) }
const NARRATION = '糖果色的结界在脚下一格一格地铺开，奶油墙壁上贴满了剪下来的蛋糕与药瓶。远处传来细碎的咀嚼声。'
const LINE = '「……喂，你们看到了吗？那边的奶酪，刚才是不是自己动了一下？我们最好别靠近。」'

test('skin text hops: one 12/s clock on twos that keeps the reading speed as its budget', () => {
  const charlotte = { textFx: { reveal: 'pop', stepFps: 8, charsPerStep: 2 }, photosensitive: false }
  assert.equal(STAGE_SKIN_TEXT_FPS, 12)
  for (const stepFps of [6, 8, 12, 14]) {
    const reveal = stageSkinReveal({ ...charlotte, textFx: { ...charlotte.textFx, stepFps } }, 28)
    assert.equal(reveal.stepMs, 1000 / 12, 'authored stepFps ' + stepFps + ' renders on twos')
  }
  for (const speed of [14, 28, 45, 80]) {
    const reveal = stageSkinReveal(charlotte, speed)
    let shown = 0, steps = 0
    while (shown < 120) { shown += stageSkinRevealCount(reveal, shown, ++steps); assert.ok(steps < 2000) }
    const ms = steps * reveal.stepMs, budget = 120 * speed
    assert.ok(ms >= budget - reveal.stepMs && ms <= budget + 2 * reveal.stepMs, 'speed ' + speed + ': ' + ms + 'ms for a ' + budget + 'ms page')
  }
  // Slow readers get held steps in authored pairs, not a slower clock.
  const slow = stageSkinReveal(charlotte, 80), counts = Array.from({ length: 12 }, (_, i) => i + 1).reduce((out, step) => { out.push(stageSkinRevealCount(slow, out.reduce((a, b) => a + b, 0), step)); return out }, [])
  assert.ok(counts.every(n => n === 0 || n >= 2) && counts.includes(0), JSON.stringify(counts))
  // The in-app reduced-motion choice and photosensitive skins fall back to plain typing.
  assert.equal(stageSkinReveal(charlotte, 28, { reducedMotion: true }).kind, 'type')
  assert.equal(stageSkinReveal({ ...charlotte, photosensitive: true }, 28).kind, 'type')
})

async function hopPage(t) {
  const browser = await chromium.launch({ headless: true })
  t.after(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 1100, height: 560 } })
  const errors = []
  page.on('pageerror', error => errors.push(String(error)))
  const stage = await read('tavern-plugin/src/client/fork-gal-stage.js')
  const skin = JSON.parse(await read('tests/fixtures/stage-skins/charlotte.json'))
  await page.setContent('<!doctype html><meta charset="utf-8"><body style="margin:0;background:#1a1020"><div class="fork-gal-mount"><div id="root"></div></div></body>')
  await page.addStyleTag({ content: await forkThemeCss() })
  // The magical theme floats the whole box; hold it still so only the text changes between screenshots.
  await page.addStyleTag({ content: '.fork-gal-box { animation: none !important; }' })
  await page.addScriptTag({ content: await browserReactScript() + ';const React=modules.react,ReactDOM=modules["react-dom/client"];\n' +
    // The stage's presentation clock (forkForeground), virtual: frames and timers run only when the test advances it.
    'let vnow=0,serial=0,timers=[],frames=[];\n' +
    'const forkForeground={now:()=>vnow,isForeground:()=>true,setTimeout:(fn,ms)=>{const id=++serial;timers.push({id,fn,due:vnow+Math.max(0,+ms||0)});return id},clearTimeout:id=>{timers=timers.filter(x=>x.id!==id)},' +
    'requestAnimationFrame:fn=>{const id=++serial;frames.push({id,fn});return id},cancelAnimationFrame:id=>{frames=frames.filter(x=>x.id!==id)}};\n' +
    'const FORK_STAGE_READING_DEFAULTS={textSpeed:28};const forkFonts={resolve:()=>({family:"sans-serif"})};\n' +
    await read('tavern-plugin/packages/dsh-presentation-protocol/src/stage-skin.cjs') + '\n' +
    await read('tavern-plugin/src/client/fork-stage-skin.cjs') + '\n' +
    between(stage, 'function ForkGalTypewriter(props)', '// Dialogue box dressing') +
    '\nfunction forkGalFrameNow(){return vnow}\n' +
    // One display frame: due timers, frame callbacks, React commit, then CSS animations pinned to their virtual age.
    'const births=new WeakMap();window.frame=async(ms)=>{vnow+=ms;for(let g=0;g<200;g++){const due=timers.filter(x=>x.due<=vnow+1e-6).sort((a,b)=>a.due-b.due)[0];if(!due)break;timers=timers.filter(x=>x!==due);due.fn()}' +
    'const run=frames;frames=[];run.forEach(x=>x.fn(vnow));await new Promise(r=>setTimeout(r,0));await new Promise(r=>setTimeout(r,0));' +
    'for(const a of document.getAnimations()){if(!births.has(a)){births.set(a,vnow);a.pause()}a.currentTime=vnow-births.get(a)}};\n' })
  await page.evaluate(skin => {
    const h = React.createElement, tokens = stageSkinTokens(skin, forkFonts, 'classic')
    function Box({ s }) {
      return h('div', { className: 'fork-gal-stage', 'data-theme': s.theme, 'data-fk-context': 'stage-' + s.theme, 'data-fk-skin': s.skin ? 'charlotte' : undefined, style: { position: 'fixed', inset: 0, ...(s.skin ? tokens : {}) } },
        h('div', { className: 'fork-gal-box' + (s.kind === 'narration' ? ' is-narration' : ''), style: { '--bubble-color': '#c2185b' } },
          s.kind === 'line' ? h('div', { className: 'fork-gal-name' }, '沙耶香') : null,
          h('div', { className: 'fork-gal-text' },
            h(ForkGalTypewriter, { key: s.key, text: s.text, speed: 28, skin: s.skin ? skin : null, instant: s.typed, hold: s.hold, reducedMotion: s.reducedMotion, onDone: () => { window.doneAt = vnow; window.setS(o => ({ ...o, typed: true })) } }),
            h('span', { className: 'fork-gal-next' + (s.typed ? '' : ' is-waiting') }))))
    }
    function App() { const [s, setS] = React.useState(window.initial); window.setS = setS; return h(Box, { s }) }
    const root = ReactDOM.createRoot(document.getElementById('root'))
    window.mount = async initial => { window.initial = initial; window.doneAt = null; root.render(h(App, { key: Math.random() })); await new Promise(r => setTimeout(r, 0)); await new Promise(r => setTimeout(r, 0)) }
    window.state = () => {
      const type = document.querySelector('.fork-gal-type'), paints = [...type.querySelectorAll('.fork-skin-glyph-paint')]
      return { visible: (type.querySelector('.fork-gal-type-shown')?.textContent.length || 0) + type.querySelectorAll('.fork-gal-glyph').length,
        hops: paints.map(p => p.dataset.hop).join(''), transforms: paints.map(p => getComputedStyle(p, '::after').transform), indents: paints.map(p => getComputedStyle(p, '::after').textIndent),
        reveal: type.dataset.skinReveal || null }
    }
    // Painted ink: pixels of the text column that differ from the empty page (the hidden rest is transparent).
    window.ink = async (b64, base64) => {
      const decode = async src => { const img = new Image(); img.src = 'data:image/png;base64,' + src; await img.decode(); const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const x = c.getContext('2d'); x.drawImage(img, 0, 0); return x.getImageData(0, 0, c.width, c.height).data }
      const a = await decode(b64), b = await decode(base64)
      let n = 0
      for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 60) n++
      return n
    }
  }, skin)
  await page.evaluate(() => document.fonts.ready)
  const shot = async () => { const box = await page.locator('.fork-gal-text').boundingBox(); return (await page.screenshot({ clip: { x: Math.floor(box.x), y: Math.floor(box.y), width: Math.ceil(box.width), height: Math.ceil(box.height) } })).toString('base64') }
  return { page, errors, shot }
}

test('narration and dialogue both reveal progressively, under the skin and in every base theme; skip stays instant', { timeout: 120000 }, async t => {
  const { page, errors, shot } = await hopPage(t)
  // private fork: + crt (显像管), whose own glyph reveal must stay progressive.
  for (const theme of ['classic', 'gothic', 'magical', 'crt', 'aero']) for (const skin of [true, false]) for (const kind of ['narration', 'line']) {
    const label = theme + (skin ? ' + charlotte ' : ' ') + kind
    await page.evaluate(s => window.mount(s), { key: label, theme, kind, skin, text: kind === 'line' ? LINE : NARRATION, typed: false })
    const empty = await shot(), samples = []
    for (let f = 1; f <= 150 && !(await page.evaluate(() => window.doneAt !== null)); f++) {
      await page.evaluate(() => window.frame(1000 / 60))
      if (f % 12 === 0) samples.push({ ...(await page.evaluate(() => window.state())), ink: await page.evaluate(([a, b]) => window.ink(a, b), [await shot(), empty]) })
    }
    for (let f = 0; f < 30; f++) await page.evaluate(() => window.frame(1000 / 60))
    const final = await page.evaluate(([a, b]) => window.ink(a, b), [await shot(), empty])
    const mid = samples.filter(s => s.visible > 0 && s.visible < [...(kind === 'line' ? LINE : NARRATION)].length)
    assert.ok(mid.length >= 3, label + ': sampled mid-page ' + JSON.stringify(samples.map(s => s.visible)))
    assert.ok(mid.every(s => s.ink > 40), label + ': revealed glyphs paint while the page types ' + JSON.stringify(mid.map(s => s.ink)) + ' of ' + final)
    for (let i = 1; i < mid.length; i++) assert.ok(mid[i].ink > mid[i - 1].ink, label + ': painted text grows step by step ' + JSON.stringify(mid.map(s => s.ink)))
    assert.ok(mid[0].ink < final * 0.6, label + ': the line does not appear at once ' + mid[0].ink + ' of ' + final)
    if (skin) {
      assert.ok(mid.every(s => s.reveal === 'pop'), label + ': stepped skin reveal')
      assert.ok(mid.every(s => s.indents.every(v => v === '0px')), label + ': paint copies ignore the hanging indent')
    }
    // Skip / a click on the page: everything at once, no stepped paint.
    await page.evaluate(() => window.setS(o => ({ ...o, typed: true })))
    await page.evaluate(() => window.frame(1000 / 60))
    const skipped = await page.evaluate(() => window.state())
    assert.equal(skipped.reveal, null, label + ': skip is plain text'); assert.equal(skipped.hops, '')
  }
  assert.deepEqual(errors, [])
})

test('skin text hops step evenly on twos at 60, 120 and 144 Hz; poses are held whole steps; calm keeps the steps', { timeout: 60000 }, async t => {
  const { page, errors } = await hopPage(t)
  for (const hz of [60, 120, 144]) {
    await page.evaluate(s => window.mount(s), { key: 'hz' + hz, theme: 'classic', kind: 'line', skin: true, text: LINE, typed: false })
    const log = []
    for (let f = 0; f < hz * 4 && !(await page.evaluate(() => window.doneAt !== null)); f++) { await page.evaluate(ms => window.frame(ms), 1000 / hz); log.push({ f, ...(await page.evaluate(() => window.state())) }) }
    const changes = log.filter((s, i) => i > 0 && (s.visible !== log[i - 1].visible || s.hops !== log[i - 1].hops)).map(s => s.f)
    const gaps = changes.slice(1).map((f, i) => f - changes[i])
    assert.ok(gaps.length >= 8, hz + ' Hz: steps sampled ' + gaps.length)
    assert.deepEqual([...new Set(gaps)], [hz / 12], hz + ' Hz: every pose is held ' + hz / 12 + ' frames ' + JSON.stringify(gaps))
    const span = (changes.at(-1) - changes[0]) / hz
    assert.equal(Math.round((changes.length - 1) / span), 12, hz + ' Hz: 12 steps per second')
    // Entry pose (flash, lifted), landing pose, then rest in the plain shown run.
    assert.ok(log.some(s => s.hops.includes('0') && s.hops.includes('1')), 'entry and landing poses alternate')
    assert.ok(log.filter(s => s.hops).every(s => /^1*0*$/.test(s.hops)), 'older glyphs land first')
  }
  // A long task (a dropped run of frames) skips poses instead of slowing the reading speed.
  await page.evaluate(s => window.mount(s), { key: 'long', theme: 'classic', kind: 'narration', skin: true, text: NARRATION, typed: false })
  for (let f = 0; f < 10; f++) await page.evaluate(() => window.frame(1000 / 60))
  const before = (await page.evaluate(() => window.state())).visible
  await page.evaluate(() => window.frame(250))
  const after = (await page.evaluate(() => window.state())).visible
  assert.ok(after - before >= 7, 'caught up after a 250 ms stall: ' + before + ' -> ' + after)
  // The face handoff hold keeps the laid-out page unrevealed; the first hop lands on the frame after release.
  await page.evaluate(s => window.mount(s), { key: 'hold', theme: 'classic', kind: 'line', skin: true, text: LINE, typed: false, hold: true })
  for (let f = 0; f < 20; f++) await page.evaluate(() => window.frame(1000 / 60))
  assert.equal((await page.evaluate(() => window.state())).visible, 0, 'held')
  await page.evaluate(() => window.setS(o => ({ ...o, hold: false })))
  await page.evaluate(() => window.frame(1000 / 60))
  assert.ok((await page.evaluate(() => window.state())).visible > 0, 'released')
  // OS reduced motion (calm): still stepped, no per-glyph pose transform.
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.evaluate(s => window.mount(s), { key: 'calm', theme: 'classic', kind: 'line', skin: true, text: LINE, typed: false })
  for (let f = 0; f < 8; f++) await page.evaluate(() => window.frame(1000 / 60))
  const calm = await page.evaluate(() => window.state())
  assert.equal(calm.reveal, 'pop'); assert.ok(calm.transforms.length > 0 && calm.transforms.every(v => v === 'none'), JSON.stringify(calm.transforms))
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  for (let f = 0; f < 3; f++) await page.evaluate(() => window.frame(1000 / 60))
  assert.ok((await page.evaluate(() => window.state())).transforms.some(v => v !== 'none'), 'poses return without reduced motion')
  // The in-app CONFIG reduced-motion choice is plain typing.
  await page.evaluate(s => window.mount(s), { key: 'config', theme: 'classic', kind: 'line', skin: true, text: LINE, typed: false, reducedMotion: true })
  await page.evaluate(() => window.frame(1000 / 60))
  assert.equal((await page.evaluate(() => window.state())).reveal, null)
  assert.deepEqual(errors, [])
})
