import assert from 'node:assert/strict'
import test from 'node:test'
import { MVU_SUBMIT_UPDATE_TOOL, normalizeMvuToolSubmission } from '../tavern-plugin/lib/domain/mvu-background-settlement.js'

test('MVU wire schema uses explicit types without unions that gateways can narrow', () => {
  const item = MVU_SUBMIT_UPDATE_TOOL.parameters.properties.operations.items
  assert.equal(item.type, 'object')
  assert.equal(item.properties.op.type, 'string')
  assert.deepEqual(item.properties.op.enum, ['replace', 'insert', 'add', 'delta', 'remove', 'move'])
  assert.equal(item.properties.valueJson.type, 'string')
  assert.equal(item.properties.valueText.type, 'string')
  assert.equal(item.properties.value, undefined)
  assert.doesNotMatch(JSON.stringify(MVU_SUBMIT_UPDATE_TOOL.parameters), /"(?:anyOf|oneOf)"/)
})

test('invalid or ambiguous encoded values fail before dispatch; legacy persisted operations survive', () => {
  for (const extra of [{ valueJson: '{' }, { valueJson: false }, { valueJson: '1', value: false }, { valueJson: '1e999' }, {valueText:1}, {valueText:'street',valueJson:'"room"'}, {valueText:'street',value:'room'}]) {
    assert.throws(() => normalizeMvuToolSubmission({ operations: [{ op: 'replace', path: '/hp', ...extra }] }))
  }
  for (const valueJson of ['"市立图书馆附近·临街咖啡店·窗边座位"多"" ', '"市立图书馆附近·临街咖啡店·窗边座位"的"" ']) {
    assert.throws(() => normalizeMvuToolSubmission({operations:[{op:'replace',path:'/stat_data/世界状态/所在地点',valueJson}]}), /所在地点.*不是有效 JSON.*valueText/)
  }
  assert.throws(() => normalizeMvuToolSubmission({ operations: [{ op: 'delta', path: '/hp', valueJson: 'false' }] }))
  const operations = [{ op: 'replace', path: '/hp', value: 3 }, { op: 'remove', path: '/old' }, { op: 'move', from: '/a', path: '/b' }]
  assert.deepEqual(normalizeMvuToolSubmission({ operations }).operations, operations)
  for(const valueText of ['', '街道', '她说"再见"\n然后离开']) {
    assert.deepEqual(normalizeMvuToolSubmission({operations:[{op:'replace',path:'/place',valueText,valueJson:''}]}).operations,[{op:'replace',path:'/place',value:valueText}])
  }
  assert.equal(normalizeMvuToolSubmission({operations:[{op:'delta',path:'/hp',valueText:'',valueJson:'2'}]}).operations[0].value,2)
  assert.throws(()=>normalizeMvuToolSubmission({operations:[{op:'delta',path:'/hp',valueText:'2'}]}),/有限数字/)
  assert.throws(()=>normalizeMvuToolSubmission({operations:[{op:'replace',path:'/hp',valueJson:'1e999'}]}),/数字必须有限/)
})
