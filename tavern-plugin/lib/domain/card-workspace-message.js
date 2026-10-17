import { sessionEvents } from './session-events.js'

/** Append editing context once, after the seed trajectory, outside the user's draft. */
export function ensureCardWorkspaceMessage(session, text) {
  const existing = sessionEvents(session).find(event => event.type === 'user/message' && event.data?.source?.plugin === 'dsh-tavern' && event.data?.source?.workspaceContextVersion === 1)
  if (existing) return existing
  if (typeof text !== 'string' || !text.trim()) throw new Error('卡片工作区说明为空')
  return session.append('user/message', {
    id: 'tavern-card-workspace:' + session.id,
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'plugin', plugin: 'dsh-tavern', form: 'snapshot', workspaceContextVersion: 1 }
  }, { surfaceOp: 'append' })
}
