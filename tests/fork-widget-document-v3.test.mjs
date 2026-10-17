// private fork: widgets declare content rectangles; the host owns presentation state.
import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import contract from '../tavern-plugin/src/client/fork-widget-contracts.cjs'
const {forkValidateWidgetDocument:validate} = contract
const phone = JSON.parse(await readFile(new URL('./fixtures/source-widget/widget.json',import.meta.url),'utf8'))
const object = properties => ({type:'object',properties,required:Object.keys(properties),additionalProperties:false})
const stateful = () => ({format:'dsh.widget/2',namespace:'timer',view:{entry:'index.html'},presentation:{open:{"width":280,"height":180,"minWidth":200,"minHeight":100,"anchor":"corner-right"}},stateSchema:object({seconds:{type:'integer',minimum:0,maximum:86400}}),commands:[
  {name:'set',summary:'Set countdown seconds.',effect:'state.set',params:object({seconds:{type:'integer',minimum:0,maximum:86400}})},
  {name:'update',summary:'Patch seconds without renewing lifetime.',effect:'state.patch',params:{...object({seconds:{type:'integer',minimum:0,maximum:86400}}),required:[]}},
  {name:'clear',summary:'Remove this instance; missing is a no-op.',effect:'state.clear',params:object({})}
],lifetime:{until:'turn-end',durationSeconds:60},caps:{bytes:256,active:1}})
test('widget v2 document: official phone is a source-only named command with private assets',()=>{
  const before = structuredClone(phone)
  assert.deepEqual(validate(phone),phone)
  assert.deepEqual(phone,before)
  assert.deepEqual(Object.keys(phone.commands[0].params.properties),['contact','side'])
  assert.deepEqual(validate(stateful()),stateful())
})
test('reject old props documents, executable effects, reserved params, unsupported schema and namespace tricks',()=>{
  for (const change of [v=>v.format='dsh.widget/1',v=>v.namespace='music.set',v=>v.script='evil',v=>v.commands[0].effect='javascript',v=>v.commands[0].name='set',v=>v.commands.push(structuredClone(v.commands[0])),v=>v.commands[0].params.properties.ref={type:'string',maxLength:80},v=>v.commands[0].params.additionalProperties=true,v=>v.commands[0].params.properties.contact.$ref='external',v=>v.commands[0].params.properties.text={type:'string',maxLength:80},v=>v.commands[0].summary='x'.repeat(241),v=>v.stateSchema=object({}),v=>v.lifetime={until:'explicit'},v=>v.settingsSchema.fields.find(field=>field.key==='wallpaper').default='wrong',v=>v.samples[0].params.side='invalid']) {
    const value=structuredClone(phone); change(value)
    assert.throws(()=>validate(value),{code:'INVALID_WIDGET'})
  }
})
// private fork: no legacy view geometry or package-defined presentation state machine.
test('presentation rectangles are closed, bounded and required; compact is optional',()=>{
  assert.equal(validate(stateful()).presentation.compact,undefined)
  assert.ok(validate(phone).presentation.compact)
  for (const change of [v=>delete v.presentation,v=>v.view.slot='corner-right',v=>v.view.aspectRatio=1,v=>v.presentation.hidden={},v=>v.presentation.phase='open',v=>v.presentation.notifications='always',v=>v.presentation.open.width=561,v=>v.presentation.open.width=280.5,v=>v.presentation.open.minWidth=281,v=>v.presentation.open.minHeight=608,v=>v.presentation.open.aspectRatio=2,v=>v.presentation.compact.height=161,v=>v.presentation.open.anchor='phone']) {
    const value=structuredClone(phone);change(value);assert.throws(()=>validate(value),{code:'INVALID_WIDGET'})
  }
})
test('private assets and view stay within the owning bundle; stateful lifetime/schema/caps are bounded',()=>{
  for (const path of ['../other/secret','/absolute','https://example.org/a','other:asset','a\\b','a/%2e%2e/b','a//b','a/./b']) {
    const value=structuredClone(phone); value.assets.message.path=path
    assert.throws(()=>validate(value),{code:'INVALID_WIDGET'})
  }
  for (const change of [v=>delete v.stateSchema,v=>v.caps.bytes=12289,v=>v.caps.active=2,v=>v.lifetime.durationSeconds=0,v=>v.commands[2].params=object({unwanted:{type:'boolean'}}),v=>v.commands[0].help={examples:[{seconds:-1}]}]) {
    const value=stateful();change(value);assert.throws(()=>validate(value),{code:'INVALID_WIDGET'})
  }
})
