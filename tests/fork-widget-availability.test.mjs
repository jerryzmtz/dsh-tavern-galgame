// private fork: shared runtime/list activation and card-local copy precedence.
import test from 'node:test'
import assert from 'node:assert/strict'
import {activeWidgetKeys,widgetIsActive} from '../tavern-plugin/lib/domain/widget-availability.js'
import {createVariableBindingRegistry} from '../tavern-plugin/lib/domain/variable-bindings/index.js'
const ref = {packId:'source',kind:'widgets',assetId:'phone'}
const copiedRef = {...ref,packId:'card'}
const pack = (id,source) => ({manifest:{id,assets:[{kind:'widgets',id:'phone',enabled:true,...(source ? {extensions:{dsh_tavern:{copiedFrom:source}}} : {})}]},widgets:{phone:{}}})
test('effective widget identity respects permission, bound copy off lamps and untracked legacy copies',()=>{
  const source=pack('source'),copy=pack('card',ref)
  const context={packs:[source,copy],boundPackIds:['card'],allowedPackIds:['source','card'],widgetsEnabled:true}
  const active=()=>activeWidgetKeys(context)
  assert.equal(widgetIsActive(active(),ref),false)
  assert.equal(widgetIsActive(active(),copiedRef),true)
  context.boundPackIds=[]
  assert.equal(active().size,1)
  context.boundPackIds=['card'];context.allowedPackIds=['source']
  assert.equal(widgetIsActive(active(),ref),true)
  context.allowedPackIds=['source','card'];copy.manifest.assets[0].enabled=false
  assert.equal(widgetIsActive(active(),ref),false)
  assert.equal(widgetIsActive(active(),copiedRef),false)
  copy.manifest.assets[0].enabled=true;delete copy.manifest.assets[0].extensions
  assert.equal(active().size,2)
  context.widgetsEnabled=false
  assert.equal(active().size,0)
})
test('any provider declares instance label, activation and Chinese structured field labels',()=>{
  const registry=createVariableBindingRegistry()
  registry.register({id:'items',label:'物品',slots:context=>[{target:{kind:'items',slot:'inventory'},label:'持有物',instanceLabel:'背包',active:context.enabled,valueType:'array',default:[],fieldMapping:{name:{label:'名称',valueType:'string',required:true},count:{label:'数量',valueType:'number'}}}]})
  const row=enabled=>registry.list({raw:{},context:{enabled}})[0].slots[0]
  assert.equal(row(true).instanceLabel,'背包')
  assert.equal(row(true).active,true)
  assert.equal(row(false).active,false)
  assert.equal(row(true).fieldMapping.name.label,'名称')
  assert.equal(row(true).fieldMapping.count.label,'数量')
})
