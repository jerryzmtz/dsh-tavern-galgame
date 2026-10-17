import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createChatJournalStore } from '../tavern-plugin/lib/domain/chat-journal-store.js'
import { sanitizeMvuLoadDiagnostic, sanitizeModuleFailure, redactMvuLoadError } from '../tavern-plugin/lib/domain/mvu-diagnostics.js'

for (const method of ['recordMvuRuntimeDiagnostic', 'recordTavernCompatibilityCalls']) {
  test(`${method} does not clone historical variable snapshots`, async t => {
    const root = await mkdtemp(join(tmpdir(), 'diagnostic-chat-read-'))
    t.after(() => rm(root, { recursive: true, force: true }))
    const store = createChatJournalStore({ dataRoot: root })
    await store.update('chat', () => ({ id: 'chat', sessionId: 'canonical', _storageRevision: 1,
      messages: Array.from({ length: 458 }, (_, turn) => ({ role: 'assistant', turn,
        variables: [{ stat_data: { entries: Array.from({ length: 100 }, () => ({ value: 'saved variable' })) } }] })) }))
    const source = await readFile(new URL('../tavern-plugin/lib/index.js', import.meta.url), 'utf8')
    const start = source.indexOf(`case '${method}':`)
    const end = source.indexOf('\n      case ', start + 1)
    const rows = []
    let fullCopies = 0
    const clone = globalThis.structuredClone
    t.mock.method(globalThis, 'structuredClone', value => {
      if (value?.messages?.some(message => message.variables)) fullCopies++
      return clone(value)
    })
    const context = { str: String, sanitizeMvuLoadDiagnostic, sanitizeModuleFailure, redactMvuLoadError,
      chatHeaderForSession: id => id === 'missing' ? undefined : store.readSessionState('chat'),
      chatForSession: id => id === 'missing' ? undefined : store.read('chat'),
      sessionStateForSession: id => id === 'missing' ? undefined : store.readSessionState('chat'),
      mvuDiagnostics: { record: async (...args) => rows.push(args) },
      compatibilityDiagnostics: { record: async (...args) => rows.push(args) } }
    const invoke = vm.runInNewContext(`(async function(args){switch('${method}'){${source.slice(start, end)}}})`, context)
    for (let i = 0; i < 6; i++) {
      assert.equal((await invoke({ sessionId: 'alias', runtimeId: 'runtime', calls: [],
        diagnostic: { kind: 'mvu-load', phase: 'initialization-waiting' } })).recorded, true)
    }
    assert.equal(rows.length, 6)
    assert.ok(rows.every(row => row[0] === 'canonical'))
    await assert.rejects(invoke({ sessionId: 'missing' }), /没有绑定/)
    assert.equal(fullCopies, 0, 'diagnostics must not clone the full chat')
  })
}
