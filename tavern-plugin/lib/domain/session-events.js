// DSH rc.1 exposes immutable history through snapshotEvents(); older hosts
// expose events. Keep version differences here, without changing the Session.
export function sessionEvents(session) {
  if (!session) return []
  if (typeof session.snapshotEvents === 'function') return session.snapshotEvents()
  return Array.isArray(session.events) ? session.events : []
}

// V3 compaction pins only surface node zero. Reserve the host's empty system
// slot before Tavern seeds, so the first real Agent step fills that same slot.
// Existing surfaces are never reordered or rewritten.
export function ensureSessionSystemHead(session) {
  if (!(session?.header?.version >= 3) || session.surface.nodes.length > 0) return
  appendSessionEvent(session, 'system/message', { turn: 1, step: 1, message: {
    id: 'tavern-system-head:' + session.id, role: 'system', content: [],
    source: { kind: 'plugin', plugin: '@deepseek-ai/dsh-system-prompt' }
  } }, { surfaceOp: 'append' })
}

// Normalize only new writes at the host boundary. Existing events, seqs and
// provenance stay untouched; V3 migrations remain owned by DSH.
export function sessionEventData(session, type, data) {
  return session?.header?.version >= 3 && type === 'assistant/message' && data.stream === undefined
    ? { ...data, stream: [] } : data
}

export function appendSessionEvent(session, type, data, intent) {
  if (session?.header?.version >= 3) {
    if (intent) {
      intent = { ...intent }
      const op = intent.surfaceOp
      if (op && typeof op === 'object' && op.op === 'replace' && 'start' in op) {
        intent.surfaceOp = { op: 'replace', startSeq: op.start, endSeq: op.end }
      }
      if (type === 'assistant/message' && intent.surfaceOp === 'append') delete intent.sourceEventSeqs
    }
  }
  data = sessionEventData(session, type, data)
  return intent === undefined ? session.append(type, data) : session.append(type, data, intent)
}

export function surfaceReplacementRange(op) {
  return { start: op.startSeq ?? op.start, end: op.endSeq ?? op.end }
}
