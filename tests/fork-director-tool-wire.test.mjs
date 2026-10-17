// private fork: provider wire invariants for non-strict Anthropic/OpenAI function tools.
// Nested unions retain admission semantics; all references are inlined at the provider boundary.
import test from 'node:test'
import assert from 'node:assert/strict'
import {performanceFixture} from './helpers/performance-director-fixture.mjs'
import {buildAssetPackRequest,runAssetPackDirector} from '../tavern-plugin/lib/domain/stage-asset-pack-director.js'

function checkTool(tool) {
  assert.match(tool.name,/^[a-zA-Z0-9_-]{1,64}$/)
  const root=tool.parameters
  assert.equal(root.type,'object')
  assert.ok(root.properties&&Object.keys(root.properties).length)
  for(const key of ['oneOf','anyOf','allOf','$ref']) assert.equal(root[key],undefined,'provider root: '+key)
  const seen=new Set()
  function schema(value) {
    assert.ok(value&&typeof value==='object'&&!Array.isArray(value))
    if(seen.has(value))return
    seen.add(value)
    assert.equal(value.$ref,undefined)
    assert.equal(value.$defs,undefined)
    if(value.type==='object'){
      // Non-strict providers permit open objects (e.g. widget props).
      if(value.additionalProperties!==undefined) assert.ok(typeof value.additionalProperties==='boolean'||typeof value.additionalProperties==='object')
      for(const key of value.required||[]) assert.ok(Object.hasOwn(value.properties||{},key),'required property '+key)
      for(const child of Object.values(value.properties||{}))schema(child)
    }
    if(value.type==='array')schema(value.items)
    for(const key of ['oneOf','anyOf','allOf'])if(value[key]){assert.ok(value[key].length);value[key].forEach(schema)}
    for(const child of Object.values(value.$defs||{}))schema(child)
    if(value.enum)assert.ok(value.enum.length)
  }
  schema(root)
  assert.ok(root.properties.beats.items.properties.ops.items.anyOf[0].oneOf.some(op=>op.properties.op.const==='mod.dsh.performance.set'))
  assert.ok(!JSON.stringify(root).includes('"const":"performance.set"'))
}

for(const incremental of [true,false])test('generated '+(incremental?'stage_update':'submit_direction')+' retains a provider-compatible tool envelope',async()=>{
  const f=await performanceFixture(),prepared=f.prepare(),request=buildAssetPackRequest(prepared,incremental)
  assert.deepEqual(request.tools.map(tool=>tool.name),[incremental?'stage_update':'submit_direction'])
  checkTool(request.tools[0])
  const result=await runAssetPackDirector({prepared,incremental,getCurrentBinding:()=>prepared.binding,runAgent:async input=>{
    assert.deepEqual(input.tools,request.tools)
    assert.equal(input.acceptWithoutText(),false)
    const reply=JSON.parse(await input.onToolCall({name:input.tools[0].name,arguments:{beats:[],...(incremental?{sequence:1,through:prepared.units.length,done:true}:{})}}))
    assert.equal(reply.ok,true)
    assert.equal(input.acceptWithoutText(),true)
  }})
  assert.equal(result.effect.complete,true)
})
