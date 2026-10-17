
import test from 'node:test'
import assert from 'node:assert/strict'
import { createSceneImageDiagnostics, redactSceneDiagnostic } from '../tavern-plugin/lib/domain/scene-image-diagnostics.js'

function storage() {
  const values = new Map()
  return { values, async readJson(path) { return structuredClone(values.get(path)) }, async updateJson(path, update) { const value = await update(values.get(path)); values.set(path, structuredClone(value)); return value } }
}
const attempt = (n, stage = 'planning', status = 'running') => ({ requestId: 'request-' + n, targetKey: 'body-' + n, sessionId: 'parent', stage, status, createdAt: Date.now() - 10, details: { prompt: '画面' } })

test('diagnostics redact known secrets, credentials, signed URLs and image bytes before persistence', async () => {
  const disk = storage(), logs = createSceneImageDiagnostics(disk)
  const value = { ...attempt(1), details: { apiKey: 'key-content', prompt: 'plain known-token-value', nested: { password: 'pass-content' },
    address: 'https://user:password@host/image?signature=signed-query', headers: { authorization: 'Bearer auth-content' },
    picture: Buffer.from('IMAGE-BYTES'), base64: 'IMAGE-BASE64', uri: 'data:image/png;base64,OTHER-BYTES' } }
  await logs.record('chat', value, ['known-token-value'])
  const text = JSON.stringify([...disk.values.values()])
  for (const word of ['key-content', 'known-token-value', 'pass-content', 'signed-query', 'auth-content', 'IMAGE-BYTES', 'IMAGE-BASE64', 'OTHER-BYTES']) assert.ok(!text.includes(word), word)
  assert.match(text, /REDACTED/)
  assert.equal(redactSceneDiagnostic(new Uint8Array([1, 2])), '[image bytes omitted]')
})

test('retention removes evicted detail files and retries failed cleanup without losing live attempts', async () => {
  const disk = storage(), logs = createSceneImageDiagnostics(disk)
  let failRemoval = true
  disk.remove = async path => { if (failRemoval) throw Error('busy'); disk.values.delete(path) }
  for (let n = 0; n < 25; n++) await logs.record('chat', { ...attempt(n), details: { prompt: 'x'.repeat(100000) } })
  const before = await logs.read('chat')
  assert.ok(before.dropped > 0)
  assert.ok(Buffer.byteLength(JSON.stringify(before)) < 2 * 1024 * 1024)
  const evicted = 0
  // Reintroduce an evicted identity while failed removals remain pending.
  await logs.record('chat', attempt(evicted, 'revived'))
  failRemoval = false
  await logs.record('chat', attempt(24, 'latest'))
  const result = await logs.read('chat')
  assert.equal(result.records.find(row => row.requestId === 'request-0').stage, 'revived')
  assert.equal(disk.values.size, result.records.length + 1)
  assert.ok(result.records.every(row => !row.unavailable))
})
