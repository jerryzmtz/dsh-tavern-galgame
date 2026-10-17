// private fork: page-addressed projection and borrowed bundle handles.
import test from 'node:test'
import assert from 'node:assert/strict'
import {stageProjectionPage,readStageProjection} from '../tavern-plugin/lib/domain/stage-projection.js'
import {createStageResourceOwner} from '../tavern-plugin/src/client/fork-stage-resources.cjs'
import {expandPerformanceDependencies} from '../fork/mods/performance/projection.js'
import {createStageResourceRunner} from '../tavern-plugin/src/client/fork-stage-resource-runner.cjs'

const direction = {pageIndex:{version:1,pages:[{page:0,para:1,offset:0},{page:1,para:1,offset:131},{page:2,para:2,offset:0}]}}
test('page RPC coordinates distinguish the second canonical page from the paragraph entry', () => {
  assert.deepEqual(stageProjectionPage(direction,1),{index:0,para:1,offset:0,version:1})
  assert.deepEqual(stageProjectionPage(direction,1,{index:1,para:1,offset:131,version:1}),{index:1,para:1,offset:131,version:1})
  assert.deepEqual(stageProjectionPage(direction,2),{index:2,para:2,offset:0,version:1})
  for (const page of [{index:1,para:1,offset:0,version:1},{index:1,para:2,offset:131,version:1},{index:1,para:1,offset:131,version:2},{index:-1,para:1,offset:0,version:1}]) {
    assert.throws(()=>stageProjectionPage(direction,1,page),{code:'STAGE_PAGE_MISMATCH'})
  }
  assert.equal(stageProjectionPage({},1),null)
  assert.throws(()=>stageProjectionPage({},1,{index:0,para:1,offset:0,version:1}),{code:'STAGE_PAGE_MISMATCH'})
})

test('runner cache isolates two pages of one paragraph but reuses a repeated canonical page',async()=>{
  const calls=[],source={sessionId:'s',turn:1,authorityEpoch:1},directionToken={digest:'frozen'}
  let snapshot
  const runner=createStageResourceRunner({
    clock:{setTimeout(){return 1},clearTimeout(){}},
    owner:{dispose(){},isPrepared(){return true},async prepare(value){return {value,pins:[],release(){}}}},
    visual:value=>({scene:value.scene,figures:[],lighting:{},ruler:null}),
    async read(args){calls.push(args);return {status:'ready',directionToken,value:{scene:{},state:{},characters:[],avatars:[],widgets:[],audio:{music:null,soundscape:null}}}}
  })
  for(const [visit,index] of [0,1,1].entries()){
    const token={id:visit,source,anchor:{para:1,offset:index*131}}
    snapshot={projection:{token,outstanding:['background','music','ambience','avatars','widgets']},director:{token:directionToken,through:1},cursor:{mode:'live'}}
    runner.onEffect('s',{type:'project',token,at:1,page:{index,para:1,offset:index*131,version:1}},event=>{
      if(event.type==='PROJECTION_READY'){
        snapshot.projection.outstanding=snapshot.projection.outstanding.filter(group=>!Object.hasOwn(event.groups,group))
        if(!snapshot.projection.outstanding.length)snapshot.projection=null
      }
    },()=>snapshot)
    for(let i=0;i<20;i++)await new Promise(resolve=>setImmediate(resolve))
    assert.equal(snapshot.projection,null)
  }
  assert.deepEqual(calls.map(args=>args.page.index),[0,1])
  runner.dispose()
})

test('dependency expansion includes cue-only SFX and ignores director recall caps',()=>{
  const ref={packId:'a',kind:'performances',assetId:'show'}
  const document={packs:{other:'b'},bgm:{ref:'self:music'},sfxMap:{type:{ref:'other:type'}},timeline:{entry:{events:[{do:'sfx',ref:'other:type'},{do:'skin',ref:'self:skin'}]}}}
  const snapshots=[{manifest:{id:'a',assets:[{kind:'performances',id:'show',enabled:true},{kind:'music',id:'music',enabled:true},{kind:'skins',id:'skin'}]}},{manifest:{id:'b',assets:[{kind:'sfx',id:'type',enabled:true}]}}]
  const options={ref,document,snapshots,authorization:{boundPackIds:['a','b']}}
  const result=expandPerformanceDependencies(options)
  assert.equal(result.unavailable,null)
  assert.equal(result.refs.length,4)
  assert.equal(result.refs.filter(item=>item.kind==='sfx').length,1)
  assert.equal(document.timeline.entry.events.length,2,'resource deduplication does not erase event ordinals')
  assert.deepEqual(expandPerformanceDependencies({...options,authorization:{boundPackIds:['a']}}).unavailable.dependency,{packId:'b'})
  snapshots[1].manifest.assets[0].enabled=false
  assert.equal(expandPerformanceDependencies(options).unavailable.dependency.assetId,'type')
})

