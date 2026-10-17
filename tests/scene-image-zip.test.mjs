import test from 'node:test'
import assert from 'node:assert/strict'
import { sceneImageFromZip } from '../tavern-plugin/lib/domain/scene-image-zip.js'
import { diagnosticZip } from '../tavern-plugin/lib/domain/mvu-diagnostics.js'
import { imageZip } from './fixtures/scene-image-zip.mjs'

const data = Buffer.from('fixture-image-bytes'.repeat(20))

test('image ZIP rejects ambiguous images, traversal, encryption and directory/header corruption', () => {
  const invalid = [Buffer.alloc(0), Buffer.from('{}'), imageZip(data, { name: '../image.png' }), imageZip(data, { name: 'C:\\image.png' }), imageZip(data, { name: 'image.txt' }), diagnosticZip([{ path: 'a.png', content: data }, { path: 'b.png', content: data }])]
  for (const mutate of [
    (zip, start) => zip.writeUInt16LE(0x801, start + 8),
    (zip, start) => zip.writeUInt32LE(0xffffffff, start + 24),
    (zip, start) => zip.writeUInt32LE(0xffffffff, start + 42),
    (zip, start) => zip.writeUInt32LE(0, start + 16),
    zip => zip.writeUInt16LE(9, 8),
    zip => zip.writeUInt16LE(2, zip.length - 22 + 6),
    zip => { zip[30] ^= 1 },
    zip => { zip[45] ^= 1 }
  ]) {
    const zip = imageZip(data)
    mutate(zip, zip.readUInt32LE(zip.length - 6)); invalid.push(zip)
  }
  for (const zip of invalid) assert.throws(() => sceneImageFromZip(zip, 1024), /ZIP/)
})
