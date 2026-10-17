import test from 'node:test'
import assert from 'node:assert/strict'
import { widgetsAt, normalizeWidgetProps, forkWidgetShownSeconds } from '../tavern-plugin/lib/domain/stage-widgets.js'

import { createWidgetValidator } from '../tavern-plugin/lib/domain/stage-widgets.js'
const context = { stage: { widgets: true }, units: 10, scenes: ['room', 'street'], start: { scene: 'room' } }
const show = (widgetId = 'pink-alarm', type = 'countdown', props = { remainingSeconds: 900, tick: 'page-live', tone: 'pink', icon: 'alarm' }, extra = {}) => ({ op: 'widget.show', widgetId, type, props, ...extra })
// private fork: historical playback fixtures use the widget owner's normalization, not a retired director.
const record = beats => {
  const errors = [], stats = {used: {}, dropped: {}}
  const validator = createWidgetValidator({enabled: true, units: 10, start: context.start, used: stats.used,
    error: (path, message, reason) => {errors.push({path, message}); stats.dropped[reason] = (stats.dropped[reason] || 0) + 1}})
  const entries = beats.map(beat => {
    const widgetTime = validator.boundary(beat.at, beat.scene, beat.widgetTime, 'fixture')
    const commands = beat.commands.map(command => validator.command(command, beat.at, 'fixture')).filter(Boolean)
    return {at: beat.at, ...(beat.scene ? {scene: beat.scene} : {}), ...(widgetTime !== undefined ? {widgetTime} : {}), commands}
  })
  return {key: 'reply-key', units: 10, widgetsVersion: 1, start: context.start, entries, errors, stats}
}
const at = (record, para, index = para) => widgetsAt({ number: 1, key: 'reply-key' }, { para, index }, record)
const fixture = () => record([{ at: 3, commands: [show()] }, { at: 4, widgetTime: 20, commands: [] }, { at: 7, commands: [{ op: 'widget.hide', widgetId: 'pink-alarm' }] }])
function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) } return value }

test('widgets: deterministic navigation and page-live story values, including multi-page paragraphs', () => {
  const r = freeze(fixture())
  assert.deepEqual(r.errors, [])
  assert.deepEqual(at(r, 2), [])
  for (const para of [3, 5, 3, 9, 4, 7, 3, 6, 1, 5]) {
    const list = at(r, para)
    if (para < 3 || para >= 7) assert.deepEqual(list, [])
    else assert.equal(list[0].remainingSeconds, para === 3 ? 900 : 880)
  }
  assert.deepEqual(at(r, 3, 1), at(r, 3, 2))
  const w = at(r, 3)[0]
  assert.deepEqual([0, 999, 1000, 12000].map(ms => forkWidgetShownSeconds(w, ms)), [900, 900, 899, 888])
  assert.equal(forkWidgetShownSeconds(at(r, 4)[0], 5000), 875)
  assert.equal(forkWidgetShownSeconds(w, 1000000), 0)
  assert.deepEqual(at(r, 3), at(fixture(), 3))
})

test('widgets: old/unknown versions and wrong identity/turn-end never produce widgets', () => {
  const r = fixture()
  for (const version of [undefined, 0, 2]) assert.deepEqual(at({ ...r, widgetsVersion: version }, 3), [])
  assert.deepEqual(widgetsAt({ number: 1, key: 'other' }, { para: 3 }, r), [])
  assert.deepEqual(widgetsAt({ number: 1, key: r.key }, { end: true }, r), [])
  assert.deepEqual(at({ ...r, entries: [], start: { widgets: at(r, 3), widgetTime: 400 } }, 3), [])
})

