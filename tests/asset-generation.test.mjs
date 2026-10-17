import test from 'node:test'
import {importFigureVariants} from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/import-figure-variants.js'
// private fork: legacy guidance is imported once; fixtures explicitly choose eight declarations.
const DECLARED=importFigureVariants({}, {fixture:{outfits:[{key:'legacy'}]}},{}).figures.fixture
const SHEET_IDS=['calm',...DECLARED.emotions.filter(row=>row.id!=='calm'&&!row.protectTears).map(row=>row.id)]
DECLARED.emotions=SHEET_IDS.map(id=>DECLARED.emotions.find(row=>row.id===id))
import {patchFigureImages} from './fixtures/atomic-figure-images.mjs'
import {createSimpleSprite} from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/simple-sprite.js'
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {createHash} from 'node:crypto'
import {runInNewContext} from 'node:vm'
import {mkdir, mkdtemp, readFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {deflateSync, crc32} from 'node:zlib'
import {createAssetPackService} from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/service.js'
import {createImageGenerationModule} from '../tavern-plugin/packages/dsh-image-gen/src/module.js'
import {assetImageCapability} from '../tavern-plugin/packages/dsh-image-gen/src/tavern/scene-image-channels.js'
import {createAssetGeneration, renderAssetTemplate, assetGenerationResult, assetImageFailureReason} from '../tavern-plugin/lib/domain/asset-generation.js'
import {registerTavernHttpRoutes} from '../tavern-plugin/lib/http/routes.js'
import {cropAssetBackground, sliceAssetAvatarSheet, checkAssetImage, alignAssetSprite} from '../tavern-plugin/lib/domain/asset-image-processing.js'
import {assetEmotionGuidance, assetSheetEmotionIds} from '../tavern-plugin/lib/domain/asset-generation-emotions.js'
import {createProfileDataStore} from '../tavern-plugin/lib/profile-data-store.js'
import {pngSize} from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/media.js'

test('asset generation exposes concise provider rejection reasons', () => {
  assert.match(assetImageFailureReason({httpStatus:400,message:'Missing required image'}), /缺少参考图.*Missing required image/)
  assert.match(assetImageFailureReason({httpStatus:401,message:'Invalid API key'}), /鉴权失败.*HTTP 401/)
  assert.match(assetImageFailureReason({httpStatus:400,message:'Unsupported size\n1024x1536'}), /不支持请求的尺寸.*Unsupported size 1024x1536/)
  assert.match(assetImageFailureReason({httpStatus:400,message:'Unknown parameter: quality'}), /HTTP 400.*Unknown parameter: quality/)
})

function png(width=512,height=512,{opaque=false,empty=false,edge=false,filter=0,pixel}={}) {
  const chunk = (type,data) => { const out = Buffer.alloc(data.length+12); out.writeUInt32BE(data.length); out.write(type,4); data.copy(out,8); out.writeUInt32BE(crc32(out.subarray(4,-4)),out.length-4); return out }
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height,4); header[8]=8; header[9]=6
  const raw = Buffer.alloc((width*4+1)*height), previous = Buffer.alloc(width*4)
  for(let y=0;y<height;y++) {
    const row=Buffer.alloc(width*4)
    for(let x=0;x<width;x++) { const i=x*4; row[i]=(x+y)%250; row[i+1]=90; row[i+2]=130; row[i+3]=empty?0:opaque||edge||x>width/8&&x<width*7/8&&y>height/8&&y<height*7/8?255:0 }
    if (pixel) for(let x=0;x<width;x++) row.set(pixel(x,y),x*4)
    raw[y*(width*4+1)]=filter
    for(let i=0;i<row.length;i++) {
      const a=i>=4?row[i-4]:0,b=previous[i],c=i>=4?previous[i-4]:0,p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c)
      raw[y*(width*4+1)+1+i]=(row[i]-(filter===1?a:filter===2?b:filter===3?Math.floor((a+b)/2):filter===4?(pa<=pb&&pa<=pc?a:pb<=pc?b:c):0))&255
    }
    row.copy(previous)
  }
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))])
}
const code = expected => e => {assert.equal(e.code,expected);return true}
async function fixture(t,options={}) {
  const base=fileURLToPath(new URL('../.preview/asset-generation-tests/',import.meta.url)); await mkdir(base,{recursive:true})
  const root=await mkdtemp(base+'case-'), store=createProfileDataStore({dataRoot:root+'/data'})
  const library=createAssetPackService({assetRoot:root+'/packs'}), requests=[]
  let response=options.response||png(), mode='ok', waiting
  const server=createServer(async(req,res)=>{
    const chunks=[];for await(const c of req)chunks.push(c)
    const body=JSON.parse(Buffer.concat(chunks));requests.push({url:req.url,body,auth:req.headers.authorization})
    if(mode==='wait'){waiting={res};return}
    res.setHeader('content-type','application/json')
    if(mode==='500'){res.writeHead(500);res.end('{}');return}
    if(mode==='refuse'){res.writeHead(400);res.end(JSON.stringify({error:{code:'content_policy_violation',message:'declined'}}));return}
    res.end(JSON.stringify({output:mode==='empty'?[]:[{type:'image_generation_call',result:response.toString('base64')}]}))
  })
  const services=[]
  // private fork: register cleanup before any asynchronous setup can fail.
  t.after(async()=>{for(const svc of services)await svc.dispose();waiting?.res.destroy();server.closeAllConnections();await new Promise(r=>server.close(r));await library.dispose()})
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  const keys=new Map(), module=createImageGenerationModule({store,credentials:()=>({resolve:async k=>({value:keys.get(k)}),set:async(k,v)=>keys.set(k,v)})})
  await module.configure({provider:'openai',baseURL:`http://127.0.0.1:${server.address().port}/v1`,model:'gpt-image-2.5',protocol:'responses-image-tool',dispatcherModel:'fake-dispatcher',apiKey:'test-local-key'})
  let pack=(await library.createPack({name:'Authoring',expectedRevision:null})).snapshot
  const created=await library.createFigure({packId:pack.manifest.id,expectedRevision:pack.revision,figure:{schemaVersion:1,name:'Test',appearance:'sprite',emotions:DECLARED.emotions,identityAppearance:'silver hair',outfits:[{key:'daily',label:'Daily',enabled:true,defaultEmotion:'calm',outfitAppearance:'blue ribbon'}]}})
  pack=created.snapshot
  const figureId=created.figureId, packId=pack.manifest.id
  // private fork: existing generation cases start with an explicitly accepted identity board.
  if (options.identity !== false) {
    pack=(await patchFigureImages(library,pack,figureId,{board:png()},hashes=>({identitySettei:{board:hashes.board,version:'identity-v1',palette:[]}}))).snapshot
  }
  const target={packId,figureId,outfitKey:'daily',kind:'settei'}
  const make=extra=>{const svc=createAssetGeneration({store,imageModule:module,capture:()=>module.capture('openai'),getLibrary:()=>library,...options,...extra});services.push(svc);return svc}
  const service=make()
  return {root,store,library,module,service,make,target,requests,pack,figureId,packId,
    setMode:v=>{mode=v},setImage:v=>{response=v},finish:()=>waiting?.res.end(JSON.stringify({output:[{type:'image_generation_call',result:response.toString('base64')}]})),
    fresh:()=>library.getPackSnapshot({packId})}
}
async function prepare(f,extra={}) { return f.service.prepare({target:f.target,expectedRevision:(await f.fresh()).revision,...extra}) }
async function generate(f,extra={}) {
  const plan=await prepare(f,extra), result=await f.service.generate({planId:plan.planId,consentToken:plan.consentToken,confirmNewRequestIds:plan.confirmNewRequestIds})
  return {plan,jobs:await Promise.all(result.jobs.map(j=>done(f.service,j.jobId)))}
}
async function done(service,id) {
  for(let i=0;i<300;i++){const job=await service.get({jobId:id});if(job.status!=='running')return job;await new Promise(r=>setTimeout(r,10))}
  throw new Error('local job timed out')
}
async function acceptedSettei(f) {
  const {jobs:[job]}=await generate(f)
  await f.service.accept({jobId:job.jobId,expectedRevision:(await f.fresh()).revision})
  return job
}

