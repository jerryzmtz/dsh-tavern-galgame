// private fork: historical vocabulary is fixture data, not a runtime default.
// private fork: sprite/avatar variant labels use the owner term chafen.
// private fork: include source literally, without String.replace replacement-token expansion.
// private fork: ordinary pack sources are authoring inputs, not runtime defaults.
// private fork: obsolete v1 editor assertions migrate to fork-asset-packs-ui.test.mjs.
// private fork: native editors replace the removed combined modal; retained owner assertions stay here.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { forkSpinnerSource, forkTextAreaSource } from './helpers/fork-spinner.mjs' // private fork (UI standard phase 2 batch 4)
import moods from '../tests/fixtures/legacy-dialogue-moods.json' with { type: 'json' }
import { normalizeBubbleConfig } from '../tavern-plugin/lib/domain/dialogue-bubbles.js'

const read = name => readFile(new URL('../tavern-plugin/src/client/' + name, import.meta.url), 'utf8')
const assets = '' // private fork: v1 source editor removed
const assetHelpers = assets.slice(0, assets.indexOf('// ---------- Stores'))
const modes = await read('fork-bubble-modes.js')
const modesHelpers = modes.slice(0, modes.indexOf('// ---------- Components'))
const modals = await read('fork-bubble-modals.js')
const bubbles = (await read('fork-bubbles.js')).split('// @include fork-bubble-line.cjs').join(await readFile(new URL('../tavern-plugin/src/client/fork-bubble-line.cjs', import.meta.url), 'utf8')).replace('__TAVERN_BUBBLE_MOODS__', JSON.stringify(moods))
const bubblesHead = bubbles.slice(0, bubbles.indexOf('// Per-session bubble settings'))
const presets = await read('fork-bubble-presets.js')
const settingsUi = await read('fork-settings-ui.js')
const modal = await read('fork-modal.js')
const stageClient = await read('fork-stage-backgrounds.js')
const galConfig = await read('fork-gal-config.js')
const galStage = await read('fork-gal-stage.js')
const offstage = await read('fork-stage-offstage.cjs')
const plain = value => JSON.parse(JSON.stringify(value))
const tick = () => new Promise(resolve => setImmediate(resolve))
const LIBRARIES = [
  { id: 'general', label: '通用背景（日本）', counts: {} },
  { id: 'academy', label: '学院（导入）', counts: {} }
]

function renderer() {
  let slots = [], cursor = 0
  const React = {
    Fragment: 'Fragment',
    createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity).filter(item => item != null && item !== false) }),
    useState(value) { const index = cursor++; if (!(index in slots)) slots[index] = typeof value === 'function' ? value() : value; return [slots[index], next => { slots[index] = typeof next === 'function' ? next(slots[index]) : next }] },
    useRef(value) { const index = cursor++; if (!(index in slots)) slots[index] = { current: value }; return slots[index] },
    useEffect() {}, useId: () => 'id', useSyncExternalStore: (subscribe, get) => get()
  }
  return { React, render(fn, props) { cursor = 0; return expand(fn(props)) } }
}
// Render function components (not the string placeholders) so their output can be inspected.
function expand(tree) {
  if (!tree || typeof tree !== 'object') return tree
  if (typeof tree.type === 'function') return expand(tree.type({ ...tree.props, children: tree.children }))
  return { ...tree, children: tree.children.map(expand) }
}
const walk = tree => tree && typeof tree === 'object' ? [tree, ...tree.children.flatMap(walk)] : []
const text = tree => tree && typeof tree === 'object' ? tree.children.map(text).join(' ') : String(tree || '')
const HINT_CLASSES = /(^| )(fork-set-sub|fork-set-note|fork-section-sub|fork-bubble-hint|fork-format-note|fork-set-summary)( |$)/
const hints = tree => walk(tree).filter(item => HINT_CLASSES.test(item.props.className || '') || item.type === 'small' || (item.type === 'p' && !item.props.role))
function load(context, ...sources) { vm.runInNewContext(sources.join('\n;\n'), context); return context }
function storage(initial = {}) { const map = new Map(Object.entries(initial)); return { getItem: key => map.has(key) ? map.get(key) : null, setItem: (key, value) => map.set(key, String(value)), map } }