test('widgets: exclusive paragraph, actual scene change, story duration and default turn lifetime', () => {
  const r = record([
    { at: 1, commands: [show('a', 'note', { body: 'A' }, { lifetime: { until: 'paragraph', at: 3 } }), show('b', 'countdown', { remainingSeconds: 10 }, { lifetime: { until: 'scene-change' } }), show('c', 'notification', { body: 'C' }, { lifetime: { until: 'user-dismiss', durationSeconds: 5 } })] },
    { at: 2, scene: 'room', widgetTime: 4, commands: [] },
    { at: 4, scene: 'street', widgetTime: 5, commands: [] }
  ])
  assert.deepEqual(r.errors, [])
  assert.equal(at(r, 2).length, 3)
  assert.deepEqual(at(r, 3).map(w => w.widgetId), ['b', 'c'])
  assert.deepEqual(at(r, 4), [])
  assert.equal(at(record([{ at: 1, commands: [show()] }]), 10).length, 1)
})

test('widgets: updates replace complete props and reset only countdown anchor; duplicate hide is idempotent', () => {
  const r = record([
    { at: 1, commands: [show()] },
    { at: 2, widgetTime: 20, commands: [{ op: 'widget.update', widgetId: 'pink-alarm', props: { remainingSeconds: 600 } }] },
    { at: 3, widgetTime: 30, commands: [] },
    { at: 4, commands: [{ op: 'widget.hide', widgetId: 'pink-alarm' }, { op: 'widget.hide', widgetId: 'pink-alarm' }] }
  ])
  assert.deepEqual(r.errors, [])
  assert.equal(at(r, 3)[0].remainingSeconds, 590)
  assert.equal(at(r, 3)[0].props.tone, 'theme')
  assert.equal(at(r, 3)[0].clockRevision, 1)
  assert.equal(forkWidgetShownSeconds(at(r, 3)[0], 8000), 590)
  assert.equal(r.stats.used['widget.hide'], 1)
})

test('widgets: same-paragraph clocks preserve command ordering rather than moving old births forward', () => {
  const r = record([{ at: 1, commands: [show()] }, { at: 1, widgetTime: 20, commands: [] }, { at: 1, commands: [{ op: 'widget.update', widgetId: 'pink-alarm', props: { remainingSeconds: 600 } }] }, { at: 2, widgetTime: 25, commands: [] }])
  assert.deepEqual(r.errors, [])
  assert.equal(at(r, 2)[0].remainingSeconds, 595)
  const unchanged = record([{ at: 1, commands: [show()] }, { at: 1, widgetTime: 20, commands: [] }])
  assert.equal(at(unchanged, 1)[0].remainingSeconds, 880)
})

test('widgets: props are normalized, bounded by code points and contain no executable fields', () => {
  assert.equal(normalizeWidgetProps('notification', { body: 'ok', app: 'Inbox', frame: 'phone' }).frame, 'phone')
  assert.equal(normalizeWidgetProps('note', { body: '信', style: 'memo' }).style, 'memo')
  assert.equal(normalizeWidgetProps('chat-thread', { messages: [{ from: '她', text: '好', side: 'in' }] }).messages.length, 1)
  assert.ok(normalizeWidgetProps('note', { body: '😀'.repeat(1600) }))
  for (const [type, props] of [
    ['note', { body: 'a'.repeat(1601) }], ['note', { body: '', style: 'letter' }], ['countdown', { remainingSeconds: -1 }], ['countdown', { remainingSeconds: NaN }], ['countdown', { remainingSeconds: 1.2 }], ['countdown', { remainingSeconds: 86401 }], ['countdown', { remainingSeconds: 1, css: 'anything' }], ['notification', { body: 'x', frame: 'iframe' }], ['note', JSON.parse('{"body":"hi","__proto__":{}}')], ['chat-thread', { messages: Array(9).fill({ from: 'A', text: 'hi', side: 'in' }) }], ['chat-thread', { messages: [{ from: 'A', text: 'hi', side: 'left' }] }]
  ]) assert.equal(normalizeWidgetProps(type, props), null)
  // Plain text is retained literally, never parsed as HTML in the renderer.
  assert.equal(normalizeWidgetProps('note', { body: '<script>alert(1)</script>' }).body, '<script>alert(1)</script>')
})
