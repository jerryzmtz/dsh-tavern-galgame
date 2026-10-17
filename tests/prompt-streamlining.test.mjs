import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const cardToolsSource = await readFile(new URL('../tavern-plugin/lib/tools/card-editing.js', import.meta.url), 'utf8')

function between(source, start, end) {
  const from = source.indexOf(start)
  const to = source.indexOf(end, from)
  assert.notEqual(from, -1, `missing start marker: ${start}`)
  assert.notEqual(to, -1, `missing end marker: ${end}`)
  return source.slice(from, to)
}

test('原版恢复工具只操作当前人物卡并要求固定确认文本', () => {
  const restoreTool = between(cardToolsSource, "name: 'tavern_restore_card'", "output:")

  assert.match(restoreTool, /confirmation:/)
  assert.match(restoreTool, /enum: \['确认从原版恢复'\]/)
  assert.doesNotMatch(restoreTool, /path:/)
  assert.match(cardToolsSource, /restoreCurrentCard\(sessionId\)/)
  assert.match(cardToolsSource, /turnOrchestrator\.discard/)
})
