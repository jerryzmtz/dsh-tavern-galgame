// private fork: tagged English defaults; retain protocol, payload, cache and budget assertions.
import assert from 'node:assert/strict'
import test from 'node:test'

import { createCandidateGenerator } from '../tavern-plugin/lib/domain/candidate-generation.js'
import { createScriptContinuity } from '../tavern-plugin/lib/domain/script-continuity.js'
import { createStoryTimeline } from '../tavern-plugin/lib/domain/story-timeline.js'
import { createBackgroundTaskCoordinator } from '../tavern-plugin/lib/domain/background-task-coordinator.js'
import { prompt } from '../tavern-plugin/lib/prompt-catalog.js'

const storyChoices = [
  { type: 'action', text: '走到窗边仔细观察街上的动静' },
  { type: 'action', text: '压低声音询问阿芙拉钟楼的线索' },
  { type: 'action', text: '检查桌上残留的泥水和脚印痕迹' },
  { type: 'action', text: '推开后门沿着雨中的马蹄印追踪' },
  { type: 'scene', text: '场景切换到午夜钟楼下的狭窄石巷' }
]

function script() {
  return {
    title: '银铃', importedAt: 1,
    chunks: [
      { id: 'chunk-00001', order: 0, text: '旅店相遇。' },
      { id: 'chunk-00002', order: 1, text: '雨夜追踪。' },
      { id: 'chunk-00003', order: 2, text: '钟楼对峙。' }
    ]
  }
}

function harness({ mode = 'story', taskProjection = false, outputs, initialCandidates, initialCandidateAgent, initialSettleStatus, messages, initialScriptCursor = 0, initialScriptEnded = false, scriptData, cardData, macroState, waitUntilSettled, writeChatHook, modelSelection, planHook, worldBookContext }) {
  const continuity = createScriptContinuity()
  const activeScript = scriptData || script()
  let scriptState = mode === 'script' ? continuity.start(activeScript, initialScriptCursor) : null
  if (initialScriptEnded) scriptState = continuity.transition({ script: activeScript, state: scriptState, event: { kind: 'end' } }).state
  let chat = {
    id: 'chat-1', cardId: 'card-1', mode, messages: messages || [{ role: 'assistant', text: '雨水敲着窗。' }],
    scriptState,
    settleStatus: initialSettleStatus || 'idle',
    macroState: macroState || { userName: 'User', local: {}, global: {} }
  }
  if (initialCandidates !== undefined) chat.candidates = structuredClone(initialCandidates)
  if (initialCandidateAgent !== undefined) chat.candidateAgent = structuredClone(initialCandidateAgent)
  const card = cardData || { id: 'card-1', name: '阿芙拉', description: '银发佣兵', tags: [] }
  let modelCalls = 0
  const modelRequests = []
  function remember(options) {
    modelRequests.push({
      preparedWorldbook: options.preparedWorldbook,
      system: options.system,
      backgroundContext: options.backgroundContext,
      systemPromptText: options.systemPromptText,
      postHistoryText: options.postHistoryText,
      turnContext: options.turnContext,
      messages: structuredClone(options.messages),
      tools: structuredClone(options.tools || []),
      maxTokens: options.maxTokens,
      persistent: options.persistent,
      persistentSessionId: options.persistentSessionId,
      rewindTo: Number.isSafeInteger(options.rewindTo) ? options.rewindTo : null,
      webSearchEnabled: options.webSearchEnabled === true
    })
  }
  async function nextOutput(options) {
    remember(options)
    const call = ++modelCalls
    const output = outputs[Math.min(call - 1, outputs.length - 1)]
    const text = typeof output === 'function' ? await output(options) : output
    try {
      const parsed = JSON.parse(text)
      if (Array.isArray(parsed.choices)) {
        await options.onToolCall({
          name: 'candidate_submit_choices',
          arguments: {
            actions: parsed.choices.filter(item => item && item.type === 'action').map(item => item.text),
            scene: parsed.choices.find(item => item && item.type === 'scene')?.text || ''
          }
        })
      }
    } catch (_error) {}
    return { text, traceSessionId: options.persistentSessionId || 'candidate-trace-' + call }
  }
  const store = {
    async chatForSession() { return structuredClone(chat) },
    async readChat() { return structuredClone(chat) },
    async readCard(_path, snapshot) { assert.equal(snapshot.id, chat.id, 'candidate preparation reuses the current chat resource snapshot'); return structuredClone(card) },
    async readScript() { return mode === 'script' ? structuredClone(activeScript) : undefined },
    async writeChat(next) {
      if (typeof writeChatHook === 'function') await writeChatHook(next, chat)
      chat = structuredClone(next)
    },
    async updateChat(_id, update) {
      const next = await update(structuredClone(chat))
      if (next !== undefined) {
        if (typeof writeChatHook === 'function') await writeChatHook(next, chat)
        chat = structuredClone(next)
      }
      return structuredClone(chat)
    }
  }
  const model = {
    selection(selectedChat) { return modelSelection ? modelSelection(selectedChat) : { provider: 'test', model: 'scripted' } },
    async runCandidate(options) { return await nextOutput(options) }
  }
  const plannerCalls = []
  const warnings = []
  const planner = {
    async plan(input) {
      plannerCalls.push(input)
      await planHook?.()
      return { text: '候选项上下文', stableText: '稳定候选上下文', taskText: '候选格式规则', systemPromptText: '本轮系统提示', postHistoryText: '本轮历史后指令', dynamicText: '本轮游标、Guide 与姿势', audit: { included: [], omitted: [], warnings: [], totalChars: 7 } }
    }
  }
  const timeline = createStoryTimeline({ id: (prefix) => prefix + '-' + Math.random().toString(36).slice(2), now: () => 123456 })
  const coordinator = createBackgroundTaskCoordinator({store,timeline})
  const tasks = taskProjection ? {...coordinator, async begin(...args) {
    const task = await coordinator.begin(...args)
    return {...task,chat:{...task.chat,messages:[],macroState:{userName:'你'}}}
  }} : coordinator
  const candidates = createCandidateGenerator({
    store, model, planner, prompt, scripts: continuity, worldBookContext, tasks,
    characterDesign: { async execute() { return JSON.stringify({ ok: true }) } },
    async stableWorldBookContext(currentChat, currentCard) {
      assert.equal(currentChat.id, chat.id)
      assert.equal(currentCard.name, card.name)
      return '常驻世界设定'
    },
    timeline,
    waitUntilSettled: waitUntilSettled || (async () => {}), sleep: async () => {}, now: () => 123456,
    logger: { error() {}, warn(message) { warnings.push(String(message)) } }
  })
  return {
    candidates, continuity, plannerCalls, modelRequests, warnings, modelCalls: () => modelCalls,
    chat: () => structuredClone(chat),
    setMessages(next) {
      chat.messages = structuredClone(next)
      if (chat.timeline) chat.timeline.revision++
    },
    mutateChat(change) { change(chat) }
  }
}

