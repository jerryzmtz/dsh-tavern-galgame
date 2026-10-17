// private fork: P1 uses only synthetic packs, in-memory credentials and fake providers.
import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,readFile,unlink} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {randomUUID} from 'node:crypto'
import {setTimeout as delay} from 'node:timers/promises'
import {createFishDiscovery} from '../tavern-plugin/packages/dsh-tts/src/providers/fish-discovery.js'
import {createServiceSettings} from '../tavern-plugin/packages/dsh-tts/src/settings.js'
import {createTts} from '../tavern-plugin/packages/dsh-tts/src/service.js'
import {pcmWav} from '../tavern-plugin/packages/dsh-tts/src/providers/audio.js'
import {providerConfig} from '../tavern-plugin/packages/dsh-tts/src/providers/params.js'
import {handleControl} from '../tavern-plugin/packages/dsh-tts/src/routes.js'
import {createFigureVoiceAuthoring} from '../tavern-plugin/lib/fork-figure-voice-authoring.js'
import {createAssetPackService} from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/service.js'
import {writeZip} from '../tavern-plugin/packages/dsh-asset-library/src/zip.js'
import {sealPack,jsonBytes} from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/validation.js'
import {syntheticPack,PACK_ID,FIGURE_ID} from './fixtures/asset-packs/pack.mjs'
import recommendations from '../tavern-plugin/packages/dsh-tts/src/shared/fish-recommended.json' with {type:'json'}
const model = {_id:'public-id',title:'Public voice',visibility:'public',type:'tts',state:'trained',licensed:true,languages:['ja'],tags:['female','young']}
const provider = {config:providerConfig('fish-audio',{})}
const voiceSpec = kind => ({name:'Test',language:'ja',defaultSource:'main',sources:{main:kind === 'fish-audio' ? {kind:'voice-id',provider:kind,voiceId:'public-id'} : {kind:'preset',provider:kind,voiceName:kind === 'qwen' ? 'Bella' : 'ja-JP-NanamiNeural'}}})

test('Fish discovery is read-only, bounded, paginated and filters visibility/takedowns; metadata permits private',async () => {
 const calls=[],key=randomUUID(),discovery=createFishDiscovery({fetch:async (url,options)=>{
  calls.push({url,options})
  return Response.json(url.includes('?') ? {items:[model,{...model,_id:'private',visibility:'private'},{...model,_id:'removed',dmca_taken_down:true},{...model,_id:'retiring',pvc_release_state:'retiring'},{...model,_id:'svc',type:'svc'}],total:42,has_more:true,window_limited:true} : {...model,_id:'private',visibility:'private',licensed:false})
 }})
 const result=await discovery.search(provider,{key},{query:'soft & clear',language:'ja',page:2})
 assert.deepEqual(result.voices.map(v=>v.voiceId),['public-id']);assert.equal(result.hasMore,true);assert.equal(result.windowLimited,true)
 const url=new URL(calls[0].url);assert.equal(url.searchParams.get('title'),'soft & clear');assert.equal(url.searchParams.get('page_number'),'2');assert.equal(url.searchParams.get('self'),'false')
 assert.equal((await discovery.validate(provider,{key},{voiceId:'private'})).licensed,false)
 assert.ok(calls.every(c=>c.options.method==='GET'&&c.options.redirect==='error'&&c.options.signal));assert.equal(JSON.stringify(result).includes(key),false)
 for(const input of [{page:0},{page:1.5},{query:'x'.repeat(201)},{language:'ja&self=true'}])await assert.rejects(discovery.search(provider,{key},input),{code:'INVALID_INPUT'})
 await assert.rejects(discovery.validate(provider,{key},{voiceId:'../private'}),{code:'INVALID_INPUT'})
})

