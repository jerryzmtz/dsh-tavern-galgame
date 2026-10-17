import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { parse } from 'acorn'
import { segmentPluginText, extractPluginMarkers } from '../tavern-plugin/lib/domain/plugin-text-segments.js'
import bubbles from '../tavern-plugin/src/client/fork-bubble-line.cjs'

async function functions(file, names) {
  const source = await readFile(new URL('../tavern-plugin/src/client/' + file, import.meta.url), 'utf8')
  return parse(source, { ecmaVersion: 'latest' }).body
    .filter(node => node.type === 'FunctionDeclaration' && names.includes(node.id.name))
    .map(node => source.slice(node.start, node.end)).join('\n')
}
const h = (type, props, ...children) => ({ type, props: props || {}, children: children.flat() })
const context = vm.createContext({
  React: { createElement: h, Fragment: 'fragment' }, window: {}, segmentPluginText, extractPluginMarkers,
  forkParseBubbles: bubbles.forkParseBubbles, forkGalPlain: String,
  forkBubblePublicationType: () => 'bubble', TavernPluginMediaItem: 'media', TavernPluginMarker: 'marker',
  TavernMessageFrame: 'frame', TavernScriptLayerPart: 'layer', DshUi: {},
  tavernUiExtensions: { markers: () => [{ pattern: /\[plugin\]/g }] }
})
vm.runInContext(await functions('fork-gal-stage.js', ['forkGalBlocks', 'forkGalParagraphs']) + '\n' +
  await functions('fork-gal-history.js', ['forkGalParagraphCount']) + '\n' +
  await functions('features/plugin-extensions.js', ['createTavernPluginTextContext']) + '\n' +
  await functions('ui/message-frame.js', ['htmlPartHasPresentation', 'projectionPartsOf', 'forkPluginTextPosition', 'renderTavernProjection', 'renderTavernAssistantBlocks']), context)
function publications(tree) {
  return Array.from(Array.isArray(tree) ? tree : [tree]).flatMap(node => !node ? [] : node.type === 'bubble' ? [node.props] : publications(node.children || []))
}
for (const projection of [true, false]) test('private fork: plugin media keeps source part/paragraph coordinates (' + (projection ? 'projection' : 'blocks') + ')', () => {
  const text = 'first paragraph\n\nsecond paragraph\n\nthird paragraph'
  const plugin = context.createTavernPluginTextContext({ items: [{ id: 'media-1', anchor: 'first paragraph' }, { id: 'media-2', anchor: 'second paragraph' }], sessionId: 's', turn: 3 })
  const input = { sessionId: 's', turn: 3, plugin }
  const tree = projection
    ? context.renderTavernProjection({ parts: [{ kind: 'markdown', text: 'earlier' }, { kind: 'html', content: '<div>card</div>' }, { kind: 'markdown', text }] }, input)
    : context.renderTavernAssistantBlocks({ ...input, blocks: [{ kind: 'text', text: 'earlier' }, { kind: 'reasoning', text: 'reason' }, { kind: 'text', text }] })
  const rows = publications(tree)
  assert.deepEqual(rows.map(row => row.stageParaBase + row.stageParaOffset), [0, 1, 2, 3])
  assert.deepEqual(rows.map(row => row.voiceScope), ['3:0', '3:2', '3:2:plugin:2', '3:2:plugin:4'])
  assert.equal(new Set(rows.map(row => row.voiceScope)).size, rows.length)
  assert.deepEqual(Array.from(plugin.placed), ['media-1', 'media-2'])
})
test('private fork: plugin marker text consumes source coordinates but media does not', () => {
  const text = 'first\n\n[plugin]\n\nlast'
  const plugin = context.createTavernPluginTextContext({ items: [], sessionId: 's', turn: 3 })
  const rows = publications(context.renderTavernProjection({ text }, { sessionId: 's', turn: 3, plugin }))
  assert.deepEqual(rows.map(row => row.stageParaOffset), [0, 2])
  assert.equal(rows[1].voiceScope, '3:0:plugin:2')
  assert.equal(context.forkPluginTextPosition('first [plugin] last', 14), 0, 'an inline marker must not create a new source paragraph')
})
test('private fork: HTML markers retain the original frame part identity', () => {
  const plugin = context.createTavernPluginTextContext({ items: [], sessionId: 's', turn: 3 })
  const tree = context.renderTavernProjection({ parts: [
    { kind: 'html', content: '<div>first panel</div>' },
    { kind: 'markdown', text: 'story' },
    { kind: 'html', content: '<div>last panel [plugin]</div>' }
  ] }, { sessionId: 's', turn: 3, plugin, frameOwner: 'owner' })
  const lastFrame = tree[2].children.find(node => node.type === 'frame')
  assert.equal(lastFrame.props.partIndex, 2)
  assert.equal(lastFrame.props.frameOwner, 'owner')
  assert.equal(lastFrame.props.content, '<div>last panel </div>')
  assert.equal(tree[2].children[1].type, 'marker')
})
test('private fork: the live stage selector adds the fragment offset to the original source part', async () => {
  let captured
  const scope = vm.createContext({
    React: { createElement: h, useSyncExternalStore: () => '', useRef: value => ({ current: value }), useMemo: run => run() },
    forkGalActive: {}, forkParseBubbles: () => [], forkBubbleMessageSelector: () => () => null,
    useForkBubbles: () => ({ config: { enabled: true } }), forkGalIsSuperseded: () => false,
    useForkVoiceBubbles: () => ({}), ForkBubbleMarkdown: 'markdown',
    useForkStageSelector: (_id, select) => { captured = select({ textIndex: new Map([[3, { parts: [{ index: 0, units: [1, 2] }, { index: 2, nodeId: 'n', units: [3, 4, 5] }] }]]) }); return captured }
  })
  vm.runInContext(await functions('fork-bubbles.js', ['ForkBubbleContent']), scope)
  scope.ForkBubbleContent({ sessionId: 's', text: 'last', voiceScope: '3:2:plugin:4', stageSource: { nodeId: 'n' }, stageParaBase: 1, stageParaOffset: 2 })
  assert.equal(captured, 4)
})
