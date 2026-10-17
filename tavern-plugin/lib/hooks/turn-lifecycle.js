import { assistantResultForTurn } from '../domain/session-turn-result.js'
import { inputEventForTurn } from '../domain/session-turn-input.js'
import { roundAnchor } from '../domain/round-anchor.js'
import { inputAttachments } from '../domain/player-input-content.js'
import { prependSystemInstruction } from '../domain/system-append.js'
import { sessionStablePrefixSections, withCurrentWorldbook } from '../domain/session-stable-prefix.js'
import { synchronizeBodyEdits } from '../domain/body-editor.js'
import { synchronizeTemplateHistory } from '../domain/template-history.js'

export function registerTurnLifecycleHooks({
  reconcileWhenIdle,
  backgroundAgentRunner,
  forkAutoChoices,
  hookChatForSession,
  clearRuntimePresetRequestState,
  contentText,
  ctx,
  ensureNativeSystemPrefix,
  foregroundHandoff,
  foregroundStrategies,
  fullTemplateRuntime,
  nativeWorldBookTemplateContext,
  persistClearedBodyEdits,
  pluginPromptSections,
  publishResourceWorkspace,
  readChatCard,
  replaceAssistantReply,
  requestIdForTurn,
  runtimePrompt,
  sessionStore,
  turnOrchestrator,
  userMessageForTurn,
}) {
  ctx.on('agent/turn-stopping', async function (payload) {
    const session = payload.agent && payload.agent.session
    if (session === undefined) return
    const sessionId = session.id
    clearRuntimePresetRequestState(payload.agent)
    if (backgroundAgentRunner.owns(sessionId)) return
    fullTemplateRuntime.cancel(sessionId)
    const userMessage = userMessageForTurn(session, payload.turn)
    const userText = contentText(userMessage)
    const userContent = userMessage?.content || []
    if (userText === '' && !inputAttachments(userContent).length) return
    const requestId = requestIdForTurn(session, payload.turn)
    const assistant = assistantResultForTurn(session, payload.turn)
    if (assistant === null || assistant.text === '') {
      const reasoningOnly = assistant !== null && assistant.reasoningOnly === true
      const message = reasoningOnly
        ? '模型本轮只返回了思考过程，没有返回正文；请重新生成本轮正文。'
        : '模型本轮没有返回正文；请重新生成本轮正文。'
      await turnOrchestrator.recordFailure({
        sessionId,
        turn: payload.turn,
        requestId,
        code: reasoningOnly ? 'reasoning-only' : 'empty-response',
        message
      })
      throw new Error(message)
    }
    const saved = await foregroundHandoff.finalize({
      sessionId,
      turn: payload.turn,
      requestId,
      userText,
      userContent,
      assistantText: assistant === null ? '' : assistant.text,
      nativeAnchor: roundAnchor(payload.turn, inputEventForTurn(session, payload.turn), assistant.event)
    })
    if (saved.reply) replaceAssistantReply(session, assistant, saved.reply.sessionText)
  })

  ctx.on('agent/error', function (payload) {
    clearRuntimePresetRequestState(payload.agent)
  })

  ctx.on('session/event', function (session, event) {
    // private fork: automatic candidates follow the native turn lifecycle.
    if (event?.type === 'turn/start' && !backgroundAgentRunner.owns(session.id)) forkAutoChoices?.cancel(session.id)
    if (!event || event.type !== 'turn/end') return
    foregroundStrategies.endTurn(session.id)
    if (backgroundAgentRunner.owns(session.id)) return
    const reason = event.data && event.data.reason ? event.data.reason.kind : ''
    foregroundHandoff.end({ sessionId: session.id, turn: event.data && event.data.turn, reason })
    const reply = assistantResultForTurn(session, event.data && event.data.turn)
    void forkAutoChoices?.completed({ sessionId: session.id, turn: event.data && event.data.turn, messageId: String(reply?.event?.data?.message?.id || ''), reason })
    // A turn whose record went missing (#196) is adopted before the player's next
    // message, once the agent has gone idle; reconcile never blocks this hook.
    setTimeout(() => { void reconcileWhenIdle?.(session.id) }, 0)
  })

  ctx.on('system-prompt/assemble', async function (_assembly, context, next) {
    const assembly = await next()
    const agent = context && context.agent
    if (agent === undefined || agent.session === undefined) return assembly
    if (backgroundAgentRunner.owns(agent.session.id)) return assembly
    const chat = await hookChatForSession(agent.session.id)
    if (chat) await synchronizeTemplateHistory(agent.session, chat, session => sessionStore.flush(session))
    if (chat) await synchronizeBodyEdits(agent.session, chat, session => sessionStore.flush(session), persistClearedBodyEdits)
    if (chat && chat.requestMode !== 'sillytavern' && ['story', 'script', 'card'].includes(await turnOrchestrator.modeFor(agent.session.id))) {
      await ensureNativeSystemPrefix(agent.session, chat)
    }
    let workspaceProjection = null
    try { workspaceProjection = await publishResourceWorkspace(agent.session.id, chat) }
    catch { console.error('dsh-tavern: 资源工作区投影刷新失败，继续使用现有资源文件') }
    const assembled = await foregroundStrategies.assembleSystemPrompt(assembly, {
      sessionId: agent.session.id,
      chat,
      cwd: agent.session.header && agent.session.header.cwd,
      workspaceProjection,
      fixedSystemSections: chat && ['story', 'script'].includes(chat.mode || 'story')
        ? withCurrentWorldbook(sessionStablePrefixSections(agent.session), (await nativeWorldBookTemplateContext(chat, await readChatCard(chat), {foreground:true})).prefixContext ?? '')
        : sessionStablePrefixSections(agent.session)
    })
    // Third-party plugin sections join the play prompt only, after Tavern's own.
    if (pluginPromptSections && chat && chat.requestMode !== 'sillytavern' && ['story', 'script'].includes(await turnOrchestrator.modeFor(agent.session.id))) {
      const extra = await pluginPromptSections({ gameId: agent.session.id })
      if (extra.length) assembled.sections = [...(assembled.sections || []), ...extra]
    }
    return prependSystemInstruction(assembled, chat ? runtimePrompt('system-append') : '')
  })
}
