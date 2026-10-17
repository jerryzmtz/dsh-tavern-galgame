// private fork: assert request-local handles; canonical records retain exact IDs.
// private fork: tool receipts use the CLI v1 envelope; saved record diagnostics are unchanged.
// private fork: stable provider grammar is not runtime authorization.
import test from 'node:test'
import assert from 'node:assert/strict'
import {performanceFixture, performanceRef} from './helpers/performance-director-fixture.mjs'
import {assetRefKey} from '../tavern-plugin/packages/dsh-presentation-protocol/src/asset-packs.js'
import {buildAssetPackRequest, createAssetPackTransaction} from '../tavern-plugin/lib/domain/stage-asset-pack-director.js'
import {buildAssetPackTool, reduceAssetPackOperation, validateAssetPackToolValue} from '../tavern-plugin/lib/domain/stage-asset-pack-tools.js'
const ref = (kind, assetId) => ({...performanceRef(assetId), kind})
async function fixture() {
  const f = await performanceFixture()
  f.input.engine.widgetsEnabled = true
  f.input.engine.widgetAuthorizations = {}
  for (const asset of f.pack.manifest.assets) {
    const key = assetRefKey(ref(asset.kind, asset.id))
    f.input.assetStatus[key] = {available:true, executableDigest:'a'.repeat(64)}
    f.input.engine.widgetAuthorizations[key] = 'a'.repeat(64)
  }
  return f.prepare()
}

for (const incremental of [true, false]) test(`request tools (${incremental}): ranges and provider grammar stay fixed while native admission follows recall`, async () => {
  const a = await fixture(), b = structuredClone(a)
  b.units = [{kind:'narration',text:'A different reply.'}]
  b.binding.target = {...b.binding.target, turn:20, sourceKey:'another-reply'}
  b.context.actors = {different:{name:'Different',outfits:[]}}
  b.context.outfits = {different:[]}
  b.context.phone.aliases = ['different', 'other-contact']
  b.context.skinActive = b.context.performanceActive = true
  for (const kind of Object.keys(b.context.catalogue.candidates)) b.context.catalogue.candidates[kind] = []
  b.limits = {maxToolCalls:1,maxBeats:1,maxBeatsPerCall:1,maxOpsPerCall:1,maxOps:1}
  const original = buildAssetPackRequest(a, incremental)
  const changed = buildAssetPackRequest(b, incremental, undefined, '', false, 100)
  assert.deepEqual(original.tools,changed.tools) // Admission lives in the handler, not the provider grammar.
  const c = structuredClone(a.context)
  c.catalogue.candidates.widgets[0].widget.commands[0].params = {type:'object',properties:{count:{type:'integer'}},required:['count'],additionalProperties:false}
  c.catalogue.candidates.widgets.push({...c.catalogue.candidates.widgets[0],ref:ref('widgets','other-widget')})
  assert.deepEqual(original.tools,buildAssetPackRequest({...a,context:c},incremental).tools)
  const schema = original.tools[0].parameters
  assert.equal(schema.$defs,undefined)
  assert.deepEqual(schema.properties.beats.items.properties.ops.items.anyOf[0].oneOf.find(row=>row.properties.op.const==='cast.add').properties.actor,{type:'string',description:'Listed actor handle.'})
  assert.equal(schema.properties.beats.items.properties.at.maximum, undefined)
  assert.equal(schema.properties.beats.maxItems, undefined)
  if (incremental) assert.equal(schema.properties.through.maximum, undefined)
  const fixed = JSON.parse(original.system.split('<stage_assets>\n').at(-1).split('\n')[1])
  const tail = JSON.parse(original.messages[0].content.find(row=>row.text.startsWith('{"allowedCommands"')).text)
  const widgetRow = (fixed.catalogue.widgets || tail.catalogue.widgets)[0]
  assert.deepEqual(widgetRow.commands[0].params, a.context.catalogue.candidates.widgets[0].widget.commands[0].params)
  assert.deepEqual(widgetRow.caps, a.context.catalogue.candidates.widgets[0].widget.caps)
  assert.deepEqual(tail.contacts, undefined)
})

test('static grammar still rejects unknown nested actors, contacts, outfit ownership, refs and widget props in the host', async () => {
  const p = await fixture(), schema = buildAssetPackTool(p.context).parameters
  const invalid = [
    {op:'cast.add',actor:'missing'},
    {op:'cast.add',actor:'actor',after:'missing'},
    {op:'cast.set',actors:['missing']},
    {op:'actor.gaze.set',actor:'actor',target:{actor:'missing'}},
    {op:'widget.testphone.mark',ref:ref('widgets','missing'),contact:'missing',side:'in'},
    {op:'actor.outfit.set',actor:'actor',outfit:'missing'},
    {op:'music.set',ref:ref('sfx','bell')},
    {op:'music.set',ref:ref('music','missing')},
    {op:'widget.clock.set',ref:ref('widgets','clock'),label:42},
    {op:'widget.clock.set',ref:ref('widgets','missing'),label:'Clock'}
  ]
  for (const op of invalid) {
    validateAssetPackToolValue({sequence:1,through:8,done:true,beats:[{at:1,ops:[op]}]}, schema)
    assert.throws(() => reduceAssetPackOperation(p.baseline,op,p.context,{at:1}), undefined, JSON.stringify(op))
  }
  const empty = structuredClone(p.context)
  empty.catalogue.candidates.music = []
  assert.throws(() => reduceAssetPackOperation(p.baseline,{op:'music.set',ref:ref('music','classroom')},empty,{at:1}), error => error.code === 'DISABLED')
})

for (const incremental of [true,false]) test(`host ranges (${incremental}): invalid beats do not discard valid siblings`, async () => {
  const p = await fixture(), tx = createAssetPackTransaction({prepared:p,incremental,getCurrentBinding:()=>p.binding})
  const result = tx.submit({...(incremental ? {sequence:1,through:8,done:true} : {}),beats:[
    {at:1,ops:[{op:'weather.set',weather:'rain'}]},
    {at:9,ops:[{op:'weather.set',weather:'snow'}]}
  ]})
  assert.equal(result.ok,false)
  assert.equal(result.outcome,'partial')
  assert.equal(result.errors.length,1)
  tx.finish()
  assert.equal(tx.effect().end.weather,'rain')
  const envelope = createAssetPackTransaction({prepared:p,getCurrentBinding:()=>p.binding})
  assert.equal(envelope.submit({sequence:1,through:9,done:true,beats:[]}).ok,false)
})

test('private fork: retired call, beat and op quotas cannot drop valid siblings', async () => {
  const p = structuredClone(await fixture())
  p.limits = {maxToolCalls:1,maxBeats:1,maxBeatsPerCall:1,maxOpsPerCall:1,maxOps:1}
  const tx = createAssetPackTransaction({prepared:p,getCurrentBinding:()=>p.binding})
  const reply = tx.submit({sequence:1,through:8,done:true,beats:[
    {at:1,ops:[{op:'weather.set',weather:'rain'},{op:'camera.set',mode:'wide'}]},
    {at:2,ops:[{op:'weather.set',weather:'snow'}]}
  ]})
  assert.equal(reply.ok,true)
  assert.equal(reply.errors.length,0)
  tx.finish()
  assert.equal(tx.effect().end.weather,'snow')
  assert.equal(tx.effect().end.camera.mode,'wide')
  assert.equal(tx.submit({sequence:2,through:8,done:true,beats:[]}).ok,false)
})
