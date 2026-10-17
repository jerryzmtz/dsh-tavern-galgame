// The timeline owns the current binding. A historical candidate pointer must
// not override an explicitly empty/rebuilding timeline participant.
export function currentBackgroundSessionId(chat) {
  const participant = chat?.timeline?.participants?.background
  if (participant) return participant.status === 'needs-session' ? '' : String(participant.sessionId || '')
  if (chat?.candidateAgent) return String(chat.candidateAgent.sessionId || '')
  if (Array.isArray(chat?.messages) || chat?.timeline) return ''
  return typeof chat?.backgroundSessionId === 'string' ? chat.backgroundSessionId : null
}

export function referencedBackgroundSessionIds(chat) {
  const ids = new Set()
  const add = value => { if (typeof value === 'string' && value) ids.add(value) }
  add(chat?.candidateAgent?.sessionId)
  for (const checkpoint of chat?.timeline?.checkpoints || []) add(checkpoint.participants?.background?.sessionId)
  for (const operation of Object.values(chat?.timeline?.operations || {})) {
    add(operation.beforeParticipants?.background?.sessionId)
    if (operation.kind === 'agent' && ['settlement', 'candidate', 'worldbook-filter'].includes(operation.role) && !['running', 'pending'].includes(operation.status)) add(operation.startedSessionId)
  }
  return [...ids]
}
