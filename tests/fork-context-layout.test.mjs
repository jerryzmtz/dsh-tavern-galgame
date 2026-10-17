// private fork: real local Agent/compaction lifecycle, synthetic text only.
import test from 'node:test'
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { createInitializationNative } from './fixtures/conversation-initialization-native.mjs'
import { createForegroundFrameSessionAdapter } from '../tavern-plugin/lib/domain/foreground-frame-session-adapter.js'
import { createForegroundFrameBuilder } from '../tavern-plugin/lib/domain/agent-input-frame.js'
import { installCompactionPolicy } from '../tavern-plugin/lib/domain/auto-compaction.js'
import { wholeTurnCompactionRange, surfaceTurnKeys } from '../tavern-plugin/lib/domain/context-turns.js'
import { createBackgroundAgentRunner } from '../tavern-plugin/lib/background-agent-runner.js'
import { measureCompactionSurface, selectCjkCompactionRange } from '../tavern-plugin/lib/domain/cjk-compaction.js'
import { compactWholeTurnsNow } from '../tavern-plugin/lib/domain/whole-turn-maintenance.js'
import { ensureSessionStablePrefix } from '../tavern-plugin/lib/domain/session-stable-prefix.js'

const native = { skip: !process.env.DSH_BOOT_MODULE, timeout: 30000 }
const visible = messages => messages.filter(m => m.content.length).map(({ role, content }) => ({ role, content }))
const bytes = messages => Buffer.from(messages.map(m => JSON.stringify(m)).join('\n') + '\n')
const text = message => message.content.filter(b => b.type === 'text').map(b => b.text).join('')

test('native story: complete prior turns remain byte-identical, failed compaction preserves them, successful compaction keeps whole green/frame/dialogue groups', native, async t => {
  const h = await createInitializationNative(process.env.DSH_BOOT_MODULE)
  t.after(() => h.dispose())
  const { agent, session } = h.target
  await ensureSessionStablePrefix(session, 'BLUE fixed worldbook and card')
  const adapter = createForegroundFrameSessionAdapter()
  h.ctx.on('agent/pre-step', async (payload, next) => {
    const decision = await next()
    const frame = createForegroundFrameBuilder().build({ chatId: 'chat', branchId: 'branch', basedOnRevision: payload.turn, operationId: 'operation-' + payload.turn, turn: payload.turn,
      // private fork: keep the synthetic region larger than native checkpoint framing, independent of prompt labels.
      inputs: [{ kind: 'foreground.user-input', sourceText: 'turn-' + payload.turn }, { kind: 'foreground.writing-rules', text: ('frame-' + payload.turn + ' ').repeat(32) }, { kind: 'foreground.active-worldbook', text: 'green-' + payload.turn }] })
    return { ...decision, messages: adapter.append({ session, messages: decision.messages, frame, step: payload.step }).messages }
  })
  let previous = null
  for (let turn = 1; turn <= 4; turn++) {
    agent.followup({ id: 'user-' + turn, role: 'user', content: [{ type: 'text', text: 'turn-' + turn }], source: { kind: 'human' } })
    await agent.whenIdle()
    const request = bytes(visible(h.requests.at(-1).messages))
    if (previous) assert.deepEqual(request.subarray(0, previous.length), previous, 'prefix through the previous assistant reply')
    previous = bytes(visible(session.deriveMessages()))
  }
  const { BasicCompactionEngine } = await import(new URL('../../dsh-compaction-basic/lib/index.js', pathToFileURL(process.env.DSH_BOOT_MODULE)))
  let fail = true
  class FixtureEngine extends BasicCompactionEngine {
    async summarize(input) {
      assert.match(JSON.stringify(input.messages), /green-1/)
      assert.doesNotMatch(JSON.stringify(input.messages), /green-3|frame-3/)
      if (fail) throw Error('fixture summary failed')
      return { summary: [{ type: 'text', text: 'SUMMARY turns 1 and 2' }], provider: 'initialization-fixture', model: 'text' }
    }
  }
  const engine = new FixtureEngine(h.ctx, { auto: false })
  t.after(installCompactionPolicy(engine, (_a, _t, _s, fallback) => fallback(), { selectRegion: (a, range) => wholeTurnCompactionRange(a.session, range.start, range.end) }))
  const nodes = [...session.surface.nodes]
  const thirdFrame = nodes.find(seq => session.deriveEventMessage(session.eventAt(seq))?.source?.trace?.turn === 3)
  const first = nodes.find(seq => session.deriveEventMessage(session.eventAt(seq))?.id === 'user-1')
  session.append('turn/start', { turn: 5 })
  await assert.rejects(engine.compactRegion(first, thirdFrame, agent, new AbortController().signal), /fixture summary failed/)
  assert.deepEqual(session.surface.nodes, nodes)
  fail = false
  await engine.compactRegion(first, thirdFrame, agent, new AbortController().signal)
  session.append('turn/end', { turn: 5, reason: { kind: 'completed' } })
  const after = visible(session.deriveMessages())
  assert.equal(after[0].role, 'system')
  assert.match(text(after[0]), /BLUE/)
  assert.match(text(after[1]), /SUMMARY/)
  const tail = after.slice(2)
  assert.doesNotMatch(JSON.stringify(tail), /green-[12]|frame-[12]|turn-[12]/)
  assert.match(JSON.stringify(tail), /green-3/)
  assert.match(JSON.stringify(tail), /green-4/)
  for (const turn of [3, 4]) {
    const greenIndex = tail.findIndex(m => text(m).includes('green-' + turn))
    const frameIndex = tail.findIndex(m => text(m).includes('frame-' + turn))
    assert.ok(greenIndex >= 0 && frameIndex > greenIndex)
    assert.equal(tail[frameIndex + 1].role, 'assistant')
  }
  const retained = bytes(after)
  agent.followup({ id: 'user-5', role: 'user', content: [{ type: 'text', text: 'turn-5' }], source: { kind: 'human' } })
  await agent.whenIdle()
  assert.deepEqual(bytes(visible(h.requests.at(-1).messages)).subarray(0, retained.length), retained)
  t.diagnostic(JSON.stringify({ beforeCompactionPrefixBytes: previous.length, afterCompactionPrefixBytes: retained.length, retainedTurns: 2 }))
})

