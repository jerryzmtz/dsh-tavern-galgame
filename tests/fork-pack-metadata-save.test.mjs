// private fork: metadata writes do not visit media, while new bytes remain an ingress boundary.
import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp, mkdir, readFile, writeFile, lstat, readdir, unlink, rmdir, rename, utimes} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {randomUUID} from 'node:crypto'
import {createAssetPackService} from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/service.js'
import {jsonBytes, sealPack, verifyBytes} from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/validation.js'
import {verifyPackFiles, verifyPackHashes} from '../tavern-plugin/packages/dsh-asset-library/src/asset-packs/index.js'
import {syntheticPack, PACK_ID, FIGURE_ID} from './fixtures/asset-packs/pack.mjs'

async function clean(dir) {
  for (const entry of await readdir(dir, {withFileTypes:true})) {
    const file=path.join(dir,entry.name)
    if(entry.isDirectory()&&!entry.isSymbolicLink()) await clean(file)
    else await unlink(file)
  }
  await rmdir(dir)
}
async function fixture(t) {
  const root=await mkdtemp(path.join(os.tmpdir(),'metadata-save-')),pack=await syntheticPack(),visited=[]
  let failure='',decodes=0,time=2000000000000
  const put=async(name,bytes)=>{const file=path.join(root,name);await mkdir(path.dirname(file),{recursive:true});await writeFile(file,bytes)}
  await put(`packs/${PACK_ID}/manifest.json`,jsonBytes(pack.manifest))
  await put(`local/${PACK_ID}.json`,jsonBytes({revision:'original',retired:[]}))
  for(const [name,bytes] of pack.files) await put(`packs/${PACK_ID}/${name}`,bytes)
  const services=[]
  const fresh=()=>{const service=createAssetPackService({assetRoot:root,now:()=>time,inspectPath:async file=>{visited.push(file.replaceAll('\\','/'));return lstat(file)},decodeMedia:async()=>{decodes++;throw new Error('unexpected decode')},fault:async point=>{if(point===failure)throw new Error('injected '+point)}});services.push(service);return service}
  t.after(async()=>{for(const s of services)await s.dispose();await clean(root)})
  return {root,pack,visited,put,fresh,service:fresh(),clock:value=>{time=value},fail:point=>{failure=point},get decodes(){return decodes}}
}
const figurePatch=(s,patch)=>s.patchFigure({packId:PACK_ID,figureId:FIGURE_ID,expectedRevision:'original',patch})

// private fork: legacy timestamps are read-only mtime fills, then persisted by metadata publication.
test('old pack timestamps fill from local commit mtime once without media I/O or read writes',async t=>{
  const f=await fixture(t),file=path.join(f.root,'local',PACK_ID+'.json'),time=1700000000000
  await utimes(file,time/1000,time/1000)
  const bytes=await readFile(file),before=await f.service.getPackSnapshot({packId:PACK_ID})
  assert.equal(before.installedAt,time);assert.equal(before.updatedAt,time)
  assert.deepEqual(await readFile(file),bytes);assert.equal((await lstat(file)).mtimeMs,time)
  assert.deepEqual(await f.fresh().listPacks(),[before])
  f.visited.length=0
  const saved=(await figurePatch(f.service,{name:'Timestamp edit'})).snapshot
  assert.equal(saved.installedAt,time);assert.equal(saved.updatedAt,2000000000000)
  assert.equal(f.visited.some(n=>/\/(media|bundles)(\/|$)/.test(n)),false);assert.equal(f.decodes,0)
  const local=JSON.parse(await readFile(file,'utf8'))
  assert.equal(local.installedAt,time);assert.equal(local.updatedAt,saved.updatedAt)
  await utimes(file,1800000000,1800000000)
  assert.deepEqual(await f.fresh().getPackSnapshot({packId:PACK_ID}),saved,'stored times ignore future filesystem mtime changes')
  f.clock(2100000000000)
  const noop=await f.service.patchPack({packId:PACK_ID,expectedRevision:saved.revision,patch:{name:saved.manifest.name}})
  assert.equal(noop.status,'noop');assert.deepEqual(noop.snapshot,saved)
})

