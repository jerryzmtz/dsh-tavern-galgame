// private fork (O29): a bubble is unfinished only while its reply is actually streaming, never because of its
// text shape. The recorded fish-18 reply (gemini longrun, D08 retest) ends a complete inner thought with an empty
// voice separator `…*]|`; the parser used to call it streaming, so chat and 履历 dropped the closing bracket and
// 履历 showed 「正在生成」 on a finished turn.
import test from 'node:test'
import assert from 'node:assert/strict'
import { forkParseBubbles } from '../tavern-plugin/src/client/fork-bubble-line.cjs'
import { nativeNode, sessionHarness } from './helpers/stage-session-harness.mjs'
import { FISH_18 } from './fixtures/o29-fish-18.mjs'

const THOUGHT = '哼哼，那些冷冰冰的怪词才不是大肥鱼的风格呢！经历了这么可怕的深海密室，最想要的肯定不是什么大道理！'

test('O29 parser: streaming comes from the caller, not from a trailing voice separator', () => {
  const [done] = forkParseBubbles(FISH_18, false)
  assert.equal(done.kind, 'bubble')
  assert.equal(done.streaming, false, 'a finished reply is not streaming')
  assert.equal(done.thought, true)
  assert.equal(done.text, THOUGHT)
  assert.equal(done.alias, 'f_efed52c1c67556e0')
  assert.equal(done.speech, '', 'an empty voice field still never falls back to the display text')
  // Same displayed bubble as the reply without the dangling separator.
  const [plain] = forkParseBubbles(FISH_18.slice(0, -1), false)
  for (const key of ['alias', 'name', 'mood', 'text', 'thought', 'streaming']) assert.equal(done[key], plain[key], key)
  // A genuinely live tail still waits for its voice field.
  assert.equal(forkParseBubbles(FISH_18, true)[0].streaming, true)
  assert.equal(forkParseBubbles(FISH_18.replace(/\*\]\|$/, ''), true)[0].streaming, true)
  // Earlier lines of a streaming reply are finished; only the last line is live.
  const [first, second] = forkParseBubbles(FISH_18 + '\n@bubble:f_efed52c1c67556e0|大肥鱼|得意|[*还', true)
  assert.equal(first.streaming, false)
  assert.equal(second.streaming, true)
  // A reply that ended with an unclosed bracket (cancelled) is finished too and keeps its inner-thought form.
  const [cut] = forkParseBubbles('@bubble-voice:a|A|平静|[*想到一半', false)
  assert.equal(cut.kind, 'bubble')
  assert.equal(cut.streaming, false)
  assert.equal(cut.thought, true)
  assert.equal(cut.text, '想到一半')
})

test('O29 stage/履历 pages: pending follows the native step status of the recorded reply', () => {
  const h = sessionHarness({ nodes: [nativeNode(18, FISH_18, { status: 'running' })], running: true })
  try {
    const live = h.state().text.pages
    assert.equal(live.length, 1)
    assert.equal(live[0].thought, true)
    assert.equal(live[0].pending, true, 'while the step runs the tail is pending')
    h.binding.chunk(nativeNode(18, FISH_18, { status: 'closed' }))
    h.binding.run(false)
    const state = h.state()
    const page = state.text.pages[0]
    assert.equal(state.text.streaming, false)
    assert.equal(page.pending, false, 'the finished turn is not 「正在生成」')
    assert.equal(page.thought, true)
    assert.equal(page.text, '（' + THOUGHT + '）', 'both brackets of the inner thought')
    // The 履历 reads the same session text index rows.
    const row = state.textIndex.get(18)
    assert.ok(row, 'turn 18 is indexed for the backlog')
    assert.ok(row.text.pages.every(item => !item.pending))
    assert.ok(row.text.pages.every(item => item.text.endsWith('）')))
  } finally { h.dispose() }
})