for (const task of ['settlement', 'candidate', 'character-design', 'worldbook-filter', 'image', 'phone']) {
  test('background ' + task + ': fixed prefix survives two native calls; greens stay in the task, not the system', native, async t => {
    const h = await createInitializationNative(process.env.DSH_BOOT_MODULE, { assembleStablePrefix: false })
    t.after(() => h.dispose())
    for (const name of ['skill', 'tavern_read_skill_reference', 'web_search']) h.ctx.tools.register({ name, description: 'fixture', parameters: { type: 'object', properties: {} },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] }, execute: async () => 'fixture' })
    let turn = 0
    const runner = createBackgroundAgentRunner({ agents: h.ctx.agents, id: () => 'background-layout-' + task,
      resolveStablePrefix: () => '【故事设定 · 人物卡】\nBLUE card\n【常驻世界书】\nBLUE constant',
      resolveCurrentWorldbook: () => ({ prefixContext: 'BLUE constant', foregroundContext: 'GREEN-' + turn }) })
    t.after(() => runner.dispose())
    const requests = []
    for (turn = 1; turn <= 2; turn++) {
      await runner.run({ sessionId: h.target.session.id, task, persistent: true, ...(task === 'settlement' ? { rewindTo: -1 } : {}),
        selection: { provider: 'initialization-fixture', model: 'text' }, system: 'TASK RULES', tools: [], messages: [{ role: 'user', content: [{ type: 'text', text: ('dialogue-' + turn + ' ').repeat(100) }] }] })
      requests.push(h.requests.at(-1))
    }
    assert.equal(requests[0].system, requests[1].system)
    assert.doesNotMatch(requests[1].system, /GREEN|dialogue-/)
    // private fork: upstream prefilter shares the cached system but does not inject settlement greens.
    if (task === 'worldbook-filter') assert.doesNotMatch(JSON.stringify(requests[1].messages), /GREEN-/)
    else assert.match(JSON.stringify(requests[1].messages), /GREEN-2/)
    if (task === 'settlement') assert.doesNotMatch(JSON.stringify(requests[1].messages), /GREEN-1|dialogue-1/)
    else {
      const previous = bytes(visible(requests[0].messages)), current = bytes(visible(requests[1].messages))
      assert.deepEqual(current.subarray(0, previous.length), previous)
    }
    if (task !== 'settlement') {
      const session = h.ctx.agents.get('background-layout-' + task).session
      const { BasicCompactionEngine } = await import(new URL('../../dsh-compaction-basic/lib/index.js', pathToFileURL(process.env.DSH_BOOT_MODULE)))
      class BackgroundSummary extends BasicCompactionEngine {
        async summarize() { return { summary: [{ type: 'text', text: 'SUMMARY' }], provider: 'initialization-fixture', model: 'text' } }
      }
      const engine = new BackgroundSummary(h.ctx, { auto: false })
      t.after(installCompactionPolicy(engine, (_a, _t, _s, fallback) => fallback(), { selectRegion: (a, range) => wholeTurnCompactionRange(a.session, range.start, range.end) }))
      const taskNode = marker => session.surface.nodes.find(seq => text(session.deriveEventMessage(session.eventAt(seq))).includes(marker))
      session.append('turn/start', { turn: 3 })
      await engine.compactRegion(taskNode('dialogue-1'), taskNode('dialogue-2'), h.ctx.agents.get(session.id), new AbortController().signal)
      session.append('turn/end', { turn: 3, reason: { kind: 'completed' } })
      const compacted = visible(session.deriveMessages())
      assert.equal(compacted[0].role, 'system')
      assert.match(text(compacted[1]), /SUMMARY/)
      assert.match(JSON.stringify(compacted.slice(2)), /dialogue-2/)
      assert.doesNotMatch(JSON.stringify(compacted.slice(2)), /GREEN-1|dialogue-1/)
    }
    t.diagnostic(JSON.stringify({ task, stableSystemBytes: Buffer.byteLength(requests[0].system), calls: 2, oneShot: task === 'settlement' }))
  })
}

