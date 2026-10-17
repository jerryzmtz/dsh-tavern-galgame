// private fork: tagged English defaults; retain protocol, payload, cache and budget assertions.
// private fork: assert request-local handles; canonical records retain exact IDs.
import {modelHandle} from './helpers/director-model-call.mjs'
// private fork: opening scenes (docs/fork/card-centric-ux.md 「开场画面」). Greetings are never directed;
// they show a configured or fallback scene at zero token cost, which seeds the first directed turn.
import test from 'node:test'
import {figureActorKey} from '../tavern-plugin/lib/domain/figure-catalogue.js'
// private fork: openings hold FigureRefs; fresh stage keys are derived, never card aliases.
const ACTOR_REF={packId:PACK_ID,figureId:FIGURE_ID}, ABBY_REF={packId:OTHER_PACK_ID,figureId:OTHER_FIGURE_ID}
const AWAY_ID='55555555-5555-4555-8555-555555555555', AWAY_REF={packId:PACK_ID,figureId:AWAY_ID}
const ACTOR=figureActorKey(ACTOR_REF), ABBY=figureActorKey(ABBY_REF)
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {fixture, GREETINGS} from './helpers/stage-director-harness.mjs'
import {runtimeSource, runtimeText, runtimePage} from './helpers/stage-runtime-harness.mjs'
import {syntheticPack, distinctMedia, cardExtension, PACK_ID, FIGURE_ID, OTHER_PACK_ID, OTHER_FIGURE_ID} from './fixtures/asset-packs/pack.mjs'
import {resolveOpeningScene, messageOpeningId, cardGreetings, describeOpeningScenes} from '../tavern-plugin/lib/domain/stage-opening-scene.js'
import {greetingKey} from '../tavern-plugin/lib/domain/card-opening-scenes.js'
import {cardAssetRawOperations} from '../tavern-plugin/lib/domain/card-asset-bindings.js'
import {readStageProjection} from '../tavern-plugin/lib/domain/stage-projection.js'
const require = createRequire(import.meta.url)
const {createStageDirectorSource} = require('../tavern-plugin/src/client/fork-stage-director-source.cjs')
const {createStageRuntimeStore} = require('../tavern-plugin/src/client/fork-stage-runtime-store.cjs')
const {stageRuntimeIndicators} = require('../tavern-plugin/src/client/fork-stage-runtime.cjs')

const clone = value => structuredClone(value)
const ref = (packId, kind, assetId) => ({packId, kind, assetId})
const forbidden = () => { throw new Error('the director must not run for a greeting') }
const readOnly = (f, turn = 1) => f.director.get(f.read(), turn, null, {readOnly:true})
const settle = async () => { for (let i = 0; i < 50; i++) await new Promise(resolve => setImmediate(resolve)) }

// Two packs: the synthetic pack (keyword backgrounds) and a second pack with a constant (blue-lamp) background.
async function assets({bound = [PACK_ID, OTHER_PACK_ID], lead, openings, alternates = GREETINGS.slice(1)} = {}) {
  const pack = await syntheticPack(), other = distinctMedia(pack,'other-pack')
  other.manifest = {...other.manifest, id:OTHER_PACK_ID, figures:[OTHER_FIGURE_ID], assets:[
    {...other.manifest.assets[0], id:'hall', recall:{mode:'constant', keywords:[]}},
    {...other.manifest.assets[2], id:'other-theme'}]}
  other.figures = {[OTHER_FIGURE_ID]:{...other.figures[FIGURE_ID], id:OTHER_FIGURE_ID}} // private fork: only renderable figures can lead
  const extension = {...cardExtension(), ...(openings || lead ? {openings:{...(lead ? {lead} : {}), ...(openings ? {scenes:openings} : {})}} : {})}
  pack.manifest.figures.push(AWAY_ID)
  pack.figures[AWAY_ID]={...distinctMedia(pack.figures[FIGURE_ID],'away-figure'),id:AWAY_ID,name:'Away',aliases:['away'],appearance:'avatar'}
  Object.assign(other.figures[OTHER_FIGURE_ID],{name:'Abby',aliases:['abby']})
  extension.assetBindings.boundPackIds = bound
  const snapshots = [pack, other].map(value => ({...value, revision:'r1'}))
  const assetStatus = Object.fromEntries(snapshots.flatMap(value => value.manifest.assets.map(asset => [`${value.manifest.id}/${asset.kind}/${asset.id}`, {available:!asset.pendingMedia}])))
  return {raw:{name:'Card', first_mes:GREETINGS[0], alternate_greetings:alternates, extensions:{dsh_tavern:extension}},
    snapshots, globalEnabledPackIds:[], assetStatus, engine:{dimensions:{}}}
}

