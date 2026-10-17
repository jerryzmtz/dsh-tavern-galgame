import assert from 'node:assert/strict'
import { inflateRawSync } from 'node:zlib'

export function zipText(buffer) {
  const parts = []
  for (let offset = 0; buffer.readUInt32LE(offset) === 0x04034b50;) {
    const size = buffer.readUInt32LE(offset + 18)
    const nameLength = buffer.readUInt16LE(offset + 26), extraLength = buffer.readUInt16LE(offset + 28)
    const start = offset + 30 + nameLength + extraLength
    const payload = buffer.subarray(start, start + size)
    const data = buffer.readUInt16LE(offset + 8) === 8 ? inflateRawSync(payload) : payload
    assert.equal(data.length, buffer.readUInt32LE(offset + 22))
    parts.push(buffer.subarray(offset + 30, offset + 30 + nameLength).toString(), data.toString())
    offset = start + size
  }
  return parts.join('\n')
}

