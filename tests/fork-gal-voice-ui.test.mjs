import {stagePageSource} from './helpers/stage-page-source.mjs' // private fork
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { forkBubbleCharacter } from '../tavern-plugin/src/client/fork-bubble-line.cjs' // private fork: production speaker resolver

// Private fork (docs/fork/galgame-stage.md): the stage text box's replay button on the name plate and the
// backlog's voice badge / close button / hint, rendered with a minimal createElement stand-in.
const read = name => readFile(new URL('../tavern-plugin/src/client/' + name, import.meta.url), 'utf8')
const stage = await read('fork-gal-stage.js'), backlog = await read('fork-gal-backlog.js'), voices = await read('fork-voice.js')
const history = await read('fork-gal-history.js')
const css = await readFile(new URL('../tavern-plugin/lib/client-assets/fork-theme.css', import.meta.url), 'utf8')
const between = (text, a, b) => { const i = text.indexOf(a), j = text.indexOf(b, i); assert.ok(i >= 0 && j > i, a); return text.slice(i, j) }
const h = (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity).filter(item => item != null && item !== false) })
const walk = tree => tree && typeof tree === 'object' ? [tree, ...tree.children.flatMap(walk)] : []
const text = tree => tree && typeof tree === 'object' ? tree.children.map(text).join('') : String(tree ?? '')
const cls = (node, name) => Boolean(node && node.props && String(node.props.className || '').split(' ').includes(name))
const bare = css.replace(/\/\*[\s\S]*?\*\//g, '')
const rules = selector => [...bare.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(match => match[1].split(',').some(part => part.trim() === selector)).map(match => match[2]).join(';')

function plate(props) {
  const ctx = { React: { createElement: h }, ForkIcon: 'Icon' }
  vm.runInNewContext(between(stage, 'function ForkGalNamePlate(', '// Mounted in the session shell') + ';this.Plate=ForkGalNamePlate;', ctx)
  return ctx.Plate(props)
}

test('name plate: the replay button follows the name on the same line, only when the line is voiced', () => {
  let replays = 0
  const onReplay = () => { replays++ }
  const classic = plate({ name: 'Neuro-sama', classic: true, voiceState: 'ready', onReplay })
  assert.ok(cls(classic, 'fork-gal-name'))
  assert.equal(text(classic.children[0]), '【Neuro-sama】')
  const button = classic.children[1]
  assert.equal(button.type, 'button')
  assert.ok(cls(button, 'fork-gal-voice'))
  assert.equal(classic.children.length, 2, 'classic: 【名字】 then the button, nothing else')
  assert.deepEqual([button.props['data-state'], button.props['aria-label'], button.props['aria-keyshortcuts']], ['ready', '重播这一句', 'R'])
  assert.match(button.props.title, /（R）$/, 'tooltip names the shortcut')
  let stopped = 0
  button.props.onClick({ stopPropagation() { stopped++ } })
  assert.deepEqual([replays, stopped], [1, 1], 'replays without turning the page')
  for (const key of ['Enter', ' ']) button.props.onKeyDown({ key, stopPropagation() { stopped++ } })
  button.props.onKeyDown({ key: 'ArrowRight', stopPropagation() { stopped += 10 } })
  assert.equal(stopped, 3, 'Enter / Space on the focused button do not reach the stage page-turn handler')
  assert.equal(plate({ name: 'Neuro-sama', classic: true, voiceState: 'loading', onReplay }).children[1].props.title, '语音准备中')

  assert.equal(walk(plate({ name: 'Neuro-sama', classic: true, voiceState: '', onReplay })).some(node => cls(node, 'fork-gal-voice')), false, 'no voice, no button')
  assert.equal(text(plate({ name: 'Neuro-sama', classic: true, film: true, voiceState: 'ready', onReplay }).children[0]), 'Neuro-sama', 'film mode: bare name')

  for (const theme of ['gothic', 'magical']) {
    const other = plate({ name: 'Neuro-sama', mood: '喜悦', classic: false, voiceState: 'playing', onReplay })
    assert.deepEqual(other.children.map(node => node.type === 'button' ? 'button' : node.props.className || node.type), ['fork-gal-name-gem', 'b', 'span', 'button'], theme)
    assert.equal(walk(plate({ name: 'Neuro-sama', classic: false, voiceState: '', onReplay })).some(node => node.type === 'button'), false, theme + ': no voice, no button')
  }
})

// private fork: a failed voice is not an endless loading indicator or a failed stage.
test('name plate exposes a scoped voice warning and explicit retry after provider failure', () => {
  for (const classic of [true, false]) {
    let retried = 0;
    const tree = plate({name:'大肥鱼',classic,voiceState:'error',voiceError:'QWEN_BILLING_REQUIRED',onReplay:()=>retried++});
    const button = walk(tree).find(node => cls(node,'fork-gal-voice'));
    assert.equal(text(button),'⚠ 配音');
    assert.match(button.props.title,/千问额度或账户余额不足/);
    assert.match(button.props['aria-label'],/配音失败.*点击重试/);
    assert.equal(button.props['data-state'],'error');
    assert.equal(retried,0);
    button.props.onClick({stopPropagation(){}});
    assert.equal(retried,1);
  }
  assert.match(stage,/const voiceError = \(playingHere \? player\.error : null\) \|\| forkVoicePlayer\.getError\(voice\)/);
  assert.match(stage,/const voiceState = voiceError \? "error"/);
  assert.match(css,/fork-gal-voice\[data-state="error"\][^{]*\{[^}]*width: auto/);
});

test('stage: the replay button left the control row; the name plate is the only place it renders', () => {
  const controls = between(stage, 'h("div", { className: "fork-gal-controls"', 'function control(')
  assert.doesNotMatch(controls, /fork-gal-voice|replay/)
  assert.equal(stage.split('"fork-gal-voice"').length - 1, 1)
  // private fork: the nameplate receives the card-resolved display label, not the state ID.
  // private fork (owner 2026-10): no figure colour prop; preserve canonical speaker resolution.
  assert.match(stage, /h\(ForkGalNamePlate, \{ name, mood: forkBubbleMoodLabel\(current\.mood, moodList, config, speaker\), classic, film, voiceState, voiceError, onReplay: replay \}\)/)
  assert.doesNotMatch(css, /\.fork-gal-controls \.fork-gal-voice/, 'no leftover classic control-row voice styles')
  const classicVoice = rules('.fork-gal-stage[data-theme="classic"]:not(.is-film) .fork-gal-box .fork-gal-name .fork-gal-voice')
  assert.match(classicVoice, /width: calc\(var\(--cl-name\) \* 1\.5\)/, 'classic: sized to the name line')
  assert.match(rules('.fork-gal-name .fork-gal-voice:focus-visible'), /outline: 2px solid/)
})

function renderBacklog(props, player = null) {
  let slots = [], cursor = 0
  const React = {
    createElement: h,
    useState(v) { const i = cursor++; if (!(i in slots)) slots[i] = typeof v === 'function' ? v() : v; return [slots[i], n => { slots[i] = n }] },
    useRef(v) { const i = cursor++; if (!(i in slots)) slots[i] = { current: v }; return slots[i] },
    useMemo: fn => fn(), useEffect() {}, useLayoutEffect() {}
  }
  const ctx = {
    React, forkBubbleCharacter, ForkPackImage:'img', ForkIcon: 'Icon', ForkHelpTip: 'HelpTip', forkLipSync: { wakes: 0, wake() { this.wakes++ } },
    forkVoicePlayer: { get: () => player, subscribe: () => () => {} },
    useLiveTavernView: () => null, tavernStoryTurnForDshTurn: (view, turn) => turn
  }
  vm.runInNewContext(history + '\n' + (stagePageSource + '\n' + between(stage, '// Plain reading text', '// The stage is a full-screen mode')) + '\n' + backlog + '\n' +
    voices.slice(voices.indexOf('function ForkVoiceButton(')) + ';this.Backlog=ForkGalBacklog;this.VoiceButton=ForkVoiceButton;this.pages=forkGalPages;', ctx)
  return { ctx, tree: ctx.Backlog(props) }
}

test('backlog: the chat bubble voice badge on the avatar, a corner close button, no permanent hint line', () => {
  const clicks = []
  const voice = { owner: 'o', id: 'v1', status: { state: 'ready' }, player: null, click() { clicks.push('v1') } }
  const parts = [
    { turn: 1, index: 0, segments: [{ kind: 'bubble', alias: 'neuro', name: 'Neuro-sama', mood: '喜悦', text: '你好' }], voices: { 0: voice } },
    { turn: 2, index: 0, segments: [{ kind: 'markdown', text: '旁白。' }, { kind: 'bubble', alias: 'evil', name: 'Evil', mood: '平静', text: '嗯' }], voices: {} }
  ]
  const partsMap = new Map(parts.map(part => [part.turn + ':' + part.index, part]))
  let closed = 0
  const jumps = []
  const config={characters:['neuro','evil'].map(alias=>({alias:'f_'+alias,aliases:[alias],ref:{packId:'pack',figureId:alias}}))} // private fork
  const props = { sessionId: 's', config, partsMap, turn: 2, page: 1, colorOf: () => '#f06aa0', avatarOf: alias => {assert.ok(['f_neuro','f_evil'].includes(alias));return {identity:'avatar-hash',src:'a.webp'}}, nameOf: () => '', quote: true, onJump: page => jumps.push(page), onClose: () => { closed++ } }
  const first = renderBacklog(props)
  // private fork: backlog uses the session index; voice handles are resolved for visible rows.
  props.textIndex = new Map(parts.map(part=>[part.turn,{text:{pages:first.ctx.pages([part])}}]))
  props.voiceOf = value=>value
  props.pages = first.ctx.pages([parts[1]])
  const { ctx, tree } = renderBacklog(props, { owner: 'o', id: 'v1', audio: { paused: false, pause() { this.paused = true; clicks.push('pause') } } })
  const nodes = walk(tree)

  // Voice: the story view's ForkVoiceButton, inside the avatar box on the left, with the live player state.
  const badges = nodes.filter(node => node.type === ctx.VoiceButton)
  assert.equal(badges.length, 1, 'only the voiced line has a badge')
  const face = nodes.find(node => cls(node, 'fork-gal-backlog-face') && node.children.includes(badges[0]))
  assert.ok(face, 'the badge sits in the avatar box')
  assert.equal(face.props['aria-hidden'], undefined, 'the avatar box holding a button is not hidden from assistive tech')
  const row = nodes.find(node => cls(node, 'fork-gal-backlog-row') && node.children[0] === face)
  assert.ok(cls(row, 'is-jump') && row.children.length === 2, 'historical rows jump too; avatar + body without a right-hand voice column')
  assert.equal(nodes.some(node => /fork-gal-backlog-(voice|side)/.test(node.props.className || '')), false)
  const rendered = ctx.VoiceButton(badges[0].props)
  assert.ok(cls(rendered, 'fork-voice-button'))
  assert.equal(rendered.props['data-voice-state'], 'playing', 'reflects the current player, not the published snapshot')
  let stopped = 0
  rendered.props.onClick({ stopPropagation() { stopped++ } })
  assert.deepEqual([clicks, stopped, ctx.forkLipSync.wakes], [['pause'], 1, 1], 'private fork: pauses native audio, wakes lip sync, never jumps')

  // A key pressed on a control inside a current-turn row does not trigger the row's jump.
  const jumpRow = nodes.find(node => cls(node, 'fork-gal-backlog-row') && cls(node, 'is-jump'))
  const other = {}
  jumpRow.props.onKeyDown({ key: 'Enter', target: other, currentTarget: jumpRow, preventDefault() {}, stopPropagation() {} })
  assert.deepEqual(jumps, [])
  jumpRow.props.onKeyDown({ key: 'Enter', target: jumpRow, currentTarget: jumpRow, preventDefault() {}, stopPropagation() {} })
  assert.equal(jumps.length, 1)

  // Close: a direct child of the overlay (top-right corner via CSS), not part of the title row.
  assert.ok(cls(tree, 'fork-gal-backlog'))
  const close = tree.children.find(node => cls(node, 'fork-gal-backlog-close'))
  assert.ok(close, 'close is a direct child of the overlay')
  assert.equal(close.type, 'button')
  assert.deepEqual([close.props['aria-label'], close.props.title], ['关闭履历', '关闭履历（Esc / 右键）'])
  close.props.onClick()
  assert.equal(closed, 1)
  const head = tree.children.find(node => cls(node, 'fork-gal-backlog-head'))
  assert.equal(walk(head).some(node => node.type === 'button'), false, 'the title row has no close button')
  const closeCss = rules('.fork-gal-stage .fork-gal-backlog-close')
  for (const declaration of ['position: absolute', 'top: clamp(', 'right: clamp(', 'border: 0', 'background: var(--gal-ui-surface-2)']) assert.ok(closeCss.includes(declaration), declaration) // private fork: an opaque disc over the dimmed scene
  assert.ok(rules('.fork-gal-stage .fork-gal-backlog-close:hover'))
  assert.match(rules('.fork-gal-stage .fork-gal-backlog-close:focus-visible'), /outline: 2px solid var\(--bl-accent\)/)

  // Hint: only inside the ? tip beside the title; no footer line.
  assert.equal(nodes.some(node => /fork-gal-backlog-foot/.test(node.props.className || '')), false)
  const tip = walk(head).find(node => node.type === 'HelpTip')
  assert.ok(tip, 'a ? tip next to the title')
  assert.match(text(tip), /点击本轮的句子回到那一页/)
  const hintHolders = nodes.filter(node => node.children.some(child => typeof child === 'string' && child.includes('右键或 Esc 关闭')))
  assert.ok(hintHolders.every(node => walk(tip).includes(node)), 'the hint text renders nowhere else')
  assert.doesNotMatch(css, /fork-gal-backlog-foot/)
  assert.ok(css.includes('[data-fork-gal-stage] .fork-popover.fork-help-tip-body { z-index: 2147483002; }'), 'the tip floats above the stage mount')

  // The badge uses the bubble's own rules (same selectors list), themed through the avatar box's variables.
  const badgeRule = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find(match => match[1].includes('.fork-bubble .fork-bubble-portrait > .fork-voice-button,'))
  assert.ok(badgeRule && badgeRule[1].includes('.fork-gal-backlog .fork-gal-backlog-face > .fork-voice-button'))
  assert.match(rules('.fork-gal-backlog-face'), /position: relative/)
})
