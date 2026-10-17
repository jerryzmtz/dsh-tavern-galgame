import {tmpdir as publicTmpdir} from 'node:os';
import {join as publicJoin} from 'node:path';
// private fork: per-card enable and frozen-contact leases never mutate shared packs or chats.
import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,readFile} from 'node:fs/promises'
import {createAssetPackService} from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/service.js'
import {createAssetPackPresentation} from '../tavern-plugin/lib/domain/asset-pack-presentation.js'
import {createCardAssetBoundary} from '../tavern-plugin/lib/fork-card-asset-bindings.js'
import {recallAssetPacks} from '../tavern-plugin/lib/domain/stage-asset-pack-catalogue.js'
import {readWidgetWindowProjection} from '../tavern-plugin/lib/domain/widget-window-projection.js'
import {defaultAssetEngineSettings} from '../tavern-plugin/lib/domain/asset-engine-settings.js'
import {writePhonePack,PHONE_PACK_ID} from './fixtures/source-widget/fork-build-phone-widget.mjs'
import {syntheticPack,PACK_ID,FIGURE_ID} from './fixtures/asset-packs/pack.mjs'
import {writeZip} from '../tavern-plugin/packages/dsh-asset-library/src/zip.js'
import {jsonBytes} from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/validation.js'
import contract from '../tavern-plugin/src/client/fork-widget-contracts.cjs'
const ref={packId:PHONE_PACK_ID,kind:'widgets',assetId:'phone'},figure={packId:PACK_ID,figureId:FIGURE_ID},origin='http://127.0.0.1:47899'
async function fixture(t){
 const root=await mkdtemp(publicJoin(publicTmpdir(), 'widget-card-scope-')),service=createAssetPackService({assetRoot:root+'/store',authorizeLease:async()=>true});t.after(()=>service.dispose())
 await writePhonePack(root+'/phone.zip');const synthetic=await syntheticPack()
 await writeZip(root+'/figure.zip',[{path:'manifest.json',data:jsonBytes(synthetic.manifest)},...[...synthetic.files].map(([path,data])=>({path,data}))])
 for(const file of ['phone','figure']){const preview=await service.inspectImport({bytes:await readFile(root+'/'+file+'.zip')});await service.applyImport({inspectionId:preview.inspectionId,expectedRevision:null,decision:'install',acceptScriptRisk:true})}
 const raw={extensions:{dsh_tavern:{schemaVersion:1,stage:{widgets:true},assetBindings:{boundPackIds:[PHONE_PACK_ID,PACK_ID]}}}}
 const make=raw=>{const p=createAssetPackPresentation({raw,getService:()=>service,origin,scope:'test'});t.after(()=>p.dispose());return p}
 return {service,raw,make,synthetic,engine:defaultAssetEngineSettings()}
}
test('card pack lamp disables its widgets; other cards and shared packs stay enabled',async t=>{
 const f=await fixture(t),a=f.make(f.raw),b=f.make(f.raw);let workspace={raw:structuredClone(f.raw)}
 const boundary=createCardAssetBoundary({ctx:{get:()=>f.service},listCards:async()=>[{path:'a'}],readWorkspace:async()=>workspace,updateCard:async(_p,_x,_y,ops)=>{workspace={raw:{extensions:{dsh_tavern:ops[0].value}}};a.rebind(workspace.raw)}})
 const before=await boundary.snapshot('a'),bindings=structuredClone(before.extension.assetBindings),packBefore=await f.service.getPackSnapshot({packId:PHONE_PACK_ID})
 bindings.boundPackIds=bindings.boundPackIds.filter(id=>id!==PHONE_PACK_ID)
 await boundary.update({path:'a',expectedRevision:before.revision,patch:{assetBindings:bindings}})
 const options={engine:f.engine,sourceRefs:[ref],isCurrent:()=>true}
 assert.equal((await a.widgets({widgets:{}},options)).length,0);assert.equal((await b.widgets({widgets:{}},options)).length,1)
 assert.equal(workspace.raw.extensions.dsh_tavern.assetBindings.widgets,undefined)
 assert.deepEqual(await f.service.getPackSnapshot({packId:PHONE_PACK_ID}),packBefore)
 await assert.rejects(boundary.update({path:'a',expectedRevision:before.revision,patch:{assetBindings:bindings}}),{code:'REVISION_CONFLICT'})
 await assert.rejects(boundary.update({path:'a',expectedRevision:(await boundary.snapshot('a')).revision,patch:{assetBindings:{...bindings,widgets:[]}}}),{code:'UNKNOWN_FIELD'})
 const args={snapshots:[packBefore],boundPackIds:[PHONE_PACK_ID],units:['phone'],assetStatus:{[ref.packId+'/'+ref.kind+'/'+ref.assetId]:{available:true}}}
 assert.equal(recallAssetPacks(args).candidates.widgets.length,1)
 const disabled=recallAssetPacks({...args,boundPackIds:bindings.boundPackIds});assert.equal(disabled.candidates.widgets.length,0)
 a.rebind(f.raw);assert.equal((await a.widgets({widgets:{}},options)).length,1)
})
test('history avatar uses frozen outfit, bounded same-origin leases and token/rebind revocation',async t=>{
 const f=await fixture(t),presentation=f.make(f.raw),actor={figure,outfitKey:'casual'};let revision=1,changed=false
 const direction=turn=>({phase:'done',through:100,token:{turn,generation:changed&&turn===1?2:1},record:{entries:turn===1?Array.from({length:100},(_,i)=>({at:i+1,state:{actors:{friend:actor}},ops:[{op:'widget.testphone.mark',ref,contact:'friend',side:'in'}]})):[]}})
 const args={turn:2,at:1,expectedDirectionToken:direction(2).token,widgetWindow:{ref},readDirection:async turn=>direction(turn),readTurns:async()=>[1,2],readSettings:()=>({revision,values:f.engine}),revision:()=>revision,isCurrent:()=>true,readConsumer:async()=>({presentation})}
 const result=await readWidgetWindowProjection(args);assert.equal(result.status,'ready')
 const avatars=result.widgets[0].historyAvatars;assert.equal(Object.keys(avatars).length,80);assert.equal(new Set(Object.values(avatars).map(a=>a.url)).size,1)
 const url=avatars['1:100'].url,match=/lease\/([^/]+)\/(.+)/.exec(url)
 const request=method=>f.service.respondLease({ticket:match[1],resource:match[2],request:new Request(origin+url,{method})})
 const response=await request('GET');assert.equal(response.status,200)
 const hash=f.synthetic.figures[FIGURE_ID].outfits[1].avatars.calm
 assert.deepEqual(Buffer.from(await response.arrayBuffer()),f.synthetic.files.get('media/'+hash+'.png'))
 changed=true;await assert.rejects(request('HEAD'));changed=false
 presentation.rebind({...f.raw,extensions:{dsh_tavern:{...f.raw.extensions.dsh_tavern,assetBindings:{...f.raw.extensions.dsh_tavern.assetBindings,boundPackIds:[PHONE_PACK_ID]}}}});revision++
 await assert.rejects(request('GET'));const rebound=await readWidgetWindowProjection(args);assert.deepEqual(rebound.widgets[0].historyAvatars,{})
})
