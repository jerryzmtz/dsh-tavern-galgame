import { promptSection } from './domain/prompt-section.js'
import { createBackgroundProgress } from './domain/background-progress.js'
import { worldbookSnapshot } from './domain/worldbook-snapshot.js'
import { CARD_SYSTEM_PROMPT_SECTION, cardSystemPromptSnapshot, cardSystemPromptSource } from './domain/card-system-prompt.js'
import { projectCandidateScriptContext } from './domain/candidate-script-context.js'
import { projectWorldbookFilterContext } from './domain/worldbook-filter-context.js'
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import { prependSystemInstruction } from './domain/system-append.js'
import { backgroundSystemPrompt, backgroundTaskPrompt, usesSharedBackgroundContext, directorTaskTools, assertDirectorToolSurface } from './domain/background-task-prompt.js'
import { rewindBackgroundSurface } from './domain/background-surface.js'
import { sessionEvents } from './domain/session-events.js'
// private fork: expose provider-reported director usage before the temporary agent is disposed.
import { lastDirectorProviderUsage } from './domain/stage-director-tokens.js'
import { randomUUID } from 'node:crypto'
import { readSceneImageSystemInstruction } from './scene-image-prompts.js'
import { CHARACTER_DESIGN_READ_TOOL } from './domain/character-design-document.js'
import {
  CHARACTER_DESIGN_FINISH_TOOL,
  createCharacterDesignStage
} from './domain/character-design-stage.js'
import { imageToolCall } from './domain/scene-plan-draft.js'
import { runtimePresetPhaseMessages } from './domain/runtime-preset-lifecycle.js'
import { ensureSessionStablePrefix, readSessionStablePrefix, sessionStablePrefixSections, withCurrentWorldbook } from './domain/session-stable-prefix.js'

// Prompt prose source (private fork). Keys are stable; interpolation arguments are data.
export const PROMPT_PROSE = Object.freeze({
  p001: "You are a phone chat agent kept apart from the story. Reply to the current phone message only as the given contact, without advancing the story, changing state or treating the chat as an in-person scene.",
  p002: "You are a Tavern background agent, apart from foreground story generation, doing a one-off plugin task. Output only what the task asks; don't continue the story or change game state yourself. Consult the worldbook and history as needed.",
  p003: "You are a Tavern background agent, apart from foreground story generation. In one story branch you handle state settlement and choice generation in turn; character design runs only when the user explicitly starts it. Follow the task protocol appended to each turn exactly, keeping each task's output format to that task. The latest authoritative state overrides older dynamic state in the session.",
  p004: "The card system prompt below only governs choice text; settlement, filtering, character design and other background tasks follow their own protocols.\n",
  p005: "## Plugin settlement tasks",
  p006: "Plugin tools available this turn: ",
  p007: ". This list is current; earlier turns where they were off or failed no longer apply. Call them as needed before submitting this turn's settlement; a plugin tool failure doesn't affect it.",
  p008: "Plugin tools unavailable this turn (the player turned off their plugins for this game): ",
  p009: ". Don't call them this turn.",
  p010: "## Plugin choice requirements"
})


function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function finalMessage(events, startAt) {
  for (let index = (events || []).length - 1; index >= Math.max(0, Number(startAt) || 0); index--) {
    const event = events[index]
    if (event === null || typeof event !== 'object' || event.type !== 'assistant/message') continue
    const content = event.data && event.data.message && Array.isArray(event.data.message.content) ? event.data.message.content : []
    const text = content.filter(function (block) { return block && block.type === 'text' }).map(function (block) { return str(block.text) }).join('').trim()
    if (text !== '') return { text, event, index: Number.isSafeInteger(event.seq) ? event.seq : index }
  }
  return null
}


