// private fork: exercise the production browser port against the real v2 carrier.
import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import {readFile,mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createAssetPackTransport} from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/transport.js'
import {writeZip} from '../tavern-plugin/packages/dsh-asset-library/src/zip.js'
import {jsonBytes} from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/validation.js'
import {syntheticPack,PACK_ID} from './fixtures/asset-packs/pack.mjs'
const source=await readFile(new URL('../tavern-plugin/src/client/fork-pack-transport.js',import.meta.url),'utf8')
const create=(options)=>{const ctx={AbortController,setTimeout,clearTimeout,URL,Blob,Uint8Array};vm.runInNewContext(source,ctx);return ctx.createForkPackTransport(options)}
const tick=()=>new Promise(resolve=>setTimeout(resolve,5))
async function fixture(t){
  const root=await mkdtemp(join(tmpdir(),'browser-pack-')),routes=new Map(),calls=[]
  const host=createAssetPackTransport({assetRoot:join(root,'assets')}),stop=host.attach({fetch:{register(route){routes.set(route.path,route);return()=>routes.delete(route.path)}}})
  const client=create({interval:10,fetch:async(path,options)=>{
    calls.push([path,options]); const route=routes.get(path.split('?')[0]);if(!route)return Response.json({error:'ASSET_UNAVAILABLE'},{status:503})
    return route.fetch(new Request('http://dsh.internal'+path,{...options,headers:{...options.headers,host:'localhost:123',origin:'http://localhost:123','sec-fetch-site':'same-origin'}}))
  }})
  t.after(async()=>{client.dispose();stop();await host.service.dispose();await rm(root,{recursive:true,force:true})})
  const pack=await syntheticPack(),zip=join(root,'pack.zip')
  await writeZip(zip,[{path:'manifest.json',data:jsonBytes(pack.manifest)},...[...pack.files].map(([path,data])=>({path,data}))])
  return {client,host,calls,stop,pack,bytes:new Uint8Array(await readFile(zip))}
}
test('browser imports binary, exports/downloads and copies via inspection without JSON byte arrays',async t=>{
  const f=await fixture(t),service=f.client.service
  const preview=await service.inspectImport({bytes:f.bytes})
  const installed=await service.applyImport({inspectionId:preview.inspectionId,expectedRevision:null,decision:'install'})
  assert.equal(installed.snapshot.manifest.id,PACK_ID)
  // private fork: local commit times survive the real JSON RPC carrier unchanged.
  assert.ok(installed.snapshot.installedAt>0)
  assert.equal(installed.snapshot.updatedAt,installed.snapshot.installedAt)
  assert.deepEqual(await service.getPackSnapshot({packId:PACK_ID}),installed.snapshot)
  // private fork (perf: pack list summary): the browser lists summaries only (no files, blobs, sprites or documents).
  const [row]=await service.listPackSummaries(),snap=installed.snapshot
  assert.deepEqual({packId:row.packId,name:row.name,revision:row.revision,updatedAt:row.updatedAt},{packId:PACK_ID,name:snap.manifest.name,revision:snap.revision,updatedAt:snap.updatedAt})
  assert.equal(row.bytes,snap.manifest.files.reduce((sum,file)=>sum+file.size,0))
  assert.equal(row.counts.figures,snap.manifest.figures.length)
  for(const key of ['manifest','figures','sprites','widgets'])assert.equal(row[key],undefined,key)
  assert.equal(service.listPacks,undefined)
  // A full document read is kept by revision: asking for the same revision again sends no request.
  assert.equal(await service.packDetail({packId:PACK_ID,revision:row.revision}),await service.packDetail({packId:PACK_ID,revision:row.revision}))
  const exported=await service.exportPack({packId:PACK_ID,expectedRevision:installed.snapshot.revision})
  assert.equal(exported.bytes,undefined);assert.ok(exported.download.ticket)
  const bytes=await f.client.bytes(exported);assert.ok(bytes.byteLength>100)
  const copy=await service.inspectImport({bytes,copy:true});assert.ok(copy.choices.includes('keep-both'))
  await service.applyImport({inspectionId:copy.inspectionId,expectedRevision:copy.expectedRevision,decision:'cancel'})
  const inspect=f.calls.filter(([,o])=>o.body&&typeof o.body==='string').map(([,o])=>JSON.parse(o.body)).find(v=>v.method==='inspectImport')
  assert.equal(typeof inspect.args.bytes,'string')
  assert.ok(f.calls.filter(([p])=>p.endsWith('/upload')).every(([,o])=>o.body instanceof Uint8Array))
})
test('fileUpdate Maps travel through upload tickets and keep server CAS failures',async t=>{
  const f=await fixture(t),s=f.client.service,p=await s.inspectImport({bytes:f.bytes})
  const {snapshot}=await s.applyImport({inspectionId:p.inspectionId,expectedRevision:null,decision:'install'})
  await assert.rejects(s.patchPack({packId:PACK_ID,expectedRevision:'stale',patch:{name:'No'},fileUpdates:new Map([['figures/ignored.json',new Uint8Array([1,2])]])}),{code:'REVISION_CONFLICT'})
  const sent=f.calls.filter(([,o])=>typeof o.body==='string').map(([,o])=>JSON.parse(o.body)).find(v=>v.method==='patchPack')
  assert.equal(sent.args.fileUpdates[0][0],'figures/ignored.json');assert.equal(typeof sent.args.fileUpdates[0][1],'string')
  assert.equal((await s.getPackSnapshot({packId:PACK_ID})).revision,snapshot.revision)
})
test('change feed invalidates subscribers and detach clears availability',async t=>{
  const f=await fixture(t),events=[];let unavailable=0
  f.client.service.subscribe(event=>events.push(event));f.client.onUnavailable(()=>unavailable++);f.client.start()
  for(let i=0;i<100&&!f.client.available();i++)await tick()
  assert.equal(f.client.available(),true)
  await f.client.service.createPack({name:'Empty',expectedRevision:null})
  for(let i=0;i<100&&!events.some(e=>e.type==='pack');i++)await tick()
  assert.ok(events.some(e=>e.type==='pack'));f.stop()
  for(let i=0;i<100&&f.client.available();i++)await tick()
  assert.equal(f.client.available(),false);assert.equal(unavailable,1)
})
test('partial uploads are discarded on conversion failure and disposal aborts pending requests',async()=>{
  const sent=[];let count=0
  const client=create({fetch:async(path,options)=>{
    if(path.endsWith('/upload')) {if(++count===2)throw new Error('upload failed');return Response.json({ticket:'first'})}
    sent.push(JSON.parse(options.body));return Response.json({released:true})
  }})
  await assert.rejects(client.service.putBundle({files:new Map([['one',new Uint8Array(1)],['two',new Uint8Array(1)]])}),/upload failed/)
  await tick();assert.ok(sent.some(v=>v.method==='discardUpload'&&v.args.ticket==='first'));client.dispose()
  let signal
  const pending=create({fetch:(_,options)=>new Promise((_,reject)=>{signal=options.signal;signal.addEventListener('abort',()=>reject(new Error('aborted')))})})
  const request=pending.service.listPackSummaries();pending.dispose();await assert.rejects(request,/aborted/);assert.equal(signal.aborted,true)
})

test('private fork: one batch action hands every volume directly to the download manager without fetching a Blob',async()=>{
  const clicked=[],context={AbortController,setTimeout,clearTimeout,URL,Blob,Uint8Array,document:{createElement(){return {click(){clicked.push({url:this.href,filename:this.download})}}}}}
  vm.runInNewContext(source,context)
  const client=context.createForkPackTransport({fetch:()=>{throw Error('renderer must not buffer downloads')}})
  await client.download({archives:[1,2,3].map(i=>({filename:'素材包合集-'+i+'of3.zip',download:{ticket:'ticket-'+i}}))})
  assert.equal(clicked.length,3) // private fork
  assert.deepEqual(clicked.map(x=>x.filename),[1,2,3].map(i=>'素材包合集-'+i+'of3.zip')) // private fork
  assert.ok(clicked.every((x,i)=>x.url==='/api/dsh-asset-library/v2/download?ticket=ticket-'+(i+1))) // private fork
  client.dispose()
})