test('widget module availability is required independently of owning performance availability',()=>{
  const ref={packId:'a',kind:'performances',assetId:'show'},document={packs:{},sfxMap:{},timeline:{entry:{events:[{do:'widget',ref:'self:widget'}]}}}
  const snapshots=[{manifest:{id:'a',assets:[{kind:'performances',id:'show',enabled:true},{kind:'widgets',id:'widget',enabled:true}]}}]
  const options={ref,document,snapshots,authorization:{boundPackIds:['a']}}
  assert.equal(expandPerformanceDependencies(options).unavailable.code,'PERFORMANCE_DEPENDENCY_UNAVAILABLE')
  assert.equal(expandPerformanceDependencies({...options,authorization:{boundPackIds:['a'],widgetAllowed:()=>true}}).unavailable,null)
})

function bundleOwner(maxBytes) {
  let serial = 0, reads = 0, decodes = 0, closed = 0
  const files = {'skin.json':JSON.stringify({atlas:'atlas.json'}),'atlas.json':JSON.stringify({image:'atlas.png'}),'atlas.png':'image','glyphs/type.json':JSON.stringify({glyphs:{a:[0,0,2,2]}})}
  const owner = createStageResourceOwner({maxBytes,
    service:{async leaseBundle(){return {ticket:++serial,revision:'v1',url:'/lease/'+serial+'/skin.json',resources:Object.keys(files).map(file=>'/lease/'+serial+'/'+file)}},releaseLease(){}},
    urls:{createObjectURL(){return 'blob:owned-'+(++serial)},revokeObjectURL(){}},
    async fetch(url){reads++;const name=url.split('/').slice(3).join('/');return new Response(files[name],{headers:{'content-type':name.endsWith('.png')?'image/png':'application/json'}})},
    async decode(blob){if(blob.type!=='image/png')return null;decodes++;return {width:16,height:16,close(){closed++}}}
  })
  const descriptor={resource:true,kind:'bundle',ref:{packId:'p',kind:'skins',assetId:'skin'},revision:'v1',hash:'skin-hash',identity:'skin-identity',bundleKey:'skin'}
  return {owner,descriptor,get reads(){return reads},get decodes(){return decodes},get closed(){return closed}}
}

test('owner lends a read-only relative files table with the already decoded atlas and inert JSON',async()=>{
  const h=bundleOwner(),prepared=await h.owner.prepare({url:h.descriptor},'authority',{usage:'performance'})
  const handle=prepared.pins[0].handle
  assert.deepEqual(Object.keys(handle.files).sort(),['atlas.json','atlas.png','glyphs/type.json','skin.json'])
  assert.equal(handle.files['atlas.png'].image.width,16)
  assert.deepEqual(handle.files['atlas.json'].json,{image:'atlas.png'})
  assert.equal(handle.files['skin.json'].url,handle.url)
  assert.throws(()=>{handle.files['new.json']={}},TypeError)
  assert.throws(()=>{handle.files['atlas.json'].json.image='other.png'},TypeError)
  assert.equal(h.decodes,1)
  const again=await h.owner.prepare(h.descriptor,'authority',{usage:'performance'})
  assert.equal(again.pins[0].handle,handle)
  assert.equal(h.reads,4)
  await h.owner.renew(h.descriptor.identity,'authority')
  assert.equal(h.reads,4)
  assert.equal(h.decodes,1)
  prepared.release();again.release()
  assert.equal(h.owner.snapshot().pins,0)
  h.owner.dispose()
  assert.equal(h.closed,1)
  assert.equal(h.owner.snapshot().bytes,0)
})

test('a refused decoded atlas is released without retaining candidate pins or allocations',async()=>{
  const h=bundleOwner(500)
  await assert.rejects(h.owner.prepare(h.descriptor,'authority',{usage:'performance'}),{code:'RESOURCE_BUDGET'})
  assert.equal(h.owner.snapshot().pins,0)
  assert.equal(h.owner.snapshot().bytes,0)
  assert.equal(h.closed,1)
  h.owner.dispose()
})

