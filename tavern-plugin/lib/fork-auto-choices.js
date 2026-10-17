// private fork: opt-in scheduling only; the existing candidate mailbox owns generation and errors.
import { createHash } from 'node:crypto'

function latestReply(chat) {
  return (chat?.messages || []).findLast(message => message?.role === 'assistant')
}

function identity(chat) {
  const reply = latestReply(chat)
  return JSON.stringify([chat?.id, chat?.timeline?.branchId, reply?.turn, reply?.ts,
    reply?.swipeId, reply?.sourceText, reply?.text])
}

export function createForkAutoChoices({ read, preferences, activity, submit,
  defer = callback => setTimeout(callback, 1000), clear = clearTimeout, report = console.error }) {
  const pending = new Map()
  const seen = new Set()
  let disposed = false

  function cancel(sessionId) {
    const item = pending.get(sessionId)
    if (item?.timer) clear(item.timer)
    pending.delete(sessionId)
  }

  function cancelAll() {
    for (const sessionId of pending.keys()) cancel(sessionId)
  }

  function current(item) { return !disposed && pending.get(item.sessionId) === item }

  function later(item) {
    if (!current(item)) return
    item.timer = defer(() => { item.timer = null; void check(item) })
    item.timer?.unref?.()
  }

  async function check(item) {
    try {
      const enabled = (await preferences()).candidateAutoGenerate === true
      const state = await read(item.sessionId)
      if (!current(item)) return
      const chat = state?.chat
      if (!enabled || !chat || !['story', 'script'].includes(chat.mode || 'story') ||
          identity(chat) !== item.identity || state.messageId !== item.messageId) {
        cancel(item.sessionId)
        return
      }
      const existing = Object.values(chat.taskMailbox?.tasks || {}).some(task =>
        task?.kind === 'candidate' && task.input?.messageId === item.messageId)
      if (existing || chat.candidates?.messageId === item.messageId) {
        cancel(item.sessionId)
        return
      }
      const background = activity(chat)
      const settlement = background.role === 'settlement' && ['pending', 'running'].includes(background.phase)
      const compacting = chat.contextCompaction?.operation?.status === 'running'
      // Settlement shares the persistent participant and revision with candidates. Keep its
      // exclusion until those lifecycles are separated; the one-shot director is independent.
      if (background.busy || settlement || compacting || chat.regenInProgress) {
        later(item)
        return
      }
      // Consume before awaiting: failures and duplicate events never create an auto-retry loop.
      cancel(item.sessionId)
      await submit({ sessionId: item.sessionId, messageId: item.messageId,
        kind: 'candidate', requestId: item.requestId, guidance: '' })
    } catch (error) {
      if (current(item)) cancel(item.sessionId)
      report('dsh-tavern: 自动候选调度失败', error)
    }
  }

  async function completed({ sessionId, messageId, turn, reason }) {
    if (disposed || !messageId || !['completed', 'max-tokens'].includes(reason)) return
    const key = JSON.stringify([sessionId, messageId])
    if (seen.has(key)) return
    seen.add(key)
    cancel(sessionId)
    const item = { sessionId, messageId, requestId: 'auto-choices-' + createHash('sha256').update(key).digest('hex') }
    pending.set(sessionId, item)
    try {
      // Eligibility is captured only at the live end event, never on chat open/recovery.
      const enabled = (await preferences()).candidateAutoGenerate === true
      const state = await read(sessionId)
      if (!current(item)) return
      const chat = state?.chat
      const reply = latestReply(chat)
      if (!enabled || !chat || reply?.greeting ||
          !['story', 'script'].includes(chat.mode || 'story') || Number(reply?.turn) !== Number(turn) ||
          !String(reply?.text || '').trim() || state.messageId !== messageId) {
        cancel(sessionId)
        return
      }
      item.identity = identity(chat)
      await check(item)
    } catch (error) {
      if (current(item)) cancel(sessionId)
      report('dsh-tavern: 自动候选调度失败', error)
    }
  }

  return Object.freeze({ completed, cancel, cancelAll, dispose() { disposed = true; cancelAll() } })
}
