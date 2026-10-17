import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,readFile,readdir,stat,rm,symlink} from 'node:fs/promises'
import fs from 'node:fs/promises'
import {syncBuiltinESMExports} from 'node:module'
import os from 'node:os'
import path from 'node:path'
import {runCli} from '../bin/dsh-assets.mjs'
import {readNativeSnapshot} from '../tools/dsh-assets/baseline.mjs'
import {planModsP5} from '../tools/dsh-assets/p5-plan.mjs'
import {syntheticImage} from '../tools/dsh-assets/dry-run.mjs'
import {hash} from '../tavern-plugin/lib/domain/asset-production-project.js'

async function legacyMirror(t) {
  const temp=await mkdtemp(path.join(os.tmpdir(),'cli-p5-boundary-'));t.after(()=>rm(temp,{recursive:true,force:true}))
  const library=path.join(temp,'old'),out=path.join(temp,'new'),pack='11111111-1111-4111-8111-111111111111',revision='22222222-2222-4222-8222-222222222222'
  const bytes=syntheticImage(16,16,{opaque:true}),media=hash(bytes),file='media/'+media+'.png',prefix=path.join(library,'packs',pack)
  const manifest={format:'dsh-asset-pack',schemaVersion:1,id:pack,name:'Legacy mirror',contentHash:'0'.repeat(64),assets:[
    {enabled:true,recall:{mode:'constant',keywords:[]},directorNote:'',kind:'cg',id:'scene',name:'Scene',defaultVariant:'base',variants:[{key:'base',label:'Base',media,description:'Original art'}]}
  ],figures:[],sprites:{},bundles:{},blobs:{[media]:{ext:'png',mime:'image/png',size:bytes.length}},files:[{path:file,size:bytes.length,sha256:media}]}
  await mkdir(path.join(prefix,'media'),{recursive:true});await mkdir(path.join(library,'local'))
  await writeFile(path.join(prefix,'manifest.json'),JSON.stringify(manifest));await writeFile(path.join(prefix,file),bytes)
  await writeFile(path.join(library,'local',pack+'.json'),JSON.stringify({revision,retired:[],installedAt:1}))
  return {temp,library,out,pack,revision,mediaFile:path.join(prefix,file),args:['migrate-p5','--library',library,'--pack',pack,'--out',out]}
}

test('migrate-p5 preview rejects media missing from the source mirror without creating output',async t=>{
  const {temp,args,mediaFile}=await legacyMirror(t)
  await rm(mediaFile)
  await assert.rejects(runCli([...args,'--dry-run']),e=>e.code==='ENOENT'&&e.message.includes(path.basename(mediaFile)))
  assert.deepEqual(await readdir(temp),['old'])
})

test('migrate-p5 removes its partial directory after a failed apply',async t=>{
  const {temp,args,revision}=await legacyMirror(t)
  const failure=new Error('Injected copy failure')
  const mock=t.mock.method(fs,'copyFile',async()=>{throw failure});syncBuiltinESMExports()
  try {
    await assert.rejects(runCli([...args,'--expected-revision',revision,'--confirm']),e=>e===failure)
  } finally {
    mock.mock.restore();syncBuiltinESMExports()
  }
  assert.deepEqual(await readdir(temp),['old'])
})

test('migrate-p5 rejects an empty output created at placement time without touching it',async t=>{
  const {temp,args,out,revision}=await legacyMirror(t)
  const originalMkdir=fs.mkdir
  let competingDirectory
  const mock=t.mock.method(fs,'mkdir',async(dir,options)=>{
    if(dir===out){await originalMkdir(out);competingDirectory=await stat(out)}
    return originalMkdir(dir,options)
  });syncBuiltinESMExports()
  try {
    await assert.rejects(runCli([...args,'--expected-revision',revision,'--confirm']),e=>e.code==='EEXIST')
  } finally {
    mock.mock.restore();syncBuiltinESMExports()
  }
  assert.ok(competingDirectory)
  assert.equal((await stat(out)).ino,competingDirectory.ino)
  assert.deepEqual(await readdir(out),[])
  assert.deepEqual((await readdir(temp)).sort(),['new','old'])
})

