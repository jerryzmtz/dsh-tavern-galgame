import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {createModLibrary} from '../tavern-plugin/lib/fork-mod-library.js'
import {createModArchives} from '../tavern-plugin/lib/fork-mod-archives.js'
import {writeZip,openZip} from '../tavern-plugin/packages/dsh-asset-library/src/zip.js'
import {checkedPath} from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/storage.js'
import {createModSettingsOwner,createModCardOwner} from '../tavern-plugin/lib/fork-mod-owners.js'
import {createCardPreparation} from '../tavern-plugin/lib/domain/card-preparation.js'
import {createCardStorage} from '../tavern-plugin/lib/fork-card-storage.js'
import {createModRegistry} from '../tavern-plugin/lib/domain/mods/registry.js'
import {createBuiltinModRegistry,createModRuntime} from '../tavern-plugin/lib/domain/mods/runtime.js'
import {compileModPrompts,assembleModPrompt,replaceModPromptSections} from '../tavern-plugin/lib/domain/mods/prompts.js'
import {validateModCommand} from '../tavern-plugin/lib/domain/mods/commands.js'
import * as demo from './fixtures/mods/demo/runtime.js'
const manifest=JSON.parse(await fs.readFile(new URL('./fixtures/mods/demo/manifest.json',import.meta.url)))
const pack=JSON.parse(await fs.readFile(new URL('./fixtures/mods/demo-pack.json',import.meta.url)))
const files=new Map(await Promise.all(manifest.files.map(async file=>[file.path,await fs.readFile(new URL('./fixtures/mods/demo/'+file.path,import.meta.url))])))
const options={capabilities:['stage.place'],coreCommands:[{op:'item.play',dsl:{verb:'item'}}]}
const revision=registry=>registry.snapshot().revision
async function install(registry,value=manifest) {await registry.install({manifest:value,expectedRevision:revision(registry)});await registry.authorize({modId:value.id,allowed:true,expectedRevision:revision(registry)})}
const scope=(registry,value,modId=manifest.id)=>registry.setModScope({modId,scope:value,expectedRevision:revision(registry)})

test('mod registry uses global switches and settings, keeps card pack scopes and atomic CAS publication',async()=>{
  const registry=createModRegistry(options)
  const empty=registry.snapshot()
  assert.deepEqual(registry.listMods(),{revision:'0',mods:[]})
  assert.equal(registry.snapshot(),empty)
  await registry.install({manifest,expectedRevision:revision(registry)})
  assert.equal(registry.listMods().mods[0].scope,'off')
  await assert.rejects(scope(registry,'global'),{code:'MOD_PERMISSION_DENIED'})
  await registry.authorize({modId:manifest.id,allowed:true,expectedRevision:revision(registry)})
  const changed=await scope(registry,'global')
  assert.equal(changed.affected,'all-cards')
  assert.equal(registry.active('card-a').length,1);assert.equal(registry.active('future-card').length,1)
  assert.equal(registry.listMods({cardId:'card-a'}).mods[0].scope,'global')
  await assert.rejects(scope(registry,'card'),{code:'MOD_API_UNSUPPORTED'})
  assert.throws(()=>registry.setModScope({modId:manifest.id,scope:'global',cardId:'card-a',expectedRevision:revision(registry)}),{code:'UNKNOWN_FIELD'})
  await registry.saveModSettings({modId:manifest.id,values:{caption:'Shared',visible:false},expectedRevision:revision(registry)})
  const a=registry.getMod({modId:manifest.id,cardId:'card-a'}).settings.values
  assert.equal(a.caption,'Shared');assert.equal(a.visible,false)
  assert.deepEqual(registry.getMod({modId:manifest.id,cardId:'card-b'}).settings.values,a)
  assert.throws(()=>registry.saveModSettings({modId:manifest.id,cardId:'card-a',values:{},expectedRevision:revision(registry)}),{code:'UNKNOWN_FIELD'})
  const image={modId:manifest.id,packId:pack.id,kind:'icon',entryId:pack.entries[0].id}
  await registry.saveModSettings({modId:manifest.id,values:{image},expectedRevision:revision(registry)})
  assert.deepEqual(registry.getMod({modId:manifest.id,cardId:'card-a'}).settings.values.image,image)
  await registry.saveModSettings({modId:manifest.id,values:{image:null},expectedRevision:revision(registry)})
  assert.equal(registry.getMod({modId:manifest.id,cardId:'card-b'}).settings.values.image,null)
  await registry.saveModPack({modId:manifest.id,pack,expectedRevision:revision(registry)})
  await registry.setModPackScope({modId:manifest.id,packId:pack.id,cardId:'card-a',scope:'card',expectedRevision:revision(registry)})
  assert.equal(registry.listModPacks({modId:manifest.id,cardId:'card-a'}).packs[0].scope,'card')
  assert.equal(registry.listModPacks({modId:manifest.id,cardId:'card-b'}).packs[0].scope,'off')
  const expectedRevision=revision(registry)
  const results=await Promise.allSettled([registry.saveModSettings({modId:manifest.id,values:{caption:'One'},expectedRevision}),registry.saveModSettings({modId:manifest.id,values:{caption:'Two'},expectedRevision})])
  assert.deepEqual(results.map(result=>result.status),['fulfilled','rejected'])
  assert.equal(results[1].reason.code,'MOD_REVISION_CONFLICT')
  const failing=createModRegistry({...options,publish:async()=>{throw Error('Disk offline')}})
  await assert.rejects(failing.install({manifest,expectedRevision:'0'}),/Disk offline/)
  assert.equal(failing.snapshot().revision,'0')
  await registry.install({manifest,replace:true,expectedRevision:revision(registry)})
  assert.equal(registry.active('card-a').length,0)
  assert.equal(registry.listMods({cardId:'card-a'}).mods[0].reason,'MOD_PERMISSION_DENIED')
})

