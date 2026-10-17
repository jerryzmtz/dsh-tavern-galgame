// private fork: tagged English defaults; retain protocol, payload, cache and budget assertions.
// private fork: historical vocabulary is fixture data, not a runtime default.
// private fork: sprite/avatar variant labels use the owner term chafen.
// private fork: include source literally, without String.replace replacement-token expansion.
// private fork: the writer and all bubble consumers use the bound figure, not cast overrides.
import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import {readFile} from 'node:fs/promises'
import {cardBubbleConfig} from '../tavern-plugin/lib/fork-card-stage.js'
import {bubbleInstructionPreview, bubbleInjection, effectiveBubbleMoods, normalizeBubbleConfig, resolveBubbleMood} from '../tavern-plugin/lib/domain/dialogue-bubbles.js' // private fork (r7): bubbleInjection
import {defaultAssetEngineSettings} from '../tavern-plugin/lib/domain/asset-engine-settings.js'
import {prepareAssetPackDirector, buildAssetPackRequest} from '../tavern-plugin/lib/domain/stage-asset-pack-director.js'
import {cardExtension, syntheticPack, FIGURE_ID,distinctMedia} from './fixtures/asset-packs/pack.mjs'
import builtins from '../tests/fixtures/legacy-dialogue-moods.json' with {type:'json'}

async function fixture() {
  const pack = await syntheticPack(), extension = cardExtension(), engine = defaultAssetEngineSettings()
  pack.revision = 'fixture-revision'
  extension.assetBindings.boundPackIds = [pack.manifest.id]
  extension.stage = {}; engine.stageToggles.voice = false
  return {pack, extension, engine, raw:{extensions:{dsh_tavern:extension}}}
}
const bytes = preview => Object.fromEntries([['total', Buffer.byteLength(preview.instruction)], ...preview.sections.map(({key,text}) => [key,Buffer.byteLength(text)])])

test('empty guidance is free; labelled declarations appear only in the owning alias row', async () => {
  const {pack,raw,extension,engine} = await fixture(), figure = pack.figures[FIGURE_ID]
  // private fork: additional speaker metadata belongs to an independent figure.
  const otherId='44444444-4444-4444-8444-444444444444'
  pack.manifest.figures.push(otherId);pack.figures[otherId]=distinctMedia({...structuredClone(figure),id:otherId,name:'Other',aliases:['other'],appearance:'avatar'},otherId)
  const preview = () => bubbleInstructionPreview(cardBubbleConfig(raw,engine,[pack]))
  figure.emotions=[{id:'joy',label:'喜悦'}];figure.outfits.forEach(o=>o.defaultEmotion='joy');pack.figures[otherId].emotions=[];pack.figures[otherId].outfits.forEach(o=>delete o.defaultEmotion); // private fork
  const empty = preview()
  figure.emotions = [{id:'joy',label:'喜悦',guidance:'  '}]
  assert.equal(preview().instruction,empty.instruction)
  figure.emotions = [{id:'joy',label:'喜悦',guidance:'轻声笑'}, {id:'proud',label:'得意',guidance:'不抬高音量'}]
  figure.imageColor = '#AABBCC'
  const config = cardBubbleConfig(raw,engine,[pack]), filled = preview()
  assert.equal(config.characters[0].color,'#aabbcc')
  assert.match(filled.instruction, /Synthetic figure \(fixture\): 喜悦（轻声笑）、得意（不抬高音量）/)
  assert.match(filled.instruction, /Other \(other\):(?:\n|$)/)
  assert.doesNotMatch(filled.sections.find(row => row.key === 'emotions').text, /得意|轻声笑|不抬高音量/)
  assert.equal(resolveBubbleMood('得意',config,'actor')?.id,'proud')
  assert.equal(resolveBubbleMood('得意',config,'other'),null)
  const delta = Object.fromEntries(Object.entries(bytes(filled)).map(([key,n]) => [key,n-bytes(empty)[key]]))
  assert.deepEqual(delta,{total:45,format:0,voice:0,emotions:0,characters:45,extra:0}) // private fork
  assert.deepEqual(normalizeBubbleConfig(config).characters[0].emotions,figure.emotions)
  assert.ok(Object.hasOwn(config.characters[0].avatarMedia.moods,'proud'))
  assert.ok(!Object.hasOwn(config.characters[1].avatarMedia.moods,'proud'))
})

