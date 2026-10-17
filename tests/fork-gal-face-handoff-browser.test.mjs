// private fork: the face → no-face page handoff (docs/fork/textbox-face-transition.md; fork-gal-stage.js
// useForkGalFaceHandoff / ForkGalSide / ForkGalTypewriter `hold`, fork-theme.css fork-gal-side-clear) and the face
// window as a pure cut-out. Real React, the real stage CSS and components in headless Chromium; every frame of a
// character → narration → character sequence is sampled. Offline only.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { browserReactScript } from './fixtures/browser-react.mjs'

const read = name => readFile(new URL('../' + name, import.meta.url), 'utf8')
const between = (text, a, b) => { const i = text.indexOf(a), j = text.indexOf(b, i); assert.ok(i >= 0 && j > i, a); return text.slice(i, j) }

const LINE = '「我一直在想，那天放学后的天台上，你到底想对我说什么……明明风那么大，你却一句话也没有说完。」'
const NARRATION = '窗外的雨渐渐停了。走廊尽头传来脚步声，由远及近，在门前停了下来；谁也没有开口。'
const SPEED = 20
// A pale Charlotte-like paper (the owner's report): a grey haze shows best here.
const SKIN = { '--gal-skin-bg': '#fff4ec', '--gal-skin-fg': '#3a2420', '--gal-skin-border': '#c2185b', '--gal-skin-border-width': '2px', '--gal-skin-radius': '18px', '--gal-skin-rings': 'none', '--gal-skin-pad-top': '20px', '--gal-skin-pad-bottom': '20px', '--gal-skin-line-height': '1.7', '--gal-skin-name-bg': '#c2185b', '--gal-skin-name-fg': '#fff' }

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
    'const forkForeground={setTimeout:(fn,ms)=>setTimeout(fn,ms),clearTimeout:id=>clearTimeout(id)};const FORK_STAGE_READING_DEFAULTS={textSpeed:28};\n' +
    'function ForkIcon(props){return React.createElement("i",{className:"fork-icon",style:{display:"inline-block",width:props.size,height:props.size}})}\n' +
    await read('tavern-plugin/src/client/fork-stage-resources.cjs') + '\n' + await read('tavern-plugin/src/client/fork-pack-playback.cjs') + '\n' +
    await read('tavern-plugin/src/client/fork-stage-skin.cjs') + '\n' +
    between(stage, 'function ForkGalTypewriter(props)', '// Dialogue box dressing') + '\n' +
    between(stage, 'function ForkGalSide(props)', '// Title card (director') + '\n' +
    between(stage, 'function useForkGalFaceColumn(', '// private fork: localized, theme-matching runtime notices') + '\n' +
    between(stage, 'function ForkGalNamePlate(props)', '// Mounted in the session shell') })
  await page.evaluate(skinVars => {
    const h = React.createElement
    // A transparent cut-out: a disc at the bottom centre of a transparent square (no matte anywhere else).
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 200
    const context = canvas.getContext('2d'); context.fillStyle = '#5a4a6a'; context.beginPath(); context.arc(100, 90, 52, 0, Math.PI * 2); context.fill()
    window.FACE = { key: 'a', identity: 'a:calm', src: canvas.toDataURL('image/png'), crop: { x: 0, y: 0, w: 1, h: 1 } }
    // The stage's textbox markup (ForkGalStage) with the real face latch, handoff, side window and typewriter.
    function Box({ s }) {
      const portraits = new Map([['a', window.FACE]])
      const speaker = s.kind === 'line' ? 'a' : ''
      const facing = useForkGalFaceColumn('s', s.pageKey, speaker, portraits, [{ alias: 'a' }], true)
      const face = facing || s.theme !== 'classic' ? (speaker ? portraits.get(speaker) : null) : null
      const handoff = useForkGalFaceHandoff('s:' + s.pageKey, { facing, shown: Boolean(face && face.src), moves: s.theme === 'classic', snap: s.snap, calm: s.calm, typed: s.typed })
      window.handoff = handoff
      return h('div', { className: 'fork-gal-stage', 'data-theme': s.theme, 'data-fk-skin': s.skin ? 'test' : undefined, style: s.skin ? skinVars : undefined },
        h('div', { className: 'fork-gal-box has-face' + (s.kind === 'narration' ? ' is-narration' : '') + (facing ? ' is-facing' : ''), style: { '--bubble-color': '#c86a9a' } },
          h(ForkGalSide, { face, emote: null, snap: s.snap || handoff.cut, calm: s.calm, clearMs: forkGalFaceClearMs(s.calm) }),
          s.kind === 'line' ? h(ForkGalNamePlate, { name: '晓美焰', mood: '平静', classic: s.theme === 'classic', film: false, voiceState: '', onReplay() {} }) : null,
          h('div', { className: 'fork-gal-text' },
            h(ForkGalTypewriter, { key: s.pageKey, text: s.text, speed: s.speed, instant: s.typed, hold: handoff.holding, onDone: () => { window.doneAt = window.doneAt || performance.now(); window.setState(old => ({ ...old, typed: true })) } }),
            h('span', { className: 'fork-gal-next' + (s.typed ? '' : ' is-waiting') }))))
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
    window.sample = () => {
      const opacity = node => Number(getComputedStyle(node).opacity)
      const layers = [...document.querySelectorAll('.fork-gal-side-img')]
      const glyphs = [...document.querySelectorAll('.fork-gal-glyph')].map(opacity).concat(document.querySelector('.fork-gal-type-shown') ? [1] : [])
      const side = document.querySelector('.fork-gal-side').getBoundingClientRect(), text = document.querySelector('.fork-gal-text').getBoundingClientRect()
      return { face: Math.max(0, ...layers.map(opacity)), glyph: Math.max(0, ...glyphs), revealed: glyphs.length, out: document.querySelectorAll('.fork-gal-side-img[data-out]').length,
        layers: layers.map(node => ({ enter: node.dataset.enter || '', out: node.dataset.out || '', animation: getComputedStyle(node).animationName })),
        sideRight: side.right, textLeft: text.left, typed: Boolean(document.querySelector('.fork-gal-next:not(.is-waiting)')) }
    }
    // Turns the page (synchronously, like a click) and samples the very same frame, then every frame for `ms`.
    window.turn = (value, ms) => new Promise(resolve => {
      window.doneAt = 0
      const start = performance.now(); window.patch(value)
      const frames = [{ t: 0, ...window.sample() }]
      function frame() {
        const t = performance.now() - start
        frames.push({ t: Math.round(t), ...window.sample() })
        if (t >= ms) { resolve({ frames, done: window.doneAt ? Math.round(window.doneAt - start) : -1, heldMs: window.handoff.heldMs }); return }
        requestAnimationFrame(frame)
      }
      requestAnimationFrame(frame)
    })
  }, SKIN)
  await page.evaluate(() => document.fonts.ready)
  return { page, errors }
}
const line = (extra = {}) => ({ theme: 'classic', kind: 'line', pageKey: 'p1', text: LINE, speed: SPEED, typed: true, snap: false, calm: false, skin: false, ...extra })
const toNarration = { pageKey: 'p2', kind: 'narration', text: NARRATION, typed: false }
const toLine = { pageKey: 'p3', kind: 'line', text: LINE, typed: false }
const firstGlyph = frames => frames.find(frame => frame.revealed > 0)

