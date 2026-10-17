import test from 'node:test'
import assert from 'node:assert/strict'
import {parseFormula,evaluateFormula} from '../tavern-plugin/lib/domain/mods/config-formula.js'

test('arithmetic, Unicode operators, functions, JSON strings and source identity',async()=>{
  assert.deepEqual(await evaluateFormula('clamp(round(9 / 2) + abs(-2) × 3, 0, 10)',()=>0),{value:10})
  assert.deepEqual(await evaluateFormula('min(8, max(floor(2.9), ceil(3.1))) − 1',()=>0),{value:3})
  assert.deepEqual(await evaluateFormula('"HP: " + {mvu:/侦探/hp}',ref=>{assert.deepEqual(ref,{source:'mvu',path:'/侦探/hp'});return 42}),{value:'HP: 42'})
  assert.deepEqual(await evaluateFormula('{mod:dsh.phone:/battery} ÷ 2',ref=>{assert.equal(ref.source,'mod:dsh.phone');return 80}),{value:40})
})
test('precise syntax, arity, reference and numerical errors, no script evaluation',async()=>{
  for(const [text,code,position] of [['1 +','FORMULA_SYNTAX',3],['1 / 0','FORMULA_MATH',2],['abs(1,2)','FORMULA_SYNTAX',0],['evil()','FORMULA_SYNTAX',0],['1..2','FORMULA_SYNTAX',2],['"x" * 2','FORMULA_TYPE',4],['1e999','FORMULA_MATH',0],['{mvu:/hp','FORMULA_SYNTAX',0],['clamp(1, 3, 2)','FORMULA_MATH',0]]) {
    const result=await evaluateFormula(text,()=>0)
    assert.equal(result.error?.code,code,text);assert.equal(result.error.position,position,text);assert.ok(result.error.message)
  }
  const result=await evaluateFormula('1 + {stage:/missing}',()=>{throw Object.assign(new Error('Unavailable'),{code:'SOURCE_MISSING'})})
  assert.deepEqual(result.error,{code:'SOURCE_MISSING',message:'Unavailable',position:4})
  assert.equal(parseFormula('('.repeat(100)+'1'+')'.repeat(100)).error.code,'FORMULA_SYNTAX')
  assert.equal(parseFormula('globalThis.executed = true').error.code,'FORMULA_SYNTAX');assert.equal(globalThis.executed,undefined)
})
