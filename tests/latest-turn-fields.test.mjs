import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const server = await readFile(new URL('../tavern-plugin/lib/index.js', import.meta.url), 'utf8')
function section(start, end) {
  const from = server.indexOf(start)
  const to = server.indexOf(end, from)
  assert.ok(from >= 0 && to > from)
  return server.slice(from, to)
}

test('latestAssistantTurn 取最新一轮，增量视图也重新计算（#189）', () => {
  const context = vm.createContext({
    str: value => typeof value === 'string' ? value : value == null ? '' : String(value),
    sessionStore: { get: () => ({ id: 'live' }) }, agentRegistry: { get: () => undefined },
    assistantResultForTurn: (_session, turn) => ({ event: { data: { message: { id: 'm' + turn } } } })
  })
  const latestTurnFields = vm.runInContext(section('  function latestTurnFields(', '  function replyProjectionsOf(') + ';latestTurnFields', context)
  const messages = [{ role: 'assistant', greeting: true, text: '开场白' }]
  for (let turn = 2; turn <= 15; turn++) messages.push({ role: 'user', text: '行动' }, { role: 'assistant', turn, text: '正文 ' + turn })
  const fields = latestTurnFields({ sessionId: 's', messages })
  assert.equal(fields.latestAssistantTurn, 15)
  assert.equal(fields.latestAssistantMessageId, 'm15')
  assert.equal(fields.debugTurns.map(item => item.turn).join(), "15,14,13,12,11,10,9,8,7,6,5,4")
  assert.equal(latestTurnFields({ sessionId: 's', messages: messages.slice(0, 1) }).latestAssistantTurn, 1)
  assert.match(section('  async function projectDirtySessionView(', '  async function projectFullSessionView('), /\.\.\.latestTurnFields\(chat\)/,
    '增量视图不能沿用旧视图里的最新轮次')
})
