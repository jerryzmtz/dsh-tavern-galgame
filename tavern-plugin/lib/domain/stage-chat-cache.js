// private fork: read-only stage consumers share immutable journal snapshots, never editable drafts.
import {freezeJson} from './freeze-json.js'
import {projectTavernHelperContext} from './tavern-helper-context.js'

export function createStageChatCache({readHeader, readChat, readChanges, maxEntries = 4, maxBytes = 64 * 1024 * 1024, projectHelper = projectTavernHelperContext}) {
  const cache = new Map(), pending = new Map()
  let bytes = 0
  const measure = value => JSON.stringify(value).length * 2
  async function load(sessionId, header, previous) {
    let chat, sizes, helper
    if (previous && previous.chat.sessionId === header.sessionId && previous.chat._storageRevision < header._storageRevision) {
      const changed = await readChanges(header.id, previous.chat._storageRevision)
      if (changed?.baseRevision === previous.chat._storageRevision && changed.chat?._storageRevision === header._storageRevision
        && changed.denseMessages && Array.isArray(changed.indices) && changed.indices.length === changed.chat.messages.length) {
        const messages = previous.chat.messages.slice(0, changed.messageCount)
        sizes = previous.sizes.slice(0, changed.messageCount)
        changed.indices.forEach((id, ordinal) => { messages[id] = changed.chat.messages[ordinal]; sizes[id] = measure(messages[id]) })
        chat = {...changed.chat, messages}
        // Only an unchanged prefix can retain its Helper projection. Edits and
        // truncation rebuild; pending template input never enters this base.
        if (changed.messageCount >= previous.chat.messages.length
          && (chat.tavernHelperLifecycleRevision || 0) === (previous.chat.tavernHelperLifecycleRevision || 0)
          && changed.indices.every(id => id >= previous.chat.messages.length)) helper = previous.helper
      }
    }
    chat ||= await readChat(sessionId)
    if (!chat) return chat
    sizes ||= chat.messages.map(measure)
    const {messages, ...head} = chat
    const size = measure(head) + sizes.reduce((total, size) => total + size, 0) + (helper?.size || 0)
    chat = freezeJson(chat)
    if (Number.isSafeInteger(chat._storageRevision) && size <= maxBytes && maxEntries > 0 && !(cache.get(chat.id)?.chat._storageRevision > chat._storageRevision)) {
      if (cache.has(chat.id)) {bytes -= cache.get(chat.id).size; cache.delete(chat.id)}
      while (cache.size && (bytes + size > maxBytes || cache.size >= maxEntries)) {
        const id = cache.keys().next().value; bytes -= cache.get(id).size; cache.delete(id)
      }
      cache.set(chat.id,{chat,sizes,size,helper}); bytes += size
    }
    return chat
  }
  const read = async sessionId => {
    const header = await readHeader(sessionId)
    if (!header) return undefined
    const previous = cache.get(header.id), revision = header._storageRevision
    if (Number.isSafeInteger(revision) && previous?.chat._storageRevision === revision && previous.chat.sessionId === header.sessionId) return previous.chat
    if (!Number.isSafeInteger(revision)) return load(sessionId,header)
    const key = JSON.stringify([header.id,header.sessionId,revision])
    let loading = pending.get(key)
    if (!loading) {loading = load(sessionId,header,previous); pending.set(key,loading)}
    try {return await loading} finally {if (pending.get(key) === loading) pending.delete(key)}
  }
  read.template = async sessionId => {
    const chat = await read(sessionId)
    if (!chat) return undefined
    const entry = cache.get(chat.id), previous = entry?.chat === chat ? entry.helper : null
    if (previous?.revision === chat._storageRevision) return {chat, helper:previous.context}
    const context = projectHelper(chat, {
      indexed:true, previousContext:previous?.context, previousMessages:previous?.context.messages,
      dirtyIndices:previous ? new Set() : null, layoutFrom:previous?.context.messages.length,
      layoutChanged:previous?.context.messages.length !== chat.messages.length,
    })
    if (entry?.chat === chat) {
      const {messages, ...header} = context
      const sizes = messages.map((row, id) => row === previous?.context.messages[id] ? previous.sizes[id] : measure(row))
      const size = measure(header) + sizes.reduce((sum, value) => sum + value, 0)
      bytes -= entry.helper?.size || 0; entry.size -= entry.helper?.size || 0
      entry.helper = {context, sizes, size, revision:chat._storageRevision}
      bytes += size; entry.size += size
      while (cache.size && bytes > maxBytes) {
        const id = cache.keys().next().value; bytes -= cache.get(id).size; cache.delete(id)
      }
    }
    return {chat, helper:context}
  }
  return read
}
