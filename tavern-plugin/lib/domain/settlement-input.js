import {createScopedMessages} from './scoped-messages.js'
import {scannedStoryRows} from './bounded-history.js'

// This projection is internal and must never be passed to full-Chat writes.
// Settlement reads the pending floor, the helper rows back to the previous
// reply, the latest two story rows and, when the next turn's world-book recall
// is stale, every floor its deepest entry scans. A window holding all of that
// replaces the complete Chat; anything else keeps the complete read.
export async function readSettlementInput(chatId, {readWindow, readChat, scanDepth}) {
  const window = await readWindow(chatId, {limit:200})
  const chat = window?.chat
  const timeline = chat?.timeline
  const rows = chat?.messages
  const target = rows?.findLastIndex(row => row?.role === 'assistant' && row.mvu?.pending === true) ?? -1
  const previous = target > 0 ? rows.slice(0,target).findLastIndex(row => row?.role === 'assistant') : -1
  if (!window || !Number.isSafeInteger(window.revision) || chat._storageRevision !== window.revision
    || chat.backgroundConfigVersion !== 1 || chat.conversationFeaturesVersion !== 1
    || timeline?.schemaVersion !== 1 || !Array.isArray(timeline.checkpoints)
    || Object.values(timeline.operations || {}).some(op => op?.kind === 'body' && op.status === 'foreground-completed')
    || chat.mvu?.enabled !== true || chat.mvu.owner !== 'official'
    || target < 0 || (window.from > 0 && previous < 0)) return readChat(chatId)
  const prepared = chat.preparedWorldBook && Number(chat.preparedWorldBook.revision) === Number(timeline.revision)
  if (!prepared && window.from > 0) {
    // One extra row: the pending reply may be replaced by its latest body.
    const depth = typeof scanDepth === 'function' ? await scanDepth(chat) : Infinity
    if (!Number.isSafeInteger(depth) || !scannedStoryRows(rows, depth + 1)) return readChat(chatId)
  }
  return {...chat, messages:createScopedMessages(window.messageCount,rows.map((row,index)=>[window.from+index,row]))}
}