test('OpenAI Responses uses shared credentials, one image tool, references and per-job transparency; prepare is free',async t=>{
  const f=await fixture(t), original=await f.module.capture('openai')
  const {plan,jobs:[job]}=await generate(f,{references:[{base64:png().toString('base64'),mediaType:'image/png',role:'identity'}]})
  assert.equal(job.status,'candidate');assert.equal(f.requests.length,1)
  const req=f.requests[0];assert.equal(req.url,'/v1/responses');assert.equal(req.auth,'Bearer test-local-key')
  assert.equal(req.body.model,'fake-dispatcher');assert.equal(req.body.tools[0].model,'gpt-image-2.5');assert.equal(req.body.max_tool_calls,1);assert.equal(req.body.parallel_tool_calls,false);assert.equal(req.body.store,false)
  assert.equal(req.body.input[0].content[1].type,'input_image');assert.equal(req.body.tools[0].output_format,'png')
  assert.equal(req.body.tools[0].size,'1536x1024');assert.equal((await f.module.capture('openai')).active.size,original.active.size)
  assert.equal(JSON.stringify(await f.service.get({jobId:job.jobId})).includes('test-local-key'),false)
  assert.equal(JSON.stringify(await f.store.readJson('asset-generation/jobs.json')).includes('base64'),false)
  const repeated=await f.service.generate({planId:plan.planId,consentToken:plan.consentToken});assert.equal(repeated.jobs[0].jobId,job.jobId);assert.equal(f.requests.length,1)
  await f.service.accept({jobId:job.jobId,expectedRevision:(await f.fresh()).revision})
  // private fork: backend enforces calm and same-emotion references, not just UI disabling.
  let pack=await f.fresh()
  await assert.rejects(prepare(f,{target:{...f.target,kind:'avatar',emotionId:'joy'}}),code('ASSET_UNAVAILABLE'))
  // private fork: canonical sprite and figure binding are installed atomically.
  const made=createSimpleSprite({images:{calm:{hash:job.candidate.hash,width:512,height:512},joy:{hash:job.candidate.hash,width:512,height:512}}},pack.manifest.blobs)
  const figure={...pack.figures[f.figureId],outfits:[{...pack.figures[f.figureId].outfits[0],sprite:{manifestKey:'test',assets:made.assets},avatars:{calm:job.candidate.hash}}]}
  await f.library.patchPack({packId:f.packId,expectedRevision:pack.revision,patch:{sprites:{...pack.manifest.sprites,test:'sprites/test/manifest.json'}},fileUpdates:new Map([['sprites/test/manifest.json',Buffer.from(JSON.stringify(made.manifest))],['figures/'+f.figureId+'.json',Buffer.from(JSON.stringify(figure))]])})
  const avatar={...f.target,kind:'avatar',emotionId:'joy'}, second=await generate(f,{target:avatar})
  assert.equal(second.plan.output.quality,'high');assert.equal(second.plan.defaults.avatarMode,'individual');assert.equal(second.jobs[0].status,'candidate');assert.equal(f.requests[1].body.tools[0].background,'transparent')
  assert.match(second.plan.prompt,/bright eyes/);assert.equal(second.plan.references.length,1)
  assert.equal(assetImageCapability(original.active).sizes.includes('2048x1024'),false)
})

