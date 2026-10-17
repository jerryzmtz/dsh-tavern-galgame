export function fixture(n) {
  const events = Array.from({ length: n }, (_, seq) => ({ seq, type: 'user/message', data: { id: 'm'+seq, role: 'user', content: [{ type: 'text', text: 'text'+seq }] } }))
  let snapshots = 0
  const session = { header: {}, events, surface: { nodes: events.map(e => e.seq) }, snapshotEvents() { snapshots++; return events.slice() }, append(type, data, intent) {
    const event = { seq: events.length, type, data, ...intent }; events.push(event)
    if (intent.surfaceOp === 'append') this.surface.nodes.push(event.seq)
    else { const op = intent.surfaceOp, start = this.surface.nodes.indexOf(op.start), end = this.surface.nodes.indexOf(op.end); this.surface.nodes.splice(start, end-start+1, event.seq) }
    return event
  } }
  return { session, events, snapshots: () => snapshots }
}
