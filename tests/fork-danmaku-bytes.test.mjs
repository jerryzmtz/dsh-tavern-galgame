import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {performanceFixture} from './helpers/performance-director-fixture.mjs'
import {buildAssetPackRequest} from '../tavern-plugin/lib/domain/stage-asset-pack-director.js'
import {compileModPrompts} from '../tavern-plugin/lib/domain/mods/prompts.js'
import {registerModCommands} from '../tavern-plugin/lib/domain/mods/commands.js'
import {foregroundCapabilityEntries} from '../tavern-plugin/lib/domain/foreground-capabilities.js'
import {validateModSettingsSchema,modSettingValue} from '../tavern-plugin/lib/domain/mods/settings.js'
import {projectView,sourceOf} from '../fork/mods/danmaku/contract.js'
import {validateAsset} from '../tavern-plugin/packages/dsh-asset-library/lib/asset-packs/manifest.js'
import {assetContent} from '../tavern-plugin/packages/dsh-presentation-protocol/src/asset-variant-content.js'

const manifest=JSON.parse(await readFile(new URL('../fork/mods/danmaku/manifest.json',import.meta.url),'utf8'))
const bytes=value=>Buffer.byteLength(typeof value==='string'?value:JSON.stringify(value))

test('view is stored globally but exposed only to stage controls; display contracts share the 32-entry cap',()=>{
  validateModSettingsSchema(manifest.settingsSchema,'$.settingsSchema',true,manifest.id)
  const view=manifest.settingsSchema.fields.find(row=>row.key==='view')
  assert.deepEqual(view.choices.map(row=>row.value),['overlay','sidebar','off'])
  assert.equal(view.scope,'global');assert.equal(modSettingValue(view,'off',manifest.id),true)
  const shown=manifest.ui.layout.filter(row=>row.section).flatMap(row=>manifest.settingsSchema.sections.find(section=>section.id===row.section).fields)
  assert.deepEqual(shown,[])
  assert.deepEqual(manifest.settingsSchema.sections.find(row=>row.id==='stage-config').fields,['density','area','opacity','fontScale'])
  for(const [key,value] of [['area','half'],['opacity',65],['fontScale',120]]) {
    const field=manifest.settingsSchema.fields.find(row=>row.key===key)
    assert.equal(field.scope,'global');assert.equal(modSettingValue(field,value,manifest.id),true)
  }
  for(const layer of manifest.uiLayers)assert.equal(layer.budget.maxVisible,32)
  const context={sessionId:'s',branchId:'b',sourceKey:'source',generation:1,textVersion:'v',mode:'live'}
  const anchor={sourceKey:'source',part:'body',paragraph:1,charOffset:0}
  const records=Array.from({length:8},(_,batch)=>({anchor,record:{type:'batch',batch:{source:sourceOf(context),offsetMs:0,
    comments:Array.from({length:6},(_,index)=>({id:`${batch}-${index}`,offsetMs:0,kind:'comment'}))}}}))
  assert.equal(projectView({context,anchor,records,silent:false,active:true}).sidebar.items.length,32)
  const off=projectView({context,anchor,records,silent:false,active:true,settings:{view:'off',reducedMotion:true}})
  assert.equal(off.view,'off');assert.equal(off.active,false);assert.deepEqual(off.batches,[])
  const display=projectView({context,anchor,settings:{area:'half',opacity:65,fontScale:120}}).settings
  assert.equal(display.area,'half');assert.equal(display.opacity,65);assert.equal(display.fontScale,120)
  assert.deepEqual(['area','opacity','fontScale'].map(key=>off.settings[key]),['three-quarter',90,100])
})

test('nine bundled audience entries use the ordinary import boundary and flat variant content',async()=>{
  assert.equal(manifest.builtinAssets.length,9)
  for(const file of manifest.builtinAssets) {
    const asset=JSON.parse(await readFile(new URL('../fork/mods/danmaku/'+file.path,import.meta.url),'utf8'))
    assert.equal(validateAsset(asset),asset)
    assert.equal(asset.kind,'audience');assert.ok(asset.content.nicknamePool.length)
    const {content,...metadata}=asset
    const variant={...metadata,variants:{default:'default',entries:[{id:'default',name:'Default',content}]}}
    assert.equal(validateAsset(variant),variant)
    assert.deepEqual(assetContent(variant).content,content)
    assert.throws(()=>validateAsset({...asset,content:{...content,nicknamePool:[]}}),/nicknamePool/)
  }
})

test('P6 declaration adds 0B to real director builder tools/system/messages and foreground capability projection',async t=>{
  const f=await performanceFixture(),prepared=await f.prepare()
  const baseline=buildAssetPackRequest(prepared,true,undefined,'',true)
  const foreground=foregroundCapabilityEntries({characters:[],enabled:false},{messages:[]})
  assert.deepEqual(manifest.commands,[])
  assert.deepEqual(manifest.prompts.map(row=>row.target),['model'])
  const measurements=[]
  for(const state of ['not-installed','off','on-empty','on-mixed']) {
    const installed=state==='not-installed'?[]:[manifest]
    const admitted=state==='on-mixed'?installed:[]
    const commands=[...(prepared.context.modCommands || []),...registerModCommands(admitted)]
    const schemaCommands=[...(prepared.context.schemaModCommands || []),...registerModCommands(installed)]
    const fragments=[...(prepared.mods?.fragments || []),...compileModPrompts(admitted,()=>assert.fail('A director must not read the audience model prompt'))]
    const value=buildAssetPackRequest({...prepared,mods:{...prepared.mods,commands,schemaCommands,fragments},
      context:{...prepared.context,modCommands:commands,schemaModCommands:schemaCommands}},true,undefined,'',true)
    for(const key of ['system','messages','tools','sections'])assert.deepEqual(value[key],baseline[key],state+':'+key)
    for(const target of ['director','settlement','foreground'])assert.deepEqual(compileModPrompts(installed,()=>assert.fail('No non-model prompt'),target),[])
    const actualForeground=foregroundCapabilityEntries({characters:[],enabled:false},{messages:[]})
    assert.deepEqual(actualForeground,foreground)
    measurements.push({state,systemBytes:bytes(value.system),messagesBytes:bytes(value.messages),toolSchemaBytes:bytes(value.tools[0].parameters),
      directorDeltaBytes:0,foregroundDeltaBytes:0,schemaDeltaBytes:0,
      sectionBytes:Object.fromEntries(value.sections.map(row=>[row.key,row.bytes]))})
  }
  t.diagnostic(JSON.stringify({scope:'real builders with isolated declaration; pending registry/audience integration',measurements}))
})
