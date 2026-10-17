// Private fork (docs/fork/panel-ui-design.md): the top-left HUD's change moments — a new place or track animates
// only on in-place changes during live playback; first values, history, skip and session switches just show;
// a newer change remounts the label (latest wins); place and track are independent.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const stage = await readFile(new URL('../tavern-plugin/src/client/fork-gal-stage.js', import.meta.url), 'utf8')
const css = await readFile(new URL('../tavern-plugin/lib/client-assets/fork-theme.css', import.meta.url), 'utf8')
const between = (text, a, b) => { const i = text.indexOf(a), j = text.indexOf(b, i); assert.ok(i >= 0 && j > i, a); return text.slice(i, j) }
const source = between(stage, 'function forkGalHudStep(', '// Name plate of the text box')

function hud() {
  let slots = [], cursor = 0, now = 0
  const React = {
    Fragment: 'Fragment',
    createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity).filter(item => item != null && item !== false) }),
    useRef(value) { const index = cursor++; if (!(index in slots)) slots[index] = { current: value }; return slots[index] }
  }
  const ctx = vm.createContext({ React, ForkIcon: 'Icon', Date: { now: () => now } })
  vm.runInContext(source + ';this.api={forkGalHudStep,ForkGalHudLabels};', ctx)
  const render = props => { cursor = 0; return ctx.api.ForkGalHudLabels(props).children }
  return { api: ctx.api, render, tick: ms => { now += ms } }
}
const label = (children, name) => children.find(node => node && (node.props.className || '').split(' ')[0] === name)
const changing = node => (node.props.className || '').split(' ').includes('is-changing')
const ghost = node => node.children.find(child => child.props && child.props.className === 'fork-gal-hud-from')

test('hud step: first value, live in-place change, history / skip, cleared label, session switch', () => {
  const { api } = hud()
  let memo = api.forkGalHudStep(null, '公寓客厅', { scope: 's', live: true })
  assert.deepEqual({ ...memo }, { value: '公寓客厅', scope: 's', key: 0, from: '', animate: false }, 'the first value just shows')
  assert.equal(api.forkGalHudStep(memo, '公寓客厅', { scope: 's', live: true }), memo, 'unchanged keeps the same memo (no restart)')
  memo = api.forkGalHudStep(memo, '天台', { scope: 's', live: true })
  assert.deepEqual({ ...memo }, { value: '天台', scope: 's', key: 1, from: '公寓客厅', animate: true })
  const history = api.forkGalHudStep(memo, '学校', { scope: 's', live: false })
  assert.equal(history.animate, false); assert.equal(history.key, 2, 'a quiet change still remounts, cutting a running moment')
  assert.equal(api.forkGalHudStep(memo, '', { scope: 's', live: true }).animate, false, 'a cleared label just goes')
  assert.equal(api.forkGalHudStep({ ...memo, value: '' }, '学校', { scope: 's', live: true }).animate, false, 'from nothing needs fromEmpty')
  assert.equal(api.forkGalHudStep({ ...memo, value: '' }, '学校', { scope: 's', live: true, fromEmpty: true }).animate, true)
  const other = api.forkGalHudStep(memo, '学校', { scope: 't', live: true })
  assert.equal(other.animate, false, 'another session is a fresh start'); assert.equal(other.from, '')
})

