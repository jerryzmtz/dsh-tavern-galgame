// private fork: the stage textbox never moves shown text while reading (fork-gal-stage.js ForkGalTypewriter and
// useForkGalFaceColumn, fork-theme.css "stage typewriter"). Real React + the real stage CSS and components in
// headless Chromium; every glyph's line position (Range.getClientRects) is compared across the whole typing
// timeline, portrait-load timings, voice state changes, the next-page cue and streaming growth. Offline only.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { browserReactScript } from './fixtures/browser-react.mjs'

const read = name => readFile(new URL('../' + name, import.meta.url), 'utf8')
const between = (text, a, b) => { const i = text.indexOf(a), j = text.indexOf(b, i); assert.ok(i >= 0 && j > i, a); return text.slice(i, j) }
const graphemes = text => Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text), part => part.segment)

const TEXT = '「我一直在想，那天放学后的天台上，你到底想对我说什么……明明风那么大，你却一句话也没有说完。下次见面的时候，能不能把那句话告诉我？」'
const LONG = '「其实我早就知道了。从你第一次在走廊里回头看我的时候，我就知道这件事迟早会发生——可是，我还是想再等一等，等到樱花开的那一天。」'
const LATIN = '「Tomorrow, after the festival, I will finally tell her everything — I promise.」那天他这样说。'
const NARRATION = '窗外的雨渐渐停了。走廊尽头传来脚步声，由远及近，在门前停了下来；谁也没有开口，只有挂钟的指针还在一格一格地向前走着。'

