// Journey Top 7: an accepted mod command must survive a transient host conflict.
import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createBuiltinModService} from '../tavern-plugin/lib/fork-mod-service.js'
import {validateJudgeConfig} from '../tavern-plugin/lib/domain/engine-judge.js'
import {fixture} from './helpers/stage-director-harness.mjs'
import {modelRequest} from './helpers/director-model-call.mjs'
import {createStageDirector} from '../tavern-plugin/lib/domain/stage-director.js'
import {directorPromptData} from './fixtures/asset-packs/prompt.mjs'

for (const restart of [false,true]) test(`conflict retry keeps selection/recall without re-judging (restart=${restart}); new decisions stay fresh`,async t=>{
  const root=await mkdtemp(join(tmpdir(),'director-mod-retry-'))
  t.after(()=>rm(root,{recursive:true,force:true}))
  let value={global:{enabledModIds:[],mods:{}},grants:{}},revision=0
  const listeners=new Set(),settings={read:()=>({revision:String(revision),value:structuredClone(value)}),subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn)},
    async compareAndSwap(input){assert.equal(input.expectedRevision,String(revision));value=structuredClone(input.value);revision++;for(const fn of listeners)fn();return settings.read()}}
  const service=createBuiltinModService({root,settings,cards:{list:async()=>[],read:async()=>({revision:'c1',value:null})},variables:{},
    readCard:async()=>({meta:{id:'card-a'}}),stage:{read:async()=>undefined,update:async()=>{}}})
  t.after(()=>service.dispose())
  const authority={origin:'https://offline.test'}
  let listed=await service.call('listMods',{},authority)
  for(const [method,args] of [['authorizeMod',{allowed:true}],['setModScope',{scope:'global'}]])
    listed=await service.call(method,{modId:'dsh.textcard',...args,expectedRevision:listed.revision},authority)
  const config=validateJudgeConfig({provider:'jev'}),requests=[],logs=[]
  let judgeCalls=0,conflict=true
  const judge={enabled:()=>true,preview:()=>({title:'offline judge'}),async judge({questions}){
    judgeCalls++;return new Map(questions.map(row=>[row.id,judgeCalls===1 ? .9 : .1]))
  }}
  const runModel=async request=>{
    requests.push(directorPromptData(request))
    const selected=requests.at(-1).allowedCommands.includes('text.show')
    const reply=JSON.parse(await request.onToolCall({name:'stage_update',arguments:{sequence:1,through:2,done:true,
      beats:selected?[{at:1,ops:[{op:'text.show',placement:'after',preset:'word',text:'A sudden realization'}]}]:[]}}))
    assert.equal(reply.ok,true)
    if(conflict){conflict=false;throw Object.assign(new Error('Offline revision conflict'),{code:'REVISION_CONFLICT'})}
  }
  const h=await fixture(runModel,{mods:service,judge,log:event=>logs.push(event),engineValues:{judge:config},
    configurePack:pack=>{pack.manifest.assets.find(row=>row.kind==='music').recall={mode:'keyword',keywords:['unmatched-token']}}})
  t.after(()=>h.dispose())
  await h.director.get(h.read(),1);await h.director.drain()
  const failed=h.read().messages.at(-1).stageDirectionAssetPacksFailure
  assert.equal(failed.code,'REVISION_CONFLICT')
  const firstSelection=failed.preview.binding.mods.selection
  assert.equal(firstSelection.mods.find(row=>row.id==='dsh.textcard').selected,true)
  let director=h.director
  if (restart) {
    await director.dispose()
    director=createStageDirector({assets:h.assets,mods:service,judge,log:event=>logs.push(event),foreground:async()=>({provider:'fake',model:'fake'}),
      beginTask:chat=>h.tasks.begin(chat,'stage-director'),runAgent:request=>runModel(modelRequest(request)),
      resetTask:async(_chat,turn,{regenerate})=>h.store.updateChat('chat',chat=>{
        const message=chat.messages.findLast(row=>row.role==='assistant' && row.turn===turn)
        message.stageDirectionGeneration=(message.stageDirectionGeneration || 0)+1
        delete message.stageDirectionAssetPacksDraft;delete message.stageDirectionAssetPacksFailure
        if(regenerate)delete message.stageDirectionAssetPacks
        return chat
      })})
    t.after(()=>director.dispose())
  }
  const reset=await director.retry(h.read(),1,{regenerate:true})
  await director.get(reset.chat,1,{},{generate:true});await director.drain()
  assert.equal(judgeCalls,1,'retry must not ask the judge again')
  const record=h.read().messages.at(-1).stageDirectionAssetPacks
  assert.deepEqual(record.binding.mods.selection,firstSelection)
  assert.equal(record.entries[0].ops[0].modId,'dsh.textcard')
  assert.deepEqual(requests[1].catalogue,requests[0].catalogue,'judge-only green recalls survive')
  assert.ok(record.stats.judge.probabilities.every(([id])=>!id.startsWith('mod-relevance:')))
  const usage=logs.findLast(row=>row.kind==='director-mods' && row.phase==='committed')
  assert.deepEqual(usage.selected,['dsh.textcard']);assert.deepEqual(usage.used,['dsh.textcard'])
  h.appendReply(2)
  await director.get(h.read(),2);await director.drain()
  assert.equal(judgeCalls,2)
  assert.equal(h.read().messages.at(-1).stageDirectionAssetPacks.binding.mods.selection.mods[0].selected,true)
  assert.deepEqual(logs.findLast(row=>row.kind==='director-mods' && row.phase==='committed').used,['dsh.textcard'])
  const regenerated=await director.retry(h.read(),2,{regenerate:true})
  await director.get(regenerated.chat,2,{},{generate:true});await director.drain()
  assert.equal(judgeCalls,3,'explicit regeneration of a successful turn is a new decision')
})
