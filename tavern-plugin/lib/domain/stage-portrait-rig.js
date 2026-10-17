// Phase-one flat-mouth schema and explicit asset closure; no filesystem or runtime dependencies.
import { createHash } from 'node:crypto'
import { forkSpriteMapAssets, forkSpriteAssets } from '../../src/client/fork-layered-sprite.cjs'

export const MOUTH_LEVELS = ['closed', 'small', 'mid', 'open']
export const PORTRAIT_RIG_ID = /^pr[0-9a-f]{10}$/
const SHA = /^[0-9a-f]{64}$/
const slug = /^[a-z][a-z0-9_-]{0,31}$/
const object = v => v && typeof v === 'object' && !Array.isArray(v)
const finite = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi
const pair = (v, max) => Array.isArray(v) && v.length === 2 && v.every(n => Number.isInteger(n) && n > 0 && n <= max)

export function normalizePortraitRig(raw) {
  if (!object(raw) || !object(raw.mouthSets) || Object.keys(raw.mouthSets).length > 16) return null
  const mouthSets = {}
  for (const [id, set] of Object.entries(raw.mouthSets)) {
    if (!slug.test(id) || !pair(set?.canvas, 512) || !Array.isArray(set.pivot) || set.pivot.length !== 2 || !set.pivot.every((n, i) => finite(n, 0, set.canvas[i])) || !MOUTH_LEVELS.every(level => SHA.test(set.frames?.[level]))) return null
    mouthSets[id] = { canvas: [...set.canvas], pivot: [...set.pivot], frames: Object.fromEntries(MOUTH_LEVELS.map(level => [level, set.frames[level]])) }
  }
  if (!Object.keys(mouthSets).length) return null
  return { label: typeof raw.label === 'string' ? raw.label.trim().slice(0, 40) : '', mouthSets }
}

export function samePortraitRig(left, right) {
  const canonical = value => value && typeof value === 'object' ? Array.isArray(value) ? value.map(canonical) : Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value
  return JSON.stringify(canonical(normalizePortraitRig(left))) === JSON.stringify(canonical(normalizePortraitRig(right)))
}

export function normalizePortraitLayered(raw, images, rigs) {
  if (!object(raw) || raw.mode !== 'flat-mouth' || !PORTRAIT_RIG_ID.test(raw.rigId) || !rigs[raw.rigId] || !object(raw.bindings)) return null
  const bindings = {}
  for (const [slot, b] of Object.entries(raw.bindings)) {
    const m = b?.mouth, a = m?.anchor, c = m?.cover
    if (!object(b) || !images[slot] || b.imageSha !== images[slot] || !pair(b.canvas, 4096) || !rigs[raw.rigId].mouthSets[m?.set] || !a || !finite(a.x, 0, b.canvas[0]) || !finite(a.y, 0, b.canvas[1]) || !finite(a.scale, 0.1, 4) || !finite(a.rotation, -45, 45) || !['patch', 'neutral', 'mouthless'].includes(m.surface)) continue
    const mouth = { set: m.set, anchor: { x: a.x, y: a.y, scale: a.scale, rotation: a.rotation }, surface: m.surface }
    if (m.surface === 'patch') {
      if (!SHA.test(c?.sha) || !Array.isArray(c.rect) || c.rect.length !== 4 || !c.rect.every(Number.isInteger)) continue
      const [x, y, w, h] = c.rect
      if (w < 1 || h < 1 || w > b.canvas[0] || h > b.canvas[1] || x < -w || y < -h || x >= b.canvas[0] || y >= b.canvas[1]) continue
      mouth.cover = { sha: c.sha, rect: [...c.rect] }
    }
    bindings[slot] = { imageSha: b.imageSha, canvas: [...b.canvas], mouth }
  }
  return { mode: 'flat-mouth', rigId: raw.rigId, bindings }
}