import {performanceWidgetDefaults,foldPerformanceAt} from '../fork/mods/performance/projection.js'
import {createAssetPackPresentation} from '../tavern-plugin/lib/domain/asset-pack-presentation.js'
import {performanceFixture,performanceRef} from './helpers/performance-director-fixture.mjs'
import {createAssetPackService} from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/service.js'
import {sealPack,jsonBytes} from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/validation.js'
import {writeZip} from '../tavern-plugin/packages/dsh-asset-library/src/zip.js'
import {mkdir,mkdtemp,readFile} from 'node:fs/promises'
import {harness,drain,fixtureScale} from './helpers/stage-resource-harness.mjs'

async function presentationFixture(t,widget=true) {
  const f=await performanceFixture(),pack=f.pack
  const asset=pack.manifest.assets.find(a=>a.kind==='widgets')
  const widgetDocument=pack.widgets[asset.id]
  widgetDocument.stateSchema.properties.label.default='Default label'
  widgetDocument.commands.find(c=>c.effect==='state.set').params.properties.label.default='Default label'
  pack.files.set('bundles/widget/widget.json',jsonBytes(widgetDocument))
  if(widget)pack.performances.show.timeline.entry.events.push({at:15,do:'widget',ref:'self:clock'})
  pack.performances.show.sfxMap={type:'self:bell'}
  pack.manifest.bundles.show={kind:'performance',entry:'performance.json',contentHash:'0'.repeat(64)}
  pack.files.set('bundles/show/performance.json',jsonBytes(pack.performances.show))
  await sealPack(pack.manifest,pack.files)
  const base=new URL('../.tmp/',import.meta.url);await mkdir(base,{recursive:true})
  const root=await mkdtemp(new URL('performance-resources-',base)),zip=root+'/pack.zip'
  await writeZip(zip,[{path:'manifest.json',data:jsonBytes(pack.manifest)},...[...pack.files].map(([path,data])=>({path,data}))])
  const service=createAssetPackService({assetRoot:root+'/assets',authorizeLease:async()=>true})
  const inspection=await service.inspectImport({bytes:await readFile(zip)})
  await service.applyImport({inspectionId:inspection.inspectionId,expectedRevision:null,decision:'install'})
  f.input.raw.extensions.dsh_tavern.stage={widgets:true} // private fork: opt in at the card owner
  const engine={dimensions:{widgets:true}}
  const consumer=createAssetPackPresentation({raw:f.input.raw,getService:()=>service,origin:'http://localhost',scope:'isolated'})
  const metadata=await consumer.performanceMetadata([performanceRef()])
  const assetStatus=structuredClone(f.input.assetStatus)
  const prepared=f.prepare({engine:{...engine,widgetsEnabled:true},assetStatus}),tx=f.transaction(prepared)
  const receipt=tx.submit({sequence:1,through:8,done:true,beats:[{at:1,ops:[{op:"mod.dsh.performance.set", ref:performanceRef(), level:2}]}]})
  assert.equal(receipt.ok,true,JSON.stringify(receipt))
  const record=tx.effect(),page={index:0,para:1,offset:0,version:1}
  const plan=foldPerformanceAt({checked:record,page,turn:1,resolveDocument:ref=>ref.kind==='widgets'?{...widgetDocument,defaults:performanceWidgetDefaults(widgetDocument)}:metadata[0]?.[ref.kind]?.[ref.assetId]})
  t.after(async()=>{consumer.dispose();await service.dispose()})
  return {f,service,consumer,metadata,engine,plan,record,page}
}

test('widget defaults are schema-derived, bounded and never substituted with samples',()=>{
  const asset={stateSchema:{type:'object',additionalProperties:false,required:['label'],properties:{label:{type:'string',maxLength:12}}},caps:{bytes:100}}
  asset.commands=[{effect:'state.set',params:asset.stateSchema}]
  assert.equal(performanceWidgetDefaults(asset),null)
  asset.stateSchema.properties.label.default='ready'
  assert.deepEqual(performanceWidgetDefaults(asset),{label:'ready'})
  asset.caps.bytes=1
  assert.equal(performanceWidgetDefaults(asset),null)
  // private fork: a source-only widget has no state.set, regardless of samples or old props defaults.
  assert.equal(performanceWidgetDefaults({...asset,commands:[{effect:'source.mark'}],samples:[{label:'not a default'}]}),null)
})