test('a greeting turn never runs the director and never leaves a pending notice', async t => {
  const f = await fixture(forbidden, {greeting:true}); t.after(() => f.dispose())
  // The settlement path asks for the latest turn with generation allowed: still no task.
  const direct = await f.director.get(f.read())
  assert.equal(direct.status, 'done'); await f.director.drain()
  assert.equal(f.calls.length, 0)
  const envelope = await readOnly(f)
  assert.equal(envelope.phase, 'done'); assert.equal(envelope.complete, true); assert.ok(envelope.opening)
  assert.equal(f.read().messages[0].stageDirectionAssetPacks, undefined, 'the opening is derived, never written')
  // The browser source validates it like any record and settles the runtime: no 「正在编排演出…」.
  const runner = createStageDirectorSource({read:args => f.director.get(f.read(), args.turn, null, args), watch:() => () => {}})
  const store = createStageRuntimeStore({runEffect:(...args) => runner.runEffect('session', ...args)})
  t.after(() => { store.dispose(); runner.dispose() })
  store.dispatch({type:'STAGE_OPEN', opened:true})
  store.dispatch({type:'TURN_CHANGED', source:runtimeSource({sessionId:'session'}), text:{...runtimeText(1, [runtimePage(1), runtimePage(2)]), units:envelope.displayUnits}})
  await settle()
  assert.equal(store.getSnapshot().director.phase, 'done')
  assert.equal(stageRuntimeIndicators(store.getSnapshot()).spinner, false)
  assert.equal(store.getSnapshot().pending.error, null)
  assert.ok(store.getSnapshot().projection || store.getSnapshot().director.complete, 'the scene is projected like a directed turn')
  // Projection goes through the live path; there is no stored record to freeze playback against.
  const projected = await readStageProjection({at:1, history:true, expectedDirectionToken:envelope.token, readDirection:() => readOnly(f),
    readConsumer:() => f.assets.consumer(f.read(), 'http://localhost'), readSettings:() => f.engineSettings.read(), revision:() => f.assets.revision,
    readPlayback:() => f.read().messages[0].stagePlaybackV1, writePlayback:forbidden})
  assert.equal(projected.status, 'ready', JSON.stringify(projected))
  assert.deepEqual(projected.value.state.cast, [], 'an unset greeting stages nobody')
  assert.equal(f.calls.length, 0)
})

// private fork (packs-v3): defaults come from the card's bound packs in binding order (no card-owned pack).
test('fallback: theme gradient and nobody on stage regardless of packs; lead and music follow the bound packs in binding order', async () => {
  const fallback = resolveOpeningScene(await assets(), 'primary')
  assert.equal(fallback.configured, false)
  assert.equal(fallback.scene.background, null)
  assert.equal(fallback.state.scene, null)
  assert.deepEqual(fallback.scene.music, ref(PACK_ID, 'music', 'classroom'))
  assert.deepEqual(fallback.lead, ACTOR_REF, 'first blue figure follows effective pack order')
  assert.deepEqual(fallback.state.cast, []); assert.deepEqual(fallback.state.actors, {}); assert.deepEqual(fallback.emotions, {})
  assert.deepEqual(fallback.state.music, ref(PACK_ID, 'music', 'classroom'))
  assert.deepEqual(fallback.state.soundscape, {}, 'no unrelated background ambience')
  const reordered = resolveOpeningScene(await assets({bound:[OTHER_PACK_ID, PACK_ID]}), 'primary')
  assert.equal(reordered.scene.background, null, 'constant backgrounds are not an opening fallback')
  assert.deepEqual(reordered.scene.music, ref(OTHER_PACK_ID, 'music', 'other-theme'), 'first music in binding order')
  assert.deepEqual(reordered.lead, ABBY_REF, 'first renderable figure follows bound pack order')
  assert.deepEqual(resolveOpeningScene(await assets({lead:ABBY_REF}), 'primary').lead, ABBY_REF, 'the card\'s 主角 wins')
  assert.deepEqual(resolveOpeningScene(await assets({lead:AWAY_REF}), 'primary').lead, ACTOR_REF, 'an avatar-only 主角 is ignored')
  const music = await assets(); music.engine.dimensions = {music:false}
  assert.equal(resolveOpeningScene(music, 'primary').state.music, null, 'a disabled dimension is honoured')
})

