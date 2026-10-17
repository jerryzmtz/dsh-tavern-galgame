import test from 'node:test'
import assert from 'node:assert/strict'
import { scriptChunkLayout } from '../tavern-plugin/lib/domain/script-chunks.js'

import { createScriptContinuity } from '../tavern-plugin/lib/domain/script-continuity.js'

const scripts = createScriptContinuity()
const source = Array.from({ length: 100 }, (_, i) => `第${i}段：${'汉'.repeat(97)}。\n`).join('').trim()
const script = { title: '原文定位', ...scriptChunkLayout(source) }
const change = (state, event) => scripts.transition({ script, state, event })

test('rollback and regeneration restore exact partial-block position and the saved budget', () => {
  let state = change(scripts.start(script, 3), { kind: 'set-chunk-size', chunkSize: 1000 }).state
  const prepared = change(state, { kind: 'prepare', userText: '继续', nativeTurn: 1 })
  assert.throws(() => change(prepared.state, { kind: 'set-chunk-size', chunkSize: 600 }), /等待/)
  const committed = change(prepared.state, { kind: 'commit', userText: '继续', nativeTurn: 1 })
  state = change(committed.state, { kind: 'set-chunk-size', chunkSize: 300 }).state
  for (const restoration of [{ revision: committed.revision }, { reference: committed.reference }]) {
    const restored = change(state, { kind: 'restore', ...restoration }).state
    assert.equal(restored.sourceOffset, prepared.reference.sourceOffsetBefore)
    if (restoration.revision) {
      assert.equal(restored.chunkSize, 1000)
      assert.equal(change(restored, { kind: 'prepare', userText: '继续', nativeTurn: 1 }).reference.text, prepared.reference.text)
    }
  }
})

test('old reference-only rollback uses its original layout even after changing the budget', () => {
  const oldReference = { chunkId: script.chunks[3].id, cursorBefore: 3, chunkingVersion: script.chunkingVersion }
  const resized = change(scripts.start(script, 5), { kind: 'set-chunk-size', chunkSize: 1000 }).state
  const restored = change(resized, { kind: 'restore', reference: oldReference }).state
  assert.equal(restored.sourceOffset, script.chunks.slice(0, 3).map(c => c.text).join('').length)
})
