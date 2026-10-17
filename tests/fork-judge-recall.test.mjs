// private fork: tagged English defaults; retain protocol, payload, cache and budget assertions.
// private fork: real catalogue and task owner, fake judge and director; never paid IO.
import test from 'node:test'
import assert from 'node:assert/strict'
import {syntheticPack,cardExtension,PACK_ID,FIGURE_ID,distinctMedia} from './fixtures/asset-packs/pack.mjs'
import {assetRefKey} from '../tavern-plugin/packages/dsh-presentation-protocol/src/asset-packs.js'
import {prepareAssetPackDirector,buildAssetPackRequest} from '../tavern-plugin/lib/domain/stage-asset-pack-director.js'
import {initialAssetPackStage} from '../tavern-plugin/lib/domain/stage-asset-pack-tools.js'
import {selectJudgeRecall,outfitJudgeId} from '../tavern-plugin/lib/domain/stage-judge-recall.js'
import {judgeItemText} from '../tavern-plugin/lib/domain/judge-item-text.js'
import {defaultJudgeConfig,validateJudgeConfig,createEngineJudge} from '../tavern-plugin/lib/domain/engine-judge.js'
import {fixture,deferred} from './helpers/stage-director-harness.mjs'
import {createStageDirector} from '../tavern-plugin/lib/domain/stage-director.js'
const green = {mode:'keyword',keywords:['unmatched-token']} // private fork: priority was retired upstream in this fork.
async function packInput() {
  const pack = await syntheticPack()
  for (const asset of pack.manifest.assets) if (!['skins','directions'].includes(asset.kind)) asset.recall = {...green}
  pack.manifest.assets.push({...pack.manifest.assets.find(a => a.kind === 'music'),id:'blue',recall:{mode:'constant',keywords:[]}})
  pack.manifest.assets.push({...pack.manifest.assets.find(a => a.kind === 'music'),id:'trigger',recall:{...green,keywords:['body']}})
  pack.manifest.assets.push({...pack.manifest.assets.find(a => a.kind === 'music'),id:'off',enabled:false})
  pack.manifest.assets=pack.manifest.assets.map(asset=>['blue','trigger','off'].includes(asset.id)?distinctMedia(asset,asset.id):asset)
  const figure = pack.figures[FIGURE_ID]
  figure.outfits.forEach(outfit => outfit.recall = {...green})
  figure.outfits.push({...structuredClone(figure.outfits[1]),key:'third',label:'Third',guidance:'夜间睡觉'})
  const assetStatus = Object.fromEntries(pack.manifest.assets.map(a => [assetRefKey({packId:PACK_ID,kind:a.kind,assetId:a.id}),{available:true}]))
  return {snapshots:[{...pack,revision:'r1'}],assetStatus,raw:{extensions:{dsh_tavern:cardExtension()}},cardRevision:'card1',engine:{judge:validateJudgeConfig({provider:'jev'}),widgetsEnabled:true},target:{sourceKey:'source1',branchId:'branch1',revision:1},units:['body'],baseline:initialAssetPackStage({actor:{figure:{packId:PACK_ID,figureId:FIGURE_ID},outfits:figure.outfits}})}
}
test('all eligible green kinds are asked; blue, triggers, off, disabled dimensions and default/current outfits are excluded', async () => {
  const input = await packInput(),prepared = prepareAssetPackDirector(input), questions = prepared.judgeQuestions
  for (const kind of ['backgrounds','music','sfx','ambience','looks','widgets']) assert.ok(questions.some(q => q.kind === kind),kind)
  for (const id of ['blue','trigger','off']) assert.ok(!questions.some(q => q.id === assetRefKey({packId:PACK_ID,kind:'music',assetId:id})))
  assert.ok(!questions.some(q => q.id === outfitJudgeId('actor','school')))
  assert.ok(questions.some(q => q.id === outfitJudgeId('actor','third') && q.text === "<judge_request>\nDoes this asset fit this turn's story? [outfit] Third; use when: 夜间睡觉\n</judge_request>"))
  input.baseline.actors.actor.outfitKey = 'third'
  assert.ok(!prepareAssetPackDirector(input).judgeQuestions.some(q => q.id === outfitJudgeId('actor','third')))
  input.engine.dimensions = {music:false}
  assert.ok(!prepareAssetPackDirector(input).judgeQuestions.some(q => q.kind === 'music'))
})
test('judge descriptions drop credits but retain semantic wording, location and usage restrictions', () => {
  assert.equal(judgeItemText('便利店提示音','Entry chime; based on Door Chime 3 by Taira Komori. Play once on entry, not as an ambience loop.','音效'),"<judge_request>\nDoes this asset fit this turn's story? [音效] 便利店提示音; use when: Entry chime. Play once on entry, not as an ambience loop.\n</judge_request>")
  assert.equal(judgeItemText('地下通道','A tiled pedestrian underpass; use for missed connections or a tense encounter.','背景'),"<judge_request>\nDoes this asset fit this turn's story? [背景] 地下通道; use when: A tiled pedestrian underpass; use for missed connections or a tense encounter.\n</judge_request>")
  assert.match(judgeItemText('河岸','只用于河岸、水边，不用于海边。','环境音'),/只用于河岸、水边，不用于海边。\n<\/judge_request>$/)
  assert.match(judgeItemText('Rain','Choose rain; based on the current weather.','环境音'),/Choose rain; based on the current weather\.\n<\/judge_request>$/)
  assert.match(judgeItemText('Chime','Licensed under CC-BY. Only on entry.','音效'),/use when: Only on entry\.\n<\/judge_request>$/)
})
test('threshold is inclusive, per-kind cap ranks probability, and blue/triggers cost no slots', async () => {
  const input = await packInput(),base = prepareAssetPackDirector(input)
  const questions = [...base.judgeQuestions,{id:'lower',kind:'music'},{id:'higher',kind:'music'}]
  const scores = new Map(questions.map(q => [q.id,.6]));scores.set('lower',.59);scores.set('higher',.99)
  const capped = selectJudgeRecall(questions,scores,{threshold:.6,capPerKind:1})
  assert.ok(capped.has('higher'));assert.ok(!capped.has('lower'))
  assert.equal(questions.filter(q => q.kind === 'music' && capped.has(q.id)).length,1)
  const selected = selectJudgeRecall(base.judgeQuestions,new Map(base.judgeQuestions.map(q => [q.id,.6])),{threshold:.6,capPerKind:8})
  const prepared = prepareAssetPackDirector({...input,judgeRecall:selected})
  assert.equal(prepared.context.catalogue.candidates.music.length,3)
  assert.equal(prepared.context.catalogue.candidates.music.filter(q => q.reasons.includes('judge')).length,1)
  assert.ok(buildAssetPackRequest(prepared).inputBytes > buildAssetPackRequest(base).inputBytes)
  assert.deepEqual(selectJudgeRecall(questions,null,{threshold:.6,capPerKind:8}),new Set())
})
test('unset produces identical director wire to the old no-judge engine', async () => {
  const input = await packInput();delete input.engine.judge
  const wire = buildAssetPackRequest(prepareAssetPackDirector(input))
  input.engine.judge = defaultJudgeConfig()
  assert.deepEqual(buildAssetPackRequest(prepareAssetPackDirector(input)),wire)
})
test('final-body task waits for fake judge, preview never calls it and recalled results survive in record', async () => {
  const gate = deferred(),config = validateJudgeConfig({provider:'jev',timeoutMs:1000}),calls = []
  const judge = createEngineJudge({getConfig:() => config,credentials:() => ({resolve:async () => ({value:'fake'})}),fetch:async (_url,options) => {
    calls.push(JSON.parse(options.body));await gate.promise
    return {ok:true,json:async () => ({answers:Object.fromEntries(Object.keys(calls[0].questions).map(id => [id,{type:'noul',noul:.9}]))})}
  }})
  const f = await fixture(async request => {await request.onToolCall({name:'stage_update',arguments:{sequence:1,through:2,done:true,beats:[]}})}, {judge,engineValues:{judge:config},configurePack:pack => {pack.manifest.assets.find(a => a.kind === 'music').recall = {...green}}})
  try {
    const before = await f.director.preview(f.read(),1)
    assert.equal(before.judge.title,'判断模型') /* private fork (judge key, owner 2026-10): renamed */;assert.equal(calls.length,0)
    await f.director.get(f.read(),1)
    for (let i=0;i<100 && !calls.length;i++) await new Promise(resolve => setTimeout(resolve,5))
    assert.equal(calls.length,1);assert.equal(f.calls.length,0)
    assert.equal(calls[0].state,'Synthetic fixture.\n\nSynthetic dusk.')
    gate.resolve();await f.director.drain()
    assert.equal(f.calls.length,1)
    const after = await f.director.preview(f.read(),1)
    assert.equal(calls.length,1)
    assert.ok(after.recall.some(row => row.reasons.includes('judge')))
    assert.ok(f.read().messages.at(-1).stageDirectionAssetPacks.stats.judge.probabilities.length)
    const restarted = createStageDirector({assets:f.assets,judge,foreground:async () => ({provider:'fake',model:'fake'})})
    try {
      const restored = await restarted.preview(f.read(),1)
      assert.deepEqual(restored.recall,after.recall)
      assert.deepEqual(restored.judge,after.judge)
      assert.equal(calls.length,1)
    } finally {await restarted.dispose()}
    f.appendReply(2)
    const next = await f.director.preview(f.read(),2)
    assert.ok(!next.recall.some(row => row.reasons.includes('judge')))
    assert.equal(calls.length,1)
    const body = f.beginReply(3)
    assert.equal(await f.director.beginStream(f.read(),3),null)
    assert.ok(body.operationId)
  } finally {gate.resolve();await f.dispose()}
})

