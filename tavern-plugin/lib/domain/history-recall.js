import { createHash } from 'node:crypto'

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function clampInteger(value, fallback, minimum, maximum) {
  const number = Number(value)
  if (!Number.isInteger(number)) return fallback
  return Math.max(minimum, Math.min(maximum, number))
}

function searchable(value) {
  return str(value).toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '')
}

function termsOf(query) {
  return Array.from(new Set(str(query).toLocaleLowerCase().match(/[\p{L}\p{N}_]+/gu) || []))
}

function excerpt(text, terms, maximum = 240) {
  const source = str(text).replace(/\s+/g, ' ').trim()
  if (source.length <= maximum) return source
  const lower = source.toLocaleLowerCase()
  let found = -1
  for (const term of terms) {
    const index = lower.indexOf(term)
    if (index >= 0 && (found < 0 || index < found)) found = index
  }
  const start = Math.max(0, (found < 0 ? 0 : found) - Math.floor(maximum / 3))
  const end = Math.min(source.length, start + maximum)
  return (start > 0 ? '…' : '') + source.slice(start, end) + (end < source.length ? '…' : '')
}

function committedRounds(chat) {
  const rounds = []
  let pendingUsers = []
  let inferredTurn = 1
  for (const message of Array.isArray(chat && chat.messages) ? chat.messages : []) {
    if (message === null || typeof message !== 'object') continue
    if (message.role === 'user') {
      const text = str(message.text).trim()
      if (text !== '') pendingUsers.push({ role: 'user', text })
      inferredTurn++
      continue
    }
    if (message.role !== 'assistant') continue
    const text = str(message.text).trim()
    if (text === '') continue
    const turn = Math.max(1, Number(message.turn) || (message.greeting === true ? 1 : inferredTurn))
    rounds.push({
      turn,
      messages: pendingUsers.concat([{ role: 'assistant', text }])
    })
    pendingUsers = []
  }
  return rounds
}

function scoreRound(round, query, terms) {
  const text = round.messages.map(function (message) { return message.text }).join('\n')
  const normalized = searchable(text)
  const full = searchable(query)
  let score = full !== '' && normalized.includes(full) ? 1000 : 0
  let matched = 0
  for (const term of terms) {
    if (normalized.includes(searchable(term))) matched++
  }
  if (matched === 0 && score === 0) return null
  score += matched * 100 + Math.round(matched / Math.max(1, terms.length) * 10)
  return { score, text }
}

export const HISTORY_RECALL_TOOL = Object.freeze({
  name: 'tavern_recall_history',
  description: '检索或读取当前对话已经正式发生的历史正文，仅用于回忆细节和剧情。query 与 turn 必须且只能提供一个。每次生成最多召回 6 次；完整正文召回后冷却 10 个剧情轮次，冷却期间不可重复读取。已有信息足够时直接继续任务，不要重复读取同一轮。检索结果不是当前场景，不得重复演绎、照搬旧台词或让已经发生的事件再次发生。',
  parameters: Object.freeze({
    type: 'object',
    additionalProperties: false,
    properties: {
      query: { type: 'string', minLength: 1, description: '要回忆的人物、地点、物品、承诺或事件关键词；多个关键词用空格分隔。' },
      turn: { type: 'integer', minimum: 1, description: '读取指定剧情轮次及其附近原文。' },
      radius: { type: 'integer', minimum: 0, maximum: 3, description: '按轮读取时包含前后多少轮，默认 1。' },
      limit: { type: 'integer', minimum: 1, maximum: 8, description: '关键词检索最多返回多少条命中，默认 5。' }
    }
  })
})

export const HISTORY_RECALL_OUTPUT_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  properties: {
    notice: { type: 'string', required: true },
    found: { type: 'boolean', required: true },
    chatId: { type: 'string', required: true },
    revision: { type: 'integer', required: true },
    mode: { type: 'string', required: true },
    query: { type: 'string', required: true },
    requestedTurn: { type: 'integer', required: true },
    matches: {
      type: 'array', required: true,
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          turn: { type: 'integer', required: true },
          excerpt: { type: 'string', required: true }
        }
      }
    },
    rounds: {
      type: 'array', required: true,
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          turn: { type: 'integer', required: true },
          messages: {
            type: 'array', required: true,
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                role: { type: 'string', required: true },
                text: { type: 'string', required: true }
              }
            }
          }
        }
      }
    }
  }
})