function simpleContext(r, draft, extra = {}) {
  const saves = [], opened = []
  const ctx = load({ React: r.React, ForkIcon: 'Icon', ForkHelpTip: 'HelpTip', ForkBubbleAvatar: 'Avatar', forkBubbleColor: () => '#123456', ForkInlineField: 'InlineField', ForkInlineRow: 'InlineRow', ForkInlineGrid: 'InlineGrid', // private fork (inline-field sweep)
    useForkAssetLibraries: () => ({ libraries: LIBRARIES }), useForkVoiceGlobal: () => ({ enabled: true }), useForkVoicePrefs: () => [{}], forkVoiceEnabled: global => global.enabled,
    forkVoiceGlobal: { save: async () => {} }, forkVoicePlayer: { stop() {} }, rpc: async () => ({}), useForkFold: () => [true, {}, null], useForkAssetSourceRevision: () => 0 },
  assetHelpers, bubblesHead, offstage, forkTextAreaSource, presets, modes, stageClient.slice(stageClient.indexOf('// Dialogue box style cards'), stageClient.indexOf('// The stage fields the settings panels write')))
  let current = draft
  const c = { assetsReady:true, sessionId: 's', data: { cardPath: 'c', cardName: '卡' }, get draft() { return current }, identity: 's:c', portraitLibrary: { models: [{ id: 'p1', kind: 'static' }] }, voiceLibrary: { voices: [] },
    save(next) { saves.push(plain(next)); current = next }, setMode: mode => opened.push(['mode', mode]), askConfirm: async () => true, openModal: (kind, target) => opened.push([kind, target]), addCharacter: () => 7, ...extra }
  return { ctx, c, saves, opened }
}

test('简单 / 高级: simple is the default, the choice persists machine-wide, and the switch reports it', () => {
  const localStorage = storage()
  const ctx = load({ localStorage }, assetHelpers, modesHelpers, ';this.mode=forkSettingsMode;')
  assert.equal(ctx.mode.get(), 'simple')
  let heard = 0
  ctx.mode.subscribe(() => heard++)
  ctx.mode.set('advanced')
  assert.equal(localStorage.map.get('fork-bubble-settings-mode'), 'advanced')
  assert.equal(ctx.mode.get(), 'advanced'); assert.equal(heard, 1)
  ctx.mode.set('weird'); assert.equal(ctx.mode.get(), 'simple')
})

