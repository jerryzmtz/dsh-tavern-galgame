// Private fork (docs/fork/galgame-stage.md「系统菜单」): the stage's system menu (fork-gal-menu.js) — items and their
// order, the conditional 「跳到最新一轮」, keyboard (roving focus, trapped Tab, Enter / Space, Esc), focus in and back,
// pointer closing, and the token-only 「stage system menu」 CSS block. The stage wiring (Esc routing, pausing, the
// leave path, the latest-turn jump) is exercised on the real stage in fork-gal-continuity.test.mjs.
import test from 'node:test'
import { forkUiSfxStub } from './helpers/fork-ui-sfx-stub.mjs' // private fork: stage UI cues
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const source = await readFile(new URL('../tavern-plugin/src/client/fork-gal-menu.js', import.meta.url), 'utf8')
const stage = await readFile(new URL('../tavern-plugin/src/client/fork-gal-stage.js', import.meta.url), 'utf8')
const css = await readFile(new URL('../tavern-plugin/lib/client-assets/fork-theme.css', import.meta.url), 'utf8')
const plain = value => JSON.parse(JSON.stringify(value))

function harness(extra = {}) {
  let slots = [], cursor = 0, pending = [], tree = null
  const listeners = []
  const document = { activeElement: null }
  const opener = { name: 'stage-root', isConnected: true, focus() { document.activeElement = this } }
  opener.focus()
  const elements = new Map()
  const element = key => { if (!elements.has(key)) elements.set(key, { key, isConnected: true, focus() { document.activeElement = this } }); return elements.get(key) }
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity).filter(item => item != null && item !== false) }),
    useState(value) { const i = cursor++; if (!(i in slots)) slots[i] = typeof value === 'function' ? value() : value; return [slots[i], next => { slots[i] = typeof next === 'function' ? next(slots[i]) : next }] },
    useRef(value) { const i = cursor++; if (!(i in slots)) slots[i] = { current: value }; return slots[i] },
    // private fork: menu availability subscribes to the existing director runtime.
    useMemo(fn, deps) { const i = cursor++, old = slots[i]; if (!old || deps.some((dep, n) => !Object.is(dep, old.deps[n]))) slots[i] = {deps, value: fn()}; return slots[i].value },
    useSyncExternalStore(_subscribe, getSnapshot) { return getSnapshot() },
    useEffect(fn, deps) {
      const i = cursor++, old = slots[i]
      if (!old || !deps || deps.some((dep, n) => !Object.is(dep, old.deps[n]))) pending.push(() => { if (old && old.cleanup) old.cleanup(); slots[i] = { deps, cleanup: fn() } })
      else slots[i] = old
    }
  }
  React.useLayoutEffect = React.useEffect
  const window = {
    addEventListener: (type, fn, capture) => listeners.push({ type, fn, capture }),
    removeEventListener: (type, fn) => { const i = listeners.findIndex(item => item.type === type && item.fn === fn); if (i >= 0) listeners.splice(i, 1) }
  }
  const cues = []
  const ctx = vm.createContext({ React, window, document, forkStageSessions: {get: () => null}, ...forkUiSfxStub(cues) })
  vm.runInContext(source + ';this.api={forkGalMenuItems,forkGalMenuStep,ForkGalMenu};', ctx)
  const calls = []
  const props = { historical: false, latestTurn: 64, ...extra }
  for (const name of ['onClose', 'onBacklog', 'onGallery', 'onConfig', 'onLatest', 'onLeave', 'onHide', 'onBack']) props[name] = () => calls.push(name)
  const walk = node => node && typeof node === 'object' ? [node, ...node.children.flatMap(walk)] : []
  function render() {
    cursor = 0; pending = []
    tree = ctx.api.ForkGalMenu(props)
    for (const node of walk(tree)) if (typeof node.props.ref === 'function') node.props.ref(element(node.props['data-item']))
    const run = pending; pending = []
    run.forEach(fn => fn())
    return tree
  }
  function unmount() { slots.forEach(slot => slot && slot.cleanup && slot.cleanup()) }
  function key(name, more = {}) {
    const event = { key: name, shiftKey: false, defaultPrevented: false, immediate: false, target: document.activeElement,
      preventDefault() { event.defaultPrevented = true }, stopImmediatePropagation() { event.immediate = true }, ...more }
    listeners.filter(item => item.type === 'keydown' && item.capture).forEach(item => item.fn(event))
    render()
    return event
  }
  const items = () => walk(tree).filter(node => node.props.role === 'menuitem')
  const focused = () => document.activeElement && document.activeElement.key
  return { api: ctx.api, props, calls, cues, render, unmount, key, items, focused, document, opener, listeners, walk: () => walk(tree), element }
}
const text = node => node && typeof node === 'object' ? node.children.map(text).join('') : String(node ?? '')

