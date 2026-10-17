import test from 'node:test'
import assert from 'node:assert/strict'
import {syntheticPack,distinctMedia,PACK_ID,OTHER_PACK_ID,FIGURE_ID,OTHER_FIGURE_ID} from './fixtures/asset-packs/pack.mjs'
import {listEffectiveAssets} from '../tavern-plugin/lib/domain/effective-assets.js'
import {figureCatalogue,figureActorKey,resolution} from '../tavern-plugin/lib/domain/figure-catalogue.js'
import {recallAssetPacks} from '../tavern-plugin/lib/domain/stage-asset-pack-catalogue.js'
import {prepareAssetPackDirector,buildAssetPackRequest,createAssetPackTransaction,readAssetPackRecord} from '../tavern-plugin/lib/domain/stage-asset-pack-director.js'
import {cardBubbleConfig} from '../tavern-plugin/lib/fork-card-stage.js'
import {defaultAssetEngineSettings} from '../tavern-plugin/lib/domain/asset-engine-settings.js'
import {initialAssetPackStage} from '../tavern-plugin/lib/domain/stage-asset-pack-tools.js'
import {createAssetPackPresentation} from '../tavern-plugin/lib/domain/asset-pack-presentation.js'
import {assetRefKey} from '../tavern-plugin/packages/dsh-presentation-protocol/src/asset-packs.js'
import {resolveOpeningScene,cardGreetings} from '../tavern-plugin/lib/domain/stage-opening-scene.js'
import {validateAsset} from '../tavern-plugin/packages/dsh-asset-library/src/asset-packs/manifest.js'
import {validateFigure} from '../tavern-plugin/packages/dsh-asset-library/src/asset-packs/figure.js'

async function duplicatedPackFixture() {
  const source = await syntheticPack(), copy = structuredClone(source)
  source.revision = 'source-1'; copy.revision = 'copy-1'; copy.manifest.id = OTHER_PACK_ID
  source.manifest.assets = source.manifest.assets.filter(asset => asset.kind === 'backgrounds' && asset.variants?.entries[0].content.media)
  copy.manifest.assets = structuredClone(source.manifest.assets)
  source.manifest.assets[0].name = '教室'; copy.manifest.assets[0].id = 'room-copy'
  for (const pack of [source,copy]) pack.manifest.assets[0].recall = {mode:'constant',keywords:[]}
  source.figures[FIGURE_ID].name = '傲娇黑长直'; source.figures[FIGURE_ID].aliases = []
  copy.manifest.figures = [OTHER_FIGURE_ID]
  copy.figures = {[OTHER_FIGURE_ID]:{...structuredClone(source.figures[FIGURE_ID]),id:OTHER_FIGURE_ID,name:'小红'}}
  const snapshots = [source,copy], boundPackIds = [OTHER_PACK_ID], globalEnabledPackIds = [PACK_ID]
  const assetStatus = Object.fromEntries(snapshots.flatMap(pack => pack.manifest.assets.map(asset => [assetRefKey({packId:pack.manifest.id,kind:asset.kind,assetId:asset.id}),{available:true}])))
  const engine = defaultAssetEngineSettings()
  return {snapshots,boundPackIds,globalEnabledPackIds,assetStatus,engine,
    raw:{first_mes:'Hello.',extensions:{dsh_tavern:{schemaVersion:1,assetBindings:{boundPackIds}}}},
    cardRevision:'card-1',target:{sourceKey:'reply-1',branchId:'branch-1',revision:1},units:['无关的叙述。']}
}

const figureSource = {packId:PACK_ID,figureId:FIGURE_ID}
const figureCopy = {packId:OTHER_PACK_ID,figureId:OTHER_FIGURE_ID}
function copiedFigure(f) {
  const figure = f.snapshots[1].figures[OTHER_FIGURE_ID]
  figure.extensions = {dsh_tavern:{copiedFrom:figureSource}}
  return figure
}