test('same ID in two figures stays local and declared figure vocabularies exclude engine globals', async () => {
  const {pack,raw,extension,engine} = await fixture(), figure = pack.figures[FIGURE_ID]
  const secondId = '44444444-4444-4444-8444-444444444444'
  pack.figures[secondId] = distinctMedia({...structuredClone(figure), id:secondId, emotions:[{id:'proud',label:'端庄'}]},secondId)
  figure.emotions = [{id:'proud',label:'得意'}]
  pack.manifest.figures.push(secondId)
  Object.assign(pack.figures[secondId],{name:'Other',aliases:['other'],appearance:'avatar'})
  engine.dialogue.emotions = [{id:'global',label:'全局'}, {id:'proud',label:'公共'}]
  engine.stageToggles.voice = true
  const config = cardBubbleConfig(raw,engine,[pack])
  assert.equal(resolveBubbleMood('全局',config,'actor'),null) // private fork
  assert.equal(resolveBubbleMood('得意',config,'actor')?.id,'proud')
  assert.equal(resolveBubbleMood('端庄',config,'other')?.id,'proud')
  assert.equal(resolveBubbleMood('端庄',config,'actor'),null)
  assert.equal(resolveBubbleMood('公共',config,'actor'),null)
  const script = (await readFile(new URL('../tavern-plugin/src/client/fork-bubbles.js',import.meta.url),'utf8'))
    .split('// Per-session bubble settings')[0]
    .split('// @include fork-bubble-line.cjs').join(await readFile(new URL('../tavern-plugin/src/client/fork-bubble-line.cjs',import.meta.url),'utf8'))
    .replace('__TAVERN_BUBBLE_MOODS__',JSON.stringify(builtins))
  const browser = vm.createContext({config,require:()=>assert.fail('browser must use the inlined resolver')})
  vm.runInContext(await readFile(new URL('../tavern-plugin/packages/dsh-presentation-protocol/src/figure-resolution.cjs',import.meta.url),'utf8'),browser)
  vm.runInContext(script,browser)
  const voiceSource = await readFile(new URL('../tavern-plugin/src/client/fork-voice.js',import.meta.url),'utf8')
  vm.runInContext(voiceSource.slice(voiceSource.indexOf('function forkPackSpeechInput'),voiceSource.indexOf('// private fork: native handles')),browser)
  assert.equal(vm.runInContext("forkPackSpeechInput({kind:'bubble',alias:'actor',mood:'得意',speech:'spoken'},config).mood",browser),'proud')
  assert.equal(vm.runInContext("forkPackSpeechInput({kind:'bubble',alias:'other',mood:'得意',speech:'spoken'},config).mood",browser),'calm')
  assert.equal(vm.runInContext("forkPackSpeechInput({kind:'bubble',alias:'other',mood:'端庄',speech:'spoken'},config).mood",browser),'proud')
  for (const alias of ['actor','other']) {
    browser.alias = alias
    assert.deepEqual(JSON.parse(vm.runInContext('JSON.stringify(forkBubbleMoodList(config,alias).map(row => [row.id,row.label]))',browser)),effectiveBubbleMoods(config,alias).map(row => [row.id,row.label]))
  }
})

test('manual overrides derived colour; removing the manual value restores automatic without changing voice identity', async () => {
  const {pack,raw,engine} = await fixture(),figure=pack.figures[FIGURE_ID]
  const get=()=>cardBubbleConfig(raw,engine,[pack]).characters[0]
  const voiceKey=get().voiceKey
  figure.autoColor='#9EA0D7';assert.equal(get().color,'#9ea0d7')
  figure.imageColor='#123456';assert.equal(get().color,'#123456')
  delete figure.imageColor;assert.equal(get().color,'#9ea0d7');assert.equal(get().voiceKey,voiceKey)
  delete figure.autoColor;assert.equal(get().color,'')
})

