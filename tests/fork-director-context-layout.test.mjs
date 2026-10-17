// private fork: tagged English defaults; retain protocol, payload, cache and budget assertions.
// Fixed catalogue data and command grammar precede this turn's capabilities.
import test from 'node:test'
import assert from 'node:assert/strict'
import {syntheticPack, cardExtension, PACK_ID,distinctMedia} from './fixtures/asset-packs/pack.mjs'
import { assetRefKey } from '../tavern-plugin/packages/dsh-presentation-protocol/src/asset-packs.js'
import { prepareAssetPackDirector, buildAssetPackRequest } from '../tavern-plugin/lib/domain/stage-asset-pack-director.js'
import { directorPromptData } from './fixtures/asset-packs/prompt.mjs'
const reverseKeys = value => Array.isArray(value) ? value.map(reverseKeys) : value && typeof value === 'object'
  ? Object.fromEntries(Object.entries(value).reverse().map(([key, child]) => [key, reverseKeys(child)])) : value

for (const incremental of [true, false]) test(`director ${incremental ? 'incremental' : 'v3'}: fixed bytes precede green recall, carry, performance and reply`, async t => {
  const pack = await syntheticPack()
  const music = pack.manifest.assets.find(asset => asset.kind === 'music')
  music.name = 'green-song'; music.recall = {mode:'keyword', keywords:['handgun']}
  const sound = pack.manifest.assets.find(asset => asset.kind === 'sfx')
  sound.name = 'green-gun'; sound.recall = { mode: 'keyword', keywords: ['handgun'] }
  const engineSound = { ...structuredClone(sound), id: 'engine', name: 'green-engine', recall: { mode: 'keyword', keywords: ['racing'] } }
  pack.manifest.assets.push(distinctMedia(engineSound,'engine'))
  const status = Object.fromEntries(pack.manifest.assets.map(asset => [assetRefKey({ packId: PACK_ID, kind: asset.kind, assetId: asset.id }), { available: true }]))
  const common = { snapshots: [{ manifest: pack.manifest, figures: Object.values(pack.figures), revision: 'pack-r1' }], assetStatus: status,
    raw: { extensions: { dsh_tavern: cardExtension() } }, cardRevision: 'card-r1', engine: {} // private fork: catalogues are always trigger-only.
 }
  const a = prepareAssetPackDirector({ ...common, target: { sourceKey: 'reply-1', branchId: 'b', revision: 1 }, units: ['handgun'] })
  const b = structuredClone(prepareAssetPackDirector({ ...reverseKeys(common), target: { sourceKey: 'reply-2', branchId: 'b', revision: 2 }, units: ['racing', 'another paragraph'] }))
  b.baseline.weather = 'rain'
  b.context.catalogue.candidates.music = []
  b.context.catalogue.candidates.performances.push({ ref: { packId: PACK_ID, kind: 'performances', assetId: 'volatile' }, asset:{name:'Volatile'}, performanceLevels: [1], performanceDefault: 1, performanceNote: 'PERFORMANCE TURN TWO' })
  const first = buildAssetPackRequest(a, incremental, undefined, '', true), second = buildAssetPackRequest(b, incremental, undefined, '', true)
  assert.equal(second.system,first.system)
  assert.match(second.system,/<director_role>/)
  assert.ok(!directorPromptData(second).allowedCommands.includes('music.set'))
  assert.doesNotMatch(first.system,/director_commands|Ops \(noun:verbs\)/,'tool schema is the only installed command index')
  assert.match(JSON.stringify(first.tools), /music\.set/)
  // private fork: tools are grammar, not a per-turn catalogue/authorization list.
  assert.deepEqual(second.tools,first.tools) // Current choices are tail data, never tool enums.
  assert.doesNotMatch(first.system, /green-song/)
  assert.doesNotMatch(first.system, /green-gun|green-engine|handgun|racing|PERFORMANCE TURN TWO|reply-1|pack-r1/)
  assert.match(JSON.stringify(first.messages), /green-gun/)
  assert.doesNotMatch(JSON.stringify(first.messages), /green-engine/)
  assert.match(JSON.stringify(second.messages), /green-engine|PERFORMANCE TURN TWO/)
  assert.doesNotMatch(JSON.stringify(second.messages), /green-gun/)
  const fixed = JSON.parse(first.system.split('<stage_assets>\n').at(-1).split('\n')[1])
  assert.ok(fixed.actors)
  assert.ok(fixed.catalogue.looks.length)
  const data = directorPromptData(second)
  assert.equal(data.carried.weather, 'rain')
  // private fork: production replies now carry absolute anchors, including streaming windows.
  assert.deepEqual(data.reply, [{at:1,text:'racing'}, {at:2,text:'another paragraph'}])
  assert.equal(buildAssetPackRequest(reverseKeys(b), incremental).system, second.system)
  assert.ok(second.sections.some(section => section.source.placement === 'constant'))
  assert.ok(second.sections.some(section => section.source.placement === 'turn'))
  t.diagnostic(JSON.stringify({ incremental, systemBytes: [first,second].map(request=>Buffer.byteLength(request.system)),
    toolSchemaBytes: [first, second].map(request => Buffer.byteLength(JSON.stringify(request.tools))),
    volatileBytes: [first, second].map(request => Buffer.byteLength(JSON.stringify(request.messages))) }))
})