test('mod enable checks dependency cycles and command collisions across existing and future cards',async()=>{
  const registry=createModRegistry(options)
  await install(registry);await scope(registry,'global')
  const other=structuredClone(manifest);other.id='dsh.other'
  const before=registry.snapshot()
  await assert.rejects(install(registry,other),{code:'MOD_COMMAND_CONFLICT'})
  assert.equal(registry.snapshot(),before)
  const core=structuredClone(manifest);core.id='dsh.core';core.commands[0].op='item.play';core.commands[0].dsl.verb='item'
  await assert.rejects(install(registry,core),/core \/ dsh.core/)
  const cycle=createModRegistry(options),first=structuredClone(manifest),second=structuredClone(other)
  second.commands[0].op='mod.dsh.other.mark';second.commands[0].dsl.verb='other'
  first.dependencies.mods=[{id:second.id,range:'>=1.0.0 <2.0.0'}]
  second.dependencies.mods=[{id:first.id,range:'>=1.0.0 <2.0.0'}]
  await install(cycle,first);await install(cycle,second)
  await assert.rejects(scope(cycle,'global'),{code:'MOD_DEPENDENCY_MISSING'})
  await registry.deleteMod({modId:manifest.id,confirmed:true,expectedRevision:revision(registry)})
  assert.equal(registry.snapshot().global.enabledModIds.includes(manifest.id),false)
})

test('first-party boundary rejects spoofed releases and revokes timed-out or stale async capabilities',async()=>{
  const builtins=createBuiltinModRegistry([{manifest,files,module:demo}])
  assert.equal(builtins.inspect(manifest,files).id,manifest.id)
  const altered=new Map(files);altered.set('runtime.js',Buffer.from('throw Error("uploaded code")'))
  assert.throws(()=>builtins.inspect(manifest,altered),{code:'MOD_API_UNSUPPORTED'})
  assert.throws(()=>builtins.inspect({...manifest,id:'dsh.spoof'},files),{code:'MOD_API_UNSUPPORTED'})
  let live=true,release,hostCalls=0,late
  const delayed={...demo,prepare:async(_,host)=>{await new Promise(resolve=>{release=resolve});late=host.judge({});await late;return {ok:true}}}
  const delayedBuiltins=createBuiltinModRegistry([{manifest,files,module:delayed}])
  const runtime=createModRuntime({builtins:delayedBuiltins,current:()=>live,createHost:()=>({judge:async()=>{hostCalls++;return null}}),timeoutMs:10})
  const context={modId:manifest.id,cardId:'card-a',gameId:'game-a'}
  assert.equal((await runtime.invoke(context,'prepare',{})).error.code,'MOD_RUNTIME_FAILED')
  release();await new Promise(resolve=>setTimeout(resolve,0))
  await assert.rejects(late,{code:'MOD_SOURCE_STALE'});assert.equal(hostCalls,0)
  live=false
  assert.equal((await runtime.invoke(context,'command',{})).error.code,'MOD_SOURCE_STALE')
  runtime.dispose()
})