// private fork (gen-ui r12, owner 2026-10-15): a 立绘 is drawn from the 设定图 / 设定文字, never from 平和 — 平和 is only the
// ruler an adopted picture is aligned to. `omit` drops a default reference; adoption writes the outfit's record.
test('立绘 never sends 平和 (still the import ruler); omit drops defaults; adoption records the outfit history',async t=>{
  const f=await fixture(t); await acceptedSettei(f)
  let pack=await f.fresh()
  assert.deepEqual(pack.figures[f.figureId].outfits[0].genRecords.map(r=>r.kind),['settei'])
  // One CAS write per state set: the pictures, the sprite manifest and the figure binding together.
  const install=async images=>{pack=await f.fresh();const blobs={...pack.manifest.blobs},files=new Map(),states={}
    for(const [id,bytes] of Object.entries(images)){const hash=createHash('sha256').update(bytes).digest('hex');blobs[hash]={ext:'png',mime:'image/png',size:bytes.length};files.set('media/'+hash+'.png',bytes);states[id]={hash,width:512,height:768}}
    const made=createSimpleSprite({images:states},blobs),figure={...pack.figures[f.figureId],outfits:[{...pack.figures[f.figureId].outfits[0],sprite:{manifestKey:'test',assets:made.assets}}]}
    files.set('sprites/test/manifest.json',Buffer.from(JSON.stringify(made.manifest)));files.set('figures/'+f.figureId+'.json',Buffer.from(JSON.stringify(figure)))
    await f.library.patchPack({packId:f.packId,expectedRevision:pack.revision,patch:{blobs,sprites:{...pack.manifest.sprites,test:'sprites/test/manifest.json'}},fileUpdates:files});return states}
  const calm=png(512,768),calmHash=(await install({calm})).calm.hash
  const target={...f.target,kind:'sprite',emotionId:'joy'}
  const shown=await prepare(f,{target,userPrompt:'双手比耶',preview:true})
  assert.ok(shown.references.length>0);assert.equal(shown.references.some(r=>r.hash===calmHash),false,'identity board and 设定图 only (the fixture uses one picture for both)')
  assert.deepEqual((await prepare(f,{target,userPrompt:'双手比耶',preview:true,omit:['settei','identity']})).references,[])
  f.setImage(png(512,768));const {jobs:[job]}=await generate(f,{target,userPrompt:'双手比耶'})
  assert.equal(f.requests.at(-1).body.input[0].content.filter(c=>c.type==='input_image').length,shown.references.length);assert.equal(job.userPrompt,'双手比耶');assert.equal(job.anchor,undefined)
  const raw=Buffer.from((await f.service.read({jobId:job.jobId})).base64,'base64'),aligned=Buffer.from((await f.service.read({jobId:job.jobId,forImport:true})).base64,'base64')
  assert.ok(aligned.equals(alignAssetSprite(raw,calm)),'aligned to the 平和 ruler');assert.ok(!aligned.equals(alignAssetSprite(raw)))
  const joy=(await install({calm,joy:aligned})).joy.hash
  await f.service.accept({jobId:job.jobId,expectedRevision:(await f.fresh()).revision,importedHash:joy})
  const records=(await f.fresh()).figures[f.figureId].outfits[0].genRecords
  assert.deepEqual(records.map(({at,...r})=>r),[{kind:'settei'},{kind:'sprite',emotionId:'joy',prompt:'双手比耶'}]);assert.ok(records.every(r=>Number.isSafeInteger(r.at)))
  // A single 头像 is drawn from its own 差分's 立绘 and the 设定, not from the 平和 头像.
  pack=await f.fresh()
  const head=png(320,320),headHash=createHash('sha256').update(head).digest('hex'),figure={...pack.figures[f.figureId],outfits:pack.figures[f.figureId].outfits.map(o=>({...o,avatars:{calm:headHash}}))}
  await f.library.patchPack({packId:f.packId,expectedRevision:pack.revision,patch:{blobs:{...pack.manifest.blobs,[headHash]:{ext:'png',mime:'image/png',size:head.length}}},
    fileUpdates:new Map([['media/'+headHash+'.png',head],['figures/'+f.figureId+'.json',Buffer.from(JSON.stringify(figure))]])})
  const face=await prepare(f,{target:{...f.target,kind:'avatar',emotionId:'joy'},preview:true})
  assert.ok(face.references.some(r=>r.hash===joy),'its own 立绘');assert.equal(face.references.some(r=>r.hash===headHash),false,'not the 平和 头像')
  assert.ok((await prepare(f,{target:{...f.target,kind:'avatar-sheet'},preview:true})).references.some(r=>r.hash===headHash),'the eight-face sheet redraws 平和 too')
})

test('settei and appearance persist, closure prevents deletion, copy/export retain all fields',async t=>{
  const f=await fixture(t), job=await acceptedSettei(f), pack=await f.fresh(), figure=pack.figures[f.figureId]
  assert.equal(figure.identityAppearance,'silver hair');assert.equal(figure.outfits[0].outfitAppearance,'blue ribbon');assert.equal(figure.outfits[0].settei,job.candidate.hash)
  // private fork: accepted outfit records its identity authority without absorbing outfit traits.
  assert.equal(figure.outfits[0].setteiParentVersion,figure.identitySettei.version)
  assert.deepEqual(figure.identitySettei.palette,[])
  assert.equal(await f.store.readBytes(`asset-generation/${job.jobId}.png`),undefined)
  await assert.rejects(f.library.removeBlob({packId:f.packId,expectedRevision:pack.revision,hash:job.candidate.hash}))
  const exported=await f.library.exportPack({packId:f.packId,expectedRevision:pack.revision}), preview=await f.library.inspectImport({bytes:exported.bytes})
  assert.equal(preview.incoming.figures[f.figureId].outfits[0].settei,job.candidate.hash)
  const dest=(await f.library.createPack({name:'Other',expectedRevision:null})).snapshot
  const copy=await f.library.copyFigure({source:{packId:f.packId,figureId:f.figureId},target:{packId:dest.manifest.id,expectedRevision:dest.revision}})
  assert.equal(copy.snapshot.figures[copy.figureId].identityAppearance,'silver hair');assert.ok(copy.snapshot.manifest.blobs[job.candidate.hash])
  assert.deepEqual(copy.snapshot.figures[copy.figureId].identitySettei,figure.identitySettei)
  await assert.rejects(f.library.patchFigure({packId:f.packId,expectedRevision:pack.revision,figureId:f.figureId,patch:{identityAppearance:'x'.repeat(4001)}}))
})

