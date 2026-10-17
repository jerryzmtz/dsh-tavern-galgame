// private fork: origin-independent card frame storage (docs/fork/ui-design.md).
import test from 'node:test'
import assert from 'node:assert/strict'
import { createFrameStorage } from '../tavern-plugin/lib/domain/frame-storage.js'

function memoryProfileData() {
  const files = new Map()
  return {
    async readJson(path) { return files.has(path) ? JSON.parse(files.get(path)) : undefined },
    async updateJson(path, update) {
      const next = await update(files.has(path) ? JSON.parse(files.get(path)) : undefined)
      files.set(path, JSON.stringify(next))
      return next
    }
  }
}

test('卡片存储按批次写入与删除，只保留字符串值', async () => {
  const storage = createFrameStorage(memoryProfileData())
  assert.deepEqual(await storage.read(), {})
  await storage.update([{ op: 'set', key: 'mitakihara:theme', value: 'light' }, { op: 'set', key: 'other', value: 'x' }])
  assert.deepEqual(await storage.update([{ op: 'remove', key: 'other' }]), { ok: true, applied: 1, values: { 'mitakihara:theme': 'light' } })
  await assert.rejects(storage.update([{ op: 'set', key: '', value: 'ignored' }]), /key/)
  await assert.rejects(storage.update([{ op: 'set', key: 'bad', value: 1 }]), /value/)
  assert.deepEqual(await storage.read(), { 'mitakihara:theme': 'light' })
})

test('卡片存储拒绝超出总量上限的写入并保留原值', async () => {
  const storage = createFrameStorage(memoryProfileData())
  await storage.update([{ op: 'set', key: 'a', value: 'keep' }])
  const big = 'x'.repeat(200 * 1024)
  const ops = Array.from({ length: 12 }, (_, i) => ({ op: 'set', key: 'k' + i, value: big }))
  await assert.rejects(storage.update(ops), /2 MB/)
  assert.deepEqual(await storage.read(), { a: 'keep' })
})
