// Test-only generic source-mark fixture; never installed or built by production.
// private fork: offline metadata-only maintenance; stop every library writer and back up first.
import assert from 'node:assert/strict'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {createAssetPackService} from '../../../tavern-plugin/packages/dsh-asset-library/src/pack-v2/service.js'
import {PACK_BUDGET} from '../../../tavern-plugin/packages/dsh-asset-library/src/pack-v2/budget.js'
import {decodeMedia} from '../../../tavern-plugin/packages/dsh-asset-library/src/pack-v2/media.js'
import {officialPhonePack, PHONE_PACK_ID, OFFICIAL_WIDGET_CREDITS} from './fork-build-phone-widget.mjs'

export const PREVIOUS_GENERAL_PACK_NAME = '通用小组件'

export async function renameGeneralWidgetsPack({assetRoot}) {
  assert.ok(typeof assetRoot === 'string' && path.isAbsolute(assetRoot), 'Use an explicit absolute assetRoot')
  const service = createAssetPackService({assetRoot,limits:PACK_BUDGET,decodeMedia})
  try {
    const before = await service.getPackSnapshot({packId:PHONE_PACK_ID}), target = await officialPhonePack()
    const phone = before.manifest.assets.find(a => a.kind === 'widgets' && a.id === 'phone')
    const targetPhone = target.manifest.assets.find(a => a.kind === 'widgets' && a.id === 'phone')
    const renamed = before.manifest.name === target.manifest.name && phone?.name === targetPhone.name &&
      before.manifest.credits.includes(OFFICIAL_WIDGET_CREDITS) && !before.manifest.credits.includes('credits/phone.txt')
    const old = before.manifest.name === 'Phone' && phone && before.manifest.credits.includes('credits/phone.txt')
    // private fork (rename-mod, owner 2026-10): the general pack's display name moved from 「通用小组件」 to 「通用模组」;
    // only the name and the credits text change (UUID, members, settings and enabled state stay).
    const previous = before.manifest.name === PREVIOUS_GENERAL_PACK_NAME && phone?.name === targetPhone.name && before.manifest.credits.includes(OFFICIAL_WIDGET_CREDITS)
    assert.ok(renamed || old || previous, 'Unexpected pre-state; inspect the installed widget pack before proceeding')
    const after = renamed ? before : previous ? (await service.patchPack({packId:PHONE_PACK_ID,expectedRevision:before.revision,
      patch:{name:target.manifest.name},fileUpdates:new Map([[OFFICIAL_WIDGET_CREDITS,target.files.get(OFFICIAL_WIDGET_CREDITS)]])})).snapshot :
      (await service.patchPack({packId:PHONE_PACK_ID,expectedRevision:before.revision,
      patch:{name:target.manifest.name,credits:before.manifest.credits.map(credit => credit === 'credits/phone.txt' ? OFFICIAL_WIDGET_CREDITS : credit),
        assets:before.manifest.assets.map(a => a === phone ? {...a,name:targetPhone.name} : a)},
      fileUpdates:new Map([['credits/phone.txt',null],[OFFICIAL_WIDGET_CREDITS,target.files.get(OFFICIAL_WIDGET_CREDITS)]])})).snapshot
    return {changed:!renamed,packId:PHONE_PACK_ID,beforeRevision:before.revision,revision:after.revision,
      beforeContentHash:before.manifest.contentHash,contentHash:after.manifest.contentHash,
      name:after.manifest.name,item:after.manifest.assets.find(a => a.kind === 'widgets' && a.id === 'phone').name,
      matchesOfficialBuild:after.manifest.contentHash === target.manifest.contentHash}
  } finally { await service.dispose() }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.equal(process.argv.length, 3, 'Usage: node bin/fork-rename-general-widgets.mjs <absolute assetRoot>')
  console.log(JSON.stringify(await renameGeneralWidgetsPack({assetRoot:process.argv[2]}),null,2))
}
