import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp, readFile, writeFile, mkdir, readdir, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {createAssetPackService} from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/service.js'
import {createTts} from '../tavern-plugin/packages/dsh-tts/src/service.js'
import {Settings,createServiceSettings} from '../tavern-plugin/packages/dsh-tts/src/settings.js'
import {validateVoice} from '../tavern-plugin/packages/dsh-asset-library/lib/asset-packs/index.js' // private fork
import {createCardBundleAdapter} from '../tavern-plugin/lib/fork-card-bundle.js'
import {BUBBLE_WORLDBOOK_COMMENT} from '../tavern-plugin/lib/domain/dialogue-bubbles.js'
import {createCardPreparation, rawData} from '../tavern-plugin/lib/domain/card-preparation.js'
import {sealPack, jsonBytes} from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/validation.js'
import {writeZip, openZip} from '../tavern-plugin/packages/dsh-asset-library/src/zip.js'
import {syntheticPack, cardExtension, PACK_ID, FIGURE_ID} from './fixtures/asset-packs/pack.mjs'
const clone = v => structuredClone(v)
// private fork: imports now add the managed entry; all authored raw remains unchanged.
function assertImportedRaw(actual, expected) {
  const value = clone(actual), data = rawData(value)
  const entries = data.character_book.entries.filter(entry => entry.comment === BUBBLE_WORLDBOOK_COMMENT)
  assert.equal(entries.length, 1)
  assert.equal(entries[0].constant, true)
  assert.ok(entries[0].extensions.dsh_tavern_helper_extra.forkDialogueBubbles)
  delete data.character_book
  assert.deepEqual(value, expected)
}
async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(),'card-bundle-')), prep = createCardPreparation(), locks = new Map()
  let tts = null, failure = null, writeFailure = false, lostAck = false, readFailure = false, time = 2000000000000
  const raw = {name:'Synthetic card',extensions:{dsh_tavern:cardExtension(),foreign:{preserved:true}}}
  // private fork: custom emotions belong to the embedded figure, not the cast extension.
  raw.extensions.dsh_tavern.assetBindings.boundPackIds = [PACK_ID]
  // private fork: opening refs exercise remapping without recreating card cast.
  raw.extensions.dsh_tavern.openings = {lead:{packId:PACK_ID,figureId:FIGURE_ID}}
  const cards = new Map([['source',prep.create({kind:'import',payload:raw})]])
  const covers = new Map()
  const adapter = createCardBundleAdapter({readCover:async key => covers.get(key), cardPreparation:prep, getTts:() => tts, authorizeTarget:async key => {assert.ok(['source','target','target2'].includes(key)); return {cardId:'card-' + key}},
    readWorkspace:async key => {if(readFailure)throw new Error('card temporarily unavailable');return clone(cards.get(key))},
    writeWorkspace:async (key,value,cover) => { if(cover)covers.set(key,cover); if (writeFailure) throw new Error('card write failed'); cards.set(key,clone(value)); if (lostAck) throw new Error('lost ack') },
    withCardLock:async (key,task) => { assert.equal(locks.has(key),false,'no reentrant card locks'); locks.set(key,true); try {return await task()} finally {locks.delete(key)} }})
  const assetRoot = path.join(root,'assets'), options = {assetRoot,now:()=>time,cardTransactions:adapter,fault:async (point,id) => {if (failure?.point === point && (!failure.id || failure.id === id)) {if(failure.recovery)readFailure=true;throw new Error('injected '+point)}}}
  const service = createAssetPackService(options)
  t.after(async () => {failure=null;readFailure=false; await service.dispose(); await rm(root,{recursive:true,force:true})})
  return {root, assetRoot, service, adapter, options, cards, covers, prep, raw, clock:value=>{time=value}, setTts:value => {tts=value}, fail:value => {failure=value;if(!value)readFailure=false}, failCard:value => {writeFailure=value}, loseAck:() => {lostAck=true}}
}
async function install(f, pack = null) {
  pack ||= await syntheticPack()
  const file = path.join(f.root,crypto.randomUUID()+'.zip')
  await writeZip(file,[{path:'manifest.json',data:jsonBytes(pack.manifest)},...[...pack.files].map(([path,data])=>({path,data}))])
  const p = await f.service.inspectImport({bytes:await readFile(file)})
  return (await f.service.applyImport({inspectionId:p.inspectionId,expectedRevision:p.expectedRevision,decision:p.choices.includes('install')?'install':'update',acceptScriptRisk:true})).snapshot
}
// private fork (packs-v3): export names the packs to embed; 'bound-packs' / 'card-only' are just shorthands here.
async function exported(f,mode='bound-packs') {
  const card=await f.adapter.snapshot({path:'source'})
  const packIds=Array.isArray(mode)?mode:mode==='bound-packs'?f.adapter.inspectRaw(card.raw).boundPackIds:[]
  return f.service.exportCardBundle({path:'source',expectedRevision:card.revision,packIds})
}
const inspect = async (f,bytes,key='target') => f.service.inspectCardBundle({bytes,path:key})
function apply(f,p,decision) {
  const decisions = Object.fromEntries(p.packs.map(v=>[v.packId,decision || (v.choices.includes('noop')?'noop':v.choices.includes('install')?'install':'update')]))
  return f.service.applyCardBundle({disableWidgets:false,inspectionId:p.inspectionId,expectedRevision:p.expectedRevision,decisions,acceptScriptRisk:true})
}