test('menu items: 回到舞台, 履历, 回想, 设置, (跳到最新一轮 only on an earlier turn), a divider, 返回主页面 last', () => {
  const { api } = harness()
  // private fork: the low-frequency regeneration entry precedes config on the latest turn only.
  // private fork (owner 2026-10): 回想 (the CG gallery) sits between 履历 and 重新生成.
  assert.deepEqual(plain(api.forkGalMenuItems({ historical: false }).map(item => item.label)), ['回到舞台', '履历', '回想', '重新生成', '设置', '快捷键', '返回主页面']) // private fork (B2 O43): 快捷键 re-shows the key list
  assert.deepEqual(plain(api.forkGalMenuItems({ historical: false })[2]), { id: 'gallery', label: '回想', sub: 'RECOLLECTION', title: '回想（CG 图库）' })
  const historical = api.forkGalMenuItems({ historical: true, latestTurn: 64 })
  assert.deepEqual(plain(historical.map(item => item.id)), ['resume', 'backlog', 'gallery', 'config', 'keys', 'latest', 'leave'])
  assert.equal(historical[5].label, '跳到最新一轮')
  assert.equal(historical[5].note, '第 64 轮')
  assert.equal(historical[6].separated, true)
  const h = harness({ historical: true })
  const tree = h.render()
  const panel = h.walk().find(node => node.props.role === 'menu')
  assert.equal(panel.props['aria-label'], '舞台菜单')
  assert.equal(panel.props['aria-orientation'], 'vertical')
  const rendered = h.walk().filter(node => node.props.role === 'menuitem' || node.props.role === 'separator')
  assert.deepEqual(rendered.map(node => node.props.role === 'separator' ? '—' : text(node.children.find(child => child.type === 'b'))), ['回到舞台', '履历', '回想', '设置', '快捷键', '跳到最新一轮', '—', '返回主页面'])
  assert.ok(rendered.every(node => node.props.role === 'separator' || node.type === 'button'))
  assert.equal(tree.props.className, 'fork-gal-menu')
  const latest = harness({ historical: false }); latest.render()
  assert.equal(latest.items().some(node => node.props['data-item'] === 'latest'), false, 'no latest item on the latest turn')
})

