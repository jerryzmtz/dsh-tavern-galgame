// Private fork (docs/fork/galgame-stage.md): the stage "what next" menu (fork-gal-choices.js) — the editor's
// 取消 control, Esc, and cancelling on a click outside only while the text is untouched.
import test from 'node:test'
import { forkUiSfxStub } from './helpers/fork-ui-sfx-stub.mjs' // private fork: stage UI cues
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

import { forkTextAreaSource } from './helpers/fork-spinner.mjs' // private fork (UI standard phase 2 batch 16): ForkTextArea
const source = forkTextAreaSource + await readFile(new URL('../tavern-plugin/src/client/fork-gal-choices.js', import.meta.url), 'utf8')

// A tiny hook renderer: state persists between renders, effects run after a render when their deps change.
function renderer() {
  let slots = [], cursor = 0, pending = []
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity).filter(item => item != null && item !== false) }),
    useState(value) { const index = cursor++; if (!(index in slots)) slots[index] = typeof value === 'function' ? value() : value; return [slots[index], next => { slots[index] = typeof next === 'function' ? next(slots[index]) : next }] },
    useRef(value) { const index = cursor++; if (!(index in slots)) slots[index] = { current: value }; return slots[index] },
    useEffect(fn, deps) {
      const index = cursor++, old = slots[index]
      if (!old || !deps || deps.some((dep, i) => !Object.is(dep, old.deps[i]))) pending.push(() => { if (old && old.cleanup) old.cleanup(); const cleanup = fn(); slots[index] = { deps, cleanup } })
      else slots[index] = old
    },
  }
  return { React, render(fn, props) { cursor = 0; pending = []; const tree = expand(fn(props)); pending.forEach(run => run()); return tree } }
}
function expand(tree) {
  if (!tree || typeof tree !== 'object') return tree
  if (typeof tree.type === 'function') return expand(tree.type({ ...tree.props, children: tree.children }))
  return { ...tree, children: tree.children.map(expand) }
}
const all = (tree, test, out = []) => { if (tree && typeof tree === 'object') { if (test(tree)) out.push(tree); tree.children.forEach(child => all(child, test, out)) } return out }
const byClass = (tree, name) => all(tree, node => String(node.props.className || '').split(' ').includes(name))
const text = node => typeof node === 'string' ? node : node && node.children ? node.children.map(text).join('') : ''
const click = node => node.props.onClick({ stopPropagation() {}, preventDefault() {} })

function mount(options = {}) {
  const { React, render } = renderer()
  const listeners = new Set(), sent = [], submitted = []
  const document = {
    addEventListener: (type, fn, capture) => { assert.equal(type, 'pointerdown'); assert.equal(capture, true); listeners.add(fn) },
    removeEventListener: (type, fn) => listeners.delete(fn),
  }
  let panel = options.empty ? null : { sessionId: 's', messageId: 'm', phase: 'ready', choices: [{ type: 'action', text: '跟上去' }, { type: 'scene', text: '第二天' }] }
  let task = null
  const context = {
    React, document, console,
    useCandidatePanel: () => panel,
    useTavernCoordination: () => ({ view: { task } }),
    useForkAutoChoicesPreference: () => ({ enabled: options.auto === true }),
    describeTavernActivity: () => ({ busy: false }),
    latestTavernAssistantMessageId: () => 'm',
    setCandidatePanel: value => { panel = value },
    readyCandidatePanel: (sessionId, messageId, candidates) => ({ sessionId, messageId, phase: 'ready', choices: candidates.choices }),
    submitCandidateTask: async (...args) => { submitted.push(args); if (options.fail) throw new Error('test failure') },
    liveTavernView: { invalidate() {} }, tavernCoordination: { invalidate() {} },
    ForkIcon: () => null, ...forkUiSfxStub(),
  }
  vm.runInNewContext(source + '\nthis.ForkGalChoices = ForkGalChoices; this.forkGalChoiceUntouched = forkGalChoiceUntouched;', context)
  const props = { sessionId: 's', useSession: select => select({ running: false }), useChat: () => 'm', executeSlash: async command => { sent.push(command) }, ...options.props }
  let tree
  const view = {
    get tree() { return tree },
    rerender() { tree = render(context.ForkGalChoices, props); return tree },
    pointerdown(target) { [...listeners].forEach(fn => fn({ target })); return view.rerender() },
    type(value) { const input = byClass(tree, 'fork-gal-choice-input')[0]; input.props.onChange({ target: { value } }); return view.rerender() },
    key(key) { const input = byClass(tree, 'fork-gal-choice-input')[0]; input.props.onKeyDown({ key, shiftKey: false, nativeEvent: {}, stopPropagation() {}, preventDefault() {} }); return view.rerender() },
    listeners, sent, submitted, untouched: context.forkGalChoiceUntouched,
    task(value) { task = { taskId: 't', version: 1, kind: 'candidate', input: { messageId: 'm' }, ...value }; view.rerender(); return view.rerender() },
    running(value) { props.useSession = select => select({ running: value }); return view.rerender() },
  }
  view.rerender()
  return view
}
const editors = tree => byClass(tree, 'is-editing')
const openEdit = (view, index) => { click(byClass(view.tree, 'fork-gal-choice-edit')[index]); return view.rerender() }
const openFree = view => { click(byClass(byClass(view.tree, 'is-free')[0], 'fork-gal-choice-main')[0]); return view.rerender() }