// private fork: all batch publications use local commit times, not archive metadata.
test('card bundle update and keep-both stamp commits while preserving first installation',async t=>{
  const f=await fixture(t),original=await install(f),bytes=(await exported(f)).bytes
  f.clock(2100000000000)
  await f.service.patchPack({packId:PACK_ID,expectedRevision:original.revision,patch:{name:'Local change'}})
  f.clock(2200000000000)
  await apply(f,await inspect(f,bytes),'update')
  const updated=await f.service.getPackSnapshot({packId:PACK_ID})
  assert.equal(updated.installedAt,2000000000000);assert.equal(updated.updatedAt,2200000000000)
  f.clock(2300000000000)
  await f.service.patchPack({packId:PACK_ID,expectedRevision:updated.revision,patch:{name:'Another change'}})
  f.clock(2400000000000)
  const kept=await apply(f,await inspect(f,bytes,'target2'),'keep-both')
  const snapshot=await f.service.getPackSnapshot({packId:kept.mappings[0].packId})
  assert.equal(snapshot.installedAt,2400000000000);assert.equal(snapshot.updatedAt,snapshot.installedAt)
})

test('complete card export includes disabled entries, full media and only explicitly bound packs',async t=>{
  const f=await fixture(t),pack=await syntheticPack(); pack.manifest.assets[0].enabled=false; await sealPack(pack.manifest,pack.files)
  await install(f,pack); await f.service.createPack({name:'Global only',expectedRevision:null})
  const {bytes,dependencies}=await exported(f), p=await inspect(f,bytes)
  assert.equal(dependencies.length,1); assert.equal(p.packs[0].incoming.manifest.assets[0].enabled,false)
  assert.deepEqual(p.packs[0].incoming.figures,pack.figures); assert.deepEqual(p.packs[0].incoming.sprites,pack.sprites)
  const zipPath=path.join(f.root,'out.zip'); await writeFile(zipPath,bytes); const zip=await openZip(zipPath)
  assert.equal(zip.entries.length,pack.files.size+3)
  assert.equal(zip.entries.some(e=>/local|cache|authorization|credential/.test(e.path)),false)
  await apply(f,p); assertImportedRaw(f.cards.get('target').raw,f.raw)
})
// private fork: preserve author guidance in figure closure and build the managed writer entry from imported metadata.
test('figure emotion guidance roundtrips in card ZIP without recreating retired card emotions',async t=>{
  const f=await fixture(t),pack=await syntheticPack()
  pack.figures[FIGURE_ID].emotions=[{id:'joy',guidance:'Quiet happiness'},{id:'smug',label:'得意',guidance:'Small boast'}]
  // private fork: the authored variant is an actual available sprite.
  pack.sprites.school.emotions.smug=structuredClone(pack.sprites.school.emotions.calm)
  pack.files.set('sprites/school/manifest.json',jsonBytes(pack.sprites.school))
  pack.figures[FIGURE_ID].outfits[0].avatars.smug=pack.figures[FIGURE_ID].outfits[0].avatars.calm
  pack.files.set(`figures/${FIGURE_ID}.json`,jsonBytes(pack.figures[FIGURE_ID]));await sealPack(pack.manifest,pack.files)
  await install(f,pack)
  const preview=await inspect(f,(await exported(f)).bytes)
  // private fork: legacy import expands implicit rows without changing authored guidance.
  const declarations=preview.packs[0].incoming.figures[FIGURE_ID].emotions
  for(const row of pack.figures[FIGURE_ID].emotions)assert.equal(declarations.find(value=>value.id===row.id).guidance,row.guidance)
  assert.equal(declarations.find(row=>row.id==='joy').label,'喜悦')
  await apply(f,preview)
  const raw=f.cards.get('target').raw
  assert.equal(Object.hasOwn(raw.extensions.dsh_tavern,'emotions'),false)
  // private fork: authored guidance is a separate figure entry, not the constant grammar.
  const guidance=raw.character_book.entries.find(entry=>entry.content.includes('Quiet happiness'))
  assert.ok(guidance)
  // private fork: both builtin and custom variants use their display labels, never wire IDs.
  assert.match(guidance.content,/喜悦（Quiet happiness）/) // private fork
  assert.match(guidance.content,/得意（Small boast）/) // private fork
  assert.doesNotMatch(raw.character_book.entries[0].content,/Quiet happiness|Small boast/)
  assertImportedRaw(raw,f.raw)
})
test('card-only import retains standard emotion instructions without leaking sprite IDs',async t=>{
  const f=await fixture(t); await install(f)
  const p=await inspect(f,(await exported(f,'card-only')).bytes)
  assert.equal(p.packs.length,0)
  await apply(f,p)
  assert.doesNotMatch(f.cards.get('target').raw.character_book.entries[0].content,/通用差分/) // private fork: choices moved to the merged figure entry.
})
// private fork: canonical render definitions replace free-form visual labels.
test('import publishes incoming sprite metadata but keeps rendering fields out of writer instructions',async t=>{
  const f=await fixture(t); await install(f)
  const bytes=(await exported(f)).bytes, local=await syntheticPack()
  local.sprites.school.emotions.crying.stage.mouth.x=0.25
  local.files.set('sprites/school/manifest.json',jsonBytes(local.sprites.school))
  await sealPack(local.manifest,local.files); await install(f,local)
  await apply(f,await inspect(f,bytes),'update')
  const content=f.cards.get('target').raw.character_book.entries[0].content
  // private fork: incoming geometry wins; visual metadata is never a writer instruction.
  assert.equal((await f.service.getPackSnapshot({packId:PACK_ID})).sprites.school.emotions.crying.stage.mouth.x,2.25)
  assert.doesNotMatch(content,/通用差分/) // private fork: choices moved to the merged figure entry.
  assert.doesNotMatch(content,/soyo_haruhikage|Special state|Local label/)
  const snapshot=await f.adapter.snapshot({path:'target'})
  assert.equal(snapshot.raw.character_book.entries[0].content,content)
})
test('two cards embedding same UUID choose update explicitly, changing shared body but not first card raw',async t=>{
  const f=await fixture(t); await install(f)
  const first=(await exported(f)).bytes; await apply(f,await inspect(f,first))
  const before=clone(f.cards.get('target').raw), pack=await syntheticPack(); pack.manifest.name='Second edition'; await sealPack(pack.manifest,pack.files)
  await install(f,pack); const second=(await exported(f)).bytes
  await install(f,await syntheticPack())
  const p=await inspect(f,second,'target2'); assert.deepEqual(p.packs[0].choices,['update','keep-both','cancel'])
  await apply(f,p,'update'); assert.equal((await f.service.getPackSnapshot({packId:PACK_ID})).manifest.name,'Second edition')
  assert.deepEqual(f.cards.get('target').raw,before)
})
test('keep-both remaps imported card and every figure while existing card and pack stay unchanged',async t=>{
  const f=await fixture(t); const original=await install(f), bytes=(await exported(f)).bytes
  await apply(f,await inspect(f,bytes)); const before=clone(f.cards.get('target').raw)
  await f.service.patchPack({packId:PACK_ID,expectedRevision:original.revision,patch:{name:'Local edit'}})
  const p=await inspect(f,bytes,'target2'), result=await apply(f,p,'keep-both'), mapping=result.mappings[0]
  const ext=f.cards.get('target2').raw.extensions.dsh_tavern
  assert.deepEqual(ext.assetBindings.boundPackIds,[mapping.packId]); assert.deepEqual(ext.openings.lead,{packId:mapping.packId,figureId:mapping.figures[FIGURE_ID]})
  assert.equal(Object.hasOwn(ext.assetBindings,'characters'),false)
  assert.deepEqual(f.cards.get('target').raw,before); assert.equal((await f.service.getPackSnapshot({packId:PACK_ID})).manifest.name,'Local edit')
  // private fork: preparation receives remapped candidate metadata, not stale installed refs.
  assert.doesNotMatch(f.cards.get('target2').raw.character_book.entries[0].content,/通用差分/) // private fork: choices moved to the merged figure entry.
})
// private fork (packs-v3): an embedded pack is only an import method; after import it is an ordinary library pack.
test('export embeds exactly the listed bound packs; import installs them as independent packs and binds them',async t=>{
  const f=await fixture(t); await install(f)
  const second=(await f.service.createPack({name:'Second',expectedRevision:null})).snapshot.manifest.id
  f.cards.get('source').raw.extensions.dsh_tavern.assetBindings.boundPackIds.push(second)
  const unbound=(await f.service.createPack({name:'Not bound',expectedRevision:null})).snapshot.manifest.id
  await assert.rejects(exported(f,[unbound]),{code:'UNBOUND_PACK'})
  await assert.rejects(exported(f,[second,second]),/Explicit list/)
  await assert.rejects(f.service.exportCardBundle({path:'source',expectedRevision:(await f.adapter.snapshot({path:'source'})).revision,mode:'bound-packs'}),/Explicit list/)
  const out=await exported(f,[second])
  assert.deepEqual(out.dependencies.map(d=>[d.packId,d.embedded]),[[PACK_ID,false],[second,true]])
  // A fresh library: the embedded pack is installed under its own UUID and bound; the other stays a plain reference.
  await f.service.removePack({packId:second,expectedRevision:(await f.service.getPackSnapshot({packId:second})).revision})
  const p=await inspect(f,out.bytes)
  assert.deepEqual(p.packs.map(row=>[row.packId,row.choices]),[[second,['install','keep-both','cancel']]])
  await apply(f,p)
  const installed=await f.service.getPackSnapshot({packId:second}),ext=f.cards.get('target').raw.extensions.dsh_tavern
  assert.equal(installed.manifest.name,'Second')
  assert.deepEqual(ext.assetBindings.boundPackIds,[PACK_ID,second])
  assert.equal(Object.hasOwn(ext,'ownedPackId'),false)
  // Same UUID again: an explicit update/noop like any pack import, never a hidden link to the card.
  const again=await inspect(f,out.bytes,'target2')
  assert.deepEqual(again.packs[0].choices,['noop','cancel'])
})
for (const edit of ['pack','card']) test('preview then '+edit+' edit is rejected without publishing',async t=>{
  const f=await fixture(t), initial=await install(f), p=await inspect(f,(await exported(f)).bytes)
  if(edit==='pack') await f.service.patchPack({packId:PACK_ID,expectedRevision:initial.revision,patch:{name:'Edited'}})
  else f.cards.set('target',f.prep.create({kind:'import',payload:f.raw}))
  await assert.rejects(apply(f,p),{code:'REVISION_CONFLICT'}); assert.equal((await f.service.listPacks()).length,1)
})
test('card-only preserves missing explicit refs; complete export fails rather than dropping a pack',async t=>{
  const f=await fixture(t)
  await assert.rejects(exported(f),{code:'ASSET_UNAVAILABLE'})
  const out=await exported(f,'card-only'), p=await inspect(f,out.bytes)
  assert.equal(p.packs.length,0); assert.equal(p.dependencies[0].contentHash,null)
  await apply(f,p); assertImportedRaw(f.cards.get('target').raw,f.raw)
})
for (const point of ['batch-prepared','batch-backed-up','batch-pack-published','batch-local-published','batch-before-card']) test('multi-pack publication rollback at '+point,async t=>{
  const f=await fixture(t), original=await install(f), second=await f.service.createPack({name:'Second',expectedRevision:null})
  f.cards.get('source').raw.extensions.dsh_tavern.assetBindings.boundPackIds.push(second.snapshot.manifest.id)
  const bytes=(await exported(f)).bytes
  await f.service.patchPack({packId:PACK_ID,expectedRevision:original.revision,patch:{name:'Before'}})
  await f.service.patchPack({packId:second.snapshot.manifest.id,expectedRevision:second.snapshot.revision,patch:{name:'Before second'}})
  const before=await f.service.listPacks(), p=await inspect(f,bytes)
  f.fail({point,id:point.includes('published')||point==='batch-backed-up'?before.at(-1).manifest.id:null})
  await assert.rejects(apply(f,p),'publication must fail'); f.fail(null)
  assert.deepEqual(await f.service.listPacks(),before); assert.equal(f.cards.has('target'),false)
  assert.deepEqual(await readdir(path.join(f.assetRoot,'staging')),[])
})
test('card write failure rolls back packs; lost acknowledgement after durable card commit rolls forward',async t=>{
  const f=await fixture(t), original=await install(f), bytes=(await exported(f)).bytes
  await f.service.patchPack({packId:PACK_ID,expectedRevision:original.revision,patch:{name:'Before'}})
  const before=await f.service.listPacks(), p=await inspect(f,bytes)
  f.failCard(true); await assert.rejects(apply(f,p)); f.failCard(false)
  assert.deepEqual(await f.service.listPacks(),before)
  f.loseAck(); const result=await apply(f,p); assert.equal(result.status,'committed'); assertImportedRaw(f.cards.get('target').raw,f.raw)
})
test('fault after card commit does not roll back committed pack set',async t=>{
  const f=await fixture(t); await install(f); const p=await inspect(f,(await exported(f)).bytes)
  f.fail({point:'batch-card-committed'}); assert.equal((await apply(f,p)).status,'committed'); f.fail(null)
  assert.ok(f.cards.has('target'))
})
test('unconfirmed script import is rejected, cancel never writes, and disposal expires previews',async t=>{
  const f=await fixture(t),scripted=await syntheticPack()
  scripted.files.set('bundles/widget/index.html',Buffer.from('<script>void 0</script>'));await sealPack(scripted.manifest,scripted.files)
  const initial=await install(f,scripted), bytes=(await exported(f)).bytes
  await f.service.patchPack({packId:PACK_ID,expectedRevision:initial.revision,patch:{name:'Local'}})
  const p=await inspect(f,bytes)
  await assert.rejects(f.service.applyCardBundle({disableWidgets:false,inspectionId:p.inspectionId,expectedRevision:p.expectedRevision,decisions:{[PACK_ID]:'keep-both'}}),{code:'SCRIPT_CONFIRMATION_REQUIRED'})
  assert.equal((await f.service.applyCardBundle({disableWidgets:false,inspectionId:p.inspectionId,cancel:true})).status,'cancelled'); assert.equal(f.cards.has('target'),false)
  await f.service.dispose(); await assert.rejects(inspect(f,bytes),{code:'ASSET_UNAVAILABLE'})
})

