// private fork: follow protocol extraction paths; behavior assertions unchanged.
import test from 'node:test'
import assert from 'node:assert/strict'
import { forkStagePacing } from '../tavern-plugin/packages/dsh-presentation-protocol/src/fork-stage-pacing.cjs'
const cue = (at, mood, extra = {}) => ({ at, ...extra, commands: mood ? [{ op: 'light', value: mood }] : [] })
const replay = (start, entries, units) => forkStagePacing(start, entries, undefined, units)
const carry = result => ({ scene: result.pacing.scene, music: result.music, lighting: result.lighting, pacing: result.pacing })
const moods = result => result.entries.flatMap(e => e.commands || []).map(c => c.value)

test('mood dwell is eight paragraphs; one turning point, no return, pure and deterministic', () => {
  const entries = [cue(1, 'warm', { scene: 'room' }), cue(8, 'cold'), cue(9, 'cold'), cue(17, 'warm'), cue(25, 'dream')]
  const before = JSON.stringify(entries), result = replay({}, entries, 25)
  assert.deepEqual(moods(result), ['warm', 'cold'])
  assert.equal(result.stats.dropped.pacingLight, 3)
  assert.equal(result.pacing.moodChanges, 1)
  assert.equal(JSON.stringify(entries), before)
  assert.deepEqual(replay({}, entries, 25), result)
  assert.deepEqual(replay({}, result.entries, 25).pacing, result.pacing)
})

test('scene entries reset allowance and recent moods, but do not waive dwell; time/auto unaffected', () => {
  const result = replay({}, [cue(1, 'warm', { scene: 'room' }), cue(9, 'cold'), cue(10, 'dream', { scene: 'garden' }),
    cue(11, 'night'), cue(12, 'auto'), cue(17, 'warm'), cue(25, 'none'), cue(33, 'dream', { scene: 'room' }), cue(41, 'clear')])
  assert.deepEqual(moods(result), ['warm', 'cold', 'night', 'auto', 'warm', 'dream', 'clear'])
  assert.equal(result.lighting.time, 'auto')
  assert.equal(result.lighting.mood, 'none')
})

test('cross-turn budget and dwell include uncued trailing paragraphs; no-op cues do not reset dwell', () => {
  const first = replay({}, [cue(1, 'warm', { scene: 'room', music: 'A' }), cue(4, 'warm')], 6)
  const second = replay(carry(first), [cue(1, 'cold', { music: 'B' }), cue(3, 'cold', { music: 'B' })], 10)
  assert.deepEqual(moods(second), ['cold'])
  assert.equal(second.music, 'A')
  assert.equal(second.pacing.moodSetAt, 8)
  const third = replay(carry(second), [cue(1, 'dream', { music: 'C' })], 20)
  assert.deepEqual(moods(third), [])
  assert.equal(third.music, 'A')
})

test('music only changes at scene or accepted turning point, holds 12 paragraphs, stop follows same rule', () => {
  const result = replay({}, [cue(1, 'warm', { scene: 'room', music: 'A' }), cue(10, null, { music: 'B' }),
    cue(13, 'cold', { music: 'B' }), cue(25, 'dream', { music: 'C' }), cue(26, null, { scene: 'garden', music: 'none' }),
    cue(27, null, { scene: 'room', music: 'A' })], 30)
  assert.deepEqual(result.entries.filter(e => Object.hasOwn(e, 'music')).map(e => e.music), ['A', 'B', 'none'])
  assert.equal(result.music, '')
  assert.equal(result.stats.dropped.pacingMusic, 3)
})

test('recent two distinct tracks block a return at a turning point but scene cues can return', () => {
  const base = carry(replay({}, [cue(1, 'warm', { scene: 'room', music: 'A' })], 20))
  base.pacing.recentTracks = ['B', 'A']
  const result = replay(base, [cue(1, 'cold', { music: 'B' }), cue(13, 'dream', { scene: 'garden', music: 'B' })])
  assert.equal(result.entries[0].music, undefined)
  assert.equal(result.entries[1].music, 'B')
})

test('legacy starts without counters retain their state and begin conservative dwell', () => {
  const result = replay({ scene: 'room', light: 'warm', music: 'A' }, [cue(1, 'cold', { music: 'B' }), cue(13, 'cold', { music: 'B' })], 20)
  assert.deepEqual(moods(result), ['cold'])
  assert.equal(result.music, 'B')
  assert.equal(result.pacing.paragraph, 20)
})

test('catalogue classification leaves custom time looks untouched and uses explicit mood overrides', () => {
  const looks = [{ id: 'blue', layer: 'time' }, { id: 'night', layer: 'mood' }, { id: 'warm', layer: 'mood' }]
  const result = forkStagePacing({}, [cue(1, 'warm'), cue(2, 'blue'), cue(3, 'night')], looks, 3)
  assert.deepEqual(moods(result), ['warm', 'blue'])
  assert.deepEqual(result.lighting, { time: 'blue', mood: 'warm' })
})

test('event moods (look.event) are never dropped and leave the scene mood budget untouched', () => {
  const looks = [{ id: 'warm', label: '暖色', layer: 'mood' }, { id: 'cold', label: '冷色', layer: 'mood' }, { id: 'timestop', label: '时间停止', layer: 'mood', event: true }]
  const entries = [cue(1, 'warm', { scene: 'street' }), cue(3, 'timestop'), cue(4, 'warm'), cue(6, 'timestop'), cue(7, 'warm'), cue(12, 'cold')]
  const result = forkStagePacing({}, entries, looks, 12)
  assert.deepEqual(moods(result), ['warm', 'timestop', 'warm', 'timestop', 'warm', 'cold'])
  assert.equal(result.stats.dropped.pacingLight, 0)
  assert.equal(result.pacing.moodChanges, 1)
  assert.equal(result.lighting.mood, 'cold')
  // Without the flag the same look is paced like any mood.
  assert.ok(forkStagePacing({}, entries, looks.map(look => ({ ...look, event: false })), 12).stats.dropped.pacingLight > 0)
})
