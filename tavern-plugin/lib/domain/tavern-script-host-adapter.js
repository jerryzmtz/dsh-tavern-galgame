import { templateStateFields } from './template-window-reader.js'
import { freezeJson } from './freeze-json.js'
import { formatMvuUpdateCommand } from './mvu-background-settlement.js'
import { prepareWidgetVariableOperations, auditWidgetVariableResult, widgetVariableDigest } from './widget-variables.js'
import { createScopedMessages } from './scoped-messages.js'
import { createMvuWorkingCopy, projectMvuReceipt } from './mvu-working-copy.js'
import { randomUUID } from 'node:crypto'
import { diffJson } from './json-mutation.js'
import { createFullPromptTemplateSync } from './full-prompt-template-sync.js'
import { createJsonValueProjectionCache } from './immutable-json-projection.js'
import { resourceSaveSummary, observeResourceSave } from './resource-save-summary.js'
import { projectFullPromptTemplateState, applyFullPromptTemplateState, validateFullPromptTemplateSave, expandFullPromptTemplatePatch } from './full-prompt-template-state.js'
import { mutateScriptPrompts } from './tavern-script-prompts.js'
import { exportSillyTavernWorldBook, inspectWorldBookDocument, updateWorldBookDocument } from './worldbook-resource.js'
import { isDeepStrictEqual } from 'node:util'
import { applyChatPluginData, validateChatPluginRequest, assertPluginJson } from './tavern-chat-plugin-data.js'
import {
  appendTavernHelperMessages,
  lastTavernHelperVariables,
  projectTavernHelperContext,
  projectTavernHelperMessage,
  replaceTavernHelperMessages,
  replaceTavernHelperVariables
} from './tavern-helper-context.js'
import {
  projectTavernHelperWorldbook,
  replaceTavernHelperWorldbookOperations
} from './tavern-helper-worldbook.js'
import { createMvuSettlementEffect, diffMvuChanges } from './mvu-settlement-effect.js'

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function isOfficialMvuData(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && value.stat_data !== undefined && value.schema !== undefined
}

// Pinned upstream src/function/update/index.ts throttles MESSAGE_RECEIVED at
// 3000ms. Re-entering sooner returns the old Promise and schedules a late write.
const MVU_RETRY_AFTER_MS = 3100

/**
 * Translate the Tavern-shaped host API exposed to card scripts into mutations
 * of dsh-tavern's authoritative chat and worldbook state.
 */