test('mod prompt placement keeps core bytes, per-entry ordering and exact UTF-8 offsets',()=>{
  const segments=[{section:'director.rules.presentation',text:'Core rules.'},{section:'director.commands.presentation',text:'\nCore commands.'},{section:'director.catalogue',text:'\nCatalogue.'}]
  assert.equal(assembleModPrompt({segments}).text,segments.map(row=>row.text).join(''))
  const fragments=compileModPrompts([manifest],(id,path)=>files.get(path).toString())
  const assembly=assembleModPrompt({segments,fragments})
  const command=assembly.sections.find(row=>row.type==='command')
  assert.ok(command.offset>Buffer.byteLength(assembly.text.slice(0,assembly.text.indexOf('Core commands.'))))
  assert.ok(command.offset<Buffer.byteLength(assembly.text.slice(0,assembly.text.indexOf('Catalogue.'))))
  for(const row of assembly.sections)assert.equal(Buffer.from(assembly.text).subarray(row.offset,row.offset+row.bytes).toString(),row.text)
  assert.throws(()=>assembleModPrompt({segments,fragments:[{...fragments[0],placement:{section:'unknown',order:0}}]}),/Unknown prompt section/)
  assert.throws(()=>replaceModPromptSections({manifest,fragments,target:'director',sections:[{id:'unknown',text:'x'}]}),/Undeclared/)
  assert.equal(validateModCommand(manifest.commands[0],{label:'Demo'}).label,'Demo')
  assert.throws(()=>validateModCommand(manifest.commands[0],{label:'Demo',cardId:'other'}),/parameters/)
})


async function persistentFixture(t) {
  const parent=fileURLToPath(new URL('../.tmp/mod-tests/',import.meta.url))
  await fs.mkdir(parent,{recursive:true})
  const root=await fs.mkdtemp(path.join(parent,'owners-'))
  t.after(()=>fs.rm(root,{recursive:true,force:true}))
  let native, installed, nativeRevision=0, failCard=false, cardWrites=0
  const provider={writable:true,describe:()=>[{ns:'tavern-mods',revision:String(nativeRevision)}],
    installSection(ctx,ns,schema,defaults,handlers) {native=structuredClone(defaults);installed=handlers;handlers.setSource(()=>native)},
    async replace(ns,value,expected) {assert.equal(expected,String(nativeRevision));native=structuredClone(installed.validate(value));nativeRevision++;installed.onChange()}}
  const ctx={get:()=>provider,inject(deps,fn){fn(ctx)},effect(){}}
  const settings=createModSettingsOwner(ctx), preparation=createCardPreparation({id:()=> 'card-a',now:()=>1})
  const workspacePath=path.join(root,'card.json')
  await fs.writeFile(workspacePath,JSON.stringify(preparation.create({kind:'import',payload:{name:'Different display name',extensions:{other:{retained:true}}}})))
  const cardOptions={cardPreparation:preparation,listPaths:async()=>[workspacePath],readWorkspace:async filename=>JSON.parse(await fs.readFile(filename,'utf8')),
    writeWorkspace:async(filename,value)=>{cardWrites++;await fs.writeFile(filename,JSON.stringify(value));if(failCard)throw Error('Interrupted after card commit')},
    withCardLock:createCardStorage({dataRoot:root}).withCardLock}
  const open=()=>createModLibrary({...options,root:path.join(root,'library'),settings,cards:createModCardOwner(cardOptions)})
  return {root,open,settings,cardOptions,workspacePath,interrupt(){failCard=true},resume(){failCard=false},writes:()=>cardWrites}
}

