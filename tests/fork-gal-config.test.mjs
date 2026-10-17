// private fork: the CG gallery shares the existing modal pause fence.
// Private fork (docs/fork/galgame-stage.md): the stage mixer (fork-gal-mixer.js), the CONFIG screen
// (fork-gal-config.js) and the reading preferences (fork-gal-stage.js) — rows and per-layer mute, theme
// scoping, opening / closing / pausing, text speed and auto wait.
import test from 'node:test'
import { forkUiSfxStub } from './helpers/fork-ui-sfx-stub.mjs' // private fork: stage UI cues
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { forkSpinnerSource } from './helpers/fork-spinner.mjs' // private fork (UI standard phase 2 batch 4): ForkSlider / ForkSegmented live in fork-inline-field.js
import vm from 'node:vm'

const read = name => readFile(new URL('../tavern-plugin/src/client/' + name, import.meta.url), 'utf8')
const [math, audio, mixer, config, stage, backgrounds] = await Promise.all(['fork-stage-audio-math.js', 'fork-stage-audio.js', 'fork-gal-mixer.js', 'fork-gal-config.js', 'fork-gal-stage.js', 'fork-stage-backgrounds.js'].map(read))
const css = await readFile(new URL('../tavern-plugin/lib/client-assets/fork-theme.css', import.meta.url), 'utf8')
const between = (text, a, b) => { const i = text.indexOf(a), j = text.indexOf(b, i); assert.ok(i >= 0 && j > i, a); return text.slice(i, j) }
const pickers = backgrounds.slice(backgrounds.indexOf('// Dialogue box style cards')) // private fork: only theme picker remains
const reading = between(stage, '// Machine preference: film mode', 'function ForkGalStage(props)')
const typewriter = between(stage, '// props.speed: milliseconds per character', '// Dialogue box dressing')
const stageBody = between(stage, 'function ForkGalStage(props)', '// Name plate of the text box')

function storage(initial = {}) { const map = new Map(Object.entries(initial)); return { getItem: key => map.has(key) ? map.get(key) : null, setItem: (key, value) => map.set(key, String(value)), map } }
// A tiny hook renderer: state persists between renders, effects run after a render when their deps change.
function renderer() {
  let slots = [], cursor = 0, pending = []
  const React = {
    Fragment: 'Fragment',
    createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity).filter(item => item != null && item !== false) }),
    useState(value) { const index = cursor++; if (!(index in slots)) slots[index] = typeof value === 'function' ? value() : value; return [slots[index], next => { slots[index] = typeof next === 'function' ? next(slots[index]) : next }] },
    useRef(value) { const index = cursor++; if (!(index in slots)) slots[index] = { current: value }; return slots[index] },
    useEffect(fn, deps) { // private fork: a tab switch can land on a slot ForkSlider's hooks used (no deps array there)
      const index = cursor++, old = slots[index]
      if (!old || !deps || !Array.isArray(old.deps) || deps.some((dep, i) => !Object.is(dep, old.deps[i]))) pending.push(() => { if (old && old.cleanup) old.cleanup(); const cleanup = fn(); slots[index] = { deps, cleanup } })
      else slots[index] = old
    },
    useId: () => 'id', useSyncExternalStore: (subscribe, get) => get(), useMemo: fn => fn(), useCallback: fn => fn
  }
  React.useLayoutEffect = React.useEffect
  return { React, render(fn, props) { cursor = 0; pending = []; const tree = expand(fn(props)); pending.forEach(run => run()); return tree } }
}
function expand(tree) {
  if (!tree || typeof tree !== 'object') return tree
  if (typeof tree.type === 'function') return expand(tree.type({ ...tree.props, children: tree.children }))
  return { ...tree, children: tree.children.map(expand) }
}
const walk = tree => tree && typeof tree === 'object' ? [tree, ...tree.children.flatMap(walk)] : []
const text = tree => tree && typeof tree === 'object' ? tree.children.map(text).join(' ') : String(tree || '')
// private fork: the typewriter's revealed glyphs (the laid-out rest is hidden).
const shownText = tree => tree.children.filter(node => node.props.className !== 'fork-gal-type-rest').map(node => node.children.join('')).join('')
const cls = (node, name) => (node.props.className || '').split(' ').includes(name)
function listeners() {
  const on = []
  const target = { addEventListener: (type, fn, options) => on.push({ type, fn, options }), removeEventListener: (type, fn) => { const i = on.findIndex(item => item.type === type && item.fn === fn); if (i >= 0) on.splice(i, 1) } }
  return { target, on, fire: (type, event) => on.filter(item => item.type === type).forEach(item => item.fn(event)) }
}
function event(extra = {}) { const out = { defaultPrevented: false, stopped: false, immediate: false, preventDefault() { out.defaultPrevented = true }, stopPropagation() { out.stopped = true }, stopImmediatePropagation() { out.immediate = true }, ...extra }; return out }

function mixerContext(saved) {
  const r = renderer(), localStorage = storage({ 'fork-stage-audio': JSON.stringify({ v: 1, master: 0.8, voice: 0.6, music: 0.5, sfx: 0.8, ambience: 0.3, muted: {}, ...saved }) })
  const win = listeners(), doc = listeners()
  const ctx = vm.createContext({ React: r.React, ForkIcon: 'Icon', FORK_ICON_PATHS: {}, localStorage, window: win.target, document: doc.target, setTimeout, clearTimeout, ...forkUiSfxStub() })
  vm.runInContext(forkSpinnerSource + '\n;\n' + math + '\n;\n' + audio + '\n;\n' + mixer + ';this.api={forkStageAudio,forkGalMixLevel,forkGalMixIcon,ForkGalMixerRows,ForkGalMixer,FORK_ICON_PATHS};', ctx)
  return { r, api: ctx.api, localStorage, win, doc }
}