async function stagePage(t, viewport = { width: 1100, height: 700 }) {
  const browser = await chromium.launch({ headless: true })
  t.after(() => browser.close())
  const page = await browser.newPage({ viewport })
  const errors = []
  page.on('pageerror', error => errors.push(String(error)))
  const stage = await read('tavern-plugin/src/client/fork-gal-stage.js')
  await page.setContent('<!doctype html><meta charset="utf-8"><div class="fork-gal-mount"><div id="root"></div></div>')
  await page.addStyleTag({ content: await read('tavern-plugin/lib/client-assets/fork-theme.css') })
  await page.addScriptTag({ content: await browserReactScript() + ';const React=modules.react,ReactDOM=modules["react-dom/client"];\n' +
    // private fork: the skin hop clock reads forkForeground.now and its frame callbacks.
    'const forkForeground={now:()=>performance.now(),setTimeout:(fn,ms)=>setTimeout(fn,ms),clearTimeout:id=>clearTimeout(id),requestAnimationFrame:fn=>requestAnimationFrame(()=>fn(performance.now())),cancelAnimationFrame:id=>cancelAnimationFrame(id)};const FORK_STAGE_READING_DEFAULTS={textSpeed:28};\n' +
    'function ForkIcon(props){return React.createElement("i",{className:"fork-icon",style:{display:"inline-block",width:props.size,height:props.size}})}\n' +
    await read('tavern-plugin/src/client/fork-stage-resources.cjs') + '\n' + await read('tavern-plugin/src/client/fork-pack-playback.cjs') + '\n' +
    await read('tavern-plugin/src/client/fork-stage-skin.cjs') + '\n' +
    between(stage, 'function ForkGalTypewriter(props)', '// Dialogue box dressing') + '\n' +
    between(stage, 'function ForkGalSide(props)', '// Title card (director') + '\n' +
    between(stage, 'function useForkGalFaceColumn(', '// private fork: localized, theme-matching runtime notices') + '\n' +
    between(stage, 'function ForkGalNamePlate(props)', '// Mounted in the session shell') })
  await page.evaluate(() => {
    const h = React.createElement
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64
    const context = canvas.getContext('2d'); context.fillStyle = '#d8a'; context.fillRect(8, 8, 48, 56)
    window.FACE = { key: 'a', identity: 'a:calm', src: canvas.toDataURL('image/png'), crop: { x: 0, y: 0, w: 1, h: 1 } }
    // The stage's textbox markup (ForkGalStage), with the real face latch, side window, name plate and typewriter.
    function Box({ s }) {
      const portraits = new Map(Object.entries(s.portraits).map(([alias, face]) => [alias, face ? window.FACE : null]))
      const speaker = s.kind === 'line' ? 'a' : ''
      const portraitFace = speaker ? portraits.get(speaker) || null : null
      const facing = useForkGalFaceColumn('s', s.pageKey, speaker, portraits, [{ alias: 'a' }], true)
      const face = facing || s.theme !== 'classic' ? portraitFace : null
      return h('div', { className: 'fork-gal-stage', 'data-theme': s.theme, style:{'--gal-skin-fg':'#ffffff','--gal-skin-flash':'#cccccc','--gal-skin-stamp-y':'-16px'} },
        h('div', { className: 'fork-gal-box has-face' + (s.kind === 'narration' ? ' is-narration' : '') + (facing ? ' is-facing' : ''), style: { '--bubble-color': '#c86a9a' } },
          h(ForkGalSide, { face, emote: null }),
          s.kind === 'line' ? h(ForkGalNamePlate, { name: '晓美焰', mood: '平静', classic: s.theme === 'classic', film: false, voiceState: s.voice, onReplay() {} }) : null,
          h('div', { className: 'fork-gal-text' },
            h(ForkGalTypewriter, { key: s.pageKey, text: s.text, speed: s.speed, skin:s.skin, instant: s.typed, pending: s.pending, onDone: () => window.setState(old => ({ ...old, typed: true })) }),
            s.pending ? h('span', { className: 'fork-gal-typing' }, h('i'), h('i'), h('i')) : null,
            !s.pending ? h('span', { className: 'fork-gal-next' + (s.typed ? '' : ' is-waiting') }) : null)))
    }
    function Harness() {
      const [s, setState] = React.useState(window.initial)
      window.setState = setState
      return h(Box, { s })
    }
    const root = ReactDOM.createRoot(document.getElementById('root'))
    window.mount = initial => new Promise(resolve => {
      window.initial = initial; root.render(null)
      requestAnimationFrame(() => { root.render(h(Harness, { key: Math.random() })); requestAnimationFrame(() => requestAnimationFrame(resolve)) })
    })
    window.patch = value => modules['react-dom'].flushSync(() => window.setState(old => ({ ...old, ...value })))
    // Every glyph of the laid-out page (shown or not): its line box position, and how many are visible.
    window.glyphs = () => {
      // Relative to the box: the magical theme floats the whole box (a transform), which is not a text move.
      const type = document.querySelector('.fork-gal-type'), out = [], origin = document.querySelector('.fork-gal-box').getBoundingClientRect()
      const walker = document.createTreeWalker(type, NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const hidden = Boolean(node.parentElement.closest('.fork-gal-type-rest'))
        for (const { index, segment } of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(node.data)) {
          const range = document.createRange(); range.setStart(node, index); range.setEnd(node, index + segment.length)
          const rect = [...range.getClientRects()].find(item => item.width > 0) || range.getBoundingClientRect()
          out.push({ g: segment, x: Math.round((rect.left - origin.left) * 4) / 4, y: Math.round((rect.top - origin.top) * 4) / 4, w: rect.width, hidden })
        }
      }
      const text = document.querySelector('.fork-gal-text'), box = document.querySelector('.fork-gal-box')
      return { glyphs: out, visible: out.filter(item => !item.hidden).length, textLeft: Math.round(text.getBoundingClientRect().left - origin.left), scroll: text.scrollHeight, boxHeight: Math.round(box.getBoundingClientRect().height) }
    }
    // Sample every frame until the page reports typed; scripted events (portrait arrival, voice state) run on time.
    // The rise animation offsets a fading glyph by `top`, so the layout position is read with animations paused at
    // their end state (getClientRects includes relative offsets).
    window.timeline = (events = []) => new Promise(resolve => {
      const frames = [], start = performance.now(), queue = events.slice()
      function frame() {
        const now = performance.now() - start
        while (queue.length && queue[0].at <= now) { const event = queue.shift(); window.patch(event.patch) }
        frames.push({ t: Math.round(now), ...window.settledGlyphs(), typed: Boolean(document.querySelector('.fork-gal-next:not(.is-waiting)')) })
        if ((frames.at(-1).typed && !queue.length) || frames.length > 900) { requestAnimationFrame(() => { frames.push({ t: -1, ...window.glyphs(), typed: true }); resolve(frames) }); return }
        requestAnimationFrame(frame)
      }
      frame()
    })
    window.settledGlyphs = () => {
      const glyphs = [...document.querySelectorAll('.fork-gal-glyph')], saved = glyphs.map(node => node.style.animation)
      glyphs.forEach(node => { node.style.animation = 'none' })
      const out = window.glyphs()
      glyphs.forEach((node, i) => { node.style.animation = saved[i] })
      return out
    }
  })
  await page.evaluate(() => document.fonts.ready)
  return { page, errors }
}
// Line and inline position; sub-pixel noise below half a pixel is not a visible move (a line is ~30px).
const lines = snapshot => snapshot.glyphs.map(item => item.y + ':' + Math.round(item.x / 2) * 2)
const same = (a, b, label) => {
  assert.equal(a.glyphs.length, b.glyphs.length, label)
  // A ligature split across the reveal boundary (——) measures as one wide and one empty glyph; it paints the same.
  a.glyphs.forEach((glyph, i) => assert.ok(!glyph.w || !b.glyphs[i].w || Math.abs(glyph.y - b.glyphs[i].y) <= .5 && Math.abs(glyph.x - b.glyphs[i].x) <= .5, label + ': glyph ' + i + ' ' + glyph.g + ' at ' + glyph.y + ':' + glyph.x + ', expected ' + b.glyphs[i].y + ':' + b.glyphs[i].x))
}
const breaks = snapshot => snapshot.glyphs.map((item, i, all) => i > 0 && item.y !== all[i - 1].y ? i : -1).filter(i => i >= 0)
const base = (theme, extra = {}) => ({ theme, kind: 'line', pageKey: 'p1', text: TEXT, speed: 14, typed: false, pending: false, voice: '', portraits: {}, ...extra })