test('Fish discovery sanitizes upstream errors, malformed/oversized responses and missing credentials',async()=>{
 const secret=randomUUID()
 for(const [response,code] of [[()=>new Response(secret,{status:401}),'FISH_AUTH_FAILED'],[()=>new Response(secret,{status:429}),'FISH_RATE_LIMITED'],[()=>new Response(secret,{status:404}),'VOICE_NOT_FOUND'],[()=>new Response(secret),'FISH_REQUEST_FAILED'],[()=>new Response('x'.repeat(2*1024**2+1)),'FISH_REQUEST_FAILED'],[()=>{throw Error(secret)},'FISH_REQUEST_FAILED']]){
  const api=createFishDiscovery({fetch:async()=>response()})
  await assert.rejects(api.validate(provider,{key:secret},{voiceId:'public-id'}),e=>e.code===code&&!e.message.includes(secret))
 }
 await assert.rejects(createFishDiscovery({fetch:()=>assert.fail('no request')}).search(provider,{}),{code:'CREDENTIALS_REQUIRED'})
})

test('online catalogues use static lists without keys and APIs only with configured fake credentials',async t=>{
 const calls=[],tts=createTts(),key=randomUUID()
 const settings={providers:[{id:'azure',kind:'azure',config:{region:'eastasia'}},{id:'qwen',kind:'qwen',config:{region:'cn'}}],voices:[]}
 let configured=false
 const api=createServiceSettings({tts,get:()=>settings,credentials:()=>({resolve:async()=>configured?{value:key}:undefined}),fetch:async(url,options)=>{
  calls.push({url,options});return Response.json(url.includes('voices/list')?[{ShortName:'ja-JP-NanamiNeural',Locale:'ja-JP',Gender:'Female'}]:{data:[{id:'qwen3-tts-flash'}]})
 }})
 t.after(async()=>{api.dispose();await tts.dispose()})
 for(const provider of ['azure','qwen'])for(const serviceId of [undefined,provider]){const r=await api.listOnlinePresetVoices({provider,serviceId});assert.equal(r.source,'builtin');assert.ok(r.voices.length);assert.ok(r.voices.some(v=>v.languages.includes('ja')))}
 assert.equal(calls.length,0);configured=true
 assert.equal((await api.listOnlinePresetVoices({provider:'azure'})).source,'live')
 assert.equal((await api.listOnlinePresetVoices({provider:'qwen',serviceId:'qwen'})).modelSource,'live')
 assert.equal(calls.length,2);assert.ok(calls.every(c=>!c.options.method||c.options.method==='GET'))
 await assert.rejects(api.listOnlinePresetVoices({provider:'azure',serviceId:'qwen'}),{code:'INVALID_INPUT'})
 settings.providers.push({id:'azure2',kind:'azure',config:{region:'westus'}})
 await assert.rejects(api.listOnlinePresetVoices({provider:'azure'}),{code:'SERVICE_REQUIRED'})
})

test('shipped recommendations remain candidates with licensed/public metadata and free verification receipts',()=>{
 assert.ok(recommendations.length>=6&&recommendations.length<=10)
 for(const v of recommendations){assert.equal(v.approval,'candidate');assert.equal(v.visibility,'public');assert.equal(v.licensed,true);assert.equal(v.verification.status,'passed');assert.equal(v.verification.model,'s2.1-pro-free');assert.match(v.verification.sha256,/^[a-f0-9]{64}$/);assert.ok(v.licenseNote)}
 for(const lang of ['zh','ja','en'])assert.ok(recommendations.some(v=>v.languages.includes(lang)))
 for(const gender of ['female','male'])assert.ok(recommendations.some(v=>v.gender===gender))
})