test('judge timeout/error lets the real director continue with triggers only', async () => {
  for (const timeout of [true,false]) {
    const config = validateJudgeConfig({provider:'jev',timeoutMs:10}),logs = []
    const judge = createEngineJudge({getConfig:() => config,credentials:() => ({resolve:async () => ({value:'fake'})}),log:e => logs.push(e),fetch:async () => {
      if (timeout) return new Promise(() => {})
      throw new Error('provider rejected')
    }})
    const f = await fixture(async request => {await request.onToolCall({name:'stage_update',arguments:{sequence:1,through:2,done:true,beats:[]}})}, {judge,engineValues:{judge:config},configurePack:pack => {pack.manifest.assets.find(a => a.kind === 'music').recall = {...green}}})
    try {
      await f.director.get(f.read(),1);await f.director.drain()
      assert.equal(f.calls.length,1) // private fork: no blocked or extra director call on judge failure.
      const preview = await f.director.preview(f.read(),1)
      assert.ok(!preview.recall.some(row => row.reasons.includes('judge')))
      assert.equal(logs[0].code,timeout ? 'JUDGE_TIMEOUT' : 'JUDGE_ERROR')
      assert.ok(logs[0].count > 0)
      assert.ok(logs[0].latencyMs < 500)
    } finally {await f.dispose()}
  }
})