export function createHistoryRecall() {
  const scopes = new WeakMap()
  function stateFor(scope) {
    if (!scope || typeof scope !== 'object') return null
    if (!scopes.has(scope)) scopes.set(scope, { calls: 0, rounds: new Set(), searches: new Set() })
    return scopes.get(scope)
  }
  function recall(input = {}) {
    const chat = input.chat
    if (chat === null || typeof chat !== 'object') throw new Error('历史正文检索缺少 Tavern Chat')
    const query = str(input.query).trim()
    const hasQuery = query !== ''
    const hasTurn = input.turn !== undefined && input.turn !== null
    if (Number(hasQuery) + Number(hasTurn) !== 1) throw new Error('历史正文检索必须且只能提供 query 或 turn')
    const rounds = committedRounds(chat)
    const currentTurn = rounds.reduce((maximum, round) => Math.max(maximum, round.turn), 0)
    const branch = str(chat.timeline?.branchId)
    const signature = round => createHash('sha256').update(JSON.stringify(round.messages)).digest('hex')
    const audience = input.audience === 'background' ? 'background' : 'foreground'
    const cooldowns = input.trackCooldown && Array.isArray(chat.historyRecallCooldowns)
      ? chat.historyRecallCooldowns.filter(item => item && (item.audience === 'foreground' || item.audience === 'background') && item.branch === branch && currentTurn >= item.at && currentTurn - item.at <= 10)
      : []
    const cooling = round => cooldowns.some(item => item.audience === audience && item.turn === round.turn && item.hash === signature(round))
    const base = {
      notice: '',
      found: false,
      chatId: str(chat.id),
      revision: Math.max(0, Number(chat._storageRevision) || 0),
      mode: hasQuery ? 'search' : 'read',
      query: hasQuery ? query : '',
      requestedTurn: hasTurn ? Number(input.turn) : 0,
      matches: [],
      rounds: []
    }
    const state = stateFor(input.scope)
    if (state && state.calls++ >= 6) {
      return Object.assign(base, { notice: '本次生成的历史召回预算已用尽。请使用已经返回的资料继续当前任务，不要再调用历史召回。' })
    }
    if (hasQuery) {
      const terms = termsOf(query)
      if (terms.length === 0) throw new Error('历史正文检索关键词不能为空')
      const searchKey = JSON.stringify([str(chat.id), [...terms].sort(), clampInteger(input.limit, 5, 1, 8)])
      if (state?.searches.has(searchKey)) return Object.assign(base, { notice: '相同关键词已检索，请使用之前的结果；仅在缺少必要细节时读取对应轮次。' })
      state?.searches.add(searchKey)
      const limit = clampInteger(input.limit, 5, 1, 8)
      const matches = rounds.filter(round => !cooling(round)).map(function (round) {
        const scored = scoreRound(round, query, terms)
        if (scored === null) return null
        return { turn: round.turn, score: scored.score, excerpt: excerpt(scored.text, terms) }
      }).filter(Boolean).sort(function (left, right) {
        return right.score - left.score || right.turn - left.turn
      }).slice(0, limit).map(function (match) {
        return { turn: match.turn, excerpt: match.excerpt }
      })
      return Object.assign(base, { found: matches.length > 0, matches, notice: cooldowns.some(item => item.audience === audience) ? '已召回的完整正文处于 10 轮冷却期，检索已跳过这些轮次。' : '' })
    }
    const requested = Number(input.turn)
    if (!Number.isInteger(requested) || requested < 1) throw new Error('历史正文轮次必须是大于 0 的整数')
    const radius = clampInteger(input.radius, 1, 0, 3)
    const selected = rounds.filter(function (round) { return Math.abs(round.turn - requested) <= radius })
    const cooled = selected.filter(cooling)
    const fresh = selected.filter(round => {
      if (cooling(round)) return false
      const key = JSON.stringify([str(chat.id), round.turn, round.messages])
      if (state?.rounds.has(key)) return false
      state?.rounds.add(key)
      return true
    })
    if (input.trackCooldown && fresh.length) {
      chat.historyRecallCooldowns = cooldowns.filter(item => item.audience !== audience || !fresh.some(round => round.turn === item.turn))
        .concat(fresh.map(round => ({ turn: round.turn, hash: signature(round), at: currentTurn, branch, audience })))
    }
    return Object.assign(base, {
      found: selected.some(round => round.turn === requested), rounds: fresh,
      notice: cooled.length ? '第 ' + cooled.map(round => round.turn).join('、') + ' 轮已召回，处于 10 轮冷却期；请使用已有资料继续任务。' : fresh.length < selected.length ? '重叠轮次已读取，本次只补充未返回的正文。请使用之前的资料，不要重复召回。' : ''
    })
  }

  return Object.freeze({ recall })
}

export function renderHistoryRecall(value) {
  let warning = '【历史回忆资料】\n以下是已经发生的历史，只用于确认和回忆；不得当作当前场景继续输出，不得重复演绎。'
  if (value?.notice) warning += '\n\n' + value.notice
  if (value?.notice && !value.rounds?.length && !value.matches?.length) return warning
  if (!value || value.found !== true) return warning + '\n\n没有找到相关历史正文。'
  if (value.mode === 'search') {
    return warning + '\n\n' + value.matches.map(function (match) {
      return '[第 ' + match.turn + ' 轮]\n' + match.excerpt
    }).join('\n\n') + '\n\n仅在摘要不足以回答当前问题时，用 turn 读取所需轮次；信息足够就继续当前任务。'
  }
  return warning + '\n\n' + value.rounds.map(function (round) {
    return '【第 ' + round.turn + ' 轮】\n' + round.messages.map(function (message) {
      return (message.role === 'user' ? '[玩家]' : '[正文]') + '\n' + message.text
    }).join('\n\n')
  }).join('\n\n')
}