test('old native mirror has actionable read-only boundary; explicit P5 dry-run and copy reuse the live planner',async t=>{
  const temp=await mkdtemp(path.join(os.tmpdir(),'cli-p5-'));t.after(()=>rm(temp,{recursive:true,force:true}))
  const library=path.join(temp,'old'),out=path.join(temp,'new'),pack='11111111-1111-4111-8111-111111111111',revision='22222222-2222-4222-8222-222222222222'
  const bytes=syntheticImage(16,16,{opaque:true}),media=hash(bytes),file='media/'+media+'.png',common={enabled:true,recall:{mode:'constant',keywords:[]},directorNote:''}
  const manifest={format:'dsh-asset-pack',schemaVersion:1,id:pack,name:'Legacy mirror',contentHash:'0'.repeat(64),assets:[
    {...common,kind:'cg',id:'scene',name:'Scene',defaultVariant:'base',variants:[{key:'base',label:'Base',media,description:'Original art'}]},
    {...common,kind:'backgrounds',id:'room',name:'Room',media,baseTime:'day',variants:{night:media}}
  ],figures:[],sprites:{},bundles:{},blobs:{[media]:{ext:'png',mime:'image/png',size:bytes.length}},files:[{path:file,size:bytes.length,sha256:media}]}
  const prefix=path.join(library,'packs',pack);await mkdir(path.join(prefix,'media'),{recursive:true});await mkdir(path.join(library,'local'))
  const original=JSON.stringify(manifest);await writeFile(path.join(prefix,'manifest.json'),original);await writeFile(path.join(prefix,file),bytes)
  await writeFile(path.join(library,'local',pack+'.json'),JSON.stringify({revision,retired:[],installedAt:1}))
  await assert.rejects(readNativeSnapshot(library,pack),e=>e.code==='PRECONDITION'&&e.nextAction.includes('migrate-p5')&&e.nextAction.includes('--dry-run'))
  const args=['migrate-p5','--library',library,'--pack',pack,'--out',out]
  await assert.rejects(runCli(args),/dry-run first/)
  const preview=await runCli([...args,'--dry-run']);assert.equal(preview.sourceRevision,revision);assert.equal(preview.changed,true)
  assert.equal(await stat(out).catch(()=>null),null)
  await assert.rejects(runCli([...args,'--expected-revision','changed','--confirm']),/Source revision changed/)
  const applied=await runCli([...args,'--expected-revision',revision,'--confirm'])
  assert.notEqual(applied.revision,revision)
  const migrated=await readNativeSnapshot(out,pack,{media:true}),expected=planModsP5({snapshots:[{manifest,revision}]}).targets[0].manifest
  assert.deepEqual(migrated.manifest.assets,expected.assets);assert.deepEqual(migrated.manifest.files,manifest.files)
  assert.deepEqual(migrated.files.get(file),bytes);assert.equal(await readFile(path.join(prefix,'manifest.json'),'utf8'),original)
  assert.equal(migrated.revision,applied.revision)
  await assert.rejects(runCli([...args,'--expected-revision',revision,'--confirm']),/already exists/)
  const fresh=await runCli(['migrate-p5','--library',out,'--pack',pack,'--out',path.join(temp,'newer'),'--dry-run'])
  assert.equal(fresh.changed,false)
})

test('migrate-p5 rejects a linked output parent before creating anything, in dry-run and confirm',async t=>{
  const temp=await mkdtemp(path.join(os.tmpdir(),'cli-p5-link-'));t.after(()=>rm(temp,{recursive:true,force:true}))
  const library=path.join(temp,'old'),pack='11111111-1111-4111-8111-111111111111',revision='22222222-2222-4222-8222-222222222222'
  const bytes=syntheticImage(16,16,{opaque:true}),media=hash(bytes),file='media/'+media+'.png',common={enabled:true,recall:{mode:'constant',keywords:[]},directorNote:''}
  const manifest={format:'dsh-asset-pack',schemaVersion:1,id:pack,name:'Legacy mirror',contentHash:'0'.repeat(64),assets:[
    {...common,kind:'cg',id:'scene',name:'Scene',defaultVariant:'base',variants:[{key:'base',label:'Base',media,description:'Original art'}]}
  ],figures:[],sprites:{},bundles:{},blobs:{[media]:{ext:'png',mime:'image/png',size:bytes.length}},files:[{path:file,size:bytes.length,sha256:media}]}
  const prefix=path.join(library,'packs',pack);await mkdir(path.join(prefix,'media'),{recursive:true});await mkdir(path.join(library,'local'))
  await writeFile(path.join(prefix,'manifest.json'),JSON.stringify(manifest));await writeFile(path.join(prefix,file),bytes)
  await writeFile(path.join(library,'local',pack+'.json'),JSON.stringify({revision,retired:[],installedAt:1}))
  // Parent of --out is a directory link pointing into the source mirror.
  const link=path.join(temp,'link');try{await symlink(library,link,'junction')}catch(e){if(e.code==='EPERM'||e.code==='EACCES'||e.message==='Test safety: creating symlinks/junctions is prohibited'){t.skip('link creation not permitted: '+(e.code||e.message));return}throw e}
  const before=(await readdir(library)).sort()
  const args=['migrate-p5','--library',library,'--pack',pack,'--out',path.join(link,'new')]
  await assert.rejects(runCli([...args,'--dry-run']),/Linked or unsafe project path/)
  await assert.rejects(runCli([...args,'--expected-revision',revision,'--confirm']),/Linked or unsafe project path/)
  assert.deepEqual((await readdir(library)).sort(),before)
  assert.deepEqual((await readdir(path.join(library,'packs'))).sort(),[pack])
  assert.equal(await stat(path.join(library,'local',pack+'.json')).then(()=>true),true)
})