function terminalError(events, startAt) {
  for (let index = (events || []).length - 1; index >= Math.max(0, Number(startAt) || 0); index--) {
    const event = events[index]
    if (event === null || typeof event !== 'object' || event.type !== 'turn/end') continue
    const reason = event.data && event.data.reason
    if (reason?.kind === 'aborted' || reason?.kind === 'interrupted') return new Error('后台 Agent 请求已中断，未完成结果不予提交')
    if (reason !== null && typeof reason === 'object' && reason.kind === 'max-tokens') {
      return new Error('后台 Agent 输出达到模型 token 上限，正式结果尚未生成')
    }
    if (reason === null || typeof reason !== 'object' || reason.kind !== 'error') continue
    const detail = reason.error
    const message = str(detail && detail.message || detail).trim()
    if (message !== '') return new Error(message)
  }
  return null
}

export function maximumBackgroundTokens(selection) {
  const provider = str(selection && selection.provider).trim().toLowerCase()
  const model = str(selection && selection.model).trim().toLowerCase()
  if (provider === 'deepseek-official' && (model === 'deepseek-v4-flash' || model === 'deepseek-v4-pro')) return 384000
  return undefined
}

export function traceError(error, traceSessionId, task) {
  const fallback = task === 'settlement' ? '后台状态结算失败' : task === 'phone' ? '手机私聊回复失败' : task === 'plugin' ? '插件后台任务失败' : '后台候选生成失败'
  const wrapped = new Error(str(error && error.message || error) || fallback, { cause: error })
  wrapped.traceSessionId = traceSessionId
  return wrapped
}

