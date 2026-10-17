import test from 'node:test'
import assert from 'node:assert/strict'
import {resolveSlot,resolveVariable,guessVariables,analyzeVariableSchema,normalizeVariableFormat,variableGuessHints} from '../tavern-plugin/lib/domain/variable-bindings/index.js'
const slot=key=>({target:{kind:'mods',modId:'test.phone',slot:key},valueType:key==='inventory'?'array':'string',default:key==='inventory'?[]:'09:41',guessHints:variableGuessHints[key]})
const fixtures=[
  {id:'card-42',label:'小圆',value:{世界状态:{时间:['08:10','剧情时间'],日期:['2011年4月8日','日期']}},path:'/世界状态/时间',expected:'08:10'},
  {id:'card-73',label:'日本語の世界',value:{環境:{現在時刻:['午後 3時半','現在の時刻'],日付:'4月3日'}},path:'/環境/現在時刻',expected:'15:30'},
  {id:'card-91',label:'Detective',value:{world:{clock:'01:00:59'},player:{birthday:'1998-02-03',hp:13}},path:'/world/clock',expected:'01:00'},
]
test('live candidates reuse binding ranker with Chinese/Japanese keys and independent card ids',()=>{
  for(const fixture of fixtures) {
    assert.notEqual(fixture.id,fixture.label)
    const result=resolveSlot(slot('time'),null,[],{mvu:{available:true,value:fixture.value}})
    assert.equal(result.value,fixture.expected);assert.equal(result.variable.path,fixture.path);assert.ok(result.candidates[0].score>=65)
  }
  const result=resolveVariable({source:'mvu',path:'/世界状态/时间'},{mvu:{available:true,value:fixtures[0].value}})
  assert.equal(result.value,'08:10')
})
test('conservative defaults, context/depth/stability, arrays, deterministic ties, static initvar',()=>{
  assert.equal(resolveSlot(slot('time'),null,[],{mvu:{available:true,value:{HP:90,能量:10,持续时间:'03:00'}}}).value,'09:41')
  const source={mvu:{available:true,value:{world:{time:'12:05'},人物:{time:'22:00'}}}}
  const ranked=guessVariables([],slot('time'),source,[{world:{time:'12:00'},人物:{time:'23:00'}}])
  assert.equal(ranked[0].variable.path,'/world/time');assert.ok(ranked[0].reasons.some(row=>row.reason==='recent-stability' && row.points>0))
  const inventory=resolveSlot(slot('inventory'),null,[],{mvu:{available:true,value:{所持品:[{id:'item-11',名称:'钥匙'}]}}})
  assert.equal(inventory.variable.path,'/所持品');assert.equal(inventory.value[0].id,'item-11')
  const raw={name:'静态',character_book:{entries:[{comment:'initvar',content:'世界:\n  时间: "01:00"'}]}}
  const rankedStatic=guessVariables(analyzeVariableSchema(raw),slot('time'))
  assert.equal(rankedStatic[0].value,'01:00');assert.ok(rankedStatic[0].score>=65)
  const tied={mvu:{available:true,value:{b:{time:'12:00'},a:{time:'12:00'}}}}
  assert.equal(guessVariables([],slot('time'),tied)[0].variable.path,'/a/time')
})
test('normalisation rejects impossible clocks/dates, supports ISO, local forms and days',()=>{
  for(const [input,expected] of [['下午 1点','13:00'],['晚上十一点半','23:30'],['午前 12時','00:00'],['2024-02-29T09:41:00Z','09:41'],['23:59:59','23:59']])assert.equal(normalizeVariableFormat(input,'time')?.value,expected,input)
  for(const input of ['25:00','12:99','12:30:90','HP 50'])assert.equal(normalizeVariableFormat(input,'time'),null,input)
  assert.equal(normalizeVariableFormat('第12天','date').value,'第12天')
  assert.equal(normalizeVariableFormat('4月3日','date').value,'04-03')
  assert.equal(normalizeVariableFormat('2023-02-29','date'),null)
  assert.equal(normalizeVariableFormat('月曜日','weekday').value,'星期一')
})