test('高级 → 对白提示词: blocks without player switch, extra, custom template validation, full preview and placement', () => {
  const r = renderer()
  const legacy = { presetId: 'simple', name: '简洁八类', emotionMode: 'simple', bilingual: false, template: '' }
  const { ctx, c, saves } = simpleContext(r, { ...normalizeBubbleConfig({}), injection: legacy })
  Object.assign(ctx, { ForkStageCardSettings: 'Stage', ForkCatalogueSettings: 'Catalogue', ForkModal: 'Modal' })
  let tree = r.render(ctx.ForkBubblePromptEditor, { ctx: c, onClose: () => {} })
  const modal = () => walk(tree).find(item => item.type === 'Modal' && item.props.title === '对白提示词')
  assert.ok(modal(), 'the editor opens in the modal')
  const area = () => walk(modal()).find(item => item.props['aria-label'] === '对白提示词模板')
  assert.equal(area().props.value, '', 'empty = the default template')
  assert.equal(walk(modal()).some(item => item.props['aria-label'] === '实际注入预览'), false, 'full preview starts collapsed')
  assert.deepEqual(walk(modal()).filter(item => item.props['data-block']).map(item => item.props['data-block']), ['format', 'voice', 'emotions', 'characters'])
  for (const label of ['固定', '自动 · 9 种内置 + 0 种自定义', '完全自定义模板（高级）', '插入位置']) assert.ok(text(modal()).includes(label), label)
  walk(modal()).find(item => item.type === 'button' && text(item) === '查看完整注入文本').props.onClick()
  tree = r.render(ctx.ForkBubblePromptEditor, { ctx: c, onClose: () => {} })
  assert.ok(walk(modal()).some(item => item.props['aria-label'] === '实际注入预览'))
  assert.deepEqual(hints(modal()).map(item => item.props.className || item.type), [], 'the placeholder rules live in a ? tip')
  assert.ok(walk(modal()).some(item => item.type === 'HelpTip' && /\{\{bubble_format\}\}/.test(text(item))))
  area().props.onChange({ target: { value: '只有 {{bubble_format}}' } })
  tree = r.render(ctx.ForkBubblePromptEditor, { ctx: c, onClose: () => {} })
  assert.match(text(walk(modal()).find(item => item.props.role === 'alert')), /\{\{bubble_emotions\}\}.*\{\{bubble_characters\}\}/)
  const saveButton = () => walk(modal()).find(item => item.type === 'button' && text(item) === '保存')
  assert.equal(saveButton().props.disabled, true)
  const mine = '【格式】{{bubble_format}}\n{{bubble_emotions}}\n{{bubble_characters}}'
  area().props.onChange({ target: { value: mine } })
  tree = r.render(ctx.ForkBubblePromptEditor, { ctx: c, onClose: () => {} })
  saveButton().props.onClick()
  assert.deepEqual(saves.at(-1).injection, { template: mine, extra: '' }, 'no preset fields are written')
  tree = r.render(ctx.ForkBubblePromptEditor, { ctx: c, onClose: () => {} })
  assert.equal(area().props.value, mine)
  walk(modal()).find(item => item.type === 'button' && /恢复默认/.test(text(item))).props.onClick()
  tree = r.render(ctx.ForkBubblePromptEditor, { ctx: c, onClose: () => {} })
  assert.equal(area().props.value, '')
  walk(modal()).find(item => item.props['aria-label'] === '补充要求').props.onChange({ target: { value: '不要重复旁白' } })
  assert.equal(walk(modal()).some(item => item.props['aria-label'] === '玩家台词也用气泡'), false)
  // private fork (inline-field sweep): 顺序 is a ForkInlineField number (commits a number on Enter / blur).
  walk(modal()).find(item => item.type === 'InlineField' && item.props.controlLabel === '插入顺序').props.onCommit(250)
  tree = r.render(ctx.ForkBubblePromptEditor, { ctx: c, onClose: () => {} })
  saveButton().props.onClick()
  assert.deepEqual(saves.at(-1).injection, { template: '', extra: '不要重复旁白', placement: { order: 250 } })
  // The live preview asks the host with the template being edited (empty = default) and the card's roster.
  const calls = [], preview = renderer()
  ctx.React = preview.React; preview.React.useEffect = fn => fn()
  Object.assign(ctx, { setTimeout: fn => { fn(); return 1 }, clearTimeout() {}, rpc: async (method, args) => { calls.push([method, plain(args)]); return { instruction: '注入的全文' } } })
  preview.render(ctx.ForkBubblePromptEditor, { ctx: { ...c, draft: { ...c.draft, injection: { template: mine, playerBubbles: true, extra: '' } } }, onClose() {} })
  assert.equal(calls[0][0], 'previewDialogueBubbleInstruction')
  assert.deepEqual(calls[0][1].config.injection, { template: mine, extra: '' })
  assert.equal(calls[0][1].config.enabled, true)
})

