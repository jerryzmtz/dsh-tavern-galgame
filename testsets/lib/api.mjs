import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { resolveServiceWebUrl } from '../../bin/service-lifecycle.mjs'

export async function connectGameplay({ runtimeHome, fetcher = fetch }) {
  const root = path.join(runtimeHome, 'logs')
  const record = JSON.parse(await readFile(path.join(root, 'tavern.pid.json'), 'utf8'))
  const log = await readFile(path.join(root, 'tavern.log'))
  const url = await resolveServiceWebUrl({ port: record.port || 3081, record, log, request: fetcher })
  if (!url) throw new Error('正式酒馆未运行，请先启动 dsh-tavern')
  const auth = await fetcher(url, { redirect: 'manual', signal: AbortSignal.timeout(10000) })
  const cookie = auth.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
  await auth.body?.cancel()
  const origin = new URL(url).origin
  async function request(method, args = {}) {
    const response = await fetcher(origin + '/api/dsh-tavern/gameplay.' + method, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie, origin },
      body: JSON.stringify(args), signal: AbortSignal.timeout(120000), redirect: 'error'
    })
    if (!response.ok) throw new Error('正式游戏 API HTTP ' + response.status)
    const result = await response.json()
    if (!result.ok) throw new Error(result.error || '游戏 API 执行失败')
    return result
  }
  const capability = await request('capabilities')
  if (capability.version !== 1) throw new Error('请更新并重启正式酒馆以加载游戏 API')
  const sessions = new Map()
  let current
  async function create(step, model) {
    if (step.card) throw new Error('API 模式直接引用正式人物卡，请用 sourceCard 文件名代替 card 路径')
    const result = await request('create', { sourceCard: step.sourceCard, cardName: step.cardName, mode: step.action === 'card' ? 'card' : 'story', model })
    current = result.sessionId
    sessions.set(current, result.chat?.id || null)
    return result
  }
  const ownerFor = chatId => [...sessions].find(([, id]) => id === chatId)?.[0]
  const evidence = {
    chats: async () => (await Promise.all([...sessions.keys()].map(async sessionId => (await request('state', { sessionId })).chat))).filter(Boolean),
    chat: async chatId => (await request('state', { sessionId: ownerFor(chatId) })).chat,
    requests: async chatId => (await request('requests', { sessionId: ownerFor(chatId) })).requests,
    native: async nativeSessionId => {
      let sessionId = sessions.has(nativeSessionId) ? nativeSessionId : undefined
      if (!sessionId) for (const id of sessions.keys()) {
        if ((await request('requests', { sessionId: id })).requests.some(item => item.sessionId === nativeSessionId)) { sessionId = id; break }
      }
      if (!sessionId) throw new Error('找不到 Agent 所属测试会话')
      return (await request('native', { sessionId, nativeSessionId })).events
    },
    resources: async () => (await request('resources', { sessionId: current })).resources,
    image: chat => request('imageStatus', { sessionId: chat.sessionId })
  }
  return { create, request, evidence, async close() {}, async cancel() {
    const errors = []
    for (const sessionId of sessions.keys()) try { await request('cancel', { sessionId }) } catch (error) { errors.push(error.message) }
    if (errors.length) throw new Error(errors.join('; '))
  }, async imageBytes(args) {
    const response = await fetcher(origin + '/api/dsh-tavern/scene-image?' + new URLSearchParams(args), { headers: { cookie }, signal: AbortSignal.timeout(30000), redirect: 'error' })
    const contentType = response.headers.get('content-type') || ''
    if (!response.ok || !contentType.startsWith('image/')) throw new Error('图片附件不可读取')
    const bytes = Buffer.from(await response.arrayBuffer())
    if (!bytes.length) throw new Error('图片附件为空')
    return { bytes, contentType }
  } }
}