async function previewFixture(t,kind='fish-audio',paid=false){
 let pack={revision:'r1',manifest:{voiceLibrary:{version:1,voices:{actor:voiceSpec(kind)}}},figures:{[FIGURE_ID]:{id:FIGURE_ID,enabled:true,voice:{voice:'actor'}}}}
 const listeners=new Set(),calls=[],audio=pcmWav(Buffer.alloc(800,1)),tts=createTts()
 tts.registerProvider('test',{id:'provider',kind,revision:'p1',capabilities:{paid},health:async()=>({state:'ready'}),synthesize:async spec=>{calls.push(spec);return audio}})
 const library={apiVersion:2,getPackSnapshot:async()=>structuredClone(pack),subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn)}}
 const author=createFigureVoiceAuthoring({getLibrary:()=>library,getTts:()=>tts,getSettings:()=>({})})
 t.after(async()=>{author.dispose();await tts.dispose()})
 const input=()=>({packId:PACK_ID,figureId:FIGURE_ID,expectedRevision:pack.revision,text:'A short test.',mood:'joy'})
 return {author,tts,calls,input,update(){pack={...pack,revision:'r2'};for(const fn of listeners)fn({packId:PACK_ID})}}
}
async function result(tts,submitted){
 for(let i=0;i<60;i++){const state=tts.jobs.poll(submitted.requestId,'dsh-browser');if(state.state!=='running')return state;await delay(5)}
 assert.fail('fake provider job did not finish in bounded wait')
}

test('free candidate previews do not publish; stable spec cache, mood invalidation, one-shot grants and close',async t=>{
 const f=await previewFixture(t),request={...f.input(),voiceSpec:voiceSpec('fish-audio'),binding:{voice:'draft'}}
 const a=await f.author.preview(request,'http://localhost'),first=await result(f.tts,a)
 assert.equal(first.state,'ready');assert.equal(first.result.cacheHit,false);assert.equal(f.calls.length,1)
 const bypass=f.tts.jobs.submit({voice:a.voice,text:'Different text',language:'ja'},{principal:'dsh-browser',scope:a.scope})
 assert.equal((await result(f.tts,bypass)).error,'PREVIEW_CONFIRMATION_REQUIRED');assert.equal(f.calls.length,1)
 f.author.close(a)
 const b=await f.author.preview(request,'http://localhost'),second=await result(f.tts,b)
 assert.equal(second.result.key,first.result.key);assert.equal(second.result.cacheHit,true);assert.equal(f.calls.length,1)
 const c=await f.author.preview({...request,mood:'sad'},'http://localhost');assert.equal((await result(f.tts,c)).state,'ready');assert.equal(f.calls.length,2)
 assert.equal((await f.author.editor(f.input())).binding.voice,'actor')
 f.update();assert.throws(()=>f.tts.jobs.poll(b.requestId,'dsh-browser'),{code:'FORBIDDEN'})
})

for(const kind of ['qwen','azure'])test(kind+' paid previews require exact one-time confirmation, including cache hits',async t=>{
 const f=await previewFixture(t,kind,true),request=f.input(),origin='http://localhost'
 const pending=await f.author.preview(request,origin);assert.equal(pending.status,'confirmation-required');assert.equal(f.calls.length,0)
 await assert.rejects(f.author.preview({...request,text:'Changed',confirmToken:pending.confirmToken},origin),{code:'PREVIEW_CONFIRMATION_REQUIRED'})
 const p=await f.author.preview(request,origin)
 await assert.rejects(f.author.preview({...request,confirmToken:p.confirmToken},'http://other'),{code:'PREVIEW_CONFIRMATION_REQUIRED'})
 const valid=await f.author.preview(request,origin),job=await f.author.preview({...request,confirmToken:valid.confirmToken},origin)
 assert.equal((await result(f.tts,job)).state,'ready');assert.equal(f.calls.length,1)
 await assert.rejects(f.author.preview({...request,confirmToken:valid.confirmToken},origin),{code:'PREVIEW_CONFIRMATION_REQUIRED'})
 const cached=await f.author.preview(request,origin);assert.equal(cached.status,'confirmation-required')
 const again=await f.author.preview({...request,confirmToken:cached.confirmToken},origin);assert.equal((await result(f.tts,again)).result.cacheHit,true);assert.equal(f.calls.length,1)
 const expired=await f.author.preview(request,origin),realNow=Date.now
 try {Date.now=()=>realNow()+61000;await assert.rejects(f.author.preview({...request,confirmToken:expired.confirmToken},origin),{code:'PREVIEW_CONFIRMATION_REQUIRED'})}finally{Date.now=realNow}
 const revoked=await f.author.preview(request,origin);f.author.invalidate()
 await assert.rejects(f.author.preview({...request,confirmToken:revoked.confirmToken},origin),{code:'PREVIEW_CONFIRMATION_REQUIRED'})
 await assert.rejects(f.author.open(request,origin),{code:'PAID_PREVIEW_DISABLED'})
})

