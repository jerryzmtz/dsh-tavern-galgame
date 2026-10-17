// Card-pack adapters: validate the v2 dependency closure before publication, merge rigs first.
import { createHash } from 'node:crypto'
import { normalizeStagePortraits } from './stage-portraits.js'
// private fork: card packs retain figure semantics and validate current image dimensions.
import { forkNormalizeFigure } from '../../src/client/fork-figure-scale.cjs'
import { collectPortraitAssets, samePortraitRig, validatePortraitRigAssets, portraitWebpSize } from './stage-portrait-rig.js'

export async function validateStagePortraitIndex(raw, read, moodGroups) {
  if (!raw || ![1, 2].includes(raw.version) || !Array.isArray(raw.portraits)) throw new Error('Invalid portrait index version')
  if (raw.version === 1 && (raw.rigs || raw.portraits.some(p => p.layered || p.spritePack))) throw new Error('Layered portraits require index v2')
  const normalized = normalizeStagePortraits(raw, moodGroups)
  if (normalized.portraits.length !== raw.portraits.length || Object.keys(normalized.rigs || {}).length !== Object.keys(raw.rigs || {}).length) throw new Error('Invalid portrait index')
  for (const p of raw.portraits) if (p.layered) {
    const valid = normalized.portraits.find(n => n.id === p.id)?.layered
    if (!valid || Object.keys(valid.bindings).length !== Object.keys(p.layered.bindings || {}).length) throw new Error('Invalid portrait binding in pack')
  }
  for (const p of raw.portraits) if (p.spritePack && !normalized.portraits.find(n => n.id === p.id)?.spritePack) throw new Error('Invalid sprite pack')
  const bytes = new Map()
  const cachedRead = async sha => { if (!bytes.has(sha)) bytes.set(sha, await read(sha)); return bytes.get(sha) }
  for (const p of raw.portraits) for (const sha of collectPortraitAssets(p, raw.rigs)) {
    const asset = await cachedRead(sha)
    if (!asset || asset.length > 6 * 1024 * 1024 || createHash('sha256').update(asset).digest('hex') !== sha) throw new Error('Missing or corrupt portrait asset in pack: ' + sha)
  }
  for (const p of raw.portraits) if (p.figure) {
    const figure = forkNormalizeFigure(p.figure, p.images)
    if (figure.version === 1) for (const record of Object.values(figure.slots)) {
      if (record.status !== 'stale' && String(portraitWebpSize(await cachedRead(record.sourceSha))) !== String(record.canvas)) throw new Error('Figure canvas mismatch in pack')
    }
  }
  await validatePortraitRigAssets(normalized, cachedRead)
  return normalized
}

export function mergeStagePortraitIndexes(current, incoming) {
  const value = structuredClone(current), clashes = [], blocked = new Set()
  for (const [id, rig] of Object.entries(incoming.rigs || {})) {
    if (value.rigs?.[id] && !samePortraitRig(value.rigs[id], rig)) { blocked.add(id); clashes.push({ kind: 'rigs', id, path: 'portraits/index.json' }); continue }
    value.rigs ||= {}; value.rigs[id] = structuredClone(rig)
  }
  for (const p of incoming.portraits) {
    if (blocked.has(p.layered?.rigId) || value.portraits.some(old => old.id === p.id || p.label && old.label === p.label)) clashes.push({ kind: 'portraits', id: p.id, path: 'portraits/index.json' })
    else value.portraits.push(structuredClone(p))
  }
  if (incoming.version === 2 || current.version === 2) value.version = 2
  return { value, clashes }
}
