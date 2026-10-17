// private fork: production lifecycle glue executes without a React or transcript global.
import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import {readFileSync} from 'node:fs'
import {createControllableBinding} from './helpers/stage-runtime-harness.mjs'
import {nativeBinding, nativeNode, textHelpers} from './helpers/stage-session-harness.mjs'
const read = name => readFileSync(new URL('../tavern-plugin/src/client/' + name, import.meta.url), 'utf8')

test('browser module guards and production non-React session binding preserve plugin exports', () => {
  const binding = nativeBinding([nativeNode(1, 'Before')]), list = createControllableBinding({current: 's', byId: {s: {}}})
  const view = createControllableBinding({view: {mode: 'story', chatId: 'c', card: {path: 'card'}}})
  const settings = createControllableBinding({cardPath: 'card', config: {enabled: true}})
  const pref = createControllableBinding({value: 'prefs'}), handlers = new Map()
  const helpers = textHelpers(), paths = [], bgm = []
  const ui = {binding: value => {assert.equal(value, binding); return {target: name => {assert.equal(name, 'chat'); return binding.chat}}}}
  // private fork: C observes through the Session Signals carrier without a React mount.
  const context = {AbortController, setTimeout, clearTimeout,
    // private fork: presentation time is injected independently of transport timers.
    forkForeground:{now:() => 0,setTimeout,clearTimeout},
    forkAvatarCache: {select() {}, revision() {}, get() {}},
    forkVoicePlayer: {cancelPrefetch() {}, handle() { return {prefetch() {}} }},
    // private fork: the page-wide BGM player follows the selected session (fork-bgm-player.cjs).
    forkBgm: {activate: id => bgm.push(id), invalidate() {}, kick() {}},
    rpc:async () => ({phase:'off',revision:1}), tavernSessionSignals:{subscribe:() => () => {}}, window: {}, module: {exports: {apply: 'original'}},
    document: {hidden: true, addEventListener: (name, fn) => handlers.set(name, fn), removeEventListener: name => handlers.delete(name)},
    ...helpers.api,
    liveTavernView: {select: (_id, selected) => {paths.push(selected); return view}, invalidate() {}},
    tavernCoordination: {getSnapshot: () => ({view: {runtimeGeneration: 'host'}}), subscribe: () => () => {}},
    forkBubbleStore: {get: settings.getSnapshot, subscribe: settings.subscribe, load() {}, watch: () => () => {}},
    forkStageReading: {get: pref.getSnapshot, subscribe: pref.subscribe},
    forkStageFilm: {get: () => false, subscribe: pref.subscribe},
    forkStageAudio: {get: () => ({master: .8}), subscribe: pref.subscribe},
    resolveConversationChatBinding: (conversation, value) => conversation.binding(value).target('chat')}
  context.ctx = {sessions: {list, binding: id => id === 's' ? binding : undefined}, get: name => name === 'uiConversation' ? ui : undefined}
  const source = read('fork-stage-session-binding.js').replace(/^\/\/ @include(-mod|-protocol)? (.+)$/gm, (_all, owner, name) => owner
    ? readFileSync(new URL(owner === '-mod' ? '../fork/mods/' + name : '../tavern-plugin/packages/dsh-presentation-protocol/src/' + name, import.meta.url), 'utf8')
    : read(name))
  vm.runInNewContext(source + '\nglobalThis.stop = forkStageSessions.start(ctx); globalThis.sessions = forkStageSessions;', context)
  const store = context.sessions.get('s')
  assert.deepEqual(bgm, ['s'], 'the player follows the selected session once its store exists')
  assert.equal(store.getSnapshot().text.pages[0].text, 'Before')
  assert.equal(store.getSnapshot().visible, false)
  binding.chunk(nativeNode(1, 'After'))
  assert.equal(store.getSnapshot().text.pages[0].text, 'After')
  assert.equal(context.module.exports.apply, 'original')
  assert.equal(context.React, undefined)
  assert.ok(paths[0].some(path => path[0] === 'replyProjections'))
  assert.ok(paths[0].some(path => path[0] === 'historyWindow'))
  context.document.hidden = false; handlers.get('visibilitychange')()
  assert.equal(store.getSnapshot().preferences.audio.master, .8)
  context.stop()
  assert.deepEqual(bgm, ['s', null])
  assert.equal(store.getSnapshot().disposed, true)
  assert.equal(binding.listeners(), 0)
  assert.equal(handlers.size, 0)
  assert.equal(pref.subscribers, 0)
})

test('plugin apply owns the runtime; legacy publication has no dispatch path into it', () => {
  assert.match(read('main.js'), /ctx\.effect\(\(\) => forkStageSessions\.start\(ctx\)/)
  for (const file of ['fork-bubbles.js', 'fork-gal-stage.js']) {
    // private fork: UI consumes selectors and commands, never creates or republishes session inputs.
    assert.doesNotMatch(read(file), /createStageRuntimeStore|SESSION_INPUTS|TEXT_RECONCILE|function useForkGalPublish|const forkGalParts/)
  }
})