test('first install and content commits expose persistent local timestamps without changing export content',async t=>{
  const f=await fixture(t),created=await f.service.createPack({name:'Fresh',expectedRevision:null}),before=created.snapshot,id=before.manifest.id
  assert.equal(before.installedAt,2000000000000);assert.equal(before.updatedAt,before.installedAt)
  f.clock(2100000000000)
  const saved=(await f.service.createFigure({packId:id,expectedRevision:before.revision,figure:{schemaVersion:1,name:'New figure',enabled:true,outfits:[]}})).snapshot
  assert.equal(saved.installedAt,before.installedAt);assert.equal(saved.updatedAt,2100000000000)
  assert.deepEqual(await f.fresh().getPackSnapshot({packId:id}),saved)
  assert.equal('installedAt' in saved.manifest,false);assert.equal('updatedAt' in saved.manifest,false)
  const exported=await f.service.exportPack({packId:id,expectedRevision:saved.revision})
  f.clock(2200000000000)
  const preview=await f.service.inspectImport({bytes:exported.bytes})
  const noop=await f.service.applyImport({inspectionId:preview.inspectionId,expectedRevision:preview.expectedRevision,decision:'noop'})
  assert.deepEqual(noop.snapshot,saved)
  await f.service.removePack({packId:id,expectedRevision:saved.revision})
  const reinstall=await f.service.inspectImport({bytes:exported.bytes})
  const installed=(await f.service.applyImport({inspectionId:reinstall.inspectionId,expectedRevision:reinstall.expectedRevision,decision:'install'})).snapshot
  assert.equal(installed.installedAt,before.installedAt);assert.equal(installed.updatedAt,2200000000000)
})

test('outfit recall/name/enable edits never touch media or another pack, retain hashes and atomically publish metadata',async t=>{
  const f=await fixture(t),before=await f.service.getPackSnapshot({packId:PACK_ID})
  const media=[...f.pack.files.keys()].filter(n=>n.startsWith('media/')||n.startsWith('bundles/'))
  const stats=await Promise.all(media.map(n=>lstat(path.join(f.root,'packs',PACK_ID,n))))
  f.visited.length=0
  const outfits=structuredClone(before.figures[FIGURE_ID].outfits)
  outfits[0].recall={mode:'keyword',keywords:[outfits[0].label,'uniform']}
  const saved=await figurePatch(f.service,{outfits,enabled:false,heightCm:165})
  assert.equal(saved.status,'updated');assert.notEqual(saved.snapshot.revision,'original')
  assert.equal(f.visited.some(n=>/\/(media|bundles)(\/|$)/.test(n)),false)
  assert.equal(f.decodes,0)
  for(const [i,name] of media.entries()){
    const after=await lstat(path.join(f.root,'packs',PACK_ID,name))
    assert.equal(after.ino,stats[i].ino);assert.equal(after.mtimeMs,stats[i].mtimeMs)
  }
  for(const file of f.pack.manifest.files.filter(file=>!file.path.startsWith('figures/'))) assert.deepEqual(saved.snapshot.manifest.files.find(x=>x.path===file.path),file)
  const manifest=JSON.parse(await readFile(path.join(f.root,'packs',PACK_ID,'manifest.json'),'utf8'))
  await verifyPackHashes(manifest)
  const files=new Map(await Promise.all(manifest.files.map(async file=>[file.path,await readFile(path.join(f.root,'packs',PACK_ID,file.path))])))
  await verifyPackFiles(manifest,files)
  assert.deepEqual((await f.fresh().getPackSnapshot({packId:PACK_ID})).figures[FIGURE_ID].outfits,outfits)
  await assert.rejects(figurePatch(f.service,{enabled:true}),{code:'REVISION_CONFLICT'})
  const assets=saved.snapshot.manifest.assets.map(a=>a.kind==='backgrounds'?{...a,enabled:false,recall:{...a.recall,mode:'constant'}}:a)
  const changed=await f.service.patchPack({packId:PACK_ID,expectedRevision:saved.snapshot.revision,patch:{assets}})
  assert.equal(changed.status,'updated')
  assert.deepEqual((await f.fresh().getPackSnapshot({packId:PACK_ID})).manifest.assets,assets)
})

