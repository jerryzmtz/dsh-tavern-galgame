import { applySillyTavernStrictTools } from './sillytavern-strict-tools.js'
import { applyTavernHelperVariableMacros } from './tavern-helper-variable-macros.js'
import { applyTavernRegexText } from './tavern-regex-display.js'
import { compileSillyTavernRequest, createCleanCompatibilityPreset } from './sillytavern-compatibility.js'
import { composeTavernRegexScripts } from './card-extension-reading.js'
import { lastTavernHelperVariables } from './tavern-helper-context.js'
import { resolveRuntimeMacroText } from './runtime-content-projection.js'

export function createCompatibilityTurnCompiler({
  promptTemplateRuntime,
  readCardExtensions,
  readChatCard,
  readPromptTemplateGlobalVariables,
  resolveChatRuntimePreset,
  str,
  worldBooks,
}) {
  function compatibilityWorldBookMatch(entry, source) {
    if (entry.constant === true) return true
    const text = entry.caseSensitive === true ? source : source.toLocaleLowerCase()
    const keys = Array.isArray(entry.primaryKeys) ? entry.primaryKeys : []
    return keys.some(function (value) {
      const key = str(value).trim()
      if (key === '') return false
      const match = /^\/(.*)\/([dgimsuvy]*)$/.exec(key)
      if (match) {
        try { return new RegExp(match[1], match[2].replace(/[gy]/g, '')).test(source) } catch { return false }
      }
      return text.includes(entry.caseSensitive === true ? key : key.toLocaleLowerCase())
    })
  }

  async function compatibilityWorldInfo(chat, card, input) {
    let worldBook = null
    try { worldBook = await worldBooks.bound(chat.cardPath, card, chat) } catch {}
    const entries = Array.isArray(worldBook && worldBook.view && worldBook.view.entries) ? worldBook.view.entries : []
    const scan = (chat.messages || []).map(function (item) { return str(item.sourceText || item.text) }).concat([str(input)]).join('\n')
    function promptTemplateSpecial(entry) {
      const comment = str(entry && entry.comment)
      const content = str(entry && entry.content)
      return comment.startsWith('[InitialVariables]') || /^(?:@@[^\r\n]*\r?\n)*@@initial_variables(?:\s|$)/m.test(content)
    }
    const enabled = entries.filter(function (entry) { return entry && entry.enabled !== false && str(entry.content).trim() !== '' })
    const active = enabled.filter(function (entry) {
      return !promptTemplateSpecial(entry) && compatibilityWorldBookMatch(entry, scan)
    }).sort(function (left, right) {
      return (Number(right.order) || 0) - (Number(left.order) || 0) || (Number(left.displayIndex) || 0) - (Number(right.displayIndex) || 0)
    })
    const before = []
    const after = []
    for (const entry of active) {
      const position = entry.position
      const target = position === 0 || position === '0' || position === 'before_char' || position === 'before' ? before : after
      target.push(str(entry.content).trim())
    }
    return {
      before: before.join('\n\n'),
      after: after.join('\n\n'),
      refs: active.map(function (entry) { return entry.ref }),
      entries: enabled.map(function (entry) {
        return {
          id: str(entry.sourceUid || entry.ref),
          name: str(entry.title),
          comment: str(entry.comment),
          content: str(entry.content),
          enabled: entry.enabled !== false,
          book: str(worldBook && worldBook.view && worldBook.view.displayName)
        }
      })
    }
  }

  async function compileCompatibilityTurn(chat, userText, attachments = []) {
    const snapshot = await resolveChatRuntimePreset(chat)
    const presetPath = str(snapshot && snapshot.presetPath)
    const preset = presetPath === '' ? createCleanCompatibilityPreset() : snapshot.compatibilityPreset
    const presetDocument = presetPath === '' ? {} : snapshot.compatibilityPresetDocument
    if (!preset || preset.valid !== true || preset.recognized !== true || !presetDocument) throw new Error('当前预设不存在或无法读取：' + presetPath)
    const card = await readChatCard(chat)
    const extensions = await readCardExtensions(chat.cardPath, chat)
    const regexScripts = composeTavernRegexScripts(extensions, snapshot?.regexScripts)
    const worldInfo = await compatibilityWorldInfo(chat, card, userText)
    const compiled = compileSillyTavernRequest({
      card,
      preset,
      presetPath,
      presetDocument,
      history: (chat.messages || []).map(function (item) { return { role: item.role, text: str(item.text), sourceText: str(item.sourceText), inputAttachments: item.inputAttachments } }),
      input: userText,
      inputAttachments: attachments,
      userName: str(chat.macroState && chat.macroState.userName),
      macroState: chat.macroState,
      worldInfoBefore: worldInfo.before,
      worldInfoAfter: worldInfo.after,
      resolveMacros: resolveRuntimeMacroText,
      projectPromptText: function (text, context) {
        return applyTavernRegexText(text, regexScripts, {
          placement: context.placement,
          isMarkdown: false,
          isEdit: false,
          depth: context.depth
        })
      }
    })
    compiled.trace.worldBookRefs = worldInfo.refs
    compiled.trace.presetPath = presetPath
    compiled.trace.presetTitle = preset.title
    compiled.trace.presetMode = presetPath === '' ? 'builtin-clean' : 'external'
    compiled.trace.regexCount = regexScripts.length
    const helperMacros = applyTavernHelperVariableMacros(compiled.messages, {
      message: lastTavernHelperVariables(chat.messages),
      chat: chat.variables,
      character: extensions && extensions.variables,
      preset: snapshot && snapshot.variables,
      global: chat.macroState && chat.macroState.global
    })
    compiled.messages = helperMacros.messages
    compiled.trace.tavernHelperVariableMacroCount = helperMacros.replacements
    const promptTemplates = await promptTemplateRuntime(chat.sessionId)
    const transcript = (chat.messages || []).map(function (item) {
      return { role: item.role === 'user' ? 'user' : 'assistant', content: str(item.sourceText || item.text) }
    })
    const templateContext = {
      charName: str(card.name),
      userName: str(chat.macroState && chat.macroState.userName) || '你',
      runType: 'generate',
      transcript,
      worldBookEntries: worldInfo.entries,
      scopes: {
        global: await readPromptTemplateGlobalVariables(),
        initial: chat.promptTemplateInitialVariables,
        local: chat.variables,
        message: lastTavernHelperVariables(chat.messages)
      }
    }
    const initialized = await promptTemplates.initializeVariables(worldInfo.entries, templateContext)
    const templated = await promptTemplates.renderMessages(compiled.messages, Object.assign({}, templateContext, { scopes: initialized.scopes }))
    compiled.messages = templated.messages
    compiled.promptTemplateState = {
      scopes: templated.scopes,
      persist: initialized.evaluated + templated.evaluated > 0
    }
    compiled.diagnostics.push(...initialized.diagnostics, ...templated.diagnostics)
    compiled.trace.promptTemplateEvaluations = initialized.evaluated + templated.evaluated
    compiled.trace.promptTemplateDiagnostics = initialized.diagnostics.length + templated.diagnostics.length
    const sourceMessageCount = compiled.messages.length
    compiled.messages = applySillyTavernStrictTools(compiled.messages, {
      charName: str(card.name),
      userName: str(chat.macroState && chat.macroState.userName)
    })
    if (chat.userProfileEnabled === true) {
      const preferenceText = str(chat.userProfileContextSnapshot)
      if (preferenceText !== '') {
        compiled.messages.unshift({
          role: 'system',
          content: preferenceText,
          source: { kind: 'dsh-user-profile', revision: Number(chat.userProfileRevision) || 0 }
        })
        compiled.trace.userProfileRevision = Number(chat.userProfileRevision) || 0
      }
    }
    compiled.trace.postProcessing = 'strict_tools'
    compiled.trace.sourceMessageCount = sourceMessageCount
    compiled.trace.finalMessageCount = compiled.messages.length
    return compiled
  }
  return compileCompatibilityTurn
}
