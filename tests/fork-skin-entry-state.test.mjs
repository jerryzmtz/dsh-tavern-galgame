// private fork (skin ui, owner 2026-10): a standalone 舞台皮肤 entry has no 启用 / 关闭 state — the old `enabled` field fails as
// UNKNOWN_FIELD, every imported skin is offered as the card's 默认舞台皮肤. Barrier performances keep their embedded skins:
// this file proves a 魔女结界-shaped performance (theme inside the performance bundle, `self:` refs) still applies its skin
// on enter, swaps to the level-3 look on the turn and runs `skin-off` on exit.
import test from 'node:test'
import assert from 'node:assert/strict'
import {syntheticPack,cardExtension} from './fixtures/asset-packs/pack.mjs'
import {sealPack,jsonBytes,verifyBytes} from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/validation.js'
import {validateAsset} from '../tavern-plugin/packages/dsh-asset-library/src/asset-packs/manifest.js'
import {createAssetPackPresentation} from '../tavern-plugin/lib/domain/asset-pack-presentation.js'
import {initialAssetPackStage} from '../tavern-plugin/lib/domain/stage-asset-pack-tools.js'
import {expandPerformanceDependencies,performanceReference} from '../fork/mods/performance/projection.js'
import {cardBubbleConfig} from '../tavern-plugin/lib/fork-card-stage.js'
import {defaultAssetEngineSettings} from '../tavern-plugin/lib/domain/asset-engine-settings.js'
import {compilePerformance,performancePlan,performanceBoundary} from '../fork/mods/performance/state.cjs'
import skinContract from '../tavern-plugin/packages/dsh-presentation-protocol/src/stage-skin.cjs'

const salt=()=>({...structuredClone(skinContract.BUILTIN_STAGE_SKINS.magical),id:'salt',label:'海盐'})
const charlotte=()=>({...structuredClone(skinContract.BUILTIN_STAGE_SKINS.gothic),id:'charlotte',label:'夏洛特',levels:{default:2,1:{},2:{},3:{textbox:{paint:{bg:'#1a0010',fg:'#fff0f6'}}}}})
const barrier=()=>({schema:'dsh.performance/1',id:'barrier-charlotte',label:'夏洛特的结界',license:{privateUse:false},packs:{},levels:{default:2,1:{},2:{},3:{}},theme:charlotte(),legacySkinId:'charlotte',
  timeline:{entry:{events:[{at:0,do:'skin',ref:'self:charlotte'}]},turn:{onLevel:3,events:[{at:0,do:'skin',ref:'self:charlotte',level:3}]},exit:{events:[{at:0,do:'skin-off'}]}}})
const recall={mode:'constant',keywords:[]}
async function pack({skinEnabled}={}) {
  const p=await syntheticPack()
  p.manifest.assets.push({kind:'skins',id:'salt',name:'海盐',recall,directorNote:'',bundleKey:'salt',entry:'skin.json',...(skinEnabled===undefined?{}:{enabled:skinEnabled})},
    {kind:'performances',id:'barrier-charlotte',name:'夏洛特的结界',enabled:true,recall,directorNote:'',bundleKey:'perform-charlotte',entry:'performance.json'})
  p.manifest.bundles.salt={kind:'skin',entry:'skin.json',contentHash:'0'.repeat(64)}
  p.manifest.bundles['perform-charlotte']={kind:'performance',entry:'performance.json',contentHash:'0'.repeat(64)}
  p.files.set('bundles/salt/skin.json',jsonBytes(salt()));p.files.set('bundles/perform-charlotte/performance.json',jsonBytes(barrier()))
  await sealPack(p.manifest,p.files);return p
}

test('a standalone skin entry has no enabled field; the old field fails as UNKNOWN_FIELD; other kinds still need it',async()=>{
  const entry={kind:'skins',id:'salt',name:'海盐',recall,directorNote:'',bundleKey:'salt',entry:'skin.json'}
  assert.doesNotThrow(()=>validateAsset(entry))
  for(const enabled of [true,false])assert.throws(()=>validateAsset({...entry,enabled}),error=>error.code==='UNKNOWN_FIELD')
  assert.throws(()=>validateAsset({kind:'performances',id:'x',name:'x',recall,directorNote:'',bundleKey:'x',entry:'p.json'}))
  const old=await pack({skinEnabled:true});await assert.rejects(()=>verifyBytes(old.manifest,old.files),error=>error.code==='UNKNOWN_FIELD')
  const next=await verifyBytes((await pack()).manifest,(await pack()).files);assert.deepEqual(next.skins.salt,salt())
})