test('skin reveals retain pre-laid-out glyphs on phone widths and reduced motion drops stepped paint', {timeout:60000}, async t => {
  const {page,errors}=await stagePage(t,{width:390,height:844})
  await page.evaluate(s=>window.mount(s),base('classic',{typed:true}))
  const reference=await page.evaluate(()=>window.glyphs())
  for(const reveal of ['ink','pop','stutter','stamp','cut','scan','scrawl']) {
    const skin={textFx:{reveal,stepFps:8,charsPerStep:2}}
    await page.evaluate(s=>window.mount(s),base('classic',{skin}))
    const frames=await page.evaluate(()=>window.timeline())
    assert.ok(frames.some(frame=>frame.visible>0&&frame.visible<frame.glyphs.length),reveal+' sampled during reveal')
    for(const frame of frames) {same(frame,reference,reveal+' '+frame.t);assert.equal(frame.scroll,reference.scroll)}
    assert.ok(frames.filter(frame=>frame.t>=0).at(-1).t < TEXT.length*14*1.2+500,reveal+' bounded reading time')
  }
  // private fork (owner 2026-10): the OS preference softens authored skin text (per-glyph paint motion is dropped by
  // CSS) but keeps the stepped reveal; only the explicit in-app reduced-motion choice falls back to plain typing.
  await page.emulateMedia({reducedMotion:'reduce'})
  await page.evaluate(s=>window.mount(s),base('classic',{skin:{textFx:{reveal:'pop'}}}))
  assert.equal(await page.locator('.fork-gal-type').getAttribute('data-skin-reveal'),'pop')
  assert.deepEqual(errors,[])
})