test('consent, dependency, CAS, unsupported channel and immutable pack target are enforced before HTTP',async t=>{
  const f=await fixture(t)
  // private fork (figure quick fixes, owner 2026-10): a static 立绘 needs only text — no 设定图, no 平和 立绘 — and the
  // request is the user's text, then the default production prompt (no 「User notes」 wrapper); preview is free and planless.
  { const sprite=await f.service.prepare({target:{...f.target,kind:'sprite',emotionId:'joy'},expectedRevision:(await f.fresh()).revision,userPrompt:'双手叉腰',preview:true})
    assert.equal(sprite.preview,true);assert.equal(sprite.planId,undefined);assert.equal(sprite.consentToken,undefined)
    assert.ok(sprite.prompt.startsWith('双手叉腰\n\nVisual novel standing sprite'));assert.doesNotMatch(sprite.prompt,/User notes/);assert.match(sprite.prompt,/fully transparent/)
    assert.deepEqual(sprite.references.map(r=>r.purpose),['identity-settei']) }
  { const bare=await fixture(t,{identity:false}); await bare.library.patchFigure({packId:bare.packId,expectedRevision:(await bare.fresh()).revision,figureId:bare.figureId,patch:{identityAppearance:null,outfits:[{key:'daily',label:'Daily',enabled:true,defaultEmotion:'calm'}]}})
    const target={...bare.target,kind:'sprite',emotionId:'joy'}
    await assert.rejects(bare.service.prepare({target,expectedRevision:(await bare.fresh()).revision}),code('INVALID_ARGUMENT'))
    const plan=await bare.service.prepare({target,expectedRevision:(await bare.fresh()).revision,userPrompt:'silver hair, joyful wave'})
    assert.deepEqual(plan.references,[]);assert.ok(plan.prompt.startsWith('silver hair, joyful wave\n\n')) }
  const plan=await prepare(f);assert.equal(f.requests.length,0)
  await assert.rejects(f.service.generate({planId:plan.planId}),code('CONSENT_REQUIRED'))
  await f.library.patchPack({packId:f.packId,expectedRevision:f.pack.revision,patch:{name:'Changed'}})
  await assert.rejects(f.service.generate({planId:plan.planId,consentToken:plan.consentToken}),code('REVISION_CONFLICT'));assert.equal(f.requests.length,0)
  await f.module.configure({provider:'openai',protocol:'images'})
  assert.ok((await prepare(f)).planId)
  assert.equal(f.requests.length,0)
})

test('configuration change after consent never dispatches, no automatic paid fallback',async t=>{
  const f=await fixture(t),plan=await prepare(f)
  await f.module.configure({provider:'openai',model:'another-model'})
  const group=await f.service.generate({planId:plan.planId,consentToken:plan.consentToken}),job=await done(f.service,group.jobs[0].jobId)
  assert.equal(job.outcome,'not_requested');assert.equal(f.requests.length,0)
})

test('explicit N candidates dispatch N single requests, idempotent group and uncertain billing gate',async t=>{
  const f=await fixture(t);f.setMode('500')
  const {jobs}=await generate(f,{count:2});assert.equal(jobs.length,2);assert.equal(f.requests.length,2);assert.ok(jobs.every(j=>j.outcome==='unconfirmed'))
  const plan=await prepare(f);assert.equal(plan.confirmNewRequestIds.length,2)
  await assert.rejects(f.service.generate({planId:plan.planId,consentToken:plan.consentToken}),code('BILLING_CONFIRMATION_REQUIRED'))
  f.setMode('ok')
  const group=await f.service.generate({planId:plan.planId,consentToken:plan.consentToken,confirmNewRequestIds:plan.confirmNewRequestIds})
  assert.equal((await done(f.service,group.jobs[0].jobId)).status,'candidate');assert.equal(f.requests.length,3)
})

test('cancel suppresses late results and never auto-retries',async t=>{
  const f=await fixture(t);f.setMode('wait');const plan=await prepare(f),group=await f.service.generate({planId:plan.planId,consentToken:plan.consentToken}),id=group.jobs[0].jobId
  for(let i=0;!f.requests.length&&i<100;i++)await new Promise(r=>setTimeout(r,5))
  const job=await f.service.cancel({jobId:id});assert.equal(job.status,'cancelled');assert.equal(job.outcome,'unconfirmed')
  f.finish();await new Promise(r=>setTimeout(r,30));assert.equal((await f.service.get({jobId:id})).status,'cancelled');assert.equal(f.requests.length,1)
})

test('candidate rejection and expiry delete only temporary files, restart retains candidates without HTTP',async t=>{
  let clock=10000;const f=await fixture(t,{now:()=>clock,candidateTtlMs:1000}),{jobs:[job]}=await generate(f)
  await f.service.dispose();const restarted=f.make({now:()=>clock,candidateTtlMs:1000})
  assert.equal((await restarted.get({jobId:job.jobId})).status,'candidate');assert.equal(f.requests.length,1)
  await restarted.reject({jobId:job.jobId});assert.equal(await f.store.readBytes(`asset-generation/${job.jobId}.png`),undefined)
  clock+=1001;assert.deepEqual(await restarted.list({packId:f.packId}),[]);assert.ok(await f.fresh())
})

