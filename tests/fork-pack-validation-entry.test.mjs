import test from 'node:test'
import assert from 'node:assert/strict'
import {PACK_LIMITS, jsonBytes, sealPack, verifyBytes} from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/validation.js'
import {syntheticPack, FIGURE_ID} from './fixtures/asset-packs/pack.mjs'

for (const sealed of [false, true]) {
  test(`pack budgets count the root manifest exactly once (sealed: ${sealed})`, async () => {
    const {manifest, files} = await syntheticPack()
    const manifestSize = jsonBytes(manifest).length
    const total = manifestSize + [...files.values()].reduce((sum, bytes) => sum + bytes.length, 0)
    const limits = {...PACK_LIMITS, entries:files.size + 1, totalSize:total}
    await verifyBytes(manifest, files, {limits, sealed})
    for (const reduced of [{entries:files.size}, {totalSize:total - 1}, {entrySize:manifestSize - 1}]) {
      await assert.rejects(verifyBytes(manifest, files, {limits:{...limits, ...reduced}, sealed}), {code:'LIMIT_EXCEEDED'})
    }
    const unsafe = new Map(files).set('../outside.txt', Buffer.from('unsafe'))
    await assert.rejects(verifyBytes(manifest, unsafe, {sealed}), {code:'INVALID_PATH'})
  })

  test(`entry validation retains manifest and figure closure checks (sealed: ${sealed})`, async () => {
    const {manifest, files, figures} = await syntheticPack()
    await assert.rejects(verifyBytes({...manifest, extra:true}, files, {sealed}), {code:'UNKNOWN_FIELD'})
    const changed = new Map(files), figure = structuredClone(figures[FIGURE_ID])
    // private fork: native own-image bindings must retain media closure, without the retired emotionMap.
    figure.outfits[0].sprite.assets['assets/stage.png'] = 'f'.repeat(64)
    changed.set('figures/' + FIGURE_ID + '.json', jsonBytes(figure))
    // This is a write path: seal new bytes, but do not bypass structural closure.
    await sealPack(manifest, changed)
    await assert.rejects(verifyBytes(manifest, changed, {sealed}), {code:'MISSING_DEPENDENCY'})
  })
}
