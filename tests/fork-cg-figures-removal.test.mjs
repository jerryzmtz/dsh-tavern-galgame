// private fork: removed fields are converted only on import or explicit CAS migration.
import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp, mkdir, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {cgFixture} from './fork-cg-contract.test.mjs'
import {validateAsset} from '../tavern-plugin/packages/dsh-asset-library/src/asset-packs/index.js'
import {createAssetPackService} from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/service.js'
import {sealPack, jsonBytes} from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/validation.js'
import {writeZip} from '../tavern-plugin/packages/dsh-asset-library/src/zip.js'
import {readFile} from 'node:fs/promises'

test('old CG archive imports without figures; current writes reject UNKNOWN_FIELD',async t=>{
  const root=await mkdtemp(join(tmpdir(),'cg-remove-import-')), service=createAssetPackService({assetRoot:join(root,'assets')})
  t.after(()=>service.dispose())
  const {pack,cg}=await cgFixture();cg.depicts=[{packId:pack.manifest.id,figureId:pack.manifest.figures[0]}]
  assert.throws(()=>validateAsset(cg),{code:'UNKNOWN_FIELD'}) // private fork
  await sealPack(pack.manifest,pack.files)
  const zip=join(root,'old.zip');await writeZip(zip,[{path:'manifest.json',data:jsonBytes(pack.manifest)},...[...pack.files].map(([path,data])=>({path,data}))])
  const preview=await service.inspectImport({bytes:await readFile(zip)})
  const result=await service.applyImport({inspectionId:preview.inspectionId,expectedRevision:preview.expectedRevision,decision:'install'})
  assert.equal(Object.hasOwn(result.snapshot.manifest.assets.at(-1),'depicts'),false) // private fork
  await assert.rejects(service.patchPack({packId:pack.manifest.id,expectedRevision:result.snapshot.revision,patch:{assets:pack.manifest.assets}}),{code:'UNKNOWN_FIELD'}) // private fork
})
test('installed CG removal uses CAS, preserves focus/media/figures and does not rewrite history',async t=>{
  const root=await mkdtemp(join(tmpdir(),'cg-remove-cas-')), service=createAssetPackService({assetRoot:root})
  t.after(()=>service.dispose())
  const {pack,cg}=await cgFixture();cg.depicts=[];await sealPack(pack.manifest,pack.files)
  // Seed an old installed pack directly: importing would already perform the conversion.
  for(const [name,bytes] of [['manifest.json',jsonBytes(pack.manifest)],...pack.files]) {
    const file=join(root,'packs',pack.manifest.id,name);await mkdir(join(file,'..'),{recursive:true});await writeFile(file,bytes)
  }
  await mkdir(join(root,'local'),{recursive:true});await writeFile(join(root,'local',pack.manifest.id+'.json'),jsonBytes({revision:'old',retired:[]}))
  await assert.rejects(service.migrateCgFigures({packId:pack.manifest.id,expectedRevision:'stale'}),{code:'REVISION_CONFLICT'}) // private fork
  const result=await service.migrateCgFigures({packId:pack.manifest.id,expectedRevision:'old'})
  const expected=structuredClone(pack.manifest);delete expected.assets.at(-1).depicts;expected.contentHash=result.snapshot.manifest.contentHash
  assert.deepEqual(result.snapshot.manifest,expected) // private fork
  assert.notEqual(result.snapshot.revision,'old') // private fork
})