test('same media across enabled packs lists once, with blue > green > off before recall and diagnostics',async () => {
  const f = await duplicatedPackFixture(), source = f.snapshots[0].manifest.assets[0], copy = f.snapshots[1].manifest.assets[0]
  assert.notEqual(source.id,source.name); assert.notEqual(copy.id,copy.name)
  source.recall.mode = 'keyword'
  let catalogue = recallAssetPacks(f)
  assert.equal(catalogue.candidates.backgrounds.length,1)
  assert.equal(catalogue.rows.length,1)
  assert.equal(catalogue.candidates.backgrounds[0].ref.packId,OTHER_PACK_ID)
  assert.deepEqual(catalogue.candidates.backgrounds[0].reasons,['constant'])
  assert.equal(listEffectiveAssets(f).filter(row => row.ref.kind === 'backgrounds').length,1)
  copy.enabled = false; source.recall.mode = 'constant'
  catalogue = recallAssetPacks(f)
  assert.equal(catalogue.candidates.backgrounds.length,1)
  assert.equal(catalogue.candidates.backgrounds[0].ref.packId,PACK_ID)
  source.enabled = false
  assert.equal(recallAssetPacks(f).candidates.backgrounds.length,0)
})

test('bound copiedFrom wins entirely even after new media, and off never revives its blue source',async () => {
  const f = await duplicatedPackFixture(), copy = copiedFigure(f)
  Object.assign(copy,distinctMedia(copy,'custom-art'))
  copy.recall.mode = 'keyword'; copy.aliases = ['紅醬']; copy.heightCm = 171
  const rows = figureCatalogue({snapshots:f.snapshots,bindings:{boundPackIds:f.boundPackIds},globalEnabledPackIds:f.globalEnabledPackIds})
  assert.equal(rows.length,1); assert.equal(rows[0].name,'小红'); assert.equal(rows[0].figure.heightCm,171)
  assert.equal(resolution.resolveFigureName(rows,'紅醬').ref.figureId,OTHER_FIGURE_ID)
  assert.equal(resolution.resolveFigureName(rows,'傲娇黑长直').status,'unknown')
  assert.deepEqual(resolution.resolveFigureName(rows,figureSource).ref,figureCopy)
  const untriggered = prepareAssetPackDirector(f)
  assert.equal(Object.keys(untriggered.context.actors).length,0)
  copy.enabled = false
  assert.equal(figureCatalogue({snapshots:f.snapshots,bindings:{boundPackIds:f.boundPackIds},globalEnabledPackIds:f.globalEnabledPackIds})[0].enabled,false)
  assert.equal(Object.keys(prepareAssetPackDirector(f).context.actors).length,0)
  const config = cardBubbleConfig(f.raw,f.engine,f.snapshots,f.globalEnabledPackIds)
  assert.equal(config.characters.length,0)
  const independent=await duplicatedPackFixture()
  copiedFigure(independent).extensions.dsh_tavern.copiedFrom={packId:'33333333-3333-4333-8333-333333333333',figureId:FIGURE_ID}
  assert.equal(listEffectiveAssets(independent).filter(row=>row.ref.figureId).length,2,'known distinct provenance takes priority over coincidentally identical media')
})

test('renamed card copy is the only prompt/enum/foreground candidate; old record refs retain persistent state',async () => {
  const f = await duplicatedPackFixture(), copy = copiedFigure(f), actor = figureActorKey(figureSource)
  f.baseline = initialAssetPackStage({[actor]:{figure:figureSource,outfits:[{key:'casual',enabled:true}]}})
  f.baseline.actors[actor].gaze = 'away'; f.baseline.cast = [actor]
  const before = structuredClone(f.baseline), prepared = prepareAssetPackDirector(f)
  assert.deepEqual(f.baseline,before,'projection never rewrites history')
  assert.deepEqual(prepared.baseline.actors[actor].figure,figureCopy)
  assert.equal(prepared.baseline.actors[actor].outfitKey,'casual')
  assert.equal(prepared.baseline.actors[actor].gaze,'away')
  const request = buildAssetPackRequest(prepared,true,undefined,'',true)
  const wire = JSON.stringify({system:request.system,messages:request.messages,tools:request.tools})
  assert.match(wire,/小红/); assert.doesNotMatch(wire,/傲娇黑长直/)
  assert.equal(Object.keys(prepared.context.actors).length,1)
  const enums = value => { if (!value || typeof value !== 'object') return; if (Array.isArray(value.enum)) assert.equal(new Set(value.enum.map(v => JSON.stringify(v))).size,value.enum.length); Object.values(value).forEach(enums) }
  enums(request.tools)
  const config = cardBubbleConfig(f.raw,f.engine,f.snapshots,f.globalEnabledPackIds)
  assert.deepEqual(config.characters.map(row => row.name),['小红'])
  const tx = createAssetPackTransaction({prepared,getCurrentBinding:() => prepared.binding})
  assert.equal(tx.submit({sequence:1,through:1,done:true,beats:[]}).ok,true)
  assert.deepEqual(readAssetPackRecord(tx.effect()).end.actors[actor].figure,figureCopy)
  const service = {apiVersion:2,subscribe:() => () => {},getPackSnapshot:async ({packId}) => f.snapshots.find(p => p.manifest.id === packId),
    resolveFigures:async ({refs}) => refs.map(ref => ({ref,value:copy,revision:'copy-1',diagnostics:[]}))}
  const presentation = createAssetPackPresentation({raw:f.raw,getEngine:() => f.engine,getService:() => service,getAllowedPackIds:() => [PACK_ID,OTHER_PACK_ID],origin:'http://localhost',scope:'test'})
  try {
    const result = await presentation.character(actor,{actor:before.actors[actor],historical:true})
    assert.deepEqual(result.ref,figureCopy)
    assert.equal(result.outfitKey,'casual')
  } finally {presentation.dispose()}
})