test('mod library persists each owner separately through native CAS and Card Preparation, without read writes',async t=>{
  const f=await persistentFixture(t), registry=await f.open()
  assert.deepEqual(await fs.readdir(f.root),['card.json'])
  await install(registry)
  await scope(registry,'global')
  await registry.saveModSettings({modId:manifest.id,values:{visible:false},expectedRevision:revision(registry)})
  await registry.saveModPack({modId:manifest.id,pack,expectedRevision:revision(registry)})
  await registry.setModPackScope({modId:manifest.id,packId:pack.id,cardId:'card-a',scope:'card',expectedRevision:revision(registry)})
  const disk=JSON.parse(await fs.readFile(path.join(f.root,'library/state.json'),'utf8'))
  assert.deepEqual(Object.keys(disk).sort(),['mods','revision','schemaVersion'])
  assert.equal(f.settings.read().value.global.enabledModIds[0],manifest.id)
  const card=JSON.parse(await fs.readFile(f.workspacePath,'utf8')), raw=card.raw.data || card.raw
  assert.equal(raw.extensions.other.retained,true)
  assert.deepEqual(raw.extensions.dsh_tavern.modBindings.mods[manifest.id],{boundPackIds:[pack.id]})
  const reopened=await f.open()
  assert.equal(reopened.getMod({modId:manifest.id,cardId:'card-a'}).settings.values.visible,false)
  assert.equal(reopened.active('future-card').length,1)
  const count=f.writes();reopened.listMods();reopened.getMod({modId:manifest.id});assert.equal(f.writes(),count)
  const stale=await f.open()
  await reopened.saveModSettings({modId:manifest.id,values:{caption:'Changed'},expectedRevision:revision(reopened)})
  await assert.rejects(stale.saveModSettings({modId:manifest.id,values:{caption:'Stale'},expectedRevision:revision(stale)}),{code:'MOD_REVISION_CONFLICT'})
  const fresh=await f.open(), owner=createModCardOwner(f.cardOptions);await owner.list()
  const before=await owner.read({cardId:'card-a'})
  const next=structuredClone(before.value);next.mods[manifest.id].boundPackIds=[]
  await owner.compareAndSwap({cardId:'card-a',expectedRevision:before.revision,expectedValue:before.value,value:next})
  await assert.rejects(fresh.saveModSettings({modId:manifest.id,values:{visible:false},expectedRevision:revision(fresh)}),{code:'MOD_REVISION_CONFLICT'})
  assert.equal(JSON.parse(await fs.readFile(f.workspacePath,'utf8')).raw.extensions.other.retained,true)
})

test('mod journal recovers interrupted cross-owner publication, but never overwrites a foreign edit',async t=>{
  const f=await persistentFixture(t), registry=await f.open()
  await install(registry);await scope(registry,'global')
  await registry.saveModPack({modId:manifest.id,pack,expectedRevision:revision(registry)})
  const packScope=(owner,value)=>owner.setModPackScope({modId:manifest.id,packId:pack.id,cardId:'card-a',scope:value,expectedRevision:revision(owner)})
  await packScope(registry,'global')
  f.interrupt()
  await assert.rejects(packScope(registry,'card'),/Interrupted after card commit/)
  assert.throws(()=>registry.listMods(),{code:'MOD_RESOURCE_UNAVAILABLE'})
  const journal=JSON.parse(await fs.readFile(path.join(f.root,'library/journal.json'),'utf8'))
  assert.deepEqual(journal.changes.map(row=>row.owner),['settings','card'])
  f.resume()
  const recovered=await f.open()
  assert.equal(recovered.listModPacks({modId:manifest.id,cardId:'card-a'}).packs[0].scope,'card')
  assert.equal(recovered.active('future-card').length,1)
  await assert.rejects(fs.access(path.join(f.root,'library/journal.json')),{code:'ENOENT'})
  await packScope(recovered,'global')
  f.interrupt()
  await assert.rejects(packScope(recovered,'card'),/Interrupted after card commit/)
  const workspace=JSON.parse(await fs.readFile(f.workspacePath,'utf8'))
  workspace.raw.extensions.dsh_tavern.modBindings.mods[manifest.id].boundPackIds=[]
  workspace.meta.updatedAt++
  await fs.writeFile(f.workspacePath,JSON.stringify(workspace))
  f.resume()
  const unchanged=await fs.readFile(f.workspacePath,'utf8')
  await assert.rejects(f.open(),{code:'MOD_REVISION_CONFLICT'})
  assert.equal(await fs.readFile(f.workspacePath,'utf8'),unchanged)
  await fs.access(path.join(f.root,'library/journal.json'))
})