// private fork: defaults initialize openings; an explicit opening outfit is already story state.
test('opening uses the first enabled figure outfit unless the scene explicitly chooses another outfit', async () => {
  const value = await assets({openings:{primary:{greeting:greetingKey(GREETINGS[0]),background:null,timeOfDay:null,music:null,cast:[{figure:ACTOR_REF,outfitKey:null,emotion:'calm'}]}}})
  value.snapshots[0].figures[FIGURE_ID].outfits.reverse()
  assert.equal(resolveOpeningScene(value, 'primary').state.actors[ACTOR].outfitKey, 'casual')
  const explicit = await assets({openings:{primary:{greeting:greetingKey(GREETINGS[0]),background:null,timeOfDay:null,music:null,cast:[{figure:ACTOR_REF,outfitKey:'school',emotion:'calm'}]}}})
  explicit.snapshots[0].figures[FIGURE_ID].outfits.reverse()
  assert.equal(resolveOpeningScene(explicit, 'primary').state.actors[ACTOR].outfitKey, 'school')
})

test('a configured scene applies to its own greeting and follows it when greetings are reordered', async () => {
  const alternate = {greeting:greetingKey(GREETINGS[1]), background:ref(PACK_ID, 'backgrounds', 'classroom'), timeOfDay:'dusk', music:null,
    cast:[{figure:ABBY_REF, outfitKey:null, emotion:'joy'}, {figure:ACTOR_REF, outfitKey:'casual', emotion:'joy'}]}
  const value = await assets({openings:{'alternate:0':alternate}})
  assert.doesNotThrow(() => cardAssetRawOperations(value.raw, {openings:value.raw.extensions.dsh_tavern.openings}))
  assert.throws(() => cardAssetRawOperations(value.raw, {openings:{scenes:{'alternate:0':{...alternate, cast:[{alias:'a'}]}}}}), /Required field|Unknown field/)
  const scene = resolveOpeningScene(value, 'alternate:0')
  assert.equal(scene.configured, true)
  assert.deepEqual(scene.state.cast, [ABBY, ACTOR], 'order is position (left → right)')
  assert.equal(scene.state.scene.timeOfDay, 'dusk')
  assert.deepEqual(scene.state.lighting.time, {mode:'auto',ref:null})
  assert.equal(scene.state.music, null, 'explicitly silent')
  assert.equal(scene.state.actors[ACTOR].outfitKey, 'casual')
  assert.deepEqual(scene.emotions, {[ABBY]:'joy', [ACTOR]:'joy'})
  assert.equal(resolveOpeningScene(value, 'primary').configured, false, 'other greetings keep the fallback')
  const moved = await assets({openings:{'alternate:0':alternate}, alternates:['A new first alternate.', GREETINGS[1]]})
  assert.equal(resolveOpeningScene(moved, 'alternate:1').configured, true)
  assert.equal(resolveOpeningScene(moved, 'alternate:0').configured, false)
  const edited = await assets({openings:{'alternate:0':alternate}, alternates:['Edited alternate.']})
  assert.equal(resolveOpeningScene(edited, 'alternate:0').configured, true, 'an edited greeting keeps its slot')
  const greetings = cardGreetings(value.raw)
  assert.equal(messageOpeningId({swipes:[...GREETINGS], swipeId:1}, greetings), 'alternate:0')
  assert.equal(messageOpeningId({text:'prepared text', openingId:'alternate:0'}, greetings), 'alternate:0')
  assert.equal(messageOpeningId({sourceText:GREETINGS[0]}, greetings), 'primary')
  const described = describeOpeningScenes(value.raw, value)
  assert.deepEqual(described.lead, ACTOR_REF)
  assert.deepEqual(described.greetings.map(item => [item.id, item.preview]), [['primary', 'Synthetic greeting.'], ['alternate:0', 'Alternate greeting.']])
  assert.equal(described.scenes['alternate:0'].timeOfDay, 'dusk')
  // The director reads the same configuration for a greeting message that shows that alternate.
  const extension = {...cardExtension(), openings:{scenes:{'alternate:0':{...alternate, cast:[{figure:ACTOR_REF, outfitKey:'casual', emotion:'joy'}]}}}}
  const f = await fixture(forbidden, {extension, greeting:{text:GREETINGS[1], sourceText:GREETINGS[1]}})
  try {
    const envelope = await readOnly(f)
    assert.equal(envelope.record.baseline.scene.timeOfDay, 'dusk')
    assert.equal(envelope.record.baseline.actors[ACTOR].outfitKey, 'casual')
    assert.deepEqual(envelope.opening.emotions, {[ACTOR]:'joy'})
  } finally { await f.dispose() }
})