test('the editor shows 取消 beside 发送; 取消 restores the card without sending', () => {
  const view = mount()
  let tree = openEdit(view, 0)
  assert.equal(editors(tree).length, 1)
  const actions = byClass(editors(tree)[0], 'fork-gal-choice-actions')[0]
  assert.deepEqual(actions.children.map(node => node.props.className), ['fork-gal-choice-cancel', 'fork-gal-choice-send'])
  const cancel = byClass(tree, 'fork-gal-choice-cancel')[0]
  assert.equal(text(cancel), '取消')
  assert.equal(cancel.props.type, 'button')
  assert.equal(cancel.props['aria-label'], '取消')
  assert.match(cancel.props.title, /Esc/)
  tree = view.type('跟上去，然后叫住她')
  click(byClass(tree, 'fork-gal-choice-cancel')[0])
  tree = view.rerender()
  assert.equal(editors(tree).length, 0, 'editor closed')
  assert.equal(byClass(tree, 'fork-gal-choice-text').map(text).join('|'), '跟上去|第二天', 'cards restored')
  assert.deepEqual(view.sent, [])
  assert.equal(view.listeners.size, 0, 'the outside-click listener is removed with the editor')
})

test('Esc still cancels, for an edited choice and for 自由输入', () => {
  const view = mount()
  openEdit(view, 1); view.type('改过了')
  assert.equal(editors(view.key('Escape')).length, 0)
  openFree(view); view.type('我自己来')
  const tree = view.key('Escape')
  assert.equal(editors(tree).length, 0)
  assert.equal(byClass(tree, 'is-free').length, 1, '自由输入 row is back')
  assert.deepEqual(view.sent, [])
})

test('a click outside cancels an untouched editor but keeps typed text', () => {
  const view = mount()
  // Untouched suggestion → an outside click closes it.
  openEdit(view, 0)
  assert.equal(view.listeners.size, 1)
  assert.equal(editors(view.pointerdown({ outside: true })).length, 0)
  // Untouched 自由输入 (empty, or whitespace only) → closes too.
  openFree(view)
  view.type('   ')
  assert.equal(editors(view.pointerdown({ outside: true })).length, 0)
  // Typed text survives a stray click; the editor and its text stay.
  openFree(view)
  view.type('我直接走过去')
  let tree = view.pointerdown({ outside: true })
  assert.equal(editors(tree).length, 1)
  assert.equal(byClass(tree, 'fork-gal-choice-input')[0].props.value, '我直接走过去')
  // An edited suggestion is kept as well; restoring the original text makes it cancellable again.
  view.key('Escape')
  openEdit(view, 1)
  view.type('【场景变化】第二天傍晚')
  assert.equal(editors(view.pointerdown({ outside: true })).length, 1)
  view.type('【场景变化】第二天')
  assert.equal(editors(view.pointerdown({ outside: true })).length, 0)
  assert.deepEqual(view.sent, [])
})

