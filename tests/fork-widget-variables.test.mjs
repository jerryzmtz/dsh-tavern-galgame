// private fork: variable permissions and projections never borrow the latest chat state.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import contract from '../tavern-plugin/src/client/fork-widget-contracts.cjs'
import { widgetVariableDigest, projectWidgetVariableValues, resolveWidgetVariableSnapshot, prepareWidgetVariableOperations, auditWidgetVariableResult } from '../tavern-plugin/lib/domain/widget-variables.js'
import { inspectPackScripts } from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/validation.js'

const phone = JSON.parse(await readFile(new URL('./fixtures/source-widget/widget.json', import.meta.url)))
const declaration = () => ({ reads: { balance: { source: 'mvu', path: '/balance' }, bag: { source: 'mvu', path: '/bag' } }, writes: {
  balance: { source: 'mvu', path: '/balance', scope: 'exact', ops: ['replace', 'delta'] },
  bag: { source: 'mvu', path: '/bag', scope: 'subtree', ops: ['insert', 'remove', 'replace'] }
} })
const check = variables => contract.forkValidateWidgetDocument({ ...phone, variables })
const row = (messageId, turn, stat_data, extra = {}) => ({ messageId, verified: true, message: { role: 'assistant', turn, swipeId: 0, variables: [{ stat_data }], ...extra } })

test('canonical pointers and bounded read/write declarations', () => {
  assert.ok(check(declaration()))
  assert.deepEqual(contract.forkWidgetVariablePointer('/世界状态/时间/a~1b/~0'), ['世界状态', '时间', 'a/b', '~'])
  assert.deepEqual(contract.forkWidgetVariablePointer('/'), [''])
  for (const path of ['', 'a.b', '/a~2b', '/__proto__/x', '/constructor', '/$meta', '/__internal', '/a/*', '/{{time}}', '/' + 'a'.repeat(513), '/a'.repeat(17)]) {
    assert.throws(() => check({ reads: { test: { source: 'mvu', path } } }), { code: 'INVALID_WIDGET' }, path)
  }
  for (const mutate of [v => v.reads.balance.source = 'global', v => v.writes.balance.source = 'helper-chat', v => v.reads = {},
    v => v.reads.more = { source: 'mvu', path: '/bag/item' }, v => v.writes.bag.ops.push('move'), v => v.writes.bag.ops.push('insert'),
    v => v.writes.more = { ...v.writes.bag, path: '/bag/item' }, v => v.reads.balance.unknown = true,
    v => v.reads = Object.fromEntries(Array.from({ length: 33 }, (_, i) => ['r' + i, { source: 'mvu', path: '/a' + i }]))]) {
    const v = declaration(); mutate(v); assert.throws(() => check(v), { code: 'INVALID_WIDGET' })
  }
})

test('own-property reads preserve missing/null/false/zero and strip internal keys', () => {
  const variables = { reads: { bag: { source: 'mvu', path: '/bag' }, absent: { source: 'mvu', path: '/absent' }, empty: { source: 'helper-chat', path: '/empty' } } }
  const source = { bag: JSON.parse('{"a":null,"b":false,"c":0,"d":"","$meta":1,"__private":2,"constructor":3,"nested":{"prototype":4,"ok":5}}') }
  const values = projectWidgetVariableValues(variables, { mvu: { available: true, value: source } })
  assert.deepEqual(values.bag, { status: 'ready', value: { a: null, b: false, c: 0, d: '', nested: { ok: 5 } } })
  assert.deepEqual(values.absent, { status: 'missing' })
  assert.deepEqual(values.empty, { status: 'unavailable' })
  assert.equal(source.bag.$meta, 1)
})

test('size, depth, and cumulative node limits never emit a partial subtree', () => {
  const variables = { reads: { a: { source: 'mvu', path: '/a' }, b: { source: 'mvu', path: '/b' } } }
  for (const a of ['x'.repeat(8192), Array(2049).fill(1), Array.from({ length: 14 }).reduce(value => ({ deep: value }), {})]) {
    const values = projectWidgetVariableValues(variables, { mvu: { available: true, value: { a } } })
    assert.deepEqual(values.a, { status: 'too-large' })
    assert.deepEqual(values.b, { status: 'missing' })
  }
  const values = projectWidgetVariableValues(variables, { mvu: { available: true, value: { a: 'a'.repeat(7000), b: 'b'.repeat(7000) } } })
  assert.equal(values.a.status, 'ready'); assert.deepEqual(values.b, { status: 'too-large' })
})