test('local save retry reuses received bytes, never asks image provider twice',async t=>{
  const f=await fixture(t);await f.service.dispose();let failWrite=true
  const service=f.make({store:{...f.store,writeBytes:async(path,bytes)=>{if(path.endsWith('.png')&&failWrite)throw new Error('disk full');return f.store.writeBytes(path,bytes)}}})
  f.service=service
  const {jobs:[job]}=await generate(f);assert.equal(job.status,'save_failed');assert.equal(job.outcome,'received')
  failWrite=false;assert.equal((await service.retrySave({jobId:job.jobId})).status,'candidate');assert.equal(f.requests.length,1)
})

test('accept CAS/target conflict preserves candidate and writes only opening pack',async t=>{
  const f=await fixture(t),{jobs:[job]}=await generate(f),old=await f.fresh()
  const other=(await f.library.createPack({name:'Other',expectedRevision:null})).snapshot
  const changed=await patchFigureImages(f.library,old,f.figureId,{settei:png(513,512)},hashes=>({outfits:[{...old.figures[f.figureId].outfits[0],settei:hashes.settei}]}))
  await assert.rejects(f.service.accept({jobId:job.jobId,expectedRevision:old.revision}),code('REVISION_CONFLICT'))
  await assert.rejects(f.service.accept({jobId:job.jobId,expectedRevision:changed.snapshot.revision}),code('TARGET_CHANGED'))
  assert.ok(await f.store.readBytes(`asset-generation/${job.jobId}.png`))
  await f.service.accept({jobId:job.jobId,expectedRevision:changed.snapshot.revision,replace:true})
  assert.equal((await f.fresh()).figures[f.figureId].outfits[0].settei,job.candidate.hash)
  assert.equal((await f.library.getPackSnapshot({packId:other.manifest.id})).revision,other.revision)
})

test('background acceptance centre-crops to 16:9 without upscaling',async t=>{
  const f=await fixture(t,{response:png(1536,1024,{opaque:true})}),pack=await f.fresh()
  await f.library.patchPack({packId:f.packId,expectedRevision:pack.revision,patch:{assets:[{kind:'backgrounds',id:'room',name:'Room',enabled:true,directorNote:'',recall:{mode:'keyword',keywords:[]},media:null,pendingMedia:true}]}})
  const {jobs:[job]}=await generate(f,{target:{packId:f.packId,kind:'background',assetId:'room'},userPrompt:'quiet room'})
  const redraw=await prepare(f,{target:{packId:f.packId,kind:'background',assetId:'room'},redrawOf:job.jobId,note:'warmer light'})
  assert.match(redraw.prompt,/quiet room/);assert.match(redraw.prompt,/warmer light/)
  await f.service.accept({jobId:job.jobId,expectedRevision:(await f.fresh()).revision})
  const fresh=await f.fresh(),hash=fresh.manifest.assets[0].media,media=await f.library.readMedia({packId:f.packId,expectedRevision:fresh.revision,hash})
  assert.deepEqual(pngSize(media.bytes),{width:1536,height:864});assert.notEqual(hash,job.candidate.hash)
})

test('sheet follows eight explicit declarations, square transparent padding, checks and receipt-only accept',async t=>{
  const f=await fixture(t);await acceptedSettei(f);f.setImage(png(1536,1024))
  // private fork: this batch adds eight ordinary named rows without minting reserved keys.
  const before=await f.fresh(),figure=before.figures[f.figureId]
  const added=SHEET_IDS.map((id,index)=>({...DECLARED.emotions.find(row=>row.id===id),id:'e-sheet-'+index,label:'差分'+index})),ids=added.map(row=>row.id)
  await f.library.patchFigure({packId:f.packId,figureId:f.figureId,expectedRevision:before.revision,patch:{emotions:[...figure.emotions,...added]}})
  const target={...f.target,kind:'avatar-sheet',emotionIds:ids}
  await assert.rejects(prepare(f,{target:{...target,emotionIds:[ids[0],ids[0]]},preview:true}),code('INVALID_ARGUMENT'))
  await assert.rejects(prepare(f,{target:{...target,emotionIds:['not-declared']},preview:true}),code('INVALID_ARGUMENT'))
  const {plan,jobs:[job]}=await generate(f,{target})
  assert.deepEqual(job.target.emotionIds,ids)
  for(const row of added)assert.ok(plan.prompt.includes(row.label))
  assert.equal(plan.output.size,'1536x1024');assert.equal(plan.output.background,'transparent')
  assert.equal(Object.keys(job.candidate.slices).length,8)
  assert.ok(Object.values(job.candidate.slices).every(s=>s.checks.warnings.some(w=>w.code==='CELL_EDGE_CONTACT')))
  // private fork: c23dcb24d measures the anatomical crown, not hats or ahoge.
  assert.match(plan.prompt,/65-75% cell height from the natural main hair crown/)
  assert.match(plan.prompt,/excluding ahoge and headwear/)
  assert.match(plan.prompt,/2-4% top clearance and 5% side space/)
  assert.match(plan.prompt,/nothing crosses cell boundaries/i)
  assert.match(plan.prompt,/four equal columns/);assert.match(plan.prompt,/gaze averted/);assert.match(plan.prompt,/relaxed face/);assert.match(plan.prompt,/open smile/) // private fork: guidance is metadata.
  const image=await f.service.read({jobId:job.jobId,emotionId:ids[0]});assert.deepEqual(pngSize(Buffer.from(image.base64,'base64')),{width:512,height:512})
  await assert.rejects(f.service.accept({jobId:job.jobId,expectedRevision:(await f.fresh()).revision}),code('IMPORT_REQUIRED'))
  const images={},pack=await f.fresh()
  for(const id of job.target.emotionIds){const part=await f.service.read({jobId:job.jobId,emotionId:id});images[id]=Buffer.from(part.base64,'base64')}
  const patch=await patchFigureImages(f.library,pack,f.figureId,images,hashes=>({outfits:[{...pack.figures[f.figureId].outfits[0],avatars:hashes}]}))
  assert.equal((await f.service.accept({jobId:job.jobId,expectedRevision:patch.snapshot.revision,importedHashes:patch.hashes})).status,'accepted')
})