// The same explicit SHA visitor backs serving, copying and public URL projection.
export function mapPortraitAssets(entry, rigs, map = sha => sha) {
  const result = { ...entry, images: Object.fromEntries(Object.entries(entry.images || {}).map(([k, v]) => [k, map(v)])), talk: Object.fromEntries(Object.entries(entry.talk || {}).map(([k, v]) => [k, map(v)])) }
  if (entry.layered) {
    const l = entry.layered, rig = rigs[l.rigId]
    result.layered = { ...l, bindings: Object.fromEntries(Object.entries(l.bindings).map(([slot, b]) => [slot, { ...b, imageSha: map(b.imageSha), mouth: { ...b.mouth, ...(b.mouth.cover ? { cover: { ...b.mouth.cover, sha: map(b.mouth.cover.sha) } } : {}) } }])) }
    if (rig) result.layered.rig = { ...rig, mouthSets: Object.fromEntries(Object.entries(rig.mouthSets).map(([id, set]) => [id, { ...set, frames: Object.fromEntries(MOUTH_LEVELS.map(level => [level, map(set.frames[level])])) }])) }
  }
  if (entry.spritePack) result.spritePack = forkSpriteMapAssets(entry.spritePack, map)
  return result
}
export function collectPortraitAssets(entry, rigs = {}) {
  const refs = new Set()
  mapPortraitAssets(entry, rigs, sha => { if (!SHA.test(sha)) throw new Error('Invalid portrait asset SHA'); refs.add(sha); return sha })
  return [...refs]
}

// Read dimensions before handing data to an image decoder; reject animation and oversized canvases.
export function portraitWebpSize(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 20 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WEBP' || bytes.readUInt32LE(4) + 8 !== bytes.length) throw new Error('Invalid layered WebP')
  let size, payload = false
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const kind = bytes.toString('ascii', offset, offset + 4), length = bytes.readUInt32LE(offset + 4), p = offset + 8
    if (p + length > bytes.length) throw new Error('Truncated layered WebP')
    if (kind === 'ANIM' || kind === 'ANMF') throw new Error('Animated portrait layers are not supported')
    if (kind === 'VP8X' && length >= 10) { if (bytes[p] & 2) throw new Error('Animated portrait layers are not supported'); size = [1 + bytes.readUIntLE(p + 4, 3), 1 + bytes.readUIntLE(p + 7, 3)] }
    if (kind === 'VP8L' && length >= 5 && bytes[p] === 0x2f) { const bits = bytes.readUInt32LE(p + 1); const decoded = [1 + (bits & 0x3fff), 1 + ((bits >>> 14) & 0x3fff)]; if (size && String(size) !== String(decoded)) throw new Error('WebP canvas mismatch'); size = decoded; payload = true }
    if (kind === 'VP8 ' && length >= 10 && bytes[p + 3] === 0x9d && bytes[p + 4] === 1 && bytes[p + 5] === 0x2a) { const decoded = [bytes.readUInt16LE(p + 6) & 0x3fff, bytes.readUInt16LE(p + 8) & 0x3fff]; if (size && String(size) !== String(decoded)) throw new Error('WebP canvas mismatch'); size = decoded; payload = true }
    offset = p + length + (length & 1)
    if (offset === bytes.length) break
    if (offset > bytes.length - 8) throw new Error('Invalid layered WebP chunks')
  }
  if (!payload || !pair(size, 4096)) throw new Error('Invalid layered WebP dimensions')
  return size
}

export async function validatePortraitRigAssets(index, read) {
  const sizes = new Map()
  async function check(sha, expected) {
    if (!sizes.has(sha)) {
      const bytes = await read(sha)
      if (!bytes || bytes.length > 6 * 1024 * 1024 || createHash('sha256').update(bytes).digest('hex') !== sha) throw new Error('Missing or corrupt portrait rig asset: ' + sha)
      sizes.set(sha, portraitWebpSize(bytes))
    }
    if (String(sizes.get(sha)) !== String(expected)) throw new Error('Portrait rig canvas mismatch: ' + sha)
  }
  for (const entry of index.portraits || []) if (entry.spritePack) for (const [sha, size] of forkSpriteAssets(entry.spritePack)) await check(sha, size)
  for (const rig of Object.values(index.rigs || {})) for (const set of Object.values(rig.mouthSets)) for (const sha of Object.values(set.frames)) await check(sha, set.canvas)
  for (const entry of index.portraits || []) if (entry.layered) for (const b of Object.values(entry.layered.bindings)) {
    await check(b.imageSha, b.canvas)
    if (b.mouth.cover) await check(b.mouth.cover.sha, b.mouth.cover.rect.slice(2))
  }
}