test('a click inside the editor never cancels it', () => {
  const view = mount()
  const tree = openEdit(view, 0)
  const card = editors(tree)[0]
  assert.ok(card.props.ref && 'current' in card.props.ref, 'the editor card carries the ref the listener checks')
  card.props.ref.current = { contains: target => target === 'inside' }
  assert.equal(editors(view.pointerdown('inside')).length, 1)
  assert.equal(editors(view.pointerdown('elsewhere')).length, 0)
})

test('forkGalChoiceUntouched compares against the text the editor opened with', () => {
  const { untouched } = mount()
  assert.equal(untouched(null), false)
  assert.equal(untouched({ index: -1, text: '', initial: '' }), true)
  assert.equal(untouched({ index: -1, text: ' \n', initial: '' }), true)
  assert.equal(untouched({ index: 0, text: 'a', initial: 'a' }), true)
  assert.equal(untouched({ index: 0, text: 'ab', initial: 'a' }), false)
  assert.equal(untouched({ index: -1, text: 'x' }), false)
})

test('end panel state is a pure selection over at-end and candidate status', () => {
  const context = {}
  vm.runInNewContext(source + '\nthis.select = forkGalEndPanelState;', context)
  for (const auto of [true, false]) for (const status of ['idle', 'loading', 'ready', 'error']) {
    assert.equal(context.select({ auto, status, atEnd: false }), 'hidden')
    // Only a pending/running task (loading) generates; the auto preference alone never does.
    const expected = status === 'ready' ? 'ready' : status === 'error' ? 'failed' : status === 'loading' ? 'generating' : 'off'
    assert.equal(context.select({ auto, status, atEnd: true }), expected)
  }
})

test('auto-on without a candidate task for this message offers 生成选项 instead of a wait line', () => {
  // An old reply the host will not backfill: no task at all.
  const view = mount({ empty: true, auto: true })
  assert.equal(view.tree.props['data-state'], 'off')
  assert.equal(text(all(view.tree, node => node.props['data-action'] === 'generate')[0]), '生成选项')
  assert.equal(byClass(view.tree, 'is-loading').length, 0)
  // A task for another message does not count either.
  view.task({ status: 'running', busy: true, terminal: false, input: { messageId: 'older' } })
  assert.equal(view.tree.props['data-state'], 'off')
  // Queued or running for this message: generating.
  view.task({ status: 'queued', busy: true, terminal: false })
  assert.equal(view.tree.props['data-state'], 'generating')
  assert.equal(view.submitted.length, 0, 'rendering never submits')
})

test('auto-off offers generation, never submits on mount; rapid manual clicks submit once', async () => {
  const view = mount({ empty: true })
  assert.equal(view.tree.props['data-state'], 'off')
  const generate = all(view.tree, node => node.props['data-action'] === 'generate')[0]
  assert.equal(text(generate), '生成选项')
  assert.equal(byClass(view.tree, 'is-free').length, 1)
  assert.equal(view.submitted.length, 0)
  click(generate); click(generate)
  view.rerender()
  assert.equal(view.tree.props['data-state'], 'generating')
  assert.deepEqual(view.submitted, [['s', 'm', '']])
  await new Promise(resolve => setImmediate(resolve))
})

test('auto-on waiting line stays stable; free-input draft survives choices arriving in place', () => {
  const view = mount({ empty: true, auto: true })
  view.task({ status: 'running', busy: true, terminal: false })
  assert.equal(view.tree.props['data-state'], 'generating')
  const waiting = text(byClass(view.tree, 'is-loading')[0])
  assert.match(waiting, /世界线|分歧点|Reading Steiner/)
  view.rerender()
  assert.equal(text(byClass(view.tree, 'is-loading')[0]), waiting)
  assert.equal(view.submitted.length, 0, 'host owns automatic generation; opening the stage does not catch up')
  openFree(view); view.type('我先问问她')
  view.task({ status: 'succeeded', terminal: true, busy: false, result: { candidates: { choices: [{ type: 'action', text: '一起走' }] } } })
  assert.equal(view.tree.props['data-state'], 'ready')
  assert.equal(byClass(view.tree, 'fork-gal-choice-input')[0].props.value, '我先问问她')
  assert.equal(text(byClass(view.tree, 'fork-gal-choice-text')[0]), '一起走')
  assert.equal(byClass(view.tree, 'is-loading').length, 0)
  assert.equal(view.running(true), null, 'awaiting the next reply hides the menu')
})