test('redraw freezes parent references, appends note once, explicit rejection/no-image errors',async t=>{
  const f=await fixture(t),{jobs:[job]}=await generate(f)
  const redraw=await prepare(f,{redrawOf:job.jobId,note:'ribbon on the left',useCandidateReference:true})
  assert.match(redraw.prompt,/REDRAW CORRECTION/);assert.match(redraw.prompt,/ribbon on the left/);assert.equal(redraw.references.length,2) // private fork: parent identity plus rejected candidate
  await f.service.reject({jobId:job.jobId});const result=await f.service.generate({planId:redraw.planId,consentToken:redraw.consentToken})
  assert.equal((await done(f.service,result.jobs[0].jobId)).status,'candidate');assert.equal(f.requests.length,2)
  f.setMode('refuse');let generated=await generate(f);assert.equal(generated.jobs[0].error.code,'IMAGE_REFUSED');assert.match(generated.jobs[0].error.message,/内容审核未通过.*HTTP 400.*declined/);assert.equal(f.requests.length,3)
  f.setMode('empty');generated=await generate(f);assert.equal(generated.jobs[0].error.code,'IMAGE_NO_RESULT');assert.equal(f.requests.length,4)
})

test('deterministic alpha/empty/edge/aspect checks and pixel crops, no vision calls',()=>{
  assert.ok(checkAssetImage(png(512,512,{opaque:true}),'avatar').warnings.some(w=>w.code==='NO_TRANSPARENCY'))
  assert.ok(checkAssetImage(png(512,512,{empty:true}),'avatar').warnings.some(w=>w.code==='EMPTY_IMAGE'))
  assert.ok(checkAssetImage(png(512,512),'sprite').warnings.some(w=>w.code==='ASPECT_MISMATCH'))
  const cropped=cropAssetBackground(png(160,120))
  for(const filter of [0,1,2,3,4]){const image=cropAssetBackground(png(160,120,{filter}));assert.deepEqual(pngSize(image),{width:160,height:90});assert.deepEqual(image,cropped)}
  const aligned=checkAssetImage(alignAssetSprite(png(512,768)),'sprite');assert.equal(aligned.bbox.y+aligned.bbox.h,Math.round(768*0.99))
  const original=checkAssetImage(png(512,768),'sprite');assert.equal(aligned.bbox.h,original.bbox.h)
  const ids=assetSheetEmotionIds(DECLARED,{});const slices=sliceAssetAvatarSheet(png(1536,1024),ids);assert.equal(Object.keys(slices).length,8)
  assert.equal(assetEmotionGuidance({id:'love'},DECLARED).includes('affectionate'),true)
  assert.equal(assetEmotionGuidance({id:'joy'},DECLARED).includes('bright eyes'),true)
  assert.equal(assetEmotionGuidance({id:'smug'},{emotions:[{id:'smug',label:'smug',guidance:'confident smirk'}]}).includes('smirk'),true)
  assert.equal(renderAssetTemplate('{{userPrompt}}',{userPrompt:'{{notExpanded}}'}),'{{notExpanded}}')
  assert.throws(()=>renderAssetTemplate('{{unknown}}',{}),code('INVALID_ARGUMENT'))
})

// private fork: alignment corrects row drift without concealing source-cell truncation.
function avatarSheet(boxes) {
  return png(1536,1024,{pixel:(x,y)=>{
    const index=Math.floor(y/512)*4+Math.floor(x/384), box=boxes[index], cx=x%384, cy=y%512
    return [30+index*25,90,130,box&&cx>=box.x&&cx<box.x+box.w&&cy>=box.y&&cy<box.y+box.h?255:0]
  }})
}
test('sheet bbox alignment removes 30px row drift, centres every cell and preserves shared scale',()=>{
  const ids=assetSheetEmotionIds(DECLARED,{}), boxes=ids.map((_,i)=>({x:40+i*10,y:i<4?46:16,w:170+i*2,h:300+i*2}))
  const bytes=avatarSheet(boxes), checks={}, slices=sliceAssetAvatarSheet(bytes,ids,{checks})
  assert.deepEqual(slices,sliceAssetAvatarSheet(bytes,ids))
  for (const [index,id] of ids.entries()) {
    const check=checkAssetImage(slices[id],'avatar',{slice:true})
    assert.deepEqual(pngSize(slices[id]),{width:512,height:512})
    assert.equal(check.bbox.y,61)
    assert.ok(Math.abs(check.bbox.x+check.bbox.w/2-256)<=0.5)
    assert.equal(check.bbox.h,boxes[index].h);assert.equal(check.bbox.w,boxes[index].w)
    assert.deepEqual(checks[id].warnings,[])
  }
})
test('sheet derives one scale from median subject height rather than fitting each expression',()=>{
  const ids=assetSheetEmotionIds(DECLARED,{}), boxes=ids.map((_,i)=>({x:90,y:40,w:200,h:400+i*2})), checks={}
  sliceAssetAvatarSheet(avatarSheet(boxes),ids,{checks})
  const scale=512*0.72/407
  for (const [i,id] of ids.entries()) {
    assert.equal(checks[id].bbox.h,Math.round(boxes[i].h*scale))
    assert.equal(checks[id].bbox.w,Math.round(200*scale))
    assert.deepEqual(checks[id].warnings,[])
  }
})
test('sheet common downscale retains proportions and raw edge warnings, never repairs clipped hair',()=>{
  const ids=assetSheetEmotionIds(DECLARED,{}), boxes=ids.map((_,i)=>({x:i===0?0:4,y:i<4?20:0,w:380-i*2,h:470-i*3}))
  const checks={}, slices=sliceAssetAvatarSheet(avatarSheet(boxes),ids,{checks})
  const scale=384*0.76/380
  for (const [index,id] of ids.entries()) {
    const box=checks[id].bbox
    assert.equal(box.y,61);assert.equal(box.w,Math.round(boxes[index].w*scale));assert.equal(box.h,Math.round(boxes[index].h*scale))
    assert.ok(!checkAssetImage(slices[id],'avatar',{slice:true}).warnings.some(w=>w.code==='EDGE_CONTACT'))
  }
  // private fork: diagnostics follow declared cell order, not reserved names.
  assert.ok(checks[ids[0]].warnings.some(w=>w.code==='CELL_EDGE_CONTACT'))
  assert.ok(checks[ids[4]].warnings.some(w=>w.code==='CELL_EDGE_CONTACT'))
  assert.ok(!checks[ids[1]].warnings.some(w=>w.code==='CELL_EDGE_CONTACT'))
})
test('sheet empty or opaque cells remain diagnostic, missing emotion slots do not affect valid cells',()=>{
  const ids=assetSheetEmotionIds(DECLARED,{}), emptyChecks={}, opaqueChecks={}
  sliceAssetAvatarSheet(png(1536,1024,{empty:true}),ids,{checks:emptyChecks})
  sliceAssetAvatarSheet(png(1536,1024,{opaque:true}),ids,{checks:opaqueChecks})
  assert.ok(Object.values(emptyChecks).every(c=>c.warnings.some(w=>w.code==='EMPTY_IMAGE')))
  assert.ok(Object.values(opaqueChecks).every(c=>c.warnings.some(w=>w.code==='NO_TRANSPARENCY')&&c.warnings.some(w=>w.code==='CELL_EDGE_CONTACT')))
  const bytes=avatarSheet(ids.map(()=>({x:90,y:60,w:200,h:300}))), all=sliceAssetAvatarSheet(bytes,ids)
  const missing=sliceAssetAvatarSheet(bytes,ids.map((id,i)=>i===7?null:id))
  assert.equal(Object.keys(missing).length,7);assert.deepEqual(missing.joy,all.joy)
})