for (const point of ['batch-prepared','batch-backed-up','batch-pack-published','batch-local-published','batch-before-card','batch-card-committed']) test('recovery closes all pack reads until card status resolves: '+point,async t=>{
  const f=await fixture(t), original=await install(f), bytes=(await exported(f)).bytes
  await f.service.patchPack({packId:PACK_ID,expectedRevision:original.revision,patch:{name:'Before recovery'}})
  const before=await f.service.listPacks(), p=await inspect(f,bytes)
  f.fail({point,recovery:true})
  await assert.rejects(apply(f,p),{code:'RECOVERY_REQUIRED'})
  await assert.rejects(f.service.listPacks(),{code:'RECOVERY_REQUIRED'})
  f.fail(null)
  const restarted=createAssetPackService(f.options)
  try {
    const after=await restarted.listPacks()
    if(point==='batch-card-committed'){assert.equal(after[0].manifest.name,original.manifest.name);assert.ok(f.cards.has('target'))}
    else {assert.deepEqual(after,before);assert.equal(f.cards.has('target'),false)}
    assert.deepEqual(await readdir(path.join(f.assetRoot,'staging')),[])
  } finally {await restarted.dispose()}
})


test('multi-pack keep-both remaps cross-pack author refs and card refs using one frozen mapping',async t=>{
  const f=await fixture(t);await install(f)
  let second=(await f.service.createPack({name:'Linked pack',expectedRevision:null})).snapshot
  second=(await f.service.patchPack({packId:second.manifest.id,expectedRevision:second.revision,patch:{extensions:{linked:{packId:PACK_ID,figureId:FIGURE_ID}}}})).snapshot
  f.cards.get('source').raw.extensions.dsh_tavern.assetBindings.boundPackIds.push(second.manifest.id)
  const bytes=(await exported(f)).bytes
  for(const p of await f.service.listPacks())await f.service.patchPack({packId:p.manifest.id,expectedRevision:p.revision,patch:{name:p.manifest.name+' local'}})
  const preview=await inspect(f,bytes),decisions=Object.fromEntries(preview.packs.map(p=>[p.packId,'keep-both']))
  const plan=await f.service.previewCardBundleDecisions({inspectionId:preview.inspectionId,decisions})
  assert.equal(plan.mappings.length,2)
  await f.service.applyCardBundle({disableWidgets:false,inspectionId:preview.inspectionId,expectedRevision:preview.expectedRevision,decisions,acceptScriptRisk:true})
  const figureMap=plan.mappings.find(m=>m.from===PACK_ID),otherMap=plan.mappings.find(m=>m.from===second.manifest.id),other=await f.service.getPackSnapshot({packId:otherMap.packId})
  assert.deepEqual(other.manifest.extensions.linked,{packId:figureMap.packId,figureId:figureMap.figures[FIGURE_ID]})
  assert.deepEqual(f.cards.get('target').raw.extensions.dsh_tavern.assetBindings.boundPackIds,[figureMap.packId,otherMap.packId])
})
test('outer bundle rejects declared size mismatch and undeclared files before any publication',async t=>{
  const f=await fixture(t);await install(f);const out=await exported(f),file=path.join(f.root,'outer.zip');await writeFile(file,out.bytes)
  const archive=await openZip(file),entries=[];for(const entry of archive.entries)entries.push({path:entry.path,data:await archive.read(entry)})
  const root=entries.find(e=>e.path==='dsh-tavern-card-bundle.json'),manifest=JSON.parse(root.data);manifest.files[0].size++;root.data=jsonBytes(manifest)
  const bad=path.join(f.root,'bad-outer.zip');await writeZip(bad,entries)
  await assert.rejects(inspect(f,await readFile(bad)),{code:'FILE_CLOSURE_MISMATCH'})
  manifest.files[0].size--;root.data=jsonBytes(manifest);entries.push({path:'undeclared.txt',data:Buffer.from('extra')})
  const extra=path.join(f.root,'extra-outer.zip');await writeZip(extra,entries)
  await assert.rejects(inspect(f,await readFile(extra)),{code:'FILE_CLOSURE_MISMATCH'})
  assert.equal(f.cards.has('target'),false);assert.equal((await f.service.listPacks()).length,1)
})
// private fork: the outer list is a path/size closure; embedded packs are authenticated by their own manifest.
test('outer bundle declares path/size only and still imports bundles that carry the old per-file digest',async t=>{
  const f=await fixture(t);await install(f);const out=await exported(f),file=path.join(f.root,'outer.zip');await writeFile(file,out.bytes)
  const archive=await openZip(file),entries=[];for(const entry of archive.entries)entries.push({path:entry.path,data:await archive.read(entry)})
  const root=entries.find(e=>e.path==='dsh-tavern-card-bundle.json'),manifest=JSON.parse(root.data)
  assert.ok(manifest.files.every(item=>Object.keys(item).sort().join()==='path,size'))
  manifest.files=manifest.files.map(item=>({...item,sha256:'0'.repeat(64)}));root.data=jsonBytes(manifest)
  const old=path.join(f.root,'old-outer.zip');await writeZip(old,entries)
  const preview=await inspect(f,await readFile(old));assert.deepEqual(preview.packs.map(p=>p.packId),[PACK_ID])
  const pack=entries.find(e=>e.path.startsWith(`packs/${PACK_ID}/`)&&e.path!==`packs/${PACK_ID}/manifest.json`);pack.data=Buffer.concat([Buffer.from(pack.data),Buffer.from('x')])
  manifest.files.find(item=>item.path===pack.path).size=pack.data.length;root.data=jsonBytes(manifest)
  const tampered=path.join(f.root,'tampered-outer.zip');await writeZip(tampered,entries)
  await assert.rejects(inspect(f,await readFile(tampered)))
  assert.equal(f.cards.has('target'),false)
})
test('explicit copy keeps full snapshot and source identity; preview cancel is allowed after a local edit',async t=>{
  const f=await fixture(t),initial=await install(f),out=await f.service.exportPack({packId:PACK_ID,expectedRevision:initial.revision})
  const p=await f.service.inspectImport({bytes:out.bytes,copy:true});assert.deepEqual(p.choices,['keep-both','cancel'])
  const result=await f.service.applyImport({inspectionId:p.inspectionId,expectedRevision:p.expectedRevision,decision:'keep-both'})
  assert.equal(result.snapshot.manifest.assets.length,initial.manifest.assets.length);assert.notEqual(result.snapshot.manifest.id,PACK_ID)
  const cancel=await f.service.inspectImport({bytes:out.bytes})
  await f.service.patchPack({packId:PACK_ID,expectedRevision:initial.revision,patch:{name:'Changed'}})
  assert.equal((await f.service.applyImport({inspectionId:cancel.inspectionId,expectedRevision:initial.revision,decision:'cancel'})).status,'cancelled')
})


