import assert from 'node:assert/strict'
export const flush = () => new Promise(resolve => setImmediate(resolve))
export const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
export function syncClock() {
  let now = 0, id = 0
  const jobs = new Map()
  const next = () => [...jobs.values()].sort((a, b) => a.at - b.at || a.id - b.id)[0]
  return {
    now: () => now,
    schedule(run, delay) { const timer = { id: ++id, at: now + delay, run }; jobs.set(timer.id, timer); return timer.id },
    cancel(timer) { jobs.delete(timer) },
    delays: () => [...jobs.values()].map(job => job.at - now).sort((a, b) => a - b),
    async next() { const job = next(); assert.ok(job, 'expected scheduled work'); now = job.at; jobs.delete(job.id); job.run(); await flush() },
    async advance(ms) {
      const end = now + ms
      for (let job = next(); job && job.at <= end; job = next()) { now = job.at; jobs.delete(job.id); job.run(); await flush() }
      now = end
      await flush()
    }
  }
}
