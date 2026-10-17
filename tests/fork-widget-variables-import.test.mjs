import {tmpdir as publicTmpdir} from 'node:os';
import {join as publicJoin} from 'node:path';
// private fork: declaration risk is enforced even without a detected script; local patches cannot expand it.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import { officialPhonePack, PHONE_PACK_ID } from './fixtures/source-widget/fork-build-phone-widget.mjs'
import { createAssetPackService } from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/service.js'
import { sealPack, jsonBytes } from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/validation.js'
import { writeZip } from '../tavern-plugin/packages/dsh-asset-library/src/zip.js'

test('import permission declaration requires the single inspection confirmation and rejects patch bypass', async t => {
  const root = await mkdtemp(publicJoin(publicTmpdir(), 'widget-variable-import-'))
  const service = createAssetPackService({ assetRoot: root + '/store' }); t.after(() => service.dispose())
  const pack = await officialPhonePack(), document = pack.widgets.phone
  document.variables = { reads: { balance: { source: 'mvu', path: '/balance' } }, writes: { balance: { source: 'mvu', path: '/balance', scope: 'exact', ops: ['delta'] } } }
  pack.files.set('bundles/phone/widget.json', jsonBytes(document))
  pack.files.set('bundles/phone/index.html', Buffer.from('<p>Static fixture</p>'))
  pack.files.delete('bundles/phone/index.js')
  pack.files.delete('bundles/phone/battery.js') // private fork (settings-ux r2): the phone view's second script
  await sealPack(pack.manifest, pack.files)
  await writeZip(root + '/fixture.zip', [{ path: 'manifest.json', data: jsonBytes(pack.manifest) }, ...[...pack.files].map(([path, data]) => ({ path, data }))])
  const preview = await service.inspectImport({ bytes: await readFile(root + '/fixture.zip') })
  assert.equal(preview.scriptRisk.length, 1)
  assert.equal(preview.scriptRisk[0].variables.writes[0].path, '/balance')
  await assert.rejects(service.applyImport({ inspectionId: preview.inspectionId, expectedRevision: preview.expectedRevision, decision: 'install' }), { code: 'SCRIPT_CONFIRMATION_REQUIRED' })
  assert.equal(await service.getPackSnapshot({ packId: PHONE_PACK_ID }), null)
  const installed = await service.applyImport({ inspectionId: preview.inspectionId, expectedRevision: preview.expectedRevision, decision: 'install', acceptScriptRisk: true })
  const changed = structuredClone(document); changed.variables.writes.balance.ops.push('replace')
  await assert.rejects(service.patchPack({ packId: PHONE_PACK_ID, expectedRevision: installed.snapshot.revision, fileUpdates: new Map([['bundles/phone/widget.json', jsonBytes(changed)]]) }), { code: 'SCRIPT_CONFIRMATION_REQUIRED' })
  assert.deepEqual((await service.getPackSnapshot({ packId: PHONE_PACK_ID })).widgets.phone.variables, document.variables)
  const copied = await service.copyItems({ sourcePackId: PHONE_PACK_ID, itemRefs: [{ kind: 'widgets', id: 'phone' }], target: { newPackName: 'Accepted variable capability copy' } })
  assert.deepEqual((await service.getPackSnapshot({ packId: copied.packId })).widgets.phone.variables, document.variables)
})