// private fork (reading controls §2.4, owner 2026-10): on phones the control row keeps 自动 / 跳过 / 履历 / ≡; the menu
// carries the rest (隐藏文本框, 上一页 added; 设置 and 返回主页面 already there). Wide screens: unchanged list.
test('narrow menu: hide and previous page join the menu, wide menu unchanged', () => {
  const { api } = harness()
  assert.deepEqual(plain(api.forkGalMenuItems({ historical: false, narrow: true }).map(item => item.id)), ['resume', 'backlog', 'gallery', 'regenerate', 'hide', 'back', 'config', 'keys', 'leave'])
  assert.equal(api.forkGalMenuItems({ narrow: true, backDisabled: true }).find(item => item.id === 'back').disabled, true)
  assert.deepEqual(plain(api.forkGalMenuItems({ historical: false }).map(item => item.id)), ['resume', 'backlog', 'gallery', 'regenerate', 'config', 'keys', 'leave'])
  const h = harness({ narrow: true })
  h.render()
  const press = id => { const index = h.items().findIndex(node => node.props['data-item'] === id); h.items()[index].props.onClick({ stopPropagation() {} }) }
  press('hide'); press('back')
  assert.deepEqual(h.calls, ['onHide', 'onBack'])
  // Hiding hands focus to the stage (the opener sits in the hidden box), so closing does not restore it.
  h.document.activeElement = null; h.unmount()
  assert.ok(h.document.activeElement === null)
  const blocked = harness({ narrow: true, backDisabled: true }); blocked.render()
  blocked.items().find(node => node.props['data-item'] === 'back').props.onClick({ stopPropagation() {} })
  assert.deepEqual(blocked.calls, [])
})

test('menu keyboard: focus moves in, arrows / Home / End / Tab stay inside, Enter and Space activate, Esc closes', () => {
  const h = harness({ historical: true })
  h.render()
  assert.equal(h.focused(), 'resume', 'focus moves to the first item on open')
  assert.equal(h.items()[0].props.tabIndex, 0)
  assert.ok(h.items().slice(1).every(node => node.props.tabIndex === -1), 'roving tabindex')
  let event = h.key('ArrowDown')
  assert.equal(h.focused(), 'backlog'); assert.equal(event.defaultPrevented, true); assert.equal(event.immediate, true, 'the stage never sees it')
  assert.match(h.items()[1].props.className, /is-active/)
  h.key('ArrowUp'); h.key('ArrowUp')
  assert.equal(h.focused(), 'leave', 'arrows wrap')
  h.key('Home'); assert.equal(h.focused(), 'resume')
  h.key('End'); assert.equal(h.focused(), 'leave')
  // Tab is trapped: it cycles through the items instead of leaving the menu.
  event = h.key('Tab'); assert.equal(h.focused(), 'resume'); assert.equal(event.defaultPrevented, true)
  h.key('Tab', { shiftKey: true }); assert.equal(h.focused(), 'leave')
  // Enter / Space activate the focused item (not the page); the default click is suppressed.
  h.key('ArrowUp')
  assert.equal(h.focused(), 'latest')
  event = h.key('Enter')
  assert.deepEqual(h.calls, ['onLatest']); assert.equal(event.defaultPrevented, true); assert.equal(event.immediate, true)
  h.key('Home'); h.key('ArrowDown'); h.key(' ')
  assert.deepEqual(h.calls, ['onLatest', 'onBacklog'])
  h.key('ArrowDown'); h.key('Enter', { repeat: true })
  assert.deepEqual(h.calls, ['onLatest', 'onBacklog'], 'a held key does not activate')
  // private fork (owner 2026-10): 回想 opens the CG gallery from the menu.
  assert.equal(h.focused(), 'gallery')
  h.key('Enter'); assert.deepEqual(h.calls, ['onLatest', 'onBacklog', 'onGallery'])
  h.key('ArrowDown'); h.key('Enter'); assert.deepEqual(h.calls, ['onLatest', 'onBacklog', 'onGallery', 'onConfig'])
  h.key('Home'); h.key('Enter'); assert.deepEqual(h.calls.at(-1), 'onClose', '回到舞台 closes the menu')
  event = h.key('Escape')
  assert.equal(h.calls.at(-1), 'onClose'); assert.equal(event.immediate, true)
  // Other keys pass through untouched (the stage ignores them while the menu is open).
  event = h.key('x'); assert.equal(event.defaultPrevented, false)
  assert.equal(h.key('Escape', { isComposing: true }).defaultPrevented, false, 'IME composition keeps its Esc')
})

