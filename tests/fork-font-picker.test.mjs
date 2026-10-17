// Private fork (docs/fork/fonts.md): the font picker (fork-font-picker.js) in the stage CONFIG 文字 tab
// (舞台字体 / 字幕字体) and on the 外观 settings page (正文字体): follow-default first, every installed font in
// its own face grouped by category, setOverride per role, null restores the default, faces load lazily.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import { forkSpinnerSource } from './helpers/fork-spinner.mjs' // private fork (UI standard phase 2 batch 4)
import { forkUiSfxStub } from './helpers/fork-ui-sfx-stub.mjs' // private fork: stage UI cues

const read = name => readFile(new URL('../tavern-plugin/' + (name === 'fork-appearance.js' ? 'packages/dsh-tavern-ui/src/' : 'src/client/') + name, import.meta.url), 'utf8')
const [fontsSource, picker, config, mixer, appearance, backgrounds, stage] = await Promise.all(['fork-fonts.js', 'fork-font-picker.js', 'fork-gal-config.js', 'fork-gal-mixer.js', 'fork-appearance.js', 'fork-stage-backgrounds.js', 'fork-gal-stage.js'].map(read))
const css = await readFile(new URL('../tavern-plugin/lib/client-assets/fork-theme.css', import.meta.url), 'utf8')
const between = (text, a, b) => { const i = text.indexOf(a), j = text.indexOf(b, i); assert.ok(i >= 0 && j > i, a); return text.slice(i, j) }
const factory = fontsSource.slice(0, fontsSource.indexOf('\nconst forkFonts =')) + '\nglobalThis.create = createForkFonts;'
const pickers = backgrounds.slice(backgrounds.indexOf('// Dialogue box style cards')) // private fork: only theme picker remains

// The installed catalogue (docs/fork/fonts.md), in the host's directory order.
const installed = [
  ['neo-xihei-screen', '霞鹜新晰黑 屏幕版', 'sans'], ['neo-zhisong-screen', '霞鹜新致宋 屏幕版', 'serif'], ['noto-sans-sc', 'Noto Sans SC', 'sans'],
  ['noto-serif-sc', 'Noto Serif SC', 'serif'], ['resource-han-rounded', 'Resource Han Rounded CN', 'rounded'], ['wenkai-screen', '霞鹜文楷 GB 屏幕版', 'hand'],
  ['xiaolai', '小赖字体 Xiaolai', 'hand'], ['zcool-kuaile', '站酷快乐体', 'display'], ['zhuque', '朱雀仿宋', 'serif']
]
const catalog = installed.map(([id, label, category]) => ({ id, label, category, family: 'Tavern ' + id, weights: [400], files: [{ weight: 400, style: 'normal', format: 'woff2', url: '/api/dsh-tavern/fonts/' + id + '/400.woff2' }] }))

// The real font framework with spies on the calls the picker makes.
function fontApi(saved = new Map()) {
  const sandbox = {}
  vm.runInNewContext(factory, sandbox)
  const doc = { head: { appendChild() {} }, createElement: () => ({ dataset: {}, appendChild() {}, remove() {} }), createTextNode: text => text }
  // private fork: built-in skins declare their stage-mode fonts in the shared skin contract (docs/fork/fonts.md).
  const { BUILTIN_STAGE_SKINS } = createRequire(import.meta.url)('../tavern-plugin/packages/dsh-presentation-protocol/src/stage-skin.cjs')
  const api = sandbox.create({ document: doc, storage: { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value), removeItem: key => saved.delete(key) }, rpc: async () => ({ fonts: catalog }),
    builtinFont: theme => BUILTIN_STAGE_SKINS[theme]?.font || null })
  const calls = { set: [], ensure: [] }
  const spy = Object.freeze({ ...api, setOverride(role, id) { calls.set.push([role, id]); api.setOverride(role, id) }, ensure(id) { calls.ensure.push(id); return api.ensure(id) } })
  return { api: spy, calls, saved }
}