function archiveFixture(library,root,release=manifest) {
  return createModArchives({root:path.join(root,'library'),library,archiveIO:{openZip,writeZip,checkedPath},builtins:createBuiltinModRegistry([{manifest:release,files,module:demo}])})
}
const demoDirectory=fileURLToPath(new URL('./fixtures/mods/demo/',import.meta.url))
const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aYZkAAAAASUVORK5CYII=','base64')
function packFiles() {
  const value=structuredClone(pack);value.files=[{path:'image.png',size:image.length}];value.entries[0].media.image='image.png'
  return new Map([['manifest.json',Buffer.from(JSON.stringify(value))],['image.png',Buffer.from(image)]])
}

test('mod archives roundtrip complete owned media, freeze inspections, and keep both identities off',async t=>{
  const release=structuredClone(manifest)
  release.assetKinds[0].fields.fields.push({key:'image',type:'reference',label:'Related icon',default:null,target:{library:'mod',modId:manifest.id,kinds:['icon']}})
  const f=await persistentFixture(t),library=await f.open(),archives=archiveFixture(library,f.root,release)
  let inspected=await archives.inspectSource({kind:'files',files:new Map([...files,['manifest.json',Buffer.from(JSON.stringify(release))]])})
  assert.equal(inspected.builtinRuntimeCompatible,true)
  await archives.applyModImport({inspectionId:inspected.inspectionId,decision:'install',expectedRevision:inspected.revision})
  const incoming=packFiles()
  inspected=await archives.inspectSource({kind:'files',files:incoming,archiveDigest:'outer-card-archive'})
  incoming.get('image.png').fill(0)
  await archives.applyModImport({inspectionId:inspected.inspectionId,decision:'install',expectedRevision:inspected.revision})
  await library.saveModSettings({modId:manifest.id,values:{image:{modId:manifest.id,packId:pack.id,kind:'icon',entryId:'first'}},expectedRevision:revision(library)})
  const exported=await archives.exportMod({modId:manifest.id,packIds:[],expectedRevision:revision(library)})
  const archive=await openZip(archives.download(exported.downloadId))
  assert.deepEqual(await archive.read(archive.entries.find(entry=>entry.path.endsWith('/image.png'))),image)
  assert.equal(archive.entries.some(entry=>/grant|credential|chat/i.test(entry.path)),false)
  inspected=await archives.inspectSource({kind:'zip',path:archives.download(exported.downloadId)})
  assert.equal(typeof inspected.archiveDigest,'string')
  const copied=await archives.applyModImport({inspectionId:inspected.inspectionId,decision:'keep-both',expectedRevision:inspected.revision})
  assert.notEqual(copied.modId,manifest.id);assert.notEqual(copied.packIds[0],pack.id)
  assert.equal(library.listMods().mods.find(row=>row.id===copied.modId).scope,'off')
  assert.equal(library.listModPacks({modId:copied.modId}).packs[0].scope,'off')
  assert.equal(library.getMod({modId:copied.modId}).settings.values.image.packId,copied.packIds[0])
  assert.equal(library.snapshot().mods[copied.modId].origin.builtinId,manifest.id)
  const copyZip=await archives.exportMod({modId:copied.modId,packIds:[],expectedRevision:revision(library)})
  inspected=await archives.inspectSource({kind:'zip',path:archives.download(copyZip.downloadId)})
  await archives.applyModImport({inspectionId:inspected.inspectionId,decision:'replace',expectedRevision:inspected.revision})
  const single=await archives.exportModPack({modId:manifest.id,packId:pack.id,expectedRevision:revision(library)})
  inspected=await archives.inspectSource({kind:'zip',path:archives.download(single.downloadId)})
  const copyPack=await archives.applyModImport({inspectionId:inspected.inspectionId,decision:'keep-both',expectedRevision:inspected.revision})
  assert.notEqual(copyPack.packIds[0],pack.id)
  const entry=structuredClone(library.snapshot().mods[manifest.id].packs[pack.id].entries[0])
  entry.fields.image={modId:manifest.id,packId:copyPack.packIds[0],kind:'icon',entryId:'first'}
  await library.saveModEntry({ref:{modId:manifest.id,packId:pack.id,kind:'icon',entryId:'first'},entry,expectedRevision:revision(library)})
  const closed=await archives.exportModPack({modId:manifest.id,packId:pack.id,expectedRevision:revision(library)})
  inspected=await archives.inspectSource({kind:'zip',path:archives.download(closed.downloadId)})
  const closure=await archives.applyModImport({inspectionId:inspected.inspectionId,decision:'keep-both',expectedRevision:inspected.revision})
  assert.equal(closure.packIds.length,2)
  assert.equal(library.snapshot().mods[manifest.id].packs[closure.packIds[0]].entries[0].fields.image.packId,closure.packIds[1])
  assert.equal(await archives.readReleaseText(manifest.id,'prompts/demo.txt'),files.get('prompts/demo.txt').toString('utf8'))
  await library.deleteMod({modId:copied.modId,expectedRevision:revision(library),confirmed:true})
  assert.equal(library.snapshot().mods[copied.modId],undefined)
})