test('face → narration: the face clears before the first glyph, never under the text; narration → face does not wait', { timeout: 120000 }, async t => {
  const { page, errors } = await stagePage(t)
  for (const skin of [false, true]) {
    const label = skin ? 'skin' : 'classic'
    await page.evaluate(s => window.mount(s), line({ skin }))
    const before = await page.evaluate(() => window.sample())
    assert.equal(before.face, 1, label + ': the speaker face shows')
    const { frames, done, heldMs } = await page.evaluate(next => window.turn(next, 1600), toNarration)
    assert.equal(heldMs, 120 + 32, label + ': the hold is the clear plus two frames')
    // The column moved left at once (the page is laid out from its first frame) ...
    assert.ok(frames[0].textLeft < before.textLeft - 40, label + ': narration uses the full width')
    assert.ok(frames.every(frame => frame.textLeft === frames[0].textLeft), label + ': no reflow while the page reveals')
    // ... while the outgoing face clears with the short leave, and the text waits for it.
    assert.equal(frames[0].layers[0].out, 'clear', label + ': the face leaves with the clear')
    for (const frame of frames) assert.ok(Math.min(frame.face, frame.glyph) <= .05, label + ' t=' + frame.t + ': text (' + frame.glyph + ') over a visible face (' + frame.face + ')')
    const first = firstGlyph(frames)
    assert.ok(first && first.t >= heldMs - 4, label + ': first glyph after the clear (' + first?.t + 'ms)')
    // Reading is not slowed beyond the hold: the first glyph comes one step after it.
    assert.ok(first.t <= heldMs + SPEED + 60, label + ': first glyph by ' + (heldMs + SPEED + 60) + 'ms, got ' + first.t)
    assert.ok(done > heldMs, label + ': the page finished typing')
    // Narration → the speaker again: the gutter is reserved at once and the text does not wait for the face.
    const back = await page.evaluate(next => window.turn(next, 400), toLine)
    assert.equal(back.heldMs, 0, label + ': no hold when the column gains the gutter')
    assert.ok(back.frames[0].textLeft >= back.frames[0].sideRight, label + ': text starts right of the face window')
    assert.equal(back.frames[0].layers.at(-1).enter, 'slide', label + ': the face slides into its reserved window')
    assert.ok(firstGlyph(back.frames).t <= SPEED + 60, label + ': first glyph right away')
  }
  // Other themes keep one inset for faced and faceless pages: nothing to wait for.
  await page.evaluate(s => window.mount(s), line({ theme: 'gothic' }))
  const gothic = await page.evaluate(next => window.turn(next, 300), toNarration)
  assert.equal(gothic.heldMs, 0)
  assert.ok(firstGlyph(gothic.frames).t <= SPEED + 60)
  assert.deepEqual(errors, [])
})

