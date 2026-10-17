import { AsyncLocalStorage } from 'node:async_hooks'
import { performance } from 'node:perf_hooks'

// Only fixed metadata is retained; arguments, paths and response bodies never enter traces.
export function createRequestPerformance({ now = () => performance.now(), wall = Date.now } = {}) {
  const context = new AsyncLocalStorage()
  const recent = [], slow = [], openings = []
  let active = 0
  function append(rows, row, limit) { rows.push(row); if (rows.length > limit) rows.shift() }
  return {
    async run(method, id, operation) {
      if (!['getSession', 'syncSession', 'getCardOpenings', 'initializeOpeningTemplate', 'preparePlayStart', 'startChat'].includes(method)) return operation()
      const start = now(), utilization = performance.eventLoopUtilization()
      const row = { method, id: /^[a-f0-9-]{36}$/.test(id || '') ? id : '', receivedAt: wall(), active: ++active, stages: [] }
      let lastTick = now()
      row.eventLoopDelayMaxMs = 0
      const sample = () => {
        const tick = now()
        row.eventLoopDelayMaxMs = Math.max(row.eventLoopDelayMaxMs, Math.round(Math.max(0, tick - lastTick - 100)))
        lastTick = tick
      }
      const timer = setInterval(sample, 100)
      timer.unref()
      try { return await context.run(row, operation) }
      catch (error) { row.failed = true; throw error }
      finally {
        sample(); clearInterval(timer)
        active--
        row.durationMs = Math.round(now() - start)
        row.eventLoopUtilization = performance.eventLoopUtilization(utilization).utilization
        append(recent, row, 120)
        if (!['getSession', 'syncSession'].includes(method)) append(openings, row, 60)
        if (row.durationMs >= 1000) append(slow, row, 60)
      }
    },
    async stage(name, operation) {
      const row = context.getStore(), start = now()
      try { return await operation() }
      finally { if (row && row.stages.length < 40) row.stages.push({ name, durationMs: Math.round(now() - start) }) }
    },
    state({ foregroundRunning, backgroundBusy, backgroundRole, viewRebuild, helperMessageCount }) {
      const row = context.getStore()
      if (row) {
        row.activity = { foregroundRunning: foregroundRunning === true, backgroundBusy: backgroundBusy === true,
          backgroundRole: ['candidate', 'settlement', 'worldbook-filter', 'image', 'phone'].includes(backgroundRole) ? backgroundRole : '' }
        if (viewRebuild === 'window' || viewRebuild === 'full' || viewRebuild === 'dirty' || viewRebuild === 'cache') row.viewRebuild = viewRebuild
        if (Number.isSafeInteger(helperMessageCount) && helperMessageCount >= 0) row.helperMessageCount = helperMessageCount
      }
    },
    read() { return structuredClone({ recent, slow, openings }) }
  }
}