test('preview rejects oversized/invalid candidates, stale revision and absent origin before synthesis',async t=>{
 const f=await previewFixture(t)
 for(const [patch,code] of [[{text:'x'.repeat(201)},'INVALID_INPUT'],[{text:''},'INVALID_INPUT'],[{mood:'x'.repeat(81)},'INVALID_INPUT'],[{voiceSpec:{...voiceSpec('fish-audio'),sources:{main:{kind:'voice-id',provider:'fish-audio',voiceId:'../unsafe'}}}},'INVALID_INPUT'],[{expectedRevision:'old'},'REVISION_CONFLICT']])await assert.rejects(f.author.preview({...f.input(),...patch},'http://localhost'),{code})
 await assert.rejects(f.author.preview(f.input()),{code:'FORBIDDEN'});assert.equal(f.calls.length,0)
 const response=await handleControl(new Request('http://localhost/api/dsh-tts/v1/control',{method:'POST',headers:{Origin:'http://elsewhere','Content-Type':'application/json'},body:'{}'}),()=>assert.fail('must not dispatch'))
 assert.equal(response.status,403)
})

async function packFixture(t){
 const root=await mkdtemp(path.join(tmpdir(),'voice-p1-')),pack=await syntheticPack(),voiceId=pack.figures[FIGURE_ID].voice.voice,voice=pack.manifest.voiceLibrary.voices[voiceId]
 voice.sources.local.fallback=[voice.sources.fish.references[0]];voice.sources.local.emotions={joy:[voice.sources.fish.references[1]]};voice.variants={normal:{name:'Normal'},fast:{tuning:{local:{speed_factor:1.1}}}}
 await sealPack(pack.manifest,pack.files)
 const zip=path.join(root,'fixture.zip');await writeZip(zip,[{path:'manifest.json',data:jsonBytes(pack.manifest)},...[...pack.files].map(([path,data])=>({path,data}))])
 const assetRoot=path.join(root,'assets'),owner=createAssetPackService({assetRoot,authorizeLease:async()=>true});t.after(()=>owner.dispose())
 const inspection=await owner.inspectImport({bytes:await readFile(zip)}),installed=await owner.applyImport({inspectionId:inspection.inspectionId,expectedRevision:null,decision:'install',acceptScriptRisk:true})
 let snapshot=installed.snapshot
 return {owner,assetRoot,voiceId,voice,write(extra={}){return {packId:PACK_ID,expectedRevision:snapshot.revision,...extra}},get snapshot(){return snapshot},set snapshot(v){snapshot=v}}
}

