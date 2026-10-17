import { createHash } from 'node:crypto'
import { redactDiagnostic } from './mvu-diagnostics.js'

const maxBytes = 2 * 1024 * 1024
const maxRecordBytes = 128 * 1024
const recordKey = record => createHash('sha256').update(JSON.stringify([record.requestId, record.targetKey])).digest('hex')
const recordPath = (chatId, key) => pathFor(chatId).slice(0, -5) + '/' + key + '.json'
const recordSize = record => Buffer.byteLength(JSON.stringify(record))
const indexEntry = record => ({ key: recordKey(record), requestId: record.requestId, targetKey: record.targetKey, bytes: recordSize(record) })
const pathFor = chatId => 'diagnostics/scene-' + createHash('sha256').update(String(chatId)).digest('hex') + '.json'

export function redactSceneDiagnostic(value, secrets = [], depth = 0) {
  if (depth > 24) return '[depth limit]'
  if (Buffer.isBuffer(value) || ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return '[image bytes omitted]'
  if (typeof value === 'string') {
    for (const secret of secrets.filter(item => typeof item === 'string' && item)) value = value.replaceAll(secret, '[REDACTED]')
    return redactDiagnostic(value.replace(/data:image\/[^\s"']+/gi, '[image bytes omitted]'))
  }
  if (Array.isArray(value)) return value.map(item => redactSceneDiagnostic(item, secrets, depth + 1))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
    /^(?:base64|b64_json|image_data|image_bytes|image_base64)$/i.test(key) || value.type === 'image' && key === 'data' ? '[image bytes omitted]'
      : /^(?:authorization|proxy-authorization|cookie|set-cookie|api[-_]?key|access[-_]?token|refresh[-_]?token|token|password|secret|client[-_]?secret)$/i.test(key) ? '[REDACTED]'
        : redactSceneDiagnostic(item, secrets, depth + 1)]))
  return value
}

function bounded(record) {
  if (Buffer.byteLength(JSON.stringify(record)) <= maxRecordBytes) return record
  // Keep identity, outcomes and timing when a huge workflow/plan must be omitted.
  const { details, ...summary } = record
  return { ...summary, truncated: true, details: { omitted: 'attempt-details-size-limit', preview: JSON.stringify(details).slice(0, 16000) } }
}

/** Bounded attempt journal. Separate from paid job state: a failed diagnostic
 * write is never permission to retry a provider request. */
export function createSceneImageDiagnostics(store, { onDiagnostic } = {}) {
  return {
    async record(chatId, value, secrets = []) {
      if (!chatId || !value?.requestId || !value.targetKey) return
      const clean = redactSceneDiagnostic(value, secrets)
      const at = Date.now()
      // Host logs feed Desktop's existing Export diagnostics button. Keep the
      // detailed per-chat journal separate from this small support summary.
      if (clean.status !== 'running') {
        const config = clean.details?.configuration || {}
        const select = (value, fields) => Object.fromEntries(fields.filter(key => value[key] !== undefined).map(key => [key, value[key]]))
        const summary = { kind: 'generation', at,
          ...select(clean, ['requestId', 'sessionId', 'turn', 'status', 'stage', 'outcome', 'recovery']),
          ...select(config, ['provider', 'baseURL', 'model', 'size', 'aspectRatio']),
          durationMs: Math.max(0, at - (clean.createdAt || at)),
          requests: (clean.details?.providerRequests || []).slice(-12).map(event => select(event,
            ['requestId', 'phase', 'method', 'status', 'durationMs', 'networkCodes'])) }
        try { await onDiagnostic?.(summary) }
        catch { /* Logging failure must not change paid job state or persistence. */ }
      }
      const index = await store.updateJson(pathFor(chatId), async previous => {
        const records = previous?.records || []
        // Publish the new index only after every referenced body has been saved.
        // A failed migration leaves the legacy file authoritative and readable.
        const entries = previous?.version === 2 ? records : []
        if (previous?.version !== 2) {
          for (const record of records) {
            const entry = indexEntry(record)
            await store.updateJson(recordPath(chatId, entry.key), () => record)
            entries.push(entry)
          }
        }
        const key = recordKey(clean)
        const entry = entries.find(item => item.key === key)
        const record = await store.updateJson(recordPath(chatId, key), stored => {
          const old = entry ? stored : undefined
          const events = [...(old?.events || [])]
          const last = events.at(-1)
          if (!last || last.stage !== clean.stage || last.status !== clean.status || clean.event) events.push({ at, stage: clean.stage, status: clean.status, ...(clean.event ? { event: clean.event } : {}) })
          const stageDurationsMs = {}
          for (let index = 0; index < events.length; index++) {
            const event = events[index]
            if (event.status !== 'running') continue
            stageDurationsMs[event.stage] = (stageDurationsMs[event.stage] || 0) + Math.max(0, (events[index + 1]?.at || at) - event.at)
          }
          return bounded({ ...old, ...clean, updatedAt: at, events: events.slice(-100),
            stageDurationsMs,
            droppedEvents: (old?.droppedEvents || 0) + Math.max(0, events.length - 100),
            ...(clean.status !== 'running' ? { durationMs: Math.max(0, at - (clean.createdAt || old?.createdAt || at)) } : {}) })
        })
        const next = entries.filter(item => item.key !== key).concat(indexEntry(record))
        let dropped = previous?.dropped || 0
        let bytes = 2 + next.reduce((sum, item) => sum + item.bytes + 1, 0)
        const garbage = new Set(previous?.garbage || [])
        while (next.length > 100 || bytes > maxBytes) {
          const removed = next.shift()
          bytes -= removed.bytes + 1
          garbage.add(removed.key)
          dropped++
        }
        for (const item of next) garbage.delete(item.key)
        return { version: 2, chatId, dropped, records: next, garbage: [...garbage] }
      })
      if (index.garbage.length && typeof store.remove === 'function') {
        // Reacquire the index lock: another writer may have revived an evicted
        // identity after publication. Never delete a currently indexed body.
        await store.updateJson(pathFor(chatId), async current => {
          if (current?.version !== 2) return current
          const live = new Set(current.records.map(item => item.key))
          const remaining = []
          for (const key of current.garbage || []) {
            if (live.has(key)) continue
            try { await store.remove(recordPath(chatId, key)) } catch { remaining.push(key) }
          }
          return { ...current, garbage: remaining }
        })
      }
    },
    async read(chatId) {
      const index = await store.readJson(pathFor(chatId))
      if (!index) return { version: 1, chatId, dropped: 0, records: [] }
      if (index.version !== 2) return index
      const records = []
      for (const entry of index.records) {
        const record = await store.readJson(recordPath(chatId, entry.key))
        records.push(record || { requestId: entry.requestId, targetKey: entry.targetKey,
          unavailable: true, error: '诊断详情缺失或已被容量清理。' })
      }
      return { version: 1, chatId, dropped: index.dropped, records }
    }
  }
}

/** Cordis logger is exported by Desktop's FileExporter; console is not. */
export function createSceneImageHostLogger(logger) {
  return event => {
    const summary = { component: 'dsh-tavern.scene-image', version: 1,
      runtime: { node: process.version, platform: process.platform, arch: process.arch }, ...event }
    const line = JSON.stringify(summary)
    // Stay below Desktop's 10 KiB per-message limit with an explicit omission.
    const bounded = Buffer.byteLength(line) <= 8000 ? line : JSON.stringify({
      component: summary.component, version: 1, kind: summary.kind,
      status: summary.status, truncated: true, reason: 'host-diagnostic-size-limit' })
    const level = ['failed', 'configuration_failed', 'auth_failed'].includes(summary.status) ? 'warn' : 'info'
    logger?.[level]?.('%s', bounded)
  }
}

export function sceneAttemptDiagnostic(sessionId, record, event) {
  const version = record.versions?.find(item => item.requestId === record.requestId)
  return { requestId: record.requestId, targetKey: record.key, sessionId, turn: record.turn, kind: record.kind,
    createdAt: record.createdAt, completedAt: record.completedAt, status: record.status, stage: record.stage,
    outcome: record.outcome, recovery: record.recovery, error: record.error, traceSessionId: record.traceSessionId,
    ...(event ? { event } : {}),
    usage: { status: 'not-provided', note: '文字请求与用量以子 Session 逐次记录为准；未提供的图片用量不推测为零。' },
    details: { configuration: record.configuration, instruction: record.instruction, baseVersionId: record.baseVersionId,
      diagnostics: record.diagnostics, providerTask: record.providerTask, providerRequests: record.providerRequests,
      plan: record.plan, prompt: record.prompt, generation: version?.generation, attachment: version?.attachment,
      versionId: version?.id } }
}

// Small allowlisted UI/transport trail. Never accept arbitrary prompt/config fields.
export async function recordSceneImageInteraction(diagnostics, chatId, value = {}) {
  const stages = ['click', 'blocked', 'cancelled', 'sent', 'received', 'returned', 'failed'];
  if (!diagnostics || !stages.includes(value.stage) || typeof value.requestId !== 'string' || !value.requestId) return;
  await diagnostics.record(chatId, {
    requestId: value.requestId.slice(0, 120), targetKey: 'interaction',
    stage: value.stage, status: 'interaction',
    turn: Number.isSafeInteger(value.turn) ? value.turn : undefined,
    event: { reason: ['not-ready', 'busy-or-existing', 'confirmation', 'rpc-error', 'start-error'].includes(value.reason) ? value.reason : undefined }
  });
}