test('RPC result envelopes expose actionable codes, not secrets',async()=>{
  assert.deepEqual(await assetGenerationResult(()=>{throw Object.assign(new Error('confirm'),{code:'BILLING_CONFIRMATION_REQUIRED',mayHaveCharged:true})}),{ok:false,error:{code:'BILLING_CONFIRMATION_REQUIRED',message:'confirm',retryable:false,mayHaveCharged:true}})
})

test('all asset generation RPCs reject cross-origin carriers before dispatch',async()=>{
  let handler;const calls=[],server={register(spec){if(spec.path==='/api/dsh-tavern')handler=spec.handler;return()=>{}}}
  registerTavernHttpRoutes({ctx:{get:name=>name==='connection'?{requestRejection:()=>undefined}:server,effect:fn=>fn()},str:String,performanceDiagnostics:{http(){}},fontLibrary:{serve:async()=>false},runtimeReadiness:Promise.resolve({ok:true}),dispatch:async method=>{calls.push(method);return {ok:true,data:{}}}})
  for(const method of ['prepareAssetGeneration','generateAssetCandidate','getAssetGenerationJob','cancelAssetGenerationJob','listAssetCandidates','readAssetCandidate','rejectAssetCandidate','retryAssetCandidateSave','acceptAssetCandidate']){
    for(const origin of [undefined,'null','http://localhost:43121','http://localhost:43120']){
      let status
      await handler({url:'/api/dsh-tavern/'+method,method:'POST',headers:{host:'localhost:43120',...(origin?{origin}:{})},async *[Symbol.asyncIterator](){yield Buffer.from('{}')}},{writeHead:s=>{status=s},end(){}})
      assert.equal(status,origin==='http://localhost:43120'?200:403)
    }
  }
  assert.equal(calls.length,9)
})

test('shared browser RPC preserves structured asset billing errors and legacy string errors',async()=>{
  const source=await readFile(new URL('../tavern-plugin/src/client/main.js',import.meta.url),'utf8')
  const start=source.indexOf('const detail = result?.error'),end=source.indexOf('throw error;',start)+'throw error;'.length
  for(const result of [{error:{message:'confirm',code:'BILLING_CONFIRMATION_REQUIRED',retryable:false,mayHaveCharged:true,privateState:'secret'}},{error:'legacy',errorCode:'LEGACY'}]){
    const error=runInNewContext('(function(){try{'+source.slice(start,end)+'}catch(error){return error}})()',{result})
    assert.equal(error.message,result.error.message||result.error);assert.equal(error.code,result.error.code||result.errorCode);assert.equal(error.privateState,undefined)
    if(typeof result.error==='object'){assert.equal(error.mayHaveCharged,true);assert.equal(error.retryable,false)}
  }
})

// private fork: failures never consume the original candidate or create empty entries.
test('redraw failure retains original; successful redraw supersedes only after saving',async t=>{
  const f=await fixture(t),{jobs:[original]}=await generate(f)
  f.setMode('500')
  const {jobs:[failed]}=await generate(f,{redrawOf:original.jobId,note:'warmer'})
  assert.equal(failed.status,'failed')
  assert.equal((await f.service.get({jobId:original.jobId})).status,'candidate')
  assert.ok((await f.service.read({jobId:original.jobId})).base64)
  f.setMode('ok')
  const {jobs:[next]}=await generate(f,{redrawOf:original.jobId,note:'brighter'})
  assert.equal(next.status,'candidate')
  assert.equal((await f.service.get({jobId:original.jobId})).status,'rejected')
})

