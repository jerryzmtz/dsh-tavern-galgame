import {stagePageSource} from './stage-page-source.mjs' // private fork
// private fork: real input adapters and reducer, no React/transcript tree.
import {readFileSync} from 'node:fs'
import vm from 'node:vm'
import {createRequire} from 'node:module'
import {createControllableBinding} from './stage-runtime-harness.mjs'
const require = createRequire(import.meta.url)
export const {createStageTextIndex, stageVoiceDescriptor} = require('../../tavern-plugin/src/client/fork-stage-text-index.cjs')
const {createStageSessionOwner} = require('../../tavern-plugin/src/client/fork-stage-session.cjs')
const read = file => readFileSync(new URL('../../tavern-plugin/src/client/' + file, import.meta.url), 'utf8')
const slice = (code, start, end) => code.slice(code.indexOf(start), code.indexOf(end, code.indexOf(start)))
export function textHelpers(metrics = {}) {
  const stage = read('fork-gal-stage.js'), bubbles = read('fork-bubbles.js'), frame = read('ui/message-frame.js')
  const api = {createSessionViewReader: {}, isPlayMode: mode => mode === 'story', htmlPartHasPresentation: text => !!text.trim()}
  vm.runInNewContext([
    read('fork-bubble-line.cjs'),
    read('fork-stage-display-units.cjs'),
    slice(bubbles, 'const FORK_BUBBLE_LINE', '// Custom emotions'),
    slice(bubbles, 'function forkBubbleSegment', '// Per-session bubble settings'),
    // private fork: the publication hook is deleted at the F cutover.
    slice(stage, 'function forkGalIsSuperseded', '// Plain reading text'),
    (stagePageSource + '\n' + slice(stage, 'function forkGalPlain', '// Film cards')),
    slice(stage, 'function forkGalTextDigest', '// Offsets ignore'),
    slice(read('fork-gal-history.js'), 'function forkGalPartOrder', 'function forkGalPageAtPara'), // private fork
    slice(frame, 'function tavernProjectionForTurn', 'function tavernMvuReceiptForTurn'),
    slice(frame, 'function projectionPartsOf', '// @include inline-fragment.js')
  ].join('\n'), api)
  return {parse(text, streaming) {metrics.parsed = (metrics.parsed || 0) + text.length; return api.forkParseBubbles(text, streaming)},
    paragraphs: api.forkGalParagraphs, displayUnits: api.forkStageDisplayUnits, paginate(text) {metrics.paginated = (metrics.paginated || 0) + 1; return api.forkGalBlockPages(text)},
    turnIndex: api.forkGalTurnIndex, projectionForTurn: api.tavernProjectionForTurn, projectionParts: api.projectionPartsOf,
    storyTurn: api.tavernStoryTurnForDshTurn, superseded: api.forkGalIsSuperseded, api}
}
export function nativeNode(turn, text, {id = turn + ':1', order = turn * 10, status = 'closed', blocks, kind = 'assistant-step'} = {}) {
  return {id, kind, anchorSeq: order, location: {kind: 'step', turn: {turn}}, data: {status, blocks: blocks || [{kind: 'text', text}]}}
}
export function nativeBinding(nodes = [], running = false) {
  let values = new Map(nodes.map(node => [node.id, node]))
  const sources = new Map(nodes.map(node => [node.id, createControllableBinding(node)]))
  const snapshot = () => ({order: [...values.keys()], nodes: {values: () => values.values(), get: id => values.get(id), source: id => sources.get(id)}})
  const chat = createControllableBinding(snapshot()), session = createControllableBinding({running})
  return {session, chat,
    set(nodes) {values = new Map(nodes.map(node => [node.id, node])); for (const node of nodes) if (!sources.has(node.id)) sources.set(node.id, createControllableBinding(node)); chat.publish(snapshot())},
    chunk(node) {values.set(node.id, node); sources.get(node.id).publish(node)},
    run(running) {session.publish({running})},
    listeners() {return session.subscribers + chat.subscribers + [...sources.values()].reduce((sum, source) => sum + source.subscribers, 0)}
  }
}
export function sessionHarness({nodes = [], view = {}, running = false, readHistory, ownerOptions = {}} = {}) {
  const helpers = textHelpers(), effects = [], binding = nativeBinding(nodes, running)
  const bindings = new Map([['s', binding]])
  const list = createControllableBinding({current: 's', byId: {s: {id: 's'}}})
  const views = createControllableBinding({view: {mode: 'story', chatId: 'chat', card: {path: 'card'}, ...view}})
  const coordination = createControllableBinding({view: {cardPath: 'card', runtimeGeneration: 'host-1'}})
  const settings = createControllableBinding({cardPath: 'card', config: {enabled: true, characters: [{alias: 'alice'}]}, engineSettings: {revision: 1}})
  const prefs = createControllableBinding({reading: {textSpeed: 28}, film: false, audio: {master: .8, muted: {}}})
  let invalidations = 0, loads = 0
  const owner = createStageSessionOwner({...ownerOptions,readHistory, sessions: {list, binding: id => bindings.get(id)}, resolveChat: binding => binding.chat,
    views: {select: () => views, invalidate() {invalidations++}}, viewPaths: [[]], coordination: {getSnapshot: () => coordination.getSnapshot(), subscribe: (_id, fn) => coordination.subscribe(fn)},
    settings: {get: () => settings.getSnapshot(), subscribe: settings.subscribe, load() {loads++}},
    preferences: {get: prefs.getSnapshot, subscribe: prefs.subscribe}, createIndex: () => createStageTextIndex(helpers), storyTurn: helpers.storyTurn,
    runEffect(id, intent, dispatch, getSnapshot) {effects.push({id, ...intent}); ownerOptions.runEffect?.(id,intent,dispatch,getSnapshot)}})
  owner.start()
  return {owner, binding, bindings, list, views, coordination, settings, prefs, effects, helpers,
    state: () => owner.get('s').getSnapshot(), invalidateCount: () => invalidations, loadCount: () => loads,
    view(patch) {views.publish({view: {...views.getSnapshot().view, ...patch}})},
    close() {list.publish({current: '', byId: {}})}, dispose: () => owner.dispose()}
}