test('hud labels: place and track animate independently; latest wins; no moment on open', () => {
  const { render, tick } = hud()
  const props = (place, track, live = true) => ({ place, track: track ? { name: track } : null, scope: 's', live })
  let out = render(props('', null))
  assert.equal(label(out, 'fork-gal-place'), undefined)
  out = render(props('巴麻美家·公寓客厅·傍晚', null))
  assert.equal(changing(label(out, 'fork-gal-place')), false, 'the first scene while opening does not animate')
  out = render(props('巴麻美家·公寓客厅·傍晚', 'Incertus'))
  assert.equal(changing(label(out, 'fork-gal-track')), false, 'music arriving while the stage opens does not animate')
  tick(5000)
  out = render(props('天台·夜', 'Incertus'))
  const place = label(out, 'fork-gal-place'), track = label(out, 'fork-gal-track')
  assert.ok(changing(place)); assert.equal(changing(track), false, 'only the place changed')
  assert.equal(place.children[0].props.className, 'fork-gal-place-name'); assert.equal(place.children[0].children[0], '天台·夜')
  assert.equal(ghost(place).children[0], '巴麻美家·公寓客厅·傍晚'); assert.equal(ghost(place).props['aria-hidden'], true)
  const key = place.key ?? place.props.key
  out = render(props('天台·夜', 'Sis puella magica!'))
  assert.ok(changing(label(out, 'fork-gal-place')), 'the running place moment is untouched by the track change')
  assert.equal(label(out, 'fork-gal-place').props.key, key)
  assert.ok(changing(label(out, 'fork-gal-track'))); assert.equal(ghost(label(out, 'fork-gal-track')).children[0], 'Incertus')
  out = render(props('学校·屋顶', 'Sis puella magica!'))
  assert.notEqual(label(out, 'fork-gal-place').props.key, key, 'a newer change remounts the label (latest wins)')
  assert.equal(ghost(label(out, 'fork-gal-place')).children[0], '天台·夜')
  out = render(props('公寓客厅', 'Incertus', false))
  assert.equal(changing(label(out, 'fork-gal-place')), false, 'history / skip changes just show')
  assert.equal(changing(label(out, 'fork-gal-track')), false)
  out = render(props('公寓客厅', null)); out = render(props('公寓客厅', 'Credens justitiam'))
  assert.ok(changing(label(out, 'fork-gal-track')), 'music starting from silence mid-scene is a moment')
  assert.equal(ghost(label(out, 'fork-gal-track')), undefined)
})

test('hud labels: with the BGM player the track label is its chip, a button even in silence', () => {
  const { render } = hud()
  let open = false
  const music = { ref: {}, open, paused: false, toggle: () => { open = !open } }
  let chip = label(render({ place: '天台', track: null, scope: 's', live: true, music }), 'fork-gal-track')
  assert.equal(chip.type, 'button'); assert.equal(chip.props['aria-label'], 'BGM'); assert.equal(chip.children.length, 1, 'icon only')
  chip = label(render({ place: '天台', track: { name: 'Incertus' }, scope: 's', live: true, music: { ...music, open: true, paused: true } }), 'fork-gal-track')
  assert.equal(chip.props['aria-label'], 'BGM：Incertus'); assert.equal(chip.props['aria-expanded'], true)
  assert.ok(chip.props.className.split(' ').includes('is-paused'))
  const keys = { stopped: 0 }; chip.props.onKeyDown({ key: 'Enter', stopPropagation: () => keys.stopped++ })
  assert.equal(keys.stopped, 1, 'Enter opens the player instead of turning the page')
  chip.props.onClick(); assert.equal(open, true)
})

test('hud wiring and styles: the stage feeds live playback; the moments stay short and keyed to .is-changing', () => {
  const body = between(stage, 'function ForkGalStage(props)', '// Name plate of the text box')
  // private fork: the BGM player (fork-bgm-player.js) owns the track label; it feeds the same HUD labels.
  assert.match(body, /h\(ForkBgmStage, \{ sessionId, place, live: runtime\.cursor\.mode !== 'history' && !skipping \}\)/)
  for (const selector of ['.fork-gal-place.is-changing::before', '.fork-gal-place.is-changing .fork-gal-place-name', '.fork-gal-track.is-changing .fork-gal-track-name', '.fork-gal-track.is-changing .fork-icon'])
    assert.ok(css.includes(selector + ' {'), selector)
  const durations = [...between(css, '/* private fork: HUD change moments', '@keyframes fork-gal-hud-plate').matchAll(/animation:[^;]*?\s(\d*\.?\d+)s/g)].map(match => Number(match[1]))
  assert.ok(durations.length >= 4 && durations.every(seconds => seconds >= .25 && seconds <= 1.2), String(durations))
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) and \(update: none\) \{\n  \.fork-gal-place\.is-changing::before, \.fork-gal-place\.is-changing::after, \.fork-gal-hud-from \{ display: none; \}/)
})