test('menu focus returns to the opener on close, but not when leaving the stage; listeners are released', () => {
  const h = harness()
  h.render()
  assert.equal(h.focused(), 'resume')
  h.unmount()
  assert.ok(h.document.activeElement === h.opener, 'focus goes back to the stage')
  assert.equal(h.listeners.length, 0)
  const leave = harness()
  leave.render()
  leave.key('End'); leave.key('Enter')
  assert.deepEqual(leave.calls, ['onLeave'])
  leave.unmount()
  assert.ok(leave.document.activeElement !== leave.opener, 'leaving restores the stage\'s own opener instead')
})

test('menu pointer: items activate on click, hovering moves the highlight, the dimmed stage and right click close it', () => {
  const h = harness()
  const tree = h.render()
  const stop = () => { const e = { stopped: false, stopPropagation() { e.stopped = true }, preventDefault() { e.prevented = true } }; return e }
  let event = stop()
  // private fork: 回想 (2) and regeneration (3) precede config on the latest turn.
  h.items()[2].props.onClick(stop()); assert.deepEqual(h.calls, ['onGallery']); h.calls.length = 0
  h.items()[4].props.onClick(event)
  assert.deepEqual(h.calls, ['onConfig']); assert.equal(event.stopped, true, 'the click does not reach the stage')
  h.items()[1].props.onPointerMove(); h.render()
  assert.equal(h.focused(), 'backlog'); assert.match(h.items()[1].props.className, /is-active/)
  // A click inside the panel does nothing; a click on the dimmed stage closes.
  event = stop(); event.target = {}; event.currentTarget = tree
  h.walk().find(node => node.props.role === 'menu').props.onClick(event)
  assert.equal(event.stopped, true); assert.deepEqual(h.calls, ['onConfig'])
  event = stop(); event.target = tree; event.currentTarget = tree
  tree.props.onClick(event)
  assert.deepEqual(h.calls, ['onConfig', 'onClose']); assert.equal(event.stopped, true, 'and does not turn the page')
  event = stop(); tree.props.onContextMenu(event)
  assert.deepEqual(h.calls, ['onConfig', 'onClose', 'onClose']); assert.equal(event.prevented, true)
  event = stop(); tree.props.onWheel(event); assert.equal(event.stopped, true, 'the wheel neither pages nor opens the backlog')
  assert.equal(h.api.forkGalMenuStep(0, 0, 'ArrowDown'), null)
  assert.equal(h.api.forkGalMenuStep(9, 4, 'ArrowDown'), 1, 'an out-of-range index starts from the first item')
})

// private fork (docs/fork/panel-ui-design.md「界面音效」): galgame cues — open on mount, a tick per user move (not the
// programmatic first focus), confirm on an item, close for 回到舞台 / Esc / the dimmed stage.
test('menu cues: open, move on arrows and hover, confirm on items, close on resume / Esc / backdrop', () => {
  const h = harness()
  const tree = h.render()
  assert.deepEqual(h.cues, ['open'])
  h.key('ArrowDown'); h.items()[4].props.onPointerMove(); h.render(); h.items()[4].props.onPointerMove() // private fork: config
  assert.deepEqual(h.cues, ['open', 'move', 'move'], 'hovering the active item again is silent')
  h.key('Enter'); assert.deepEqual(h.cues.slice(3), ['confirm'])
  h.key('Home'); h.key('Enter'); assert.equal(h.cues.at(-1), 'close', '回到舞台 closes')
  h.key('Escape'); assert.equal(h.cues.at(-1), 'close')
  const e = { stopPropagation() {}, preventDefault() {}, target: tree, currentTarget: tree }
  h.cues.length = 0; tree.props.onClick(e); tree.props.onContextMenu(e)
  assert.deepEqual(h.cues, ['close', 'close'])
})

