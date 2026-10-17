import {fixtureCli,fixtureImport} from './helpers/generated-image-fixture.mjs'
const rawRunCli=fixtureCli(generationFixtureRunCli)
const importImage=fixtureImport(generationFixtureImport)
// private fork: legacy projects carry explicit declaration fixtures.
import {declaredProduction,legacyFixtureCli,legacyFixtureInit} from './helpers/legacy-production-fixture.mjs'
const initProject=(root,input,...args)=>legacyFixtureInit(rawInitProject,root,input,...args)
const runCli=legacyFixtureCli(rawRunCli)
import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {spawnSync} from 'node:child_process'
import {initProject as rawInitProject,loadProject,transaction,projectStatus,productionProgress,validateProduction,compileProduction,packProduction,preparePrompt,importImage as generationFixtureImport,registerProduction} from '../tavern-plugin/lib/domain/asset-production-project.js'
import {migrateProject} from '../tools/dsh-assets/project-ops.mjs'
import {missingImages} from '../tools/dsh-assets/missing.mjs'
import {buildReviewData} from '../tools/dsh-assets/review-data.mjs'
import {dryRun,syntheticImage} from '../tools/dsh-assets/dry-run.mjs'
import {runCli as generationFixtureRunCli} from '../bin/dsh-assets.mjs'
import {projectSchema} from '../tavern-plugin/lib/domain/asset-production-schema.js'
const temp=()=>mkdtemp(path.join(os.tmpdir(),'asset-114-'))
const fixture={characters:[{key:'hero',name:'Different Name',outfits:[{key:'daily',emotions:['calm','sad'],mouth:true}]}]}

test('legacy exclusions migrate to plain missing; inventory is read-only',async()=>{
  const root=await temp()
  try {
    await initProject(root,fixture)
    const file=path.join(root,'project.json'),p=JSON.parse(await readFile(file,'utf8'))
    p.characters[0].outfits[0].status='excluded'
    Object.assign(p.slots['hero/daily/sprite/sad'],{status:'excluded',reason:'old decision',note:'old note'})
    await writeFile(file,JSON.stringify(p))
    await assert.rejects(loadProject(root))
    await migrateProject(root)
    const before=await readFile(file),result=await missingImages(root,{kind:'sprite'})
    assert.equal(result.total,2);assert.ok(result.slots.every(row=>!('note' in row)&&!('reason' in row)))
    assert.deepEqual(await readFile(file),before)
    assert.equal((await migrateProject(root)).idempotent,true)
    assert.equal((await validateProduction(root)).status,'partial')
    assert.equal((await projectStatus(root)).slots.find(s=>s.slot==='hero/daily/sprite/sad').state,'missing')
    assert.equal(buildReviewData(await loadProject(root)).characters[0].outfits[0].states[1].sprite.status,'missing')
    const pack=await compileProduction(root)
    assert.equal(pack.warnings.find(w=>w.code==='MISSING_IMAGES').count,16)
    assert.equal(pack.manifest.figures.length,1)
  }finally{await rm(root,{recursive:true,force:true})}
})

test('single local fill imports before masters without a plan and registers only against real calm',async()=>{
  const root=await temp()
  try {
    await initProject(root,fixture)
    const file=path.join(root,'fill.png'),slot='hero/daily/sprite/sad'
    await writeFile(file,syntheticImage())
    await assert.rejects(preparePrompt(root,{slot}),{code:'PRECONDITION'})
    const result=await runCli(['import','--project',root,'--slot',slot,'--file',file,'--source','local-fill','--json'])
    assert.equal(result.registered,false)
    let p=await loadProject(root)
    assert.deepEqual(p.plans,{});assert.equal(p.slots[slot].accepted,undefined);assert.equal(p.slots[slot].registered,undefined)
    assert.deepEqual(await readFile(path.join(root,p.slots[slot].raw.path)),await readFile(file))
    assert.equal((await importImage(root,{slot,file})).idempotent,true)
    await assert.rejects(registerProduction(root,{slot}),{code:'PRECONDITION'})
    await importImage(root,{slot:'hero/daily/sprite/calm',file})
    assert.equal((await loadProject(root)).slots[slot].stale,true)
    await registerProduction(root,{slot})
    p=await loadProject(root);assert.ok(p.slots[slot].registered);assert.equal(p.slots[slot].stale,undefined)
    assert.equal(p.slots['hero/identity-settei'].accepted,undefined)
    assert.equal((await validateProduction(root)).status,'partial')
    await assert.rejects(importImage(root,{slot,plan:'not-both',file}),{code:'INVALID_ARGUMENT'})
  }finally{await rm(root,{recursive:true,force:true})}
})