test('mixer rows: every layer in order with what plays on it; a mute keeps the value and unmuting restores it', () => {
  const { r, api, localStorage } = mixerContext()
  const rows = () => walk(r.render(api.ForkGalMixerRows, { state: api.forkStageAudio.get(), names: { music: '晴日漫步', ambience: '雨声' } })).filter(node => cls(node, 'fork-gal-mix-row'))
  let list = rows()
  assert.deepEqual(list.map(row => row.props['data-layer']), ['master', 'voice', 'music', 'sfx', 'ambience', 'ui'])
  assert.deepEqual(list.map(row => text(walk(row).find(node => cls(node, 'fork-gal-mix-label')).children[0])), ['总音量', '配音', '背景音乐', '音效', '环境音', '界面音效'])
  // private fork: the track title lives in the HUD only; the music row is a plain label like the others.
  assert.doesNotMatch(text(list[2]), /晴日漫步/, 'the music row does not repeat the current track')
  assert.equal(walk(list[2]).some(node => cls(node, 'fork-gal-mix-name')), false)
  assert.deepEqual(list.map(row => walk(row).find(node => cls(node, 'fork-gal-mix-label')).props.className), Array(6).fill('fork-gal-mix-label'), 'every row uses the same label box')
  assert.match(text(list[4]), /雨声/, 'the ambience row names the current ambience')
  assert.ok(cls(list[0], 'is-master'))
  const slider = row => walk(row).find(node => node.props.role === 'slider') // private fork (UI standard phase 2 batch 4): the shared ForkSlider track
  const mute = row => walk(row).find(node => cls(node, 'fork-gal-mix-mute'))
  assert.equal(slider(list[4]).props['aria-valuenow'], 0.3); assert.equal(slider(list[4]).props.style['--slider-fill'], '30%')
  // Mute the ambience: value kept (shown, greyed), state says muted, the icon says partial.
  assert.equal(api.forkGalMixLevel(api.forkStageAudio.get()), 'normal')
  mute(list[4]).props.onClick()
  list = rows()
  assert.equal(api.forkStageAudio.get().muted.ambience, true); assert.equal(api.forkStageAudio.get().ambience, 0.3)
  assert.ok(cls(list[4], 'is-muted')); assert.equal(slider(list[4]).props['aria-valuenow'], 0.3); assert.equal(slider(list[4]).props['aria-valuetext'], '静音（30）')
  assert.equal(mute(list[4]).props['aria-pressed'], true); assert.equal(mute(list[4]).props['aria-label'], '取消环境音静音')
  assert.equal(api.forkGalMixLevel(api.forkStageAudio.get()), 'partial'); assert.equal(api.forkGalMixIcon('partial'), 'speaker-low')
  assert.equal(JSON.parse(localStorage.map.get('fork-stage-audio')).muted.ambience, true, 'persisted per machine')
  // Unmute: the same value comes back.
  mute(list[4]).props.onClick()
  list = rows()
  assert.equal(api.forkStageAudio.get().muted.ambience, false); assert.equal(api.forkStageAudio.get().ambience, 0.3); assert.equal(cls(list[4], 'is-muted'), false)
  // Moving a muted slider unmutes that layer at the new value; other layers are untouched.
  mute(list[1]).props.onClick()
  slider(rows()[1]).props.onKeyDown(event({ key: 'ArrowLeft' }))
  assert.equal(api.forkStageAudio.get().voice, 0.59); assert.equal(api.forkStageAudio.get().muted.voice, false); assert.equal(api.forkStageAudio.get().music, 0.5)
  // Master muted (or every layer silent) = muted.
  mute(rows()[0]).props.onClick()
  assert.equal(api.forkGalMixLevel(api.forkStageAudio.get()), 'muted'); assert.equal(api.forkGalMixIcon('muted'), 'speaker-off')
  assert.equal(api.forkGalMixLevel({ master: 0.8, voice: 0, music: 0.5, sfx: 0.5, ambience: 0.5, muted: { music: true, sfx: true, ambience: true } }), 'muted')
  assert.equal(api.forkGalMixLevel({ master: 0, voice: 1, music: 1, sfx: 1, ambience: 1, muted: {} }), 'muted')
  assert.ok(api.FORK_ICON_PATHS['speaker-low'], 'the partial glyph is registered')
})

test('mixer: one speaker icon opens the popover; Esc and a click outside close it without turning the page', () => {
  const { r, api, win, doc } = mixerContext({ muted: { sfx: true } })
  const props = { names: { music: '晴日漫步', ambience: '' } }
  let tree = r.render(api.ForkGalMixer, props)
  const button = walk(tree).find(node => cls(node, 'fork-gal-mixer-toggle'))
  assert.equal(button.props['data-level'], 'partial'); assert.equal(button.props['aria-expanded'], false); assert.equal(button.props['aria-haspopup'], 'dialog')
  assert.match(button.props['aria-label'], /^混音（部分静音）$/)
  assert.equal(walk(tree).some(node => node.props.role === 'dialog'), false)
  assert.equal(walk(button).find(node => node.type === 'Icon').props.name, 'speaker-low')
  const click = event(); tree.props.onClick(click); assert.equal(click.stopped, true, 'the wrapper keeps clicks from the stage')
  button.props.onClick()
  tree = r.render(api.ForkGalMixer, props)
  const panel = walk(tree).find(node => node.props.role === 'dialog')
  assert.equal(panel.props['aria-label'], '混音')
  assert.equal(walk(panel).filter(node => cls(node, 'fork-gal-mix-row')).length, 6)
  assert.equal(walk(panel).some(node => cls(node, 'fork-gal-mix-test')), false, 'the compact popover has no previews')
  const keys = event(); panel.props.onKeyDown(keys); assert.equal(keys.stopped, true, 'arrow keys on a slider do not page the stage')
  // Esc (capture phase on window) closes before the stage sees it.
  const esc = event({ key: 'Escape' })
  win.fire('keydown', esc)
  assert.equal(esc.defaultPrevented, true); assert.equal(esc.immediate, true)
  tree = r.render(api.ForkGalMixer, props)
  assert.equal(walk(tree).some(node => node.props.role === 'dialog'), false)
  // Reopen; a pointer down on the bare stage closes it and swallows that click.
  walk(tree).find(node => cls(node, 'fork-gal-mixer-toggle')).props.onClick()
  r.render(api.ForkGalMixer, props)
  doc.fire('pointerdown', { target: { closest: () => null } })
  tree = r.render(api.ForkGalMixer, props)
  assert.equal(walk(tree).some(node => node.props.role === 'dialog'), false)
  assert.ok(doc.on.some(item => item.type === 'click' && item.options && item.options.capture && item.options.once), 'the dismissing click is swallowed')
  assert.equal(win.on.filter(item => item.type === 'keydown').length, 0, 'listeners removed when closed')
})

