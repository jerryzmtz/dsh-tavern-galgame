// Typed, bounded director input; the replay implementation is also bundled into the client.
import { forkWidgetBuiltins, FORK_WIDGET_SLOTS, forkWidgetObject, forkWidgetProps, forkWidgetState, forkWidgetBoundary, forkWidgetReduce } from '../../src/client/fork-stage-widgets.cjs'
export { widgetsAt, forkWidgetProps as normalizeWidgetProps, forkWidgetShownSeconds } from '../../src/client/fork-stage-widgets.cjs'
export const WIDGETS_VERSION = 1
export const WIDGET_CAPS = Object.freeze({ 'widget.show': 3, 'widget.update': 6, 'widget.hide': 4, commands: 12, bytes: 12 * 1024, clocks: 8 })
// private fork: notes/field prose belong to the catalogue, including third-party props.
// show and update reuse constraints only, so every field explanation is emitted once.
const orderedDefinitions = definitions => definitions.slice().sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
function widgetPropsContract(schema, path = 'props', prose = []) {
  if (Array.isArray(schema)) return schema.map((item, index) => widgetPropsContract(item, path + '.' + index, prose))
  if (!schema || typeof schema !== 'object') return schema
  return Object.fromEntries(Object.entries(schema).flatMap(([key, value]) => {
    if (key === 'description' && typeof value === 'string') { prose.push(path + ': ' + value); return [] }
    return [[key, widgetPropsContract(value, path + '.' + key, prose)]]
  }))
}
export const widgetCatalogue = (definitions = forkWidgetBuiltins) => orderedDefinitions(definitions).map(item => {
  const prose = []
  widgetPropsContract(item.propsSchema, 'props', prose)
  return `${item.id} - ${item.note}` + (prose.length ? '\n' + prose.join('\n') : '')
}).join('\n')
export const WIDGET_RULES = `Widgets are optional read-only stage props, not game state or executable applications.
Use them only when the completed reply explicitly shows a readable object or display on screen. Prefer no widget; normally use at most one per turn.
Never invent messages, deadlines, choices, objectives or hidden clues. Keep text brief and faithful; use only listed types, slots, icons and tones.
Use widgetId local to this turn. Show an ID once; update replaces its COMPLETE typed props; hide closes it. At most 3 births per turn and one active widget of each type. At most 6 updates, 4 hides, 12 widget commands and 12 KiB of props per submission.
All lifetimes end at turn end; paragraph lifetime is exclusive at. No cross-turn carry. Use frozen numbers unless the text explicitly describes ticking; page-live is presentation only and replays on page return.
Advance widgetTime only for explicit elapsed story time (cumulative seconds), never reading or wall-clock time. At most 8 anchors, each advancing at most 86400 seconds.
Widgets cannot modify variables, send messages, fetch URLs, play audio or delay reading. alarmRing is a silent visual ring at zero, not a story event.
Phone frames must use corner-left or corner-right; otherwise omit for the type default.`
const en = values => ({ type: 'string', enum: [...values] })
const shape = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false })
export function widgetCommandSchemas(units, definitions = forkWidgetBuiltins) {
  definitions = orderedDefinitions(definitions).map(item => ({ ...item, propsSchema: widgetPropsContract(item.propsSchema) }))
  const widgetId = { type: 'string', pattern: '^[a-z][a-z0-9-]{0,31}$' }
  const lifetime = shape({ until: en(['turn-end', 'paragraph', 'scene-change', 'user-dismiss']), at: { type: 'integer', minimum: 2, maximum: units }, durationSeconds: { type: 'integer', minimum: 1, maximum: 86400 }, carryTurns: { type: 'integer', enum: [0] } }, ['until'])
  if (!definitions.length) return []
  return [
    ...definitions.map(definition => shape({ op: en(['widget.show']), widgetId, type: en([definition.id]), props: definition.propsSchema, slot: en(FORK_WIDGET_SLOTS), lifetime }, ['op', 'widgetId', 'type', 'props'])),
    shape({ op: en(['widget.update']), widgetId, props: { anyOf: definitions.map(item => item.propsSchema) } }),
    shape({ op: en(['widget.hide']), widgetId })
  ]
}
export function createWidgetValidator({ enabled, units, start, error, used, definitions = forkWidgetBuiltins }) {
  const state = forkWidgetState(start, definitions), counts = {}
  let bytes = 0, commands = 0, clocks = 0
  function fail(path, message, reason) { error(path, message, 'widget-' + reason); return null }
  function boundary(at, scene, rawTime, path) {
    let widgetTime
    if (rawTime !== undefined) {
      if (!enabled) fail(path + '.widgetTime', 'Widgets are disabled.', 'disabled')
      else if (!Number.isSafeInteger(rawTime) || rawTime < state.time || rawTime - state.time > 86400 || clocks >= WIDGET_CAPS.clocks) fail(path + '.widgetTime', 'Use a monotonic safe integer story clock; at most 8 anchors, each advancing 0..86400 seconds.', 'clock')
      else { widgetTime = rawTime; state.time = rawTime; clocks++ }
    }
    forkWidgetBoundary(state, at, scene)
    return widgetTime
  }
  function command(raw, at, path) {
    if (!enabled) return fail(path, 'Widgets are disabled.', 'disabled')
    const op = raw.op
    if (!Object.hasOwn(WIDGET_CAPS, op) || !['widget.show', 'widget.update', 'widget.hide'].includes(op)) return fail(path, 'Unknown widget op.', 'type')
    const fields = op === 'widget.show' ? ['op', 'widgetId', 'type', 'props', 'slot', 'lifetime'] : op === 'widget.update' ? ['op', 'widgetId', 'props'] : ['op', 'widgetId']
    if (Object.keys(raw).some(key => !fields.includes(key))) return fail(path, 'Unknown widget field.', 'props')
    if (typeof raw.widgetId !== 'string' || !/^[a-z][a-z0-9-]{0,31}$/.test(raw.widgetId)) return fail(path + '.widgetId', 'Use a local ID: lowercase letter then up to 31 lowercase letters, digits or hyphens.', 'id')
    const existing = state.widgets.find(widget => widget.widgetId === raw.widgetId)
    if (op === 'widget.show' ? existing : !existing || op === 'widget.update' && existing.closed) return fail(path + '.widgetId', 'Show each ID once; update needs an active ID, hide needs a known ID.', 'id')
    if (op === 'widget.hide' && existing.closed) return null
    if (commands >= WIDGET_CAPS.commands || (counts[op] || 0) >= WIDGET_CAPS[op]) return fail(path, 'Widget operation budget exceeded.', 'cap')
    let canonical = { op, widgetId: raw.widgetId }, size = 0
    if (op !== 'widget.hide') {
      const type = op === 'widget.show' ? raw.type : existing.type
      if (!definitions.some(item => item.id === type)) return fail(path + '.type', 'Unknown widget type.', 'type')
      const props = forkWidgetProps(type, raw.props, definitions)
      if (!props) return fail(path + '.props', 'Invalid complete typed props: check required content, enum values, unknown fields and string/message limits.', 'props')
      // UTF-8 bytes without a Node dependency; JSON here contains only normalized primitives.
      size = new TextEncoder().encode(JSON.stringify(props)).length
      if (bytes + size > WIDGET_CAPS.bytes) return fail(path + '.props', 'At most 12 KiB of widget props per submission.', 'cap')
      canonical.props = props
      if (op === 'widget.show') {
        if (state.widgets.some(widget => !widget.closed && widget.type === type)) return fail(path, 'At most one active widget of each type.', 'cap')
        if (raw.slot !== undefined && !FORK_WIDGET_SLOTS.includes(raw.slot)) return fail(path + '.slot', 'Unknown widget slot.', 'props')
        if (props.frame === 'phone' && raw.slot !== undefined && !['corner-left', 'corner-right'].includes(raw.slot)) return fail(path + '.slot', 'Phone frames use corner-left or corner-right.', 'props')
        const life = raw.lifetime ?? { until: 'turn-end' }
        if (!forkWidgetObject(life) || Object.keys(life).some(key => !['until', 'at', 'durationSeconds', 'carryTurns'].includes(key)) || !['turn-end', 'paragraph', 'scene-change', 'user-dismiss'].includes(life.until) || life.carryTurns !== undefined && life.carryTurns !== 0 || life.durationSeconds !== undefined && (!Number.isSafeInteger(life.durationSeconds) || life.durationSeconds < 1 || life.durationSeconds > 86400) || (life.until === 'paragraph' ? !Number.isSafeInteger(life.at) || life.at <= at || life.at > units : life.at !== undefined)) return fail(path + '.lifetime', 'Invalid lifetime; paragraph at must be after birth and within this turn. carryTurns must be 0.', 'props')
        canonical = { ...canonical, type, ...(raw.slot ? { slot: raw.slot } : {}), lifetime: { ...life, carryTurns: 0 } }
      }
    }
    bytes += size; commands++; counts[op] = (counts[op] || 0) + 1
    forkWidgetReduce(state, canonical, at, '')
    used[op] = (used[op] || 0) + 1
    return canonical
  }
  return { boundary, command }
}