test('face handoff: skip and page back show the final state at once; a click during the hold cuts the face', { timeout: 60000 }, async t => {
  const { page, errors } = await stagePage(t)
  // Ctrl-skip: the next page arrives typed and snapping; the face is gone in the same frame, no clear, no hold.
  await page.evaluate(s => window.mount(s), line({ snap: true }))
  const skip = await page.evaluate(next => window.turn({ ...next, typed: true }, 100), toNarration)
  assert.equal(skip.heldMs, 0)
  assert.equal(skip.frames[0].out, 0, 'skip: no leaving face')
  assert.equal(skip.frames[0].face, 0)
  assert.ok(skip.frames[0].revealed > 0, 'skip: text at once')
  // Page back / backlog jump (snap): the target page's face is simply there, no slide or clear.
  const back = await page.evaluate(next => window.turn({ ...next, typed: true }, 100), toLine)
  assert.deepEqual(back.frames[0].layers.map(layer => [layer.enter, layer.out]), [['none', '']], 'page back: one settled face')
  assert.equal(back.frames[0].face, 1)
  const backToNarration = await page.evaluate(next => window.turn({ ...next, pageKey: 'p4', typed: true }, 100), toNarration)
  assert.equal(backToNarration.frames[0].out, 0, 'page back to narration: no leaving face')
  // A click during the hold finishes the page: the face is cut in that frame and the text shows complete.
  await page.evaluate(s => window.mount(s), line())
  const held = await page.evaluate(next => window.turn(next, 40), toNarration)
  assert.ok(held.frames.at(-1).face > 0 && held.frames.at(-1).revealed === 0, 'still holding at 40ms')
  const click = await page.evaluate(() => { window.patch({ typed: true }); return window.sample() })
  assert.equal(click.out, 0, 'click: the face is cut')
  assert.ok(click.revealed > 0 && click.typed, 'click: the page shows complete')
  await page.waitForTimeout(250)
  assert.equal((await page.evaluate(() => window.sample())).out, 0, 'the cut face never comes back')
  assert.deepEqual(errors, [])
})