test('variant CRUD uses shared confirmation and CAS, rejects identity tuning and in-use deletion',async t=>{
 const f=await packFixture(t),base={voiceId:f.voiceId,variantId:'quick',variant:{name:'Quick',tuning:{fish:{speed:1.1}}}}
 await assert.rejects(f.owner.savePackVoiceVariant(f.write(base)),{code:'SHARED_VOICE_CONFIRMATION_REQUIRED'})
 let r=await f.owner.savePackVoiceVariant(f.write({...base,confirmShared:true}));assert.equal(r.affectedFigures[0].id,FIGURE_ID);f.snapshot=r.snapshot
 await assert.rejects(f.owner.savePackVoiceVariant(f.write({...base,expectedRevision:'old',confirmShared:true})),{code:'REVISION_CONFLICT'})
 await assert.rejects(f.owner.savePackVoiceVariant(f.write({...base,variant:{tuning:{fish:{voiceId:'other'}}},confirmShared:true})),{code:'INVALID_INPUT'})
 r=await f.owner.saveFigureVoiceBinding(f.write({figureId:FIGURE_ID,binding:{voice:f.voiceId,emotionVariants:{joy:'quick'}}}));f.snapshot=r.snapshot
 await assert.rejects(f.owner.deletePackVoiceVariant(f.write({...base,confirmShared:true})),{code:'VOICE_VARIANT_IN_USE'})
 r=await f.owner.saveFigureVoiceBinding(f.write({figureId:FIGURE_ID,binding:{voice:f.voiceId}}));f.snapshot=r.snapshot
 r=await f.owner.deletePackVoiceVariant(f.write({...base,confirmShared:true}));assert.equal(r.snapshot.manifest.voiceLibrary.voices[f.voiceId].variants.quick,undefined)
})

test('personal templates preserve full media closure, local model/selection/variants and copy on assign',async t=>{
 const f=await packFixture(t),binding={voice:f.voiceId,source:'local',variant:'fast',emotionVariants:{joy:'fast'},language:'ja'}
 const saved=await f.owner.saveVoiceTemplate({expectedRevision:null,packId:PACK_ID,packRevision:f.snapshot.revision,voiceId:f.voiceId,binding})
 assert.deepEqual(saved.voiceSpec,f.voice);assert.deepEqual(saved.binding,binding);assert.equal((await f.owner.listVoiceTemplates()).templates.length,1)
 await assert.rejects(f.owner.assignVoiceTemplate(f.write({templateId:saved.templateId,templateRevision:'old',figureId:FIGURE_ID})),{code:'REVISION_CONFLICT'})
 const r=await f.owner.assignVoiceTemplate(f.write({templateId:saved.templateId,templateRevision:saved.revision,figureId:FIGURE_ID}));f.snapshot=r.snapshot
 assert.notEqual(r.voiceId,f.voiceId);assert.deepEqual(r.snapshot.manifest.voiceLibrary.voices[r.voiceId],f.voice)
 assert.deepEqual(r.snapshot.figures[FIGURE_ID].voice,{...binding,voice:r.voiceId})
 const target=(await f.owner.createPack({name:'Independent',expectedRevision:null})).snapshot
 const created=await f.owner.createFigure({packId:target.manifest.id,expectedRevision:target.revision,figure:{schemaVersion:1,name:'Target',enabled:true,outfits:[]}})
 const cross=await f.owner.assignVoiceTemplate({packId:target.manifest.id,expectedRevision:created.snapshot.revision,figureId:created.figureId,templateId:saved.templateId,templateRevision:saved.revision})
 assert.deepEqual(cross.snapshot.manifest.voiceLibrary.voices[cross.voiceId],f.voice)
 for(const ref of f.voice.sources.fish.references){assert.ok(cross.snapshot.manifest.blobs[ref.media]);assert.deepEqual(await readFile(path.join(f.assetRoot,'packs',target.manifest.id,'media',ref.media+'.wav')),await readFile(path.join(f.assetRoot,'packs',PACK_ID,'media',ref.media+'.wav')))}
 const exported=await f.owner.exportPack({packId:target.manifest.id,expectedRevision:cross.snapshot.revision});assert.ok(exported.bytes.length)
 await f.owner.deleteVoiceTemplate({templateId:saved.templateId,expectedRevision:saved.revision})
 assert.deepEqual((await f.owner.listVoiceTemplates()).templates,[]);assert.deepEqual((await f.owner.getPackSnapshot({packId:PACK_ID})).manifest.voiceLibrary.voices[r.voiceId],f.voice)
 const reopened=createAssetPackService({assetRoot:f.assetRoot});t.after(()=>reopened.dispose());assert.deepEqual((await reopened.getPackSnapshot({packId:PACK_ID})).figures[FIGURE_ID].voice,{...binding,voice:r.voiceId})
})