test('模型成功但 chat 提交失败时明确报告候选已经生成但保存失败', async () => {
  const run = harness({
    outputs: [JSON.stringify({ choices: storyChoices })],
    async writeChatHook(next) {
      if (next.candidates && next.candidates.messageId === 'message-save-failure') {
        const error = new Error('模拟 chat 文件写入失败')
        error.code = 'EIO'
        throw error
      }
    }
  })

  await assert.rejects(
    () => run.candidates.generate({ sessionId: 'session-1', messageId: 'message-save-failure' }),
    function (error) {
      return error && error.stage === 'committing' && /候选已经生成，但保存失败/.test(error.message)
    }
  )
  assert.equal(run.modelCalls(), 1)
  assert.equal(run.chat().candidates, undefined)
})

test('自由故事只保存完整的 4 action + 1 scene', async () => {
  const run = harness({ outputs: [async function (options) {
    await options.onToolCall({
      name: 'candidate_submit_choices',
      arguments: { actions: storyChoices.slice(0, 4).map(item => item.text), scene: storyChoices[4].text }
    })
    return '<|DSML|tool_calls>不应被当作候选结果的普通文字'
  }] })
  let started = null

  const result = await run.candidates.generate({ sessionId: 'session-1', messageId: 'message-1', guidance: '多写动作', onStarted(operation) { started = operation } })
  assert.match(started.operationId, /^operation-/)
  assert.equal(started.basedOn.revision, 0)
  assert.deepEqual(result.basedOn, started.basedOn, 'durable task result must already match the committed candidate record')
  assert.equal(run.modelCalls(), 1)
  assert.equal(result.choices.length, 5)
  assert.equal(result.choices.filter((item) => item.type === 'action').length, 4)
  assert.equal(result.choices.filter((item) => item.type === 'scene').length, 1)
  assert.equal(result.traceSessionId, 'candidate-trace-1')
  assert.equal(result.traceMode, 'continuable')
  assert.equal(run.modelRequests[0].persistent, true)
  assert.equal(run.modelRequests[0].maxTokens, undefined)
  assert.equal(run.plannerCalls[0].purpose, 'candidate')
  assert.match(run.plannerCalls[0].task, /You generate plot choices/)

  const saved = await run.candidates.find({ sessionId: 'session-1', messageId: 'message-1' })
  assert.deepEqual(saved, result)
  assert.equal(await run.candidates.find({ sessionId: 'session-1', messageId: 'old-message' }), null)
})