for(const format of ['chara_card_v2','chara_card_v3'])test('Card Preparation bundle preserves '+format+' working raw and unknown fields',async t=>{
  const f=await fixture(t);await install(f);const raw={spec:format,data:f.raw,opaque:{keep:['all',1]}}
  f.cards.set('source',f.prep.create({kind:'import',payload:raw}))
  const p=await inspect(f,(await exported(f)).bytes);await apply(f,p)
  assertImportedRaw(f.cards.get('target').raw,raw)
})
test('P2 optional consumer negotiates the actual P1 service without a compatibility wrapper',async t=>{
  const {createOptionalAssetPackConsumer}=await import('../tavern-plugin/lib/fork-card-asset-bindings.js')
  const f=await fixture(t);await install(f)
  let current=f.service
  const consumer=createOptionalAssetPackConsumer({get:key=>key==='assetLibrary'?current:undefined})
  const result=await consumer.inspect(f.raw.extensions.dsh_tavern)
  assert.equal(result.available,true);assert.deepEqual(result.figures,[{packId:PACK_ID,figureId:FIGURE_ID}])
  current=null;assert.equal((await consumer.inspect(f.raw.extensions.dsh_tavern)).available,false)
})


test('fresh adapter recovers a journal from a durably committed Card Preparation workspace on disk',async t=>{
  const {rename}=await import('node:fs/promises')
  const f=await fixture(t);await install(f);const bytes=(await exported(f)).bytes,file=path.join(f.root,'persisted-card.json')
  let unavailable=false
  function adapter(){return createCardBundleAdapter({cardPreparation:createCardPreparation(),authorizeTarget:async name=>{assert.equal(name,'persisted');return {cardId:'card-persisted'}},
    withCardLock:async(_id,task)=>task(),readWorkspace:async()=>{if(unavailable)throw new Error('unavailable');try{return JSON.parse(await readFile(file,'utf8'))}catch(e){if(e.code==='ENOENT')return undefined;throw e}},
    writeWorkspace:async(_name,workspace)=>{await writeFile(file+'.pending',JSON.stringify(workspace),{flag:'wx'});await rename(file+'.pending',file)}
  })}
  const service=createAssetPackService({assetRoot:f.assetRoot,cardTransactions:adapter(),fault:async point=>{if(point==='batch-card-committed'){unavailable=true;throw new Error('lost commit receipt')}}})
  const preview=await service.inspectCardBundle({path:'persisted',bytes})
  await assert.rejects(service.applyCardBundle({disableWidgets:false,inspectionId:preview.inspectionId,expectedRevision:null,decisions:{[PACK_ID]:'noop'}}),{code:'RECOVERY_REQUIRED'})
  unavailable=false
  const reopened=createAssetPackService({assetRoot:f.assetRoot,cardTransactions:adapter()})
  try {assert.equal((await reopened.listPacks()).length,1);assertImportedRaw(JSON.parse(await readFile(file,'utf8')).raw,f.raw);assert.deepEqual(await readdir(path.join(f.assetRoot,'staging')),[])}
  finally {await reopened.dispose();await service.dispose()}
})


