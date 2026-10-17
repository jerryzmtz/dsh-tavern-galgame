import { createHash } from 'node:crypto'
// A real 8x8 lossless WebP generated from a uniform RGBA image, not a RIFF stub.
export const image = Buffer.from('UklGRh4AAABXRUJQVlA4TBEAAAAvB8ABAAdQ8MI3uf+BiOh/AAA=', 'base64')
export const sha = createHash('sha256').update(image).digest('hex')
export const rigId = 'pr0123456789'
export function fixture(id = 'sp0123456789') {
  const rig = { label: 'Synthetic', mouthSets: { neutral: { canvas: [8, 8], pivot: [4, 4], frames: Object.fromEntries(['closed', 'small', 'mid', 'open'].map(level => [level, sha])) } } }
  const layered = { mode: 'flat-mouth', rigId, bindings: { default: { imageSha: sha, canvas: [8, 8], mouth: { set: 'neutral', surface: 'patch', anchor: { x: 4, y: 4, scale: 1, rotation: 0 }, cover: { sha, rect: [0, 0, 8, 8] } } } } }
  return { version: 2, rigs: { [rigId]: rig }, portraits: [{ id, label: 'Synthetic', images: { default: sha }, talk: { default: sha }, layered }] }
}
