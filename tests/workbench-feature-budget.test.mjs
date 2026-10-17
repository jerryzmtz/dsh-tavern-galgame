import test from 'node:test'
import assert from 'node:assert/strict'
import {assertSupportedJsonSchema} from '@deepseek-ai/dsh-tools'
import {registerWorkbenchFeatureTools} from '../tavern-plugin/lib/tools/workbench-features.js'
import {registerScriptTool} from '../tavern-plugin/lib/tools/script.js'
import {WORKBENCH_SKILLS} from '../tavern-plugin/lib/domain/workbench-feature-schema.js'
import {createSkillGatedTools} from '../tavern-plugin/lib/domain/skill-gated-tools.js'

export function featureBudget() {
  const tools=[];registerWorkbenchFeatureTools({tools:{register:t=>tools.push(t)},host:{}})
  registerScriptTool({tools:{register:t=>tools.push(t)}})
  const sizes=Object.fromEntries(tools.map(({name,description,parameters})=>[name,Buffer.byteLength(JSON.stringify({name,description,parameters}))+1]))
  return {tools,sizes,skills:Object.fromEntries(Object.entries(WORKBENCH_SKILLS).map(([name,names])=>[name,[...new Set(names)].reduce((n,key)=>n+sizes[key],0)])),all:Object.values(sizes).reduce((a,b)=>a+b,0)}
}
test('compiled feature schemas fit 10 KiB per skill and 25 KiB together; default adds zero',()=>{
  const {tools,skills,all}=featureBudget(),names=tools.map(t=>t.name),visible=createSkillGatedTools()
  tools.forEach(t=>assertSupportedJsonSchema(t.parameters))
  assert.deepEqual(visible(names,{id:'empty',events:[]}),[])
  for(const [name,size]of Object.entries(skills)) {
    assert.ok(size<=10*1024,`${name}: ${size}`)
    const session={id:name,events:[{type:'tool/result',data:{content:`<skill_content name="${name}">`}}]}
    assert.deepEqual(visible(names,session).sort(),[...WORKBENCH_SKILLS[name]].sort())
  }
  assert.ok(all<=25*1024,`${all}`)
  const session={id:'combined',events:Object.keys(WORKBENCH_SKILLS).map(name=>({type:'user/message',data:{text:`<skill_content name="${name}">`}}))}
  assert.equal(new Set(visible(names,session)).size,names.length)
  assert.deepEqual(visible(names,{id:'other',events:[]}),[])
})