test('prompt block links, custom notice, segmented full text and live placement controls', () => {
  const r = renderer(), closed = [], bookLinks = [], focused = []
  const { ctx, c, saves, opened } = simpleContext(r, normalizeBubbleConfig({ enabled: true, injection: { template: '{{bubble_format}}\n{{bubble_emotions}}\n{{bubble_characters}}' } }), {
    openWorldBook: source => bookLinks.push(plain(source)),
    data: { sections: [{ key: 'format', text: '格式正文' }], segments: [{ key: 'custom', title: '自定义模板', text: '自定义正文' }, { key: 'extra', title: '补充要求', text: '末尾' }], placement: { manual: true, current: { book: 'card', position: 4, depth: 7, role: 2, order: 19 }, books: [{ key: 'card', name: '本卡世界书', source: { kind: 'card', cardPath: 'c' } }] } }
  })
  Object.assign(ctx, { ForkModal: 'Modal', setTimeout: fn => fn(), document: { querySelector: selector => ({ scrollIntoView() { focused.push(selector) }, querySelector: () => ({ focus() { focused.push('focus') } }) }) } })
  const props = { ctx: c, onClose: () => closed.push(true) }
  let tree = r.render(ctx.ForkBubblePromptEditor, props)
  assert.match(text(tree), /正在使用自定义模板/)
  assert.match(text(tree), /已在世界书中手动修改/)
  // private fork (inline-field sweep): a 「现有位置  @深度 7 · 助手」 row (ForkInlineRow) next to the inline fields.
  assert.ok(walk(tree).some(item => item.type === 'InlineRow' && item.props.label === '现有位置' && /@深度 7 · 助手/.test(text(item))))
  // private fork: flat sections, no <details>. Each heading is one row: label, the 「?」 right after it, tags, actions last.
  assert.equal(walk(tree).some(item => item.type === 'details' || item.type === 'summary'), false)
  const toggles = walk(tree).filter(item => item.props.className === 'fork-prompt-toggle')
  assert.deepEqual(toggles.map(item => [text(item), item.props['aria-expanded']]), [['格式规则', false], ['配音规则', false], ['差分', false], ['角色表', false], ['完全自定义模板（高级）', false]], 'foldable sections start folded')
  const heads = walk(tree).filter(item => item.props.className === 'fork-prompt-head')
  assert.equal(heads.length, 7)
  for (const head of heads) {
    const kinds = head.children.map(item => item.type === 'HelpTip' ? '?' : item.props.className === 'fork-prompt-head-actions' ? 'actions' : /fork-prompt-tag/.test(item.props.className || '') ? 'tag' : 'label')
    assert.equal(kinds[0], 'label', text(head))
    if (kinds.includes('?')) assert.equal(kinds[1], '?', '「?」 sits right after the label: ' + text(head))
    if (kinds.includes('actions')) assert.equal(kinds.at(-1), 'actions', text(head))
  }
  const customHead = heads.find(item => /完全自定义模板/.test(text(item)))
  assert.ok(customHead.children.some(item => item.type === 'HelpTip') && /恢复默认/.test(text(customHead)), 'the template 「?」 and 「恢复默认」 share the heading row')
  assert.ok(walk(tree).filter(item => item.props.className === 'fork-prompt-body' && item.props.hidden).length >= 5, 'folded bodies stay mounted but hidden')
  toggles[3].props.onClick()
  tree = r.render(ctx.ForkBubblePromptEditor, props)
  const roster = walk(tree).find(item => item.props['data-block'] === 'characters')
  assert.equal(walk(roster).find(item => item.props.className === 'fork-prompt-toggle').props['aria-expanded'], true)
  assert.equal(walk(roster).find(item => item.props.className === 'fork-prompt-body').props.hidden, false, '角色表 expands')
  walk(tree).find(item => item.type === 'button' && /^世界书\s+↗$/.test(text(item))).props.onClick()
  assert.deepEqual(bookLinks, [{ kind: 'card', cardPath: 'c' }])
  walk(tree).find(item => item.type === 'button' && text(item) === '查看完整注入文本').props.onClick()
  tree = r.render(ctx.ForkBubblePromptEditor, props)
  assert.deepEqual(walk(tree).filter(item => item.props.className === 'fork-prompt-segment').map(item => item.props['data-block']), ['custom', 'extra'])
  const voiceBlock = walk(tree).find(item => item.props['data-block'] === 'voice')
  assert.doesNotMatch(text(tree), /角色与配音 →/, 'no breadcrumb in the block links')
  walk(voiceBlock).find(item => item.type === 'button' && /^角色\s+↗$/.test(text(item))).props.onClick()
  assert.deepEqual(opened, [['packs', 'card']]) // private fork: one card editor
  assert.equal(closed.length, 1); assert.equal(saves.length, 1)
  walk(tree).find(item => item.type === 'button' && /^差分\s+↗$/.test(text(item))).props.onClick()
  assert.deepEqual(focused, ['[data-row="emotions"]', 'focus'])
  walk(tree).find(item => item.type === 'button' && text(item) === '恢复为分块模式').props.onClick()
  tree = r.render(ctx.ForkBubblePromptEditor, props)
  assert.doesNotMatch(text(tree), /正在使用自定义模板/)
})

