// private fork: follow upstream module extraction without weakening behavior assertions.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { createSessionStateView, projectChatSessionState } from '../tavern-plugin/lib/domain/chat-session-state.js'
import { createSessionViewReader } from '../tavern-plugin/lib/domain/session-view-reader.js'

const read = path => fs.readFileSync(new URL('../' + path, import.meta.url), 'utf8')
const source = read('tavern-plugin/src/client/fork-turn-actions.js')
const main = read('tavern-plugin/src/client/features/play-controls.js')
const button = main.slice(main.indexOf('function TavernCompactionAction(props)'), main.indexOf('// @include script-navigation.js'))
const running = () => ({ id: 'manual-1', status: 'running', foreground: { status: 'dispatching' }, background: { status: 'pending' } })
const completed = () => ({ id: 'manual-1', status: 'completed', foreground: { status: 'succeeded', message: '压缩完成' }, background: { status: 'succeeded', message: 'Compacted 12 history items (~4340 tokens).' } })

// The real volatile projection is shared by the host's dirty and cache-hit paths.
test('joint completion replaces cached running receipts without changing story messages', async () => {
    let chat = { id: 'c', sessionId: 's', mode: 'story', _storageRevision: 1, messages: [{ role: 'assistant', turn: 1 }], contextCompaction: { operation: running() } }
    const activity = () => ({ busy: false })
    const fields = createSessionStateView({ activity, evidence: () => ({}) })
    const calls = []
    const refresh = (kind, value, previous) => {
        calls.push(kind)
        return { ...previous, ...fields.volatile(value, activity()) }
    }
    const reader = createSessionViewReader({
        readState: async () => projectChatSessionState(chat), readChat: async () => structuredClone(chat),
        readChanges: async () => ({ revision: chat._storageRevision, indices: [] }),
        project: {
            full: async value => ({ contextCompaction: value.contextCompaction, tavernHelper: { messages: value.messages } }),
            dirty: async (value, previous) => refresh('dirty', value, previous),
            cached: async (value, previous) => refresh('cached', value, previous)
        },
        activity, foregroundRunning: () => false, trace: { stage: (_, work) => work(), state() {} }, synchronize: (_, view) => view
    })
    assert.equal((await reader.read('s')).contextCompaction.operation.status, 'running')
    chat = { ...chat, _storageRevision: 2, contextCompaction: { operation: completed() } }
    assert.equal((await reader.read('s')).contextCompaction.operation.status, 'completed')
    assert.equal((await reader.read('s')).contextCompaction.operation.background.status, 'succeeded')
    chat = { ...chat, _storageRevision: 3 }
    delete chat.contextCompaction
    assert.equal((await reader.read('s')).contextCompaction, null)
    assert.deepEqual(calls, ['dirty', 'cached', 'dirty'])
})

function harness(operation) {
    const view = { mode: 'story', contextCompaction: { operation } }
    let response
    const pending = new Promise(resolve => { response = resolve })
    let calls = 0
    const context = vm.createContext({
        React: {
            createElement: (type, props, ...children) => ({ type, props, children }),
            useState: value => [value, () => {}], useSyncExternalStore: (_, snapshot) => snapshot()
        },
        useLiveTavernView: () => ({ view }), isPlayMode: mode => mode === 'story',
        liveTavernView: { invalidate() {} }, rpc: () => { calls++; return pending },
        tavernErrorHub: { report() {} }
    })
    vm.runInContext(source + '\n' + button, context)
    return { context, view, response, calls: () => calls,
        line: () => vm.runInContext('ForkCompactionLine({sessionId:"s"})', context),
        button: () => vm.runInContext('TavernCompactionAction({sessionId:"s",useSession:fn=>fn({running:false})})', context),
        run: code => vm.runInContext(code, context) }
}

test('foreground and background progress never create a second history divider', () => {
    const h = harness(running())
    assert.equal(h.line(), null)
    assert.equal(h.button().props.disabled, true)
    assert.equal(h.button().props['aria-busy'], true)
    assert.match(h.button().props.title, /^压缩中… 前台：压缩中…；后台：等待中$/)
    h.view.contextCompaction.operation.foreground = { status: 'succeeded', message: '压缩完成' }
    h.view.contextCompaction.operation.background = { status: 'dispatching' }
    assert.equal(h.line(), null)
    assert.equal(h.button().props.disabled, true)
    assert.match(h.button().props.title, /前台：压缩完成；后台：压缩中…/)
    h.view.contextCompaction.operation = completed()
    assert.equal(h.line(), null)
    assert.equal(h.button().props.disabled, false)
    assert.equal(h.button().props['aria-busy'], false)
    assert.match(h.button().props.title, /后台：已压缩 12 条历史记录（原文约 4,340 tokens）/)
    assert.doesNotMatch(h.button().props.title, /Compacted/)
})

test('manual progress is shared across remounted buttons until both sides finish', async () => {
    const h = harness(null)
    const task = h.button().props.onClick()
    const remounted = h.button()
    assert.equal(remounted.props['aria-busy'], true)
    assert.equal(remounted.props.disabled, true)
    assert.equal(h.line(), null)
    await remounted.props.onClick()
    assert.equal(h.calls(), 1)
    h.view.contextCompaction.operation = completed()
    h.response({ result: completed() })
    await task
    assert.equal(h.button().props['aria-busy'], false)
    assert.equal(h.line(), null)
})

test('failures remain visible and dismissible without a running divider', () => {
    const h = harness({ ...completed(), status: 'partial' })
    h.run('forkCompactionRuns.set("s", { phase: "failed", message: "压缩未完成" })')
    assert.equal(h.line().props['data-phase'], 'failed')
    assert.equal(h.button().props['aria-busy'], false)
    h.line().children[1].props.onClick()
    assert.equal(h.line(), null)
})

test('busy toolbar buttons keep a still glyph with a ring indicator (compaction included)', () => {
    const css = read('tavern-plugin/lib/client-assets/fork-theme.css')
    // The glyph (::before) of a busy button is never animated or swapped out.
    assert.doesNotMatch(css, /\.dsh-fork[^{}]*(?:\[data-busy\]|\[aria-busy="true"\])[^{}]*::before \{[^}]*(?:animation|mask: none)/)
    // One shared busy rule covers the composer icons, the compaction slot and the turn actions; a ring runs round the button.
    const ring = /:is\(\.dsh-fork-inline-actions \[data-fork-action\], \.dsh-fork-icon-slot > button, \.dsh-fork-turn-actions \[data-fork-turn\] > button\):is\(\[data-busy\], \[aria-busy="true"\]\)::after \{[^}]*animation: dsh-fork-busy-ring/
    assert.match(css, ring)
    assert.match(css, /@media \(prefers-reduced-motion: reduce\) and \(update: none\) \{[^{]*\[aria-busy="true"\]\)::after \{ animation: none; \}/)
    assert.match(css, /\.dsh-fork-icon-slot > button::before \{ width: 18px; height: 18px; \}/)
})
