import { replaceSessionSurface } from './session-surface-mutations.js'
import { randomUUID } from 'node:crypto'
import { sessionEvents } from './session-events.js'

/** Retire request scaffolding only; story and append-only evidence stay intact. */
export function retireForegroundFrames(session, { keepTurn } = {}) {
  const events = sessionEvents(session)
  const bySeq = new Map(events.map(event => [event.seq, event]))
  let count = 0
  for (const seq of [...(session.surface?.nodes || [])]) {
    const event = bySeq.get(seq), data = event?.data, source = data?.source
    if (event?.type !== 'user/message' || source?.kind !== 'plugin' || source.plugin !== 'dsh-tavern' || source.form !== 'foreground-frame') continue
    if (Number.isSafeInteger(keepTurn) && Number(source.trace?.turn) === keepTurn) continue
    if (!Array.isArray(data.content) || !data.content.length) continue
    replaceSessionSurface(session, 'user/message', {
      id: randomUUID(), role: 'user', content: [],
      source: { kind: 'plugin', plugin: 'dsh-tavern', form: 'foreground-frame', ...(source.trace === undefined ? {} : { trace: source.trace }) }
    }, { start: seq, end: seq, sourceEventSeqs: [seq] })
    count++
  }
  return count
}