// A tiny hook renderer (as in fork-gal-config.test.mjs): state persists between renders, effects run after a render.
function renderer() {
  let slots = [], cursor = 0, pending = []
  const React = {
    Fragment: 'Fragment',
    createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity).filter(item => item != null && item !== false) }),
    useState(value) { const index = cursor++; if (!(index in slots)) slots[index] = typeof value === 'function' ? value() : value; return [slots[index], next => { slots[index] = typeof next === 'function' ? next(slots[index]) : next }] },
    useRef(value) { const index = cursor++; if (!(index in slots)) slots[index] = { current: value }; return slots[index] },
    useEffect(fn, deps) {
      const index = cursor++, old = slots[index]
      if (!old || !deps || deps.some((dep, i) => !Object.is(dep, old.deps[i]))) pending.push(() => { if (old && old.cleanup) old.cleanup(); const cleanup = fn(); slots[index] = { deps, cleanup } })
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
const text = tree => tree && typeof tree === 'object' ? tree.children.map(text).join('') : String(tree ?? '')
const cls = (node, name) => (node.props.className || '').split(' ').includes(name)
function listeners() {
  const on = []
  const target = { addEventListener: (type, fn, options) => on.push({ type, fn, options }), removeEventListener: (type, fn) => { const i = on.findIndex(item => item.type === type && item.fn === fn); if (i >= 0) on.splice(i, 1) } }
  return { target, on, fire: (type, event) => on.filter(item => item.type === type).forEach(item => item.fn(event)) }
}
function event(extra = {}) { const out = { defaultPrevented: false, stopped: false, immediate: false, preventDefault() { out.defaultPrevented = true }, stopPropagation() { out.stopped = true }, stopImmediatePropagation() { out.immediate = true }, ...extra }; return out }

// The list container: the stage variant's ForkPopover stub (and the inline div) expose a fake DOM root built from
// the rendered options, so the open / visibility effects can query and observe them.
function fakeRoot(children, focused) {
  const options = walk({ type: 'div', props: {}, children }).filter(node => node.props && node.props.role === 'option')
  const nodes = options.map(node => ({ node, getAttribute: name => node.props[name], focus() { focused.push(cls(node, 'is-follow') ? 'follow' : node.props['data-font-id']) } }))
  return {
    querySelectorAll: selector => selector === '[data-font-id]' ? nodes.filter(item => item.node.props['data-font-id']) : selector === '[role="option"]' ? nodes : [],
    querySelector: selector => selector.includes('aria-selected="true"') ? nodes.find(item => item.node.props['aria-selected'] === true) || null : null,
    contains: () => false
  }
}
function pickerContext(extra = {}, more = '') {
  const r = renderer(), win = listeners(), doc = listeners(), observers = [], focused = []
  class IntersectionObserver { constructor(fn, options) { this.fn = fn; this.options = options; this.nodes = []; observers.push(this) } observe(node) { this.nodes.push(node) } disconnect() { this.nodes = []; this.off = true } }
  const ForkPopover = props => { if (props.popRef) props.popRef.current = fakeRoot(props.children, focused); const { anchor, popRef, children, ...rest } = props; return { type: 'div', props: { ...rest, className: 'fork-popover ' + props.className }, children } }
  const ctx = vm.createContext({ React: r.React, ForkIcon: 'Icon', ForkHelpTip: 'HelpTip', ForkPopover, IntersectionObserver, window: win.target, document: { ...doc.target, activeElement: null }, Promise, ...extra })
  vm.runInContext(picker + '\n;\n' + more + ';this.api={ForkFontPicker,forkFontGroups,forkFontName,FORK_FONT_SAMPLE};', ctx)
  return { r, api: ctx.api, win, doc, observers, focused, ctx }
}
const flush = () => new Promise(resolve => setTimeout(resolve, 0))
const options = tree => walk(tree).filter(node => node.props.role === 'option')
const trigger = tree => walk(tree).find(node => cls(node, 'fork-font-trigger'))

test('font picker: 跟随样式（default） first, then every installed font by category, each in its own face', async () => {
  const fonts = fontApi(), p = pickerContext()
  const props = { role: 'stage', label: '舞台字体', follow: '跟随样式', context: { theme: 'gothic' }, theme: 'gothic', variant: 'stage', api: fonts.api }
  p.r.render(p.api.ForkFontPicker, props); await flush()
  let tree = p.r.render(p.api.ForkFontPicker, props)
  assert.equal(walk(tree).some(node => node.props.role === 'listbox'), false, 'closed at first')
  assert.equal(text(walk(trigger(tree)).find(node => cls(node, 'fork-font-trigger-name'))), '霞鹜新致宋', 'the trigger shows the resolved font')
  assert.equal(text(walk(trigger(tree)).find(node => cls(node, 'fork-font-trigger-tag'))), '跟随样式')
  assert.match(walk(trigger(tree)).find(node => cls(node, 'fork-font-trigger-name')).props.style.fontFamily, /^"Tavern neo-zhisong-screen", serif$/, 'drawn in its own face')
  trigger(tree).props.onClick()
  tree = p.r.render(p.api.ForkFontPicker, props)
  const list = walk(tree).find(node => node.props.role === 'listbox')
  assert.equal(list.props['aria-label'], '舞台字体')
  const opts = options(tree)
  assert.equal(opts.length, 1 + catalog.length, 'the follow option plus every installed font')
  assert.ok(cls(opts[0], 'is-follow'))
  assert.equal(text(walk(opts[0]).find(node => cls(node, 'fork-font-option-name'))), '跟随样式（霞鹜新致宋）')
  assert.equal(opts[0].props['aria-selected'], true, 'following is the current choice')
  assert.deepEqual(walk(list).filter(node => cls(node, 'fork-font-group')).map(node => node.props['aria-label']), ['黑体', '圆体', '宋体 · 仿宋', '楷体 · 手写', '趣味'])
  assert.deepEqual(opts.slice(1).map(node => node.props['data-font-id']), ['neo-xihei-screen', 'noto-sans-sc', 'resource-han-rounded', 'neo-zhisong-screen', 'noto-serif-sc', 'zhuque', 'wenkai-screen', 'xiaolai', 'zcool-kuaile'])
  assert.deepEqual(opts.slice(1).map(node => text(walk(node).find(child => cls(child, 'fork-font-option-name')))), ['霞鹜新晰黑', 'Noto Sans SC', '源圆黑体', '霞鹜新致宋', 'Noto Serif SC', '朱雀仿宋', '霞鹜文楷', '小赖', '站酷快乐体'])
  for (const node of opts) {
    assert.equal(text(walk(node).find(child => cls(child, 'fork-font-option-sample'))), '……你、你还有什么事。')
    assert.equal(node.props.style.fontFamily.split(',')[0], JSON.stringify('Tavern ' + node.props['data-font-id'] || ''))
  }
  // The stage list is portaled to <body> and re-derives the stage's tokens for its theme.
  const pop = walk(tree).find(node => cls(node, 'fork-font-pop'))
  assert.ok(cls(pop, 'fork-gal-theme-scope') && cls(pop, 'is-stage')); assert.equal(pop.props['data-theme'], 'gothic')
  // The resolved default name follows the theme; the film role follows 新晰黑 in every theme.
  for (const [role, theme, name] of [['stage', 'classic', '霞鹜新晰黑'], ['stage', 'magical', '源圆黑体'], ['film', 'gothic', '霞鹜新晰黑'], ['film', 'magical', '霞鹜新晰黑'], ['stage', 'unknown', '内置字体']]) {
    const q = pickerContext(), next = { ...props, role, context: { theme }, theme }
    q.r.render(q.api.ForkFontPicker, next); await flush()
    trigger(q.r.render(q.api.ForkFontPicker, next)).props.onClick()
    assert.equal(text(walk(options(q.r.render(q.api.ForkFontPicker, next))[0]).find(node => cls(node, 'fork-font-option-name'))), '跟随样式（' + name + '）', role + ' / ' + theme)
  }
})

test('font picker: a choice sets the role\'s override at once; 跟随… sets null and restores the default', async () => {
  for (const [role, context, follow, fallback] of [['stage', { theme: 'magical' }, '跟随样式', 'resource-han-rounded'], ['film', { theme: 'classic' }, '跟随样式', 'neo-xihei-screen'], ['reading', { skinFont: 'wenkai-screen' }, '跟随皮肤', 'wenkai-screen']]) {
    const fonts = fontApi(), p = pickerContext()
    const props = { role, label: role, follow, context, theme: context.theme, variant: role === 'reading' ? 'settings' : 'stage', api: fonts.api }
    p.r.render(p.api.ForkFontPicker, props); await flush()
    trigger(p.r.render(p.api.ForkFontPicker, props)).props.onClick()
    let tree = p.r.render(p.api.ForkFontPicker, props)
    options(tree).find(node => node.props['data-font-id'] === 'xiaolai').props.onClick()
    assert.deepEqual(fonts.calls.set, [[role, 'xiaolai']], role + ' override')
    assert.equal(fonts.saved.get('dsh-tavern-font-' + role), 'xiaolai', 'persisted per machine')
    assert.equal(fonts.api.resolve(role, context).id, 'xiaolai')
    tree = p.r.render(p.api.ForkFontPicker, props)
    assert.equal(walk(tree).some(node => node.props.role === 'listbox'), false, 'a choice closes the list')
    assert.equal(text(walk(trigger(tree)).find(node => cls(node, 'fork-font-trigger-name'))), '小赖')
    assert.equal(walk(trigger(tree)).some(node => cls(node, 'fork-font-trigger-tag')), false, 'no follow tag with an override')
    trigger(tree).props.onClick()
    tree = p.r.render(p.api.ForkFontPicker, props)
    assert.deepEqual(options(tree).filter(node => node.props['aria-selected']).map(node => node.props['data-font-id']), ['xiaolai'], 'the current choice is highlighted')
    assert.ok(walk(options(tree).find(node => node.props['data-font-id'] === 'xiaolai')).some(node => cls(node, 'fork-font-option-check')))
    options(tree)[0].props.onClick()
    assert.deepEqual(fonts.calls.set[1], [role, null], 'follow = null')
    assert.equal(fonts.saved.has('dsh-tavern-font-' + role), false)
    assert.equal(fonts.api.resolve(role, context).id, fallback, role + ' default restored')
    assert.notEqual(fonts.api.resolve(role, context).source, 'override')
  }
  // Reading without a skin font follows the UI font.
  const fonts = fontApi(), p = pickerContext()
  const props = { role: 'reading', label: '正文字体', follow: '跟随皮肤', builtin: '界面字体', context: { skinFont: null }, variant: 'settings', api: fonts.api }
  p.r.render(p.api.ForkFontPicker, props); await flush()
  let tree = p.r.render(p.api.ForkFontPicker, props)
  assert.equal(text(walk(trigger(tree)).find(node => cls(node, 'fork-font-trigger-name'))), '界面字体')
  trigger(tree).props.onClick()
  tree = p.r.render(p.api.ForkFontPicker, props)
  assert.equal(text(walk(options(tree)[0]).find(node => cls(node, 'fork-font-option-name'))), '跟随皮肤（界面字体）')
  assert.ok(cls(walk(tree).find(node => cls(node, 'fork-font-pop')), 'is-inline'), 'settings list stays inline (inside the host dialog)')
})

test('font picker: 「跟随样式」 names the active stage skin\'s font and updates when the skin switches', async () => {
  const fonts = fontApi()
  for (const [role, first, second] of [['stage', '朱雀仿宋', '源圆黑体'], ['film', '小赖', '源圆黑体']]) {
    // fork-fonts.js sets this context from the active stage root (data-fk-fonts).
    fonts.api.setContext({ theme: 'classic', skin: { body: 'zhuque', film: 'xiaolai' } })
    const p = pickerContext(), props = { role, label: role, follow: '跟随样式', theme: 'classic', variant: 'stage', api: fonts.api }
    p.r.render(p.api.ForkFontPicker, props); await flush()
    trigger(p.r.render(p.api.ForkFontPicker, props)).props.onClick()
    const follow = () => text(walk(options(p.r.render(p.api.ForkFontPicker, props))[0]).find(node => cls(node, 'fork-font-option-name')))
    assert.equal(follow(), '跟随样式（' + first + '）', role + ' / both fonts declared')
    // A stage-only skin: the subtitle falls back to its stage font.
    fonts.api.setContext({ theme: 'classic', skin: { body: 'resource-han-rounded' } })
    assert.equal(follow(), '跟随样式（' + second + '）', role + ' / stage-only skin')
    assert.equal(text(walk(trigger(p.r.render(p.api.ForkFontPicker, props))).find(node => cls(node, 'fork-font-trigger-name'))), second)
  }
})

test('font picker: faces load lazily — current face only while closed, then visible or hovered options', async () => {
  const fonts = fontApi(), p = pickerContext()
  const props = { role: 'stage', label: '舞台字体', follow: '跟随样式', context: { theme: 'classic' }, theme: 'classic', variant: 'stage', api: fonts.api }
  p.r.render(p.api.ForkFontPicker, props); await flush()
  let tree = p.r.render(p.api.ForkFontPicker, props)
  assert.deepEqual([...new Set(fonts.calls.ensure)], ['neo-xihei-screen'], 'closed: only the trigger face')
  assert.equal(p.observers.length, 0)
  trigger(tree).props.onClick()
  tree = p.r.render(p.api.ForkFontPicker, props)
  assert.equal(p.observers.length, 1, 'observes the options once open')
  const observer = p.observers[0]
  assert.equal(observer.nodes.length, catalog.length + 1, 'every option with a face (the follow option shows the default)')
  assert.deepEqual(p.focused, ['follow'], 'focus moves to the current option')
  // Only options that become visible register their family.
  const visible = observer.nodes.filter(node => ['zhuque', 'zcool-kuaile'].includes(node.getAttribute('data-font-id')))
  observer.fn([...visible.map(target => ({ target, isIntersecting: true })), { target: observer.nodes.find(node => node.getAttribute('data-font-id') === 'xiaolai'), isIntersecting: false }])
  assert.deepEqual([...new Set(fonts.calls.ensure)], ['neo-xihei-screen', 'zhuque', 'zcool-kuaile'])
  // Hover and keyboard focus load the face too.
  options(tree).find(node => node.props['data-font-id'] === 'wenkai-screen').props.onPointerEnter()
  options(tree).find(node => node.props['data-font-id'] === 'noto-serif-sc').props.onFocus()
  assert.deepEqual([...new Set(fonts.calls.ensure)], ['neo-xihei-screen', 'zhuque', 'zcool-kuaile', 'wenkai-screen', 'noto-serif-sc'])
  await flush()
  // Esc (window capture) closes the list before anything else sees it; the observer and listeners go away.
  const esc = event({ key: 'Escape' })
  p.win.fire('keydown', esc)
  assert.equal(esc.immediate, true); assert.equal(esc.defaultPrevented, true)
  tree = p.r.render(p.api.ForkFontPicker, props)
  assert.equal(walk(tree).some(node => node.props.role === 'listbox'), false)
  assert.equal(observer.off, true)
  assert.equal(p.win.on.filter(item => item.type === 'keydown').length, 0)
  assert.equal(p.doc.on.filter(item => item.type === 'pointerdown').length, 0)
  // Tab from the list closes it (focus goes back to the trigger) and never reaches the CONFIG focus trap.
  trigger(tree).props.onClick()
  tree = p.r.render(p.api.ForkFontPicker, props)
  const tab = event({ key: 'Tab' })
  walk(tree).find(node => node.props.role === 'listbox').props.onKeyDown(tab)
  assert.equal(tab.stopped, true); assert.equal(tab.defaultPrevented, true)
  assert.equal(walk(p.r.render(p.api.ForkFontPicker, props)).some(node => node.props.role === 'listbox'), false)
})

function configContext(fonts) {
  const r = renderer(), win = listeners(), doc = listeners()
  const ForkPopover = props => ({ type: 'div', props: { className: 'fork-popover ' + props.className, 'data-theme': props['data-theme'] }, children: props.children })
  const ctx = vm.createContext({ React: r.React, ForkIcon: 'Icon', ForkHelpTip: 'HelpTip', ForkPopover, FORK_ICON_PATHS: {}, window: win.target, document: { ...doc.target, activeElement: null }, forkFonts: fonts.api, Promise,
    useForkAutoChoicesPreference: () => ({ enabled: false, loading: false, busy: false, error: '', save() {} }),
    useForkStageAudioState: () => ({ master: 0.8, voice: 0.8, music: 0.8, sfx: 0.8, ambience: 0.8, muted: {} }), forkStageAudio: { setVolume() {}, toggleMute() {} },
    useForkStageFilm: () => false, useForkStageQuality: () => 'high', forkStageFilm: { set() {} }, forkStageQuality: { set() {} },
    useForkStageReading: () => ({ textSpeed: 28, autoWait: 700, autoSpeed: 1.3, voiceRate: 1 }), forkStageReading: { set() {} }, FORK_STAGE_READING_DEFAULTS: { textSpeed: 28, autoWait: 700, autoSpeed: 1.3 }, FORK_STAGE_READING_LIMITS: { textSpeed: [0, 80, 2], autoWait: [0, 3000, 100], voiceRate: [0.8, 2, 0.1] },
    ForkGalTypewriter: 'Typewriter', forkGalAutoDelay: () => 1600, forkBubbleStore: { get: () => null, set() {} }, setTimeout, clearTimeout, ...forkUiSfxStub() })
  vm.runInContext(forkSpinnerSource + '\n;\n' + pickers + '\n;\n' + mixer + '\n;\n' + picker + '\n;\n' + config + ';this.api={ForkGalConfigScreen,ForkGalConfigText};', ctx) // private fork: + fork-inline-field.js (ForkSlider)
  return { r, api: ctx.api, win }
}

test('CONFIG 文字: 舞台字体 and 字幕字体 rows with pickers; the preview uses the stage font and adds a subtitle line', async () => {
  assert.match(config, /^\/\/ @include fork-font-picker\.js$/m, 'the picker is bundled with the Config screen')
  const fonts = fontApi(), c = configContext(fonts)
  fonts.api.setContext({ theme: 'magical' }) // fork-fonts.js: the active stage is the magical built-in skin
  const props = { sessionId: 's', data: { config: { stage: { theme: 'magical' } } } }
  c.r.render(c.api.ForkGalConfigText, props); await flush()
  const tree = c.r.render(c.api.ForkGalConfigText, props)
  const groups = walk(tree).filter(node => cls(node, 'fork-gal-config-group'))
  // private fork (owner 2026-10 global-first): groups for every card first, the 本卡 group last (选项 moved to 舞台设置 › 基础设置).
  assert.deepEqual(groups.map(group => text(walk(group).find(node => cls(node, 'fork-gal-config-caption')).children[0])), ['阅读', '字体', '本卡'])
  const rows = walk(groups[1]).filter(node => cls(node, 'fork-gal-config-row'))
  assert.deepEqual(rows.map(row => text(walk(row).find(node => cls(node, 'fork-gal-config-label')).children[0])), ['舞台字体', '字幕字体'])
  assert.ok(rows.every(row => walk(row).some(node => node.type === 'HelpTip')), 'each row explains itself with a ? tip')
  const pickersIn = rows.map(row => walk(row).find(node => cls(node, 'fork-font-pick')))
  assert.deepEqual(pickersIn.map(node => node.props['data-role']), ['stage', 'film'])
  assert.ok(pickersIn.every(node => cls(node, 'is-stage')))
  assert.deepEqual(rows.map(row => text(walk(row).find(node => cls(node, 'fork-font-trigger-name')))), ['源圆黑体', '霞鹜新晰黑'], 'the magical defaults')
  // Opening the stage picker lists 跟随样式 with the theme's default, then the fonts; the list carries the theme.
  walk(rows[0]).find(node => cls(node, 'fork-font-trigger')).props.onClick()
  const open = c.r.render(c.api.ForkGalConfigText, props)
  const pop = walk(open).find(node => cls(node, 'fork-font-pop'))
  assert.equal(pop.props['data-theme'], 'magical')
  assert.equal(text(walk(options(pop)[0]).find(node => cls(node, 'fork-font-option-name'))), '跟随样式（源圆黑体）')
  options(pop).find(node => node.props['data-font-id'] === 'zhuque').props.onClick()
  assert.deepEqual(fonts.calls.set, [['stage', 'zhuque']])
  // The live preview sits under the font rows: a typed line (stage font) and a still subtitle line (film font).
  const preview = walk(groups[1]).find(node => cls(node, 'fork-gal-config-preview'))
  assert.ok(preview, 'preview follows the font rows')
  assert.equal(walk(groups[0]).some(node => cls(node, 'fork-gal-config-preview')), false)
  assert.ok(walk(preview).some(node => node.type === 'Typewriter'))
  assert.match(text(walk(preview).find(node => cls(node, 'fork-gal-config-preview-film'))), /字幕.*可以一起回去吗/)
  const block = between(css, '/* ==== font picker (fork-font-picker.js', '/* ==== end font picker ==== */')
  assert.match(block, /\.fork-gal-config-preview-text \{ font-family: var\(--gal-ui-font\); \}/)
  // The 字幕 sample reads the same film subtitle tokens as the in-stage subtitle, not a copy that can drift from it.
  const look = 'color: var(--film-text-ink); font: var(--film-text); letter-spacing: var(--film-text-spacing); text-shadow: var(--film-text-shadow);'
  const real = css.match(/^\.fork-gal-stage\.is-film\[data-theme\] \.fork-gal-text \{[^}]*\}/m)
  assert.ok(real && real[0].includes(look), 'the stage subtitle reads the film tokens')
  const sample = block.match(/\.fork-gal-config-preview-film > p \{[^}]*\}/)
  assert.ok(sample && sample[0].includes(look), 'the preview reads the same film tokens')
  assert.match(css, /--film-text: normal 400 var\(--film-font-size\)\/1\.7 var\(--gal-film-font/)
  assert.match(block, /\.fork-gal-config-preview-film \{[^}]*background: var\(--film-bar-color\)/)
})