test('mod import rejects tampered code, traversal and stale inspections, recovers only after all media is durable',async t=>{
  const f=await persistentFixture(t),library=await f.open(),archives=archiveFixture(library,f.root)
  const imported=new Map([...files].map(([name,bytes])=>[name,Buffer.from(bytes)]));imported.set('manifest.json',Buffer.from(JSON.stringify(manifest)))
  imported.get('runtime.js')[0]^=1
  await assert.rejects(archives.inspectSource({kind:'files',files:imported}),{code:'MOD_API_UNSUPPORTED'})
  const malicious=path.join(f.root,'unsafe.zip')
  await writeZip(malicious,[{path:'bad/x',data:Buffer.from('x')}])
  const bytes=await fs.readFile(malicious);let cursor=0
  while((cursor=bytes.indexOf(Buffer.from('bad/x'),cursor))!==-1){bytes.write('../xx',cursor);cursor+=5}
  await fs.writeFile(malicious,bytes)
  await assert.rejects(archives.inspectSource({kind:'zip',path:malicious}),/ZIP path/)
  const inspected=await archives.inspectSource({kind:'directory',path:demoDirectory})
  await library.install({manifest,expectedRevision:revision(library)})
  await assert.rejects(archives.applyModImport({inspectionId:inspected.inspectionId,decision:'install',expectedRevision:inspected.revision}),{code:'MOD_REVISION_CONFLICT'})
  const g=await persistentFixture(t)
  const failSettings={...g.settings,async compareAndSwap(args){await g.settings.compareAndSwap(args);throw Error('Interrupted after native commit')}}
  const failing=await createModLibrary({...options,root:path.join(g.root,'library'),settings:failSettings,cards:createModCardOwner(g.cardOptions)})
  const pending=archiveFixture(failing,g.root), preview=await pending.inspectSource({kind:'directory',path:demoDirectory})
  await assert.rejects(pending.applyModImport({inspectionId:preview.inspectionId,decision:'install',expectedRevision:preview.revision}),/Interrupted after native commit/)
  const recovered=await g.open(), recoveredArchive=archiveFixture(recovered,g.root)
  const output=await recoveredArchive.exportMod({modId:manifest.id,packIds:[],expectedRevision:revision(recovered)})
  const opened=await openZip(recoveredArchive.download(output.downloadId))
  assert.deepEqual(await opened.read(opened.entries.find(entry=>entry.path==='runtime.js')),files.get('runtime.js'))
  assert.equal(recovered.active('card-a').length,0)
})

