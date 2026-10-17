// private fork: 「文字演出」 renderer data — one entry per style, measured timing, intensity, 减少闪烁 and the gate.
// Payloads follow docs/fork/textcard-mod.md v1 ({version, style, parts, steps, sub?, intensity, stepFrames, history}).
import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'

const require = createRequire(import.meta.url)
const {TEXTCARD_STYLES, TEXTCARD_TIMING, planTextcard, textcardHistory, createTextcardGate, textcardPeak} = require('../tavern-plugin/src/client/fork-textcard-presets.cjs')
const frameMs = 1000 / 24
const words = ['黑发', '盾', '(0401)', '齿轮', '崩塌', '回头', '名字是——', '想不起来']
const samples = {
  punct: ['赤齣'], title: ['ひたぎクラブ'], name: ['鹿目まどか'], kanji: ['騙'], word: ['冥土'], vertical: ['她的名字，\n叫晓美焰。'], page: ['长'.repeat(300)],
  pattern: ['真的？'], split: ['な', 'ま', 'え'], morph: ['蟹'], pair: ['關', '絹'], build: ['阿', '阿良', '阿良々木さんは'], count: ['3', '2', '1', '0'],
  code: ['5W1H'], diagram: ['家', '父', '母', '我'], marker: ['recall'], colour: ['赤', '白', '黒'], oversized: ['有私'], flash: words,
}
const payload = (style, parts, extra = {}) => ({version: 1, playback: 'live-once', style, parts, steps: parts, intensity: 'standard', ...extra})

test('19 contract styles, each one data entry with a measured median and a working plan', () => {
  assert.deepEqual(Object.keys(TEXTCARD_STYLES).sort(), Object.keys(samples).sort())
  const cats = new Set(Object.values(TEXTCARD_STYLES).map(style => style.cat))
  for (const cat of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 22, 23]) assert.ok(cats.has(cat), 'category ' + cat)
  for (const cat of [17, 18, 19, 20, 21, 24]) assert.ok(!cats.has(cat), 'out of scope ' + cat)
  for (const [id, style] of Object.entries(TEXTCARD_STYLES)) {
    for (const key of ['layout', 'bg', 'type', 'motif', 'timing', 'seq', 'tag']) assert.ok(style[key], id + '.' + key)
    assert.ok(TEXTCARD_TIMING[style.timing].f >= 3, id + ' timing')
    const plan = planTextcard(payload(id, samples[id]))
    assert.ok(plan && plan.frames.length, id + ' plans')
    for (const frame of plan.frames) assert.ok(Number.isInteger(frame.f) && frame.f >= 3 && Math.abs(frame.ms - frame.f * frameMs) < 1e-9, id + ' whole frames')
  }
  assert.equal(planTextcard({style: 'nope', parts: ['x']}), null)
  assert.equal(planTextcard({style: 'word', parts: []}), null, 'nothing to show')
  assert.equal(planTextcard(payload('morph', ['龍'])), null, 'morph only knows its preset glyphs')
})

test('timing: standard = median, intensity scales, payload stepFrames win, colour changes hold ≥ 9 frames', () => {
  assert.equal(planTextcard(payload('word', ['冥土'])).frames[0].f, 20)
  assert.equal(planTextcard(payload('title', ['x'])).frames[0].f, 58)
  assert.equal(planTextcard(payload('word', ['冥土'], {intensity: 'restrained'})).frames[0].f, 26)
  assert.equal(planTextcard(payload('word', ['冥土'], {intensity: 'intense'})).frames[0].f, 15)
  assert.deepEqual(planTextcard(payload('word', ['冥土'], {stepFrames: [33]})).frames.map(f => f.f), [33])
  const flash = planTextcard(payload('flash', words, {intensity: 'intense'}))
  assert.equal(flash.frames.length, 8, 'no silent truncation')
  assert.ok(flash.frames.every(frame => frame.bg === 'ink'), 'a flash sequence keeps one ground')
  assert.deepEqual(flash.frames.map(frame => frame.f), [9, 6, 6, 6, 6, 6, 6, 9], 'card in/out hold the colour minimum')
  const pair = planTextcard(payload('pair', ['關', '絹'], {intensity: 'intense'}))
  assert.equal(pair.frames.length, 8)
  pair.frames.forEach((frame, i) => { if (i && frame.bg !== pair.frames[i - 1].bg) assert.ok(frame.f >= 9) })
})

test('减少闪烁: at most four states of ≥ 11 frames, one ground, no inversion or motion', () => {
  for (const id of ['flash', 'pair', 'count', 'colour']) {
    const plan = planTextcard(payload(id, samples[id], {intensity: 'intense'}), {reduced: true})
    assert.ok(plan.frames.length <= 4, id)
    assert.ok(plan.frames.every(frame => frame.f >= 11), id)
    assert.equal(new Set(plan.frames.map(frame => frame.bg)).size, 1, id + ' one ground')
  }
  assert.deepEqual(planTextcard(payload('pair', ['關', '絹']), {reduced: true}).frames.map(frame => frame.state.text), ['關', '絹', '關', '絹'])
  assert.ok(new Set(planTextcard(payload('pair', ['關', '絹'])).frames.map(frame => frame.bg)).size > 1, 'the full pair inverts')
  assert.equal(planTextcard(payload('morph', ['蟹']), {reduced: true}).frames[0].state.converge, false)
  assert.ok(planTextcard(payload('punct', ['赤齣']), {reduced: true}).frames[0].f >= 12)
})

test('履历: one line per performance from the payload history; a flash sequence is one line', () => {
  const history = {kind: 'textcard', style: 'flash', text: words.join(' / '), parts: words}
  assert.deepEqual(textcardHistory(payload('flash', words, {history})), {tag: '快闪', parts: words, sub: ''})
  assert.deepEqual(textcardHistory(payload('marker', ['recall'])).parts, ['回想'])
  assert.deepEqual(textcardHistory(payload('build', samples.build)).parts, ['阿良々木さんは'])
})

test('gate: never more than 3 colour changes in any second, whatever the request rate', () => {
  const gate = createTextcardGate(), painted = []
  let t = 0
  for (let i = 0; i < 40; i++) { t = Math.max(t + 84, gate.slot(t + 84)); gate.mark(t); painted.push(t) }
  assert.ok(textcardPeak(painted, 1000) <= 3)
  assert.ok(painted.slice(1).every((at,i)=>at-painted[i]>=375), 'entry, exit and inter-card colour changes are nine frames apart')
  const slot = createTextcardGate(); slot.mark(0); slot.mark(10); slot.mark(20)
  assert.equal(slot.slot(30), 1050)
})
