import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const serverSource = await readFile(new URL('../tavern-plugin/lib/index.js', import.meta.url), 'utf8')

function between(source, start, end) {
  const from = source.indexOf(start)
  const to = source.indexOf(end, from)
  assert.notEqual(from, -1, `missing start marker: ${start}`)
  assert.notEqual(to, -1, `missing end marker: ${end}`)
  return source.slice(from, to)
}

test('创建对话失败时服务端记录请求边界但不记录开场白正文', () => {
  // private fork: scope privacy assertions to the error payload, not unrelated stage/opening RPCs.
  const dispatch = between(serverSource, "console.error('dsh-tavern: 创建对话失败'", '          throw error')

  assert.match(dispatch, /console\.error\('dsh-tavern: 创建对话失败'/)
  assert.match(dispatch, /cardPath: str\(args && args\.path\)/)
  assert.match(dispatch, /openingId: str\(args && args\.openingId\)/)
  assert.doesNotMatch(dispatch, /greeting|openingText/)
})
