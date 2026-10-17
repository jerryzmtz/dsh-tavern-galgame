import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { generateHelper, generateHelperRaw, generateHelperCompletion, identifyHelperModelMessages } from '../tavern-plugin/lib/domain/helper-generation.js'
import { createHelperGenerationTasks } from '../tavern-plugin/lib/domain/helper-generation-tasks.js'

test('installed DSH accepts helper assistant histories and propagates cancellation through actual model lookup and stream', { skip: !process.env.DSH_BOOT_MODULE, timeout: 30000 }, async t => {
  const bootUrl = pathToFileURL(process.env.DSH_BOOT_MODULE)
  const { LlmAdapter, LlmRuntime } = await import(new URL('../../dsh-llm/lib/index.js', bootUrl))
  const { Context } = await import(new URL('../../cordis/lib/index.js', bootUrl))
  const ctx = new Context(), llm = new LlmRuntime(ctx)
  t.after(async () => { await ctx.fiber.dispose() })
  const lookupSignals = [], requests = []
  let started, hold = false, abortObserved = false
  class Model extends LlmAdapter {
    async resolveModel(provider, model, signal) { lookupSignals.push(signal); return { provider, id: model, name: model } }
    async *stream(options) {
      requests.push(options)
      for (const message of options.messages) {
        assert.equal(typeof message.id, 'string')
        assert.ok(message.id)
        assert.equal(message.source.kind, 'plugin')
      }
      if (hold) {
        started()
        await new Promise(resolve => options.signal.addEventListener('abort', () => { abortObserved = true; resolve() }, { once: true }))
        options.signal.throwIfAborted()
      }
      yield { type: 'text-delta', text: 'native answer' }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
  llm.registerAdapter(['helper-fixture'], new Model())
  const plugin = await readFile(new URL('../tavern-plugin/lib/index.js', import.meta.url), 'utf8')
  const source = plugin.slice(plugin.indexOf('  async function callModel(opts) {'), plugin.indexOf('  // ---------- 角色卡 ----------'))
  const selection = { provider: 'helper-fixture', model: 'fixture' }
  const callModel = new Function('llm', 'modelSelection', 'backgroundModelSelection', 'backgroundConfigForSession', 'identifyHelperModelMessages', source + '; return callModel')(
    llm, () => selection, () => selection, async () => ({}), identifyHelperModelMessages)
  const context = { sessionId: 'game', history: [{ role: 'assistant', text: 'Existing answer' }], callModel }
  assert.equal(await generateHelper({ user_input: 'Next' }, context), 'native answer')
  assert.equal(await generateHelperRaw({ ordered_prompts: ['chat_history'], user_input: 'Next' }, context), 'native answer')
  assert.equal(await generateHelperCompletion({ messages: [{ role: 'assistant', content: 'Imported answer' }, { role: 'user', content: 'Next' }] }, context), 'native answer')
  assert.equal(requests.length, 3)
  assert.ok(requests.every(request => request.messages.some(message => message.role === 'assistant')))
  const tasks = createHelperGenerationTasks(), ready = new Promise(resolve => { started = resolve })
  t.after(() => tasks.dispose())
  hold = true
  const pending = tasks.run('game', 'cancel', signal => generateHelper({ user_input: 'Next' }, { ...context, callModel: options => callModel({ ...options, signal }) }))
  const rejected = assert.rejects(pending, { name: 'AbortError' })
  await ready
  const signal = requests.at(-1).signal
  assert.equal(lookupSignals.at(-1), signal)
  assert.equal(signal.aborted, false)
  assert.equal(tasks.stop('game', 'cancel'), true)
  await rejected
  assert.equal(signal.aborted, true)
  assert.equal(abortObserved, true)
})