// A task operates on a leased DSH Agent; it does not create or retain sessions.
export function createBackgroundAgentTask(options) {
  const setupAgent = typeof options.setupAgent === 'function' ? options.setupAgent : null
  const sharedBackgroundTools = Array.isArray(options.sharedTools) ? options.sharedTools.filter(function (item) {
    return item && item.tool && typeof item.tool.name === 'string' && typeof item.execute === 'function'
  }) : []
  const sharedByName = new Map(sharedBackgroundTools.map(function (item) { return [item.tool.name, item] }))
  const stableBackgroundTools = []
  const stableNames = new Set()
  const configuredBackgroundTools = Array.isArray(options.backgroundTools) ? options.backgroundTools : []
  const hasCharacterDesignTools = configuredBackgroundTools.some(function (tool) {
    return tool && (tool.name === 'character_design_read' || tool.name === 'character_design_save')
  })
  const backgroundToolCatalog = configuredBackgroundTools
    .concat(hasCharacterDesignTools ? [CHARACTER_DESIGN_FINISH_TOOL] : [])
    .concat(sharedBackgroundTools.map(function (item) { return item.tool }))
  for (const tool of backgroundToolCatalog) {
    if (!tool || typeof tool.name !== 'string' || stableNames.has(tool.name)) continue
    stableNames.add(tool.name)
    stableBackgroundTools.push(tool)
  }
  // Seam to the plugin layer (plugin-api.js): tools and notes plugins add to settlement.
  const pluginSettlement = () => typeof options.pluginSettlement === 'function' ? options.pluginSettlement() : null
  function pluginTools() {
    const tools = pluginSettlement()?.tools() || []
    return tools.filter(tool => tool && !stableNames.has(tool.name) && !sharedByName.has(tool.name))
  }
  function completedBoundary(events) {
    for (let index = (events || []).length - 1; index >= 0; index--) {
      const event = events[index]
      if (event && event.type === 'turn/end' && Number.isSafeInteger(event.seq)) return event.seq
    }
    return null
  }

  function setupFor(state, descriptor, appendDescriptor) {
    const backgroundPersona = promptSection('background_role', state.input.task === 'phone'
      ? PROMPT_PROSE.p001
      : state.input.task === 'plugin'
      ? PROMPT_PROSE.p002
      : PROMPT_PROSE.p003)
    let descriptorAppended = !appendDescriptor
    return async function (childCtx) {
      // Legacy directors retain their exact preview; shared-context directors keep scoped native tools.
      const director = state.input.task === 'stage-director'
      // The preset mount is still required (DSH agent wiring); tools and prompt are narrowed below.
      if (setupAgent !== null) await setupAgent(childCtx)
      if (director) childCtx.tools.presentAs('native')
      state.ctx = childCtx
      state.modelSelection = { current: { ...state.input.selection }, assembled: undefined }
      installModelSelection(childCtx, state.modelSelection)
      // private fork: DSH frames wrap native chunks; argumentsDelta is a fragment,
      // not a snapshot. Attempt + block index isolates retries and parallel calls.
      const directionCalls = new Map()
      childCtx.on('agent/assistant-stream', ({frame}) => {
        state.progress?.frame(frame)
        if (!director || typeof state.input.onToolCallDelta !== 'function') return
        if (frame.type === 'start') { directionCalls.clear(); return }
        const chunk = frame.type === 'chunk' ? frame.chunk : null
        if (chunk?.type !== 'tool-call-delta') return
        const call = directionCalls.get(chunk.index) || { name: '', argumentsText: '', streamId: frame.attemptId + ':' + chunk.index }
        if (chunk.name) call.name = chunk.name
        call.argumentsText += chunk.argumentsDelta || ''
        directionCalls.set(chunk.index, call)
        state.input.onToolCallDelta({ ...call })
      })
      childCtx.on('agent/pre-step', async function ({ agent, turn, step }, next) {
        const decision = await next()
        if (!descriptorAppended && decision.kind === 'enter') {
          descriptorAppended = true
          agent.session.append('subagent/descriptor', descriptor)
        }
        if (decision.kind !== 'enter') return decision
        if (director && !usesSharedBackgroundContext(state.input)) return decision
        const input = state.input || {}
        const snapshot = typeof options.resolveRuntimePresetSnapshot === 'function'
          ? await options.resolveRuntimePresetSnapshot({ sessionId: input.sessionId, operation: input.task || 'background' })
          : null
        const messageOptions = { scope: 'background', turn, step }
        if (typeof options.stageRuntimePresetSnapshot === 'function') {
          options.stageRuntimePresetSnapshot({ sessionId: agent.session.id, turn, step, snapshot, scope: 'background' })
        }
        const middleMessages = Number(step) === 1 ? runtimePresetPhaseMessages(snapshot, 'middle', messageOptions) : []
        return middleMessages.length === 0 ? decision : Object.assign({}, decision, {
          messages: middleMessages.concat(decision.messages)
        })
      })
      childCtx.systemPrompt.section({
        name: 'deployment:persona',
        order: 0,
        complete: true,
        // DSH restores complete sections after the assembly waterfall, so the
        // additional instruction must be part of this authoritative text.
        text: () => {
          if (director && !usesSharedBackgroundContext(state.input)) return str(state.input.system)
          // Settlement and candidates share a Session: scope the fixed writing
          // instruction without changing its system prefix when the task switches.
          const fixed = sessionStablePrefixSections(state.session).flatMap(section => {
            if (section.name !== CARD_SYSTEM_PROMPT_SECTION) return [section]
            if (['image', 'phone'].includes(state.input.task)) return []
            return [{ ...section, text: promptSection('card_system_scope', PROMPT_PROSE.p004) + section.text }]
          })
          const sections = state.currentWorldbook === undefined ? fixed : withCurrentWorldbook(fixed, state.currentWorldbook)
          return backgroundSystemPrompt({ input: state.input, sections,
            persona: state.input.task === 'image' ? (options.imageSystemPrompt ? options.imageSystemPrompt() : readSceneImageSystemInstruction()) : backgroundPersona,
            systemAppend: options.systemAppend?.() })
        }
      })
      childCtx.systemPrompt.suppressRuntimeContext()
      if (state.input.task === 'image') {
        childCtx.tools.register({
          ...CHARACTER_DESIGN_READ_TOOL,
          output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
          async execute(args) {
            if (!state.imageReadTask) return JSON.stringify({ ok: false, error: '当前没有正在执行的绘图任务。' })
            return state.imageReadTask(args)
          }
        })
      }
      childCtx.tools.restrict({ allow: director || state.input.task === 'phone' ? [] : state.input.task === 'image' ? ['skill', 'tavern_read_skill_reference'] : ['skill', 'tavern_read_skill_reference', 'web_search'] })
      childCtx.on('system-prompt/assemble', async function (_assembly, _context, next) {
        const assembly = await next()
        if (director && !usesSharedBackgroundContext(state.input)) return assembly
        prependSystemInstruction(assembly, options.systemAppend?.())
        if (state.input.task === 'phone') {
          assembly.sections = (assembly.sections || []).filter(function (section) {
            return !section || typeof section.name !== 'string' || !section.name.startsWith('tool:')
          })
          assembly.tools = []
          return assembly
        }
        if (state.input.task !== 'image' && state.input.webSearchEnabled === true) return assembly
        assembly.sections = (assembly.sections || []).filter(function (section) { return section && section.name !== 'tool:web_search' })
        assembly.tools = (assembly.tools || []).filter(function (tool) { return tool && tool.name !== 'web_search' })
        return assembly
      })
      state.refreshConfiguredTools = function () {
        if (state.input.task === 'image' || director || state.stableToolDisposers) return
        // Every task sharing this Session sees one fixed tool list: tool definitions sit in the
        // cached request prefix. What a task may call is enforced when the tool executes.
        // Plugin tools join the list when the Session is set up; a plugin loaded later
        // reaches Sessions set up after it.
        state.stableToolDisposers = stableBackgroundTools.concat(pluginTools()).map(function (tool) {
          return childCtx.tools.register({
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
            output: {
              schema: { type: 'string' },
              render: function (_args, value) { return [{ type: 'text', text: value }] }
            },
            async execute(args, execution) {
              const active = state.activeToolTask
              if (active === null || active === undefined) {
                return JSON.stringify({ ok: false, retryable: true, error: '当前没有正在执行的后台任务，请等待下一条任务指令。' })
              }
              return active.execute(tool, args, execution)
            }
          })
        }).filter(function (dispose) { return typeof dispose === 'function' })
      }
      state.refreshConfiguredTools()
      // private fork: agent/request only carries model config; tools exist at the LLM boundary.
      if (director) childCtx.on('llm/stream', function (request, next) {
        if (request.sessionId === state.session?.id) assertDirectorToolSurface(state.input, request.tools, state.directorTools)
        return next()
      }, { global: true })
      childCtx.on('agent/request', async function (_payload, next) {
        const input = state.input || {}
        const inherited = await next()
        const { maxTokens: _oldLimit, ...request } = inherited
        const limit = Number.isSafeInteger(input.maxTokens) && input.maxTokens > 0 ? input.maxTokens : maximumBackgroundTokens(input.selection)
        if (limit !== undefined) request.maxTokens = limit
        const temperature = state.characterDesignStage
          ? state.characterDesignStage.temperature(input.temperature)
          : input.temperature
        if (typeof temperature !== 'number' || input.selection && input.selection.provider === 'openai-codex') return request
        return Object.assign({}, request, { temperature })
      })
    }
  }

  function installTaskTools(state, input, session) {
    const eventStart = sessionEvents(session).length
    let tools = (input.task === 'stage-director' ? directorTaskTools(input, sharedBackgroundTools) : (Array.isArray(input.tools) ? input.tools : []))
      .filter(tool => input.task !== 'image' || tool.name !== CHARACTER_DESIGN_READ_TOOL.name)
    if (input.task === 'stage-director') state.directorTools = tools
    const hasCharacterDesignTools = input.task !== 'image' && tools.some(function (tool) {
      return tool && (tool.name === 'character_design_read' || tool.name === 'character_design_save')
    })
    if (hasCharacterDesignTools && !tools.some(function (tool) { return tool && tool.name === CHARACTER_DESIGN_FINISH_TOOL.name })) {
      tools = tools.concat([CHARACTER_DESIGN_FINISH_TOOL])
    }
    const characterDesignStage = hasCharacterDesignTools
      ? createCharacterDesignStage({ temperature: input.characterDesignTemperature })
      : null
    state.characterDesignStage = characterDesignStage
    if (input.task === 'image') state.imageReadTask = async args => {
      if (input.stopToolsWhen?.()) return JSON.stringify({ ok: false, error: '画面方案已提交，请结束本轮。' })
      return str(await input.onToolCall({ name: CHARACTER_DESIGN_READ_TOOL.name, arguments: args }))
    }
    // private fork: director turns end by transaction/model choice, not a call quota.
    const maxToolCalls = input.task === 'stage-director' ? Infinity : Number.isInteger(input.maxToolCalls) && input.maxToolCalls > 0 ? input.maxToolCalls : 8
    let toolCallCount = 0
    let removed = false
    const allowed = new Map(tools.map(function (tool) { return [tool.name, tool] }))
    // private fork: reply-specific director schemas cannot use the stable background catalogue.
    if (stableBackgroundTools.length > 0 && input.task !== 'image' && input.task !== 'stage-director') {
      state.activeToolTask = {
        async execute(tool, args, execution) {
          const registeredShared = sharedByName.get(tool.name)
          const shared = (input.task !== 'worldbook-filter' || registeredShared?.allowDuringWorldbookFilter === true) &&
            (input.task !== 'character-design' || registeredShared?.allowDuringCharacterDesign === true) ? registeredShared : undefined
          const current = allowed.get(tool.name) || (shared && shared.tool)
          if (current === undefined && input.task === 'settlement' && state.pluginCall && pluginSettlement()?.has(tool.name)) {
            if (typeof input.stopToolsWhen === 'function' && input.stopToolsWhen()) {
              return JSON.stringify({ ok: false, retryable: false, message: '当前任务已经提交完成，请结束本轮。插件工具请在提交结算之前调用。' })
            }
            return await state.pluginCall(tool.name, args)
          }
          if (current === undefined) {
            return JSON.stringify({
              ok: false,
              retryable: true,
              error: '当前任务不允许调用 ' + tool.name + '；请改用：' + (Array.from(allowed.keys()).join('、') || '无工具')
            })
          }
          if (typeof input.stopToolsWhen === 'function' && input.stopToolsWhen()) {
            return JSON.stringify({ ok: false, retryable: false, message: '当前任务已经提交完成，请结束本轮。' })
          }
          if (current.countsTowardLimit !== false) {
            toolCallCount++
            if (toolCallCount > maxToolCalls) {
              return JSON.stringify({ ok: false, retryable: false, message: input.toolLimitMessage || '当前任务的工具调用次数已达上限，请结束本轮。' })
            }
          }
          const invoke = async function () {
            input.signal?.throwIfAborted()
            return shared
              ? str(await shared.execute({ input, args, execution }))
              : str(await input.onToolCall({ name: tool.name, arguments: args }))
          }
          const result = characterDesignStage
            ? str(await characterDesignStage.execute(tool.name, invoke))
            : await invoke()
          if (typeof input.stopToolsWhen === 'function' && input.stopToolsWhen()) execution?.concludeTurn?.()
          return result
        }
      }
      // A plugin task runs in its own one-off Session: its own tools join the fixed list there.
      const active = state.activeToolTask
      const extraDisposers = input.task === 'plugin' ? tools.filter(tool => !stableNames.has(tool.name)).map(tool => state.ctx.tools.register({
        name: tool.name, description: tool.description, parameters: tool.parameters,
        output: { schema: { type: 'string' }, render: function (_args, value) { return [{ type: 'text', text: value }] } },
        execute: (args, execution) => active.execute(tool, args, execution)
      })).filter(dispose => typeof dispose === 'function') : []
      return async function () {
        for (const dispose of extraDisposers.reverse()) await dispose()
        if (state.activeToolTask !== null && state.activeToolTask !== undefined) state.activeToolTask = null
        if (state.characterDesignStage === characterDesignStage) state.characterDesignStage = null
      }
    }
    async function removeTools() {
      if (removed) return
      removed = true
      if (input.task === 'image') state.imageReadTask = null
      for (let index = disposers.length - 1; index >= 0; index--) await disposers[index]()
    }
    const disposers = tools.map(function (tool) {
      return state.ctx.tools.register({
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
          output: {
            schema: { type: 'string' },
            render: function (_args, value) { return [{ type: 'text', text: value }] }
          },
          async execute(args, execution) {
            // private fork: ignore parallel/late submissions after terminal acceptance.
            if (input.task === 'stage-director' && input.stopToolsWhen?.()) {
              execution?.concludeTurn?.()
              return str(await input.onToolCall({name:tool.name,arguments:args}))
            }
            if (tool.countsTowardLimit !== false) {
              toolCallCount++
              if (toolCallCount > maxToolCalls) {
                return JSON.stringify({ message: input.toolLimitMessage || '已达到剧本查询上限，请停止查询，基于已有材料开始推理并输出最终候选。' })
              }
            }
            const call = input.task === 'image' ? imageToolCall(tool.name, args, execution, sessionEvents(session), eventStart) : { name: tool.name, arguments: args }
            const shared = input.task === 'stage-director' && usesSharedBackgroundContext(input) ? sharedByName.get(tool.name) : undefined
            const invoke = async function () {
              input.signal?.throwIfAborted()
              return shared ? str(await shared.execute({ input, args, execution })) : str(await input.onToolCall(call))
            }
            const result = characterDesignStage
              ? str(await characterDesignStage.execute(tool.name, invoke))
              : await invoke()
            if (typeof input.stopToolsWhen === 'function') {
              const complete = input.stopToolsWhen()
              if (complete) execution?.concludeTurn?.()
              if (complete || toolCallCount >= maxToolCalls) await removeTools()
            }
            return result
          }
        })
    }).filter(function (dispose) { return typeof dispose === 'function' })
    return async function () {
      await removeTools()
      if (state.characterDesignStage === characterDesignStage) state.characterDesignStage = null
    }
  }

  // Hide the latest task (its request and everything after) from the model's
  // surface in the same Session; raw events stay for the trace. Fixed seeds remain.
  async function undoLastTask(session, traceSessionId) {
    const events = new Map(sessionEvents(session).map(event => [event.seq, event]))
    const nodes = Array.isArray(session?.surface?.nodes) ? session.surface.nodes : []
    const start = nodes.findLast(seq => {
      const event = events.get(seq)
      return event?.type === 'user/message' && !String(event.data?.id || '').startsWith('tavern-session-prefix:')
    })
    if (start === undefined) return { traceSessionId, undone: false }
    try { rewindBackgroundSurface(session, start - 1) }
    catch (error) { throw new Error('撤销失败，对话未改变。原因：' + str(error?.message || error), { cause: error }) }
    if (typeof options.flushSession === 'function') await options.flushSession(session)
    return { traceSessionId, undone: true }
  }

  async function execute({ agent, state, traceSessionId, persistent }, input) {
    state.session = agent.session
    if (input.undoLastTask === true) return undoLastTask(agent.session, traceSessionId)
    const runtimeInput = state.input
    try { rewindBackgroundSurface(agent.session, input.rewindTo) }
    catch (error) {
      const failure = new Error('后台历史回退失败，本次任务已停止，未基于旧上下文继续执行。原因：' + str(error?.message || error), { cause: error })
      failure.code = 'BACKGROUND_REWIND_FAILED'
      throw failure
    }
    const progress = createBackgroundProgress({idleMs:options.modelIdleTimeoutMs, onCancel:()=>{state.abandoned=true;agent.cancel?.({kind:'user'})}})
    state.progress=progress
    runtimeInput.signal=input.signal ? AbortSignal.any([input.signal,progress.signal]) : progress.signal
    const removeTaskTools = installTaskTools(state, runtimeInput, agent.session)
    const plugins = input.task === 'settlement' ? pluginSettlement() : null
    const pluginContext = { gameId: str(input.sessionId), turn: Math.max(0, Number(input.turn) || 0) }
    state.pluginCall = plugins ? plugins.calls(pluginContext) : null
    const cancel = () => progress.cancel()
    input.signal?.addEventListener('abort', cancel, { once: true })

    try {
      input.signal?.throwIfAborted()
      if (persistent && typeof input.onPersistentSessionReady === 'function') {
        // Persist the native session before publishing its identity, even if the first task fails.
        if (typeof options.flushSession === 'function') await options.flushSession(agent.session)
        await input.onPersistentSessionReady(traceSessionId)
      }
      // private fork: keep native tool-call/result history untouched between correction steps.
      const director = input.task === 'stage-director'
      const sharedContext = usesSharedBackgroundContext(input)
      if (sharedContext) {
        const existing = readSessionStablePrefix(agent.session)
        const revision = typeof options.resolveStablePrefixRevision === 'function' ? await options.resolveStablePrefixRevision(input) : 0
        const background = existing && revision <= existing.revision ? existing.text : typeof options.resolveStablePrefix === 'function'
          ? await options.resolveStablePrefix(input) : input.backgroundContext
        const prefix = await ensureSessionStablePrefix(agent.session, background, options.stablePrefixStorage, revision)
        if (prefix && prefix.event !== existing?.event && typeof options.flushSession === 'function') await options.flushSession(agent.session)
      }
      // The filter reuses the last projection (or makes the first one after a restart) so the
      // shared system prefix stays byte-identical and the filter reads settlement's cache.
      const projectsWorldbook = sharedContext && (input.task !== 'worldbook-filter' || state.currentWorldbook === undefined)
      const worldbook = projectsWorldbook && typeof options.resolveCurrentWorldbook === 'function'
        ? await options.resolveCurrentWorldbook(input) : undefined
      if (projectsWorldbook) state.currentWorldbook = worldbook && typeof worldbook === 'object' ? worldbook.prefixContext : worldbook
      const turnWorldbookSource = input.task === 'worldbook-filter' ? undefined : worldbook
      const turnWorldbook = turnWorldbookSource && typeof turnWorldbookSource === 'object' ? str(turnWorldbookSource.foregroundContext).trim() : ''
      const eventStart = sessionEvents(agent.session).length
      const filterContext = projectWorldbookFilterContext(agent.session, input)
      const scriptContext = projectCandidateScriptContext(agent.session, input)
      const foregroundReads = sharedContext && typeof options.resolveForegroundWorldbookReads === 'function'
        ? await options.resolveForegroundWorldbookReads(input) : ''
      const snapshot = turnWorldbookSource && typeof turnWorldbookSource === 'object'
        ? worldbookSnapshot(agent.session, [{ ref: 'background:worldbook', text: turnWorldbook }]) : null
      const systemUpdate = input.task === 'candidate' && typeof input.systemPromptText === 'string'
        ? cardSystemPromptSnapshot(agent.session, input.systemPromptText) : null
      const pluginNotes = plugins ? await plugins.sections(pluginContext) : []
      // Tool definitions stay fixed for the cache; which ones may be called is stated each
      // turn, so a plugin turned off and on again is usable without stale refusals.
      const pluginToolNames = plugins ? await plugins.toolNames(pluginContext) : { available: [], unavailable: [] }
      const candidateNotes = input.task === 'candidate' && typeof options.pluginCandidate === 'function'
        ? await options.pluginCandidate()?.sections(pluginContext).catch(() => []) || [] : []
      const pluginText = promptSection('plugin_task', pluginNotes.length || pluginToolNames.available.length || pluginToolNames.unavailable.length ? [PROMPT_PROSE.p005,
        ...(pluginToolNames.available.length ? [PROMPT_PROSE.p006 + pluginToolNames.available.join('、') + PROMPT_PROSE.p007] : []),
        ...(pluginToolNames.unavailable.length ? [PROMPT_PROSE.p008 + pluginToolNames.unavailable.join('、') + PROMPT_PROSE.p009] : []),
        ...pluginNotes.map(note => note.text)].join('\n\n')
        : candidateNotes.length ? [PROMPT_PROSE.p010, ...candidateNotes.map(note => note.text)].join('\n\n') : '')
      const taskText = backgroundTaskPrompt({ input, messages: filterContext?.messages || input.messages,
        turnContext: scriptContext?.turnContext ?? input.turnContext, foregroundReads, worldbook: snapshot, systemUpdate, pluginText })
      if (!sharedContext) {
        for (const message of input.messages || []) agent.followup({ ...message, id: randomUUID(), source: message.source || { kind: 'plugin', plugin: 'dsh-tavern' } })
      } else agent.followup({
        id: randomUUID(),
        role: 'user',
        content: [{ type: 'text', text: taskText }],
        source: { kind: 'plugin', plugin: 'dsh-tavern', ...(systemUpdate ? { trace: cardSystemPromptSource(systemUpdate) } : {}), ...(snapshot ? { worldbookSnapshot: snapshot } : {}), ...(scriptContext?.body ? {
          candidateScriptWindow: { version: 1, start: taskText.indexOf(scriptContext.body), length: scriptContext.body.length, digest: scriptContext.digest }
        } : {}), ...(filterContext ? {
          worldbookFilterPayload: { version: 1, start: taskText.indexOf(filterContext.payloadText), length: filterContext.payloadText.length }
        } : {}) }
      })
      await progress.wait(agent.whenIdle())
      input.signal?.throwIfAborted()
      // Transport failure must not become success after an earlier tool submission,
      // including settlement and candidate tasks, not only the director.
      if (director) {
        const usage = lastDirectorProviderUsage(sessionEvents(agent.session), eventStart)
        if (usage) input.onProviderUsage?.(usage)
      }
      const transportFailure = terminalError(sessionEvents(agent.session), eventStart)
      if (transportFailure !== null) throw transportFailure
      const rawResult = finalMessage(sessionEvents(agent.session), eventStart)
      if (rawResult === null) {
        if (typeof runtimeInput.acceptWithoutText !== 'function' || runtimeInput.acceptWithoutText() !== true) {
          if (director) throw new Error('导演模型没有调用工具，请换一个支持工具调用的模型')
          throw new Error(input.task === 'settlement' ? '后台 Agent 没有返回结算文本' : input.task === 'plugin' ? '后台 Agent 没有返回任务结果' : '后台 Agent 没有返回候选文本')
        }
      }
      const text = rawResult === null ? '' : rawResult.text.trim()
      if (persistent && input.task === 'image' && typeof options.flushSession === 'function') {
        await options.flushSession(agent.session)
      }
      return { text, traceSessionId, persistent, traceBoundary: completedBoundary(sessionEvents(agent.session)) }
    } catch (error) {
      throw traceError(error, traceSessionId, input.task)
    } finally {
      progress.dispose()
      state.progress=null
      input.signal?.removeEventListener('abort', cancel)
      state.pluginCall = null
      await removeTaskTools()
    }
  }

  return Object.freeze({ setup: setupFor, execute })
}