test('every imported standalone skin is a 默认舞台皮肤 choice and resolves without an enabled flag',async t=>{
  const p={...await verifyBytes((await pack()).manifest,(await pack()).files),revision:'r1'},ext=cardExtension()
  ext.assetBindings.boundPackIds=[p.manifest.id];ext.stage={defaultSkin:{packId:p.manifest.id,kind:'skins',assetId:'salt'}}
  const config=cardBubbleConfig({extensions:{dsh_tavern:ext}},defaultAssetEngineSettings(),[p])
  assert.ok(config.stage.skinChoices.some(choice=>choice.value?.assetId==='salt'));assert.equal(config.stage.skin.document.id,'salt')
  const service={apiVersion:2,subscribe:()=>()=>{},getPackSnapshot:async()=>p,resolveAssets:async({refs})=>refs.map(r=>({ref:r,diagnostics:[],revision:p.revision,value:p.manifest.assets.find(a=>a.kind===r.kind&&a.id===r.assetId)}))}
  const consumer=createAssetPackPresentation({raw:{extensions:{dsh_tavern:ext}},getService:()=>service,origin:'http://localhost',scope:'test'});t.after(()=>consumer.dispose())
  assert.equal((await consumer.scene({...initialAssetPackStage({}),skin:{ref:null}},{descriptors:true})).skin.document.id,'salt')
})

test('a barrier performance applies its embedded skin on enter, swaps to level 3 on the turn and runs skin-off on exit',async t=>{
  const p={...await verifyBytes((await pack()).manifest,(await pack()).files),revision:'r1'},packId=p.manifest.id,ref={packId,kind:'performances',assetId:'barrier-charlotte'}
  const document=p.performances['barrier-charlotte'];assert.deepEqual(document.theme,charlotte())
  const ext=cardExtension();ext.assetBindings.boundPackIds=[packId];ext.stage={defaultSkin:{packId,kind:'skins',assetId:'salt'}}
  assert.equal(expandPerformanceDependencies({ref,document,snapshots:[p],authorization:{boundPackIds:[packId]}}).unavailable,null)
  const service={apiVersion:2,subscribe:()=>()=>{},getPackSnapshot:async()=>p,resolveAssets:async({refs})=>refs.map(r=>({ref:r,diagnostics:[],revision:p.revision,value:p.manifest.assets.find(a=>a.kind===r.kind&&a.id===r.assetId)}))}
  const consumer=createAssetPackPresentation({raw:{extensions:{dsh_tavern:ext}},getService:()=>service,origin:'http://localhost',scope:'test'});t.after(()=>consumer.dispose())
  const prepared=await consumer.performance({ref,restore:{}},{snapshots:[p],isCurrent:()=>true})
  assert.equal(prepared.unavailable,null);assert.deepEqual(prepared.dependencies.find(d=>d.ref.kind==='skins').document,charlotte())
  // Boundaries and plans: enter (level 2) → turn (level 3) → exit.
  const compiled=compilePerformance(document),resolveEvent=event=>event.ref?{...event,ref:performanceReference(document,ref,event.ref,'skins')}:event
  const skinEvents=plan=>plan.events.map(e=>e.event||e).filter(e=>/^skin/.test(e.do))
  const entered=performanceBoundary(null,{ref,level:2},{turn:1,page:0},document);assert.equal(entered.phase,'entry')
  const entry=skinEvents(performancePlan(compiled,{phase:'entry',level:2,resolveEvent}))
  assert.deepEqual(entry.map(e=>[e.do,e.ref.assetId,e.level]),[['skin','charlotte',undefined]])
  const turned=performanceBoundary(entered,{ref,level:3},{turn:2,page:0},document);assert.equal(turned.phase,'turn')
  const turn=skinEvents(performancePlan(compiled,{phase:'turn',level:3,resolveEvent}))
  assert.deepEqual(turn.map(e=>[e.do,e.ref.assetId,e.level]),[['skin','charlotte',3]])
  assert.equal(skinContract.stageSkinAppearance(document.theme,3).textbox.paint.bg,'#1a0010')
  const exited=performanceBoundary(turned,{ref,off:true},{turn:3,page:0},document);assert.equal(exited.phase,'exit')
  assert.deepEqual(skinEvents(performancePlan(compiled,{phase:'exit',level:3,resolveEvent})).map(e=>e.do),['skin-off'])
  // The stage resolves the embedded skin at level 3 from the performance's own bundle; skin-off (null) restores the card's
  // default — a standalone skin with no enabled field.
  const state=initialAssetPackStage({}),scene=await consumer.scene({...state,skin:{ref:{packId,kind:'skins',assetId:'charlotte'},level:3}},{descriptors:true})
  assert.deepEqual(scene.skin.document,charlotte());assert.equal(scene.skin.level,3);assert.deepEqual(scene.skin.url.ref,ref);assert.equal(scene.skin.url.bundleKey,'perform-charlotte')
  assert.equal((await consumer.scene({...state,skin:{ref:null}},{descriptors:true})).skin.document.id,'salt')
})