// private fork: saving trusted installed media is not another integrity boundary.
test('saving and replacing a personal template never rehash installed reference audio',async t=>{
 const f=await packFixture(t),input={expectedRevision:null,packId:PACK_ID,packRevision:f.snapshot.revision,voiceId:f.voiceId}
 const digest=t.mock.method(globalThis.crypto.subtle,'digest')
 const saved=await f.owner.saveVoiceTemplate(input)
 const updated=await f.owner.saveVoiceTemplate({...input,templateId:saved.templateId,expectedRevision:saved.revision})
 assert.deepEqual(updated.voiceSpec,saved.voiceSpec);assert.notEqual(updated.revision,saved.revision)
 assert.equal(digest.mock.callCount(),0)
 for(const ref of f.voice.sources.fish.references) assert.deepEqual(await readFile(path.join(f.assetRoot,'voice-templates','media',ref.media+'.wav')),await readFile(path.join(f.assetRoot,'packs',PACK_ID,'media',ref.media+'.wav')))
})

test('assigning a template reuses installed audio and hashes only newly copied audio once',async t=>{
 const f=await packFixture(t),saved=await f.owner.saveVoiceTemplate({expectedRevision:null,packId:PACK_ID,packRevision:f.snapshot.revision,voiceId:f.voiceId})
 const target=(await f.owner.createPack({name:'Copy target',expectedRevision:null})).snapshot
 const created=await f.owner.createFigure({packId:target.manifest.id,expectedRevision:target.revision,figure:{schemaVersion:1,name:'Target',enabled:true,outfits:[]}})
 const media=f.voice.sources.fish.references[0].media,bytes=await readFile(path.join(f.assetRoot,'voice-templates','media',media+'.wav'))
 const digest=t.mock.method(globalThis.crypto.subtle,'digest'),audioHashes=()=>digest.mock.calls.filter(call=>Buffer.from(call.arguments[1]).equals(bytes)).length
 await f.owner.assignVoiceTemplate(f.write({templateId:saved.templateId,templateRevision:saved.revision,figureId:FIGURE_ID}))
 assert.equal(audioHashes(),0)
 await f.owner.assignVoiceTemplate({packId:target.manifest.id,expectedRevision:created.snapshot.revision,figureId:created.figureId,templateId:saved.templateId,templateRevision:saved.revision})
 assert.equal(audioHashes(),1)
})

test('templates reject stale revisions and missing media, preserve muted source, and serialize concurrent updates',async t=>{
 const f=await packFixture(t),input={expectedRevision:null,packId:PACK_ID,packRevision:f.snapshot.revision,voiceId:f.voiceId,binding:{voice:f.voiceId,source:null}}
 await assert.rejects(f.owner.saveVoiceTemplate({...input,packRevision:'old'}),{code:'REVISION_CONFLICT'})
 const saved=await f.owner.saveVoiceTemplate(input)
 const results=await Promise.allSettled([1,2].map(()=>f.owner.saveVoiceTemplate({...input,templateId:saved.templateId,expectedRevision:saved.revision})))
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.code,'REVISION_CONFLICT')
 const latest=(await f.owner.listVoiceTemplates()).templates[0]
 assert.equal(latest.binding.source,null)
 const media=f.voice.sources.fish.references[0].media
 const target=(await f.owner.createPack({name:'Missing reference target',expectedRevision:null})).snapshot
 const created=await f.owner.createFigure({packId:target.manifest.id,expectedRevision:target.revision,figure:{schemaVersion:1,name:'Target',enabled:true,outfits:[]}})
 await unlink(path.join(f.assetRoot,'voice-templates','media',media+'.wav'))
 await assert.rejects(f.owner.assignVoiceTemplate({packId:target.manifest.id,expectedRevision:created.snapshot.revision,figureId:created.figureId,templateId:latest.templateId,templateRevision:latest.revision}),{code:'MISSING_REFERENCE'})
 assert.equal((await f.owner.getPackSnapshot({packId:PACK_ID})).revision,f.snapshot.revision)
})