export function createTavernScriptHostAdapter(options = {}) {
  const syncTemplateState = createFullPromptTemplateSync()
  const templateCharacters = createJsonValueProjectionCache({ capacity: 8, maxBytes: 64 * 1024 * 1024 })
  const mutationTails = new Map()
  const settlementTransactions = new Map()
  const settlementReaders = new WeakMap()
  async function ensureRows(chat, indices) { await settlementReaders.get(chat)?.ensure?.(indices) }
  async function fullContext(chat) {
    await ensureRows(chat)
    return projectTavernHelperContext(chat)
  }
  // One detached base, never writable or exposed to callers. Incremental storage
  // reads replace changed rows; cache eviction only costs a cold full read.
  let settlementBase = null
  const settlementSizes = new WeakMap()
  function rememberSettlementBase(chat) {
    const limit = 64 * 1024 * 1024
    function size(value) {
      if (typeof value === 'string') return value.length * 2 + 24
      if (!value || typeof value !== 'object') return 16
      if (settlementSizes.has(value)) return settlementSizes.get(value)
      let bytes = 32
      for (const key of Object.keys(value)) {
        bytes += key.length * 2 + 24 + size(value[key])
        if (bytes > limit) break
      }
      settlementSizes.set(value, bytes)
      return bytes
    }
    settlementBase = size(chat) <= limit ? chat : null
    return chat
  }
  async function readSettlementChat(sessionId) {
    const selectedBase = await options.resolveSettlementBase?.(sessionId)
    if (selectedBase) {
      settlementReaders.set(selectedBase.chat, selectedBase)
      return selectedBase.chat
    }
    const cached = settlementBase
    if (cached?.sessionId === sessionId && options.resolveChatSlice && options.resolveChangedChatSlice) {
      const selected = await options.resolveChatSlice(sessionId, [])
      if (selected?.denseMessages && selected.chat.id === cached.id) {
        if (selected.chat._storageRevision === cached._storageRevision) return cached
        const changed = await options.resolveChangedChatSlice(sessionId, cached._storageRevision)
        if (changed?.denseMessages && changed.chat.id === cached.id && changed.chat.sessionId === sessionId
          && changed.baseRevision === cached._storageRevision) {
          const messages = cached.messages.slice(0, changed.messageCount)
          changed.indices.forEach((index,i) => { messages[index] = changed.chat.messages[i] })
          if (messages.length === changed.messageCount && Array.from({length:messages.length},(_,i)=>Boolean(messages[i])).every(Boolean)) {
            return rememberSettlementBase({ ...changed.chat, messages })
          }
        }
      }
    }
    const chat = await resolveChat(sessionId)
    if (options.resolveChatSlice && options.resolveChangedChatSlice) rememberSettlementBase(chat)
    return chat
  }

  function assertDependencies() {
    for (const name of ['resolveChat', 'writeChat', 'readCard', 'worldBooks', 'scriptDispatch']) {
      if (!options[name]) throw new Error('Tavern Script Host Adapter 缺少依赖: ' + name)
    }
  }
  assertDependencies()

  function assertMvuEnabled(chat) {
    if (!chat || !chat.mvu || chat.mvu.enabled !== true) throw new Error('当前人物卡未启用 MVU 兼容运行时')
  }

  async function assertScriptEnabled(chat) {
    if (typeof options.isPlayChat === 'function' && !options.isPlayChat(chat)) throw new Error('当前会话没有绑定游玩对话')
    if (chat?.mvu?.enabled === true) return
    if (typeof options.hasScripts !== 'function' || !await options.hasScripts(chat)) throw new Error('当前人物卡没有启用脚本运行时')
  }

  function mutationIsCurrent(chat, expectedLifecycleRevision) {
    if (expectedLifecycleRevision === undefined || expectedLifecycleRevision === null) return true
    return Math.max(0, Number(chat && chat.tavernHelperLifecycleRevision) || 0) === Math.max(0, Number(expectedLifecycleRevision) || 0)
  }

  async function staleMutation(chat) {
    return { updated: false, stale: true, context: await fullContext(chat) }
  }

  async function resolveChat(sessionId) {
    const chat = await options.resolveChat(str(sessionId))
    if (chat === undefined) throw new Error('当前会话没有绑定人物卡')
    return chat
  }

  function assertTransactionEvent(transaction, eventId) {
    const id = str(eventId)
    // Scripts lose the event identity after an await or timer. SillyTavern applies
    // such writes to the current state, so they join the running settlement too.
    if (transaction !== undefined && (transaction.variableEdit || id !== '') && transaction.eventId !== id) {
      const error = new Error('脚本写入不属于当前 MVU 结算事件')
      error.code = 'MVU_SETTLEMENT_EVENT_MISMATCH'
      throw error
    }
    if (transaction === undefined && id.startsWith('mvu-work:')) {
      const error = new Error('结算已结束，迟到的结算写入已忽略')
      error.code = 'MVU_SETTLEMENT_EVENT_MISMATCH'
      throw error
    }
  }

  async function mutationChat(sessionId, eventId) {
    const transaction = settlementTransactions.get(str(sessionId))
    assertTransactionEvent(transaction, eventId)
    return transaction === undefined ? await resolveChat(sessionId) : transaction.draft
  }

  async function transactionResult(sessionId, target, multiple = false, eventId = '') {
    const transaction = settlementTransactions.get(str(sessionId))
    assertTransactionEvent(transaction, eventId)
    if (transaction === undefined) return null
    transaction.mutations++
    return {
      updated: true,
      transactional: true,
      ...(multiple ? { targets: target } : { target }),
      ...(transaction.compact ? { contextDelta: projectMvuReceipt(transaction.work, multiple ? target : [target]) }
        : { context: await fullContext(transaction.draft) })
    }
  }

  async function updatePrompts(sessionId, operation, expectedLifecycleRevision, eventId) {
    return serializeWorldbook('script-prompts:' + sessionId, async function () {
      const chat = await mutationChat(sessionId, eventId)
      await assertScriptEnabled(chat)
      if (!mutationIsCurrent(chat, expectedLifecycleRevision)) return staleMutation(chat)
      if (!mutateScriptPrompts(chat, operation)) return { updated: false, context: await fullContext(chat) }
      const transactional = await transactionResult(sessionId, { type: 'prompts' }, false, eventId)
      if (transactional !== null) return transactional
      let saved
      if (options.patchChat && Number.isSafeInteger(chat._storageRevision) && chat._storageRevision > 0) {
        saved = await options.patchChat(chat.id, chat._storageRevision, [
          { op: 'set', path: ['tavernScriptPrompts'], value: chat.tavernScriptPrompts }
        ], { source: 'tavern-helper.prompts' })
      }
      // A concurrent write must use the existing three-way merge, never retry
      // this stale replacement against a newer revision.
      if (!saved) await options.writeChat(chat, { source: 'tavern-helper.prompts' })
      else {
        chat._storageRevision = saved._storageRevision
        chat.updatedAt = saved.updatedAt
      }
      return { updated: true, context: await fullContext(chat) }
    })
  }

  async function updateVariables(sessionId, option, variables, expectedLifecycleRevision, eventId, contextBaseline) {
    return serializeWorldbook('variables:' + sessionId, () => updateVariablesNow(sessionId, option, variables, expectedLifecycleRevision, eventId, contextBaseline))
  }

  async function variableMutationSlice(sessionId, option, expectedLifecycleRevision, eventId, baseline) {
    assertTransactionEvent(settlementTransactions.get(str(sessionId)), eventId)
    if (!baseline || !options.patchChat || !options.resolveChatSlice || !options.readChatRevision || settlementTransactions.has(str(sessionId))
      || !['message','chat','script'].includes(option?.type)) return null
    const fields = ['id','sessionId','_storageRevision','tavernHelperLifecycleRevision','mode','cardPath','mvu',
      ...(option.type === 'chat' ? ['variables'] : option.type === 'script' ? ['tavernHelperScriptVariables'] : [])]
    let selected = await options.resolveChatSlice(str(sessionId), [], fields)
    const matches = value => value?.denseMessages && value.chat.id === baseline.chatId
      && value.chat._storageRevision === baseline.stateRevision
      && (value.chat.tavernHelperLifecycleRevision || 0) === baseline.lifecycleRevision
      && mutationIsCurrent(value.chat, expectedLifecycleRevision) && value.chat.mvu?.enabled === true
    if (!matches(selected)) return null
    let messageId
    if (option.type === 'message') {
      const raw = option.message_id === undefined || option.message_id === null || option.message_id === 'latest' ? -1 : Number(option.message_id)
      messageId = raw < 0 ? selected.messageCount + raw : raw
      if (!Number.isInteger(messageId) || messageId < 0 || messageId >= selected.messageCount) return null
      const count = selected.messageCount
      selected = await options.resolveChatSlice(str(sessionId), [messageId], fields)
      if (!matches(selected) || selected.messageCount !== count || !selected.chat.messages?.[0]) return null
    }
    if (settlementTransactions.has(str(sessionId))) return null
    selected.chat.messages = createScopedMessages(selected.messageCount, messageId === undefined ? [] : [[messageId,selected.chat.messages[0]]])
    return { chat:selected.chat, messageId }
  }

  async function updateVariablesNow(sessionId, option, variables, expectedLifecycleRevision, eventId, contextBaseline, allowSlice = true, fallbackChat) {
    const scoped = allowSlice ? await variableMutationSlice(sessionId, option, expectedLifecycleRevision, eventId, contextBaseline) : null
    // Global/card variables live outside Chat history. Validate the same
    // lifecycle and script permissions from the header, without decoding messages.
    let resourceHeader
    if (['global','character'].includes(option?.type) && !settlementTransactions.has(str(sessionId))) {
      assertTransactionEvent(undefined, eventId)
      resourceHeader = await options.resolveChatSlice?.(str(sessionId), [], 'settlement')
    }
    const chat = scoped?.chat || resourceHeader?.chat || fallbackChat || await mutationChat(sessionId, eventId)
    await assertScriptEnabled(chat)
    if (scoped && settlementTransactions.has(str(sessionId))) return updateVariablesNow(sessionId, option, variables, expectedLifecycleRevision, eventId, contextBaseline, false)
    if (!mutationIsCurrent(chat, expectedLifecycleRevision)) return staleMutation(resourceHeader ? await resolveChat(sessionId) : chat)
    if (option && option.type === 'global') {
      if (!options.globalVariables || typeof options.globalVariables.save !== 'function') throw new Error('全局变量存储未连接')
      const transaction = settlementTransactions.get(str(sessionId))
      if (transaction) {
        const previous = transaction.globalVariables || await options.globalVariables.read()
        const next = variables && typeof variables === 'object' && !Array.isArray(variables) ? variables : {}
        // Official MVU uses this global as an execution flag, not shared game
        // state. Keep it local to the settlement and retain cross-chat guards.
        const withoutRuntimeFlag = value => { const copy = { ...value }; delete copy.extra_analysis; return copy }
        if (!isDeepStrictEqual(withoutRuntimeFlag(previous), withoutRuntimeFlag(next))) throw new Error('MVU 结算事务不能修改跨对话的全局变量')
        transaction.globalVariables = structuredClone(next)
        return { updated: true, transactional: true, target: { type: 'global' }, globalVariables: structuredClone(next) }
      }
      const saved = await options.globalVariables.save(variables && typeof variables === 'object' && !Array.isArray(variables) ? variables : {})
      return { updated: true, target: { type: 'global' }, globalVariables: structuredClone(saved) }
    }
    if (option && option.type === 'character') {
      if (!options.characterVariables || typeof options.characterVariables.save !== 'function') throw new Error('人物卡变量存储未连接')
      const transaction = settlementTransactions.get(str(sessionId))
      if (transaction) throw new Error('MVU 结算事务不能修改跨对话的人物卡变量')
      const saved = await serializeWorldbook('card-variables:' + str(chat.cardPath), function () {
        return options.characterVariables.save(chat.cardPath, variables && typeof variables === 'object' && !Array.isArray(variables) ? variables : {}, str(sessionId))
      })
      return { updated: true, target: { type: 'character' }, characterVariables: structuredClone(saved) }
    }
    const canPatch = options.patchChat && Number.isSafeInteger(chat._storageRevision) && chat._storageRevision > 0
      && !settlementTransactions.has(str(sessionId))
    // Capture references to replaced values, not copies of the entire history.
    // Message variable arrays are mutated in place by the compatibility API.
    const before = canPatch ? {
      variables: chat.variables,
      scripts: chat.tavernHelperScriptVariables && { ...chat.tavernHelperScriptVariables },
      messages: scoped ? (scoped.messageId === undefined ? {} : { [scoped.messageId]: Array.isArray(chat.messages[scoped.messageId].variables) ? chat.messages[scoped.messageId].variables.slice() : chat.messages[scoped.messageId].variables }) : option?.type === 'message' ? (chat.messages || []).map(message =>
        Array.isArray(message?.variables) ? message.variables.slice() : message?.variables) : []
    } : null
    const baseRevision = chat._storageRevision
    const compact = canPatch && contextBaseline?.chatId === chat.id
      && contextBaseline.stateRevision === baseRevision
      && contextBaseline.lifecycleRevision === (chat.tavernHelperLifecycleRevision || 0)
      && (scoped || (chat.messages || []).every(message => message && typeof message === 'object'))
    let patched = false
    const transaction = settlementTransactions.get(str(sessionId))
    if (transaction && (!option?.type || option.type === 'message')) {
      await transaction.work.touchAsync(option?.message_id)
      assertTransactionEvent(settlementTransactions.get(str(sessionId)), eventId)
    }
    const updated = replaceTavernHelperVariables(chat, { option, variables })
    const transactional = await transactionResult(sessionId, updated, false, eventId)
    if (transactional !== null) return transactional
    try {
      let saved
      if (canPatch) {
        const path = updated.type === 'message' ? ['messages', updated.messageId, 'variables']
          : [updated.type === 'chat' ? 'variables' : 'tavernHelperScriptVariables']
        const previous = updated.type === 'message' ? before.messages[updated.messageId]
          : updated.type === 'chat' ? before.variables : before.scripts
        const current = updated.type === 'message' ? chat.messages[updated.messageId].variables
          : updated.type === 'chat' ? chat.variables : chat.tavernHelperScriptVariables
        // Match the existing JSON store's normalization (including sparse swipes).
        const normalized = JSON.parse(JSON.stringify(current))
        const changes = diffJson(previous, normalized).map(change => ({ ...change, path: [...path, ...change.path] }))
        saved = await options.patchChat(chat.id, chat._storageRevision, changes, {
          source: 'tavern-helper.variables',
          assertCurrent: () => assertTransactionEvent(settlementTransactions.get(str(sessionId)), eventId)
        })
        if (saved) {
          patched = true
          const { messages: _messages, ...header } = saved
          Object.assign(chat, header)
          if (updated.type === 'message') chat.messages[updated.messageId].variables = normalized
        }
      }
      // A competing revision needs the existing three-way merge/conflict checks.
      if (!saved && scoped) {
        assertTransactionEvent(settlementTransactions.get(str(sessionId)), eventId)
        const baseline = await options.readChatRevision(chat.id, baseRevision)
        if (!baseline) { const error = new Error('变量写入基线已失效');error.code = 'DSH_TAVERN_CHAT_CONFLICT';throw error }
        return updateVariablesNow(sessionId, option, variables, expectedLifecycleRevision, eventId, contextBaseline, false, baseline)
      }
      if (!saved) await options.writeChat(chat, { source: 'tavern-helper.variables' })
    }
    catch (error) {
      if (error && error.code === 'DSH_TAVERN_CHAT_CONFLICT') {
        const latest = await options.resolveChat(str(sessionId))
        if (latest !== undefined && !mutationIsCurrent(latest, expectedLifecycleRevision)) return staleMutation(latest)
      }
      throw error
    }
    if (compact && patched) {
      // Project only the affected floor, never the complete history. Keep the
      // selected swipe semantics of the full compatibility projection.
      const changes = updated.type === 'message'
        ? { messageId: updated.messageId, message: { ...projectTavernHelperContext({ messages: [chat.messages[updated.messageId]] }).messages[0], message_id: updated.messageId } }
        : updated.type === 'chat' ? { chatVariables: structuredClone(chat.variables || {}) }
          : { scriptVariables: structuredClone(chat.tavernHelperScriptVariables || {}) }
      return { updated: true, target: updated, contextDelta: {
        version: 1, chatId: chat.id, lifecycleRevision: chat.tavernHelperLifecycleRevision || 0,
        baseRevision, stateRevision: chat._storageRevision, ...changes
      } }
    }
    return { updated: true, target: updated, context: await fullContext(chat) }
  }

  async function updateMessages(sessionId, messages, expectedLifecycleRevision, eventId) {
    const transaction = settlementTransactions.get(str(sessionId))
    assertTransactionEvent(transaction, eventId)
    const chat = transaction === undefined ? await resolveChat(sessionId) : transaction.draft
    await assertScriptEnabled(chat)
    if (!mutationIsCurrent(chat, expectedLifecycleRevision)) return staleMutation(chat)
    const patches = transaction === undefined ? messages : (Array.isArray(messages) ? messages : []).map(function (raw) {
      const patch = raw && typeof raw === 'object' ? structuredClone(raw) : raw
      if (!patch || Number(patch.message_id) !== transaction.messageId) return patch
      const swipeId = Object.prototype.hasOwnProperty.call(patch, 'swipe_id') ? Number(patch.swipe_id) : transaction.swipeId
      if (swipeId !== transaction.swipeId) return patch
      delete patch.message
      return patch
    })
    if (transaction) {
      for (const patch of patches) if (patch && typeof patch === 'object') await transaction.work.touchAsync(patch.message_id)
      if (chat.messages.length) await transaction.work.ensure([0])
      assertTransactionEvent(settlementTransactions.get(str(sessionId)), eventId)
    }
    const updated = replaceTavernHelperMessages(chat, patches)
    if (!transaction?.variableEdit && chat.mvu && chat.mvu.owner === 'official') {
      const opening = Array.isArray(chat.messages) ? chat.messages[0] : null
      const snapshots = opening && Array.isArray(opening.variables) ? opening.variables : []
      if (snapshots.length > 0 && snapshots.every(isOfficialMvuData)) {
        chat.mvu.openingInitialization = { version: 2, status: 'complete', completedAt: Date.now() }
      }
    }
    const transactional = await transactionResult(sessionId, updated, true, eventId)
    if (transactional !== null) return transactional
    try { await options.writeChat(chat, { source: 'tavern-helper.messages' }) }
    catch (error) {
      if (error && error.code === 'DSH_TAVERN_CHAT_CONFLICT') {
        const latest = await options.resolveChat(str(sessionId))
        if (latest !== undefined && !mutationIsCurrent(latest, expectedLifecycleRevision)) return staleMutation(latest)
      }
      throw error
    }
    return { updated: true, targets: updated, context: await fullContext(chat) }
  }

  async function createMessages(sessionId, messages, option, expectedLifecycleRevision, eventId) {
    const transaction = settlementTransactions.get(str(sessionId))
    assertTransactionEvent(transaction, eventId)
    if (transaction !== undefined) throw new Error('MVU 结算事务不能创建额外聊天楼层')
    const chat = await resolveChat(sessionId)
    await assertScriptEnabled(chat)
    if (!mutationIsCurrent(chat, expectedLifecycleRevision)) return staleMutation(chat)
    const created = appendTavernHelperMessages(chat, messages, option)
    try { await options.writeChat(chat, { source: 'tavern-helper.messages.create' }) }
    catch (error) {
      if (error && error.code === 'DSH_TAVERN_CHAT_CONFLICT') {
        const latest = await options.resolveChat(str(sessionId))
        if (latest !== undefined && !mutationIsCurrent(latest, expectedLifecycleRevision)) return staleMutation(latest)
      }
      throw error
    }
    if (typeof options.publishCreatedMessages === 'function') await options.publishCreatedMessages(chat, created)
    return { updated: true, targets: created, context: await fullContext(chat) }
  }

  async function worldbookRecord(sessionId, requestedName, template = false, suppliedChat, readOnly = false) {
    const selected = readOnly && !suppliedChat && await options.resolveChatSlice?.(sessionId, [], 'settlement')
    const chat = suppliedChat || selected?.chat || await resolveChat(sessionId)
    if (template) assertTemplateChat(chat); else await assertScriptEnabled(chat)
    const card = await options.readCard(chat)
    const record = await options.worldBooks.bound(chat.cardPath, card, chat)
    if (record === null) throw new Error('当前人物卡没有绑定世界书')
    const name = str(requestedName).trim()
    if (name !== '' && name !== 'current' && name !== str(record.view.displayName)) {
      throw new Error('当前兼容层只能访问人物卡绑定的世界书: ' + name)
    }
    return { chat, record }
  }

  async function serializeWorldbook(cardPath, work) {
    const key = str(cardPath)
    const previous = mutationTails.get(key) || Promise.resolve()
    const current = previous.catch(function () {}).then(work)
    mutationTails.set(key, current)
    try { return await current }
    finally { if (mutationTails.get(key) === current) mutationTails.delete(key) }
  }

  async function getWorldbook(sessionId, name, template = false) {
    const resolved = await worldbookRecord(sessionId, name, template, undefined, true)
    return { worldbook: projectTavernHelperWorldbook(resolved.record.view) }
  }

  async function replaceWorldbook(sessionId, name, entries, expectedEntries, template = false) {
    const initial = await worldbookRecord(sessionId, name, template)
    return await serializeWorldbook(worldbookKey(initial.record), async function () {
      const resolved = await worldbookRecord(sessionId, name, template)
      if (worldbookKey(resolved.record) !== worldbookKey(initial.record)) throw new Error('世界书绑定已变化，请重新读取后重试')
      if (expectedEntries !== undefined && JSON.stringify(projectTavernHelperWorldbook(resolved.record.view).entries) !== JSON.stringify(expectedEntries)) {
        throw new Error('世界书已被其他操作修改，请重新读取后重试')
      }
      const operations = replaceTavernHelperWorldbookOperations(resolved.record.view, entries)
      const transaction = settlementTransactions.get(str(sessionId))
      if (transaction && operations.length > 0) throw new Error('MVU 结算事务不能修改跨存储的世界书')
      const updated = operations.length === 0
        ? resolved.record
        : await observeResourceSave(resourceSaveSummary('worldbook', resolved.record.localChatId ? 'session' : resolved.record.source.kind === 'card' ? 'card' : 'worldbook', projectTavernHelperWorldbook(resolved.record.view).entries, entries), () => updateBoundWorldbook(resolved, { operations }), summary => options.recordResourceSave?.(sessionId, summary))
      return { updated: operations.length > 0, worldbook: projectTavernHelperWorldbook(updated.view) }
    })
  }

  async function updateBoundWorldbook(resolved, request, nativeDocument) {
    if (!resolved.record.localChatId) return nativeDocument === undefined
      ? await options.worldBooks.update(resolved.record.source, request)
      : await options.worldBooks.replaceNative(resolved.record.source, nativeDocument)
    if (nativeDocument !== undefined) {
      if (!nativeDocument || typeof nativeDocument !== 'object' || !nativeDocument.entries ||
          typeof nativeDocument.entries !== 'object' || Array.isArray(nativeDocument.entries)) throw new Error('原生世界书需要 entries 对象')
      for (const [key, entry] of Object.entries(nativeDocument.entries)) {
        if (!entry || !Number.isSafeInteger(entry.uid) || entry.uid < 0 || String(entry.uid) !== key) throw new Error('世界书条目编号无效或重复')
      }
    }
    const document = nativeDocument === undefined
      ? updateWorldBookDocument(resolved.record.document, request).document
      : structuredClone(nativeDocument)
    // Reuse native worldbook validation before publishing the chat-local version.
    const view = inspectWorldBookDocument(document)
    replaceTavernHelperWorldbookOperations(view, projectTavernHelperWorldbook(view).entries)
    // Legacy chats have no opening snapshot; first merged-book write makes a private copy.
    resolved.chat.openingWorldbookSnapshot = {
      ...(resolved.chat.openingWorldbookSnapshot || { version: 1, source: structuredClone(resolved.record.source) }), document
    }
    await options.writeChat(resolved.chat, { source: 'tavern-helper.local-worldbook' })
    return { ...resolved.record, document, view }
  }

  async function exportBoundWorldbook(record) {
    return record.document ? exportSillyTavernWorldBook(record.document)
      : (await options.worldBooks.export(record.source)).document
  }

  function worldbookKey(record) {
    if (record.localChatId) return 'chat:' + record.localChatId
    return record.source.kind === 'card' ? 'card:' + record.source.cardPath : 'standalone:' + record.source.path
  }

  async function loadWorldInfo(sessionId, name) {
    const resolved = await worldbookRecord(sessionId, name, false, undefined, true)
    return { worldInfo: await exportBoundWorldbook(resolved.record) }
  }

  async function saveWorldInfo(sessionId, name, worldInfo, expectedWorldInfo) {
    if (!expectedWorldInfo) throw new Error('保存前请先读取世界书')
    const initial = await worldbookRecord(sessionId, name)
    return await serializeWorldbook(worldbookKey(initial.record), async function () {
      const resolved = await worldbookRecord(sessionId, name)
      if (worldbookKey(resolved.record) !== worldbookKey(initial.record)) throw new Error('世界书绑定已变化，请重新读取后重试')
      const current = await exportBoundWorldbook(resolved.record)
      if (!isDeepStrictEqual(current, expectedWorldInfo)) throw new Error('世界书已被其他操作修改，请重新读取后重试')
      const transaction = settlementTransactions.get(str(sessionId))
      if (transaction) throw new Error('MVU 结算事务不能修改跨存储的世界书')
      const updated = await observeResourceSave(resourceSaveSummary('worldbook', resolved.record.localChatId ? 'session' : resolved.record.source.kind === 'card' ? 'card' : 'worldbook', current.entries, worldInfo.entries, true), () => updateBoundWorldbook(resolved, {}, worldInfo), summary => options.recordResourceSave?.(sessionId, summary))
      return { updated: true, worldbook: projectTavernHelperWorldbook(updated.view), worldInfo: await exportBoundWorldbook(updated) }
    })
  }

  async function saveChatData(sessionId, request) {
    const revisions = validateChatPluginRequest(request)
    const chat = await resolveChat(sessionId)
    await assertScriptEnabled(chat)
    if (chat.id !== request.chatId) throw new Error('聊天已切换，插件数据未保存')
    if (!options.readChatRevision || !options.updateChat) throw new Error('插件聊天存储未连接')
    if (settlementTransactions.has(str(sessionId))) throw new Error('临时 MVU 结算期间不能保存聊天插件数据，请稍后重试')
    const baselines = new Map(await Promise.all(revisions.map(async revision => [revision, await options.readChatRevision(chat.id, revision)])))
    const saved = await options.updateChat(chat.id, async function (latest) {
      await assertScriptEnabled(latest)
      if (latest.sessionId && str(latest.sessionId) !== str(sessionId)) throw new Error('聊天绑定已变化，插件数据未保存')
      if (settlementTransactions.has(str(sessionId))) throw new Error('临时 MVU 结算期间不能保存聊天插件数据，请稍后重试')
      return applyChatPluginData(latest, baselines, request)
    }, { source: 'tavern-helper.chat-plugin-data' })
    if (!saved) throw new Error('聊天已不存在，插件数据未保存')
    return { updated: true, context: await fullContext(saved) }
  }

  function assertTemplateChat(chat) {
    if (!chat || !['story', 'script'].includes(chat.mode) || (typeof options.isPlayChat === 'function' && !options.isPlayChat(chat))) throw new Error('当前会话没有绑定游玩对话')
  }

  async function readFullPromptTemplateState(sessionId, cursor, windowed = false) {
    const window = windowed ? await options.resolveTemplateWindow?.(sessionId) : undefined
    const selected=!window && await (options.resolveChatMetadataSlice?.(sessionId) ?? options.resolveChatSlice?.(sessionId,[]))
    const reuse=selected?.denseMessages && syncTemplateState.matches(cursor,selected.chat)
    const reader = syncTemplateState.reader(cursor)
    let changed = !reuse && selected?.denseMessages && reader?.chatId === selected.chat.id
      && reader.sessionId === selected.chat.sessionId
      && reader.lifecycle === (selected.chat.tavernHelperLifecycleRevision || 0)
      ? await options.resolveChangedChatSlice?.(sessionId, reader.revision, templateStateFields) : undefined
    if (!changed?.denseMessages || changed.chat.id !== reader?.chatId
      || changed.chat.sessionId !== reader?.sessionId
      || (changed.chat.tavernHelperLifecycleRevision || 0) !== reader?.lifecycle) changed = undefined
    const template = !window && !reuse && !changed ? await options.resolveTemplateChat?.(sessionId) : undefined
    const chat = window?.chat || (reuse ? selected.chat : changed ? changed.chat : template?.chat || await resolveChat(sessionId))
    assertTemplateChat(chat)
    const card = await options.readCard(chat)
    let templateBook
    if (options.worldBooks.templateSnapshot) templateBook = await options.worldBooks.templateSnapshot(chat.cardPath, card, chat)
    else {
      const record = await options.worldBooks.bound(chat.cardPath, card, chat)
      const book = record ? await exportBoundWorldbook(record) : null
      const worldName = str(record?.view?.displayName)
      templateBook = { worldName, worldbooks: worldName && book ? { [worldName]: book } : {} }
    }
    const { worldName, worldbooks } = templateBook
    const extensionSettings = options.fullExtensionSettings ? await options.fullExtensionSettings.read() : {}
    extensionSettings.variables = { ...extensionSettings.variables, global: options.globalVariables ? await options.globalVariables.read() : {} }
    if (!Array.isArray(extensionSettings.regex)) extensionSettings.regex = []
    const characters = templateCharacters(JSON.stringify([chat.cardPath, worldName]), card, source => {
      return [{ ...source, data: { ...source, extensions: { ...source.extensions, ...(worldName ? { world: worldName } : {}) } } }]
    })
    const snapshot = {
      capabilities: {statePatch:1},
      state: projectFullPromptTemplateState(chat, template?.helper),
      environment: { characters, name1: str(chat.macroState?.userName) || '你', name2: str(card.name),
        this_chid: '0', extension_settings: extensionSettings,
        world_names: worldName ? [worldName] : [], selected_world_info: [],
        worldbooks,
        dsh: { settling: settlementTransactions.has(str(sessionId)) || ['pending', 'running'].includes(chat.settleStatus), cardPath: chat.cardPath, model: options.modelFor ? await options.modelFor(chat) : chat.model?.model || chat.model || '', regexScripts: card.extensions?.regex_scripts || [] } }
    }
    if (window) return {...snapshot,historyWindow:window.historyWindow}
    if (changed) {
      const indices = [...changed.indices]
      if (chat.promptTemplateInput?.message) indices.push(changed.messageCount)
      return syncTemplateState.selected(snapshot,cursor,indices,changed.messageCount+(chat.promptTemplateInput?.message?1:0),changed.baseRevision)
        || await readFullPromptTemplateState(sessionId)
    }
    if (!reuse) return syncTemplateState(snapshot,cursor)
    // A concurrent reader may have consumed the same cursor while resources loaded.
    return syncTemplateState.unchanged(snapshot,cursor,selected.messageCount+(chat.promptTemplateInput?.message?1:0))
      || await readFullPromptTemplateState(sessionId)
  }

  async function saveFullPromptTemplateGlobals(sessionId, variables, expectedVariables) {
    assertTemplateChat(await resourcePermissionChat(sessionId))
    if (!expectedVariables || typeof expectedVariables !== 'object' || Array.isArray(expectedVariables)) throw new Error('缺少全局变量读取版本')
    if (!options.globalVariables) throw new Error('全局变量存储未连接')
    const saved = await options.globalVariables.save(variables, expectedVariables)
    return { updated: true, variables: saved }
  }

  async function readGlobalPromptTemplateSettings() {
    if (!options.fullExtensionSettings) throw new Error('完整模板设置存储未连接')
    return { settings: (await options.fullExtensionSettings.read()).EjsTemplate }
  }

  async function saveFullPromptTemplateSettings(sessionId, settings, expectedSettings) {
    assertTemplateChat(await resourcePermissionChat(sessionId))
    return saveGlobalPromptTemplateSettings(settings, expectedSettings)
  }

  async function saveGlobalPromptTemplateSettings(settings, expectedSettings) {
    assertPluginJson(settings, '模板设置')
    if (expectedSettings !== undefined) assertPluginJson(expectedSettings, '模板设置读取版本')
    if (!options.fullExtensionSettings) throw new Error('完整模板设置存储未连接')
    const current = await options.fullExtensionSettings.read()
    const base = { ...current }
    if (expectedSettings === undefined) delete base.EjsTemplate
    else base.EjsTemplate = expectedSettings
    const saved = await options.fullExtensionSettings.save({ ...current, EjsTemplate: settings }, base)
    return { updated: true, settings: saved.EjsTemplate }
  }

  // Common variable/display writes keep their native row indices and exact revision.
  // Stale versions and body/swipe edits retain the full three-way merge below.
  async function saveTemplatePatch(sessionId, request) {
    if(!options.resolveChatSlice || !options.patchChat || !Array.isArray(request?.changes))return undefined
    const allowed=['variables','variables_initialized','is_ejs_processed','template_display','template_rendered']
    if(request.changes.some(c=>!Array.isArray(c.path) || !(c.path[0]==='chat_metadata' || c.path[0]==='chat' && Number.isSafeInteger(c.path[1]) && c.path[1]>=0 && allowed.includes(c.path[2]))))return undefined
    const indices=[...new Set(request.changes.filter(c=>c.path[0]==='chat').map(c=>c.path[1]))].sort((a,b)=>a-b)
    const head=await options.resolveChatSlice(sessionId,[])
    if(!head?.denseMessages)return undefined
    const revision=head.chat._storageRevision, stale=revision!==request.stateRevision
    // A reader behind the latest revision merges only the floors it edits plus the
    // floors changed since its read, against those floors as they were then. The
    // receipt then carries every change since its read, as a complete merge would.
    const changed=stale ? await options.resolveChangedIndices?.(sessionId,request.stateRevision) : {indices:[],revision}
    if(!changed || changed.revision!==revision)return undefined
    const virtual=head.chat.promptTemplateInput?.message ? head.messageCount : -1
    const lengthConflict=async()=>{
      // The complete merge refuses a reader whose history length differs; say so
      // without reading the whole history first.
      const read=await options.resolveChatSliceAt?.(sessionId,request.stateRevision,[])
      const length=chat=>chat.messageCount+(chat.chat.promptTemplateInput?.message?1:0)
      if(!read || read.chat._storageRevision!==request.stateRevision || length(read)===length(head))return false
      const error=new Error('聊天楼层已变化，模板存档未保存')
      error.code='PROMPT_TEMPLATE_STATE_CONFLICT'
      throw error
    }
    if(indices.some(i=>i>=head.messageCount && i!==virtual) || changed.indices.some(i=>i>=head.messageCount)){
      if(stale)await lengthConflict()
      return undefined
    }
    const storedIndices=[...new Set([...indices.filter(i=>i<head.messageCount),...changed.indices])].sort((a,b)=>a-b)
    const selected=storedIndices.length ? await options.resolveChatSlice(sessionId,storedIndices) : head
    if(!selected?.denseMessages || selected.chat._storageRevision!==revision)return undefined
    const before=stale ? await options.resolveChatSliceAt?.(sessionId,request.stateRevision,storedIndices) : selected
    if(!before?.denseMessages || before.chat._storageRevision!==request.stateRevision)return undefined
    if(stale && before.messageCount!==head.messageCount){
      await lengthConflict()
      return undefined
    }
    const projectedIndices=[...storedIndices,...(virtual>=0?[virtual]:[])]
    const baseline=before.chat, latest=selected.chat
    assertTemplateChat(latest)
    if(settlementTransactions.has(str(sessionId)))throw new Error('MVU 结算进行中，模板存档不能覆盖结算事务')
    const compact={...request,changes:request.changes.map(c=>c.path[0]==='chat'?{...c,path:['chat',projectedIndices.indexOf(c.path[1]),...c.path.slice(2)]}:c)}
    const expanded=expandFullPromptTemplatePatch(baseline,compact)
    const next=applyFullPromptTemplateState(latest,baseline,expanded)
    // No body rewrites on this path: native message history needs no resynchronization.
    const changes=diffJson(latest,next).map(c=>c.path[0]==='messages'?{...c,path:['messages',storedIndices[c.path[1]],...c.path.slice(2)]}:c)
    const saved=await options.patchChat(latest.id,revision,changes,{source:'prompt-template.state',assertCurrent:()=>{if(settlementTransactions.has(str(sessionId)))throw new Error('MVU 结算进行中，模板存档不能覆盖结算事务')}})
    if(!saved)return undefined
    const receipt=diffJson(expanded,{...projectFullPromptTemplateState(next),stateRevision:saved._storageRevision})
    return {updated:true,statePatch:receipt.map(c=>c.path[0]==='chat'?{...c,path:['chat',projectedIndices[c.path[1]],...c.path.slice(2)]}:c)}
  }

  async function saveFullPromptTemplateState(sessionId, request) {
    const fast=await saveTemplatePatch(sessionId,request)
    if(fast)return fast
    const patch = Array.isArray(request?.changes)
    if (!patch) validateFullPromptTemplateSave(request)
    const chat = await resolveChat(sessionId)
    assertTemplateChat(chat)
    if (!options.readChatRevision || !options.updateChat) throw new Error('模板原生存储未连接')
    if (settlementTransactions.has(str(sessionId))) throw new Error('MVU 结算进行中，模板存档不能覆盖结算事务')
    const baseline = await options.readChatRevision(chat.id, request.stateRevision)
    if (patch) request = expandFullPromptTemplatePatch(baseline, request)
    const saved = await options.updateChat(chat.id, async latest => {
      assertTemplateChat(latest)
      if (settlementTransactions.has(str(sessionId))) throw new Error('MVU 结算进行中，模板存档不能覆盖结算事务')
      if (str(latest.sessionId) !== str(sessionId)) throw new Error('模板聊天已切换')
      const next = applyFullPromptTemplateState(latest, baseline, request)
      return options.prepareTemplateHistory ? await options.prepareTemplateHistory(latest, next) : next
    }, { source: 'prompt-template.state' })
    if (!saved) throw new Error('模板聊天已不存在')
    await options.synchronizeTemplateHistory?.(saved)
    const state = projectFullPromptTemplateState(saved)
    return patch ? {updated:true,statePatch:diffJson(request,state)} : {updated:true,state}
  }

  async function resourcePermissionChat(sessionId) {
    return (await options.resolveChatSlice?.(str(sessionId), [], 'settlement'))?.chat || await resolveChat(sessionId)
  }

  async function saveExtensionSettings(sessionId, settings, expectedSettings) {
    await assertScriptEnabled(await resourcePermissionChat(sessionId))
    if (!options.extensionSettings) throw new Error('插件设置存储未连接')
    const extensionSettings = await observeResourceSave(resourceSaveSummary('regex', 'global', expectedSettings?.regex, settings?.regex, true), () => options.extensionSettings.save(settings, expectedSettings), summary => options.recordResourceSave?.(sessionId, summary))
    if (typeof options.extensionSettingsChanged === 'function') await options.extensionSettingsChanged(str(sessionId))
    return { updated: true, extensionSettings }
  }

  async function context(sessionId, chatValue, transientUserText = '', indices) {
    const selected = !chatValue && !transientUserText && !indices ? await options.resolveHelperContext?.(sessionId) : undefined
    const chat = chatValue || selected?.chat || await resolveChat(sessionId)
    await ensureRows(chat, transientUserText ? undefined : indices)
    const draft = { ...chat, messages: chat.messages || [] }
    const userText = str(transientUserText).trim()
    if (userText !== '') {
      const previousVariables = lastTavernHelperVariables(draft.messages)
      const message = { role: 'user', text: userText, swipeId: 0, swipes: [userText], variables: [] }
      if (previousVariables !== undefined) message.variables = [structuredClone(previousVariables)]
      draft.messages = draft.messages.concat(message)
    }
    const projected = selected?.context || projectTavernHelperContext(indices ? { ...draft, messages: [] } : draft)
    if (indices) {
      projected.messages = indices.map(i => projectTavernHelperMessage(draft.messages[i], i))
      // An indexed dispatch is allowed only when floor identity/turn mapping
      // did not change. Keep the browser's already complete turn index.
      delete projected.turnMessageIds
    }
    if (options.globalVariables && typeof options.globalVariables.read === 'function') {
      projected.globalVariables = await options.globalVariables.read()
    }
    try {
      const resolved = await worldbookRecord(sessionId, 'current', false, chat)
      projected.worldbook = projectTavernHelperWorldbook(resolved.record.view)
    } catch {}
    return projected
  }

  async function dispatchEvent(input = {}) {
    // `recent`: the browser keeps its history lease, so send the recent window
    // instead of projecting every floor into the event.
    const recent = !input.context && input.recent === true ? await options.resolveHelperWindow?.(input.sessionId) : undefined
    const eventContext = input.context || (recent ? { contextWindow: recent } : await context(input.sessionId, input.chat, input.transientUserText))
    // Context preparation can await I/O before MVU has queued its dispatch.
    // Respect that reservation just as dispatch respects an executing event.
    if (settlementTransactions.has(str(input.sessionId))) return { handled: false, busy: true, args: structuredClone(input.args || []) }
    return await options.scriptDispatch.dispatch(input.sessionId, input.name, input.args, eventContext)
  }

  /** Run one internal MVU command against an isolated draft and commit once. */
  async function settleMvuUpdate(input = {}) {
    const pinnedBaseline = input.baseline === undefined ? undefined : freezeJson(structuredClone(input.baseline))
    const sessionId = str(input.sessionId)
    async function record(stage, details = {}) {
      try { await options.diagnostics?.record(sessionId, { diagnosticId: input.diagnosticId, messageId: input.messageId, swipeId: input.swipeId, stage, ...details }) } catch {}
    }
    if (settlementTransactions.has(sessionId)) throw new Error('当前对话已有 MVU 变量结算正在执行')
    const current = await readSettlementChat(sessionId)
    assertMvuEnabled(current)
    const operationId = str(input.operationId).trim()
    if (operationId === '') throw new Error('MVU 变量结算缺少 operationId')
    const expectedLifecycleRevision = Math.max(0, Number(input.expectedLifecycleRevision) || 0)
    if (!mutationIsCurrent(current, expectedLifecycleRevision)) return { updated: false, stale: true, context: await fullContext(current) }
    const messageId = Number(input.messageId)
    if (!Number.isInteger(messageId) || messageId < 0 || messageId >= current.messages.length) throw new Error('MVU 变量结算楼层不存在')
    await ensureRows(current, [messageId])
    const message = current.messages[messageId]
    const swipeId = Number(input.swipeId)
    if (!Number.isInteger(swipeId) || swipeId < 0 || swipeId !== Math.max(0, Number(message.swipeId) || 0)) {
      return { updated: false, stale: true, context: await fullContext(current) }
    }
    const variableEdit = input.variableEdit === true
    if (!variableEdit && message.variableEdits?.[swipeId]?.editedAfterSettlement === true) throw new Error('本轮已有用户变量修改；回退/重生成本轮将一并撤销')
    const baseline = message.variables?.[swipeId]
    const baselineCurrent = chat => pinnedBaseline === undefined
      ? widgetVariableDigest(chat.messages[messageId]?.variables?.[swipeId]) === input.baselineDigest
      : pinnedBaseline && typeof pinnedBaseline.revision === 'string' && String(chat._storageRevision) === pinnedBaseline.revision
        && isDeepStrictEqual(chat.messages[messageId]?.variables?.[swipeId], pinnedBaseline.value)
    if (variableEdit && (!baseline?.stat_data || baseline.schema === undefined || !baselineCurrent(current))) return { updated: false, stale: true }
    const preparedEdit = variableEdit ? prepareWidgetVariableOperations(input.declarations, baseline.stat_data, input.operations) : null
    const command = variableEdit ? formatMvuUpdateCommand(preparedEdit) : str(input.command).trim()
    if (command === '') throw new Error('MVU 变量结算命令为空')
    // resolveChat awaited above: another attempt may have reserved this session
    // in the meantime. Never overwrite its draft or release its ownership.
    if (settlementTransactions.has(sessionId)) throw new Error('当前对话已有 MVU 变量结算正在执行')
    // An earlier lifecycle event still owns the executor. Installing an MVU
    // transaction now would reject its legitimate writes during context loading,
    // even though dispatch would eventually return busy and defer this attempt.
    const beforeDispatch = options.scriptDispatch.status?.(sessionId)
    if (beforeDispatch?.busy) {
      await record('runtime-deferred', { availability: beforeDispatch })
      return { updated: false, deferred: true, deferredReason: 'runtime-busy', context: await fullContext(current) }
    }
    const originalText = str((message.swipes && message.swipes[swipeId]) ?? message.sourceText ?? message.text)
    const eventId = 'mvu-work:' + randomUUID()
    const work = createMvuWorkingCopy(current, eventId, {ensure: indices => ensureRows(current, indices)})
    const reader = settlementReaders.get(current)
    if (reader) settlementReaders.set(work.chat, reader)
    work.touch(messageId)
    const transaction = {
      work, compact: input.compactContext === true, variableEdit,
      draft: work.chat,
      eventId,
      messageId,
      swipeId,
      mutations: 0
    }
    if (input.baselineVariables) {
      const target = transaction.draft.messages[messageId]
      if (!Array.isArray(target.variables)) target.variables = []
      target.variables[swipeId] = structuredClone(input.baselineVariables)
    }
    settlementTransactions.set(sessionId, transaction)
    try {
      const internalText = variableEdit ? originalText : str(input.storyText).trim() + '\n\n' + command
      const hasMvuSnapshot = value => value && value.stat_data !== undefined && value.schema !== undefined
      const indexedBase = settlementReaders.get(current)
      let priorId = !variableEdit && indexedBase ? await indexedBase.previousMvu(messageId) : -1
      for (let i=variableEdit || indexedBase ? -1 : messageId-1;i>=0;i--) {
        const row=current.messages[i]
        if (hasMvuSnapshot(row.variables?.[row.swipeId || 0])) { priorId=i; break }
      }
      async function executionContext(baseline) {
        transaction.compact = input.compactContext === true || baseline?.workContextVersion === 1
        let indices, appended = false
        if (baseline?.workContextVersion === 1 && (baseline.complete === true || baseline.historyWindowVersion === 1) && !baseline.full
          && baseline.chatId === current.id && baseline.lifecycleRevision === (current.tavernHelperLifecycleRevision || 0)
          && Number.isSafeInteger(baseline.stateRevision) && !baseline.transaction) {
          if (baseline.stateRevision === current._storageRevision && baseline.messageCount === current.messages.length) indices=[]
          else {
            const changed = await options.resolveChangedChatSlice?.(sessionId, baseline.stateRevision, 'settlement')
            if (changed?.denseMessages && changed.baseRevision === baseline.stateRevision && changed.chat.id === current.id && changed.chat._storageRevision === current._storageRevision) {
              appended = baseline.appendContextVersion === 1 && Number.isSafeInteger(baseline.messageCount) && baseline.messageCount >= 0
                && current.messages.length > baseline.messageCount && Number.isSafeInteger(changed.layoutFrom) && changed.layoutFrom >= baseline.messageCount
              if (changed.layoutChanged === false || appended) indices=changed.indices
            }
          }
        }
        if (indices) indices=[...new Set([...indices,messageId,...(priorId>=0 && input.baselineVariables ? [priorId] : [])])].filter(i=>i<current.messages.length)
        const projected = await context(sessionId, transaction.draft, '', indices)
        const target = indices ? projected.messages.find(row=>row.message_id===messageId) : projected.messages[messageId]
        if (input.baselineVariables && priorId>=0) {
          const prior=indices ? projected.messages.find(row=>row.message_id===priorId) : projected.messages[priorId]
          prior.variables=structuredClone(input.baselineVariables)
        }
        target.message=internalText
        if (!Array.isArray(target.swipes)) target.swipes=[originalText]
        target.swipes[swipeId]=internalText
        if (transaction.compact) projected.transaction={eventId,sequence:work.sequence}
        if (!indices) return projected
        const {messages,...header}=projected
        const turnMessageIdChanges = []
        if (appended) for (const id of [...indices].sort((a,b)=>a-b)) {
          if (id < baseline.messageCount) continue
          const source = current.messages[id]
          const role = source.role === 'tavern-helper' ? (['system','assistant','user'].includes(source.tavernRole) ? source.tavernRole : 'assistant') : ['system','user'].includes(source.role) ? source.role : 'assistant'
          const turn = Math.max(0, Number(source.turn) || (source.greeting === true ? 1 : 0))
          if (role === 'assistant' && turn > 0) turnMessageIdChanges.push([String(turn),id])
        }
        return {contextDelta:{version:2,kind:'dispatch',chatId:current.id,
          lifecycleRevision:current.tavernHelperLifecycleRevision||0,baseRevision:baseline.stateRevision,
          stateRevision:current._storageRevision,eventId,messageCount:current.messages.length,header,messages,turnMessageIdChanges}}
      }
      transaction.executionContext = executionContext
      const lazy = options.scriptDispatch.supportsContextProjection === true
      const eventContext = lazy ? null : await executionContext()
      const availability = options.scriptDispatch.status?.(sessionId)
      const currentSnapshot=hasMvuSnapshot(transaction.draft.messages[messageId].variables?.[swipeId])
      await record('runtime-dispatch', { availability, baseline: { currentSnapshot, priorSnapshot:priorId>=0, usesCurrentFallback:currentSnapshot && priorId<0 } })
      async function initializationRejected(error) {
        const validation = { changes: [], sideEffects: [], failures: [{ message: error }] }
        await record('runtime-initialization-failed', { error })
        return { updated: false, rejected: true, retryable: false, validation,
          diagnostics: [{ kind: 'initialization', level: 'error', initializationFailed: true, message: error }],
          context: await fullContext(current) }
      }
      if (availability?.initializationError) return await initializationRejected(availability.initializationError)
      // MVU is a local capability of the chat. A temporarily absent browser
      // executor is scheduling state, not a failed settlement. Return the
      // prepared transaction immediately so the caller can persist and resume
      // it when the executor registers again.
      if (availability && availability.ready !== true) {
        await record('runtime-deferred', { availability })
        return { updated: false, deferred: true, deferredReason: 'runtime-not-ready', context: await fullContext(current) }
      }
      const dispatched = await options.scriptDispatch.dispatch(sessionId, variableEdit ? 'DSH_VARIABLE_EDIT' : 'MESSAGE_RECEIVED', variableEdit ? [messageId, command] : [messageId], eventContext, { eventId: transaction.eventId, signal: input.signal, ...(lazy ? { contextForBaseline: executionContext } : {}) })
      await record('runtime-completed', { handled: dispatched.handled === true, timedOut: dispatched.timedOut === true, executionLost: dispatched.executionLost === true, claimTimedOut: dispatched.claimTimedOut === true, phase: dispatched.phase, disposed: dispatched.disposed === true, error: dispatched.error, diagnostics: dispatched.diagnostics || [] })
      if (dispatched.handled !== true) {
        if (dispatched.initializationFailed === true) return await initializationRejected(str(dispatched.error))
        if (dispatched.unavailable === true || (input.durable === true && (dispatched.disposed === true || dispatched.timedOut === true || /超时|timed?\s*out|timeout/i.test(str(dispatched.error))))) {
          await record('runtime-deferred', { availability: options.scriptDispatch.status?.(sessionId) })
          return { updated: false, deferred: true, deferredReason: dispatched.claimTimedOut === true ? 'claim-timeout' : 'delivery-interrupted', context: await fullContext(current) }
        }
        if (str(dispatched.error).trim() !== '' && !dispatched.timedOut && !dispatched.disposed
          && !/超时|timed?\s*out|timeout/i.test(str(dispatched.error))) {
          const validation = { changes: [], sideEffects: [], failures: [{ message: str(dispatched.error) }] }
          await record('validation-rejected', { failures: validation.failures, externalEffects: transaction.externalEffects === true })
          return { updated: false, rejected: true, retryable: transaction.externalEffects !== true, retryAfterMs: MVU_RETRY_AFTER_MS,
            validation, diagnostics: dispatched.diagnostics || [], context: await fullContext(current) }
        }
        if (dispatched.timedOut === true) throw new Error('MVU 脚本执行回执超时，本轮结算未确认完成，请重试结算')
        if (dispatched.disposed === true) throw new Error('MVU 浏览器执行器已断开，本轮结算中断，请重试结算')
        throw new Error(str(dispatched.error).trim() || '官方 MVU 浏览器运行时尚未就绪，本轮未执行变量结算')
      }
      const settled = transaction.draft.messages[messageId]
      if (!settled || Math.max(0, Number(settled.swipeId) || 0) !== swipeId) {
        return { updated: false, stale: true, context: await fullContext(current) }
      }
      if (!Array.isArray(settled.swipes)) settled.swipes = [originalText]
      settled.swipes[swipeId] = originalText
      settled.sourceText = originalText
      settled.projectionText = originalText
      settled.text = originalText
      settled.sessionText = originalText
      settled.displayText = originalText
      if (input.preserveForeground === true || variableEdit) {
        for (const key of ['swipes', 'sourceText', 'projectionText', 'text', 'sessionText', 'displayText']) {
          if (Object.hasOwn(message, key)) settled[key] = structuredClone(message[key])
          else delete settled[key]
        }
      }
      const beforeVariables = input.baselineVariables || current.messages[messageId].variables?.[swipeId] || {}
      const afterVariables = transaction.draft.messages[messageId].variables?.[swipeId] || {}
      const editAudit = variableEdit ? auditWidgetVariableResult(input.declarations, baseline.stat_data, afterVariables.stat_data, preparedEdit.expected) : null
      const validation = typeof input.validate === 'function'
        ? await input.validate({ before: beforeVariables, after: afterVariables })
        : null
      if (validation && validation.failures.length > 0) {
        await record('validation-rejected', { failures: validation.failures, externalEffects: transaction.externalEffects === true })
        return {
          updated: false, rejected: true, retryable: transaction.externalEffects !== true, retryAfterMs: MVU_RETRY_AFTER_MS,
          validation, diagnostics: dispatched.diagnostics || [], context: await fullContext(current)
        }
      }
      // The browser event can take time; recheck the target before committing its draft.
      const selected = await options.resolveChatSlice?.(sessionId, [messageId], 'settlement')
      const latest = selected ? { ...selected.chat, messages: Object.assign([], { [messageId]: selected.chat.messages[0] }) } : await resolveChat(sessionId)
      if (!mutationIsCurrent(latest, expectedLifecycleRevision)
        || Number(latest.messages[messageId]?.swipeId || 0) !== swipeId) return { updated:false, stale:true }
      const effect = createMvuSettlementEffect({
        operationId, chatId: current.id, sessionId,
        branchId: input.branchId, basedOnRevision: input.basedOnRevision,
        expectedLifecycleRevision, messageId, swipeId,
        before: current, after: transaction.draft, messageIndices: work.dirty, guardChanges: Boolean(reader?.ensure)
      })
      if (variableEdit) {
        // Only the selected snapshot and MVU-derived mirrors may leave this draft.
        const allowed = new Set(['stat_data', 'schema', 'display_data', 'delta_data'])
        const outside = diffMvuChanges(current, transaction.draft, work.dirty).find(change => change.path[0] !== 'messages' || change.path[1] !== messageId || change.path[2] !== 'variables' || change.path[3] !== swipeId || !allowed.has(change.path[4]))
        if (outside) throw new Error('Variable edit attempted an out-of-scope storage mutation: ' + outside.path.join('/'))
        if (!baselineCurrent(latest)) {
          await record('edit-baseline-conflict', pinnedBaseline === undefined
            ? { expected: input.baselineDigest, actual: widgetVariableDigest(latest.messages[messageId]?.variables?.[swipeId]) }
            : { expectedRevision: pinnedBaseline?.revision, actualRevision: String(latest._storageRevision) })
          return { updated: false, stale: true }
        }
        if (editAudit.status === 'unchanged') return { updated: false, unchanged: true }
      }
      await record('prepared', { mutations: transaction.mutations })
      return {
        ...(editAudit ? { editAudit } : {}),
        updated: true,
        validation,
        diagnostics: dispatched.diagnostics || [],
        mutations: transaction.mutations,
        messageId,
        swipeId,
        effect,
        variables: structuredClone(afterVariables),
        ...(input.compactResult === true ? {} : { context: await fullContext(transaction.draft) })
      }
    } catch (error) {
      await record('runtime-or-persistence-failed', { error: str(error && error.message || error) })
      throw error
    } finally {
      settlementTransactions.delete(sessionId)
    }
  }

  return Object.freeze({
    context,
    dispatchEvent,
    settleMvuUpdate,
    editMvuVariables: input => settleMvuUpdate({ ...input, variableEdit: true, durable: false, preserveForeground: true, compactResult: true, baselineVariables: undefined, validate: undefined }),
    updatePrompts,
    updateVariables,
    updateMessages,
    createMessages,
    getWorldbook,
    replaceWorldbook,
    readFullPromptTemplateState,
    saveFullPromptTemplateState,
    saveFullPromptTemplateSettings,
    readGlobalPromptTemplateSettings,
    saveGlobalPromptTemplateSettings,
    saveFullPromptTemplateGlobals,
    saveExtensionSettings,
    saveChatData,
    loadWorldInfo,
    saveWorldInfo,
    claimWork: function (sessionId, runtimeId, ready, initializationError, baseline) { return options.scriptDispatch.claimWithContext ? options.scriptDispatch.claimWithContext(sessionId, runtimeId, ready, initializationError, baseline) : options.scriptDispatch.claim(sessionId, runtimeId, ready, initializationError) },
    async transactionContext(sessionId, eventId) {
      const transaction=settlementTransactions.get(str(sessionId))
      assertTransactionEvent(transaction,eventId)
      if (!transaction) return context(sessionId)
      if (transaction.work.sequence === 0) return transaction.executionContext({workContextVersion:1,full:true})
      return {...await context(sessionId,transaction.draft),transaction:{eventId:transaction.eventId,sequence:transaction.work.sequence}}
    },
    startWork: function (sessionId, eventId, leaseToken, runtimeId) { return options.scriptDispatch.start(sessionId, eventId, leaseToken, runtimeId) },
    workState: function (sessionId, eventId, leaseToken, runtimeId, keepAlive) { return options.scriptDispatch.workState(sessionId, eventId, leaseToken, runtimeId, keepAlive) },
    heartbeatRuntime: function (sessionId, runtimeId, ready, initializationError) { return { active: options.scriptDispatch.touch(sessionId, runtimeId, ready, initializationError) } },
    completeEvent: function (sessionId, eventId, args, runtimeId, leaseToken, error, diagnostics) { return options.scriptDispatch.complete(sessionId, eventId, args, runtimeId, leaseToken, error, diagnostics) },
    releaseRuntime: function (sessionId, runtimeId) { return options.scriptDispatch.dispose(sessionId, runtimeId) }
  })
}