test('textbox: a page keeps every glyph in place across portrait-load timings, voice state, typing and the next-page cue, in every theme', { timeout: 180000 }, async t => {
  const { page, errors } = await stagePage(t)
  for (const theme of ['classic', 'gothic', 'magical', 'crt', 'aero']) { // private fork: + crt (显像管), aero (千禧晴空)
    // Reference: the portrait was already accepted (cached) and the page shown at once.
    await page.evaluate(s => window.mount(s), base(theme, { typed: true, portraits: { a: true } }))
    const reference = await page.evaluate(() => window.glyphs())
    assert.equal(reference.glyphs.length, graphemes(TEXT).length)
    assert.ok(breaks(reference).length >= 1, theme + ': the fixture wraps')
    for (const arrival of [null, 0, 120, 400, 900]) {
      // Cold: nothing accepted yet; the portrait arrives at `arrival` ms (null = never), the voice starts mid-page.
      await page.evaluate(s => window.mount(s), base(theme))
      const events = [{ at: 60, patch: { voice: 'loading' } }, { at: 300, patch: { voice: 'playing' } }]
      if (arrival !== null) events.push({ at: arrival, patch: { portraits: { a: true } } })
      events.sort((a, b) => a.at - b.at)
      const frames = await page.evaluate(events => window.timeline(events), events)
      const label = theme + ' portrait at ' + arrival
      assert.ok(frames.some(frame => frame.visible > 0 && frame.visible < frame.glyphs.length), label + ': typing was sampled mid-page')
      for (const frame of frames) {
        same(frame, reference, label + ' t=' + frame.t + ' (' + frame.visible + ' shown)')
        assert.equal(frame.textLeft, reference.textLeft, label + ': text column')
        assert.equal(frame.boxHeight, reference.boxHeight, label + ': box height')
        assert.equal(frame.scroll, reference.scroll, label + ': text height (the next-page cue takes no line)')
      }
      for (let i = 1; i < frames.length; i++) assert.ok(frames[i].visible >= frames[i - 1].visible, label + ': shown glyphs only grow')
    }
    // The face became unavailable mid-page: the gutter stays until the page ends.
    await page.evaluate(s => window.mount(s), base(theme, { portraits: { a: true } }))
    const gone = await page.evaluate(() => window.timeline([{ at: 100, patch: { portraits: { a: false } } }]))
    for (const frame of gone) same(frame, reference, theme + ' face lost t=' + frame.t)
    if (theme === 'classic') {
      // The next page decides afresh: no face, full width (today's look for faceless lines).
      await page.evaluate(() => window.patch({ pageKey: 'p2', typed: true }))
      const next = await page.evaluate(() => window.glyphs())
      assert.ok(next.textLeft < reference.textLeft, 'a faceless page uses the full width')
      // Sanity: the measurement sees the original bug (the gutter toggled under a shown page re-wraps it).
      await page.evaluate(s => window.mount(s), base(theme, { typed: true, portraits: { a: true } }))
      await page.evaluate(() => document.querySelector('.fork-gal-box').classList.remove('is-facing'))
      assert.notDeepEqual(breaks(await page.evaluate(() => window.glyphs())), breaks(reference), 'toggling the gutter does re-wrap (the test is sensitive)')
    }
  }
  assert.deepEqual(errors, [])
})

