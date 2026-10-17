import { foregroundFrameText } from './agent-input-frame.js'
import { worldbookSnapshot } from './worldbook-snapshot.js'
import { promptSectionBody } from './prompt-section.js'
import { cardSystemPromptSnapshot, cardSystemPromptSource } from './card-system-prompt.js'

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function frameIdOf(message) {
  const source = message && message.source
  return str(source && source.trace && source.trace.frameId)
}

/** Adapt one ForegroundFrame to the current DSH agent/pre-step message seam. */
export function createForegroundFrameSessionAdapter(options = {}) {
  const makeId = typeof options.id === 'function' ? options.id : function () { return crypto.randomUUID() }

  function append(input = {}) {
    const messages = Array.isArray(input.messages) ? input.messages : []
    const frame = input.frame
    if (!frame || frame.kind !== 'foreground') throw new Error('Session Adapter 只接受 ForegroundFrame')
    if (Number(input.step) !== 1) return { messages, receipt: { appended: false, reason: 'not-first-step', frameId: frame.frameId } }
    if (messages.some(function (message) { return frameIdOf(message) === frame.frameId })) {
      return { messages, receipt: { appended: false, reason: 'duplicate', frameId: frame.frameId } }
    }
    const entries = frame.contributions.filter(item => item.slot === 'activeWorldbook').flatMap((item, index) =>
      item.entries || [{ ref: JSON.stringify(['section', item.source?.stage, item.source?.plugin, item.source?.name, index]), text: promptSectionBody('worldbook_context', promptSectionBody('constant_worldbook', item.text)) }])
    const snapshot = worldbookSnapshot(input.session, entries, input.historyMessages || messages)
    const contributions = frame.contributions.filter(item => item.slot !== 'activeWorldbook')
    const snapshots = snapshot ? [{
      id: makeId() + ':worldbook', role: 'user',
      content: [{ type: 'text', text: snapshot.rendered }],
      source: { kind: 'plugin', plugin: 'dsh-tavern', form: 'worldbook-snapshot',
        worldbookSnapshot: snapshot, trace: { frameId: frame.frameId, turn: frame.turn, operationId: frame.operationId } }
    }] : []
    if (typeof frame.source?.card?.systemPromptText === 'string') {
      const update = cardSystemPromptSnapshot(input.session, frame.source.card.systemPromptText, input.historyMessages || messages, input.openingText)
      if (update) snapshots.push({
        id: makeId() + ':card-system-prompt', role: 'user',
        content: [{ type: 'text', text: update.rendered }],
        source: { kind: 'plugin', plugin: 'dsh-tavern', form: 'card-system-prompt-update',
          trace: { frameId: frame.frameId, turn: frame.turn, operationId: frame.operationId, ...cardSystemPromptSource(update) } }
      })
    }
    const text = foregroundFrameText({ contributions })
    if (text === '') return { messages: messages.concat(snapshots), receipt: { appended: snapshots.length > 0, reason: snapshots.length ? 'appended' : 'empty', frameId: frame.frameId } }
    const sections = contributions.map(function (item, index) {
      return {
        name: 'tavern:foreground:' + str(item.slot) + ':' + (index + 1),
        text: str(item.text),
        source: item.source
      }
    })
    return {
      messages: messages.concat(snapshots, [{
        id: makeId(),
        role: 'user',
        content: [{ type: 'text', text }],
        source: {
          kind: 'plugin',
          plugin: 'dsh-tavern',
          form: 'foreground-frame',
          sections,
          trace: {
            frameId: frame.frameId,
            chatId: frame.chatId,
            branchId: frame.branchId,
            basedOnRevision: frame.basedOnRevision,
            operationId: frame.operationId,
            turn: frame.turn
          }
        }
      }]),
      receipt: { appended: true, reason: 'appended', frameId: frame.frameId }
    }
  }

  return Object.freeze({ append })
}
