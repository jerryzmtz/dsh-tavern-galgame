import { appendFile } from 'node:fs/promises'
import { saveJson, eventsAfterSeq } from './evidence.mjs'

export const cleanError = error => String(error?.message || error).replace(/https?:\/\/[^\s"']+/g, '[URL]')

// Each source is independent: a broken journal must not hide request/subagent evidence.
export async function captureStep({ evidence, chatId, sessionId, prefix, beforeRequestIds = [], afterSeq = 0, resources = false, image = false }) {
  const errors = []
  async function capture(name, read) {
    try { const value = await read(); await saveJson(prefix + '-' + name + '.json', value); return value }
    catch (error) { errors.push({ source: name, error: cleanError(error) }); return null }
  }
  const chat = await capture('chat', () => evidence.chat(chatId))
  const requests = await capture('requests', async () => (await evidence.requests(chatId)).filter(r => !beforeRequestIds.includes(r.id)))
  const nativeBySession = new Map()
  const sessions = new Set((requests || []).map(r => r.sessionId).filter(Boolean))
  const primarySession = chat?.sessionId || sessionId
  if (primarySession) {
    sessions.delete(primarySession)
    nativeBySession.set(primarySession, await capture('native', async () => eventsAfterSeq(await evidence.native(primarySession), afterSeq)))
  }
  for (const id of sessions) nativeBySession.set(id, await capture('subagent-native-' + id.replace(/[^a-zA-Z0-9_-]/g, '_'), () => evidence.native(id)))
  await capture('agents', async () => {
    const outputs = (requests || []).map(request => ({
    requestId: request.id, scope: request.scope, task: request.task, turn: request.turn, agentTurn: request.agentTurn,
    sessionId: request.sessionId, status: request.status, model: { provider: request.request?.provider, model: request.request?.model, reasoningEffort: request.request?.reasoningEffort },
    response: request.response,
    // Background Agents may return only tool calls, with an empty response.text.
    outputEvents: (nativeBySession.get(request.sessionId) || []).filter(event =>
      Number(event.data?.turn) === Number(request.agentTurn) && ['assistant/message', 'tool/call', 'tool/result', 'turn/end'].includes(event.type)),
    }))
    if (primarySession && !outputs.some(output => output.sessionId === primarySession)) {
      const events = nativeBySession.get(primarySession) || []
      const end = events.findLast(event => event.type === 'turn/end')
      outputs.push({ scope: chat?.mode === 'card' ? 'card' : 'foreground', sessionId: primarySession,
        status: end ? (end.data?.reason?.kind === 'completed' ? 'completed' : 'failed') : 'running',
        source: 'native-session', outputEvents: events.filter(event => ['assistant/message', 'tool/call', 'tool/result', 'turn/end'].includes(event.type)) })
    }
    return outputs
  })
  if (resources) await capture('resource-state', () => evidence.resources())
  if (image && chat) await capture('image-state', () => evidence.image(chat))
  await saveJson(prefix + '-capture.json', { capturedAt: new Date().toISOString(), errors })
  return { chat, requests: requests || [], errors }
}

export function backgroundChain(requests, required = true) {
  const background = requests.filter(r => r.scope === 'background' && !/image|scene|illustration/.test(r.task || ''))
  return { required, status: background.length ? (background.every(r => r.status === 'completed') ? 'completed' : 'incomplete') : 'not-invoked',
    requestIds: background.map(r => r.id),
    passed: background.length ? background.every(r => r.status === 'completed') : !required }
}

export async function recordEvent(file, event) {
  await appendFile(file, JSON.stringify({ time: new Date().toISOString(), ...event }) + '\n', { mode: 0o600 })
}