test('face handoff: reduced motion keeps the order with a shorter plain fade', { timeout: 60000 }, async t => {
  const { page, errors } = await stagePage(t)
  for (const [media, calm] of [['reduce', false], ['no-preference', true]]) {
    await page.emulateMedia({ reducedMotion: media })
    await page.evaluate(s => window.mount(s), line({ calm }))
    const { frames, heldMs } = await page.evaluate(next => window.turn(next, 900), toNarration)
    const label = media + (calm ? ' + in-app calm' : '')
    if (calm) assert.equal(heldMs, 90 + 32, label)
    assert.equal(frames[0].layers[0].animation, 'fork-gal-side-leave', label + ': opacity only, no slide')
    for (const frame of frames) assert.ok(Math.min(frame.face, frame.glyph) <= .05, label + ' t=' + frame.t)
    assert.ok(firstGlyph(frames).t >= heldMs - 4, label)
  }
  assert.deepEqual(errors, [])
})

test('face handoff: auto pacing per page stays as without the hold', async t => {
  const { page } = await stagePage(t)
  const result = await page.evaluate(() => ({
    hold: [forkGalFaceHold({ facing: true, shown: true }, { facing: false, moves: true }), forkGalFaceHold({ facing: true, shown: false }, { facing: false, moves: true }),
      forkGalFaceHold({ facing: true, shown: true }, { facing: true, moves: true }), forkGalFaceHold({ facing: false, shown: false }, { facing: true, moves: true }),
      forkGalFaceHold({ facing: true, shown: true }, { facing: false, moves: false }), forkGalFaceHold({ facing: true, shown: true }, { facing: false, moves: true, snap: true }),
      forkGalFaceHold(null, { facing: false, moves: true }), forkGalFaceHold({ facing: true, shown: true }, { facing: false, moves: true, calm: true })],
    auto: [forkGalHandoffAutoDelay(1500, 152), forkGalHandoffAutoDelay(1500, 0), forkGalHandoffAutoDelay(100, 152)]
  }))
  // Only face shown → column loses the gutter waits; a face that never loaded, a kept or gained gutter, a stable
  // column, skip/back and the first page do not.
  assert.deepEqual(result.hold, [152, 0, 0, 0, 0, 0, 0, 122])
  assert.deepEqual(result.auto, [1348, 1500, 0])
  // The held page reaches `typed` later by about the hold; the auto wait after it is that much shorter.
  await page.evaluate(s => window.mount(s), line())
  const held = await page.evaluate(next => window.turn(next, 2600), toNarration)
  await page.evaluate(s => window.mount(s), line({ kind: 'narration', text: '前' }))
  const plain = await page.evaluate(next => window.turn(next, 2600), toNarration)
  assert.ok(held.done > 0 && plain.done > 0)
  const total = run => run.done + forkHandoffAuto(run.heldMs)
  function forkHandoffAuto(heldMs) { return Math.max(0, 1500 - heldMs) }
  assert.ok(Math.abs(total(held) - total(plain)) <= 60, 'page cycle ' + total(held) + ' vs ' + total(plain))
})