test('CONFIG: Esc inside an open font picker closes the picker, not the screen; the stage list uses only tokens', async () => {
  const fonts = fontApi(), c = configContext(fonts), closed = []
  const props = { sessionId: 's', data: { config: { stage: { theme: 'classic' } } }, names: {}, tests: {}, onClose: () => closed.push(true) }
  c.r.render(c.api.ForkGalConfigScreen, props)
  // private fork: the same guard also lets the CONFIG skin select take Esc first.
  for (const selector of ['.fork-font-pick.is-open, .fork-font-pop, .fork-gal-skin-pick.is-open, .fork-gal-skin-pop'])
    c.win.fire('keydown', event({ key: 'Escape', target: { closest: value => value === selector ? {} : null } }))
  assert.equal(closed.length, 0)
  c.win.fire('keydown', event({ key: 'Escape', target: { closest: () => null } }))
  assert.equal(closed.length, 1)
  // Stage variant rules: tokens only, no theme branches; the portaled list sits above the stage and is opaque.
  const block = between(css, '/* ==== font picker (fork-font-picker.js', '/* ==== end font picker ==== */')
  const stageRules = [...block.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m => ({ selector: m[1].trim(), body: m[2] })).filter(rule => /is-stage/.test(rule.selector))
  assert.ok(stageRules.length > 8)
  for (const rule of stageRules) {
    assert.doesNotMatch(rule.selector, /data-theme/, rule.selector)
    assert.doesNotMatch(rule.body, /#[0-9a-f]{3,8}\b|rgba?\(|--fork-/i, rule.selector + ' uses --gal-ui-* only')
  }
  assert.match(block, /\.fork-popover\.fork-font-pop\.is-stage \{[^}]*background: var\(--gal-ui-surface-2\)/, 'opaque surface')
  assert.match(block, /\[data-fork-gal-stage\] \.fork-popover\.fork-font-pop \{ z-index: 2147483002; \}/)
  assert.match(block, /\.fork-font-pop\.is-inline \{[^}]*Canvas/, 'the settings list is opaque under a translucent skin')
})

test('外观: 正文字体 sits under the skin picker, follows the active skin, with a ? tip', async () => {
  const fonts = fontApi(), registered = []
  const p = pickerContext({ forkFonts: fonts.api }, appearance + ';this.appearance={installForkAppearance,ForkReadingFontRow};')
  p.ctx.window.__dshDreamSkin = { readingFont: () => 'wenkai-screen' }
  const ctx = p.ctx
  const host = {
    theme: { getTheme: () => snapshot, setTheme() {} },
    on: () => () => {},
    slots: {
      inject: (name, fn) => fn(),
      register: (entry, component) => { registered.push({ entry, component }); return () => {} }
    }
  }
  const snapshot = { active: { id: 'rose' }, preference: 'light' }
  ctx.appearance.installForkAppearance(host)
  const row = registered.find(item => item.entry.id === 'fork-reading-font')
  assert.ok(row, 'registered on the 外观 page')
  assert.equal(row.entry.name, 'settings.dreamSkin.item'); assert.equal(row.entry.order, 21, 'right after the skin cards (order 20)')
  const injected = row.entry.inject()
  p.r.render(row.component, injected); await flush()
  let tree = p.r.render(row.component, injected)
  const title = walk(tree).find(node => cls(node, 'fork-reading-font-title'))
  assert.match(text(title), /^正文字体/)
  const tip = walk(title).find(node => node.type === 'HelpTip')
  assert.ok(tip, '? tip instead of hint text'); assert.match(text(tip), /故事正文/)
  assert.equal(walk(tree).some(node => /desc|hint/.test(node.props.className || '')), false, 'no grey description line')
  const pick = walk(tree).find(node => cls(node, 'fork-font-pick'))
  assert.equal(pick.props['data-role'], 'reading'); assert.ok(cls(pick, 'is-settings'))
  assert.equal(text(walk(tree).find(node => cls(node, 'fork-font-trigger-name'))), '霞鹜文楷', 'the skin font')
  trigger(tree).props.onClick()
  tree = p.r.render(row.component, injected)
  assert.equal(text(walk(options(tree)[0]).find(node => cls(node, 'fork-font-option-name'))), '跟随皮肤（霞鹜文楷）')
  options(tree).find(node => node.props['data-font-id'] === 'neo-zhisong-screen').props.onClick()
  assert.deepEqual(fonts.calls.set, [['reading', 'neo-zhisong-screen']])
})