test('failed mailbox task offers explicit retry even with auto on, without retrying on render', async () => {
  const view = mount({ empty: true, auto: true })
  view.task({ status: 'failed', terminal: true, busy: false, error: 'test mailbox failure' })
  assert.equal(view.tree.props['data-state'], 'failed')
  assert.equal(text(byClass(view.tree, 'is-error')[0]), '选项生成失败重试')
  view.rerender()
  assert.equal(view.submitted.length, 0)
  const retry = all(view.tree, node => node.props['data-action'] === 'retry')[0]
  assert.match(retry.props.title, /test mailbox failure/)
  click(retry); view.rerender()
  assert.equal(view.tree.props['data-state'], 'generating')
  assert.equal(byClass(view.tree, 'is-free').length, 1)
  assert.equal(view.submitted.length, 1)
  await new Promise(resolve => setImmediate(resolve))
})

test('manual submission failure retains free input and requires a new explicit click', async () => {
  const view = mount({ empty: true, fail: true })
  click(all(view.tree, node => node.props['data-action'] === 'generate')[0])
  await new Promise(resolve => setImmediate(resolve))
  view.rerender()
  assert.equal(view.tree.props['data-state'], 'failed')
  openFree(view); view.type('自己行动')
  assert.equal(byClass(view.tree, 'fork-gal-choice-input')[0].props.value, '自己行动')
  assert.equal(view.submitted.length, 1)
})

// private fork (owner 2026-10): turn-end menu order 生成选项 → 重新生成正文 → 自由输入; with choices (or while they are
// generating / failed) 重新生成正文 and 自由输入 stay below them. 重新生成正文 opens the stage's regenerate dialog.
test('turn-end menu: 生成选项, 重新生成正文, 自由输入 in that order; the last two stay under choices', () => {
  const actions = tree => all(tree, node => node.props.role === 'menuitem').map(node => node.props['data-action'] || 'choice')
  let opened = 0
  const view = mount({ empty: true })
  assert.deepEqual(actions(view.tree), ['generate', 'free'], 'without a stage regenerate hook the row is absent')
  const withRegen = mount({ empty: true, props: { onRegenerate: () => { opened++ } } })
  assert.deepEqual(actions(withRegen.tree), ['generate', 'regenerate', 'free'])
  assert.deepEqual(all(withRegen.tree, node => node.props.role === 'menuitem').map(text), ['生成选项', '重新生成正文', '自由输入'])
  click(all(withRegen.tree, node => node.props['data-action'] === 'regenerate')[0])
  assert.equal(opened, 1)
  assert.equal(withRegen.submitted.length, 0, 'regenerating never submits a candidate task')
  const ready = mount({ props: { onRegenerate: () => {} } })
  assert.deepEqual(actions(ready.tree), ['choice', 'choice', 'regenerate', 'free'])
  ready.task({ status: 'running', busy: true, terminal: false })
  assert.deepEqual(actions(ready.tree), ['regenerate', 'free'], 'generating: the wait line, then the same two rows')
  // private fork (owner 2026-10): held disabled while generating, so background work around the task cannot blink it.
  assert.equal(all(ready.tree, node => node.props['data-action'] === 'regenerate')[0].props.disabled, true)
  const blocked = mount({ empty: true, props: { onRegenerate: () => {}, regenerateDisabled: true } })
  assert.equal(all(blocked.tree, node => node.props['data-action'] === 'regenerate')[0].props.disabled, true, 'the stage busy rule disables it')
})