test('候选生成期间时间线变化，迟到候选与 point 都不会落盘', async () => {
  let run
  run = harness({ mode: 'script', outputs: [async function (options) {
    await options.onToolCall({ name: 'tavern_point_script', arguments: { position: 3 } })
    run.mutateChat(function (chat) { chat.timeline.revision++ })
    return JSON.stringify({ choices: [{ type: 'action', text: '这是已经过期的候选' }] })
  }] })

  await assert.rejects(
    () => run.candidates.generate({ sessionId: 'session-1', messageId: 'stale-candidate' }),
    /剧情状态已变化/
  )
  assert.equal(run.chat().candidates, undefined)
  assert.equal(run.continuity.inspect({ script: script(), state: run.chat().scriptState, request: { kind: 'progress' } }).cursor, 0)
})

test('单次输出无效时不覆盖旧候选，也不改变剧本游标', async () => {
  const invalid = '{"choices":[{"type":"unknown","text":"有文本但类型无效"}]}'
  const oldCandidates = { messageId: 'old', choices: [{ type: 'action', text: '保留这一份旧的有效候选内容' }], generatedAt: 1 }
  const stageThenFail = async function (options) {
    await options.onToolCall({ name: 'tavern_read_script', arguments: { position: 2 } })
    return invalid
  }
  const run = harness({ mode: 'script', outputs: [stageThenFail], initialCandidates: oldCandidates })

  await assert.rejects(() => run.candidates.generate({ sessionId: 'session-1', messageId: 'message-3' }), /有效候选项/)
  assert.equal(run.modelCalls(), 1)
  const after = run.chat()
  assert.deepEqual(after.candidates, oldCandidates)
  assert.equal(run.continuity.inspect({ script: script(), state: after.scriptState, request: { kind: 'progress' } }).cursor, 0)
})

test('a synced background session still receives the latest story, renamed player and bedtime after twenty turns', async () => {
  const messages = Array.from({length:20}, (_, i) => ({role:'assistant',turn:i + 1,text:i === 19 ? '阿舟在午夜向大肥鱼道晚安，她已经在卧室睡着。' : '阿舟继续处理当天的事情，第' + (i + 1) + '轮。'}))
  const run = harness({messages, taskProjection:true, macroState:{userName:'阿舟'}, outputs:[JSON.stringify({choices:storyChoices})]})
  await run.candidates.generate({sessionId:'session-1',messageId:'turn20'})
  // The second task shares both the persistent participant and its synced revision.
  await run.candidates.generate({sessionId:'session-1',messageId:'turn20-again'})
  const request = run.modelRequests[1]
  assert.equal(request.persistentSessionId, 'candidate-trace-1')
  const bodies = request.messages.filter(message => message.role === 'assistant')
  assert.equal(bodies.length, 6)
  assert.equal(bodies.at(-1).content[0].text, messages.at(-1).text)
  assert.match(request.messages.at(-1).content[0].text, /latest story turn 20/)
  assert.match(request.messages.at(-1).content[0].text, /Player.s name in this session: 阿舟/)
  const taskText = request.messages.at(-1).content[0].text
  console.log('B3 candidate prompt bytes', JSON.stringify({before:{recentBodyBytes:2,taskBytes:Buffer.byteLength(taskText.split('\n\n【候选时间点】')[0])},after:{recentBodyBytes:Buffer.byteLength(JSON.stringify(bodies)),taskBytes:Buffer.byteLength(taskText)},toolSchemaBytes:Buffer.byteLength(JSON.stringify(request.tools))}))
})

test('first candidate interrupted before a result keeps its bound session for retry', async () => {
  const run = harness({ outputs: [async input => {
    await input.onPersistentSessionReady('background-bound-before-result');
    throw new Error('interrupted');
  }, JSON.stringify({ choices: storyChoices })] });
  await assert.rejects(run.candidates.generate({ sessionId: 'session-1', messageId: 'first' }));
  await run.candidates.generate({ sessionId: 'session-1', messageId: 'first' });
  assert.equal(run.modelRequests[1].persistentSessionId, 'background-bound-before-result');
});
