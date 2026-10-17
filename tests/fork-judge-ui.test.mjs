// private fork (judge ui, owner 2026-10): 舞台设置 › 智能判断 — the row's state words, the provider presets (the backend
// defaults), and what keeps a draft from being saved. The page itself is checked in tests/harness/judge-ui.mjs.
// private fork (judge key, owner 2026-10): the section is 「判断模型」 with no provider badge (judgeStateText is gone), and the
// key is the 「API Key」 field saved by the host — the draft never edits keyName, so it is no draft problem.
import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import {assetRenderer} from './fixtures/asset-editor-renderer.mjs'
import {stageSource} from './harness/card-centric-stage.mjs'
import {JUDGE_PROVIDERS,defaultJudgeConfig,validateJudgeConfig} from '../tavern-plugin/lib/domain/engine-judge.js'

const {source,picker}=await stageSource()
function stageHelpers(){
  const r=assetRenderer(),context={TextEncoder,URL,setTimeout,clearTimeout,setInterval,clearInterval,Date,
    localStorage:{getItem:()=>null,setItem(){}},sessionStorage:{getItem:()=>null,setItem(){},removeItem(){}},document:{activeElement:null,addEventListener(){},removeEventListener(){}}}
  vm.runInNewContext(source+';this.create=createForkAssetPackUI;',context)
  context.React=r.React;vm.runInNewContext(picker,context)
  const views=context.create(r.React,{VoicePicker:context.ForkBubbleLibraryPicker,AvatarImage:p=>r.React.createElement('img',p),emotions:{moods:[],palette:['#111111'],max:8}})
  return {stage:views.stage,dispose:()=>r.dispose()}
}

test('判断模型 provider presets follow the backend defaults', t=>{
  const {stage,dispose}=stageHelpers();t.after(dispose)
  const base=defaultJudgeConfig()
  assert.equal(stage.judgeStateText,undefined,'no provider badge')
  for(const provider of ['jev','openai','openai-compatible']){
    const next=stage.judgeWithProvider(base,provider)
    assert.deepEqual([next.model,next.keyName],[JUDGE_PROVIDERS[provider].model,JUDGE_PROVIDERS[provider].keyName],provider)
  }
  // Back to 未设置 clears the provider fields (a valid stored config), and a compatible URL does not follow to Jev.
  const compatible={...stage.judgeWithProvider(base,'openai-compatible'),baseUrl:'https://fake.example/v1'}
  assert.deepEqual(validateJudgeConfig(JSON.parse(JSON.stringify(stage.judgeWithProvider(compatible,'unset')))),base)
  assert.equal(stage.judgeWithProvider(compatible,'jev').baseUrl,'')
  assert.doesNotThrow(()=>validateJudgeConfig(JSON.parse(JSON.stringify(stage.judgeWithProvider(compatible,'jev')))))
})

test('判断模型 draft problems match the backend validation', t=>{
  const {stage,dispose}=stageHelpers();t.after(dispose)
  const base=defaultJudgeConfig(),compatible=stage.judgeWithProvider(base,'openai-compatible')
  const cases=[[base,''],[stage.judgeWithProvider(base,'jev'),''],[compatible,'请填写接口地址'],[{...compatible,baseUrl:'ftp://fake.example'},'请填写 http(s) 地址'],
    [{...compatible,baseUrl:'https://user:pw@fake.example'},'地址里不能带账号、参数或 #'],[{...compatible,baseUrl:'https://fake.example/v1?x=1'},'地址里不能带账号、参数或 #'],
    [{...compatible,baseUrl:'https://fake.example/v1'},''],[{...stage.judgeWithProvider(base,'openai'),model:' '},'请填写模型']]
  for(const [config,problem] of cases){
    const plain=JSON.parse(JSON.stringify(config))
    assert.equal(stage.judgeDraftProblem(plain),problem,JSON.stringify(plain))
    if(problem)assert.throws(()=>validateJudgeConfig(plain));else assert.doesNotThrow(()=>validateJudgeConfig(plain))
  }
})
