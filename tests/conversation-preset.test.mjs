import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

// Exercise the production RPC branch with isolated persistence and resource dependencies.
const source = readFileSync(new URL('../tavern-plugin/lib/index.js', import.meta.url), 'utf8')
const body = source.split("case 'applyConversationPreset': {")[1].split("case 'getPreset':")[0]
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
const run = new AsyncFunction('args', 'str', 'chatForSession', 'groupOfMode', 'sessionActivity', 'agentRegistry', 'runtimePresets', 'updateChat', 'view', '{' + body)
function harness({ busy = false, stale = false } = {}) {
  let chat = { id: 'game', mode: 'story', _storageRevision: 1, messages: Array.from({ length: 200 }, (_, turn) => ({ turn })), variables: { hp: 7 }, runtimePresetSnapshot: { presetPath: 'old' } }
  let reads = 0
  const snapshot = { presetPath: 'new', front: { text: 'front' }, middle: { text: 'middle' }, back: { text: 'back' }, regexScripts: [{ findRegex: 'a', replaceString: 'b' }] }
  return {
    chat: () => chat, reads: () => reads, snapshot,
    apply: path => run({ sessionId: 'session', path }, String, async () => structuredClone(chat), () => 'play', async () => ({ busy }), new Map(), { fullSnapshot: async () => { reads++; return structuredClone(snapshot) } }, async (_id, update) => { const draft = structuredClone(chat); if (stale) draft._storageRevision++; chat = update(draft); return chat }, async saved => saved)
  }
}

test('busy and stale games reject preset replacement without changing the save', async () => {
  for (const options of [{ busy: true }, { stale: true }]) {
    const h = harness(options)
    const before = structuredClone(h.chat())
    await assert.rejects(h.apply('new'), /等待|已变化/)
    assert.deepEqual(h.chat(), before)
  }
})
