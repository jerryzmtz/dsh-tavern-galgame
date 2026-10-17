import test from 'node:test'
import assert from 'node:assert/strict'

import { inspectWorldBookDocument, updateWorldBookDocument, exportCharacterBook, exportSillyTavernWorldBook } from '../tavern-plugin/lib/domain/worldbook-resource.js'

test('预算设置在嵌入与独立格式编辑导出后仍生效，非法输入不静默截断', async () => {
  const original = { entries: { 0: {uid:0, key:['地点'],content:'正文'} } }
  const updated = updateWorldBookDocument(original, {tokenBudget:1234,scanDepth:1}).document
  const exported = exportSillyTavernWorldBook(exportCharacterBook(updated))
  const view = inspectWorldBookDocument(exported)
  assert.equal(view.tokenBudget,1234)
  assert.equal(view.raw.token_budget,1234)
  assert.equal(view.scanDepth,1)
  assert.equal(original.token_budget,undefined)
  for(const tokenBudget of [-1,1.5,1000001]) assert.throws(()=>updateWorldBookDocument(original,{tokenBudget}),/Token 预算/)
})