test('avatar crop and outfit order/mapping changes publish only figure metadata',async t=>{
  const f=await fixture(t);await f.service.getPackSnapshot({packId:PACK_ID});f.visited.length=0
  const crop={x:0.1,y:0.1,w:0.5,h:0.5}
  const first=await f.service.setFigureAvatarCrop({packId:PACK_ID,figureId:FIGURE_ID,expectedRevision:'original',outfitKey:'school',scope:'state',stateId:'calm',crop})
  assert.deepEqual(first.snapshot.figures[FIGURE_ID].outfits[0].sprite.avatarCrop.calm,crop)
  assert.equal(f.visited.some(n=>/\/(media|bundles)(\/|$)/.test(n)),false)
  const outfits=structuredClone(first.snapshot.figures[FIGURE_ID].outfits).reverse()
  outfits[0].live2d.emotionMap={joy:{expression:'smile'}}
  f.visited.length=0
  const second=await f.service.patchFigure({packId:PACK_ID,figureId:FIGURE_ID,expectedRevision:first.snapshot.revision,patch:{outfits}})
  assert.equal(second.snapshot.figures[FIGURE_ID].outfits[0].key,'casual')
  assert.equal(f.visited.some(n=>/\/media(\/|$)/.test(n)),false)
  assert.equal(f.decodes,0)
})

for(const point of ['prepared','backed-up','pack-published','local-published'])test('metadata publication rolls back both documents and revision at '+point,async t=>{
  const f=await fixture(t),before=await f.service.getPackSnapshot({packId:PACK_ID}),events=[]
  f.service.subscribe(e=>events.push(e));f.fail(point)
  await assert.rejects(figurePatch(f.service,{name:'Changed'}),new RegExp('injected '+point))
  assert.deepEqual(await f.fresh().getPackSnapshot({packId:PACK_ID}),before)
  assert.deepEqual(events,[])
  assert.deepEqual(await readdir(path.join(f.root,'staging')),[])
})

test('metadata journal recovery restores a partial publication without touching media',async t=>{
  const f=await fixture(t),before=await f.service.getPackSnapshot({packId:PACK_ID}),tx=`staging/${randomUUID()}`,name=`figures/${FIGURE_ID}.json`
  // Ownerless old journals are recoverable; use an owner known to have exited.
  await f.put(tx+'/owner.json',jsonBytes({pid:2147483647,token:'exited',createdAt:0}))
  await f.put(tx+'/journal.json',jsonBytes({version:3,id:PACK_ID,files:[name,'manifest.json']}))
  for(const item of [name,'manifest.json','@local']){
    const source=item==='@local'?`local/${PACK_ID}.json`:`packs/${PACK_ID}/${item}`
    const target=path.join(f.root,tx,'old',item);await mkdir(path.dirname(target),{recursive:true})
    await rename(path.join(f.root,source),target)
  }
  await f.put(`packs/${PACK_ID}/${name}`,jsonBytes({...before.figures[FIGURE_ID],name:'uncommitted'}))
  assert.deepEqual(await f.fresh().getPackSnapshot({packId:PACK_ID}),before)
})

test('metadata validation still rejects invalid recall and cannot smuggle media/reference changes',async t=>{
  const f=await fixture(t),before=await f.service.getPackSnapshot({packId:PACK_ID}),outfits=structuredClone(before.figures[FIGURE_ID].outfits)
  outfits[0].recall.mode='invalid'
  await assert.rejects(figurePatch(f.service,{outfits}))
  outfits[0].recall.mode='keyword';outfits[0].sprite.assets['assets/atlas.png']='f'.repeat(64)
  await assert.rejects(figurePatch(f.service,{outfits}))
  assert.deepEqual(await f.service.getPackSnapshot({packId:PACK_ID}),before)
})

