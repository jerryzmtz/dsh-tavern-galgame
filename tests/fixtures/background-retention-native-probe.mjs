// Controlled memory probe using installed DSH Agent/Session implementations.
// Synthetic local model and history; no paid network calls or user saves.
// See docs/research/issue30-native-retention-2026-09-16.md for baseline setup.
import { writeFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { createInitializationNative } from './conversation-initialization-native.mjs'
import { createBackgroundAgentTask } from '../../tavern-plugin/lib/background-agent-task.js'
import { appendSessionEvent } from '../../tavern-plugin/lib/domain/session-events.js'
const mode = process.argv[2] || 'fixed'
const { createBackgroundAgentSessions } = await import(mode === 'old' ? '../../tavern-plugin/lib/background-agent-sessions-probe-old.js' : '../../tavern-plugin/lib/background-agent-sessions.js')
const boot = process.env.DSH_BOOT_MODULE || '/Applications/DSH Desktop.app/Contents/Resources/app.asar.unpacked/node_modules/@deepseek-ai/dsh-app-boot/lib/index.js'
const h = await createInitializationNative(boot)
for (const name of ['skill', 'tavern_read_skill_reference', 'web_search']) h.ctx.tools.register({ name, description: 'Unused test tool', parameters: { type: 'object', properties: {} }, output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] }, execute: async () => { throw new Error('Unexpected tool call') } })
let serial = 0
const options = { agents: h.ctx.agents, id: () => 'retention-probe-' + (++serial), needsNewBackgroundSession: async () => true }
const runner = createBackgroundAgentSessions(options, createBackgroundAgentTask(options))
const ids = [], samples = []
async function sample(round) {
  await new Promise(resolve => setImmediate(resolve))
  const natural = process.memoryUsage()
  global.gc?.()
  await new Promise(resolve => setImmediate(resolve))
  global.gc?.()
  const collected = process.memoryUsage()
  const row = { round, owned: ids.filter(id => runner.owns(id)).length,
    liveAgents: ids.filter(id => h.ctx.agents.get(id)).length,
    liveSessions: ids.filter(id => h.ctx.sessions.get(id)).length,
    naturalHeapMiB: natural.heapUsed / 1048576, heapMiB: collected.heapUsed / 1048576, rssMiB: collected.rss / 1048576 }
  samples.push(row); console.log(JSON.stringify(row))
}
try {
  await sample(0)
  for (let round = 1; round <= 12; round++) {
    const result = await runner.run({ sessionId: h.input.sessionId, task: 'candidate', persistent: true,
      selection: { provider: 'initialization-fixture', model: 'text' }, system: 'Return a short answer.', messages: [], tools: [] })
    ids.push(result.traceSessionId)
    const session = runner.requestSession(result.traceSessionId)
    for (let index = 0; index < 1500; index++) appendSessionEvent(session, 'system/message', {
      turn: 1, step: 1, message: { id: 'payload-' + round + '-' + index, role: 'system', content: [{ type: 'text', text: randomBytes(1536).toString('base64') }] }
    })
    h.requests.length = 0
    await sample(round)
  }
  await runner.dispose()
  await sample('disposed')
  await writeFile('/tmp/retention-native-' + mode + (global.gc ? '' : '-natural') + '.json', JSON.stringify({ mode, forcedGc: Boolean(global.gc), rounds: 12, eventsPerRound: 1500, textBytesPerEvent: 2048, samples }, null, 2))
} finally { await runner.dispose(); await h.dispose() }
