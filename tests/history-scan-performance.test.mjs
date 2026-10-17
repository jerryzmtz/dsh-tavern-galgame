import test from 'node:test'
import assert from 'node:assert/strict'
import { fixture } from './fixtures/history-scan-session.mjs'
import { replaceSessionSurface } from '../tavern-plugin/lib/domain/session-surface-mutations.js'
import { restoreSurface } from '../tavern-plugin/lib/domain/surface-restoration.js'
test('大范围替换引用校验只线性读取来源', () => {
  const { session } = fixture(4000)
  let reads = 0
  const refs = new Proxy(Array.from({ length: 4000 }, (_, i) => i), { get(a, key) { if (/^\d+$/.test(String(key))) reads++; return Reflect.get(a,key) } })
  replaceSessionSurface(session, 'user/message', { id: 'edit', content: [] }, { start: 0, end: 3999, sourceEventSeqs: refs })
  assert.ok(reads <= 12000, `reference reads: ${reads}`)
})
test('批量恢复共享事件索引，不逐条全量快照', () => {
  const { session, snapshots } = fixture(1000)
  session.surface.nodes = []
  restoreSurface(session, Array.from({ length: 1000 }, (_, i) => i))
  assert.ok(snapshots() <= 2, `snapshots: ${snapshots()}`)
  assert.deepEqual(session.surface.nodes.map(seq => session.events[seq].data.id), Array.from({ length: 1000 }, (_, i) => 'm'+i))
})