test('face window: a pure alpha cut-out - nothing painted behind the portrait, shadow only on the picture', { timeout: 60000 }, async t => {
  const { page, errors } = await stagePage(t, { width: 1200, height: 720 })
  for (const [theme, skin] of [['classic', false], ['classic', true], ['gothic', false], ['magical', false]]) {
    const label = theme + (skin ? ' + skin' : '')
    await page.evaluate(s => window.mount(s), line({ theme, skin }))
    await page.waitForFunction(() => document.querySelector('.fork-gal-side img')?.complete)
    const chain = await page.evaluate(() => {
      const out = [], picture = document.querySelector('.fork-gal-side img')
      for (let node = picture; node; node = node.parentElement) {
        const style = getComputedStyle(node), pseudo = ['::before', '::after'].map(p => getComputedStyle(node, p)).filter(p => p.content && p.content !== 'none')
        out.push({ node: node.tagName + '.' + node.className, picture: node === picture, background: style.backgroundColor, image: style.backgroundImage, shadow: style.boxShadow, filter: style.filter,
          backdrop: style.backdropFilter, mask: style.maskImage, pseudo: pseudo.map(p => [p.backgroundColor, p.backgroundImage, p.boxShadow]) })
        if (node.classList.contains('fork-gal-side')) break
      }
      return out
    })
    assert.equal(chain.at(-1).node.split('.')[1].split(' ')[0], 'fork-gal-side', label + ': walked to the face window')
    for (const item of chain) {
      assert.equal(item.background, 'rgba(0, 0, 0, 0)', label + ' ' + item.node + ' background')
      assert.equal(item.image, 'none', label + ' ' + item.node + ' background-image')
      assert.equal(item.shadow, 'none', label + ' ' + item.node + ' box-shadow')
      assert.equal(item.backdrop, 'none', label + ' ' + item.node + ' backdrop-filter')
      assert.equal(item.mask, 'none', label + ' ' + item.node + ' mask')
      assert.deepEqual(item.pseudo, [], label + ' ' + item.node + ' pseudo elements')
      if (item.picture) {
        const blur = /^drop-shadow\(.*\s([\d.]+)px\)$/.exec(item.filter)
        assert.ok(blur && Number(blur[1]) <= 3, label + ': a tight drop-shadow on the picture: ' + item.filter)
      } else assert.equal(item.filter, 'none', label + ' ' + item.node + ' filter')
    }
  }
  // Pixels: on the pale skin, the window around the cut-out is the box paper, the same as just right of the window.
  await page.evaluate(s => window.mount(s), line({ skin: true }))
  await page.waitForFunction(() => document.querySelector('.fork-gal-side img')?.complete)
  const probe = async () => {
    const points = await page.evaluate(() => {
      const side = document.querySelector('.fork-gal-side').getBoundingClientRect(), box = document.querySelector('.fork-gal-box').getBoundingClientRect()
      // The fixture disc: centre (50%, 45%) of the window, radius 26%; near is 6px under its bottom (the old shadow fell 6px down).
      const y = Math.round(Math.max(box.top + 30, side.top + 40)), belowY = Math.round(side.top + side.height * .71 + 6)
      return { inside: [Math.round(side.right - 6), y], outside: [Math.round(side.right + 6), y], near: [Math.round(side.left + side.width / 2), belowY], beside: [Math.round(side.right + 6), belowY] }
    })
    const shot = await page.screenshot({ type: 'png' })
    return page.evaluate(async ({ data, points }) => {
      const image = new Image(); image.src = 'data:image/png;base64,' + data; await image.decode()
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height
      const context = canvas.getContext('2d'); context.drawImage(image, 0, 0)
      return Object.fromEntries(Object.entries(points).map(([key, [x, y]]) => [key, [...context.getImageData(x, y, 1, 1).data.slice(0, 3)]]))
    }, { data: shot.toString('base64'), points })
  }
  const diff = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i])))
  const clean = await probe()
  assert.ok(diff(clean.inside, clean.outside) <= 2, 'no veil inside the window edge: ' + clean.inside + ' vs ' + clean.outside)
  assert.ok(diff(clean.near, clean.beside) <= 2, 'no haze just under the silhouette: ' + clean.near + ' vs ' + clean.beside)
  // Sanity: the measurement sees the reported veil (the former wide shadow on the window wrapper).
  await page.evaluate(() => { document.querySelector('.fork-gal-side-img').style.filter = 'drop-shadow(0 6px 10px rgb(0 0 0 / .32))'; document.querySelector('.fork-gal-side img').style.filter = 'none' })
  const veiled = await probe()
  assert.ok(diff(veiled.near, veiled.beside) > 6, 'the old wide shadow is detected: ' + veiled.near + ' vs ' + veiled.beside)
  assert.deepEqual(errors, [])
})
