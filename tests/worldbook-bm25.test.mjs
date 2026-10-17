import test from 'node:test'
import assert from 'node:assert/strict'

import { createWorldbookFilter } from '../tavern-plugin/lib/domain/worldbook-filter.js'

test('BM25 query includes the current player action alongside the latest story', async () => {
  const candidates = [
    { ref: 'healing', text: '药王谷 治疗 伤口', tokenCost: 4000 },
    { ref: 'schools', text: '少林 武当 拜师', tokenCost: 4000 },
    ...Array.from({ length: 21 }, (_, i) => ({ ref: 'other-' + i, text: '沙漠 商人 交易', tokenCost: 4000 }))
  ]
  let offered
  const filter = createWorldbookFilter({ selection: () => ({}),
    beginTask: async () => ({ participantRequest: {}, bindSession() {}, participant: () => ({}), commit: async () => ({ status: 'committed' }), fail: async () => {} }),
    runAgent: async input => {
      offered = JSON.parse(input.messages[0].content[0].text).candidates.map(item => item.ref)
      input.onToolCall({ name: 'worldbook_filter_submit', arguments: { selected: offered } })
      return { traceSessionId: 'background' }
    } })
  for (const body of [{ sourceText: '药王谷治疗伤口', text: '沙漠商人交易' }, { text: '药王谷治疗伤口' }]) {
    const result = await filter({ chat: { messages: [{ role: 'assistant', ...body }] }, userText: '少林武当拜师', candidates })
    assert.equal(result.bm25.ran, true)
    assert.deepEqual(offered, ['healing', 'schools'])
  }
  await filter({ chat: { messages: [] }, userText: '少林武当拜师', candidates })
  assert.deepEqual(offered, ['schools'])
  await filter({ chat: { messages: [{ role: 'assistant', text: '药王谷治疗伤口' }] }, candidates })
  assert.deepEqual(offered, ['healing'])
})
