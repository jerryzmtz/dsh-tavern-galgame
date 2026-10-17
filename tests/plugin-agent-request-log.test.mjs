import assert from 'node:assert/strict'
import test from 'node:test'

import { createModelRequestLog } from '../tavern-plugin/lib/domain/model-request-log.js'
import { registerModelStreamHooks } from '../tavern-plugin/lib/hooks/model-stream.js'

function memoryLog() {
  const files = new Map()
  let stamp = 1000
  return createModelRequestLog({
    readJson: async path => { const value = files.get(path); return typeof value === 'string' ? JSON.parse(value) : structuredClone(value) },
    writeJson: async (path, value) => { files.set(path, structuredClone(value)) },
    updateJson: async (path, updater) => { files.set(path, structuredClone(await updater(structuredClone(files.get(path))))) },
    writeText: async (path, text) => { files.set(path, text) },
    remove: async path => { files.delete(path) },
    now: () => ++stamp, id: () => 'r' + stamp
  })
}

function install(log, headers, pluginSettlementProgress) {
  let stream
  const game = { id: 'chat-game', mode: 'story', requestMode: 'dsh' }
  const ctx = { on(name, fn) { if (name === 'llm/stream') stream = fn }, llm: {}, get() {}, logger: () => ({ warn() {} }) }
  registerModelStreamHooks({
    ctx, agentRegistry: { get: () => undefined },
    sessionStore: { get: id => headers[id] && { id, header: headers[id] }, flush() {} },
    backgroundAgentRunner: { owns: () => false, requestContext: () => undefined },
    chatForSession: async () => undefined,
    chatHeaderForSession: async id => id === 'session-game' ? game : undefined,
    foregroundStrategies: { projectRequest: () => null, completeRequest() {} },
    fullTemplateRuntime: {}, modelRequestLog: log, pluginSettlementProgress, requestCoordinates: new Map(), str: value => typeof value === 'string' ? value : '',
    sessionStateForSession: async () => null, updateChat: async () => {}, worldbookRecallLog: {}, runtimePrompt: () => '', storyRetention: async () => ({})
  })
  return async (sessionId, source = async function * () { yield { type: 'text-delta', text: '好' }; yield { type: 'finish', reason: { kind: 'stop' } } }, signal) => {
    const chunks = []
    for await (const chunk of stream({ sessionId, signal, messages: [{ role: 'user', content: [{ type: 'text', text: '结算' }] }] }, source)) chunks.push(chunk)
    return chunks
  }
}

test('a plugin agent created under a game is logged as that game\'s background request', async () => {
  const log = memoryLog()
  await log.record({ chat: { id: 'chat-game' }, coordinates: { turn: 7 }, options: { sessionId: 'session-game', messages: [] } })
  const events = []
  const send = install(log, { 'na-session-game': { parentSession: 'session-game' }, 'stray': { parentSession: 'elsewhere' } }, { model: (game, event) => events.push(game + ':' + event) })
  assert.equal((await send('na-session-game')).length, 2, 'the response still streams through')
  assert.deepEqual(events, ['session-game:start', 'session-game:output', 'session-game:end'], 'the game\'s plugin settlement progress follows its agent')
  await send('stray')
  const found = await log.latestForSession('na-session-game')
  assert.equal(found.scope, 'background')
  assert.equal(found.task, 'subagent')
  assert.equal(found.turn, 7, 'filed under the game\'s latest turn')
  assert.equal(found.request.messages[0].content[0].text, '结算')
  assert.equal(await log.latestForSession('stray'), null, 'agents outside a game are not logged')
})

test('stopped, truncated and stalled model streams are interrupted and release the next request without retry', async t => {
  t.mock.timers.enable({apis:['setTimeout','Date']})
  const log = memoryLog(), events = []
  const send = install(log, {'child':{parentSession:'session-game'}}, {model:(_id,event) => events.push(event)})
  for (const kind of ['truncated','stopped','stalled']) {
    const controller = new AbortController()
    let ready
    const arrived = new Promise(resolve => {ready = resolve})
    const pending = send('child', async function * () {
      yield {type:'text-delta',text:'Partial body'}
      ready()
      if (kind === 'stopped') controller.abort()
      if (kind !== 'truncated') await new Promise(() => {})
    }, controller.signal)
    const rejected = assert.rejects(pending, /中断|停止|没有有效输出/)
    await arrived
    if (kind === 'stalled') t.mock.timers.tick(90001)
    await rejected
    const record = await log.latestForSession('child')
    assert.equal(record.status,'interrupted',kind)
    assert.ok(record.response.error,kind)
    assert.equal(record.response.text,'Partial body')
    assert.equal(record.timing.phase,'provider')
    assert.equal(events.at(-1),'end','settlement progress is released')
  }
  await send('child')
  assert.equal((await log.latestForSession('child')).status,'completed')
  assert.equal((await log.list('chat-game')).length,4,'no automatic model retry')
})

test('throwing iterator cleanup cannot replace the transport error or skip its log receipt', async () => {
  const log = memoryLog()
  const send = install(log, {'child':{parentSession:'session-game'}}, {model() {}})
  await assert.rejects(send('child', () => ({[Symbol.asyncIterator]() {return {
    next() {throw new Error('Connection reset')},
    return() {throw new Error('Cleanup failed')}
  }}})), /Connection reset/)
  const record = await log.latestForSession('child')
  assert.equal(record.status, 'failed')
  assert.equal(record.response.error, 'Connection reset')
})

test('throwing cancellation still delivers the bounded idle interruption', async t => {
  t.mock.timers.enable({apis:['setTimeout','Date']})
  const {createModelStreamProgress} = await import('../tavern-plugin/lib/domain/model-stream-progress.js')
  const progress = createModelStreamProgress({idleMs:10,onInterrupt() {throw new Error('Cancel failed')}})
  const rejected = assert.rejects(progress.wait(new Promise(() => {})), {code:'MODEL_STREAM_IDLE_TIMEOUT'})
  t.mock.timers.tick(11)
  await rejected
  assert.equal(progress.snapshot().interruption, 'MODEL_STREAM_IDLE_TIMEOUT')
  progress.dispose()
})

test('a plugin settlement reports which plugin is settling and whether its agent is producing output', async () => {
  const { createPluginSettlementProgress } = await import('../tavern-plugin/lib/domain/plugin-settlement-progress.js')
  let clock = 1000
  const progress = createPluginSettlementProgress({ now: () => clock })
  const finish = progress.begin('session-game', 'anchor')
  assert.deepEqual(progress.snapshot('session-game'), { phase: 'preparing', startedAt: 1000, lastProgressAt: 1000, plugin: 'anchor' })
  clock = 2000; progress.model('session-game', 'start')
  clock = 3000; progress.model('session-game', 'output')
  assert.equal(progress.snapshot('session-game').phase, 'model')
  assert.equal(progress.snapshot('session-game').lastProgressAt, 3000)
  progress.model('session-game', 'end')
  assert.equal(progress.snapshot('session-game').phase, 'tool')
  finish()
  assert.equal(progress.snapshot('session-game'), null)
})