test('real presentation keeps widget capabilities outside the inert closure and validates declared defaults and module availability',async t=>{
  const h=await presentationFixture(t)
  const project=()=>h.consumer.performance(h.plan,{snapshots:h.metadata,engine:h.engine,isCurrent:()=>true})
  const value=await project()
  assert.equal(value.unavailable,null)
  assert.ok(value.dependencies.some(d=>d.ref.kind==='performances'&&d.url.kind==='bundle'))
  assert.ok(value.dependencies.some(d=>d.ref.kind==='sfx'&&d.ref.assetId==='bell'))
  assert.ok(!value.dependencies.some(d=>d.ref.kind==='widgets'))
  assert.equal(value.executionDependencies.length,1)
  assert.ok(value.executionDependencies[0].definition.url)
  assert.deepEqual(value.executionDependencies[0].state,{label:'Default label'})
  const snapshot=await h.consumer.performance(h.plan,{snapshots:h.metadata,engine:h.engine,isCurrent:()=>true,snapshotOnly:true})
  assert.equal(snapshot.executionDependencies[0].definition,undefined)
  h.engine.dimensions.widgets=false
  assert.equal((await project()).unavailable,null) // private fork: the card, not the retired engine gate, owns widgets
})

test('projection metadata double-check detects external publication and restore denial is best effort',async t=>{
  const h=await presentationFixture(t,false)
  h.plan.restore={previous:{packId:'ffffffff-ffff-4fff-8fff-ffffffffffff',kind:'music',assetId:'missing'},directorRequest:null}
  const value=await h.consumer.performance(h.plan,{snapshots:h.metadata,engine:h.engine,isCurrent:()=>true})
  assert.equal(value.unavailable,null)
  assert.equal(value.restoreDiagnostics.length,1)
  const old=h.metadata[0],ref=performanceRef()
  await h.service.patchPack({packId:ref.packId,expectedRevision:old.revision,patch:{name:'changed'}})
  await assert.rejects(h.consumer.verifyPerformanceMetadata(h.metadata),{code:'ASSET_STALE'})
})

test('runner accepts a required performance atomically, ignores failed restore, and revokes the whole group only',async t=>{
  const h=await harness(t);await h.direct()
  const track=id=>({role:'required',ref:{packId:'performance-pack',kind:'sfx',assetId:id},identity:id,url:{resource:true,kind:'media',ref:{packId:'performance-pack',kind:'sfx',assetId:id},identity:id,hash:id,revision:'pack-1'}})
  const dependency=track('cue'),restore={...track('restore'),role:'restore'}
  const plan={ref:{packId:'performance-pack',kind:'performances',assetId:'show'},phase:'entry',instanceKey:['source',0,0],phaseKey:['entry'],plan:{phase:'entry',events:[],sustainedEvents:[],durationMs:0},dependencies:[dependency,restore],executionDependencies:[{ref:{packId:'execution-pack',kind:'widgets',assetId:'clock'},revision:'widget-revision',definition:{url:'/capability'}}]}
  h.setResponse({status:'ready',directionToken:h.store.getSnapshot().director.token,value:{
    scene:{},characters:[],avatars:[],widgets:[],state:{lighting:{},figureScale:fixtureScale},audio:{music:null,soundscape:null},performance:plan}})
  h.rejectBytes(url=>url.includes('restore'))
  h.refresh();await drain()
  const accepted=h.store.getSnapshot().accepted.performance
  assert.equal(accepted.phase,'entry')
  assert.equal(accepted.dependencies.length,1)
  assert.ok(accepted.dependencies[0].url.startsWith('blob:'))
  assert.equal(accepted.executionDependencies[0].definition.url,'/capability')
  h.resources.revoke('session',{packId:'execution-pack'},h.store.dispatch,h.store.getSnapshot)
  await drain()
  assert.equal(h.store.getSnapshot().accepted.performance,null)
  assert.equal(h.owner.snapshot().pins,0)
})
test('host read projects entry then idle, validates the closed metadata, and preserves canonical base layers',async t=>{
  const h=await presentationFixture(t,false),token={digest:'verified'}
  const direction={token,target:{turn:1},record:h.record,through:8,pageIndex:h.f.input.pageIndex}
  const options={expectedDirectionToken:token,readDirection:async()=>direction,readConsumer:async()=>({presentation:h.consumer,allowedPackIds:h.consumer.extension.assetBindings.boundPackIds}),readSettings:()=>({revision:1,values:h.engine}),revision:()=>1}
  const first=await readStageProjection({...options,at:1,page:h.page})
  assert.equal(first.status,'ready',JSON.stringify(first.error))
  assert.equal(first.value.performance.phase,'entry')
  assert.equal(first.value.audio.music,null,'performance music must not overwrite director music')
  const second=await readStageProjection({...options,at:2,page:{index:1,para:2,offset:0,version:1}})
  assert.equal(second.status,'ready',JSON.stringify(second.error))
  assert.equal(second.value.performance.phase,'idle')
  assert.deepEqual(second.value.performance.instanceKey,first.value.performance.instanceKey)
  const original=h.consumer.verifyPerformanceMetadata
  h.consumer.verifyPerformanceMetadata=async()=>{throw Object.assign(Error('publication raced'),{code:'ASSET_STALE'})}
  // private fork: a raced optional performance does not withhold the base scene.
  const raced=await readStageProjection({...options,at:1,page:h.page})
  assert.equal(raced.status,'ready')
  assert.equal(raced.value.performance.unavailable.code,'ASSET_STALE')
  h.consumer.verifyPerformanceMetadata=original
})