// private fork (owner 2026-10): only a greeting's own scene sets its opening. An unset alternate never borrows the first
// greeting's background, cast or outfits (nor the 主角): theme gradient, nobody on stage, and the director stages the reply.
test('an unset alternate greeting opens empty instead of borrowing the first greeting\'s scene', async () => {
  const primary = {greeting:greetingKey(GREETINGS[0]), background:ref(PACK_ID, 'backgrounds', 'classroom'), timeOfDay:'dusk', music:null,
    cast:[{figure:ACTOR_REF, outfitKey:'casual', emotion:'joy'}]}
  const value = await assets({lead:ACTOR_REF, openings:{primary}})
  assert.deepEqual(resolveOpeningScene(value, 'primary').state.cast, [ACTOR])
  const alternate = resolveOpeningScene(value, 'alternate:0')
  assert.equal(alternate.configured, false)
  assert.equal(alternate.scene.background, null); assert.equal(alternate.state.scene, null)
  assert.deepEqual(alternate.state.cast, []); assert.deepEqual(alternate.state.actors, {}); assert.deepEqual(alternate.emotions, {})
  const f = await fixture(forbidden, {extension:{...cardExtension(), openings:{lead:ACTOR_REF, scenes:{primary}}}, greeting:{text:GREETINGS[1], sourceText:GREETINGS[1], swipes:[...GREETINGS], swipeId:1}})
  try {
    const envelope = await readOnly(f)
    assert.equal(envelope.binding.opening.id, 'alternate:0')
    assert.equal(envelope.record.baseline.scene, null)
    assert.deepEqual(envelope.record.baseline.cast, [])
    assert.deepEqual(envelope.record.baseline.actors, {})
  } finally { await f.dispose() }
})

// The editor's selected greeting is not the chat's selected swipe (MyGO opening regression).
test('a configured primary preview does not apply to another swipe; configure that greeting to stage its background and lead', async () => {
  const background = ref(PACK_ID, 'backgrounds', 'room-asset-7')
  const primary = {greeting:greetingKey(GREETINGS[0]),background,timeOfDay:'dusk',music:null,cast:[]}
  const value = await assets({lead:ACTOR_REF,openings:{primary}})
  const pack = value.snapshots.find(pack => pack.manifest.id === PACK_ID)
  const room = pack.manifest.assets.find(asset => asset.kind === 'backgrounds')
  room.id = background.assetId; room.name = '音乐室'
  value.assetStatus[`${PACK_ID}/backgrounds/${background.assetId}`] = {available:true}
  const selected = messageOpeningId({greeting:true,swipes:[...GREETINGS],swipeId:1,openingId:'alternate:0'},cardGreetings(value.raw))
  const preview = resolveOpeningScene(value,'primary')
  assert.deepEqual(preview.state.scene.background,background)
  assert.equal(preview.state.scene.timeOfDay,'dusk')
  assert.deepEqual(preview.state.cast,[], 'selecting a lead does not put that figure on stage')
  assert.equal(resolveOpeningScene(value,selected).state.scene,null)
  const before = clone(value.raw)
  value.raw.extensions.dsh_tavern.openings.scenes[selected] = {...primary,greeting:greetingKey(GREETINGS[1]),cast:[{figure:ACTOR_REF,outfitKey:null,emotion:'平静'}]}
  const staged = resolveOpeningScene(value,selected)
  assert.deepEqual(staged.state.scene.background,background)
  assert.equal(staged.state.scene.timeOfDay,'dusk')
  assert.deepEqual(staged.state.cast,[ACTOR])
  assert.deepEqual(staged.state.actors[ACTOR].figure,ACTOR_REF)
  assert.deepEqual(value.raw.extensions.dsh_tavern.openings.scenes.primary,before.extensions.dsh_tavern.openings.scenes.primary)
})