test('opening refs use the same resolver and copy origin is checked at ingress',async () => {
  const f = await duplicatedPackFixture(), copy = copiedFigure(f)
  f.raw.extensions.dsh_tavern.openings = {lead:figureSource,scenes:{primary:{greeting:cardGreetings(f.raw)[0].key,background:null,timeOfDay:null,music:null,
    cast:[{figure:figureSource,outfitKey:'casual',emotion:'calm'}]}}}
  const opening = resolveOpeningScene(f,'primary')
  assert.deepEqual(opening.lead,figureCopy)
  assert.equal(opening.state.cast.length,1)
  assert.deepEqual(opening.state.actors[opening.state.cast[0]].figure,figureCopy)
  assert.throws(() => validateFigure({...copy,extensions:{dsh_tavern:{copiedFrom:{packId:PACK_ID,figureId:'display-name'}}}}))
  const asset = f.snapshots[0].manifest.assets[0]
  assert.throws(() => validateAsset({...asset,extensions:{dsh_tavern:{copiedFrom:{packId:PACK_ID,kind:'music',assetId:asset.id}}}}))
})

test('deduplicated prompt sections and installed tool schemas never grow',async t => {
  const f = await duplicatedPackFixture()
  const unmerged = {...f,snapshots:[f.snapshots[0],distinctMedia(f.snapshots[1],'independent-art')]}
  const before = buildAssetPackRequest(prepareAssetPackDirector(unmerged),true,undefined,'',true)
  const after = buildAssetPackRequest(prepareAssetPackDirector(f),true,undefined,'',true)
  const sections = request => request.sections.reduce((out,row) => {
    const key = row.key.startsWith('catalogue.') ? row.key.split('.').slice(0,2).join('.') : row.key
    out[key] = (out[key] || 0) + row.bytes; return out
  },{})
  const oldSections = sections(before), newSections = sections(after)
  for (const [key,bytes] of Object.entries(newSections)) assert.ok(bytes <= oldSections[key],key)
  const toolSchemaBytes = request => Buffer.byteLength(JSON.stringify(request.tools))
  assert.ok(toolSchemaBytes(after) <= toolSchemaBytes(before))
  assert.ok(after.inputBytes < before.inputBytes)
  t.diagnostic(JSON.stringify({before:oldSections,after:newSections,toolSchemaBytes:[toolSchemaBytes(before),toolSchemaBytes(after)]}))
})

test('judge asks once for independent green duplicates and no longer sees a shadowed source name',async () => {
  const f = await duplicatedPackFixture()
  copiedFigure(f).recall.mode = 'keyword'
  f.snapshots[0].manifest.assets[0].recall.mode = f.snapshots[1].manifest.assets[0].recall.mode = 'keyword'
  f.engine.judge = {...f.engine.judge,enabled:true,provider:'test',model:'judge'}
  const prepared = prepareAssetPackDirector(f)
  assert.equal(prepared.judgeQuestions.filter(q => q.kind === 'backgrounds').length,1)
  assert.equal(prepared.judgeQuestions.filter(q => q.kind === 'figures').length,1)
  assert.doesNotMatch(JSON.stringify(prepared.judgeQuestions),/傲娇黑长直/)
})
