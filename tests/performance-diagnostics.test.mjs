import test from 'node:test'
import assert from 'node:assert/strict'
import { createPerformanceDiagnostics } from '../tavern-plugin/lib/domain/performance-diagnostics.js'

test('性能摘要限制容量、过滤任意字段，并区分快慢请求', () => {
  const store = createPerformanceDiagnostics()
  store.record('openChat', 50)
  for (let i = 0; i < 100; i++) store.record('openChat', 1200)
  store.browser({ observedMs: 10000, longTaskCount: 2, longTaskMaxMs: 250, longTaskSupported: true, prompt: 'PRIVATE', apiKey: 'SECRET' })
  const value = store.read()
  assert.equal(value.slow.length, 30)
  assert.equal(value.methods[0].count, 101)
  assert.equal(value.methods[0].slowCount, 100)
  assert.equal(value.browser.longTaskMaxMs, 250)
  assert.doesNotMatch(JSON.stringify(value), /PRIVATE|SECRET/)
  value.slow[0].method = 'changed'
  assert.equal(store.read().slow[0].method, 'openChat')
  for (let i = 0; i < 1000; i++) store.record('method' + i, 1)
  assert.equal(store.read().methods.length, 80)
})

test('开场计时只保存固定字段并限制记录数量', () => {
  const diagnostics = createPerformanceDiagnostics()
  for (let i = 0; i < 100; i++) diagnostics.opening({ stage: 'resources', durationMs: 12, cacheHitCount: 1, content: 'PRIVATE', url: 'secret' })
  const snapshot = diagnostics.read()
  assert.equal(snapshot.openings.length, 60)
  assert.equal(snapshot.openings[0].durationMs, 12)
  assert.ok(!JSON.stringify(snapshot).includes('PRIVATE'))
  assert.ok(!JSON.stringify(snapshot).includes('secret'))
})

test('浏览器分段计时只接受关联 ID 和固定数字字段，导出深拷贝', () => {
  const store = createPerformanceDiagnostics()
  store.browser({requests: Array.from({length: 100}, () => ({id: '00000000-0000-0000-0000-000000000001', method: 'getSession', sentAt: 1, headersMs: 1234, parsedMs: 1240, active: 3, body: 'SECRET'}))})
  const first = store.read()
  assert.equal(first.browser.requests.length, 60)
  assert.equal(first.browser.requests[0].headersMs, 1234)
  assert.doesNotMatch(JSON.stringify(first), /SECRET/)
  first.browser.requests[0].active=999
  assert.equal(store.read().browser.requests[0].active, 3)
})
