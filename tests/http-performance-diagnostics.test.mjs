import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { observeHttpRequests } from '../tavern-plugin/lib/domain/http-performance-diagnostics.js'
import { createPerformanceDiagnostics } from '../tavern-plugin/lib/domain/performance-diagnostics.js'

function fixture() {
  const server = new EventEmitter(), diagnostics = createPerformanceDiagnostics()
  let time = 0, tick, cancelled = false
  const dispose = observeHttpRequests(server, value => diagnostics.http(value), {
    now: () => time, interval: fn => { tick = fn; return 1 }, cancel: () => { cancelled = true }
  })
  return { server, diagnostics, dispose, cancelled: () => cancelled,
    advance(ms) { time += ms; tick() },
    request(url) { const res = new EventEmitter(); server.emit('request', { url }, res); return res }
  }
}

test('HTTP snapshots retain only slow request categories, and remove finished or aborted responses', () => {
  const f = fixture()
  const fast = f.request('/api/dsh-tavern/claimTavernScriptWork?token=SECRET')
  fast.emit('finish')
  const aborted = f.request('/api/private-story')
  aborted.emit('close')
  const asset = f.request('/api/dsh-tavern/static-assets?url=https://PRIVATE/image.png')
  f.advance(2999)
  assert.equal(f.diagnostics.read().http, undefined)
  f.advance(1)
  const value = f.diagnostics.read().http
  assert.equal(value.samples[0].active, 1)
  assert.deepEqual(value.samples[0].routes, [{ route: 'card-assets', count: 1, oldestMs: 3000 }])
  assert.doesNotMatch(JSON.stringify(value), /SECRET|PRIVATE|private-story/)
  asset.emit('finish'); asset.emit('close')
  f.advance(5000)
  assert.equal(f.diagnostics.read().http.samples.length, 1)
  assert.equal(asset.listenerCount('close'), 0)
  f.dispose()
})

test('HTTP diagnostics bound tracking and samples and detach pending response listeners on disposal', () => {
  const f = fixture()
  const responses = Array.from({ length: 300 }, () => f.request('/api/unknown'))
  for (let i = 0; i < 50; i++) f.advance(5000)
  const snapshot = f.diagnostics.read().http
  assert.equal(snapshot.samples.length, 30)
  assert.equal(snapshot.omitted, 44)
  assert.equal(snapshot.samples[0].active, 256)
  snapshot.samples[0].routes[0].count = -1
  assert.equal(f.diagnostics.read().http.samples[0].routes[0].count, 256)
  f.dispose()
  assert.equal(f.cancelled(), true)
  assert.equal(f.server.listenerCount('request'), 0)
  assert.ok(responses.every(res => res.listenerCount('finish') === 0 && res.listenerCount('close') === 0))
})
