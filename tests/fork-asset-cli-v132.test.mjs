import {fixtureCli} from './helpers/generated-image-fixture.mjs'
const runCli=fixtureCli(generationFixtureRunCli)
import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import os from 'node:os'
import {mkdtemp,rm} from 'node:fs/promises'
import {dryRun} from '../tools/dsh-assets/dry-run.mjs'
import {runCli as generationFixtureRunCli} from '../bin/dsh-assets.mjs'
import {preserveOutfitMetadata} from '../tools/dsh-assets/install.mjs'
import {createAssetPackService} from '../tavern-plugin/packages/dsh-asset-library/lib/pack-v2/service.js'

test('CLI update round-trips service-authored guidance and recall without losing CAS or idempotency',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'asset-cli-v132-'))
  t.after(()=>rm(root,{recursive:true,force:true}))
  const project=path.join(root,'project'),proof=await dryRun(project),library=path.join(project,'verification-library')
  const service=createAssetPackService({assetRoot:library})
  t.after(()=>service.dispose())
  const packId=proof.installed.id,before=await service.getPackSnapshot({packId}),figure=Object.values(before.figures)[0]
  const outfits=structuredClone(figure.outfits)
  outfits[0].guidance='Only for this scene'
  outfits[0].label='special scene'
  outfits[0].recall={mode:'keyword',keywords:['special scene','傻','笨']} // private fork: no priority
  const edited=await service.patchFigure({packId,figureId:figure.id,expectedRevision:before.revision,patch:{outfits}})
  const args=['install','--project',project,'--library',library,'--expected-revision',edited.snapshot.revision,'--confirm']
  const installed=await runCli(args)
  const after=await service.getPackSnapshot({packId})
  assert.equal(after.revision,installed.revision)
  assert.deepEqual(after.figures[figure.id].outfits,outfits)
  assert.equal(installed.status,'updated')
  await assert.rejects(runCli([...args.slice(0,6),before.revision,'--confirm']),{code:'CONFLICT'})
  const again=await runCli([...args.slice(0,6),installed.revision,'--confirm'])
  assert.equal(again.status,'noop')
})

test('metadata merge preserves future declarations by identity, never replaces generated media',()=>{
  const previous={key:'daily',guidance:'scene',futureCalmOnly:{enabled:true},avatars:{old:'old'},sprite:{manifestKey:'old'},settei:'old'}
  const current={figures:{uuid:{outfits:[previous]}}}
  const incoming={figures:{uuid:{outfits:[{key:'daily',avatars:{calm:'new'},sprite:{manifestKey:'new'}},{key:'other'}]},other:{outfits:[{key:'daily'}]}}}
  preserveOutfitMetadata(current,incoming)
  assert.deepEqual(incoming.figures.uuid.outfits[0],{key:'daily',guidance:'scene',futureCalmOnly:{enabled:true},avatars:{calm:'new'},sprite:{manifestKey:'new'}})
  assert.deepEqual(incoming.figures.uuid.outfits[1],{key:'other'})
  assert.deepEqual(incoming.figures.other.outfits[0],{key:'daily'})
  incoming.figures.uuid.outfits[0].futureCalmOnly.enabled=false
  assert.equal(previous.futureCalmOnly.enabled,true)
})