function replacement(id,compatible=[]) {
  const value=structuredClone(manifest)
  value.id='fixture.'+id;value.name='Display '+id
  Object.assign(value.commands[0],{op:'mod.'+value.id+'.mark',mode:'replaces',replaces:'title.play',dsl:{verb:id,syntax:id+' mark label=TEXT'}})
  value.compatibility.compatible=compatible.map(id=>({id:'fixture.'+id,range:'>=1.0.0 <2.0.0'}))
  return value
}
const batch=(registry,changes,expectedRevision=revision(registry))=>registry.setModScopes({changes:changes.map(([modId,scope])=>({modId,scope})),expectedRevision})

test('P1 batches reject conflicts without publication; one-sided compatibility, deny priority and all pairs are checked',async()=>{
  let writes=0
  const registry=createModRegistry({...options,publish:async()=>{writes++;return true}})
  const a=replacement('alpha'),b=replacement('beta'),c=replacement('gamma',['alpha','beta'])
  for(const value of [a,b,c])await install(registry,value)
  await scope(registry,'global',a.id)
  let before=registry.snapshot(),count=writes
  await assert.rejects(scope(registry,'global',b.id),error=>error.code==='MOD_COMMAND_CONFLICT' && error.message.includes(a.name) && error.message.includes(b.name) && error.message.includes('title.play') && error.message.includes('只能开一个'))
  assert.equal(registry.snapshot(),before);assert.equal(writes,count)
  await assert.rejects(batch(registry,[[b.id,'global'],[c.id,'global']]),{code:'MOD_COMMAND_CONFLICT'})
  assert.equal(registry.snapshot(),before);assert.equal(writes,count)
  await batch(registry,[[a.id,'off'],[b.id,'global']])
  assert.deepEqual(registry.snapshot().global.enabledModIds,[b.id]);assert.equal(writes,count+1)
  a.compatibility.compatible=[{id:b.id,range:'>=1.0.0 <2.0.0'}]
  await registry.install({manifest:a,replace:true,expectedRevision:revision(registry)})
  await registry.authorize({modId:a.id,allowed:true,expectedRevision:revision(registry)})
  await batch(registry,[[a.id,'global'],[c.id,'global']])
  assert.equal(registry.active('future-card').length,3)
  await scope(registry,'off',b.id)
  b.compatibility.incompatible=[{id:a.id,range:'>=1.0.0 <2.0.0',reason:'Channel is exclusive'}]
  await registry.install({manifest:b,replace:true,expectedRevision:revision(registry)})
  await registry.authorize({modId:b.id,allowed:true,expectedRevision:revision(registry)})
  before=registry.snapshot();count=writes
  await assert.rejects(scope(registry,'global',b.id),{code:'MOD_COMMAND_CONFLICT'})
  assert.equal(registry.snapshot(),before);assert.equal(writes,count)
})

test('P1 dependency disable and stale CAS fail atomically; dependency and dependent can be switched together',async()=>{
  const registry=createModRegistry(options),a=replacement('parent'),b=replacement('child',['parent'])
  b.dependencies.mods=[{id:a.id,range:'>=1.0.0 <2.0.0'}]
  for(const value of [a,b])await install(registry,value)
  await assert.rejects(scope(registry,'global',b.id),{code:'MOD_DEPENDENCY_MISSING'})
  await batch(registry,[[a.id,'global'],[b.id,'global']])
  const before=registry.snapshot()
  await assert.rejects(scope(registry,'off',a.id),{code:'MOD_DEPENDENCY_MISSING'})
  assert.equal(registry.snapshot(),before)
  const outcomes=await Promise.allSettled([batch(registry,[[a.id,'off'],[b.id,'off']],before.revision),batch(registry,[[a.id,'off'],[b.id,'off']],before.revision)])
  assert.deepEqual(outcomes.map(row=>row.status),['fulfilled','rejected'])
  assert.equal(outcomes[1].reason.code,'MOD_REVISION_CONFLICT')
  assert.deepEqual(registry.snapshot().global.enabledModIds,[])
  assert.equal(registry.active('future-card').length,0)
})