test('pack background creates one named entry only at accept; reject and cancel leave none',async t=>{
  const f=await fixture(t),target={packId:f.packId,kind:'background'}
  const {jobs:[first]}=await generate(f,{target,userPrompt:'Quiet room. Evening light'})
  assert.equal((await f.fresh()).manifest.assets.length,0)
  await f.service.reject({jobId:first.jobId})
  const plan=await prepare(f,{target,userPrompt:'Cancelled room'})
  f.setMode('wait')
  const {jobs:[running]}=await f.service.generate({planId:plan.planId,consentToken:plan.consentToken})
  await f.service.cancel({jobId:running.jobId})
  assert.equal((await f.fresh()).manifest.assets.length,0)
  f.setMode('ok')
  const {jobs:[candidate]}=await generate(f,{target,userPrompt:'Quiet room. Evening light'})
  const args={jobId:candidate.jobId,expectedRevision:(await f.fresh()).revision}
  await f.service.accept(args);await f.service.accept(args)
  const entries=(await f.fresh()).manifest.assets
  assert.equal(entries.length,1);assert.equal(entries[0].name,'Quiet room');assert.ok(entries[0].media)
})

// private fork: two-layer settei is optional pack metadata but mandatory for new generation.
test('identity candidate acceptance writes palette, gates outfits and freezes parent authority',async t=>{
  const f=await fixture(t,{identity:false})
  // private fork (figure quick fixes, owner 2026-10): in the app the identity board is a reference when present, not a gate.
  { const plan=await prepare(f); assert.equal(plan.references.some(r=>r.purpose==='identity-settei'),false) }
  assert.equal(f.requests.length,0)
  const identityTarget={packId:f.packId,figureId:f.figureId,kind:'identity-settei'}
  const {jobs:[identity],plan}=await generate(f,{target:identityTarget})
  assert.equal(plan.target.outfitKey,undefined)
  // private fork: representative outfits and signature accessories define identity, not outfit approval.
  assert.match(plan.prompt,/Full-body views must wear the character's most representative outfit/)
  assert.match(plan.prompt,/Signature accessories are identity features and must appear on the board/)
  assert.match(plan.prompt,/official key visual and in most outfits/)
  assert.match(plan.prompt,/Accessories appearing only with specific outfits remain outfit-level/)
  assert.match(plan.prompt,/does not approve that outfit; outfit settei still requires separate creation and review/)
  const palette=[{role:'base',zone:'hair',hex:'#112233'}]
  await assert.rejects(f.service.accept({jobId:identity.jobId,expectedRevision:(await f.fresh()).revision,palette:[{role:'base',zone:'hair',hex:'red'}]}))
  assert.equal((await f.service.get({jobId:identity.jobId})).status,'candidate')
  await f.service.accept({jobId:identity.jobId,expectedRevision:(await f.fresh()).revision,palette})
  let pack=await f.fresh(), figure=pack.figures[f.figureId]
  assert.deepEqual(figure.identitySettei.palette,palette)
  assert.equal(figure.identitySettei.board,identity.candidate.hash)
  await assert.rejects(f.library.removeBlob({packId:f.packId,expectedRevision:pack.revision,hash:identity.candidate.hash}))
  const {jobs:[outfit],plan:outfitPlan}=await generate(f)
  assert.equal(outfitPlan.references[0].purpose,'identity-settei')
  await f.library.patchFigure({packId:f.packId,expectedRevision:pack.revision,figureId:f.figureId,patch:{identitySettei:{...figure.identitySettei,version:'updated'}}})
  await assert.rejects(f.service.accept({jobId:outfit.jobId,expectedRevision:(await f.fresh()).revision,replace:true}),code('TARGET_CHANGED'))
  await assert.rejects(prepare(f,{redrawOf:outfit.jobId,note:'try again'}),code('TARGET_CHANGED'))
  assert.equal((await f.service.get({jobId:outfit.jobId})).status,'candidate')
  const accepted=await acceptedSettei(f)
  pack=await f.fresh();figure=pack.figures[f.figureId]
  assert.equal(figure.outfits[0].setteiParentVersion,'updated')
  const spritePlan=await prepare(f,{target:{...f.target,kind:'sprite',emotionId:'calm'}})
  assert.ok(spritePlan.references.some(r=>r.purpose==='identity-settei'))
  await f.library.patchFigure({packId:f.packId,expectedRevision:pack.revision,figureId:f.figureId,patch:{identitySettei:{...figure.identitySettei,version:'updated-again'}}})
  // private fork (figure quick fixes): a 设定图 drawn from an older identity board still serves a 立绘; the stale board is left out.
  { const stale=await prepare(f,{target:{...f.target,kind:'sprite',emotionId:'calm'}}); assert.equal(stale.references.some(r=>r.purpose==='identity-settei'),false); assert.equal(stale.references[0].hash,accepted.candidate.hash) }
  assert.equal((await f.fresh()).figures[f.figureId].outfits[0].settei,accepted.candidate.hash)
})

test('old outfit boards remain valid pack data; identity metadata is strictly validated and removable',async t=>{
  const f=await fixture(t),pack=await f.fresh(),identity=pack.figures[f.figureId].identitySettei
  const oldOutfit={...pack.figures[f.figureId].outfits[0],settei:identity.board}
  const next=(await f.library.patchFigure({packId:f.packId,expectedRevision:pack.revision,figureId:f.figureId,patch:{outfits:[oldOutfit],identitySettei:null}})).snapshot
  assert.equal(next.figures[f.figureId].identitySettei,undefined)
  assert.equal(next.figures[f.figureId].outfits[0].settei,identity.board)
  for(const bad of [{...identity,board:'a'.repeat(64)},{...identity,version:''},{...identity,palette:[{role:'base',zone:'skin',hex:'#GGGGGG'}]}]) {
    await assert.rejects(f.library.patchFigure({packId:f.packId,expectedRevision:next.revision,figureId:f.figureId,patch:{identitySettei:bad}}))
  }
  assert.equal((await f.fresh()).revision,next.revision)
  const exported=await f.library.exportPack({packId:f.packId,expectedRevision:next.revision})
  assert.ok(exported.bytes.length)
})