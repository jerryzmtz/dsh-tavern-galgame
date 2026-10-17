import { parseOpeningCommand } from './opening-command.js'
import { worldbookContentDigest } from './worldbook-version.js'
import { projectFullPromptTemplateState, applyFullPromptTemplateState } from './full-prompt-template-state.js'
import { projectTavernHelperScripts } from './tavern-helper-scripts.js'
import { mutateScriptPrompts } from './tavern-script-prompts.js'
import { projectTavernHelperContext, replaceTavernHelperVariables, replaceTavernHelperMessages } from './tavern-helper-context.js'
import { OFFICIAL_MVU_VERSION } from './official-mvu-assets.js'
import { randomUUID } from 'node:crypto'
import { cardOpeningChoices } from './card-openings.js'
import { inspectWorldBookDocument, updateWorldBookDocument, exportSillyTavernWorldBook } from './worldbook-resource.js'
import { projectTavernHelperWorldbook, replaceTavernHelperWorldbookOperations } from './tavern-helper-worldbook.js'
import { createHelperGenerationTasks } from './helper-generation-tasks.js'
import { helperGenerationHistory } from './helper-generation-prompts.js'

const copy = value => structuredClone(value)

/** Private pre-game state; explicit plugin-setting saves use the profile store. */
export function createOpeningPreparation({ readCard, worldBooks, generate, generateRaw, readRuntimeExtensions, extensionSettings, now = Date.now }) {
  const drafts = new Map()
  const generations = createHelperGenerationTasks()
  const lifetime = 2 * 60 * 60 * 1000
  function requireDraft(id) {
    const draft = drafts.get(id)
    if (!draft || now() - draft.touchedAt > lifetime) {
      generations.stopAll('opening:' + id)
      drafts.delete(id)
      throw new Error('开局准备已过期，请重新打开人物卡')
    }
    draft.touchedAt = now()
    return draft
  }
  function runtimeContext(draft) {
    return { ...projectTavernHelperContext(draft.chat), worldbook: draft.document ? projectTavernHelperWorldbook(inspectWorldBookDocument(draft.document)) : null,
      characterName: draft.card.name, playerName: draft.userName, character: copy(draft.card),
      globalVariables: copy(draft.globalVariables || {}), characterVariables: copy(draft.characterVariables || {}),
      extensionSettings: copy(draft.extensionSettings), regexScripts: copy(draft.regexScripts || { global: [], character: [] }) }
  }
  function present(draft) {
    return copy({ id: draft.id, cardPath: draft.cardPath, openings: draft.openings,
      openingId: draft.openingId || draft.openings[0]?.id, diagnostics: copy(draft.diagnostics || []),
      runtime: draft.runtimeEnabled ? { context: runtimeContext(draft), scripts: (draft.chat.mvu.enabled ? [{ id: '__dsh_official_mvu__', name: 'MVU', system: 'official-mvu', assetUrl: OFFICIAL_MVU_VERSION.assetUrl }] : []).concat(draft.helperScripts || []) } : null,
      worldbook: draft.document ? projectTavernHelperWorldbook(inspectWorldBookDocument(draft.document)) : null })
  }
  return {
    async create(cardPath, settings = {}) {
      for (const [id, draft] of drafts) if (now() - draft.touchedAt > lifetime) { generations.stopAll('opening:' + id); drafts.delete(id) }
      if (drafts.size >= 64) throw new Error('打开的游戏准备页过多，请稍后重试')
      const card = settings.card || await readCard(cardPath)
      if (!card) throw new Error('人物卡不存在')
      const record = await worldBooks.bound(cardPath, card, settings.sourceChat)
      const draft = { id: randomUUID(), cardPath, openings: cardOpeningChoices(card),
        document: record ? copy(record.view.raw) : null, source: record ? copy(record.source) : null, touchedAt: now() }
      draft.libraryDigest = settings.sourceChat?.worldbookLibraryDigest ?? settings.sourceChat?.openingWorldbookSnapshot?.libraryDigest
        ?? (settings.sourceChat?.openingWorldbookSnapshot ? undefined : worldbookContentDigest(record))
      draft.sourceSessionId = settings.sourceChat?.sessionId || ''
      draft.presetSnapshot = settings.sourceChat ? copy(settings.sourceChat.runtimePresetSnapshot || null) : undefined
      draft.sourceLifecycleRevision = Number(settings.sourceChat?.tavernHelperLifecycleRevision) || 0
      draft.card = copy(card)
      draft.userName = settings.userName || settings.sourceChat?.macroState?.userName || '你'
      const swipes = draft.openings.map(opening => opening.text)
      draft.chat = { id: draft.id, cardPath, mode: 'story', mvu: { enabled: settings.runtime === true }, _storageRevision: 0,
        macroState: { userName: draft.userName, local: {}, global: {} },
        variables: {}, messages: [{ role: 'assistant', text: swipes[0], sourceText: swipes[0], greeting: true, turn: 1, swipeId: 0, swipes, variables: swipes.map(() => ({})) }] }
      const extensions = settings.extensions || (readRuntimeExtensions ? await readRuntimeExtensions(cardPath) : {})
      draft.characterVariables = copy(extensions.variables || {})
      const projected = projectTavernHelperScripts(extensions.helperScripts)
      draft.helperScripts = projected.scripts
      draft.regexScripts = { global: extensions.globalRegexScripts || [], character: extensions.characterRegexScripts || extensions.regexScripts || [] }
      draft.diagnostics = projected.diagnostics.concat(extensions.diagnostics || [])
      draft.runtimeEnabled = projected.scripts.length > 0
      draft.extensionSettings = extensionSettings ? await extensionSettings.read() : {}
      // Starting MVU must not replace another plugin's settings or its save baseline.
      if (settings.runtime === true) draft.runtimeEnabled = true
      draft.chat.sessionId = 'opening:' + draft.id
      drafts.set(draft.id, draft)
      return present(draft)
    },
    templateState(id) {
      const draft = requireDraft(id), world = draft.card.name || 'opening'
      const card = { ...copy(draft.card), data: { ...copy(draft.card), extensions: { ...draft.card.extensions, world } } }
      return { state: projectFullPromptTemplateState(draft.chat), environment: { characters: [card], this_chid: 0,
        name1: draft.userName, name2: draft.card.name, world_names: [world], selected_world_info: [],
        extension_settings: { ...copy(draft.extensionSettings), variables: { global: copy(draft.globalVariables || {}) } },
        worldbooks: { [world]: draft.document ? exportSillyTavernWorldBook(draft.document) : { entries: {} } },
        dsh: { cardPath: draft.cardPath, regexScripts: [], model: '' } } }
    },
    saveTemplateState(id, state) {
      const draft = requireDraft(id)
      draft.chat = applyFullPromptTemplateState(draft.chat, copy(draft.chat), state)
      draft.chat._storageRevision++
      return { updated: true, state: projectFullPromptTemplateState(draft.chat) }
    },
    saveTemplateSettings(id, settings) {
      const draft = requireDraft(id); draft.extensionSettings.EjsTemplate = copy(settings)
      return { updated: true, settings: copy(settings) }
    },
    saveTemplateGlobals(id, variables) {
      const draft = requireDraft(id); draft.globalVariables = copy(variables)
      return { updated: true, variables: copy(variables) }
    },
    applyTemplateInitial(id, result) {
      const draft = requireDraft(id)
      if (result.diagnostics?.length) throw new Error('完整模板初始化失败')
      draft.chat.variables = copy(result.initial)
      draft.chat._storageRevision++
      return present(draft)
    },
    get(id) { return present(requireDraft(id)) },
    retain(id) { requireDraft(id); return { retained: true } },
    release(id) { generations.stopAll('opening:' + id); return { released: drafts.delete(id) } },
    dispose() { generations.dispose(); drafts.clear() },
    async callRuntime(id, method, args = {}) {
      const draft = requireDraft(id)
      if (method === 'stopTavernHelperGeneration') return { stopped: generations.stop(draft.chat.sessionId, args.generationId, { generationToken: args.generationToken, pending: args.pending }) }
      if (method === 'stopAllTavernHelperGeneration') return { stopped: true, generationIds: generations.stopAll(draft.chat.sessionId, args.pendingGenerations) }
      if (method === 'generateTavernHelperRaw' || method === 'generateTavernHelper') {
        const callback = method === 'generateTavernHelper' ? generate : generateRaw
        if (!callback) throw new Error('独立生成服务尚未就绪')
        return await generations.run(draft.chat.sessionId, args.config?.generation_id, async signal => ({ text: await callback(args.config, {
          sessionId: draft.sourceSessionId, signal, chat: { ...copy(draft.chat), macroState: { ...copy(draft.chat.macroState), global: copy(draft.globalVariables || {}) } }, card: copy(draft.card),
          worldBook: draft.document ? { view: inspectWorldBookDocument(copy(draft.document)) } : null,
          presetSnapshot: copy(draft.presetSnapshot), characterVariables: copy(draft.characterVariables || {}),
          extensions: { globalRegexScripts: copy(draft.regexScripts.global), characterRegexScripts: copy(draft.regexScripts.character), regexScripts: copy([...draft.regexScripts.global, ...draft.regexScripts.character]) },
          history: helperGenerationHistory(draft.chat)
        }) }), args.generationToken)
      }
      if (method === 'prepareOpeningCommand') {
        const command = parseOpeningCommand(args.line)
        const openingId = args.openingId || draft.openingId || draft.openings[0]?.id
        if (!draft.openings.some(opening => opening.id === openingId)) throw new Error('人物卡开场白不存在')
        draft.startCommand = { ...command, openingId }
        return { input: command.input }
      }
      if (!draft.runtimeEnabled) throw new Error('准备页脚本运行时未初始化')
      if (method === 'loadTavernWorldInfo') return { worldInfo: exportSillyTavernWorldBook(draft.document) }
      if (method === 'getTavernHelperWorldbook') return { worldbook: present(draft).worldbook }
      if (method === 'replaceTavernHelperWorldbook') {
        const result = await this.replaceWorldbook(id, args.entries, args.expectedEntries)
        return { updated: true, worldbook: result.worldbook }
      }
      if (method === 'updateTavernHelperPrompts') {
        mutateScriptPrompts(draft.chat, args.operation)
      } else if (method === 'updateTavernHelperVariables') {
        const type = args.option?.type
        if (type === 'global') draft.globalVariables = copy(args.variables)
        else if (type === 'character') draft.characterVariables = copy(args.variables)
        else replaceTavernHelperVariables(draft.chat, args)
      } else if (method === 'updateTavernHelperMessages') {
        // Interactive wizards may edit the existing draft greeting, never add story floors.
        for (const patch of args.messages || []) {
          if (Number(patch.message_id) !== 0 || Object.keys(patch).some(key => !['message_id', 'message', 'data', 'swipes_data'].includes(key))) throw new Error('准备阶段只能更新已有开场内容和变量')
        }
        replaceTavernHelperMessages(draft.chat, args.messages)
      } else if (method === 'saveTavernExtensionSettings') {
        if (JSON.stringify(draft.extensionSettings) !== JSON.stringify(args.expectedSettings)) throw new Error('设置已变化，请重新读取')
        draft.extensionSettings = extensionSettings ? await extensionSettings.save(args.settings, args.expectedSettings) : copy(args.settings)
        draft.chat._storageRevision++
        return { updated: true, extensionSettings: copy(draft.extensionSettings), context: runtimeContext(draft) }
      } else if (method === 'recordMvuRuntimeDiagnostic' || method === 'recordMvuLoadDiagnostic') {
        draft.diagnostics = (draft.diagnostics || []).concat(copy(args.diagnostic || {})).slice(-50)
        return { recorded: true }
      } else throw new Error('准备阶段暂不支持此宿主操作：' + method)
      draft.chat._storageRevision++
      return { updated: true, context: runtimeContext(draft) }
    },
    select(id, openingId) {
      const draft = requireDraft(id)
      const index = draft.openings.findIndex(opening => opening.id === openingId)
      if (index < 0) throw new Error('人物卡开场白不存在')
      draft.openingId = openingId
      if (draft.chat.messages[0]) draft.chat.messages[0].swipeId = index
      return { saved: true, openingId }
    },
    async replaceWorldbook(id, entries, expectedEntries) {
      const draft = requireDraft(id)
      if (!draft.document) throw new Error('当前人物卡没有绑定世界书')
      const view = inspectWorldBookDocument(draft.document)
      if (JSON.stringify(projectTavernHelperWorldbook(view).entries) !== JSON.stringify(expectedEntries)) {
        throw new Error('世界书已被其他操作修改，请重新读取后重试')
      }
      const operations = replaceTavernHelperWorldbookOperations(view, entries)
      draft.document = updateWorldBookDocument(draft.document, { operations }).document
      return present(draft)
    },
    resolve(id, cardPath, openingId) {
      const draft = requireDraft(id)
      if (draft.cardPath !== cardPath) throw new Error('开局草稿与人物卡不匹配')
      const selected = openingId || 'primary'
      const selectedIndex = draft.openings.findIndex(opening => opening.id === selected)
      if (selectedIndex < 0) throw new Error('人物卡开场白不存在')
      return copy({ startCommand: draft.startCommand?.openingId === selected ? draft.startCommand : undefined, openingMessages: Object.fromEntries(draft.openings.map((opening,index)=>[opening.id,draft.chat.messages[0]?.swipes?.[index] ?? opening.text])), openingVariables: Object.fromEntries(draft.openings.map((opening, index) => [opening.id, draft.chat.messages[0]?.variables?.[index] || {}])), variables: draft.chat.variables || {}, messageVariables: draft.chat.messages[0]?.variables?.[selectedIndex] || {}, openingId: selected, sourceSessionId: draft.sourceSessionId, sourceLifecycleRevision: draft.sourceLifecycleRevision, worldbookSnapshot: { version: 1, libraryDigest: draft.libraryDigest, source: draft.source, document: draft.document } })
    }
  }
}