test('sealed edits reuse unchanged media digests but validate changed bytes and dimensions',async()=>{
  const pack=await syntheticPack(),before=await verifyBytes(pack.manifest,pack.files)
  const manifest=structuredClone(pack.manifest),files=new Map(pack.files)
  manifest.name='Changed'
  await sealPack(manifest,files,before)
  for(const file of manifest.files)assert.equal(file,before.manifest.files.find(x=>x.path===file.path))
  await verifyBytes(manifest,files,{previous:before,sealed:true,decodeMedia:()=>{throw new Error('unchanged media decoded')}})
  const name=[...files.keys()].find(n=>n.endsWith('.png')&&n.startsWith('media/')),bad=Buffer.from(files.get(name));bad[0]^=1;files.set(name,bad)
  await sealPack(manifest,files,before)
  assert.notEqual(manifest.files.find(x=>x.path===name).sha256,before.manifest.files.find(x=>x.path===name).sha256)
  await assert.rejects(verifyBytes(manifest,files,{previous:before,sealed:true}))
})

// private fork: an import/fill uses one existing-figure metadata transaction, without media reads.
test('autoColor batch uses CAS metadata publication, preserves manual fields and exports the derived field',async t=>{
  const f=await fixture(t),before=await f.service.getPackSnapshot({packId:PACK_ID})
  const figure={...before.figures[FIGURE_ID],imageColor:'#abcdef',autoColor:'#ee99aa'}
  f.visited.length=0
  const saved=await f.service.patchPack({packId:PACK_ID,expectedRevision:'original',fileUpdates:new Map([['figures/'+FIGURE_ID+'.json',jsonBytes(figure)]])})
  assert.equal(saved.snapshot.figures[FIGURE_ID].autoColor,'#ee99aa')
  assert.equal(saved.snapshot.figures[FIGURE_ID].imageColor,'#abcdef')
  assert.equal(f.visited.some(n=>/\/(media|bundles)(\/|$)/.test(n)),false);assert.equal(f.decodes,0)
  await assert.rejects(f.service.patchFigure({packId:PACK_ID,figureId:FIGURE_ID,expectedRevision:'original',patch:{autoColor:'#112233'}}),{code:'REVISION_CONFLICT'})
  const automatic=await f.service.patchFigure({packId:PACK_ID,figureId:FIGURE_ID,expectedRevision:saved.snapshot.revision,patch:{imageColor:null,name:'Renamed'}})
  assert.equal(automatic.snapshot.figures[FIGURE_ID].autoColor,'#ee99aa');assert.equal(automatic.snapshot.figures[FIGURE_ID].imageColor,undefined)
  const archive=await f.service.exportPack({packId:PACK_ID,expectedRevision:automatic.snapshot.revision}),inspection=await f.service.inspectImport({bytes:archive.bytes})
  assert.equal(inspection.incoming.figures[FIGURE_ID].autoColor,'#ee99aa')
  assert.equal(inspection.incoming.figures[FIGURE_ID].imageColor,undefined)
})
test('batch metadata cannot bypass autoColor validation or smuggle an unlisted figure document',async t=>{
  const f=await fixture(t),before=await f.service.getPackSnapshot({packId:PACK_ID})
  await assert.rejects(f.service.patchPack({packId:PACK_ID,expectedRevision:'original',fileUpdates:new Map([['figures/'+FIGURE_ID+'.json',jsonBytes({...before.figures[FIGURE_ID],autoColor:'red'})]])}))
  const other='44444444-4444-4444-8444-444444444444'
  await assert.rejects(f.service.patchPack({packId:PACK_ID,expectedRevision:'original',fileUpdates:new Map([['figures/'+other+'.json',jsonBytes({...before.figures[FIGURE_ID],id:other,autoColor:'#123456'})]])}))
  assert.deepEqual(await f.service.getPackSnapshot({packId:PACK_ID}),before)
})
