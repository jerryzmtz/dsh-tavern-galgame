import {fixtureCli,fixtureImport} from './helpers/generated-image-fixture.mjs'
const runCli=fixtureCli(generationFixtureRunCli)
const importImage=fixtureImport(generationFixtureImport)
// private fork: legacy projects carry explicit declaration fixtures.
import {declaredProduction,legacyFixtureCli,legacyFixtureInit} from './helpers/legacy-production-fixture.mjs'
const initProject=(root,input,...args)=>legacyFixtureInit(rawInitProject,root,input,...args)
import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {extractEyeRegion} from '../tavern-plugin/lib/domain/asset-production-quality.js'
import {decodeAssetRgba,encodeAssetRgba} from '../tavern-plugin/lib/domain/asset-image-processing.js'
import {initProject as rawInitProject,importImage as generationFixtureImport,loadProject} from '../tavern-plugin/lib/domain/asset-production-project.js'
import {migrateProject} from '../tools/dsh-assets/project-ops.mjs'
import {syntheticImage} from '../tools/dsh-assets/dry-run.mjs'
import {runCli as generationFixtureRunCli,errorEnvelope} from '../bin/dsh-assets.mjs'

test('per-eye masks replace full iris regions while preserving brow, tears and intervening pixels',()=>{
  const base=syntheticImage(),edit=decodeAssetRgba(syntheticImage(128,192,{blink:true}))
  edit.data.set([255,0,0,255],(34*128+60)*4)
  edit.data.set([255,0,0,255],(52*128+42)*4)
  const geometry={headRect:[32,12,64,80],eyeMasks:[[[40,34],[56,34],[56,47],[40,47]],[[70,34],[86,34],[86,47],[70,47]]]}
  const result=extractEyeRegion(base,encodeAssetRgba(edit),geometry),patch=decodeAssetRgba(result.bytes),source=decodeAssetRgba(base)
  const [rx,ry]=result.rect
  for(let y=0;y<patch.height;y++)for(let x=0;x<patch.width;x++) {
    const i=(y*patch.width+x)*4,xx=x+rx,yy=y+ry,masked=yy>=34&&yy<47&&(xx>=40&&xx<56||xx>=70&&xx<86)
    assert.equal(patch.data[i+3],masked?255:0)
    if(masked)assert.deepEqual([...patch.data.subarray(i,i+4)],[...edit.data.subarray((yy*128+xx)*4,(yy*128+xx)*4+4)])
    else assert.notDeepEqual([...source.data.subarray((yy*128+xx)*4,(yy*128+xx)*4+4)],[255,0,0,255])
  }
  assert.throws(()=>extractEyeRegion(base,base,geometry),{code:'PRECONDITION'})
  assert.throws(()=>extractEyeRegion(base,encodeAssetRgba(edit),{...geometry,eyeMasks:[geometry.eyeMasks[0],geometry.eyeMasks[0]]}),{code:'PRECONDITION'})
})
test('migrate dry-run reports precisely unreferenced reclaim candidates without writing',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'reclaim-'));t.after(()=>rm(root,{recursive:true,force:true}))
  await initProject(root,{characters:[{key:'hero',outfits:[{key:'daily',emotions:['calm']},{key:'old',emotions:['calm']}]}]})
  const a=path.join(root,'a.png'),b=path.join(root,'b.png');await writeFile(a,syntheticImage());await writeFile(b,syntheticImage(128,192,{blink:true}))
  await importImage(root,{slot:'hero/daily/sprite/calm',file:a});await importImage(root,{slot:'hero/old/sprite/calm',file:b})
  const p=await loadProject(root),removed=p.slots['hero/old/sprite/calm'].artifact.path
  p.characters[0].outfits[1].status='excluded';await writeFile(path.join(root,'project.json'),JSON.stringify(p))
  const before=await readFile(path.join(root,'project.json')),dry=await migrateProject(root,{dryRun:true})
  assert.deepEqual(dry.reclaimedMedia,[removed]);assert.deepEqual(await readFile(path.join(root,'project.json')),before)
  assert.ok(await readFile(path.join(root,removed)))
  const applied=await migrateProject(root,{backupRoot:path.join(root,'external-backups')});assert.deepEqual(applied.reclaimedMedia,dry.reclaimedMedia)
  await assert.rejects(readFile(path.join(root,removed)),{code:'ENOENT'})
  assert.deepEqual(await readFile(applied.backup),before)
})
test('CLI rejects unknown flags before any project IO',async()=>{
  for(const args of [['missing','--project','does-not-exist','--all'],['migrate','--project','does-not-exist','--unknown']]) {
    await assert.rejects(runCli(args),error=>{assert.equal(errorEnvelope(error).exit,2);return true})
  }
})
