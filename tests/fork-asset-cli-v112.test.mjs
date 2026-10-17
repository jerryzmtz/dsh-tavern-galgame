import {fixtureCli} from './helpers/generated-image-fixture.mjs'
const runCli=fixtureCli(generationFixtureRunCli)
// private fork: static-review regressions; no paid calls, live files or filesystem links.
import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import os from 'node:os'
import {mkdtemp,mkdir,writeFile,readFile,readdir} from 'node:fs/promises'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {fileURLToPath} from 'node:url'
import {runCli as generationFixtureRunCli} from '../bin/dsh-assets.mjs'
import {dryRun,syntheticImage} from '../tools/dsh-assets/dry-run.mjs'
import {safeProjectFile} from '../tavern-plugin/lib/domain/asset-production-project.js'
import {decodeAssetRgba,encodeAssetRgba,checkAssetImage,registerSprite} from '../tavern-plugin/lib/domain/asset-image-processing.js'
const temp=()=>mkdtemp(path.join(os.tmpdir(),'dsh-assets-v112-'))
const exec=promisify(execFile),entry=fileURLToPath(new URL('../bin/dsh-assets.mjs',import.meta.url))

test('unsupported flags fail before any IO, including dry-run and exchange subcommands',async()=>{
  for(const command of ['init','prompt','generate','import','accept','register','avatar-crop','wait','refused','validate','pack','review-html','status','bundle','dry-run']){
    await assert.rejects(runCli([command,'--dry-run']),e=>e.code==='INVALID_ARGUMENT'&&e.message.includes('Unsupported option'))
  }
  for(const args of [
    ['status','--replace'],['prompt','--confirm'],['exchange','pack','--base-folder','unused'],
    ['exchange','receive','--project','unused'],['exchange','cleanup','--manifest','unused'],
    ['status','--wat'],['status','--json','--json'],['import','--replace','--replace']
  ])await assert.rejects(runCli(args),{code:'INVALID_ARGUMENT'})
  const root=await temp()
  for(const args of [['prompt','--project',root,'--slot','unused','--dry-run'],['status','--help','--wat'],['nonsense','--help']]){
    await assert.rejects(exec(process.execPath,[entry,...args]),e=>{
      assert.equal(e.code,2);const response=JSON.parse(e.stdout)
      assert.equal(response.ok,false);assert.equal(response.error.code,'INVALID_ARGUMENT');assert.equal(response.outcome,'not_applied');assert.equal(response.error.retryable,false);return true
    })
  }
  assert.deepEqual(await readdir(root),[])
})

test('synthetic dry-run rejects every existing root without modifying contents',async()=>{
  const parent=await temp(),empty=path.join(parent,'empty'),occupied=path.join(parent,'occupied'),file=path.join(parent,'file')
  await mkdir(empty);await mkdir(occupied);await mkdir(path.join(occupied,'verification-library'))
  await writeFile(path.join(occupied,'keep.txt'),'keep');await writeFile(file,'keep')
  for(const root of [empty,occupied])await assert.rejects(dryRun(root),{code:'EEXIST'})
  await assert.rejects(dryRun(file),e=>['EEXIST','ENOTDIR'].includes(e.code))
  assert.deepEqual(await readdir(empty),[])
  assert.deepEqual((await readdir(occupied)).sort(),['keep.txt','verification-library'])
  assert.equal(await readFile(path.join(occupied,'keep.txt'),'utf8'),'keep');assert.equal(await readFile(file,'utf8'),'keep')
})

test('project paths inspect all ancestors using native storage gate, even above missing roots',async()=>{
  const root=path.resolve(os.tmpdir(),'asset-parent','missing','project'),anchor=path.parse(root).root,seen=[]
  const inspect=async current=>{seen.push(current);if(current===path.join(os.tmpdir(),'asset-parent'))return {isSymbolicLink:()=>true};if(current.includes('missing'))throw Object.assign(new Error('Absent'),{code:'ENOENT'});return {isSymbolicLink:()=>false}}
  await assert.rejects(safeProjectFile(root,'images/test.png',inspect),{code:'INVALID_ARGUMENT'})
  assert.equal(seen[0],anchor);assert.ok(!seen.includes(root))
  const visited=[]
  assert.equal(await safeProjectFile(root,'images/test.png',async current=>{visited.push(current);throw Object.assign(new Error('Absent'),{code:'ENOENT'})}),path.join(root,'images','test.png'))
  assert.equal(visited[0],anchor);assert.equal(visited.at(-1),path.join(root,'images','test.png'))
  for(const relative of ['../escape','a/../escape','a\\escape','/escape','a//b'])await assert.rejects(safeProjectFile(root,relative),{code:'INVALID_ARGUMENT'})
})

test('bbox and registration clipping share alpha >8',()=>{
  const image=decodeAssetRgba(syntheticImage())
  image.data.set([100,120,180,8],(1*image.width+1)*4)
  const bytes=encodeAssetRgba(image),checked=checkAssetImage(bytes,'sprite')
  assert.deepEqual(checked.bbox,{x:32,y:12,w:64,h:168})
  image.data[(1*image.width+1)*4+3]=9
  assert.deepEqual(checkAssetImage(encodeAssetRgba(image),'sprite').bbox,{x:1,y:1,w:95,h:179})
  assert.doesNotThrow(()=>registerSprite(bytes,syntheticImage(),{headTop:12,feet:180,supportX:64},{headTop:12,feet:180,supportX:60}))
  assert.throws(()=>registerSprite(encodeAssetRgba(image),syntheticImage(),{headTop:12,feet:180,supportX:64},{headTop:12,feet:180,supportX:60}),{code:'ALIGNMENT_REQUIRED'})
  assert.deepEqual(registerSprite(bytes,bytes).bytes,bytes)
  assert.deepEqual(decodeAssetRgba(bytes).data[(1*image.width+1)*4+3],8)
})

test('four-image supplement retains provenance and maps canonical runtime identities, not filenames',{skip:'Private 765 production provenance is intentionally not distributed'},async()=>{
  const m=JSON.parse(await readFile(new URL('../tools/dsh-assets/765-local-fills.json',import.meta.url),'utf8'))
  assert.equal(m.items.length,4)
  for(const item of m.items){
    assert.equal(item.production_mapping.character_id,item.runtime.figure_id)
    assert.equal(item.production_mapping.slot_pattern,`{resolved_character_key}/${item.runtime.outfit_key}/sprite/${item.runtime.state_id}`)
    assert.equal(item.registration.bbox_alpha_threshold,null)
    assert.ok(item.prompt&&item.references.length&&item.source_master_id&&item.installed_pack_revision)
    assert.equal(item.pixel_bounds.format,'ltrb-exclusive');assert.notDeepEqual(item.pixel_bounds.alpha_gt_0,item.registration.bbox)
  }
  assert.equal(m.items.find(i=>i.runtime.state_id==='sad').source_state_id,'sadness')
})