test('ForkModal: closed renders nothing; Esc, the close button and a backdrop click close it; inner clicks and open tips do not', () => {
  const r = renderer(), closed = [], navs = []
  const ctx = load({ React: r.React, ForkIcon: 'Icon', ForkHelpTip: 'HelpTip', useForkFold: () => [true, {}, null] }, modal)
  assert.ok(ctx.ForkModal({ open: false, title: 'x' }) === null)
  const element = ctx.ForkModal({ open: true, title: '素材', icon: 'image', onClose: () => closed.push('x'), nav: [{ id: 'a', label: '场景图', icon: 'image', badge: 3 }, { id: 'sep', separator: true, label: '来源' }, { id: 'b', label: '素材来源' }], navValue: 'a', onNav: id => navs.push(id) }, 'body')
  assert.equal(element.type, ctx.ForkModalFrame)
  const tree = r.render(ctx.ForkModalFrame, element.props)
  const backdrop = tree
  assert.equal(backdrop.props.className, 'fork-modal-backdrop')
  const dialog = walk(tree).find(item => item.props.role === 'dialog')
  assert.equal(dialog.props['aria-modal'], 'true')
  assert.match(dialog.props.className, /has-nav/)
  assert.deepEqual(walk(tree).filter(item => /fork-modal-nav-item/.test(item.props.className || '')).map(item => [text(item).trim(), item.props['aria-current']]), [['场景图 3', 'true'], ['素材来源', undefined]])
  assert.ok(walk(tree).some(item => item.props.className === 'fork-modal-nav-sep' && text(item) === '来源'))
  walk(tree).filter(item => /fork-modal-nav-item/.test(item.props.className || ''))[1].props.onClick()
  assert.deepEqual(navs, ['b'])
  const key = (keyName, target = { closest: () => null }) => { const event = { key: keyName, target, defaultPrevented: false, preventDefault() { this.defaultPrevented = true }, stopPropagation() { this.stopped = true } }; backdrop.props.onKeyDown(event); return event }
  key('Escape', { closest: selector => /is-open/.test(selector) ? {} : null })
  assert.deepEqual(closed, [], 'Esc inside an open tooltip / menu closes that first')
  const esc = key('Escape')
  assert.deepEqual(closed, ['x']); assert.equal(esc.stopped, true, 'Esc does not reach the sidebar or the stage')
  const self = {}
  backdrop.props.onMouseDown({ target: {}, currentTarget: self }); backdrop.props.onClick({ target: {}, currentTarget: self })
  assert.deepEqual(closed, ['x'], 'a click that started inside never closes')
  backdrop.props.onMouseDown({ target: self, currentTarget: self }); backdrop.props.onClick({ target: self, currentTarget: self })
  assert.deepEqual(closed, ['x', 'x'])
  walk(tree).find(item => item.props['aria-label'] === '关闭').props.onClick()
  assert.equal(closed.length, 3)
  assert.ok(walk(tree).some(item => /fork-modal-body/.test(item.props.className || '') && /fork-bubble-settings/.test(item.props.className)), 'body reuses the settings styles')
  // CSS: opaque base under the (possibly translucent) skin surface; accent from the skin brand colour.
  return readFile(new URL('../tavern-plugin/lib/client-assets/fork-theme.css', import.meta.url), 'utf8').then(css => {
    const rule = css.slice(css.indexOf('.fork-modal { display: flex'), css.indexOf('body[data-ds-dark-theme] .fork-modal'))
    assert.match(rule, /linear-gradient\(var\(--fork-surface\), var\(--fork-surface\)\), linear-gradient\(Canvas, Canvas\)/)
    assert.match(rule, /width: min\(80vw, 1200px\); height: 80vh/)
    // private fork: shared shell tokens now belong to dsh-tavern-ui.
    return readFile(new URL('../tavern-plugin/packages/dsh-tavern-ui/src/shell.css', import.meta.url), 'utf8').then(shell => assert.match(shell, /--fork-accent: var\(--dsw-alias-brand-primary/))
  })
})

test('in-stage gear: a small 设置 in the control row opens the Config screen; default skin saves to the card', async () => {
  // The hook in fork-gal-stage.js is one element in the control row; the stage owns the open state.
  const controls = galStage.slice(galStage.indexOf('"fork-gal-controls"'), galStage.indexOf('control("chat"'))
  assert.match(controls, /h\(ForkGalConfig, \{ (?:key: id, )?open: configOpen, onOpen: openConfig \}\)/) // private fork (reading controls §2.4): keyed in the id-driven row
  assert.match(galStage, /configOpen \? h\(ForkGalConfigScreen, \{ sessionId, data: props\.data, names: mixNames, tests: mixTests, onClose: closeConfig \}\)/)
  const r = renderer(), requests = [], published = []
  let data = { cardPath: 'c', config: normalizeBubbleConfig({ enabled: true, characters: [{ alias: 'me', offstage: true }], stage: { theme: 'classic' } }) }
  const ctx = load({ React: r.React, ForkIcon: 'Icon', window: { addEventListener() {}, removeEventListener() {} }, document: { addEventListener() {}, removeEventListener() {} },
    forkBubbleStore: { get: () => data, set: (id, value) => { published.push(value.config.stage.theme); data = value } }, forkVoicePrefs: () => ({ enabled: false }),
    rpc: async (method, args) => { requests.push([method, args]); return method === 'getCardAssetBindings' ? {revision:'r1',extension:{stage:{widgets:false}}} : method === 'saveCardAssetBindings' ? {revision:'r2'} : {...data,config:{...data.config,stage:{...data.config.stage,theme:'magical'}}} },
    useForkStageAudioState: () => ({ master: 0.8, voice: 0.8, music: 0.8, sfx: 0.8, ambience: 0.8, muted: { sfx: true } }), forkStageAudio: { setVolume() {}, toggleMute() {} }, useForkStageFilm: () => false, useForkStageQuality: () => 'high',
    forkStageMusic: { setVolume() {}, toggleMute() {} }, forkStageSfx: { setVolume() {}, toggleMute() {} }, forkStageFilm: { set() {} }, forkStageQuality: { set() {} },
    useForkAutoChoicesPreference: () => ({ enabled: false, loading: false, busy: false, error: '', save() {} }),
    useForkStageReading: () => ({ textSpeed: 28, autoWait: 700, autoSpeed: 1.3 }), forkStageReading: { set() {} }, FORK_STAGE_READING_DEFAULTS: { textSpeed: 28, autoWait: 700, autoSpeed: 1.3 }, FORK_STAGE_READING_LIMITS: { textSpeed: [0, 80, 2], autoWait: [0, 3000, 100] },
    // private fork: the skin select's list renders in place; choosing plays a stage UI cue.
    ForkGalTypewriter: 'Typewriter', forkGalAutoDelay: () => 1600, ForkHelpTip: 'HelpTip', ForkPopover: 'Popover', forkUiSfx: { play() {} } },
  assetHelpers, bubblesHead, modesHelpers, stageClient.slice(stageClient.indexOf('// Dialogue box style cards'), stageClient.indexOf('// The stage fields the settings panels write')), forkSpinnerSource, galConfig) // private fork: ForkSlider / ForkSegmented (fork-inline-field.js)
  const opened = []
  let tree = r.render(ctx.ForkGalConfig, { open: false, onOpen: () => opened.push(true) })
  assert.equal(tree.props['aria-label'], '设置'); assert.equal(tree.props['aria-expanded'], false); assert.equal(tree.props['aria-haspopup'], 'dialog')
  let stopped = false
  tree.props.onClick({ stopPropagation() { stopped = true } })
  assert.equal(stopped, true, 'the click does not also turn the page')
  assert.equal(opened.length, 1)
  assert.equal(r.render(ctx.ForkGalConfig, { open: true, onOpen() {} }).props['aria-expanded'], true)
  // 文字 tab: the card's box style and face window, saved through the same queue as the settings tab.
  // private fork (owner 2026-10): 默认舞台皮肤 is a compact select; open it to see every skin.
  walk(r.render(ctx.ForkGalConfigText, { sessionId: 's', data })).find(item => (item.props.className || '') === 'fork-gal-skin-trigger').props.onClick()
  const panel = r.render(ctx.ForkGalConfigText, { sessionId: 's', data })
  // private fork (owner 2026-10 global-first): the settings for every card (本机 阅读) come first, the 本卡 group last.
  assert.match(text(panel), /阅读.*文字速度.*自动模式等待.*本卡.*默认舞台皮肤.*经典.*经典.*哥特金边.*魔法少女/)
  assert.doesNotMatch(text(panel), /头像框/, 'private fork: the face window is no longer a setting')
  assert.deepEqual(hints(panel), [], 'help lives in ? tips, not gray text')
  walk(panel).find(item => item.props.role === 'option' && item.props['data-value'] === 'magical').props.onClick()
  await tick(); await tick()
  // private fork: skin persists through card CAS and preserves the independent widget preference.
  assert.equal(requests[1][0], 'saveCardAssetBindings')
  assert.equal(requests[1][1].expectedRevision, 'r1')
  assert.deepEqual(JSON.parse(JSON.stringify(requests[1][1].patch)), {stage:{widgets:false,defaultSkin:'magical'}})
  assert.deepEqual(published, ['magical'], 'private fork: publish the refreshed card projection after CAS')
  const saved = walk(r.render(ctx.ForkGalConfigText, { sessionId: 's', data })).find(item => item.props.className === 'fork-gal-config-saved')
  assert.equal(saved.props['data-state'], 'saved'); assert.match(text(saved), /已保存到本卡/)
  // private fork: no face-window radios remain; only the box style saves from this tab.
  assert.equal(walk(panel).some(item => item.props.role === 'radio' && text(item) === '关闭'), false)
})
