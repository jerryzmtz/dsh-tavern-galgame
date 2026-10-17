// private fork: tagged English defaults; retain protocol, payload, cache and budget assertions.
// private fork: body-only compact variant rendering; all identities and source guidance stay untouched.
import test from 'node:test'
import assert from 'node:assert/strict'
import {bubbleInjection, bubbleInstruction} from '../tavern-plugin/lib/domain/dialogue-bubbles.js'
import {DEFAULT_BUBBLE_TEMPLATE} from '../tavern-plugin/lib/domain/dialogue-bubble-presets.js'
import {cardBubbleConfig} from '../tavern-plugin/lib/fork-card-stage.js'
import {defaultAssetEngineSettings} from '../tavern-plugin/lib/domain/asset-engine-settings.js'
import {syntheticPack, cardExtension, FIGURE_ID} from './fixtures/asset-packs/pack.mjs'

// private fork: historical rows are explicit fixture declarations.
const labels={calm:'平和',crying:'哭泣'}
const character = (alias, ids, emotions = ids.map(id=>({id,label:labels[id]||id}))) => ({alias:'f_'+alias, name:alias.toUpperCase(), ref:{packId:'pack',figureId:'figure-'+alias}, aliases:[], recall:{mode:'constant'}, promptEmotionIds:ids, emotions})
test('identical sets share one line in first-figure order; calm-only and single customs stay exact', () => {
  const config = {enabled:true,characters:[character('a',['calm','crying']),character('b',['calm']),character('c',['calm','crying']),character('d',['walk'],[{id:'walk',label:'行走',guidance:'用于行走的表情或动作。'}])]}
  const original=structuredClone(config), parts=bubbleInjection(config)
  assert.equal(parts.length,2)
  assert.deepEqual(parts[1].packs,['pack'])
  assert.deepEqual(parts[1].text.split('\n').slice(2,-1), ['- A (a)、C (c): 平和、哭泣','- B (b): 平和','- D (d): 行走'])
  assert.doesNotMatch(parts.map(p=>p.text).join('\n'),/通用差分|用于行走/)
  assert.deepEqual(config,original)
})
test('declaration order is retained and authored notes stay scoped', () => {
  const config={enabled:true,characters:[character('a',['walk','stand'],[{id:'walk',label:'行走',guidance:'只在离场时'},{id:'stand',label:'站立',guidance:'用于站立的动作。'}]),character('b',['standing','walking'],[{id:'standing',label:'站立'},{id:'walking',label:'行走'}])]}
  assert.deepEqual(bubbleInjection(config)[1].text.split('\n').slice(2,-1), ['- A (a): 行走（只在离场时）、站立','- B (b): 站立、行走'])
})
test('custom literal instructions are never rewritten when the generated placeholder goes away', () => {
  const template=DEFAULT_BUBBLE_TEMPLATE+'\n通用差分：作者保留的正文。'
  const config={enabled:true,injection:{template},characters:[character('a',['calm'])]}
  assert.match(bubbleInstruction(config),/通用差分：作者保留的正文。\n<\/dialogue_format>$/)
  assert.equal(config.injection.template,template)
})
test('character declarations remain available even when this outfit lacks their art', async () => {
  const pack=await syntheticPack(),figure=pack.figures[FIGURE_ID]
  figure.appearance='sprite'
  figure.outfits=figure.outfits.slice(0,1)
  pack.sprites.school.emotions={calm:pack.sprites.school.emotions.calm}
  const raw={extensions:{dsh_tavern:{...cardExtension(),stage:{}}}},before=structuredClone(pack)
  const config=cardBubbleConfig(raw,defaultAssetEngineSettings(),[pack])
  assert.deepEqual(config.characters[0].promptEmotionIds,figure.emotions.map(row=>row.id))
  assert.equal(config.moods.length,0) // private fork: no global vocabulary
  for(const row of figure.emotions)assert.ok(bubbleInjection(config)[1].text.includes(row.label))
  assert.deepEqual(structuredClone(pack),before)
})
