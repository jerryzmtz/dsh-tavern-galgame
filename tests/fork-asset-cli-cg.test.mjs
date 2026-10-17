import {fixtureCli} from './helpers/generated-image-fixture.mjs'
const runCli=fixtureCli(generationFixtureRunCli)
import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import {runCli as generationFixtureRunCli} from '../bin/dsh-assets.mjs'
import {initProject,compileProduction} from '../tavern-plugin/lib/domain/asset-production-project.js'

const ids=['calm','joy','anger','sad','anxious','shy','disgust','love','crying']
async function fixture(t) {
  const root=await mkdtemp(path.join(os.tmpdir(),'cli-cg-'));t.after(()=>rm(root,{recursive:true,force:true}))
  await initProject(root,{characters:[{key:'hero',emotions:ids.map(id=>({id,label:id.slice(0,6),guidance:''})),outfits:[{key:'daily'},{key:'rejected'}]}]})
  return root
}
test('explicit project migration shares legacy labels, backs up exact bytes, preserves identities and is idempotent',async t=>{
  const root=await fixture(t),file=path.join(root,'project.json'),p=JSON.parse(await readFile(file,'utf8'))
  for(const o of p.characters[0].outfits)o.emotions=[...ids]
  delete p.characters[0].emotions;p.review={hash:'old'};p.reviews=[]
  const original=JSON.stringify(p,null,2)+'\n';await writeFile(file,original)
  const preview=await runCli(['migrate-project','--project',root,'--dry-run'])
  assert.deepEqual(preview.changed,['hero']);assert.equal(await readFile(file,'utf8'),original)
  const result=await runCli(['migrate-project','--project',root])
  t.after(()=>rm(result.backup,{force:true}))
  const after=JSON.parse(await readFile(file,'utf8'))
  assert.equal(await readFile(result.backup,'utf8'),original)
  assert.equal(after.id,p.id);assert.equal(after.characters[0].id,p.characters[0].id)
  assert.deepEqual(after.slots,p.slots);assert.deepEqual(after.characters[0].outfits,p.characters[0].outfits.map(({emotions,...o})=>o))
  const labels=Object.fromEntries(after.characters[0].emotions.map(e=>[e.id,e.label]))
  assert.deepEqual(ids.map(id=>labels[id]),['\u5e73\u548c','\u559c\u60a6','\u6124\u6012','\u60b2\u4f24','\u7d27\u5f20','\u5bb3\u7f9e','\u5acc\u5f03','\u7231\u604b','\u54ed\u6ce3'])
  assert.equal(after.review,undefined);assert.equal(after.revision,p.revision+1)
  assert.deepEqual((await runCli(['migrate-project','--project',root])).changed,[])
  assert.equal(JSON.parse(await readFile(file,'utf8')).revision,after.revision)
  assert.equal((await compileProduction(root)).manifest.figures.length,1)
})
test('pack exclusion removes the declaration and all its runtime data, never the local project',async t=>{
  const root=await fixture(t),file=path.join(root,'project.json'),p=JSON.parse(await readFile(file,'utf8'))
  // An excluded unfinished asset must neither be read nor block an unrelated export.
  p.slots['hero/rejected/sprite/calm'].artifact={hash:'0'.repeat(64),path:'images/absent.png'}
  p.slots['hero/rejected/sprite/calm'].stale=true
  await writeFile(file,JSON.stringify(p));const before=await readFile(file)
  const result=await runCli(['pack','--project',root,'--exclude-outfit','hero/rejected'])
  assert.deepEqual(result.excludedOutfits,['hero/rejected']);assert.equal(result.installReady,false)
  const figure=JSON.parse(await readFile(path.join(result.source,'figures',p.characters[0].id+'.json'),'utf8'))
  assert.deepEqual(figure.outfits.map(o=>o.key),['daily'])
  assert.deepEqual(await readFile(file),before)
  await assert.rejects(runCli(['pack','--project',root,'--exclude-outfit','hero/typo']),{code:'INVALID_ARGUMENT'})
  await assert.rejects(compileProduction(root),{code:'GENERATION_RECEIPT_REQUIRED'})
})
