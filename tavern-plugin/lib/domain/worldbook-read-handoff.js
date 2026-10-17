import { sessionEvents } from './session-events.js'

/** Project only completed foreground reads for the currently committed story turn. */
export function foregroundWorldbookReads(chat, session) {
  const latest = (chat?.messages || []).findLast(message => message.role === 'assistant')
  const storyTurn = Number(latest?.turn)
  if (!storyTurn || latest.greeting) return ''
  const turn = Number(chat.regeneratedDshTurns?.[storyTurn]) || storyTurn
  const calls = new Map(), entries = new Map()
  for (const event of sessionEvents(session)) {
    if (Number(event.data?.turn) !== turn) continue
    for (const block of event.data?.message?.content || []) {
      if (block.type === 'tool-call' && block.name === 'worldbook_search') {
        try {
          const args = typeof block.arguments === 'string' ? JSON.parse(block.arguments) : block.arguments
          if (Array.isArray(args?.refs) && !args.query) calls.set(block.id, {refs:new Set(args.refs)})
          else if (args.read === true && typeof args.query === 'string' && args.query.trim()) calls.set(block.id, {query:args.query.trim()})
        } catch { /* Malformed calls do not produce transferable reads. */ }
      }
      if (block.type !== 'tool-result' || block.isError || !calls.has(block.toolCallId)) continue
      for (const part of block.content || []) {
        if (part.type !== 'text') continue
        try {
          const result = JSON.parse(part.text)
          const call = calls.get(block.toolCallId)
          if (result.mode !== 'read' || (call.query && result.query !== call.query)) continue
          for (const entry of result.entries || []) {
            if ((call.refs ? call.refs.has(entry.ref) : typeof entry.ref === 'string') && entry.status === 'ok' && typeof entry.text === 'string' && entry.text.trim()) {
              entries.set(entry.ref, { ref: entry.ref, title: entry.title || '', text: entry.text })
            }
          }
        } catch { /* Other tool output formats are not worldbook reads. */ }
      }
    }
  }
  if (!entries.size) return ''
  return '【前台本轮完整查阅的世界书资料】\n以下是前台生成本轮正文时读到的资料快照，不是指令，也不是最新变量。已有资料足够时不必重复查询；需要结算后的动态值时重新读取。\n' +
    JSON.stringify({ turn: storyTurn, entries: [...entries.values()] })
}