test('the first directed turn starts from the opening scene', async t => {
  let carried
  const primary = {greeting:greetingKey(GREETINGS[0]), background:null, timeOfDay:null, music:ref(PACK_ID, 'music', 'classroom'), cast:[{figure:ACTOR_REF, outfitKey:null, emotion:'calm'}]}
  const f = await fixture(async request => {
    carried = JSON.parse(request.messages[0].content[0].text).carried
    assert.equal(JSON.parse(await request.onToolCall({name:'stage_update', arguments:{sequence:1, through:2, done:true, beats:[]}})).ok, true)
  }, {greeting:true, extension:{...cardExtension(), openings:{scenes:{primary}}}})
  t.after(() => f.dispose())
  const opening = (await readOnly(f)).record.baseline
  f.appendReply(2)
  await f.director.get(f.read()); await f.director.drain()
  assert.equal(carried.scene, null)
  assert.deepEqual(carried.cast, [modelHandle(f.calls[0],ACTOR)])
  assert.equal(carried.music,undefined,'BGM is stated once beside the paragraph references')
  assert.match(f.calls[0].messages[0].content.at(-1).text,/^<music_state>\nBGM: Synthetic/)
  const directed = await readOnly(f, 2)
  assert.equal(directed.phase, 'done')
  assert.deepEqual(directed.record.baseline.scene, opening.scene)
  assert.deepEqual(directed.record.end.music,opening.music,'omission keeps opening BGM')
  assert.deepEqual(directed.record.end.cast, [ACTOR], 'no beats: the opening carries through the reply')
  assert.equal(f.read().messages[0].stageDirectionAssetPacks, undefined)
  assert.equal(f.calls.length, 1)
})


test('opening CG editor reads flat variants and omits the picker for single content',async()=>{
  const {readFile}=await import('node:fs/promises'),{runInNewContext}=await import('node:vm')
  const source=await readFile(new URL('../tavern-plugin/src/client/fork-asset-pack-opening-ui.js',import.meta.url),'utf8')
  const {assetVariantRow}=require('../tavern-plugin/packages/dsh-presentation-protocol/src/asset-variant-table.cjs')
  const render=runInNewContext(source.slice(source.indexOf('function openingAssets('),source.indexOf('// @include-protocol'))+source.slice(source.indexOf('function OpeningScene('))+';OpeningScene',{
    OPENING_TIMES:[],OpeningPicker:'OpeningPicker',OpeningBackground:'OpeningBackground',React:{useRef:()=>({current:null})},assetVariantRow,
    h:(type,props,...children)=>({type,props,children}),globalFirst:ids=>ids,
    openingDraft:value=>value,openingStaged:()=>[],openingRefKey:ref=>ref?ref.packId+'/'+ref.assetId:'',
    Segmented:'Segmented',ForkInlineRow:'ForkInlineRow'
  })
  const asset={kind:'cg',id:'still',name:'Still',enabled:true},pack={manifest:{id:PACK_ID,name:'Test',assets:[asset]}}
  const ctx={binding:{globalEnabledPackIds:[]},ext:{assetBindings:{boundPackIds:[PACK_ID]}},writer:{pack:()=>pack}}
  let edited
  const draw=variant=>{
    const fields=new Map(),scene={cast:[],cg:{ref:{packId:PACK_ID,kind:'cg',assetId:'still'},...(variant?{variant}:{})}}
    render({ctx,label:'Opening',scene,onEdit:value=>{edited=value},field:(label,node)=>{fields.set(label,node);return node}})
    return [...fields.values()].find(node=>node.props?.label==='CG \u5dee\u5206')
  }
  assert.equal(draw(),undefined)
  asset.variants={default:'calm',entries:[{id:'calm',name:'Calm',content:{}},{id:'smile',name:'Smile',content:{}}]}
  const picker=draw()
  assert.equal(picker.props.value,'calm')
  assert.deepEqual(Array.from(picker.props.options,row=>[row.value,row.label]),[['calm','Calm'],['smile','Smile']])
  picker.props.onChange('smile');assert.equal(edited.cg.variant,'smile')
  assert.equal(draw('smile').props.value,'smile')
})
