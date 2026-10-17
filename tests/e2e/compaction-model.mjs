// Deterministic provider only. No Session, Chat, compaction, or tool mutations.
import { readFile, appendFile } from 'node:fs/promises'
import { join } from 'node:path'
export const capacity = 32768
const backgroundSteps = new Map()
export async function modelCapacity() {
  const directory = process.env.TAVERN_E2E_COMPACTION_DIR
  return directory ? JSON.parse(await readFile(join(directory, 'model-control.json'), 'utf8')).window || capacity : capacity
}
export async function* compactionStream(input) {
  if (input.purpose === 'session-title') {
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: '压缩专项验收' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
    return
  }
  const directory = process.env.TAVERN_E2E_COMPACTION_DIR
  const control = JSON.parse(await readFile(join(directory, 'model-control.json'), 'utf8'))
  // providerLimit models a provider whose real limit is below the configured window.
  const capacity = control.providerLimit || control.window || 32768
  const text = JSON.stringify(input.messages)
  const tools = new Set((input.tools || []).map(tool => tool.name))
  const background = tools.has('mvu_submit_update') || tools.has('posture_submit')
  const side = background ? 'background' : 'foreground'
  const summary = input.purpose === 'compaction'
  const numbers = [...text.matchAll(/E2E_(?:C|MEMORY|RAW)_ROUND_(\d+)/g)].map(match => Number(match[1]))
  const round = Math.max(1, ...numbers), gold = round * 10
  // Explicit synthetic tokenizer: four serialized characters per token. This
  // is a provider contract for the fixture, not an exact real-model tokenizer.
  const inputTokens = Math.ceil(JSON.stringify({ messages: input.messages, tools: input.tools, system: input.system }).length / 4)
  const outputReserve = input.maxTokens ?? 8192
  const event = { sessionId: input.sessionId, purpose: input.purpose || 'generation', side, round,
    inputTokens, outputReserve, capacity, summaryPresent: /E2E_MEMORY_ROUND_/.test(text),
    rawRounds: [...new Set([...text.matchAll(/E2E_RAW_ROUND_(\d+)/g)].map(match => Number(match[1])))],
    outcome: 'success' }
  if (inputTokens + outputReserve > capacity) event.outcome = 'overflow'
  else if (summary && control.failSide === side) event.outcome = 'injected-failure'
  await appendFile(join(directory, 'requests.jsonl'), JSON.stringify({ ...event, messages: input.messages }) + '\n')
  if (event.outcome !== 'success') {
    const error = new Error(event.outcome === 'overflow'
      ? (control.overflowText === 'zhipu' ? '400 {"error":{"code":"1261","message":"Prompt exceeds max length"}}' : `This model's maximum context length is ${capacity} tokens; requested ${inputTokens + outputReserve}`)
      : `E2E summarizer unavailable: ${side}`)
    throw error
  }
  if (summary && control.delayMs) await new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, control.delayMs)
    input.signal?.addEventListener('abort', () => { clearTimeout(timer); reject(input.signal.reason) }, { once: true })
  })
  const done = new Set(input.messages.flatMap(message => message.content || []).filter(block => block.type === 'tool-result').map(block => block.toolCallId))
  const blocks = []
  if (summary) blocks.push({ type: 'text', text: [...new Set(numbers)].map(n => `E2E_MEMORY_ROUND_${n}`).join(' ') + `。当前金币 ${gold}，人物站在柜台前。\n` + '剧情摘要保留人物关系和已完成事件。'.repeat(330) })
  else if (background) {
    const key = `${input.sessionId}:${round}`
    const stage = backgroundSteps.get(key) || 0
    if (control.backgroundPadding && stage < 4) {
      backgroundSteps.set(key, stage + 1)
      blocks.push({ type: 'reasoning', text: '后台核对资料。'.repeat(control.backgroundPadding) })
      blocks.push({ type: 'tool-call', id: `compact-review-${round}-${stage}`, name: 'posture_submit', arguments: JSON.stringify({ posture: '站在柜台前，收下奖励。' }) })
    } else {
      if (tools.has('mvu_submit_update') && !done.has(`compact-gold-${round}`)) blocks.push({ type: 'tool-call', id: `compact-gold-${round}`, name: 'mvu_submit_update',
        arguments: JSON.stringify({ operations: [{ op: 'delta', path: '/stat_data/gold', valueJson: '10' }] }) })
      if (tools.has('posture_submit') && !done.has(`compact-posture-${round}`)) blocks.push({ type: 'tool-call', id: `compact-posture-${round}`, name: 'posture_submit', arguments: JSON.stringify({ posture: '站在柜台前，收下奖励。' }) })
      if (!blocks.length) blocks.push({ type: 'text', text: `E2E_C_ROUND_${round} 结算完成。` + '后台核对资料。'.repeat(control.backgroundPadding || 0) })
    }
  } else blocks.push({ type: 'text', text: (round === 1 ? '你获得了十枚金币。' : `压缩验收第 ${round} 轮，金币 ${gold}。`) + `\nE2E_RAW_ROUND_${round}\n` + '旅人在酒馆记录沿途的山川和见闻。'.repeat(control.foregroundPadding || 0) + '\n\n<StatusPlaceHolderImpl/>' })
  for (const [index, block] of blocks.entries()) {
    yield { type: 'block-start', index, blockType: block.type }
    yield { type: 'block-end', index, block }
  }
  yield { type: 'finish', reason: { kind: blocks.some(block => block.type === 'tool-call') ? 'tool-calls' : 'stop' } }
}