test('identical raw and a fixed clock still have distinct before/after card commit proofs',async()=>{
  const {cardAssetWorkspaceRevision}=await import('../tavern-plugin/lib/fork-card-asset-bindings.js')
  const prep=createCardPreparation({id:()=> 'fixed-card',now:()=>1}),raw={name:'Fixed',extensions:{dsh_tavern:cardExtension()}}
  let current=prep.create({kind:'import',payload:raw})
  const adapter=createCardBundleAdapter({cardPreparation:prep,authorizeTarget:async()=>({cardId:'fixed-card'}),withCardLock:async(_id,task)=>task(),readWorkspace:async()=>clone(current),writeWorkspace:async(_path,value)=>{current=clone(value)}})
  await adapter.withPrepared({path:'fixed',expectedRevision:cardAssetWorkspaceRevision(current),raw},async card=>{
    assert.notEqual(card.record.beforeRevision,card.record.afterRevision);assert.equal(await card.status(),'before')
    await card.commit();assert.equal(await card.status(),'after')
  })
  assertImportedRaw(current.raw,raw)
})


const preset = {schemaVersion:1,id:'deepseek-whale/dafeiyu',label:'Dafeiyu',kind:'qwen',enabled:true,languages:['zh','en'],params:{voice:'Bella',model:'qwen3-tts-instruct-flash',moods:{joy:'cheerful',sad:null}}}
function presetService(t) {
  const tts = createTts();let settings = Settings({})
  const management = createServiceSettings({tts,get:() => settings,replace:async v => {settings=v},credentials:() => ({resolve:async () => ({value:'never-export-this-key'}),describe:async () => ({configured:true,writable:true})}),fetch:async () => {throw Error('no network')}})
  Object.assign(tts,{importVoicePresets:management.importVoicePresets});management.sync()
  t.after(async () => {management.dispose();await tts.dispose()})
  return {tts,management}
}
// private fork: portable presets are figure documents; imports never merge a global registry.
// private fork: global preset conflicts must not replace a pack-owned declaration.
const figureVoice = () => ({voice:'dafeiyu'})
const packVoice = () => ({name:'Dafeiyu',language:'zh',defaultSource:'qwen',sources:{qwen:{kind:'preset',provider:'qwen',voiceName:'Bella',model:'qwen3-tts-instruct-flash'}},variants:{joy:{tuning:{qwen:{moodInstruction:'cheerful'}}},sad:{tuning:{qwen:{moodInstruction:null}}}}})
async function presetBundle(t) {
  const f = await fixture(t), source = presetService(t), pack=await syntheticPack()
  pack.manifest.voiceLibrary.voices.dafeiyu=packVoice()
  pack.figures[FIGURE_ID].voice=figureVoice()
  for(const row of pack.figures[FIGURE_ID].emotions)delete row.voiceEmotion // private fork: replacing the voice clears its old pointers.
  pack.files.set('figures/'+FIGURE_ID+'.json',jsonBytes(pack.figures[FIGURE_ID]));await sealPack(pack.manifest,pack.files)
  await install(f,pack)
  f.setTts(source.tts)
  await source.management.save({id:'qwen-main',kind:'qwen',config:{region:'cn'}})
  await source.management.saveVoicePreset({preset:{...preset,providerId:'qwen-main'}})
  const bytes = (await exported(f)).bytes
  return {f,bytes,source}
}
test('P5 bundle carries figure presets and reference audio in pack closure, never service credentials or global registry',async t => {
  const {f,bytes,source} = await presetBundle(t)
  await source.management.saveVoicePreset({preset:{...preset,id:'other/unreferenced'}})
  const file = path.join(f.root,'presets.zip');await writeFile(file,bytes)
  const zip = await openZip(file)
  assert.equal(zip.entries.some(e=>e.path==='card/voice-presets.json'),false)
  const entry=zip.entries.find(e=>e.path==='packs/'+PACK_ID+'/figures/'+FIGURE_ID+'.json')
  assert.deepEqual(JSON.parse(await zip.read(entry)).voice,figureVoice())
  for (const entry of zip.entries) assert.equal((await zip.read(entry)).includes(Buffer.from('never-export-this-key')),false)
  const fresh = presetService(t);f.setTts(fresh.tts)
  const preview = await inspect(f,bytes),result = await apply(f,preview)
  assert.equal(result.status,'committed');assert.equal('voicePresets' in result,false)
  assert.deepEqual(preview.packs[0].incoming.figures[FIGURE_ID].voice,figureVoice())
  assert.deepEqual(await fresh.tts.exportVoicePresets([preset.id]),[])
  assertImportedRaw(f.cards.get('target').raw,f.cards.get('source').raw)
  assert.equal((await apply(f,await inspect(f,bytes,'target2'))).status,'committed')
})
test('P5 global preset ID conflicts do not replace or suppress the figure-owned preset',async t => {
  const {f,bytes} = await presetBundle(t), local = presetService(t);f.setTts(local.tts)
  await local.management.saveVoicePreset({preset:{...preset,label:'My global version'}})
  const result = await apply(f,await inspect(f,bytes))
  assert.equal(result.status,'committed');assert.equal('voicePresets' in result,false)
  assert.equal((await local.tts.exportVoicePresets([preset.id]))[0].label,'My global version')
  assert.deepEqual((await f.service.getPackSnapshot({packId:PACK_ID})).figures[FIGURE_ID].voice,figureVoice())
  assert.ok(f.cards.has('target'))
})
test('P5 preset closure imports without TTS or global preset persistence',async t => {
  const {f,bytes} = await presetBundle(t);f.setTts(null)
  const result = await apply(f,await inspect(f,bytes))
  assert.equal(result.status,'committed');assert.equal('voicePresets' in result,false)
  let writes=0;f.setTts({importVoicePresets:async () => {writes++;throw Error('must not write global presets')}})
  const second = await apply(f,await inspect(f,bytes,'target2'))
  assert.equal(second.status,'committed');assert.equal(writes,0)
})
test('figure preset import rejects credentials and bad params before publication; cancel is inert',async t => {
  const {f,bytes} = await presetBundle(t), fresh = presetService(t);f.setTts(fresh.tts)
  for (const change of [v=>{v.providerId='machine'},v=>{v.credentials={key:'secret'}},v=>{v.params={voice:'Bella',key:'secret'}}]) {
    const voice=structuredClone(figureVoice());change(voice);assert.throws(()=>validateVoice(voice))
    const before=await f.service.getPackSnapshot({packId:PACK_ID})
    await assert.rejects(f.service.patchFigure({packId:PACK_ID,figureId:FIGURE_ID,expectedRevision:before.revision,patch:{voice}}))
    assert.equal((await f.service.getPackSnapshot({packId:PACK_ID})).revision,before.revision)
  }
  const preview = await inspect(f,bytes)
  await f.service.applyCardBundle({disableWidgets:false,inspectionId:preview.inspectionId,cancel:true})
  assert.equal(f.cards.has('target'),false)
  assert.deepEqual(await fresh.tts.exportVoicePresets([preset.id]),[])
})

