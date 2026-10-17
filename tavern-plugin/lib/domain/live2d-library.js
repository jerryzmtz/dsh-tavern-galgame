// Pure model geometry normalization. Pack service owns model storage and authoring.
import { normalizeFigure } from './figure-scale.js'

export const MAX_CARD_MODELS = 1000
const MODEL_ID = /^[a-z0-9][a-z0-9_-]{0,39}$/
const EXPRESSION = /^[A-Za-z0-9_.-]{1,80}$/

function str(value, max) { return (typeof value === 'string' ? value : '').trim().slice(0, max) }

function normalizeEntry(raw, moodIds = Object.keys(raw?.moods||{})) {
  const id = str(raw && raw.id, 40)
  if (!MODEL_ID.test(id)) return null
  const moodMap = {}
  for (const mood of moodIds) {
    const value = raw.moods && typeof raw.moods === 'object' ? str(raw.moods[mood], 80) : ''
    if (EXPRESSION.test(value)) moodMap[mood] = value
  }
  return { id, label: str(raw.label, 40), moods: moodMap, retired: raw.retired === true,
    ...(raw.scale != null ? { scale: Number.isFinite(raw.scale) ? Math.min(2, Math.max(0.25, raw.scale)) : 1 } : {}),
    ...(raw.figure != null ? { figure: normalizeFigure(raw.figure, raw.figure.modelRevision, true) } : {}) }
}
export function normalizeLive2dManifest(value, moodGroups) {
  const input = value && typeof value === 'object' ? value : {}
  if (Array.isArray(input.models) && input.models.length > MAX_CARD_MODELS) throw new Error('Model manifest exceeds 1000 models')
  const seen = new Set(), models = []
  for (const raw of Array.isArray(input.models) ? input.models : []) {
    const entry = normalizeEntry(raw, moodGroups?.map(group => group.id))
    if (entry && !seen.has(entry.id)) { seen.add(entry.id); models.push(entry) }
  }
  return { version: input.version === 2 || models.some(m => m.figure) ? 2 : 1, models }
}