function configContext(extra = {}, cues = []) {
  const r = renderer(), win = listeners(), doc = listeners()
  // private fork: ForkPopover renders its children in place here (the skin select's list).
  const ctx = vm.createContext({ React: r.React, ForkIcon: 'Icon', ForkHelpTip: 'HelpTip', ForkPopover: 'Popover', FORK_ICON_PATHS: {}, window: win.target, document: { ...doc.target, activeElement: null }, ...forkUiSfxStub(cues),
    useForkStageAudioState: () => ({ master: 0.8, voice: 0.8, music: 0.8, sfx: 0.8, ambience: 0.8, muted: {} }), forkStageAudio: { setVolume() {}, toggleMute() {} },
    useForkAutoChoicesPreference: () => ({ enabled: false, loading: false, busy: false, error: '', save() {} }),
    useForkStageFilm: () => false, useForkStageQuality: () => 'high', forkStageFilm: { set() {} }, forkStageQuality: { set() {} },
    useForkStageReading: () => ({ textSpeed: 28, autoWait: 700, autoSpeed: 1.3, voiceRate: 1 }), forkStageReading: { set() {} }, FORK_STAGE_READING_DEFAULTS: { textSpeed: 28, autoWait: 700, autoSpeed: 1.3 }, FORK_STAGE_READING_LIMITS: { textSpeed: [0, 80, 2], autoWait: [0, 3000, 100], voiceRate: [0.8, 2, 0.1] },
    ForkGalTypewriter: 'Typewriter', forkGalAutoDelay: () => 1600, setTimeout, clearTimeout, forkForeground: { setTimeout: () => 0, clearTimeout() {} }, ...extra }) // private fork: + forkForeground (slot reuse after ForkSlider's hooks)
  vm.runInContext(forkSpinnerSource + '\n;\n' + pickers + '\n;\n' + mixer + '\n;\n' + config + ';this.api={ForkGalConfigScreen,ForkGalConfigText,ForkGalConfigScreenTab,FORK_STAGE_CONFIG_SECTIONS};', ctx)
  return { r, api: ctx.api, win, cues }
}

test('registered stage sections follow global enablement and mount only the selected mod', async () => {
  let mods=[{id:'example.weather',scope:'global'},{id:'example.clock',scope:'off'}],mounted=0
  const {r,api,win}=configContext({rpc:async()=>({mods})})
  api.FORK_STAGE_CONFIG_SECTIONS['example.weather']={label:'Weather',en:'WEATHER',Component:props=>{mounted++;return r.React.createElement('article',{'data-session':props.sessionId})}}
  api.FORK_STAGE_CONFIG_SECTIONS['example.clock']={label:'Clock',en:'CLOCK',Component:()=>{throw new Error('Disabled page mounted')}}
  const props={sessionId:'s',data:{config:{stage:{theme:'magical'}}},names:{},tests:{},onClose(){}}
  r.render(api.ForkGalConfigScreen,props);await new Promise(resolve=>setImmediate(resolve))
  let tree=r.render(api.ForkGalConfigScreen,props),tabs=walk(tree).filter(node=>node.props.role==='tab')
  assert.equal(tabs.length,4);assert.equal(mounted,0)
  tabs.at(-1).props.onClick();tree=r.render(api.ForkGalConfigScreen,props)
  assert.equal(mounted,1);assert.equal(walk(tree).find(node=>node.type==='article').props['data-session'],'s')
  mods=[];win.fire('dsh-tavern-mods-changed');await new Promise(resolve=>setImmediate(resolve))
  tree=r.render(api.ForkGalConfigScreen,props)
  assert.equal(walk(tree).filter(node=>node.props.role==='tab').length,3);assert.equal(mounted,1)
})

test('config screen: tabs, Esc / right click / ✕ close it, keys stay inside; the stage pauses auto and skip meanwhile', () => {
  const { r, api, win, cues } = configContext()
  const closed = [], tested = []
  const props = { sessionId: 's', data: { config: { stage: { theme: 'magical' } } }, names: { music: '晴日漫步', ambience: '雨声' }, tests: { voice: () => tested.push('voice'), sfx: () => tested.push('sfx') }, onClose: () => closed.push(true) }
  let tree = r.render(api.ForkGalConfigScreen, props)
  assert.equal(tree.props.role, 'dialog'); assert.equal(tree.props['aria-modal'], 'true'); assert.ok(cls(tree, 'fork-gal-config'))
  assert.match(text(walk(tree).find(node => node.type === 'h2')), /CONFIG.*设置/)
  const tabs = walk(tree).filter(node => node.props.role === 'tab')
  assert.deepEqual(tabs.map(tab => text(tab.children[1])), ['声音', '文字', '画面'])
  assert.deepEqual(tabs.map(tab => tab.props['aria-selected']), [true, false, false])
  assert.deepEqual(tabs.map(tab => tab.props.tabIndex), [0, -1, -1], 'roving tab stop')
  // 音量: the same rows as the mixer, large, with ▶ previews for voice and sfx only.
  const page = walk(tree).find(node => node.props.role === 'tabpanel')
  assert.ok(walk(page).some(node => cls(node, 'fork-gal-mix') && cls(node, 'is-large')))
  assert.equal(walk(page).filter(node => cls(node, 'fork-gal-config-theme-art') || cls(node, 'fork-gal-config-preview') || cls(node, 'fork-font-pick')).length, 0, 'inactive text tab is not mounted or running preview effects')
  const previews = walk(page).filter(node => node.type === 'button' && cls(node, 'fork-gal-mix-test'))
  assert.deepEqual(previews.map(node => node.props['aria-label']), ['试听配音', '试听音效', '试听界面音效'])
  previews.forEach(node => node.props.onClick()); assert.deepEqual(tested, ['voice', 'sfx'])
  assert.deepEqual(cues, ['confirm'], 'private fork: the 界面音效 preview plays a real cue')
  // Arrow keys move between tabs; clicking a tab switches the page.
  tabs[0].props.onKeyDown(event({ key: 'ArrowDown' }))
  tree = r.render(api.ForkGalConfigScreen, props)
  assert.equal(walk(tree).find(node => node.props.role === 'tabpanel').props['data-tab'], 'text')
  walk(tree).filter(node => node.props.role === 'tab')[2].props.onClick()
  tree = r.render(api.ForkGalConfigScreen, props)
  assert.match(text(walk(tree).find(node => node.props.role === 'tabpanel')), /电影模式.*特效质量/)
  // Keys typed in the screen never reach the stage (which also ignores keys while it is open).
  const key = event({ key: ' ' }); tree.props.onKeyDown(key); assert.equal(key.stopped, true)
  const click = event(); tree.props.onClick(click); assert.equal(click.stopped, true, 'clicks do not turn the page')
  // Esc closes (capture phase, before the stage); an open ? tip takes Esc first.
  win.fire('keydown', event({ key: 'Escape', target: { closest: selector => selector === '.fork-help-tip.is-open' ? {} : null } }))
  assert.equal(closed.length, 0)
  const esc = event({ key: 'Escape', target: { closest: () => null } })
  win.fire('keydown', esc)
  assert.equal(closed.length, 1); assert.equal(esc.immediate, true)
  const right = event(); tree.props.onContextMenu(right)
  assert.equal(closed.length, 2); assert.equal(right.defaultPrevented, true)
  walk(tree).find(node => cls(node, 'fork-gal-config-close')).props.onClick()
  assert.equal(closed.length, 3)
  assert.equal(walk(tree).find(node => cls(node, 'fork-gal-config-close')).props['aria-label'], '关闭设置')
})