for (const method of ['performanceMetadata','performance','verifyPerformanceMetadata']) test('private fork: optional '+method+' failure preserves base projection',async t=>{
  const h=await presentationFixture(t,false),token={digest:'verified'}
  const direction={token,target:{turn:1},record:h.record,through:8,pageIndex:h.f.input.pageIndex}
  const options={expectedDirectionToken:token,readDirection:()=>direction,readConsumer:()=>({presentation:h.consumer,allowedPackIds:h.consumer.extension.assetBindings.boundPackIds}),readSettings:()=>({revision:1,values:h.engine}),revision:()=>1,at:1,page:h.page}
  const before=await readStageProjection(options)
  h.consumer[method]=async()=>{throw Object.assign(Error('optional dependency failed'),{code:'LIMIT_EXCEEDED'})}
  const after=await readStageProjection(options)
  assert.equal(after.status,'ready')
  assert.deepEqual(after.value.characters,before.value.characters)
  assert.deepEqual(after.value.scene,before.value.scene)
  assert.deepEqual(after.value.audio,before.value.audio)
  assert.equal(after.value.performance.unavailable.code,'LIMIT_EXCEEDED')
  assert.deepEqual(after.directionToken,token)
})

test('canonical prefetch warms a performance trigger and its next page even within the same paragraph',async()=>{
  const calls=[],prepared=[],token={digest:'sealed'},source={sessionId:'s',turn:1,authorityEpoch:1}
  const background={resource:true,identity:'bg',alias:null}
  const runner=createStageResourceRunner({owner:{async prepare(value){prepared.push(value);return {release(){}}},dispose(){}},read:async args=>{
    calls.push(args);return {status:'ready',directionToken:token,value:{performance:null,scene:{background:{...background},backgroundName:'page '+args.at}}}
  }})
  await runner.prefetch(source,{complete:true,token,through:2,baseline:{},entries:[{state:{performance:{startedAt:{turn:1,page:0}}}}],pageIndex:direction.pageIndex})
  assert.deepEqual(calls.filter(args=>args.page).map(args=>[args.at,args.page.index]),[[1,0],[1,1],[2,2]])
  // private fork (stage perf 2026-10): every page is read, but a resource shared by the turn's pages is prepared once.
  assert.deepEqual(prepared,[background])
  runner.dispose()
})
test('performance exit bypasses a failed replacement and releases the old group without waiting for bytes',async t=>{
  const h=await harness(t);await h.direct()
  const ref={packId:'p',kind:'sfx',assetId:'cue'},dependency={role:'required',ref,identity:'cue',url:{resource:true,kind:'media',ref,identity:'cue',hash:'cue',revision:'pack-1'}}
  const value={scene:{},characters:[],avatars:[],widgets:[],state:{lighting:{},figureScale:fixtureScale},audio:{music:null,soundscape:null},performance:{ref:{packId:'p',kind:'performances',assetId:'show'},phase:'entry',instanceKey:['source',0,0],phaseKey:['entry'],plan:{phase:'entry',events:[],sustainedEvents:[],durationMs:0},dependencies:[dependency],executionDependencies:[]}}
  const response=()=>({status:'ready',directionToken:h.store.getSnapshot().director.token,value})
  h.setResponse(response);h.refresh();await drain()
  const previous=h.store.getSnapshot().accepted.performance
  assert.equal(previous.phase,'entry')
  h.rejectBytes(()=>true)
  value.performance={...value.performance,dependencies:[{...dependency,identity:'other',url:{...dependency.url,identity:'other',hash:'other'}}]}
  h.refresh();await drain()
  assert.equal(h.store.getSnapshot().accepted.performance,previous)
  value.performance={...value.performance,phase:'exit',phaseKey:['exit'],plan:{phase:'exit',events:[],durationMs:0}}
  h.refresh();await drain()
  assert.equal(h.store.getSnapshot().accepted.performance.phase,'exit')
  assert.equal(h.store.getSnapshot().pending.resources,false)
  value.performance=null
  h.refresh();await drain()
  assert.equal(h.store.getSnapshot().accepted.performance,null)
  h.resources.invalidate('session')
  assert.equal(h.owner.snapshot().pins,0)
})