// private fork: refusal changes the imported card toggle, never the shared widget items.
test('card import warning is mandatory for embedded/reused widgets; refusal persists and exports the same card toggle',async t=>{
 const f=await fixture(t);await install(f)
 f.cards.get('source').raw.extensions.dsh_tavern.stage={widgets:true,defaultSkin:'magical'}
 const archive=await exported(f),p=await inspect(f,archive.bytes),decisions=Object.fromEntries(p.packs.map(pack=>[pack.packId,'noop']))
 const plan=await f.service.previewCardBundleDecisions({inspectionId:p.inspectionId,decisions})
 assert.equal(plan.cardWidgetRisks.length,1)
 await assert.rejects(()=>f.service.applyCardBundle({inspectionId:p.inspectionId,expectedRevision:p.expectedRevision,decisions,acceptScriptRisk:true}),{code:'WIDGET_CONFIRMATION_REQUIRED'})
 const before=await f.service.getPackSnapshot({packId:PACK_ID})
 await f.service.applyCardBundle({inspectionId:p.inspectionId,expectedRevision:p.expectedRevision,decisions,acceptScriptRisk:true,disableWidgets:true})
 assert.deepEqual(f.cards.get('target').raw.extensions.dsh_tavern.stage,{widgets:false,defaultSkin:'magical'})
 assert.deepEqual(await f.service.getPackSnapshot({packId:PACK_ID}),before)
 const target=await f.adapter.snapshot({path:'target'})
 const reexported=await f.service.exportCardBundle({path:'target',expectedRevision:target.revision,packIds:[]})
 const again=await inspect(f,reexported.bytes,'target2');await apply(f,again)
 assert.deepEqual(f.cards.get('target2').raw.extensions.dsh_tavern.stage,{widgets:false,defaultSkin:'magical'})
})

// Covers are optional v1 content and are validated only when inspecting incoming data.
test('bundle cover round trips and legacy v1 remains coverless', async t => {
  const f = await fixture(t)
  await install(f)
  const png = await readFile(new URL('../public/overlay/examples/dafeiyu/cover.png', import.meta.url))
  f.covers.set('source', png)
  await apply(f, await inspect(f, (await exported(f)).bytes))
  assert.deepEqual(f.covers.get('target'), png)
  f.covers.delete('source')
  await apply(f, await inspect(f, (await exported(f)).bytes, 'target2'))
  assert.equal(f.covers.has('target2'), false)
})
test('invalid and oversized bundle covers are rejected before card writes', async t => {
  const f = await fixture(t)
  await install(f)
  for (const [bytes, message] of [[Buffer.from('not an image'), /Cover must be a PNG/], [Buffer.alloc(20 * 1024 ** 2 + 1), /20 MiB/], [Buffer.from([137,80,78,71,13,10,26,10]), /Invalid bundle cover/]]) {
    f.covers.set('source', bytes)
    await assert.rejects(inspect(f, (await exported(f)).bytes), message)
    assert.equal(f.cards.has('target'), false)
  }
})