test('partial native pack leaves missing states and frames absent',async()=>{
  const root=await temp(),project=path.join(root,'project')
  try {
    await dryRun(project)
    await transaction(project,p=>{for(const id of ['fixture/daily/sprite/sad','fixture/daily/avatar/sad','fixture/daily/avatar/calm','fixture/daily/blink/calm','fixture/daily/mouth/calm/open','background/room'])delete p.slots[id].artifact;for(const slot of Object.values(p.slots))slot.inputs=[]})
    assert.equal((await validateProduction(project)).status,'partial')
    const pack=await compileProduction(project),sprite=JSON.parse(pack.files.get('sprites/fixture-daily/manifest.json'))
    /* private fork: canonical own-image dictionary */ assert.deepEqual(Object.keys(sprite.emotions),['calm']);assert.equal(sprite.emotions.calm.blink,undefined);assert.equal(sprite.rig,undefined)
    const figure=JSON.parse(pack.files.get('figures/'+pack.manifest.figures[0]+'.json'))
    assert.equal(figure.outfits.length,1);assert.deepEqual(figure.outfits[0].avatars,{})
    assert.equal(figure.heightCm,undefined);assert.equal(figure.heightBasis,undefined)
    assert.ok(!pack.manifest.assets.some(a=>a.id==='room'))
    assert.equal(Object.keys(figure.outfits[0].sprite.assets).length,1)
    assert.equal(pack.warnings.find(w=>w.code==='MISSING_IMAGES').count,6)
    assert.equal((await packProduction(project)).installReady,false)
  }finally{await rm(root,{recursive:true,force:true})}
})

test('prompt uses only the schema plan cap, including 4096 and the real boundary',async()=>{
  const root=await temp()
  try {
    await initProject(root,fixture)
    const seed=async count=>transaction(root,p=>{p.plans=Object.fromEntries(Array.from({length:count},(_,i)=>['history'+i,{}]))})
    await seed(4096)
    await preparePrompt(root,{slot:'hero/identity-settei'})
    assert.equal(Object.keys((await loadProject(root)).plans).length,4097)
    const limit=projectSchema.properties.plans.maxProperties
    await seed(limit-1)
    await preparePrompt(root,{slot:'hero/identity-settei'})
    assert.equal(Object.keys((await loadProject(root)).plans).length,limit)
    const before=await readFile(path.join(root,'project.json'))
    await assert.rejects(preparePrompt(root,{slot:'hero/identity-settei'}),error=>error.code==='INVALID_ARGUMENT'&&error.message.includes('$.plans'))
    assert.deepEqual(await readFile(path.join(root,'project.json')),before)
  }finally{await rm(root,{recursive:true,force:true})}
})

test('init enforces the slot schema cap before writing the ledger',async()=>{
  const root=await temp()
  try {
    await assert.rejects(initProject(root,{characters:Array.from({length:4},(_,i)=>({key:'hero'+i,outfits:Array.from({length:64},(_,j)=>({key:'outfit'+j,mouth:true}))}))}),error=>error.code==='INVALID_ARGUMENT'&&error.message.includes('$.slots'))
    await assert.rejects(readFile(path.join(root,'project.json')),{code:'ENOENT'})
  }finally{await rm(root,{recursive:true,force:true})}
})

test('init preserves measured height only and rejects exclusions',async()=>{
  const root=await temp()
  try {
    await initProject(root,{characters:[{key:'a',outfits:[{key:'daily',emotions:['calm']}]},{key:'b',heightCm:162,outfits:[{key:'daily',emotions:['calm']}]}]})
    const p=await loadProject(root);assert.equal(p.characters[0].heightCm,undefined);assert.equal(p.characters[1].heightCm,162)
    assert.equal(productionProgress(p).pending.length,10)
  }finally{await rm(root,{recursive:true,force:true})}
})
