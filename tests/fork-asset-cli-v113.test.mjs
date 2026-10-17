// private fork: legacy projects carry explicit declaration fixtures.
import {declaredProduction,legacyFixtureCli,legacyFixtureInit} from './helpers/legacy-production-fixture.mjs'
const initProject=(root,input,...args)=>legacyFixtureInit(rawInitProject,root,input,...args)
import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,writeFile,readFile} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {spawnSync} from 'node:child_process'
import {initProject as rawInitProject,loadProject,validateProduction,packProduction,productionProgress,projectStatus,reviewProduction} from '../tavern-plugin/lib/domain/asset-production-project.js'
import {projectSchema,validateProjectSchema} from '../tavern-plugin/lib/domain/asset-production-schema.js'
import {buildReviewData} from '../tools/dsh-assets/review-data.mjs'

test('5134-slot CG keeps one pack identity, reports partial stages, and packs without substitutes',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'asset-113-'))
  try {
    const id='f21ef3a0-5709-44cf-8499-fc392a8d8507'
    const input={id,characters:Array.from({length:14},(_,i)=>({key:'figure'+i,outfits:Array.from({length:i<10?6:5},(_,j)=>({key:'outfit'+j,mouth:true}))}))}
    const initialized=await initProject(root,input);assert.equal(initialized.slots,5134);assert.equal(initialized.id,id)
    const p=await loadProject(root);assert.equal(validateProjectSchema(p),p)
    assert.equal(projectSchema.properties.slots.maxProperties,16384);assert.equal(projectSchema.properties.plans.maxProperties,65536)
    p.plans=Object.fromEntries(Array.from({length:5134},(_,i)=>['plan'+i,{slot:'figure0/identity-settei',status:'prepared',targetVersion:0}]))
    validateProjectSchema(p)
    const result=await validateProduction(root)
    assert.equal(result.status,'partial');assert.equal(result.valid,false);assert.equal(result.compiled,false)
    assert.deepEqual(result.stages.sprite,{total:720,complete:0,pending:720})
    assert.equal(result.stages.avatar.pending,720);assert.equal(result.stages.blink.pending,720);assert.equal(result.stages.mouth.pending,2880)
    assert.equal(result.pending.length,5134)
    assert.equal((await projectStatus(root)).total,5134)
    assert.equal(buildReviewData(p).characters.length,14)
    assert.equal((await packProduction(root)).warnings.find(w=>w.code==='MISSING_IMAGES').count,5134)
    const cli=spawnSync(process.execPath,[path.resolve('bin/dsh-assets.mjs'),'validate','--project',root,'--json'],{encoding:'utf8'})
    assert.equal(cli.status,0);assert.equal(JSON.parse(cli.stdout).result.status,'partial')
    await writeFile(path.join(root,'project.json'),'{}')
    await assert.rejects(validateProduction(root),{code:'INVALID_ARGUMENT'})
  } finally {await rm(root,{recursive:true,force:true})}
})

test('stage completion is structural, not final approval; stale registration and references remain pending',()=>{
  // private fork: progress fixtures include the declaration that owns the anchor.
  const artifact={hash:'image'},p={characters:[{key:'hero',emotions:[{id:'calm',label:'Rest'}],outfits:[{key:'daily'}]}],slots:{}}
  p.slots['hero/daily/sprite/calm']={id:'hero/daily/sprite/calm',character:'hero',outfit:'daily',kind:'sprite',artifact,raw:{hash:'raw'},registered:{anchorHash:'raw'}}
  p.slots['hero/daily/avatar/calm']={id:'hero/daily/avatar/calm',kind:'avatar',artifact}
  let progress=productionProgress(p)
  assert.equal(progress.stages.sprite.complete,1);assert.equal(progress.stages.avatar.complete,1)
  p.slots['hero/daily/sprite/calm'].registered.anchorHash='old'
  p.slots['hero/daily/avatar/calm'].inputs=[{slot:'hero/daily/sprite/calm',hash:'old'}]
  progress=productionProgress(p)
  assert.equal(progress.stages.sprite.pending,1);assert.equal(progress.stages.avatar.pending,1)
  assert.ok(progress.pending[0].reasons.includes('REGISTRATION_REQUIRED'))
  assert.ok(progress.pending[1].reasons.includes('STALE_REFERENCES'))
})

test('external sprite review is display-only without a production ledger or approvals',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'asset-review-113-'))
  try {
    await initProject(root,{characters:[{key:'hero',outfits:[{key:'daily',emotions:['calm']}]}]})
    const data=buildReviewData(await loadProject(root))
    data.characters[0].outfits[0].states[0].sprite.status='retry-pending'
    await rm(path.join(root,'project.json'))
    const result=await reviewProduction(root,{data,scope:'sprite'})
    assert.equal(result.reviewOnly,true);assert.equal(result.installReady,false);assert.equal(result.hash,undefined)
    const rendered=JSON.parse(await readFile(path.join(root,'review-preview-data.json')))
    assert.equal(rendered.scope,'sprite');assert.equal(rendered.characters[0].outfits[0].states[0].sprite.status,'retry-pending')
    assert.match(await readFile(result.absolutePath,'utf8'),/retry-pending/)
    await assert.rejects(readFile(path.join(root,'project.json')),{code:'ENOENT'})
    data.characters[0].outfits[0].states[0].sprite.image={path:'../escape.png',native_size:[1,1]}
    await assert.rejects(reviewProduction(root,{data}),{code:'INVALID_ARGUMENT'})
  }finally{await rm(root,{recursive:true,force:true})}
})
