export function compactedLegacySession({ dirty = false } = {}) {
  const message = (id, text, source = { kind: 'user' }) => ({ id, role: 'user', content: [{ type: 'text', text }], source })
  const rows = [
    { type: 'turn/start', data: { turn: 1 } },
    { type: 'step/start', data: { turn: 1, step: 1 } },
    { type: 'user/message', surfaceOp: 'append', data: message('old', 'OLD_STORY_SHOULD_STAY_ARCHIVED '.repeat(1000), { kind: 'user', ...(dirty ? { fixedSystemText: 'obsolete' } : {}) }) },
    { type: 'step/end', data: { turn: 1, step: 1 } },
    { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
    { type: 'compaction/start', data: { compactionId: 'c1', turn: null } },
    { type: 'compaction/summary', data: { compactionId: 'c1', summary: [{ type: 'text', text: 'SUMMARY_TO_KEEP' }], shadowedRange: { start: 2, end: 2 }, shadowedSeqs: [2], shadowedTokenCount: 7000, provider: 'fixture', model: 'fixture' } },
    { type: 'user/message', surfaceOp: { op: 'replace', start: 2, end: 2 }, sourceEventSeqs: [2, 6], data: message('summary', 'SUMMARY_TO_KEEP', { kind: 'plugin', plugin: 'compact', compactionId: 'c1' }) },
    { type: 'compaction/end', data: { compactionId: 'c1', turn: null } }
  ].map((row, seq) => ({ ...row, seq, time: 1 }))
  const header = { type: 'session', delegationDepth: 0, version: 0, id: 'issue-94', createdAt: 1, cwd: '/tmp' }
  return { header, events: rows, text: [header, ...rows].map(row => JSON.stringify(row)).join('\n') + '\n' }
}

export function compactedEditedLegacySession() {
  const base = compactedLegacySession({ dirty: true })
  const source = { kind: 'model', provider: 'fixture', model: 'fixture' }
  const assistant = (id, text) => ({ turn: 1, step: 1, message: { id, role: 'assistant', content: [{ type: 'text', text }], source } })
  const rows = [
    ...base.events.slice(0, 3),
    { type: 'assistant/message', surfaceOp: 'append', data: assistant('original', '原来的正文') },
    { type: 'assistant/message', surfaceOp: { op: 'replace', start: 3, end: 3 }, sourceEventSeqs: [3], data: assistant('tavern-body-edit:fixture', '编辑后的正文') },
    base.events[3], base.events[4], base.events[5],
    { ...base.events[6], data: { ...base.events[6].data, shadowedRange: { start: 2, end: 4 }, shadowedSeqs: [2, 4] } },
    { ...base.events[7], surfaceOp: { op: 'replace', start: 2, end: 4 }, sourceEventSeqs: [2, 4, 8] },
    base.events[8]
  ].map((row, seq) => ({ ...row, seq, time: 1 }))
  return { header: base.header, events: rows, text: [base.header, ...rows].map(row => JSON.stringify(row)).join('\n') + '\n' }
}