test('two-turn reads follow last-page progress, settlement, and selected swipe without future fallback', () => {
  const rows = [row(0, 1, { balance: 20 }), row(2, 2, { balance: 5 }, { variables: [{ stat_data: { balance: 5 } }, { stat_data: { balance: 99 } }] })]
  const read = extra => resolveWidgetVariableSnapshot({ rows, messageId: 2, lastPage: false, live: true, chatVariables: { flag: true }, ...extra })
  assert.equal(read().sources.mvu.value.balance, 20)
  assert.equal(read().sources['helper-chat'].available, false)
  assert.equal(read({ lastPage: true }).sources.mvu.value.balance, 5)
  for (const settlement of ['pending', 'running', 'waiting-runtime', 'failed']) assert.equal(read({ lastPage: true, settlement }).sources.mvu.value.balance, 20)
  rows[1].message.swipeId = 1
  assert.equal(read({ lastPage: true }).sources.mvu.value.balance, 99)
  rows[1].message.variables[1] = {}
  assert.equal(read({ lastPage: true }).sources.mvu.value.balance, 20)
  assert.equal(read({ messageId: 0 }).kind, 'unavailable')
  assert.equal(read({ messageId: 0, lastPage: true, live: false }).sources['helper-chat'].available, false)
  rows[0].verified = false
  assert.equal(read({ lastPage: true }).kind, 'saved-unverified')
})

test('operation permissions, dynamic keys, array insert and scalar-only exact grants', () => {
  const declarations = declaration(), before = { balance: 20, bag: {} }
  const operations = [{ writeId: 'balance', op: 'delta', value: -5 }, { writeId: 'bag', suffix: '/a~1b', op: 'insert', value: 1 }]
  const prepared = prepareWidgetVariableOperations(declarations, before, operations)
  assert.deepEqual(prepared.expected, { balance: 15, bag: { 'a/b': 1 } })
  assert.deepEqual(prepared.operations.map(item => item.path), ['/stat_data/balance', '/stat_data/bag/a~1b'])
  assert.deepEqual(before, { balance: 20, bag: {} })
  assert.deepEqual(auditWidgetVariableResult(declarations, before, prepared.expected, prepared.expected), { paths: ['/balance', '/bag/a~1b'], status: 'committed', normalized: false })
  assert.equal(auditWidgetVariableResult(declarations, before, { balance: 16, bag: { 'a/b': 1 } }, prepared.expected).normalized, true)
  assert.throws(() => auditWidgetVariableResult(declarations, before, { balance: 15, bag: {} }, prepared.expected), /operation-not-applied/)
  assert.throws(() => auditWidgetVariableResult(declarations, before, { ...prepared.expected, private: true }, prepared.expected), /out-of-scope-result/)
  assert.equal(auditWidgetVariableResult(declarations, before, before, prepared.expected).status, 'unchanged')
  for (const op of [{ writeId: 'balance', op: 'replace', value: {} }, { writeId: 'balance', suffix: '/child', op: 'delta', value: 1 },
    { writeId: 'balance', op: 'delta', value: Infinity }, { writeId: 'bag', suffix: '/__proto__', op: 'insert', value: 1 },
    { writeId: 'bag', suffix: '/absent/child', op: 'insert', value: 1 }, { writeId: 'bag', suffix: '/absent', op: 'replace', value: 1 },
    { writeId: 'bag', suffix: '/-', op: 'insert', value: 1 }, { writeId: 'bag', op: 'remove', value: 1 },
    { writeId: 'bag', op: 'remove', absolutePath: '/balance' }]) assert.throws(() => prepareWidgetVariableOperations(declarations, before, [op]))
  assert.deepEqual(prepareWidgetVariableOperations(declarations, { balance: 20, bag: [] }, [{ writeId: 'bag', suffix: '/-', op: 'insert', value: 'item' }]).expected.bag, ['item'])
})

test('silently ignored leaves inside the same subtree cannot partially commit', () => {
  const before = { balance: 20, bag: { a: 1, b: 1 } }, expected = { balance: 20, bag: { a: 2, b: 2 } }
  assert.throws(() => auditWidgetVariableResult(declaration(), before, { balance: 20, bag: { a: 2, b: 1 } }, expected), /operation-not-applied/)
})

test('risk inspection includes declarations even for script-free or disabled widgets', () => {
  const pack = { manifest: { id: 'pack', assets: [{ id: 'shop', kind: 'widgets', bundleKey: 'shop', entry: 'widget.json', enabled: false }] }, files: new Map([['bundles/shop/index.html', Buffer.from('<p>shop</p>')]]), widgets: { shop: { variables: declaration() } } }
  const risk = inspectPackScripts(pack)
  assert.equal(risk.length, 1)
  assert.equal(risk[0].widgetId, 'shop')
  assert.equal(risk[0].variables.reads[0].path, '/balance')
  assert.equal(risk[0].variables.writes[0].includesChildren, false)
  assert.equal(risk[0].variables.writes[1].includesChildren, true)
})


test('native window/slice object ordering is not a variable revision; array order still is',()=>{
  assert.equal(widgetVariableDigest({schema:{a:1,b:2},display_data:{bag:{},balance:20}}),widgetVariableDigest({display_data:{balance:20,bag:{}},schema:{b:2,a:1}}))
  assert.notEqual(widgetVariableDigest([1,2]),widgetVariableDigest([2,1]))
  const cache=new Map(),sources={mvu:{available:true,value:{balance:20}}}
  const first=projectWidgetVariableValues({reads:{a:{source:'mvu',path:'/balance'}}},sources,cache)
  const second=projectWidgetVariableValues({reads:{b:{source:'mvu',path:'/balance'}}},sources,cache)
  assert.equal(cache.size,1);assert.deepEqual(first.a,second.b)
})
