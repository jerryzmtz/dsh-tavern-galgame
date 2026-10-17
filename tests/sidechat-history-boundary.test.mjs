import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import test from 'node:test'
import { parse } from 'acorn'
import { createRequire } from 'node:module' // private fork: use read-only fallback resolution.

// Exercise the installed package: frozen-lockfile installation applies our patch.
const source = await readFile(createRequire(import.meta.url).resolve('dsh-better-sidebar'), 'utf8')
const functions = parse(source, { ecmaVersion: 'latest', sourceType: 'module' }).body
  .filter(node => node.type === 'FunctionDeclaration')
  .map(node => source.slice(node.start, node.end)).filter(text => !text.includes('import.meta'))
const context = vm.createContext({ structuredClone, EVENTS_CAP: 8000 })
vm.runInContext(functions.join('\n'), context)
const message = (seq, text) => ({ seq, type: 'user/message', surfaceOp: 'append', data: { content: [{ type: 'text', text }] } })
const marker = seq => ({ seq, type: 'session/end-seed', data: {} })

for (const live of [true, false]) {
  for (const legacy of [true, false]) {
    test(`sidechat boundary survives parent and child resumes (${live ? 'live' : 'cold'}, ${legacy ? 'legacy' : 'current'})`, async () => {
      const events = [marker(0), message(1, 'parent conversation'),
        { seq: 2, type: 'subagent/descriptor', data: {} }, marker(3),
        message(4, 'child first question'), marker(5), message(6, 'child followup'), marker(7)]
      const metadata = legacy ? { header: { seedLength: 3 }, meta: { seedLength: 3 } } : { inheritedEventCount: 3 }
      const session = { ...metadata, snapshotEvents: () => events }
      const ctx = { get: name => name === 'agents' ? { get: () => live ? { session } : undefined }
        : name === 'sessionPersistence' ? { open: async () => ({ ...metadata, header: metadata.header || {}, read: async () => ({ events }), close: async () => {} }) } : undefined }
      const history = context.buildSidechatApi(ctx)['sidechat.events']
      const original = structuredClone(events)
      const page = await history({ childId: 'child' })
      const visible = Array.from(page.events).filter(row => row.type === 'user/message')
      assert.deepEqual(visible.map(row => row.data.content[0].text), ['child first question', 'child followup'])
      assert.ok(page.events.every(row => row.type !== 'session/end-seed'))
      const tail = await history({ childId: 'child', afterSeq: 4 })
      assert.deepEqual(Array.from(tail.events).map(row => row.seq), [6])
      const unchanged = await history({ childId: 'child', afterSeq: 6 })
      assert.equal(unchanged.events.length, 0)
      assert.deepEqual(events, original, 'reading must preserve the original persisted log')
    })
  }
}

for (const events of [[message(0, 'unseeded')], [marker(0), message(1, 'inherited'), marker(2), message(3, 'own')]]) {
  test('sidechat without boundary metadata retains the native unseeded/seeded fallback: ' + events.length, async () => {
    const ctx = { get: name => name === 'agents' ? { get: () => ({ session: { snapshotEvents: () => events } }) } : undefined }
    const page = await context.buildSidechatApi(ctx)['sidechat.events']({ childId: 'child' })
    assert.deepEqual(Array.from(page.events).map(event => event.data.content[0].text), [events.at(-1).data.content[0].text])
  })
}