test('whole-turn selection preserves tool exchanges and never consumes a checkpoint-only partial turn', native, async t => {
  const h = await createInitializationNative(process.env.DSH_BOOT_MODULE)
  t.after(() => h.dispose())
  const session = h.target.session
  session.append('turn/start', { turn: 1 })
  const u1 = session.append('user/message', { id: 'old', role: 'user', content: [{ type: 'text', text: 'old' }], source: { kind: 'human' } }, { surfaceOp: 'append' })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  session.append('turn/start', { turn: 2 })
  const u2 = session.append('user/message', { id: 'recent', role: 'user', content: [{ type: 'text', text: 'green and input' }], source: { kind: 'human' } }, { surfaceOp: 'append' })
  session.append('step/start', { turn: 2, step: 1 })
  const call = session.append('assistant/message', { turn: 2, step: 1, stream: [], message: { id: 'call', role: 'assistant', content: [{ type: 'tool-call', id: 'c', name: 'read', arguments: '{}' }], source: { kind: 'model', provider: 'initialization-fixture', model: 'text' } } }, { surfaceOp: 'append' })
  session.append('user/message', { id: 'result', role: 'user', content: [{ type: 'tool-result', toolCallId: 'c', content: [{ type: 'text', text: 'result' }] }], source: { kind: 'plugin', plugin: 'fixture' } }, { surfaceOp: 'append' })
  assert.deepEqual(wholeTurnCompactionRange(session, u1.seq, call.seq), { start: u1.seq, end: u1.seq })
  assert.equal(wholeTurnCompactionRange(session, u2.seq, call.seq), null)
  const range = selectCjkCompactionRange(session, measureCompactionSurface(session, h.ctx.tokenMeter), 1, () => true)
  assert.equal(range.end, u1.seq)
  const turns = surfaceTurnKeys(session, session.surface.nodes)
  assert.equal(new Set(turns.slice(1)).size, 1)
})

for (const mode of ['story', 'card-extract']) test(mode + ': idle manual host transaction retains the latest whole turn without provisional surface writes', native, async t => {
  const h = await createInitializationNative(process.env.DSH_BOOT_MODULE)
  t.after(() => h.dispose())
  const { agent, session } = h.target
  await ensureSessionStablePrefix(session, 'BLUE immutable fixed prefix')
  for (let turn = 1; turn <= 3; turn++) {
    agent.followup({ id: 'manual-' + turn, role: 'user', content: [{ type: 'text', text: ('dialogue-' + turn + ' ').repeat(150) }], source: { kind: 'human' } })
    await agent.whenIdle()
  }
  const before = [...session.surface.nodes], latest = session.deriveMessages().slice(-2)
  const { BasicCompactionEngine } = await import(new URL('../../dsh-compaction-basic/lib/index.js', pathToFileURL(process.env.DSH_BOOT_MODULE)))
  let fail = true
  class ManualSummary extends BasicCompactionEngine {
    async summarize(input, owner, signal) {
      assert.deepEqual(session.surface.nodes, before, 'even during summary the real surface is unchanged')
      assert.match(JSON.stringify(input.messages), /dialogue-1/)
      assert.doesNotMatch(JSON.stringify(input.messages), /dialogue-3/)
      if (fail) throw Error('synthetic manual failure')
      if (mode === 'card-extract') return super.summarize(input, owner, signal)
      return { summary: [{ type: 'text', text: 'SUMMARY' }], provider: 'initialization-fixture', model: 'text' }
    }
  }
  const engine = new ManualSummary(h.ctx, { auto: false })
  const stop = installCompactionPolicy(engine, (_a, _t, _s, fallback) => fallback(), {
    compactNow: (original, owner, signal, command) => compactWholeTurnsNow(engine, original, owner, signal, command)
  })
  t.after(stop)
  await assert.rejects(engine.compactNow(agent, new AbortController().signal), /summary/)
  assert.deepEqual(session.surface.nodes, before)
  fail = false
  const result = await engine.compactNow(agent, new AbortController().signal)
  assert.ok(result)
  const after = visible(session.deriveMessages())
  assert.match(text(after[0]), /BLUE/)
  assert.match(text(after[1]), mode === 'story' ? /SUMMARY/ : /继续故事/)
  assert.deepEqual(after.slice(-2), visible(latest))
  assert.doesNotMatch(JSON.stringify(after.slice(2)), /dialogue-[12]/)
  const originalNow = Object.getPrototypeOf(engine).compactNow
  stop()
  assert.equal(engine.compactNow, originalNow)
})
