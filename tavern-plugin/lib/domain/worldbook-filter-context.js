import { createHash } from 'node:crypto'

const versionOf = text => createHash('sha256').update(text).digest('hex')
const keyOf = (ref, version) => JSON.stringify([ref, version])

// Only reuse full bodies still present in the native model-visible surface.
// Raw events and a remembered hash are insufficient after compaction or rewind.
function visibleBodies(session) {
  const known = new Map()
  if (typeof session?.deriveMessages !== 'function') return known
  for (const message of session.deriveMessages()) {
    const source = message.source, span = source?.worldbookFilterPayload
    if (source?.kind !== 'plugin' || source.plugin !== 'dsh-tavern' || span?.version !== 1 || !message.id) continue
    const content = message.content
    if (!Array.isArray(content) || content.length !== 1 || content[0]?.type !== 'text') continue
    const text = content[0].text
    if (typeof text !== 'string' || !Number.isSafeInteger(span.start) || !Number.isSafeInteger(span.length) ||
        span.start < 0 || span.length < 1 || span.start + span.length > text.length) continue
    let payload
    try { payload = JSON.parse(text.slice(span.start, span.start + span.length)) } catch { continue }
    if (!Array.isArray(payload?.candidates)) continue
    for (const item of payload.candidates) {
      if (typeof item?.ref !== 'string' || typeof item.text !== 'string' || item.bodyVersion !== versionOf(item.text)) continue
      known.set(keyOf(item.ref, item.bodyVersion), { messageId: message.id, ref: item.ref, version: item.bodyVersion })
    }
  }
  return known
}

// Changes only the newly appended task. No history, system prompt or tools are edited.
export function projectWorldbookFilterContext(session, input) {
  if (input.task !== 'worldbook-filter' || input.messages?.length !== 1) return null
  const message = input.messages[0]
  if (message.role !== 'user' || message.content?.length !== 1 || message.content[0]?.type !== 'text') return null
  let payload
  try { payload = JSON.parse(message.content[0].text) } catch { return null }
  if (!Array.isArray(payload?.candidates) || payload.candidates.some(item => typeof item?.ref !== 'string' || typeof item.text !== 'string')) return null
  let known
  try { known = visibleBodies(session) } catch { known = new Map() }
  const candidates = payload.candidates.map(item => {
    const { bodyReference: _oldReference, bodyVersion: _oldVersion, ...full } = item
    // A reference and digest can cost more than a short body. Keep small entries literal.
    if (Buffer.byteLength(item.text, 'utf8') < 512) return full
    const bodyVersion = versionOf(item.text)
    const bodyReference = known.get(keyOf(item.ref, bodyVersion))
    if (!bodyReference) return { ...full, bodyVersion }
    const { text: _text, ...metadata } = full
    return { ...metadata, bodyVersion, bodyReference }
  })
  const payloadText = JSON.stringify({ ...payload, candidates })
  return { payloadText, messages: [{ ...message, content: [{ type: 'text', text: payloadText }] }] }
}
