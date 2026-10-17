import { sessionEvents } from './session-events.js'
import { inputKind, isNewTurnInput, storyPlayerInputs } from './session-turn-input.js'
import { clearRegenerationAttemptSurface, regenerationAttemptTurns, locateRegenerationSurface, applyRegenerationProjection } from './rollback-surface.js'

/** Recover an uncommitted replacement from its durable pre-rollback revision. */
export function createRegenerationRecovery({ chats, sessions, timeline, isActive }) {
  const recovering = new Set()

  async function originalState(chat) {
    const saved = chat.regenRecovery
    if (saved) {
      const before = saved.before || await chats.readRevision(chat.id, saved.beforeRevision)
      if (!before || before.id !== chat.id || before.regenInProgress) throw new Error('找不到重新生成前的存档恢复点')
      return before
    }
    // Old releases wrote only the flag. Walk backwards to the last state before
    // this uninterrupted run of flagged revisions; never guess from message count.
    for (let revision = Number(chat._storageRevision) - 1; revision >= 0; revision--) {
      const before = await chats.readRevision(chat.id, revision)
      if (!before || before.id !== chat.id) break
      if (before.regenInProgress !== true) return before
    }
    throw new Error('找不到旧版重新生成前的历史存档，未修改当前对话')
  }

  function legacyEventStart(before, session) {
    const events = sessionEvents(session)
    const assistant = before.messages?.findLast(message => message.role === 'assistant' && !message.greeting)
    const target = locateRegenerationSurface({ events, nodes: session.surface?.nodes || [], turn: assistant?.turn })
    if (!target) throw new Error('找不到原正文的原生消息，未修改当前对话')
    const attempt = events.find(event => event.seq > target.assistantSeq && isNewTurnInput(event) && inputKind(event.data) === 'regenerate')
    return attempt ? attempt.seq : events.length
  }

  async function abort({ chatId, originalChat, session, eventStart, operationId }) {
    // Hold the Chat store transaction across projection cleanup and flush. A
    // concurrent observer must not invalidate restoration after cleanup succeeds.
    return await chats.update(chatId, async current => {
      if (!current || current.regenRecovery?.phase === 'committed' || current.regenInProgress !== true ||
          (operationId && current.regenRecovery?.id !== operationId) ||
          Number(current.tavernHelperLifecycleRevision || 0) > Number(originalChat.tavernHelperLifecycleRevision || 0) + 1) return
      const events = sessionEvents(session)
      // A send rejected while the marker was set failed its own turn; only real
      // story after the attempt stops the cleanup, or recovery would never succeed.
      if (storyPlayerInputs(events, eventStart).length) {
        throw new Error('重新生成后已有新的玩家输入，未清理或覆盖后续对话')
      }
      const abortedTurns = regenerationAttemptTurns({ events, eventStart })
      // Retain the durable recovery point if the native flush fails.
      clearRegenerationAttemptSurface({ session, eventStart })
      if (typeof sessions.flush === 'function') await sessions.flush(session)
      const next = timeline.apply({ chat: current, intent: { kind: 'replacement.abort', restoreChat: originalChat } }).chat
      delete next.regenInProgress
      delete next.regenRecovery
      next.tavernHelperLifecycleRevision = Number(current.tavernHelperLifecycleRevision || 0) + 1
      next.suppressedDshTurns = [...new Set([...(next.suppressedDshTurns || []), ...abortedTurns])].sort((a, b) => a - b)
      return next
    }, { source: 'foreground.regen-abort' })
  }

  // Chat is already authoritative here. Never roll it back if projecting or
  // flushing the native replacement fails; keep a durable, idempotent intent.
  async function complete({ chatId, session, operationId }) {
    return await chats.update(chatId, async current => {
      const saved = current?.regenRecovery
      if (!saved || saved.phase !== 'committed' || (operationId && saved.id !== operationId)) return
      if (saved.sessionId !== session.id) throw new Error('重新生成恢复会话不匹配')
      const projection = saved.projection
      if (!projection) throw new Error('重新生成缺少已提交正文的投影记录')
      applyRegenerationProjection(session, projection)
      if (typeof sessions.flush === 'function') await sessions.flush(session)
      delete current.regenRecovery
      delete current.regenInProgress
      return current
    }, { source: 'foreground.regen-projected' })
  }

  async function recover(chatId) {
    if (isActive(chatId) || recovering.has(chatId)) return
    recovering.add(chatId)
    let handle
    try {
      if (chats.readState && !(await chats.readState(chatId))?.regenInProgress) return
      const chat = await chats.read(chatId)
      if (!chat || chat.regenInProgress !== true) return
      const sessionId = chat.regenRecovery?.sessionId || chat.sessionId
      let agent = sessions.get(sessionId)
      if (agent?.phase?.kind === 'running') return
      let session = agent?.session || sessions.getSession?.(sessionId)
      if (!session && typeof sessions.resume === 'function') {
        handle = await sessions.resume(sessionId)
        agent = handle.agent
        session = agent?.session
      }
      if (agent?.phase?.kind === 'running') return
      if (!session) throw new Error('无法加载重新生成的原生会话，恢复点已保留')
      if (chat.regenRecovery?.phase === 'committed') return await complete({ chatId, session, operationId: chat.regenRecovery.id })
      const before = await originalState(chat)
      const eventStart = chat.regenRecovery?.eventStart ?? legacyEventStart(before, session)
      if (!Number.isSafeInteger(eventStart) || eventStart < 0 || eventStart > sessionEvents(session).length) {
        throw new Error('重新生成的原生历史边界不匹配，恢复点已保留')
      }
      return await abort({ chatId, originalChat: before, session, eventStart, operationId: chat.regenRecovery?.id })
    } finally {
      try { if (handle) await handle.dispose() }
      finally { recovering.delete(chatId) }
    }
  }

  return Object.freeze({ recover, abort, complete })
}
