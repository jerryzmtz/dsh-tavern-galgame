// Offline draft adapter using the same snapshots and record planner as production.
import { forkSoundscapeInitial, forkSoundscapeReplay, forkSoundscapeCarry, forkSoundscapeSceneSnapshots, forkSoundscapeRecordPlan } from '../../packages/dsh-presentation-protocol/src/fork-stage-soundscape.cjs'
import { validateSoundTags } from './stage-soundscape-protocol.js'

const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) }
  return value
}
const obsolete = ['place', 'exposure', 'level', 'rain', 'hushUntil', 'soundscape', 'amb']

// Only the already-enabled host catalogue may be passed here. No filesystem/model access.
export function prepareSoundscapeDraft({ start = {}, entries = [], scenes = [], sounds = [], units } = {}) {
  if (!Number.isSafeInteger(units) || units < 1) throw new RangeError('Expected a positive paragraph count')
  const state = Object.hasOwn(start, 'soundscape') ? forkSoundscapeCarry(start.soundscape) : {}
  if (!state) throw new TypeError('Invalid sound tags')
  const seed = { scene: start.scene ?? start.soundscape?.scene ?? '', weather: start.weather ?? start.soundscape?.weather ?? 'none',
    ...(start.assetRefs?.scene ? { assetRefs: { scene: structuredClone(start.assetRefs.scene) } } : {}), soundscape: state }
  seed.soundscape = forkSoundscapeInitial(seed)
  const beats = structuredClone(entries)
  if (!Array.isArray(beats)) throw new TypeError('Expected entries array')
  for (const entry of beats) {
    if (!entry || !Number.isSafeInteger(entry.at) || entry.at < 1 || entry.at > units) throw new RangeError('Invalid entry paragraph')
    for (const key of obsolete) if (Object.hasOwn(entry, key)) throw new TypeError('Obsolete sound control: ' + key)
    if (Object.hasOwn(entry, 'sound')) {
      const checked = validateSoundTags(entry.sound)
      if (checked.errors.length) throw new TypeError(checked.errors.join('; '))
      entry.sound = checked.tags
    }
    if (entry.commands !== undefined && !Array.isArray(entry.commands)) throw new TypeError('Expected commands array')
    for (const raw of entry.commands || []) if (raw?.op === 'soundscape' || raw?.op === 'amb') {
      throw new TypeError('Obsolete sound command: ' + raw.op)
    }
  }
  // Freeze content classification as well as the preset, so empty stays crowd-only on replay.
  const sceneSnapshots = forkSoundscapeSceneSnapshots(scenes)
  const soundSnapshots = sounds.filter(sound => sound?.kind === 'ambience' && sound.enabled !== false && sound.hidden !== true)
    .map(({ id, url, source, libraryId, loudness, people }) => ({ id, url, ...(source ? { source } : {}), ...(libraryId ? { libraryId } : {}),
      kind: 'ambience', ...(typeof people === 'boolean' ? { people } : {}), ...(loudness ? { loudness: structuredClone(loudness) } : {}) }))
  return freeze({ draft: true, units, start: seed, entries: beats, scenes: sceneSnapshots, sounds: soundSnapshots })
}

export function replaySoundscapeDraft(record, para) {
  if (record?.draft !== true) throw new TypeError('Expected an explicitly prepared soundscape draft')
  if (!Number.isSafeInteger(para) || para < 1 || para > record.units) throw new RangeError('Invalid playback paragraph')
  const state = forkSoundscapeReplay(record.start, record.entries, para)
  if (!state) throw new TypeError('Invalid soundscape state')
  const plan = forkSoundscapeRecordPlan({ ...record, soundscapeScenes: record.scenes }, para, record.sounds)
  return { state, plan, carry: forkSoundscapeCarry(state) }
}
