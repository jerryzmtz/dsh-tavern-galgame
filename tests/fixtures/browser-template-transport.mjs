// Browser reference transport for migration comparisons and historical benchmarks.
import { randomUUID, createHash } from 'node:crypto'
import { createTavernScriptDispatch } from '../../tavern-plugin/lib/domain/tavern-script-dispatch.js'

/** Transport only. All template semantics are executed by the upstream browser plugin. */
export function createFullTemplateRuntime({ publishSignal, claimTimeoutMs = 30000, readyTimeoutMs = 60000, executionTimeoutMs = 60000, store }) {
  const dispatch = createTavernScriptDispatch({ renewableExecution: true, preservePresenceOnClaimTimeout: true, publishSignal, presenceTtlMs: 60000, claimTimeoutMs, executionTimeoutMs })
  let disposed = false
  const jobs = new Map()
  // Projection receipts are useful only while their caller is alive. Retain
  // identities (not rendered payloads) for transport retries, with bounded memory.
  const projectionReceipts = new Map()
  const journalPath = id => 'template-work/' + createHash('sha256').update(id).digest('hex') + '.json'
  async function saveJob(id, job) {
    if (store && !job.transient) await store.writeJson(journalPath(id), job)
  }
  const health = new Map()
  const tails = new Map()
  const sessions = new Set()
  function waitUntilReady(sessionId, job) {
    return new Promise((resolve, reject) => {
      let stop = () => {}
      const timer = setTimeout(() => {
        stop()
        const state = dispatch.status(sessionId)
        const status = health.get(sessionId)
        const error = new Error(state.present
          ? '完整提示词模板尚未就绪（' + (status?.phase || '初始化中') + '），请检查模板初始化状态后重试'
          : '完整提示词模板等待就绪超时；未收到有效就绪心跳，尚不能确认连接已断开，请检查酒馆页面后重试')
        error.code = 'FULL_TEMPLATE_UNAVAILABLE'
        reject(error)
      }, readyTimeoutMs)
      Object.defineProperty(job, 'cancelWait', { configurable: true, value: () => {
        clearTimeout(timer); stop(); reject(new Error('完整提示词模板任务已手动取消'))
      } })
      function check() {
        if (job.cancelled) { job.cancelWait(); return }
        const state = dispatch.status(sessionId)
        if (!state.ready && !state.initializationError) return
        clearTimeout(timer); stop()
        if (state.initializationError) {
          const error = new Error(state.initializationError); error.code = 'FULL_TEMPLATE_UNAVAILABLE'; reject(error)
        } else resolve()
      }
      stop = dispatch.subscribeSettled(id => { if (id === sessionId) check() })
      check()
    })
  }
  async function invoke(sessionId, operation, input, transient = false) {
    if (disposed) throw new Error('完整提示词模板运行时已停止')
    if (!sessionId) throw new Error('完整提示词模板缺少所属会话')
    const previous = tails.get(sessionId) || Promise.resolve()
    const pending = previous.catch(() => {}).then(async () => {
      const prior = !transient && store && await store.readJson(journalPath(sessionId))
      // Recovery acknowledges receipts; it never replays template input. Keep
      // the payload in the dispatch closure, not in every journal phase.
      const job = { id: randomUUID(), operation, inputBytes: Buffer.byteLength(JSON.stringify(input)), phase: 'queued', createdAt: Date.now(),
        ...(transient ? { transient: true } : {}),
        previous: prior ? { id: prior.id, operation: prior.operation, phase: prior.phase, createdAt: prior.createdAt } : null }
      // Queued work has no side effects and is never replayed after restart.
      // Durable work persists intent before start and receipt before ack.
      // Transient projections retain only an in-process receipt identity.
      jobs.set(sessionId, job)
      try {
      for (let attempt = 0; attempt < 2; attempt++) {
        await waitUntilReady(sessionId, job)
        const result = await dispatch.dispatch(sessionId, operation, [input], null, { eventId: job.id })
        if (job.cancelled) throw new Error('完整提示词模板任务已手动取消')
        if (result.handled) return result.args[0]
        if (result.claimTimedOut && dispatch.status(sessionId).present) {
          const error = new Error('完整提示词模板任务领取超时；执行器仍有有效心跳，但未确认领取任务，本轮已停止。这不代表模型生成超时或连接断开。')
          error.code = 'FULL_TEMPLATE_CLAIM_TIMEOUT'
          throw error
        }
        // Only unstarted work can be safely retried: templates may mutate variables.
        if (!disposed && attempt === 0 && (result.unavailable || result.disposed) && !result.timedOut && (!result.phase || ['queued', 'offered'].includes(result.phase))) continue
        const error = new Error(result.error || ((result.timedOut || result.executionLost)
          ? '完整提示词模板执行超时：未持续收到当前任务的执行确认，本轮已停止；无法据此确认连接断开。'
          : result.disposed ? '完整提示词模板执行器已释放，任务已停止，请刷新酒馆页面后重试。' : '完整提示词模板任务未完成，未能确认执行器状态，请检查酒馆页面后重试。'))
        error.code = 'FULL_TEMPLATE_UNAVAILABLE'
        throw error
      }
      } catch (error) {
        if (job.phase !== 'completed') {
          job.phase = job.phase === 'executing' ? 'interrupted' : 'cancelled'
          job.error = String(error.message || error)
          await saveJob(sessionId, job)
        }
        throw error
      } finally { if (jobs.get(sessionId) === job) jobs.delete(sessionId) }
    })
    tails.set(sessionId, pending)
    try { return await pending } finally { if (tails.get(sessionId) === pending) tails.delete(sessionId) }
  }
  function forSession(sessionId) {
    sessions.add(sessionId)
    return {
      renderInput: (text, context = {}) => invoke(sessionId, 'input', {text, context}),
      prepareWorldbook: (entries, context = {}) => invoke(sessionId, 'worldbook', { entries, context }),
      command: text => invoke(sessionId, 'command', { text }),
      render: (template, context = {}) => invoke(sessionId, 'render', { template, context: JSON.parse(JSON.stringify(context)) }),
      // Opt-in for foreground worldbook projections whose caller does not
      // survive restart. Keep ordinary renders and commands durable. Started
      // projections are still never replayed automatically: EJS may call out.
      renderProjection: (template, context = {}) => invoke(sessionId, 'render', { template, context: JSON.parse(JSON.stringify(context)) }, true),
      // Per-entry receipts omit scopes; the browser owns their sequential handoff.
      renderProjections: (items, context = {}) => invoke(sessionId, 'renderMany', JSON.parse(JSON.stringify({ items, context })), true),
      renderMessages: (messages, context = {}) => invoke(sessionId, 'messages', { messages, context }),
      projectRequest: request => invoke(sessionId, 'request', { request }),
      initializeVariables: (entries, context = {}) => invoke(sessionId, 'initialize', { entries, context })
    }
  }
  async function start(sessionId, eventId, leaseToken, runtimeId) {
    const job = jobs.get(sessionId)
    if (!job || job.id !== eventId) return { started: false }
    // Validate the offered lease before persisting execution intent.
    const offered = dispatch.claim(sessionId, runtimeId, true)
    if (offered.event?.id !== eventId || offered.leaseToken !== leaseToken) return { started: false }
    job.phase = 'executing'; job.runtimeId = runtimeId; job.leaseToken = leaseToken
    await saveJob(sessionId, job)
    return dispatch.start(sessionId, eventId, leaseToken, runtimeId)
  }
  async function complete(sessionId, eventId, args, runtimeId, leaseToken, error = '') {
    const receipt = projectionReceipts.get(eventId)
    if (receipt) return receipt.sessionId === sessionId && receipt.runtimeId === runtimeId && receipt.leaseToken === leaseToken
    const job = jobs.get(sessionId) || (store && await store.readJson(journalPath(sessionId)))
    if (!job || job.id !== eventId || job.runtimeId !== runtimeId || job.leaseToken !== leaseToken) return false
    if (job.phase === 'completed') return true
    if (job.phase !== 'executing' || dispatch.status(sessionId).phase !== 'executing' || !dispatch.available(sessionId, runtimeId)) return false
    // Recovery only acknowledges this identity; no caller survives to consume the
    // result after restart. Deliver args to the live dispatch, never persist them.
    const completed = { ...job, phase: 'completed', receipt: { error }, completedAt: Date.now() }
    await saveJob(sessionId, completed)
    Object.assign(job, completed)
    const accepted = dispatch.complete(sessionId, eventId, args, runtimeId, leaseToken, error)
    if (accepted && job.transient) {
      projectionReceipts.set(eventId, { sessionId, runtimeId, leaseToken })
      while (projectionReceipts.size > 256) projectionReceipts.delete(projectionReceipts.keys().next().value)
    }
    return accepted
  }
  function heartbeat(sessionId, runtimeId, phase, initializationError = '', work) {
    const ready = ['ready', 'working', 'synchronizing'].includes(phase)
    const active = dispatch.touch(sessionId, runtimeId, ready, initializationError)
    if (active && work?.eventId && work?.leaseToken) dispatch.workState(sessionId, work.eventId, work.leaseToken, runtimeId, true)
    if (active) health.set(sessionId, { phase, seenAt: Date.now() })
    return { active, ...dispatch.status(sessionId) }
  }
  async function inspect(sessionId) {
    const job = jobs.get(sessionId) || (store && await store.readJson(journalPath(sessionId)))
    return { ...dispatch.status(sessionId), heartbeat: health.get(sessionId) || null,
      task: job ? { id: job.id, operation: job.operation, phase: job.phase, createdAt: job.createdAt,
        completedAt: job.completedAt, error: job.error, previous: job.previous } : null }
  }
  function cancel(sessionId) {
    const job = jobs.get(sessionId)
    if (!job) return
    job.cancelled = true
    job.cancelWait?.()
    dispatch.dispose(sessionId)
  }
  return { dispatch, forSession, heartbeat, start, complete, inspect, cancel, dispose: () => { disposed = true; for (const id of sessions) dispatch.dispose(id); sessions.clear(); projectionReceipts.clear() } }
}