test('stage wiring and hints: Esc opens the menu, chat / ✕ buttons and the header say 返回主页面 / Esc 打开菜单', () => {
  const body = stage.slice(stage.indexOf('function ForkGalStage(props)'), stage.indexOf('// Name plate of the text box', stage.indexOf('function ForkGalStage(props)')) // private fork: locate the end after the component
)
  assert.match(stage, /^\/\/ @include fork-gal-menu\.js$/m)
  assert.match(body, /menuOpen \? h\(ForkGalMenu, /)
  assert.doesNotMatch(body, /props\.onExit\(\);\s*\}\s*else if \(event\.key === "h"/, 'Esc no longer calls the leave path')
  assert.match(body, /control\("chat", "返回主页面", props\.onExit\)/)
  assert.match(body, /className: "fork-gal-quit", title: "返回主页面", "aria-label": "返回主页面"/)
  assert.match(stage, /title: "进入舞台模式（F12 切换，Esc 打开菜单）"/)
  assert.doesNotMatch(stage, /Esc 退出|退出舞台（Esc）|"回到聊天"/)
  // private fork (owner 2026-10): no 回想 text button in either control row; the menu item opens the same gallery.
  const rows = [between(body, 'h("div", { className: "fork-gal-controls"', 'control("chat"'), between(body, "'fork-widget-source-controls'", "control('chat'")]
  for (const row of rows) assert.doesNotMatch(row, /回想|galleryButton|setGallery/)
  assert.doesNotMatch(body, /galleryButton/)
  assert.match(body, /function openGallery\(\) \{ setHidden\(false\); setGallery\(true\); \}/)
  assert.match(body, /onGallery\(\) \{ closeMenu\(\); openGallery\(\); \}/)
  assert.match(body, /galleryOpen \? h\(ForkCgGallery,/)
  // private fork (owner 2026-10): a ≡ 菜单 button after the gear in both control rows opens the same menu (touch / mouse).
  // private fork (reading controls §2.4): the row follows forkGalControlIds; phones keep 4 controls, the rest is in the menu.
  assert.match(rows[0], /forkGalControlIds\(narrow\)\.map\(/)
  assert.match(rows[0], /id === "config" \? h\(ForkGalConfig, \{ key: id, open: configOpen, onOpen: openConfig \}\) :[^\n]*\n(?:\s*\/\/[^\n]*\n)*\s*id === "menu" \? menuButton\(\) :/)
  assert.match(stage, /const FORK_GAL_CONTROLS_FULL = \["auto", "skip", "eye-off", "chevron-left", "backlog", "config", "menu", "chat"\];/)
  assert.match(stage, /const FORK_GAL_CONTROLS_NARROW = \["auto", "skip", "backlog", "menu"\];/)
  assert.match(body, /busy: regenerateBlocked, narrow, backDisabled \}, menuActions\)/)
  assert.match(rows[1], /h\(ForkGalConfig, \{ open: configOpen, onOpen: openConfig \}\), menuButton\(\),\s*$/)
  const button = between(body, 'function menuButton()', 'function control(')
  assert.match(button, /title: "菜单", "aria-label": "菜单", "aria-haspopup": "menu", "aria-expanded": menuOpen/)
  assert.match(button, /className: "fork-gal-control fork-gal-menu-toggle"/, 'the same control styling as the other icons')
  assert.match(button, /onClick: event => \{ event\.stopPropagation\(\); openMenu\(false\); \}/)
  assert.match(button, /if \(event\.key === "Enter" \|\| event\.key === " "\) event\.stopPropagation\(\);/, 'its own Enter does not page')
  assert.match(button, /h\(ForkIcon, \{ name: "menu", size: 17 \}\)/)
  assert.match(body, /\n\s*openMenu\(false\);\n\s*\}\n\s*else if \(letter === "h"/, 'Esc still opens the menu') // private fork: letter keys via `letter`
})
function between(text, a, b) { const i = text.indexOf(a), j = text.indexOf(b, i); assert.ok(i >= 0 && j > i, a); return text.slice(i, j) }

// Same lint as fork-stage-ui-tokens.test.mjs: a literal colour or a non-stage variable instead of a --gal-ui-* token.
const untokenised = /#[\da-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(|(?<![\w-])(?:white|black|canvas|canvastext)(?![\w-])|var\(\s*--(?!(?:gal-ui-|fk-s-))/i
test('stage system menu CSS: one token-only block, no theme selectors, opaque panel, focus ring, round corners, reduced motion', () => {
  const open = '/* ==== stage system menu ==== */', close = '/* ==== end stage system menu ==== */'
  assert.equal(css.split(open).length, 2)
  assert.equal(css.split(close).length, 2)
  const block = css.slice(css.indexOf(open) + open.length, css.indexOf(close))
  const bare = block.replace(/\/\*[\s\S]*?\*\//g, '')
  assert.doesNotMatch(bare, /\[\s*data-theme\b/i, 'components never branch on the theme')
  // Mask art (url(...)) only supplies alpha; everything painted comes from the stage tokens.
  assert.doesNotMatch(bare.replace(/url\("[^"]*"\)/g, 'url()'), untokenised)
  assert.match(bare, /\.fork-gal-stage\.is-menu :is\(\.fork-gal-box, \.fork-gal-choices, \.fork-gal-topbar\) \{ visibility: hidden; pointer-events: none;/)
  const panel = /\.fork-gal-menu-panel \{([^}]*)\}/.exec(bare)
  assert.ok(panel, 'panel rule')
  assert.match(panel[1], /background: var\(--gal-ui-surface-2\)/, 'menus are opaque')
  assert.doesNotMatch(panel[1], /backdrop-filter/)
  assert.match(bare, /\.fork-gal-menu-item:focus-visible \{[^}]*outline: var\(--gal-ui-focus\)/)
  assert.match(bare, /corner-shape: round/)
  // private fork (owner 2026-10): a single frame like CONFIG; the inner layer only carries the corner sparkles.
  assert.match(bare, /\.fork-gal-menu-frame \{ position: absolute; inset: 8px; pointer-events: none; \}/)
  assert.doesNotMatch(bare, /\.fork-gal-menu-frame \{[^}]*border:/, 'no box in box')
  assert.match(panel[1], /inset 0 0 0 1px var\(--gal-ui-line\)/, 'the one frame line')
  assert.match(bare, /@media \(prefers-reduced-motion: reduce\) and \(update: none\) \{[^}]*animation: none/)
  for (const rule of bare.match(/[^{}]+::(?:before|after)[^{}]*\{[^}]*content:[^}]*\}/g) || []) {
    assert.match(rule, /content: ""/, 'decorative pseudo-elements carry no text')
    assert.match(rule, /pointer-events: none/)
  }
})

// private fork (owner 2026-10): the turn-end 「重新生成正文」 opens the menu straight into its 重新生成 dialog; backing out
// of that dialog closes the whole menu, and focus goes back to what was focused when the menu rendered.
test('menu regenerate: opens straight into the dialog, backing out closes the menu', () => {
  const Regenerate = () => null
  const h = harness({ regenerate: true, Regenerate })
  h.render()
  const dialog = h.walk().find(node => node.type === Regenerate)
  assert.ok(dialog, 'the dialog is open on mount')
  assert.equal(dialog.props.turn, 64)
  assert.equal(h.walk().find(node => node.props.role === 'menu').props.hidden, true, 'the item list stays hidden')
  assert.ok(h.document.activeElement === h.opener, 'no menu item steals focus from the dialog')
  dialog.props.onClose()
  assert.deepEqual(h.calls, ['onClose'])
  const stop = () => ({ stopPropagation() {}, preventDefault() {} })
  h.render(); h.walk()[0].props.onContextMenu(stop())
  assert.deepEqual(h.calls, ['onClose', 'onClose'], 'right click backs out of the whole menu too')
  const plainMenu = harness({ Regenerate }); plainMenu.render()
  assert.equal(plainMenu.walk().some(node => node.type === Regenerate), false, 'the ≡ menu still opens on its list')
})
