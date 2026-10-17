import { normalizeProviderOverflow } from '../domain/provider-overflow.js'
import { synchronizeBodyEdits } from '../domain/body-editor.js'
import { randomUUID } from 'node:crypto'
import { lastRoundVariableChanges } from '../domain/foreground-variable-changes.js'
import { synchronizeTemplateHistory } from '../domain/template-history.js'

// Appended once at the start of a reply, so it joins the history after the cached prefix.
export function appendVariableChanges({ chat, payload, decision }) {
  if (!chat || decision.kind !== 'enter' || Number(payload.step) !== 1 || chat.backgroundTasks?.variableFeedback === false) return decision
  if (decision.messages.some(message => message.source?.form === 'variable-changes')) return decision
  const text = lastRoundVariableChanges(chat)
  if (!text) return decision
  return { ...decision, messages: [...decision.messages, { id: randomUUID(), role: 'user', content: [{ type: 'text', text }], source: { kind: 'plugin', plugin: 'dsh-tavern', form: 'variable-changes' } }] }
}

export function registerRequestHooks({
  backgroundAgentRunner,
  cardMemory,
  chatForSession,
  ctx,
  foregroundStrategies,
  persistClearedBodyEdits,
  requestCoordinates,
  requestIdForMessages,
  sessionStore,
  tavernRetryLimiter,
}) {
  ctx.on('agent/request', async function (payload, next) {
    const sessionId = payload.agent && payload.agent.session ? payload.agent.session.id : ''
    if (sessionId !== '') requestCoordinates.set(sessionId, { turn: payload.turn, step: payload.step })
    return await next()
  })

  ctx.on('agent/request-error', tavernRetryLimiter.handle, { prepend: true })
  // Registered last with prepend, so it runs first: the retry limiter and DSH's
  // overflow compaction both see the normalized code.
  ctx.on('agent/request-error', normalizeProviderOverflow, { prepend: true })

  ctx.on('agent/pre-step', async function (payload, next) {
    const sessionId = payload.agent && payload.agent.session ? payload.agent.session.id : ''
    // Tavern drives only game sessions; child agents (its own background
    // agents, plugin agents, DSH subagents) never get a turn frame or status.
    // parentSession alone does not mark a child: a native fork of a game also
    // carries it, but has its own Tavern chat.
    if (backgroundAgentRunner.owns(sessionId) || (payload.agent.session.header?.parentSession && !await chatForSession(sessionId))) return next()
    const decision = await next()
    if (decision.kind === 'reject') return decision
    const chat = await chatForSession(sessionId)
    if (chat) await synchronizeTemplateHistory(payload.agent.session, chat, session => sessionStore.flush(session))
    if (chat) await synchronizeBodyEdits(payload.agent.session, chat, session => sessionStore.flush(session), persistClearedBodyEdits)
    const prepared = await foregroundStrategies.prepareStep({
      sessionId,
      payload,
      decision,
      chat,
      requestId: requestIdForMessages(payload.messages)
    })
    const withChanges = appendVariableChanges({ chat, payload, decision: prepared })
    try { return await cardMemory.appendRecall({ chat, payload, decision: withChanges }) }
    catch (error) { console.warn('[Tavern card memory] recall unavailable:', error.message); return withChanges }
  })
}