test('managed local preview is free and uses the independent emotion reference through owner leases',async t=>{
 const f=await packFixture(t),tts=createTts(),calls=[]
 t.after(()=>tts.dispose())
 const model=f.voice.sources.local.model
 tts.registerProvider('test',{id:'local',kind:'reference-api',revision:'1',capabilities:{paid:false,localEngine:'gpt-sovits',modelRequirements:[model],voiceKinds:['reference'],referenceInput:['bytes-v1']},health:async()=>({state:'ready'}),synthesize:async spec=>{calls.push(spec);return pcmWav(Buffer.alloc(800,1))}})
 const author=createFigureVoiceAuthoring({getLibrary:()=>f.owner,getTts:()=>tts,getSettings:()=>({})});t.after(()=>author.dispose())
 const request={...f.write(),figureId:FIGURE_ID,voiceSpec:f.voice,binding:{voice:'preview',source:'local'},text:'Local preview.',mood:'joy'}
 const a=await author.preview(request,'http://localhost'),state=await result(tts,a)
 assert.equal(state.state,'ready');assert.equal(calls.length,1);assert.equal(calls[0].reference.promptText,f.voice.sources.local.emotions.joy[0].text)
 assert.equal(calls[0].references,undefined)
 const b=await author.preview(request,'http://localhost');assert.equal((await result(tts,b)).result.cacheHit,true)
})

// private fork: P1 integration exempts the editing figure, not other users.
test('own figure voice edits need no shared confirmation; another user still does',async t=>{
 const f=await packFixture(t),own={figureId:FIGURE_ID,voiceId:f.voiceId}
 let r=await f.owner.savePackVoice(f.write({...own,voiceSpec:f.voice}));f.snapshot=r.snapshot
 r=await f.owner.savePackVoiceVariant(f.write({...own,variantId:'own',variant:{name:'Own'}}));f.snapshot=r.snapshot
 r=await f.owner.deletePackVoiceVariant(f.write({...own,variantId:'own'}));f.snapshot=r.snapshot
 r=await f.owner.createFigure(f.write({figure:{schemaVersion:1,name:'Other',enabled:true,outfits:[]}}));f.snapshot=r.snapshot
 r=await f.owner.saveFigureVoiceBinding(f.write({figureId:r.figureId,binding:{voice:f.voiceId}}));f.snapshot=r.snapshot
 for(const [method,extra] of [['savePackVoice',{voiceSpec:f.voice}],['savePackVoiceVariant',{variantId:'fast',variant:{name:'Fast'}}],['deletePackVoiceVariant',{variantId:'fast'}]]){
   await assert.rejects(f.owner[method](f.write({...own,...extra})),{code:'SHARED_VOICE_CONFIRMATION_REQUIRED'})
 }
 r=await f.owner.savePackVoice(f.write({...own,voiceSpec:f.voice,confirmShared:true}));assert.equal(r.affectedFigures.length,2)
})
test('preview accepts 200 characters and rejects 201 before submission',async t=>{
 const f=await previewFixture(t)
 await assert.rejects(f.author.preview({...f.input(),text:'x'.repeat(201)},'http://localhost'),{code:'INVALID_INPUT'})
 assert.equal(f.calls.length,0)
 const job=await f.author.preview({...f.input(),text:'x'.repeat(200)},'http://localhost')
 assert.equal((await result(f.tts,job)).state,'ready')
})
