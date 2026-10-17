import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { installHostProjectionReplay } from '../tavern-plugin/lib/domain/host-projection-replay.js'

const native = { skip: !process.env.DSH_BOOT_MODULE }
async function harness(t) {
  const url = pathToFileURL(process.env.DSH_BOOT_MODULE)
  const { boot } = await import(url)
  const root = await mkdtemp(join(tmpdir(), 'tavern-projection-replay-'))
  const config = join(root, 'host.yml')
  await writeFile(config, ['dsh-session', 'dsh-session-projection', 'dsh-token-meter', 'dsh-session-turn-outline'].map(n => '- name: ' + new URL('../../' + n + '/lib/index.js', url).href).join('\n'))
  const ctx = await boot('tavern-projection-replay-test', config)
  t.after(async () => { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) })
  return ctx.sessionProjections
}
function fixture(rounds) {
  const events = []
  const add = (type, data, surfaceOp) => events.push({ seq: events.length, type, data, ...(surfaceOp ? { surfaceOp } : {}) })
  const message = (role, text) => ({ id: String(events.length), role, content: [{ type: 'text', text }], source: { kind: role === 'user' ? 'user' : 'model', provider: 'fixture', model: 'fixture' } })
  add('system/message', { message: message('system', 'System 世界') }, 'append')
  for (let turn = 1; turn <= rounds; turn++) {
    add('turn/start', { turn })
    add('user/message', message('user', '继续 '.repeat(30)), 'append')
    add('assistant/message', { turn, step: 1, message: message('assistant', 'Story 故事 '.repeat(50)) }, 'append')
    add('turn/end', { turn, reason: { kind: 'completed' } })
  }
  return { events, add, message }
}
function selected(registry) {
  return ['contextBreakdown', 'turnOutline'].map(key => registry.registrations.get(key).def)
}

test('native checkpoint restore preserves schemas, missing-sequence errors, and checkpoint isolation', native, async t => {
  const registry = await harness(t)
  // Other projections have unrelated step constraints; keep this differential
  // registry scoped to the two native definitions the adapter specializes.
  registry.registrations = new Map([...registry.registrations].filter(([key]) => ['contextBreakdown', 'turnOutline'].includes(key)))
  const { events } = fixture(30)
  const cut = 41
  const baseline = registry.restore({}, events, 0, {}, 0)
  const prefix = registry.restore({}, events.slice(0, cut), 0, {}, 0)
  const checkpoint = structuredClone(prefix.checkpoint)
  const originalApply = selected(registry).map(def => def.apply)
  t.after(installHostProjectionReplay(registry))
  assert.deepEqual(registry.restore({}, events, 0, {}, 0), baseline)
  assert.deepEqual(registry.restore(checkpoint, events.slice(cut), cut, {}, 0), baseline)
  assert.deepEqual(checkpoint, prefix.checkpoint)
  assert.deepEqual(selected(registry).map(def => def.apply), originalApply)
  assert.throws(() => registry.restore({}, events.slice(cut), cut, {}, 0), /checkpoint row/)
  assert.throws(() => registry.restore(checkpoint, events.slice(cut + 1), cut, {}, 0), /missing seq/)
  assert.throws(() => registry.restore({ ...checkpoint, contextBreakdown: { ...checkpoint.contextBreakdown, val: {} } }, events.slice(cut), cut, {}, 0))
  assert.deepEqual(checkpoint, prefix.checkpoint)
})
