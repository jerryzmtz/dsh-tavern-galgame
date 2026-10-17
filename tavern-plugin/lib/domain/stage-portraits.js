// Pure portrait geometry normalization. Pack service owns all asset persistence.
import { normalizeFigure } from './figure-scale.js'
import { PORTRAIT_RIG_ID, normalizePortraitRig, normalizePortraitLayered } from './stage-portrait-rig.js'
import { forkSpriteManifest } from '../../src/client/fork-layered-sprite.cjs'
const slotsFor = groups => new Set(['default', ...groups.map(group => group.id)])
const ID = /^sp[0-9a-f]{10}$/
const SHA = /^[0-9a-f]{64}$/
const MAX = 200

function str(value, max) { return (typeof value === 'string' ? value : '').trim().slice(0, max) }
function normalizeEntry(raw, slots) {
  const id = str(raw && raw.id, 12)
  if (!ID.test(id)) return null
  const images = {}
  for (const [slot, sha] of Object.entries(raw.images && typeof raw.images === 'object' ? raw.images : {})) if (slots.has(slot) && SHA.test(String(sha))) images[slot] = sha
  const talk = {}
  for (const [slot, sha] of Object.entries(raw.talk && typeof raw.talk === 'object' ? raw.talk : {})) if (images[slot] && SHA.test(String(sha))) talk[slot] = sha
  // scale: size on stage relative to a standard figure (a small mascot drawn as a whole figure stands
  // smaller, on the floor line); 0.3–1, default 1.
  const scale = Number(raw.scale)
  return { id, label: str(raw.label, 40) || id, images, talk, scale: Number.isFinite(scale) && scale > 0 ? Math.min(2, Math.max(0.25, Math.round(scale * 100) / 100)) : 1, ...(raw.figure != null ? { figure: normalizeFigure(raw.figure, images) } : {}), createdAt: Number(raw.createdAt) || 0 }
}
export function normalizeStagePortraits(value, moodGroups) {
  const input = value && typeof value === 'object' ? value : {}
  const seen = new Set(), portraits = [], rigs = {}
  for (const [id, raw] of Object.entries(input.rigs || {}).slice(0, MAX)) {
    const rig = PORTRAIT_RIG_ID.test(id) && normalizePortraitRig(raw)
    if (rig) rigs[id] = rig
  }
  for (const raw of Array.isArray(input.portraits) ? input.portraits.slice(0, MAX) : []) {
    const entry = normalizeEntry(raw, slotsFor(moodGroups || Object.keys(raw.images||{}).map(id=>({id}))))
    if (entry && !seen.has(entry.id)) {
      const layered = normalizePortraitLayered(raw.layered, entry.images, rigs)
      if (layered) entry.layered = layered
      if (raw.spritePack) { try { entry.spritePack = forkSpriteManifest(raw.spritePack, 'sha') } catch { /* Bad packs stay on their intact legacy base. */ } }
      seen.add(entry.id); portraits.push(entry)
    }
  }
  return input.version === 2 || Object.keys(rigs).length ? { version: 2, portraits, rigs } : { version: 1, portraits }
}
