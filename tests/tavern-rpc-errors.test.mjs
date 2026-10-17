import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import test from 'node:test'
import { DEFAULT_RPC_BODY_LIMIT } from '../tavern-plugin/lib/http/routes.js'

// Run the production POST handler, stubbing dispatch rather than duplicating
// the error envelope. No native session or credentials are needed.
test('POST API 保留错误码而不泄漏错误对象中的额外数据', async () => {
  const source = await readFile(new URL('../tavern-plugin/lib/http/routes.js', import.meta.url), 'utf8')
  const start = source.indexOf("          const method = pathname.slice('/api/dsh-tavern'.length + 1)")
  const end = source.indexOf('\n      }\n  }\n}', start)
  assert.ok(start >= 0 && end > start)
  const failure = Object.assign(new Error('脚本写入不属于当前 MVU 结算事件'), { code: 'MVU_SETTLEMENT_EVENT_MISMATCH', privateState: 'PRIVATE-STORY' })
  const handle = vm.runInNewContext('(async function(req, res) { try {\n' + source.slice(start, end) + '\n})', {
    Buffer, DEFAULT_RPC_BODY_LIMIT, pathname: '/api/dsh-tavern/updateTavernHelperVariables', sceneImageRoute: false, gameplayRoute: false, assetGenerationRoute: false, // private fork: extracted handler's new bounded asset request branch
    readsOfficialMvu: false, readsFullTemplate: false, readsRuntimeAsset: false,
    str: value => String(value ?? ''), dispatch: async () => { throw failure }
  })
  let status, body
  await handle({ method: 'POST', headers: {}, async *[Symbol.asyncIterator]() { yield Buffer.from('{}') } }, {
    writeHead(value) { status = value }, end(value) { body = value }
  })
  assert.equal(status, 200)
  assert.deepEqual(JSON.parse(body), { ok: false, error: failure.message, errorCode: failure.code })
  assert.doesNotMatch(body, /PRIVATE-STORY|stack/)
})
