import {fixtureCli} from './helpers/generated-image-fixture.mjs'
const runCli=fixtureCli(generationFixtureRunCli)
import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,writeFile,readFile} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {runCli as generationFixtureRunCli} from '../bin/dsh-assets.mjs'
import {loadProject} from '../tavern-plugin/lib/domain/asset-production-project.js'

test('new static authoring defaults require four mouth frames; explicit legacy repair preserves slots',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'mouth-default-'));t.after(()=>rm(root,{recursive:true,force:true}))
  const input=path.join(root,'input.json'),project=path.join(root,'project')
  await writeFile(input,JSON.stringify({characters:[{key:'hero',name:'Different Name',emotions:[{id:'e-calm',label:'Calm'},{id:'e-sad',label:'Sad'}],outfits:[{key:'daily',eyesClosed:['e-sad']},{key:'future'}]}]}))
  await runCli(['init','--project',project,'--characters',input])
  const forcedInput=JSON.parse(await readFile(input,'utf8'))
  for(const o of forcedInput.characters[0].outfits)o.mouth=false
  await writeFile(input,JSON.stringify(forcedInput))
  const forced=path.join(root,'explicit-false')
  await runCli(['init','--project',forced,'--characters',input])
  const forcedProject=await loadProject(forced)
  assert.equal(forcedProject.characters[0].outfits[0].mouth,true)
  assert.deepEqual((await runCli(['validate','--project',forced])).stages.mouth,{total:16,complete:0,pending:16})
  assert.equal(forcedProject.characters[0].outfits[1].mouth,true)
  let p=await loadProject(project)
  assert.equal(p.characters[0].outfits[0].mouth,true)
  assert.equal(Object.values(p.slots).filter(s=>s.kind==='mouth').length,16)
  assert.equal(Object.values(p.slots).filter(s=>s.outfit==='future'&&s.kind==='mouth').length,8)
  assert.deepEqual((await runCli(['validate','--project',project])).stages.mouth,{total:16,complete:0,pending:16})
  for(const id of Object.keys(p.slots))if(p.slots[id].kind==='mouth')delete p.slots[id]
  p.characters[0].outfits[0].mouth=false
  await writeFile(path.join(project,'project.json'),JSON.stringify(p,null,2)+'\n')
  const before=await readFile(path.join(project,'project.json'))
  assert.equal((await runCli(['validate','--project',project])).stages.mouth.total,0)
  const args=['require-mouth','--project',project]
  const preview=await runCli([...args,'--dry-run'])
  assert.equal(preview.added.length,16);assert.equal(preview.semantics,'opening-level')
  assert.deepEqual(await readFile(path.join(project,'project.json')),before)
  const result=await runCli(args),after=await loadProject(project)
  assert.deepEqual(result.added,preview.added)
  assert.equal(after.revision,p.revision+1)
  for(const [id,s]of Object.entries(p.slots))assert.deepEqual(after.slots[id],s)
  assert.deepEqual(after.plans,p.plans);assert.deepEqual(after.reviews,p.reviews)
  for(const emotion of ['e-calm','e-sad'])for(const frame of ['closed','small','mid','open'])assert.equal(after.slots[`hero/daily/mouth/${emotion}/${frame}`].version,0)
  assert.equal((await runCli(args)).added.length,0)
  assert.equal((await loadProject(project)).revision,after.revision)
})
