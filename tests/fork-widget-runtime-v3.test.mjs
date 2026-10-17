import {tmpdir as publicTmpdir} from 'node:os';
import {join as publicJoin} from 'node:path';
// private fork: pack-only cards do not persist empty retired character tables.
import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,readFile,mkdir} from 'node:fs/promises'
import {createServer} from 'node:http'
import {chromium} from 'playwright'
import {browserReactScript} from './fixtures/browser-react.mjs'
import {writePhonePack,PHONE_PACK_ID} from './fixtures/source-widget/fork-build-phone-widget.mjs'
import {createAssetPackService} from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/service.js'
import {createAssetPackPresentation} from '../tavern-plugin/lib/domain/asset-pack-presentation.js'
import {defaultAssetEngineSettings} from '../tavern-plugin/lib/domain/asset-engine-settings.js'
import {createForkWidgetMedia} from '../tavern-plugin/src/client/fork-widget-media.cjs'
const root=new URL('../',import.meta.url),ref={packId:PHONE_PACK_ID,kind:'widgets',assetId:'phone'}
async function fixture(t){
 const dir=await mkdtemp(publicJoin(publicTmpdir(), 'widget-runtime-')),service=createAssetPackService({assetRoot:dir+'/store',authorizeLease:async()=>true})
 t.after(()=>service.dispose());await writePhonePack(dir+'/phone.zip')
 const preview=await service.inspectImport({bytes:await readFile(dir+'/phone.zip')})
 return {service,preview}
}
test('import consent is one server-side decision; copying never creates grants; leases follow item/module availability',async t=>{
 const {service,preview}=await fixture(t)
 assert.ok(preview.scriptRisk.some(row=>row.path.endsWith('index.js')))
 const input={inspectionId:preview.inspectionId,expectedRevision:null,decision:'install'}
 await assert.rejects(service.applyImport(input),e=>e.code==='SCRIPT_CONFIRMATION_REQUIRED')
 assert.equal((await service.listPacks()).length,0)
 const result=await service.applyImport({...input,acceptScriptRisk:true});assert.equal(result.status,'installed')
 assert.equal('inspectWidgetPermissions' in service,false)
 const copied=await service.copyItems({sourcePackId:PHONE_PACK_ID,itemRefs:[{kind:'widgets',id:'phone'}],target:{newPackName:'Copy'}})
 assert.ok(copied.packId)
 const engine=defaultAssetEngineSettings();assert.equal('widgetExecutionEnabled' in engine,false);assert.equal('widgetAuthorizations' in engine,false)
 const presentation=createAssetPackPresentation({raw:{extensions:{dsh_tavern:{schemaVersion:1,stage:{widgets:true},assetBindings:{boundPackIds:[PHONE_PACK_ID]}}}},getService:()=>service,origin:'http://localhost',scope:'test'})
 t.after(()=>presentation.dispose())
 const state={widgets:{}},options={engine,isCurrent:()=>true,sourceRefs:[ref]}
 const [widget]=await presentation.widgets(state,options)
 assert.match(widget.definition.url,/index\.html$/);assert.equal(widget.sourceOnly,true);assert.equal(widget.definition.assets.message.kind,'sfx')
 // private fork: cached historical ticket cannot outlive its source authorization.
 let sourceAllowed=true
 const [historical]=await presentation.widgets(state,{...options,grantKey:'historical-window',authorizeSource:async()=>sourceAllowed})
 const url=historical.definition.url,ticket=url.match(/\/lease\/([^/]+)\//)[1],request=new Request('http://localhost'+url)
 assert.equal((await service.respondLease({ticket,resource:'index.html',request})).status,200)
 sourceAllowed=false;await assert.rejects(service.respondLease({ticket,resource:'index.html',request}),error=>error.code==='WIDGET_UNAUTHORIZED')
 sourceAllowed=true
 const [renewed]=await presentation.widgets(state,{...options,grantKey:'next-window',authorizeSource:async()=>sourceAllowed})
 assert.notEqual(renewed.definition.url,url)
 await assert.rejects(service.respondLease({ticket,resource:'index.html',request}),error=>error.code==='ASSET_UNAVAILABLE')
 // private fork: the retired engine setting cannot override an explicit card opt-in.
 assert.equal((await presentation.widgets(state,{...options,engine:{...engine,dimensions:{...engine.dimensions,widgets:false}}})).length,1)
 const disabled=structuredClone(result.snapshot.manifest.assets);disabled[0].enabled=false
 await service.patchPack({packId:PHONE_PACK_ID,expectedRevision:result.snapshot.revision,patch:{assets:disabled}})
 await presentation.sync([{packId:PHONE_PACK_ID}])
 assert.deepEqual(await presentation.widgets(state,options),[])
})
test('private media scopes enforce freshness, module gates, one BGM, history/skip suppression and lease refresh identity',()=>{
 const made=[],scheduled=[];const owner=createForkWidgetMedia({createAudio:url=>{const audio={url,paused:true,play(){this.paused=false;return Promise.resolve()},pause(){this.paused=true}};made.push(audio);return audio},schedule:fn=>{scheduled.push(fn);return fn},cancel:fn=>scheduled.splice(scheduled.indexOf(fn),1)})
 const a=owner.acquire('one'),value={active:true,policy:{music:true,sfx:true},assets:{bell:{kind:'sfx',identity:'bell',url:'one.wav'},bg:{kind:'music',identity:'bg',url:'one.mp3'}},playback:{mode:'live',fresh:true,eventToken:'e1'}}
 a.update(value);assert.equal(a.play('bell','wrong'),false);assert.equal(a.play('bell','e1'),true);assert.equal(a.play('bell','e1'),false)
 assert.equal(a.play('bg'),true);const music=made.at(-1)
 a.dispose();const b=owner.acquire('one');b.update({...value,assets:{...value.assets,bg:{...value.assets.bg,url:'renewed.mp3'}}});assert.equal(b.play('bg'),true);assert.equal(made.at(-1),music)
 b.update({...value,playback:{...value.playback,paused:true}});assert.equal(music.paused,true)
 b.update(value);assert.equal(music.paused,false)
 b.update({...value,playback:{mode:'history',fresh:true,eventToken:'e2'}});assert.equal(b.play('bell','e2'),false)
 b.update({...value,playback:{...value.playback,skipping:true}});assert.equal(b.play('bell','e1'),false)
 b.update({...value,policy:{music:false,sfx:false}});assert.equal(music.paused,true);assert.equal(b.play('bg'),false)
 b.dispose();scheduled.forEach(fn=>fn());owner.dispose()
})
// private fork: the real browser combinations moved to fork-widget-lifecycle-browser.test.mjs.
test('phone consumes authoritative presentation and never runs an internal window state machine',async()=>{
 const code=await readFile(new URL('fork/mods/phone/view/index.js',root),'utf8')
 // private fork: decoration is now a generic setting, never a clock owner.
 assert.match(code,/settings\.clockText \?\? '09:41'/);assert.match(code,/send\('action'/)
 // private fork: the sole zero-delay yield builds <=8 history rows, never owns lifecycle timing.
 const yieldTask='setTimeout(()=>{threadTask=null;render();},0)';assert.match(code,/created===8/);assert.ok(code.includes(yieldTask));
 assert.doesNotMatch(code.replace(yieldTask,''),/setTimeout|setInterval|send\('view'|send\('size'|phase|unread\+\+|storyTime/)
})
