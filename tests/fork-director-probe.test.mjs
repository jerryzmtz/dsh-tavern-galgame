import test from 'node:test'
import assert from 'node:assert/strict'
import {createDirectorProbeStore,createDirectorProbeRpc,directorProbeKey} from '../tavern-plugin/lib/fork-director-probe.js'

const selection = {provider:'fake',model:'director'}
function fixture() {
  let saved = {models:{}}, revision = 0, section
  const settings = {writable:true,installSection(_ctx, ns, _schema, _entry, hooks) {
    // The native service calls every hook at install (a missing onChange throws there and unregisters the section).
    section = ns; hooks.setSource(() => saved); hooks.onChange()
  },describe:() => [{ns:section,revision}],async replace(ns,value,expected) {
    assert.equal(ns,section); assert.equal(expected,revision); revision++; saved = value
  }}
  const ctx = {get:() => settings,inject(_names,fn) {fn(ctx)}}
  const store = createDirectorProbeStore(ctx)
  return {store,ctx}
}

test('one native request records tool/no-tool results, survives reload, and isolates model ids by provider', async () => {
  const {store,ctx} = fixture()
  let calls = 0, tool = true
  const rpc = createDirectorProbeRpc({store,resolveSelection:async args => args.selection || selection,stream:async function* (input) {
    calls++; assert.equal(input.maxTokens,128); assert.equal(input.messages.length,1)
    assert.equal(input.tools.length,1); assert.equal(input.tools[0].name,'director_connection_probe')
    assert.equal(input.sessionId,undefined)
    yield tool ? {type:'block-end',block:{type:'tool-call',name:'director_connection_probe',arguments:'{}'}} :
      {type:'block-end',block:{type:'text',text:'{"name":"director_connection_probe"}'}}
  }})
  assert.deepEqual(rpc.getDirectorToolSupport(),{models:{}}); assert.equal(calls,0)
  assert.equal((await rpc.testDirectorConnection()).supported,true)
  tool = false
  const other = {...selection,provider:'other'}
  const result = await rpc.testDirectorConnection({selection:other})
  assert.equal(result.supported,false); assert.equal(result.error.code,'DIRECTOR_NO_TOOL_CALL')
  assert.equal(result.error.message,'导演模型没有调用工具，请换一个支持工具调用的模型')
  assert.equal(calls,2)
  assert.deepEqual(createDirectorProbeStore(ctx).read(),{[directorProbeKey(selection)]:true,[directorProbeKey(other)]:false})
})

test('connection errors never overwrite observations or retry; concurrent clicks share one call', async () => {
  const {store} = fixture(); await store.save(selection,true)
  let calls = 0, release
  const gate = new Promise(resolve => {release = resolve})
  const rpc = createDirectorProbeRpc({store,resolveSelection:async () => selection,stream:async function* () {
    calls++; await gate; throw new Error('secret provider diagnostic')
  }})
  const a = rpc.testDirectorConnection(), b = rpc.testDirectorConnection()
  release()
  const [first,second] = await Promise.all([a,b])
  assert.equal(calls,1); assert.deepEqual(first,second)
  assert.equal(first.error.code,'DIRECTOR_CONNECTION_ERROR'); assert.equal(first.supported,undefined)
  assert.doesNotMatch(JSON.stringify(first),/secret/)
  assert.deepEqual(store.read(),{[directorProbeKey(selection)]:true})
})
