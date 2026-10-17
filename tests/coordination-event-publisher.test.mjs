import assert from 'node:assert/strict'
import test from 'node:test'

import { createCoordinationEventPublisher } from '../tavern-plugin/lib/domain/coordination-event-publisher.js'

function intervals() {
  const active = []
  return {
    start(run, delay) {
      const timer = { run, delay, stopped: false }
      active.push(timer)
      return timer
    },
    stop(timer) { timer.stopped = true },
    async tick() {
      const timer = active.find((item) => !item.stopped)
      assert.ok(timer, 'expected an active server poller')
      timer.run()
      await new Promise((resolve) => setImmediate(resolve))
      return timer.delay
    },
    count() { return active.filter((item) => !item.stopped).length },
    delays() { return active.filter((item) => !item.stopped).map((item) => item.delay) }
  }
}

function createPublisher(received, options) {
  return createCoordinationEventPublisher({
    ...options,
    publishSignal(sessionId, signal) { received.push({ sessionId, ...signal }) }
  })
}

test('文件内容未变化时不重复通知，单次读取失败不会终止后续同步', async function () {
  const clock = intervals()
  let call = 0
  const idle = { mailboxVersion: 3, activity: { busy: false, phase: 'idle', updatedAt: 30 }, task: null }
  const received = []
  const publisher = createPublisher(received, {
    async load() {
      call += 1
      if (call === 2) throw new Error('temporary read failure')
      return idle
    },
    startInterval: clock.start,
    stopInterval: clock.stop
  })
  const close = publisher.watch('session-2')

  await new Promise((resolve) => setImmediate(resolve))
  await clock.tick()
  await clock.tick()

  assert.equal(received.length, 1)
  assert.equal(received[0].kind, 'tavern-state')
  close()
})
