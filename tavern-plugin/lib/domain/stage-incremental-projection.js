// Pure, rebuildable renderer cache over the authoritative incremental effect. The
// model writes sparse operations; this adapter owns compatibility with legacy UI.
import { walkStageOperations } from './stage-incremental.js'
import { forkFigureCarry, forkFigureDirection } from '../../packages/dsh-presentation-protocol/src/fork-figure-scale.cjs'
const clone = value => structuredClone(value)
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

import { projectIncrementalStageState } from '../../packages/dsh-presentation-protocol/src/playback-state.js'
export { projectIncrementalStageState } from '../../packages/dsh-presentation-protocol/src/playback-state.js'

function difference(before, after, at) {
  const entry = { at }, commands = []
  if (before.scene !== after.scene) { entry.scene = after.scene; entry.sceneCleared = after.sceneCleared }
  if (!same(before.cast, after.cast)) { entry.cast = after.cast; entry.order = after.order }
  const outfits = Object.fromEntries(Object.keys(after.outfits).filter(id => before.outfits[id] !== after.outfits[id]).map(id => [id, after.outfits[id]]))
  if (Object.keys(outfits).length) entry.outfits = outfits
  if (before.music !== after.music) entry.music = after.music || 'none'
  for (const [field, op] of [['positions', 'pos'], ['focus', 'focus'], ['look', 'look'], ['figureLight', null]]) {
    for (const [id, value] of Object.entries(after[field])) if (before[field][id] !== value) commands.push({ op: op || value, id, ...(op ? { value } : {}) })
  }
  if (before.weather !== after.weather) commands.push({ op: 'weather', value: after.weather })
  if (!same(before.soundscape.tags, after.soundscape.tags)) entry.sound = [...after.soundscape.tags]
  for (const layer of ['time', 'mood']) if (before.lighting[layer] !== after.lighting[layer]) commands.push({ op: 'light', value: after.lighting[layer] })
  if (!same(before.camera, after.camera)) commands.push({ op: 'cam', ...after.camera })
  if (before.dof !== after.dof) commands.push({ op: 'dof', ...(after.dof === 'off' ? { value: 'off' } : { id: after.dof }) })
  if (!same(before.widgetState, after.widgetState)) entry.widgetState = after.widgetState
  if (commands.length) entry.commands = commands
  return entry
}

/** Recreate after cache write/read failure without another model call. Replay only
 * validates/reduces; it never plays audio, animations, or widget wall clocks. */
export function projectIncrementalStageEffect(effect) {
  const presentation = clone(effect.presentation || {}), catalog = effect.catalogSnapshot
  const start = projectIncrementalStageState(effect.start, catalog, presentation.start || presentation)
  const entries = []
  let before = start
  // Preserve operation order within a paragraph, particularly a transient close
  // followed by an explicit persistent focus/reset. Merge only renderer fields,
  // never reorder commands. The core validates once, then folds once; no growing
  // prefix replay or quadratic digest work even at the maximum operation budget.
  walkStageOperations(effect, (state, op, at) => {
    const after = projectIncrementalStageState(state, catalog), part = difference(before, after, at)
    if (op.op === 'stage.reset') (part.commands ||= []).unshift({ op: 'reset-transients' })
    if (op.op === 'actor.patch' && Object.hasOwn(op.value, 'focus') && before.focus[op.actor] === after.focus[op.actor]) (part.commands ||= []).push({ op: 'focus', id: op.actor, value: op.value.focus })
    if (op.op === 'actor.enter' && op.value && !before.cast.includes(op.actor)) (part.commands ||= []).push({ op: 'pos', id: op.actor, value: op.value })
    if (op.op === 'phone.message') (part.commands ||= []).push(clone(op))
    if (op.op === 'act') (part.commands ||= []).push({ op: 'act', id: op.actor, value: op.value })
    if (op.op === 'event') (part.commands ||= []).push({ ...clone(op.value), ...(op.value.op === 'focus' ? { transient: true } : {}) })
    if (Object.keys(part).length > 1) {
      let entry = entries.at(-1)
      // private fork: cast boundaries preserve sequential insertion gaps and same-beat reentry.
      // Folding multiple arrivals into one final cast would apply their placements twice.
      if (!entry || entry.at !== at || part.cast) { entry = { at }; entries.push(entry) }
      for (const [key, value] of Object.entries(part)) {
        if (key === 'commands') (entry.commands ||= []).push(...value)
        else if (key === 'outfits') Object.assign(entry.outfits ||= {}, value)
        else entry[key] = value
      }
    }
    before = after
  })
  const end = projectIncrementalStageState(effect.end, catalog)
  if (presentation.figureCatalog && (Object.keys(presentation.figureCatalog).length || start.figureScale)) end.figureScale = forkFigureCarry(forkFigureDirection(start, entries, presentation.figureCatalog, Infinity))
  return { ...presentation, status: effect.complete ? 'done' : 'running', partial: !effect.complete,
    key: presentation.key || effect.sourceKey, units: effect.units, through: effect.through, protocol: 'incremental-v1', widgetsVersion: 2, start, entries, end }
}
