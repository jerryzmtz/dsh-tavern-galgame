import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'
import { forkSpinnerSource } from './helpers/fork-spinner.mjs'

const source = await readFile(new URL('../tavern-plugin/src/client/fork-voice.js', import.meta.url), 'utf8')
const h = (type, props, ...children) => ({ type, props, children })
const context = { React: { createElement: h } }
// private fork: the loading state shows the shared ForkSpinner.
vm.runInNewContext(forkSpinnerSource + source.slice(source.indexOf('function ForkVoiceButton('), source.indexOf('// Voice library: global')) + ';this.Button=ForkVoiceButton;this.ForkSpinner=ForkSpinner;', context)
for (const [state, voice, label] of [
  ['idle', {}, '合成并播放'],
  // private fork: readiness belongs to native TTS, not a card job status.
  ['idle', { status: { state: 'running' } }, '合成并播放'],
  ['loading', { player: { owner: 'one', id: 'line', loading: true } }, '正在准备语音'],
  ['playing', { player: { owner: 'one', id: 'line', audio: { paused: false } } }, '暂停播放'],
  ['paused', { player: { owner: 'one', id: 'line', audio: { paused: true } } }, '继续播放'],
  ['error', { player: { owner: 'one', id: 'line', error: 'Offline' } }, '重试语音'],
  ['idle', { player: { owner: 'other', id: 'line' } }, '合成并播放'],
]) {
  test(`private fork: avatar voice control ${state} / ${label}`, () => {
    const click = () => {}
    const button = context.Button({ voice: { owner: 'one', id: 'line', click, ...voice } })
    assert.equal(button.type, 'button')
    assert.equal(button.props['data-voice-state'], state)
    assert.equal(button.props['aria-label'], label)
    assert.equal(button.props.disabled, state === 'loading')
    assert.equal(button.props['aria-busy'], state === 'loading')
    if (!['playing','paused'].includes(state)) assert.equal(button.props.onClick, click)
    assert.equal(button.children.length, 1)
    if (state === 'loading') { assert.equal(button.children[0].type, context.ForkSpinner); assert.equal(button.children[0].props.className, 'fork-voice-spinner') }
    else if (state === 'error') { assert.equal(button.children[0].type, 'span'); assert.equal(button.children[0].children[0], '⚠') }
    else { assert.equal(button.children[0].type, 'svg'); assert.equal(button.children[0].props['aria-hidden'], true) }
  })
}
test('private fork: voice control is a sibling of the zoom button, including placeholder portraits', async () => {
  const bubbles = await readFile(new URL('../tavern-plugin/src/client/fork-bubbles.js', import.meta.url), 'utf8')
  const avatar = () => {}, voiceButton = () => {}
  // private fork: the row owns viewport observation; keep this structural renderer inert.
  const rowContext = { useForkFigureTextContrast() {}, useForkBubbleMedia: () => null, React: { createElement: h, useRef: value => ({current:value}), useState: value => [value, () => {}], useEffect() {} }, ForkBubbleAvatar: avatar, ForkVoiceButton: voiceButton, forkBubbleColor: () => '#888', forkBubbleMood: () => null, forkBubbleMoodList: () => [] }
  // private fork: the row uses the extracted display-name contract.
  const line = await readFile(new URL('../tavern-plugin/src/client/fork-bubble-line.cjs', import.meta.url), 'utf8')
  const resolution = await readFile(new URL('../tavern-plugin/packages/dsh-presentation-protocol/src/figure-resolution.cjs', import.meta.url), 'utf8')
  vm.runInNewContext(resolution + line + bubbles.slice(bubbles.indexOf('function forkBubbleMoodLabel('), bubbles.indexOf('function forkBubbleColor(')) + bubbles.slice(bubbles.indexOf('function ForkBubbleRow('), bubbles.indexOf('// Drop-in for TavernColoredMarkdown')) + ';this.Row=ForkBubbleRow;', rowContext)
  for (const voice of [undefined, { id: 'one' }]) {
    const row = rowContext.Row({ segment: { name: 'Homura', alias: 'homura', text: 'Hello' }, config: { characters: [] }, voice })
    const portrait = row.children[0]
    assert.equal(portrait.type, 'div')
    assert.equal(portrait.props.className, 'fork-bubble-portrait')
    assert.equal(portrait.children[0].type, avatar)
    assert.equal(portrait.children[0].props.zoomable, true)
    assert.equal(portrait.children[1]?.type, voice ? voiceButton : undefined)
  }
})