test('textbox: classic narration stays full width; page back/forward re-decides the gutter at page start', { timeout: 60000 }, async t => {
  const { page, errors } = await stagePage(t)
  await page.evaluate(s => window.mount(s), base('classic', { kind: 'narration', text: NARRATION, typed: true, portraits: { a: true } }))
  const narration = await page.evaluate(() => window.glyphs())
  assert.equal(await page.evaluate(() => document.querySelector('.fork-gal-box').classList.contains('is-facing')), false)
  await page.evaluate(s => window.mount(s), base('classic', { kind: 'narration', text: NARRATION }))
  const cold = await page.evaluate(() => window.timeline([{ at: 80, patch: { portraits: { a: true } } }]))
  for (const frame of cold) same(frame, narration, 'narration t=' + frame.t)
  // Line page (cold, gutter reserved) → narration → back to the line: each page keeps one column throughout.
  await page.evaluate(s => window.mount(s), base('classic', { typed: true }))
  const line = await page.evaluate(() => window.glyphs())
  await page.evaluate(text => window.patch({ pageKey: 'p2', kind: 'narration', text, portraits: { a: true } }), NARRATION)
  same(await page.evaluate(() => window.glyphs()), narration, 'narration again')
  await page.evaluate(text => window.patch({ pageKey: 'p1', kind: 'line', text }), TEXT)
  same(await page.evaluate(() => window.glyphs()), line, 'line again')
  assert.deepEqual(errors, [])
})

test('textbox: streaming text never moves a shown glyph (kinsoku, closing quotes, Latin words) and the dots take no line', { timeout: 120000 }, async t => {
  const { page, errors } = await stagePage(t, { width: 900, height: 640 })
  for (const theme of ['classic', 'gothic', 'magical', 'crt', 'aero']) { // private fork: + crt (显像管), aero (千禧晴空)
    for (const full of [LONG, LATIN]) {
      const all = graphemes(full)
      await page.evaluate(s => window.mount(s), base(theme, { text: all.slice(0, 3).join(''), pending: true, speed: 4, portraits: { a: true } }))
      const seen = new Map()
      for (let n = 4; n <= all.length + 1; n++) {
        const done = n > all.length
        await page.evaluate(([text, done]) => window.patch(done ? { text, pending: false } : { text }), [all.slice(0, Math.min(n, all.length)).join(''), done])
        await page.waitForTimeout(done ? 500 : 25)
        const snapshot = await page.evaluate(() => window.settledGlyphs())
        snapshot.glyphs.forEach((glyph, i) => {
          if (glyph.hidden || !glyph.w) return
          const key = i + ':' + glyph.g, first = seen.get(key)
          if (!first) seen.set(key, glyph)
          else if (!first.w) return
          else assert.ok(Math.abs(glyph.y - first.y) <= .5 && Math.abs(glyph.x - first.x) <= .5, theme + ': shown glyph ' + key + ' moved from ' + first.y + ':' + first.x + ' to ' + glyph.y + ':' + glyph.x + ' at ' + n + ' / ' + all.length)
        })
      }
      assert.equal(seen.size, all.length, theme + ': the whole line was shown')
    }
  }
  assert.deepEqual(errors, [])
})

test('typewriter rhythm: pauses after sentence ends and commas, none inside punctuation runs; streaming holds its unstable tail', async t => {
  const { page } = await stagePage(t)
  const result = await page.evaluate(() => {
    const g = text => forkGalGlyphs(text)
    const pauses = text => g(text).map((_, i, all) => forkGalGlyphPause(all, i))
    return {
      cjk: pauses('好。」他说，嗯……走吧'), latin: pauses('Hi. A, b'), emoji: g('a👩‍👩‍👧b').length,
      hold: [forkGalRevealLimit(g('你好世界'), true), forkGalRevealLimit(g('你好世界'), false), forkGalRevealLimit(g('I will tell'), true), forkGalRevealLimit(g('I will tell '), true)]
    }
  })
  // 好 。 」 他 说 ， 嗯 … … 走 吧: the sentence pause falls after the closing quote, the ellipsis pauses once at its end.
  assert.deepEqual(result.cjk, [0, 0, 5, 0, 0, 2, 0, 0, 5, 0, 0])
  assert.deepEqual(result.latin, [0, 0, 5, 0, 0, 2, 0, 0])
  assert.equal(result.emoji, 3)
  // Streaming: two glyphs held back, and never part of a Latin word still being written.
  assert.deepEqual(result.hold, [2, 4, 7, 7])
})