test('missing/disabled figures never lend color, guidance or voice; normalization does not revive removed cast defaults', async () => {
  const {pack,raw,engine} = await fixture(), figure = pack.figures[FIGURE_ID]
  figure.imageColor = '#123456'; figure.emotions = [{id:'joy',label:'喜悦',guidance:'Only owner'}]
  figure.enabled = false
  const config = cardBubbleConfig(raw,engine,[pack])
  assert.deepEqual(config.characters,[]) // private fork: disabled figures do not create fallback card rows.
  const normalized = normalizeBubbleConfig({characters:[{alias:'homura',note:'obsolete',offstage:true}], stage:{protagonist:'homura'}})
  assert.equal(normalized.characters[0].voice,'')
  assert.ok(!Object.hasOwn(normalized.characters[0],'note'))
  assert.ok(!Object.hasOwn(normalized.characters[0],'offstage'))
  assert.ok(!Object.hasOwn(normalized.stage,'protagonist'))
})

test('director leaves character emotion guidance to the writer without per-outfit annotations', async () => {
  const {pack,raw,engine} = await fixture()
  const request = () => buildAssetPackRequest(prepareAssetPackDirector({raw,cardRevision:'card-1',snapshots:[pack],engine,
    target:{sourceKey:'reply-1',branchId:'branch-1',revision:1},units:['Synthetic fixture.'],assetStatus:{}}),true,undefined,'',true)
  const before = request()
  pack.figures[FIGURE_ID].emotions = [{id:'joy',label:'喜悦',guidance:'轻声笑'}, {id:'proud',label:'得意',guidance:'不抬高音量'}]
  pack.figures[FIGURE_ID].autoColor = '#9ea0d7' // private fork: presentation-only; zero director bytes.
  const after = request()
  assert.deepEqual(after.sections.filter(row=>row.key!=='actors.constant'),before.sections.filter(row=>row.key!=='actors.constant')) // private fork
  assert.deepEqual(after.sections,before.sections)
  assert.doesNotMatch(after.sections.find(row=>row.key==='actors.constant').text,/喜悦|得意|differences/)
  assert.deepEqual(after.tools,before.tools)
  assert.ok(after.inputBytes<=before.inputBytes*1.1) // private fork
})

test('voice library and tuning add zero director prefix or total request bytes',async()=>{
  const {pack,raw,engine}=await fixture()
  const request=()=>buildAssetPackRequest(prepareAssetPackDirector({raw,cardRevision:'card-1',snapshots:[pack],engine,target:{sourceKey:'reply-1',branchId:'branch-1',revision:1},units:['Synthetic fixture.'],assetStatus:{}}),true,undefined,'',true)
  const before=request(),voice=pack.manifest.voiceLibrary.voices[pack.figures[FIGURE_ID].voice.voice]
  voice.variants={normal:{tuning:{fish:{speed:1}}},quick:{name:'Quick',tuning:{fish:{speed:1.2}}}}
  pack.figures[FIGURE_ID].voice.variant='quick'
  voice.sources.fish.references.push(...structuredClone(voice.sources.fish.references))
  const after=request()
  assert.deepEqual(after.sections,before.sections)
  assert.deepEqual(after.system,before.system)
  assert.deepEqual(after.tools,before.tools)
  assert.equal(after.inputBytes,before.inputBytes)
  assert.equal(after.estimatedTokens,before.estimatedTokens)
})

// private fork (stage panel r7): the combined 「人物差分 · 通用差分人物」 entry carries the packs of the figures it lists, so the
// 提示词 scope column names them (it used to look up the pack 'common-roster' and show 缺失的素材包).
test('the combined 通用差分人物 injection names the packs of its figures', async () => {
  const {pack,raw,engine} = await fixture(), figure = pack.figures[FIGURE_ID], otherId = '44444444-4444-4444-8444-444444444444'
  pack.manifest.figures.push(otherId); pack.figures[otherId] = {...structuredClone(figure), id:otherId, name:'Other', aliases:['other'], appearance:'avatar'}
  const parts = bubbleInjection(cardBubbleConfig(raw,engine,[pack])), roster = parts.find(part => part.figure === 'common-roster')
  assert.ok(roster, 'figures without extra 差分 share one entry')
  assert.deepEqual(roster.packs, [pack.manifest.id])
  assert.equal(roster.name, '说话人名单') // private fork
  assert.match(roster.text, /^<speaker_roster>\nEach entry is/) // private fork
  assert.ok(parts.filter(part => part.figure !== 'common-roster').every(part => !Object.hasOwn(part, 'packs')))
})