// private fork: phones get a dedicated compact CONFIG layout; wide screens keep the two-column sheet. Owner 2026-10: the
// ✕ sits small and quiet in the header row in both layouts (no floating corner button outside the sheet).
test('config screen: compact layout on phones puts the tabs in a horizontal bar; the ✕ is in the header row in both layouts', () => {
  const queries = []
  const media = matches => query => { const list = { matches, query, added: 0, removed: 0, addEventListener() { list.added++ }, removeEventListener() { list.removed++ } }; queries.push(list); return list }
  const props = { sessionId: 's', data: { config: { stage: { theme: 'classic' } } }, names: {}, tests: {}, onClose() {} }
  const sheetOf = tree => tree.children.find(node => cls(node, 'fork-gal-config-sheet'))
  const headOf = tree => walk(sheetOf(tree)).find(node => node.type === 'header')
  for (const [label, extra, layout] of [['no matchMedia', {}, 'wide'], ['wide', { matchMedia: media(false) }, 'wide'], ['phone', { matchMedia: media(true) }, 'compact']]) {
    const { r, api } = configContext(extra)
    const tree = r.render(api.ForkGalConfigScreen, props)
    assert.equal(tree.props['data-layout'], layout, label)
    const nav = walk(tree).find(node => node.props.role === 'tablist')
    assert.equal(nav.props['aria-orientation'], layout === 'compact' ? 'horizontal' : 'vertical', label)
    const closeInHead = walk(headOf(tree)).find(node => cls(node, 'fork-gal-config-close'))
    const closeOutside = tree.children.find(node => cls(node, 'fork-gal-config-close'))
    assert.ok(closeInHead, label + ': ✕ inside the header row')
    assert.equal(Boolean(closeOutside), false, label + ': no corner ✕ outside the sheet')
    assert.equal(headOf(tree).children.at(-1), closeInHead, label + ': ✕ is the last item of the header (right side)')
    assert.equal(walk(tree).filter(node => cls(node, 'fork-gal-config-close')).length, 1, label + ': exactly one ✕')
    assert.equal((closeInHead || closeOutside).props['aria-label'], '关闭设置')
  }
  assert.ok(queries.length && queries.every(list => /max-width: 640px/.test(list.query) && /pointer: coarse/.test(list.query)), 'narrow screens and short touch screens')
  assert.ok(queries.some(list => list.added > 0), 'follows viewport changes')
  // CSS: the compact block is token-only and keyed by data-layout; the wide rules stay as they were.
  const block = between(css, '/* private fork: compact CONFIG', '/* ==== end stage overlays: config + mixer ==== */')
  assert.match(block, /\.fork-gal-config\[data-layout="compact"\] \.fork-gal-config-sheet \{[^}]*width: 100%; height: 100%;[^}]*border-radius: 0;/, 'full-bleed sheet')
  assert.match(block, /\.fork-gal-config\[data-layout="compact"\] :is\(\.fork-gal-config-frame, \.fork-gal-config-ornament\) \{ display: none; \}/, 'no inner frame (no box in box)')
  assert.match(block, /\.fork-gal-config\[data-layout="compact"\] \.fork-gal-config-tabs \{ display: grid; grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/, 'horizontal tab bar')
  assert.match(block, /\.fork-gal-config\[data-layout="compact"\] \.fork-gal-config-row \{ grid-template-columns: minmax\(0, 1fr\);/, 'rows stack label above control')
  assert.match(block, /\.fork-gal-config\[data-layout="compact"\] \.fork-gal-config-title \{[^}]*white-space: nowrap;/, 'one-line title')
  assert.match(block, /grid-template-areas: "mute label value test" "mute slider slider test"/, 'mixer rows on two lines')
  assert.match(block, /\.fork-gal-config-close \{ position: static;/, 'the ✕ sits in the header flow')
  assert.doesNotMatch(block, /#[0-9a-f]{3,8}\b|rgba?\(|data-theme|@media/i, 'tokens only, layout chosen by the component')
  assert.match(css, /\.fork-gal-config-sheet \{ position: relative; box-sizing: border-box; display: grid; grid-template-columns: clamp\(190px, 16vw, 250px\) minmax\(0, 1fr\);/, 'wide sheet unchanged')
  // private fork (owner 2026-10): wide too — a small quiet ✕ in the header flow, and a single frame (no inner line).
  assert.match(css, /\n\.fork-gal-stage \.fork-gal-config-close \{ position: static; flex: none; align-self: center;[^}]*width: 40px; height: 40px;[^}]*background: transparent; box-shadow: none;/, 'quiet header ✕')
  assert.match(css, /\n\.fork-gal-config-title \{ flex: 1; min-width: 0;/, 'the title takes the row, the ✕ sits at its end')
  assert.match(css, /\n\.fork-gal-config-frame \{ position: absolute; inset: 9px; pointer-events: none; \}/, 'the inner layer draws no frame line')
  assert.doesNotMatch(css, /\.fork-gal-config-frame \{[^}]*border:/, 'no box in box')
})

// private fork (owner 2026-10): 自动生成选项 moved to 舞台设置 › 基础设置 (one place only); the 文字 tab has no switch. The
// shared CONFIG switch (track + knob) is exercised by the 画面 tab test below.
test('config text tab: no auto-choices row; the CONFIG switch stays token-styled', () => {
  const { r, api } = configContext({ forkBubbleStore: { get: () => null, set() {} } })
  const tree = r.render(api.ForkGalConfigText, { sessionId: 's', data: { config: { stage: { theme: 'classic' } } } })
  assert.equal(walk(tree).some(node => node.props.role === 'switch'), false)
  assert.doesNotMatch(text(tree), /自动生成/)
  const switchCss = between(css, '/* private fork (owner 2026-10): on / off switch', '/* Skin previews:')
  assert.doesNotMatch(switchCss, /#[0-9a-f]{3,8}\b|data-theme|appearance/i, 'tokens only, no native control')
  assert.match(switchCss, /\[aria-checked="true"\] \.fork-gal-config-switch-track \{ background: var\(--gal-ui-accent\);/)
})

test('config screen wiring in the stage: auto / skip / keys / wheel pause while open, the box hides, focus returns', () => {
  assert.match(stageBody, /const \[configOpen, setConfig\] = React\.useState\(false\);/)
  // private fork: skip also stops at the first unread page between the pause check and the timer.
  assert.match(stageBody, /if \(backlog \|\| configOpen \|\| galleryOpen \|\| menuOpen\) return;\s*if \(!forkGalPageRead\(readState\.readThrough, nextPosition\(\)\)\) \{ stopSkip\(\); return; \}\s*const timer = forkForeground\.setTimeout\(\(\) => \{\s*go\(1, true\)/, 'skip pauses before advancing a card or page')
  assert.match(stageBody, /if \(!auto \|\| skipping \|\| hidden \|\| backlog \|\| configOpen \|\| galleryOpen \|\| menuOpen \|\| !typed/, 'auto pauses')
  assert.match(stageBody, /\[auto, skipping, hidden, backlog, configOpen, galleryOpen, menuOpen, typed/, 'and resumes when it closes')
  assert.match(stageBody, /function onKey\(event\) \{\s*\/\/[^\n]*\n\s*if \(configOpen \|\| galleryOpen \|\| menuOpen\) return;/, 'stage keys are ignored while it is open')
  assert.match(stageBody, /if \(backlog \|\| configOpen \|\| galleryOpen \|\| menuOpen \|\| Date\.now\(\) - backlogClosedAt\.current < 450\) return;/, 'the wheel neither pages nor opens the backlog')
  assert.match(stageBody, /\(configOpen \? " is-config" : ""\)/)
  assert.match(stageBody, /configOpener\.current = opener \|\| \(typeof document !== "undefined" \? document\.activeElement : null\)/)
  assert.match(stageBody, /if \(opener\.isConnected\) opener\.focus\(/, 'focus goes back to the gear')
  // private fork: hidden by visibility, never faded (ui-surfaces.md: no fading ancestors of text surfaces).
  assert.match(css, /\.fork-gal-stage\.is-config :is\(\.fork-gal-box, \.fork-gal-choices, \.fork-gal-topbar\) \{ visibility: hidden; pointer-events: none;/)
  // Top bar: the mixer icon replaces the old 混音 text menu; the track stays as a label.
  const topbar = between(stageBody, '"fork-gal-topleft"', '"fork-gal-topright"')
  assert.match(topbar, /h\(ForkGalMixer, \{ names: mixNames \}\)/)
  assert.doesNotMatch(topbar, /ForkStageSfxControl|ForkStageMusicControl|混音/)
})

test('theme tokens: each theme scopes the palette; previews carry their own theme; overlay rules use tokens only', () => {
  assert.match(stageBody, /className: "fork-gal-stage"[^\n]*"data-theme": theme/)
  const tokens = between(css, '/* ==== stage UI tokens ==== */', '/* ==== end stage UI tokens ==== */')
  // private fork: crt (显像管) is the fourth built-in theme.
  for (const theme of ['classic', 'gothic', 'magical', 'crt', 'aero']) assert.ok(tokens.includes(`.fork-gal-stage[data-theme="${theme}"], .fork-gal-theme-scope[data-theme="${theme}"] {`), theme)
  assert.ok(tokens.includes('.fork-gal-stage, .fork-gal-theme-scope {'), 'the derivation also runs on preview scopes')
  // private fork (owner 2026-10): 默认舞台皮肤 is a compact select. Closed: one trigger with the chosen skin's mini preview
  // and name, no list. Open: one option per skin, each preview a theme scope of that skin; the option itself follows
  // the current theme.
  const cues = []
  const { r, api } = configContext({ forkBubbleStore: { get: () => null, set() {} } }, cues)
  const props = { sessionId: 's', data: { config: { stage: { theme: 'gothic' } } } }
  let tree = r.render(api.ForkGalConfigText, props)
  let trigger = walk(tree).find(node => cls(node, 'fork-gal-skin-trigger'))
  assert.equal(trigger.type, 'button'); assert.equal(trigger.props['aria-haspopup'], 'listbox'); assert.equal(trigger.props['aria-expanded'], false)
  assert.equal(trigger.props['aria-label'], '默认舞台皮肤：哥特金边')
  assert.match(text(trigger), /哥特金边/)
  const chosenArt = walk(trigger).find(node => cls(node, 'fork-gal-config-theme-art'))
  assert.ok(cls(chosenArt, 'fork-gal-theme-scope')); assert.equal(chosenArt.props['data-theme'], 'gothic')
  assert.equal(walk(tree).filter(node => node.props.role === 'option' || node.props.role === 'radio').length, 0, 'no card grid, no list while closed')
  // ↓ on the trigger opens the list (Enter / Space are the button's own click).
  const down = event({ key: 'ArrowDown' }); trigger.props.onKeyDown(down); assert.equal(down.defaultPrevented, true)
  tree = r.render(api.ForkGalConfigText, props)
  trigger = walk(tree).find(node => cls(node, 'fork-gal-skin-trigger'))
  assert.equal(trigger.props['aria-expanded'], true)
  const list = walk(tree).find(node => node.props.role === 'listbox')
  assert.equal(list.props['aria-label'], '默认舞台皮肤')
  const cards = walk(list).filter(node => node.props.role === 'option')
  assert.deepEqual(cards.map(card => [card.props['data-value'], card.props['aria-selected']]), [['classic', false], ['gothic', true], ['magical', false], ['crt', false], ['aero', false]])
  assert.equal(cards.filter(card => walk(card).some(node => cls(node, 'fork-gal-skin-option-check'))).length, 1, 'the chosen skin is marked')
  for (const card of cards) {
    const art = walk(card).find(node => cls(node, 'fork-gal-config-theme-art'))
    assert.ok(cls(art, 'fork-gal-theme-scope')); assert.equal(art.props['data-theme'], card.props['data-value'])
    assert.equal(card.props['data-theme'], undefined, 'the option keeps the current theme')
  }
  // Keys inside the list stay there; Tab closes it.
  const tab = event({ key: 'Tab' }); list.props.onKeyDown(tab); assert.equal(tab.stopped, true); assert.equal(tab.defaultPrevented, true)
  tree = r.render(api.ForkGalConfigText, props)
  assert.equal(walk(tree).filter(node => node.props.role === 'option').length, 0)
  // Choosing the current skin just closes (a cue, no save).
  walk(tree).find(node => cls(node, 'fork-gal-skin-trigger')).props.onClick()
  tree = r.render(api.ForkGalConfigText, props)
  walk(tree).filter(node => node.props.role === 'option')[1].props.onClick()
  assert.deepEqual(cues, ['toggle'])
  assert.equal(walk(r.render(api.ForkGalConfigText, props)).filter(node => node.props.role === 'option').length, 0)
  // Pack skins: the palette the host sends (choice.preview) or, for the card's current skin, that document; else an initial.
  const ref = { packId: 'p', kind: 'skins', assetId: 'deep' }, other = { packId: 'p', kind: 'skins', assetId: 'salt' }, sent = { packId: 'p', kind: 'skins', assetId: 'sent' }
  const stage = { theme: 'classic', defaultSkin: ref, skin: { ref, document: { textbox: { paint: { bg: '#0b1a2e', fg: '#e6f2ff' } }, ui: { bg: '#0b1a2e', fg: '#e6f2ff', accent: '#7cc8ff', border: '#3d6b8f', radius: 14 } } },
    skinChoices: [{ value: 'classic', label: '经典' }, { value: other, label: '海盐奶油' }, { value: ref, label: '深海夜灯' }, { value: sent, label: '晶石', preview: { bg: '#fff8f0', fg: '#3a2a20', accent: '#c0507a' } }] }
  const packProps = { sessionId: 's', data: { config: { stage } } }
  tree = r.render(api.ForkGalConfigText, packProps)
  trigger = walk(tree).find(node => cls(node, 'fork-gal-skin-trigger'))
  assert.match(text(trigger), /深海夜灯/)
  assert.equal(walk(trigger).find(node => cls(node, 'fork-gal-config-theme-art')).props.style['--gal-ui-surface-2'], '#0b1a2e', 'the current pack skin previews its own palette')
  trigger.props.onClick()
  const arts = walk(r.render(api.ForkGalConfigText, packProps)).filter(node => node.props.role === 'option').map(card => walk(card).find(node => cls(node, 'fork-gal-config-theme-art')))
  assert.equal(arts[0].props['data-theme'], 'classic')
  assert.ok(cls(arts[1], 'is-unknown')); assert.equal(text(arts[1]), '海', 'no made-up palette for a pack skin the client cannot see')
  assert.deepEqual([arts[2].props.style['--gal-ui-accent'], arts[2].props.style['--gal-ui-radius']], ['#7cc8ff', '14px'])
  assert.deepEqual([arts[3].props.style['--gal-ui-surface-2'], arts[3].props.style['--gal-ui-accent']], ['#fff8f0', '#c0507a'])
  // Esc inside the open list closes the list first, not the CONFIG screen.
  assert.match(config, /closest\("\.fork-font-pick\.is-open, \.fork-font-pop, \.fork-gal-skin-pick\.is-open, \.fork-gal-skin-pop"\)\) return;/)
  // The overlay block: one delimited block, and its colours come from tokens (no literal colours besides
  // the neutral drop shadows, the white top-bar icon that sits on the scene, and the preview's painted sky).
  const block = between(css, '/* ==== stage overlays: config + mixer ==== */', '/* ==== end stage overlays: config + mixer ==== */')
  const rules = [...block.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(match => ({ selector: match[1].trim(), body: match[2] }))
  assert.ok(rules.length > 40)
  for (const rule of rules) {
    if (/data-theme/.test(rule.selector)) assert.fail('theme selector in ' + rule.selector)
    if (/mixer-toggle|fork-gal-track|theme-art \{|^\d|^from|^to|^50%/.test(rule.selector) || rule.selector === '.fork-gal-config-theme-art') continue
    assert.doesNotMatch(rule.body, /#[0-9a-f]{3,8}\b/i, rule.selector)
    // private fork: a token at full alpha (rgb(from var(--token) r g b / 1), the BGM chat popover's opaque surface) is not a literal.
    assert.doesNotMatch(rule.body.replace(/rgb\(0 0 0 \/ \.\d+\)/g, '').replace(/rgb\(from var\(--[\w-]+(?:, var\(--[\w-]+\))?\) r g b \/ 1\)/g, ''), /rgba?\(/, rule.selector)
  }
  for (const [selector, token] of [['.fork-gal-config-sheet', '--gal-ui-surface-2'], ['.fork-gal-mixer-panel', '--gal-ui-surface-2'], ['.fork-gal-config {', '--gal-ui-dim'], ['.fork-gal-config-title b', '--gal-ui-title-shadow'], ['.fork-gal-config-ornament::before', '--gal-ui-ornament']])
    assert.ok(rules.some(rule => rule.selector.startsWith(selector.replace(' {', '')) && rule.body.includes('var(' + token + ')')), selector + ' uses ' + token)
})

// private fork: storage may reorder reference keys; the same asset must keep its selected mark.
test('Config skin selection compares built-in ids or all three asset identity fields', () => {
  const { r, api } = configContext({ forkBubbleStore: { get: () => null, set() {} } })
  const ref = { packId: 'pack-a', kind: 'skins', assetId: 'dark' }
  const values = ['classic', 'crt', ref, { ...ref, packId: 'pack-b' }, { ...ref, kind: 'performances' }, { ...ref, assetId: 'light' }]
  for (const [defaultSkin, index] of [[{ assetId: 'dark', kind: 'skins', packId: 'pack-a' }, 2], ['crt', 1], [{ assetId: 'light', packId: 'pack-a', kind: 'skins' }, 5], [ref, 2]]) {
    // private fork (owner 2026-10): the choices are the options of the skin select (open it first).
    const props = { sessionId: 's', data: { config: { stage: { theme: 'classic', defaultSkin, skinChoices: values.map(value => ({ value, label: 'Skin' })) } } } }
    const trigger = walk(r.render(api.ForkGalConfigText, props)).find(node => cls(node, 'fork-gal-skin-trigger'))
    if (!trigger.props['aria-expanded']) trigger.props.onClick()
    const tree = r.render(api.ForkGalConfigText, props)
    const cards = walk(tree).filter(node => node.props.role === 'option')
    assert.deepEqual(cards.map(card => card.props['aria-selected']), values.map((_, i) => i === index))
    assert.deepEqual(cards.map(card => cls(card, 'is-on')), values.map((_, i) => i === index))
  }
})

function readingContext(saved) {
  const r = renderer(), timers = [], localStorage = storage(saved === undefined ? {} : { 'fork-stage-reading': saved })
  // private fork: a foreground-only scheduler isolates reading preference timing.
  const ctx = vm.createContext({ React: r.React, localStorage, forkForeground: { setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length }, clearTimeout() {} } })
  vm.runInContext(reading + '\n;\n' + typewriter + ';this.api={FORK_STAGE_READING_DEFAULTS,FORK_STAGE_READING_LIMITS,forkStageReadingPrefs,forkGalAutoDelay,forkStageReading,ForkGalTypewriter};', ctx)
  return { r, api: ctx.api, timers, localStorage }
}

test('reading prefs: text speed and auto wait retain defaults; auto speed defaults slightly faster, clamp, persist per machine', () => {
  const { api, localStorage } = readingContext()
  const plain = value => JSON.parse(JSON.stringify(value))
  assert.deepEqual(plain(api.FORK_STAGE_READING_DEFAULTS), { textSpeed: 28, autoWait: 700, autoSpeed: 1.3, voiceRate: 1, frameCap: 60, reducedMotion: false, photosensitive: true })
  assert.deepEqual(plain(api.forkStageReading.get()), { textSpeed: 28, autoWait: 700, autoSpeed: 1.3, voiceRate: 1, frameCap: 60, reducedMotion: false, photosensitive: true })
  assert.equal(api.forkStageReading.get(), api.forkStageReading.get(), 'stable snapshot for useSyncExternalStore')
  assert.equal(api.forkStageReadingPrefs({reducedMotion:true}).reducedMotion,true)
  assert.equal(api.forkStageReadingPrefs({photosensitive:false}).photosensitive,false)
  assert.equal(api.forkStageReadingPrefs({photosensitive:'false'}).photosensitive,true)
  // The new default shortens dwell, including the silent-page floor and post-voice pause.
  const defaults = api.forkStageReading.get()
  // private fork (reading controls §2.3): a silent page holds clamp(400 + 70 × visible characters, 800, 10000) ms.
  for (const [line, chars] of [['', 1], ['短句。', 2], ['这是一句不算短的旁白，用来检查按字数计算的停留时间是不是和原来一样。', 32]]) {
    assert.equal(api.forkGalAutoDelay(defaults, true, line), 700 / 1.3)
    assert.equal(api.forkGalAutoDelay(defaults, false, line), Math.max(800, 400 + 70 * chars) / 1.3)
  }
  // A longer / shorter wait shifts both kinds of page by the same amount; never negative.
  assert.equal(api.forkGalAutoDelay({ textSpeed: 28, autoWait: 1500 }, true, 'x'), 1500 / 1.3)
  assert.equal(api.forkGalAutoDelay({ textSpeed: 28, autoWait: 1500 }, false, 'x'), 1600 / 1.3)
  assert.equal(api.forkGalAutoDelay({ textSpeed: 28, autoWait: 0 }, false, 'x'), 100 / 1.3)
  assert.equal(api.forkGalAutoDelay({ textSpeed: 28, autoWait: 0 }, true, 'x'), 0)
  for (const autoSpeed of [0.5, 1, 1.3, 3]) {
    assert.equal(api.forkGalAutoDelay({ autoWait: 700, autoSpeed }, false, ''), 800 / autoSpeed)
    assert.equal(api.forkGalAutoDelay({ autoWait: 700, autoSpeed }, false, 'x'.repeat(100)), 7400 / autoSpeed)
    assert.equal(api.forkGalAutoDelay({ autoWait: 700, autoSpeed }, true, 'x'), 700 / autoSpeed)
  }
  assert.equal(api.forkStageReadingPrefs({ autoSpeed: 20 }).autoSpeed, 3)
  assert.equal(api.forkStageReadingPrefs({ autoSpeed: -1 }).autoSpeed, 0.5)
  // Voice speed (Config → 声音): 0.8–2.0 in 0.1 steps, default 1.
  assert.equal(api.forkStageReadingPrefs({}).voiceRate, 1)
  assert.equal(api.forkStageReadingPrefs({ voiceRate: 1.26 }).voiceRate, 1.3)
  assert.equal(api.forkStageReadingPrefs({ voiceRate: 9 }).voiceRate, 2)
  assert.equal(api.forkStageReadingPrefs({ voiceRate: 0.1 }).voiceRate, 0.8)
  assert.equal(api.forkStageReadingPrefs({ autoSpeed: null }).autoSpeed, 1.3)
  // Normalisation: ranges, steps, junk.
  assert.deepEqual(plain(api.forkStageReadingPrefs({ textSpeed: 200, autoWait: -5 })), { textSpeed: 80, autoWait: 0, autoSpeed: 1.3, voiceRate: 1, frameCap: 60, reducedMotion: false, photosensitive: true })
  assert.deepEqual(plain(api.forkStageReadingPrefs({ textSpeed: 29, autoWait: 1234 })), { textSpeed: 30, autoWait: 1200, autoSpeed: 1.3, voiceRate: 1, frameCap: 60, reducedMotion: false, photosensitive: true })
  assert.deepEqual(plain(api.forkStageReadingPrefs({ textSpeed: 'x', autoWait: null })), { textSpeed: 28, autoWait: 700, autoSpeed: 1.3, voiceRate: 1, frameCap: 60, reducedMotion: false, photosensitive: true })
  assert.deepEqual(plain(api.forkStageReadingPrefs('junk')), { textSpeed: 28, autoWait: 700, autoSpeed: 1.3, voiceRate: 1, frameCap: 60, reducedMotion: false, photosensitive: true })
  // Persisted per machine; subscribers hear about it.
  let heard = 0
  api.forkStageReading.subscribe(() => heard++)
  api.forkStageReading.set({ textSpeed: 0 })
  assert.equal(heard, 1)
  assert.deepEqual(JSON.parse(localStorage.map.get('fork-stage-reading')), { textSpeed: 0, autoWait: 700, autoSpeed: 1.3, voiceRate: 1, frameCap: 60, reducedMotion: false, photosensitive: true })
  const again = readingContext(localStorage.map.get('fork-stage-reading'))
  assert.deepEqual(plain(again.api.forkStageReading.get()), { textSpeed: 0, autoWait: 700, autoSpeed: 1.3, voiceRate: 1, frameCap: 60, reducedMotion: false, photosensitive: true })
  assert.deepEqual(plain(readingContext('{broken').api.forkStageReading.get()), { textSpeed: 28, autoWait: 700, autoSpeed: 1.3, voiceRate: 1, frameCap: 60, reducedMotion: false, photosensitive: true })
})

test('reading prefs in the stage: the typewriter ticks at the chosen speed and auto waits the chosen time', () => {
  for (const [speed, expected] of [[undefined, 28], [28, 28], [44, 44], [2, 2]]) {
    const { r, api, timers } = readingContext()
    const tree = r.render(api.ForkGalTypewriter, { text: '你好世界', speed })
    // private fork: the whole line is laid out from the start; nothing is revealed yet.
    assert.equal(shownText(tree), ''); assert.equal(text(tree), '你好世界')
    assert.equal(timers.length, 1); assert.equal(timers[0].ms, expected)
  }
  // 0 = the whole line at once (and done at once).
  const { r, api, timers } = readingContext()
  let done = 0
  const tree = r.render(api.ForkGalTypewriter, { text: '你好世界', speed: 0, onDone: () => done++ })
  assert.equal(shownText(tree), '你好世界'); assert.equal(timers.length, 1, 'only the settle timer'); assert.ok(timers[0].ms > 0); assert.equal(done, 1)
  // The stage reads the preference and uses it for both.
  assert.match(stageBody, /const reading = useForkStageReading\(\);/)
  // private fork: the typewriter waits for face clearing or textcard playback; face hold shortens auto wait
  // (docs/fork/textbox-face-transition.md and docs/fork/textcard-stage.md).
  assert.match(stageBody, /h\(ForkGalTypewriter, \{ key: sessionId \+ ":" \+ turn \+ ":" \+ page \+ ":" \+ card \+ \(transitioning \? ":transition" : ""\), text: shownText, speed: reading\.textSpeed, skin: activeSkin, instant: typed, hold: handoff\.holding \|\| textcard\.busy, pending: current\.pending/)
  assert.match(stageBody, /setTimeout\(\(\) => go\(1, true\), forkGalHandoffAutoDelay\(forkGalAutoDelay\(reading, Boolean\(voice\) && lastCard, !transitioning \? subtitles\.text : current\.text\), handoff\.heldMs\)\)/)
  // private fork (B4): Auto also re-arms when the paragraph's director prefix arrives.
  assert.match(stageBody, /reading\.autoWait, reading\.autoSpeed, atEnd, sceneHolding, presentationBusy, awaitingDirection\]\);/, 'a changed wait re-arms the timer')
  assert.doesNotMatch(stageBody, /voice \? 700 :|\* 85\)\)/, 'no hard-coded pace left')
  assert.doesNotMatch(typewriter, /, 28\);/)
})


// private fork (owner 2026-10): the 画面 tab's on / off rows use one switch (ForkGalConfigSwitch); multi-way rows stay segmented.
test('config screen tab: film, reduced motion and photosensitive protection are switches that apply live', () => {
  const { api } = readingContext()
  let film = false
  const filmCalls = []
  const ui = configContext({ useForkStageReading: api.forkStageReading.get, forkStageReading: api.forkStageReading, useForkStageFilm: () => film, forkStageFilm: { set: on => { filmCalls.push(on); film = on } } })
  const switches = () => Object.fromEntries(walk(ui.r.render(ui.api.ForkGalConfigScreenTab)).filter(node => node.props.role === 'switch').map(node => [node.props['aria-label'], node]))
  let rows = switches()
  assert.deepEqual(Object.keys(rows), ['电影模式', '减少动态', '光敏保护'])
  assert.ok(Object.values(rows).every(node => node.type === 'button' && cls(node, 'fork-gal-config-switch')))
  assert.deepEqual(Object.values(rows).map(node => node.props['aria-checked']), [false, false, true], 'defaults: film off, reduced motion off, protection on')
  rows['电影模式'].props.onClick(); assert.deepEqual(filmCalls, [true])
  rows['减少动态'].props.onClick(); assert.equal(api.forkStageReading.get().reducedMotion, true)
  rows['光敏保护'].props.onClick(); assert.equal(api.forkStageReading.get().photosensitive, false)
  rows = switches()
  assert.deepEqual(Object.values(rows).map(node => node.props['aria-checked']), [true, true, false])
  const tree = ui.r.render(ui.api.ForkGalConfigScreenTab)
  assert.deepEqual(walk(tree).filter(node => node.props.role === 'radiogroup').map(node => node.props['aria-label']), ['帧率上限', '特效质量'], 'multi-way choices stay segmented')
  assert.equal(walk(tree).some(node => node.props.role === 'radio' && /^[关开]$/.test(text(node))), false, 'no 关 / 开 segmented pairs left')
})

test('frame cap persists with reading prefs, rejects invalid values, and screen controls apply live', () => {
  const { api, localStorage } = readingContext()
  const ui = configContext({ useForkStageReading: api.forkStageReading.get, forkStageReading: api.forkStageReading })
  const render = () => ui.r.render(ui.api.ForkGalConfigScreenTab)
  const group = tree => walk(tree).find(node => node.props.role === 'radiogroup' && node.props['aria-label'] === '\u5e27\u7387\u4e0a\u9650')
  assert.deepEqual(walk(group(render())).filter(node => node.props.role === 'radio').map(text), ['30', '60', '120', '\u8ddf\u968f\u5c4f\u5e55'])
  for (const [index, cap] of [[0, 30], [2, 120], [3, 0], [1, 60]]) {
    walk(group(render())).filter(node => node.props.role === 'radio')[index].props.onClick()
    assert.equal(api.forkStageReading.get().frameCap, cap)
    assert.equal(walk(group(render())).filter(node => node.props.role === 'radio')[index].props['aria-checked'], true)
    assert.equal(readingContext(localStorage.map.get('fork-stage-reading')).api.forkStageReading.get().frameCap, cap)
    assert.equal(api.forkStageReading.get().textSpeed, 28)
    assert.equal(api.forkStageReading.get().autoWait, 700)
  }
  for (const frameCap of [null, '', false, '120', -1, 90, {}, NaN, Infinity]) assert.equal(api.forkStageReadingPrefs({ frameCap }).frameCap, 60)
  const tip = walk(render()).find(node => node.type === 'HelpTip' && node.props.label === '\u5e27\u7387\u4e0a\u9650\u8bf4\u660e')
  assert.match(text(tip), /GPU/)
  assert.match(text(tip), /30/)
})
