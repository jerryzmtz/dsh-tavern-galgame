import {tmpdir as publicTmpdir} from 'node:os';
import {join as publicJoin} from 'node:path';
// private fork: rollback restores the native section, not a compatibility shim or live data.
import test from 'node:test'
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {mkdtemp,writeFile} from 'node:fs/promises'
import {createAssetEngineSettings} from '../tavern-plugin/lib/fork-asset-engine.js'
const root=new URL('../',import.meta.url),base='addaacc98e937dcfcc5dd3d37504b0465286c54a'
test('V3 native save then old-code plus original-section restore is a lossless rollback',async()=>{
 const directory=await mkdtemp(publicJoin(publicTmpdir(), 'widget-rollback-')),dir=new URL('file:///'+directory.replaceAll('\\','/')+'/')
 const source=path=>execFileSync('git',['show',base+':'+path],{cwd:root,encoding:'utf8'})
 const commandPath='tavern-plugin/packages/dsh-presentation-protocol/src/director-commands.cjs'
 await writeFile(new URL('commands.cjs',dir),source(commandPath))
 for(const [path,name] of [['tavern-plugin/lib/domain/asset-engine-settings.js','settings.mjs'],['tavern-plugin/lib/fork-asset-engine.js','engine.mjs']]){
  let text=source(path).replace(/from '(\.\.?\/[^']+)'/g,(_match,relative)=>{
   const url=new URL(relative,new URL(path,root))
   return 'from '+JSON.stringify(url.href.endsWith('/director-commands.cjs')?new URL('commands.cjs',dir).href:url.href.endsWith('/domain/asset-engine-settings.js')?new URL('settings.mjs',dir).href:url.href)
  })
  await writeFile(new URL(name,dir),text)
 }
 const old=await import(new URL('settings.mjs',dir)),oldFactory=(await import(new URL('engine.mjs',dir))).createAssetEngineSettings
 const original=old.defaultAssetEngineSettings();original.dimensions.phone=false;original.widgetExecutionEnabled=true
 original.widgetAuthorizations={'11111111-1111-4111-8111-111111111111/widgets/clock':'a'.repeat(64)}
 original.directionStyles=[{format:'dsh-direction-style',schemaVersion:1,id:'custom',name:'Custom',rules:[{id:'pace',requires:['widgets'],text:'Keep a quiet pace.'}]}];original.directionStyle='custom'
 let stored={'tavern-asset-engine':structuredClone(original)}
 async function mount(factory){
  let hooks,source,dispose,engine
  const provider={writable:true,installSection(_ctx,ns,schema,entry,callbacks){hooks=callbacks;source=schema(stored[ns] || entry);hooks.setSource(()=>source)},
   async replace(ns,value){source=hooks.validate(value);stored={...stored,[ns]:structuredClone(source)}}}
  const ctx={get:name=>name==='settings'?provider:engine,inject(_keys,callback){callback(ctx)},effect(callback){dispose=callback()},fiber:{dispose:()=>dispose()}}
  engine=factory(ctx);return ctx
 }
 const backup=JSON.stringify(stored),before=await mount(oldFactory)
 try {assert.deepEqual(before.get('engine').read().values,original)} finally {await before.fiber.dispose()}
 // private fork: the character-v3 cutover requires an offline field removal before mounting new code.
 // Keep the original backup intact so rollback still verifies the exact old native section.
 delete stored['tavern-asset-engine'].defaultStageForm
 delete stored['tavern-asset-engine'].directionStyle
 delete stored['tavern-asset-engine'].directionStyles
 const v3=await mount(createAssetEngineSettings)
 try {const engine=v3.get('engine');await engine.save({expectedRevision:engine.read().revision,patch:{stageToggles:{music:false}} /* private fork: retired widget setting is not writable */})} finally {await v3.fiber.dispose()}
 assert.equal(Object.hasOwn(stored['tavern-asset-engine'].dimensions,'phone'),false)
 assert.equal(Object.hasOwn(stored['tavern-asset-engine'],'widgetAuthorizations'),false)
 // private fork (owner 2026-10 r3): new code drops the retired dialogue.enabled; a rollback restores it (old code requires it).
 // private fork: judge is a new engine field; an old-code rollback uses the original section, not this new field.
 const rollback=({judge:_judge,stageToggles:_stageToggles,...value})=>({...value,dialogue:{enabled:true,...value.dialogue}})
 const widgetSettings=stored['tavern-asset-engine'] // private fork: vector settings removed
 assert.equal(widgetSettings.dimensions.cg,true) // private fork: added switch initializes on read/save, not an old-command alias
 const {cg,...oldDimensions}=widgetSettings.dimensions
 assert.throws(()=>old.validateAssetEngineSettings({...old.defaultAssetEngineSettings(),...rollback(widgetSettings),dimensions:{...oldDimensions,focus:true,'focus.close':true}}),error=>error.path==='$.dimensions.phone' /* private fork: old code also requires the now-retired focus dimensions */)
 stored=JSON.parse(backup)
 const restored=await mount(oldFactory)
 try {assert.deepEqual(restored.get('engine').read().values,original);assert.equal(JSON.stringify(stored),backup)} finally {await restored.fiber.dispose()}
})
