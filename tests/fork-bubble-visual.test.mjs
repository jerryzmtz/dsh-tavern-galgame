// private fork: obsolete v1 editor assertions migrate to fork-asset-packs-ui.test.mjs.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { normalizeBubbleConfig } from '../tavern-plugin/lib/domain/dialogue-bubbles.js'

const css = await readFile(new URL('../tavern-plugin/lib/client-assets/fork-theme.css', import.meta.url), 'utf8')
const presets = await readFile(new URL('../tavern-plugin/src/client/fork-bubble-presets.js', import.meta.url), 'utf8')
const voices = await readFile(new URL('../tavern-plugin/src/client/fork-voice.js', import.meta.url), 'utf8')
const modes = await readFile(new URL('../tavern-plugin/src/client/fork-bubble-modes.js', import.meta.url), 'utf8')
const modesHelpers = modes.slice(0, modes.indexOf('// ---------- Components'))
const rules = selector => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(match => match[1].split(',').some(part => part.trim() === selector)).map(match => match[2])
const h = (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity).filter(item => item != null && item !== false) })
const walk = tree => tree && typeof tree === 'object' ? [tree, ...tree.children.flatMap(walk)] : []
const text = tree => tree && typeof tree === 'object' ? tree.children.map(text).join(' ') : String(tree || '')

test('voice badge: scoped px hit area, pinned host button properties, px disc drawn by ::before', () => {
  const button = rules('.fork-bubble .fork-bubble-portrait > .fork-voice-button').join(';')
  for (const declaration of ['--voice-disc: 22px', 'min-width: 0', 'padding: 0', 'border-radius: 50%', 'background: transparent', 'box-shadow: none', 'font: 400 0/0'])
    assert.ok(button.includes(declaration), declaration)
  const disc = rules('.fork-bubble .fork-bubble-portrait > .fork-voice-button::before').join(';')
  assert.match(disc, /width: var\(--voice-disc\)/)
  assert.match(disc, /border-radius: 50%/)
  assert.doesNotMatch(disc + button, /rgb\(24 23 30/, 'no heavy black brick')
  assert.doesNotMatch(disc + button, /!important|\bem\b/)
  assert.match(css, /@media \(pointer: coarse\) \{ \.fork-bubble \.fork-bubble-portrait > \.fork-voice-button \{ --voice-disc: 24px; --voice-hit: 34px; \} \}/)
  // private fork: the voice badge's loading wheel is the shared ForkSpinner; its reduced-motion rule (slower, never
  // frozen) is kept but scoped off like the badge's own (user keeps animations).
  assert.match(css, /prefers-reduced-motion: reduce\) and \(update: none\) \{\n  \.fork-bubble \.fork-bubble-portrait > \.fork-voice-button::before/, 'private fork: reduced-motion rules are kept but scoped off (user keeps animations)')
  assert.match(css, /prefers-reduced-motion: reduce\) and \(update: none\) \{ \.fork-spinner \{ --fork-spinner-period: 2\.4s; \} \}/)
  assert.match(css, /\.fork-voice-spinner \{ --fork-spinner-size: 12px; \}/, 'px size: the badge button has font-size 0')
  assert.match(css, /forced-colors: active\) \{\n  \.fork-bubble \.fork-bubble-portrait > \.fork-voice-button/)
  assert.doesNotMatch(css, /^\.fork-voice-button\s*\{/m, 'no unscoped legacy badge rule remains')
})

test('voice badge glyphs share one 12px svg box for every state', () => {
  const context = { React: { createElement: h } }
  vm.runInNewContext(voices.slice(voices.indexOf('function ForkVoiceButton('), voices.indexOf('// Voice library: global')) + ';this.Button=ForkVoiceButton;', context)
  for (const voice of [{}, { status: { state: 'ready' } }, { player: { owner: 'o', id: 'x' } }, { player: { owner: 'o', id: 'x', audio: { paused: false } } }, { status: { error: 'x' } }]) {
    const svg = context.Button({ voice: { owner: 'o', id: 'x', click() {}, ...voice } }).children[0]
    assert.deepEqual([svg.props.width, svg.props.height, svg.props.viewBox], [12, 12, '0 0 24 24'])
  }
})

function render(fn, props) {
  let slots = [], cursor = 0
  const React = { createElement: h, useState(v) { const i = cursor++; if (!(i in slots)) slots[i] = typeof v === 'function' ? v() : v; return [slots[i], n => { slots[i] = n }] }, useRef(v) { const i = cursor++; if (!(i in slots)) slots[i] = { current: v }; return slots[i] }, useEffect() {}, useSyncExternalStore(_, get) { return get() } }
  return { React, run: () => { cursor = 0; return fn()(props) } }
}

test('floating menus and tips: fixed, above the modal (z-index over 2140), at least 260px wide, scoped option styles reach them', () => {
  const popover = /\n\.fork-popover \{([^}]*)\}/.exec(css)[1]
  assert.match(popover, /position: fixed/)
  assert.ok(Number(/z-index: (\d+)/.exec(popover)[1]) > 2140)
  assert.match(rules('.fork-popover.fork-voice-menu').join(';'), /min-width: min\(260px/)
  assert.match(css, /:is\(\.fork-bubble-settings, \.fork-popover\) \.fork-voice-option \{/)
  assert.match(css, /\.fork-modal\.is-compact \.fork-modal-nav \{ width: 60px;/)
  assert.doesNotMatch(css, /\.fork-help-tip:hover \.fork-help-tip-body/, 'tips no longer rely on an absolutely positioned child')
})
