// private fork: host validation for explicit figure calibration; no image decoder or Cubism dependency.
import { createHash } from 'node:crypto'
import { forkNormalizeFigure, forkFigurePatch } from '../../packages/dsh-presentation-protocol/src/fork-figure-scale.cjs'
import { portraitWebpSize } from './stage-portrait-rig.js'
export { forkFigureCharacter } from '../../packages/dsh-presentation-protocol/src/fork-figure-scale.cjs'
function canonical(value) { return value && typeof value === 'object' ? Array.isArray(value) ? value.map(canonical) : Object.fromEntries(Object.keys(value).sort().filter(k => value[k] !== undefined).map(k => [k, canonical(value[k])])) : value }
export const figureRevision = value => createHash('sha256').update(JSON.stringify(canonical(value ?? null))).digest('hex')
export function checkFigureRevision(expected, current) {
  if (expected !== figureRevision(current)) throw new Error('Figure revision conflict; reload before confirming')
}
export function normalizeFigure(raw, sources, model = false) {
  try { return forkNormalizeFigure(raw, sources, model) }
  catch { return raw == null ? undefined : { ...raw, status: 'stale' } }
}
export async function confirmPortraitFigure(entry, patch, read) {
  const figure = forkNormalizeFigure(forkFigurePatch(entry.figure, patch), entry.images)
  if (patch?.version === 1) forkNormalizeFigure({ ...patch, slots: Object.fromEntries(Object.entries(patch.slots || {}).filter(([, record]) => record !== null)) }, entry.images, false, true)
  if (figure?.version === 1) for (const record of Object.values(figure.slots)) {
    if (record.status === 'stale') continue
    const bytes = await read(record.sourceSha)
    if (!bytes || String(portraitWebpSize(bytes)) !== String(record.canvas)) throw new Error('Figure canvas does not match portrait bytes')
  }
  return figure
}
export function confirmModelFigure(figure, revision, canvas) {
  const normalized = forkNormalizeFigure(figure, revision, true, true)
  if (normalized?.version === 1 && (!canvas || String(canvas) !== String(normalized.canvas))) throw new Error('Figure canvas does not match model')
  return normalized
}
