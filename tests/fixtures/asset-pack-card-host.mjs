import assert from 'node:assert/strict'
import { createPluginHost } from './plugin-host.mjs'
import { createProfileDataStore } from '../../tavern-plugin/lib/profile-data-store.js'
import { resolveTavernDataRoot } from '../../tavern-plugin/lib/domain/tavern-data.js'
import { BUBBLE_WORLDBOOK_COMMENT } from '../../tavern-plugin/lib/domain/dialogue-bubbles.js'
import { createCardPreparation } from '../../tavern-plugin/lib/domain/card-preparation.js'
import { createAssetPackService } from '../../tavern-plugin/packages/dsh-asset-library/src/pack-v2/service.js'
import { writeZip } from '../../tavern-plugin/packages/dsh-asset-library/src/zip.js'
import { jsonBytes } from '../../tavern-plugin/packages/dsh-asset-library/src/pack-v2/validation.js'
import { syntheticPack, cardExtension, PACK_ID, FIGURE_ID } from './asset-packs/pack.mjs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const store = createProfileDataStore({dataRoot:resolveTavernDataRoot()}), prep = createCardPreparation()
const extension = cardExtension()
extension.assetBindings.boundPackIds = [PACK_ID]
// private fork: the selected package grants figure access; no card cast.
const raw = {spec:'chara_card_v3',data:{name:'Original',extensions:{dsh_tavern:extension,foreign:{preserved:true}}}}
await store.writeJson('resources/cards/source.json',prep.create({kind:'import',payload:raw}))
await store.writeJson('resources/cards/target.json',prep.create({kind:'import',payload:{name:'Target'}}))
const host = await createPluginHost()
const adapter = host.services.get('tavernAssetCards')
assert.equal(adapter.apiVersion,2)
const service = createAssetPackService({assetRoot:join(process.env.DSH_HOME,'packs-owner'),cardTransactions:adapter})
try {
  await assert.rejects(adapter.snapshot({path:'../escape.json'}))
  await assert.rejects(adapter.snapshot({path:'cards/missing.json'}),{code:'NOT_FOUND'})
  const pack = await syntheticPack(), zip = join(process.env.DSH_HOME,'input.zip')
  await writeZip(zip,[{path:'manifest.json',data:jsonBytes(pack.manifest)},...[...pack.files].map(([path,data]) => ({path,data}))])
  const inspection = await service.inspectImport({bytes:await readFile(zip)})
  await service.applyImport({inspectionId:inspection.inspectionId,expectedRevision:null,decision:'install'})
  const source = await adapter.snapshot({path:'cards/source.json'})
  const bytes = (await service.exportCardBundle({path:'cards/source.json',expectedRevision:source.revision,packIds:[PACK_ID]})).bytes
  const preview = await service.inspectCardBundle({path:'cards/target.json',bytes})
  const target = await adapter.snapshot({path:'cards/target.json'})
  const result = await service.applyCardBundle({disableWidgets:false, /* private fork: retain exported card preference */ inspectionId:preview.inspectionId,expectedRevision:target.revision,decisions:{[PACK_ID]:'noop'},widgetAcknowledgements:[]})
  assert.equal(result.status,'committed')
  const saved = await adapter.snapshot({path:'cards/target.json'})
  // private fork: production import adds grammar and the figure's sole ID entry; authored raw stays intact.
  const authored = structuredClone(saved.raw)
  const entries = authored.data.character_book.entries
  assert.equal(entries.length,2)
  assert.match(entries[1].content,/Synthetic figure \(fixture\)/)
  assert.equal(entries[0].comment,BUBBLE_WORLDBOOK_COMMENT)
  assert.equal(entries[0].constant,true)
  // private fork: visual sprite IDs never enter the writer emotion vocabulary.
  assert.doesNotMatch(entries[0].content,/soyo_haruhikage/)
  assert.doesNotMatch(entries[0].content,/通用差分/) // private fork: choices moved to the merged figure entry.
  delete authored.data.character_book
  assert.deepEqual(authored,raw); assert.notEqual(saved.revision,target.revision)
  const workspace = await store.readJson('resources/cards/target.json')
  assert.notEqual(workspace.meta.id,(await store.readJson('resources/cards/source.json')).meta.id,'target keeps its own host identity')
  const again = await service.exportCardBundle({path:'cards/target.json',expectedRevision:saved.revision,packIds:[PACK_ID]})
  assert.deepEqual(again.dependencies,[{packId:PACK_ID,contentHash:pack.manifest.contentHash,embedded:true}])
  const repeated = await service.inspectCardBundle({path:'cards/target.json',bytes:again.bytes})
  await service.applyCardBundle({disableWidgets:false, /* private fork: retain exported card preference */ inspectionId:repeated.inspectionId,expectedRevision:saved.revision,decisions:{[PACK_ID]:'noop'},widgetAcknowledgements:[]})
  assert.deepEqual((await adapter.snapshot({path:'cards/target.json'})).raw,saved.raw)
  assert.ok((await store.readJson('card-projection-revisions.json')).cards['cards/target.json'] > 0)
  console.log('production card bundle adapter roundtrip passed')
} finally {await service.dispose(); await host.dispose()}
await assert.rejects(adapter.snapshot({path:'cards/source.json'}),{code:'ASSET_UNAVAILABLE'})
