// private fork (outfit usage, owner 2026-10): an outfit's optional 「使用情景」 (`guidance`, ≤ 80 code points) is validated
// once by the pack schema, edits as pack metadata, and reaches the director with the outfit in the same short JSON style as
// a custom 差分's guidance. Absent and empty add 0 bytes; the director switches outfits with the existing outfit.set.
import test from 'node:test'
import assert from 'node:assert/strict'
import { syntheticPack, cardExtension, PACK_ID, FIGURE_ID } from './fixtures/asset-packs/pack.mjs'
import { assetRefKey } from '../tavern-plugin/packages/dsh-presentation-protocol/src/asset-packs.js'
import { validateFigure } from '../tavern-plugin/packages/dsh-asset-library/src/asset-packs/index.js'
import { isMetadataEdit } from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/metadata-edit.js'
import { initialAssetPackStage } from '../tavern-plugin/lib/domain/stage-asset-pack-tools.js'
import { prepareAssetPackDirector, buildAssetPackRequest } from '../tavern-plugin/lib/domain/stage-asset-pack-director.js'

const clone = value => structuredClone(value)
const bytes = text => Buffer.byteLength(text, 'utf8')

test('outfit guidance: optional text up to 80 code points; other unknown outfit fields still fail', async () => {
  const pack = await syntheticPack(), figure = pack.figures[FIGURE_ID]
  const withGuidance = value => { const next = clone(figure); next.outfits[0].guidance = value; return next }
  for (const ok of ['在中转站工作时', '', '鱼'.repeat(80), '😀'.repeat(80)]) assert.doesNotThrow(() => validateFigure(withGuidance(ok)), JSON.stringify(ok))
  for (const bad of ['鱼'.repeat(81), 3, null, '换行\n不行', ['a']]) assert.throws(() => validateFigure(withGuidance(bad)), e => /\.outfits\[0\]\.guidance$/.test(e.path), JSON.stringify(bad))
  const unknown = clone(figure); unknown.outfits[0].usage = '在中转站工作时'
  assert.throws(() => validateFigure(unknown), /Unknown field/)
  assert.doesNotThrow(() => validateFigure(clone(figure)), 'absent means empty: no migration')
})

test('outfit guidance edits are metadata edits; media changes still are not', async () => {
  const pack = await syntheticPack(), before = {manifest:pack.manifest, figures:pack.figures}
  const figures = clone(pack.figures); figures[FIGURE_ID].outfits[1].guidance = '在中转站工作时'
  assert.equal(isMetadataEdit(before, pack.manifest, figures), true)
  const media = clone(figures); media[FIGURE_ID].outfits[1].live2d.bundleKey = 'other'
  assert.equal(isMetadataEdit(before, pack.manifest, media), false)
})

async function prepare(edit = () => {}) {
  const first = await syntheticPack()
  edit(first.figures[FIGURE_ID])
  const snapshots = [{manifest:first.manifest, figures:first.figures, widgets:first.widgets, sprites:first.sprites, revision:'r0'}]
  const assetStatus = {}, widgetAuthorizations = {}
  for (const asset of first.manifest.assets) {
    const key = assetRefKey({packId:PACK_ID, kind:asset.kind, assetId:asset.id})
    assetStatus[key] = {available:true, executableDigest:'a'.repeat(64)}; widgetAuthorizations[key] = 'a'.repeat(64)
  }
  const extension = cardExtension(); extension.assetBindings.boundPackIds = [PACK_ID]
  return prepareAssetPackDirector({snapshots, assetStatus, raw:{extensions:{dsh_tavern:extension}}, cardRevision:'card-1', engine:{widgetAuthorizations, widgetsEnabled:true},
    target:{sourceKey:'reply-1', branchId:'branch-1', revision:1}, units:['她在中转站上班。', '有人骂她笨蛋。'],
    baseline:initialAssetPackStage({actor:{figure:{packId:PACK_ID, figureId:FIGURE_ID}, outfits:[]}})})
}
const outfitRows = request => {
  const sections = Object.fromEntries(request.sections.filter(s => /^(actors|outfits)/.test(s.key)).map(s => [s.key, JSON.parse(s.text)]))
  return Object.fromEntries(Object.entries(sections).map(([key, value]) => [key, Object.values(value).flatMap(row => Array.isArray(row) ? row : row.outfits || [])]))
}

test('director catalogue carries each outfit guidance verbatim, like a custom 差分; empty adds 0 bytes', async () => {
  const plain = buildAssetPackRequest(await prepare(), true, undefined, '', true)
  const empty = buildAssetPackRequest(await prepare(f => { f.outfits[0].guidance = '' }), true, undefined, '', true)
  assert.equal(JSON.stringify(empty.messages), JSON.stringify(plain.messages)); assert.equal(empty.system, plain.system); assert.equal(empty.inputBytes, plain.inputBytes)
  const filled = buildAssetPackRequest(await prepare(f => { f.outfits[0].guidance = '默认，日常'; f.outfits[1].guidance = '在中转站工作时' }), true, undefined, '', true)
  const rows = outfitRows(filled)['actors.constant']
  assert.deepEqual(rows.map(({label, guidance}) => [label, guidance]), [['School', '默认，日常'], ['Casual', '在中转站工作时']])
  // Short and stable: exactly `"guidance":"…",` per filled outfit, nowhere else (the canonical JSON sorts keys); the
  // fixed catalogue sits inside the system string, so the wire escapes its quotes.
  const added = ['默认，日常', '在中转站工作时'].reduce((sum, text) => sum + bytes(JSON.stringify(JSON.stringify({guidance:text}).slice(1, -1) + ',')) - 2, 0)
  assert.equal(filled.inputBytes - plain.inputBytes, added)
  assert.match(filled.sections.find(s => s.key === 'actors.constant').text, /"guidance":"默认，日常","key":"[^"]+","label":"School"/ /* private fork: declared differences share the outfit object */)
  assert.equal(filled.messages.flatMap(m => m.content).map(p => p.text).join('\n').split('在中转站工作时').length + filled.system.split('在中转站工作时').length - 2, 1, 'sent once')
})

test('a green-lamp outfit carries its guidance in the turn outfits when recalled; outfit.set switches to it', async () => {
  const prepared = await prepare(f => { f.outfits[1].recall = {mode:'keyword', keywords:['中转站']}; f.outfits[1].guidance = '在中转站工作时' })
  const request = buildAssetPackRequest(prepared, true, undefined, '', true)
  assert.deepEqual(outfitRows(request).outfits.map(({label, guidance}) => [label, guidance]), [['Casual', '在中转站工作时']])
  const command = request.commands.find(c => c.name === 'actor.outfit.set')
  assert.ok(command?.enabled, 'the existing outfit.set command switches outfits')
  const missed = buildAssetPackRequest(await prepare(f => { f.outfits[1].recall = {mode:'keyword', keywords:['别处']}; f.outfits[1].guidance = '在中转站工作时' }), true, undefined, '', true)
  assert.equal(JSON.stringify(missed).includes('在中转站工作时'), false, 'an outfit not offered this turn sends nothing')
})
