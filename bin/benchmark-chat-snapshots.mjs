// Synthetic, local filesystem benchmark; no user chats or model requests.
// Optional first argument: pre-change chat-journal-store module with its imports.
import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { performance } from 'node:perf_hooks'
import { createChatJournalStore } from '../tavern-plugin/lib/domain/chat-journal-store.js'

function fixture(count) {
  let seed = 123
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed }
  const words = ['城门', '守卫', '回忆', '风雨', '远处', '水面', '等待', '回答', '少女', '刀剑', '旅途', '故乡', '灯光', '村落', '街道', '消息', '山林', '深夜', '火焰', '脚步']
  const prose = () => Array.from({ length: 250 }, () => words[random() % words.length]).join('，')
  const stat = Object.fromEntries(Array.from({ length: 100 }, (_, i) => ['人物' + i, { hp: 100, 好感: 0, 介绍: '人物经历与状态' + i + '：' + prose().slice(0, 40) }]))
  return { id: 'bench', _storageRevision: 1, messages: Array.from({ length: count }, (_, i) => {
    stat['人物' + (i % 100)].好感++
    return { text: prose(), variables: [{ stat_data: structuredClone(stat), schema: { type: 'object' }, initialized_lorebooks: ['世界'], delta_data: { 好感: `${i}->${i + 1} (事件)` } }] }
  }) }
}

const factories = { current: createChatJournalStore }
if (process.argv[2]) factories.baseline = (await import(pathToFileURL(path.resolve(process.argv[2])))).createChatJournalStore
const root = await mkdtemp(path.join(os.tmpdir(), 'tavern-snapshot-benchmark-'))
const result = { node: process.version, platform: process.platform, samples: 7, fixture: 'Synthetic 100-character MVU state, one field changed per floor; OS disk cache warm', cases: [] }
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
try {
  for (const count of [225, 600]) {
    const chat = fixture(count)
    const samples = Object.fromEntries(Object.keys(factories).map(name => [name, []]))
    // Alternate execution order and discard the first warmup for each variant.
    for (let iteration = 0; iteration < 8; iteration++) {
      const entries = Object.entries(factories)
      if (iteration % 2) entries.reverse()
      for (const [name, factory] of entries) {
        const dataRoot = path.join(root, `${count}-${iteration}-${name}`)
        const open = () => factory({ dataRoot, frameLimit: 1 })
        const store = open()
        let start = performance.now()
        await store.update('bench', () => chat)
        const createMs = performance.now() - start
        start = performance.now()
        const saved = await store.update('bench', value => { value._storageRevision++; value.messages.at(-1).variables[0].stat_data['人物0'].hp--; return value })
        const rotateMs = performance.now() - start
        start = performance.now()
        const slice = await store.readSlice('bench', [count - 1])
        const afterRotateSliceMs = performance.now() - start
        assert.deepEqual(slice.chat.messages[0], saved.messages.at(-1))
        start = performance.now()
        const reopened = await open().read('bench')
        const reopenMs = performance.now() - start
        assert.equal(JSON.stringify(reopened), JSON.stringify(saved))
        start = performance.now()
        await store.patch('bench', 2, [{ op: 'set', path: ['_storageRevision'], value: 3 }, { op: 'set', path: ['messages', count - 1, 'variables', 0, 'stat_data', '人物0', 'hp'], value: 98 }])
        const patchRotateMs = performance.now() - start
        start = performance.now()
        await store.readSlice('bench', [count - 1])
        const afterPatchSliceMs = performance.now() - start
        const dir = path.join(dataRoot, 'chats/bench/snapshots')
        const files = await readdir(dir)
        const latest = files.find(file => file.startsWith('000000000003.'))
        const snapshotBytes = (await readFile(path.join(dir, latest))).length
        if (iteration > 0) samples[name].push({ snapshotBytes, createMs, rotateMs, afterRotateSliceMs, reopenMs, patchRotateMs, afterPatchSliceMs })
        await rm(dataRoot, { recursive: true, force: true })
      }
    }
    for (const [name, rows] of Object.entries(samples)) result.cases.push({ messages: count, variant: name,
      ...Object.fromEntries(Object.keys(rows[0]).map(key => [key, Number(median(rows.map(row => row[key])).toFixed(3))])) })
  }
  console.log(JSON.stringify(result, null, 2))
} finally { await rm(root, { recursive: true, force: true }) }
