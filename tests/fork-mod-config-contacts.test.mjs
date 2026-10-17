// private fork (settings-ux r2, owner 2026-10): the phone settings preview resolves its contacts exactly as the stage phone
// does — the stage source's /contacts are the enabled figures of the card's packs (bound + 全局) through the one figure
// catalogue (stage-asset-pack-director phone.characters), keyed by the stage's actor key, each with its figure ref.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { createFirstPartyMods } from '../tavern-plugin/lib/fork-mod-builtins.js'
import { createModConfigHost } from '../tavern-plugin/lib/fork-mod-config-host.js'
import { defaultAssetEngineSettings } from '../tavern-plugin/lib/domain/asset-engine-settings.js'
import { figureCatalogue } from '../tavern-plugin/lib/domain/figure-catalogue.js'

const figure = (id, name, enabled = true) => ({ schemaVersion: 1, id, name, enabled, aliases: [], imageColor: '#c06080', outfits: [] })
const pack = (id, figures) => ({ manifest: { id, name: id, assets: [], figures: figures.map(f => f.id) }, figures: Object.fromEntries(figures.map(f => [f.id, f])), revision: 'r1' })

test('stage source /contacts are the card pack figures as the stage phone lists them', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'mod-contacts-')); t.after(() => rm(root, { recursive: true, force: true }))
  const CARD = '11111111-1111-4111-8111-111111111111', GLOBAL = '22222222-2222-4222-8222-222222222222', OTHER = '33333333-3333-4333-8333-333333333333'
  const snapshots = [pack(CARD, [figure('a1a1a1a1-0000-4000-8000-000000000001', '鹿目圆'), figure('a1a1a1a1-0000-4000-8000-000000000002', '暗影', false)]),
    pack(GLOBAL, [figure('a1a1a1a1-0000-4000-8000-000000000003', '店员')]), pack(OTHER, [figure('a1a1a1a1-0000-4000-8000-000000000004', '路人')])]
  const raw = { spec: 'chara_card_v2', data: { name: '小圆', extensions: { dsh_tavern: { schemaVersion: 1, assetBindings: { boundPackIds: [CARD] } } } } }
  const workspace = { meta: { id: 'card-a', revision: 'c1' }, raw }
  const packs = { apiVersion: 2, registerModPrivate() {}, getPackSnapshot: async ({ packId }) => structuredClone(snapshots.find(p => p.manifest.id === packId)), resolveFigures: async () => [] }
  const builtins = await createFirstPartyMods()
  const host = createModConfigHost({ root, manifests: builtins.catalogue().map(row => builtins.manifest(row.id)), listCards: async () => [{ path: 'a.json', workspace }], readCard: async () => workspace,
    getAssetLibrary: () => packs, readSession: async () => null, readWindow: async () => null, getEngine: () => ({ revision: '0', values: defaultAssetEngineSettings() }), invalidate() {},
    getGlobalEnabledPackIds: () => [GLOBAL] })
  const { sources } = await host.call('listModConfigSources', { cardId: 'card-a' }, { origin: 'http://localhost' })
  const node = sources.find(row => row.id === 'stage').tree.find(row => row.path === '/contacts')
  const read = n => n.children ? Object.fromEntries(n.children.map(child => [child.name, read(child)])) : n.value
  const rows = node.children.map(read)
  const expected = figureCatalogue({ snapshots, bindings: { boundPackIds: [CARD] }, globalEnabledPackIds: [GLOBAL] }).filter(row => row.enabled)
  assert.deepEqual(rows.map(row => [row.id, row.name, row.figure.packId, row.figure.figureId, row.color]), expected.map(row => [row.actorKey, row.name, row.ref.packId, row.ref.figureId, '#c06080']))
  assert.deepEqual(rows.map(row => row.name), ['鹿目圆', '店员'], 'bound and 全局 packs; the disabled figure and an unused pack are not contacts')
  assert.ok(rows.every(row => /^f_[0-9a-f]{16}$/.test(row.id)), 'keyed by the stage actor key, not the name')
})
