// private fork: validate retired fields at import/write, not on persisted reads.
// private fork: v3.1 rejects card cast; appearance belongs to figures, never a runtime migration.
import test from 'node:test'
import assert from 'node:assert/strict'
import { cardExtension, syntheticPack, FIGURE_ID } from './fixtures/asset-packs/pack.mjs'
import { validateCardAssetExtension, readCardAssetExtension, cardAssetRawOperations } from '../tavern-plugin/lib/domain/card-asset-bindings.js'
import { validateFigure } from '../tavern-plugin/packages/dsh-asset-library/src/asset-packs/figure.js'
import { createCardPreparation } from '../tavern-plugin/lib/domain/card-preparation.js'

const unknown = error => error.code === 'UNKNOWN_FIELD'
const raw = extension => ({name:'Cast', extensions:{dsh_tavern:extension}})
const source = (await syntheticPack()).figures[FIGURE_ID]

test('figure accepts all three explicit appearances without creating a card override', () => {
  for (const appearance of ['live2d', 'sprite', 'avatar']) {
    const figure={...structuredClone(source),appearance},before=structuredClone(figure),extension=cardExtension()
    assert.equal(validateFigure(figure),figure)
    assert.deepEqual(figure,before)
    assert.deepEqual(readCardAssetExtension(raw(extension)),extension)
    assert.equal(Object.hasOwn(extension,'characters'),false)
    assert.throws(()=>validateCardAssetExtension({...extension,characters:{actor:{appearance}}}),unknown)
  }
})

test('figure appearance is required, case sensitive and never inferred from obsolete fields', () => {
  for (const appearance of [undefined, null, '', 'auto', 'Live2D', false, {}, 1]) {
    const figure=structuredClone(source)
    if(appearance===undefined)delete figure.appearance
    else figure.appearance=appearance
    assert.throws(()=>validateFigure(figure))
    assert.throws(()=>cardAssetRawOperations({name:'New'},{characters:{actor:{appearance:appearance??null}}}))
  }
})

test('removed character overrides fail both import validation and direct preparation edits', () => {
  const preparation=createCardPreparation(),workspace=preparation.create({kind:'import',payload:raw(cardExtension())})
  for(const key of ['name','speakerNames','appearance','note','color','offstage','voiceEnabled','voiceLanguage','voice','emotions']) {
    const extension={...cardExtension(),characters:{actor:{[key]:null}}}
    assert.throws(()=>validateCardAssetExtension(extension),unknown,key)
    assert.throws(()=>preparation.update({kind:'card',card:workspace,
      rawOperations:[{op:'set',path:'/extensions/dsh_tavern/characters',value:extension.characters}]}),unknown,key)
  }
})

test('removed card emotions fail even when empty while unrelated opaque fields survive', () => {
  for(const emotions of [[],null,[{id:'smug',label:'Smug'}]]) {
    assert.throws(()=>validateCardAssetExtension({...cardExtension(),emotions}),unknown)
    assert.throws(()=>cardAssetRawOperations(raw(cardExtension()),{emotions}),unknown)
    assert.throws(()=>cardAssetRawOperations(raw({...cardExtension(),emotions}),{stage:{}}),unknown)
  }
  const extension={...cardExtension(),futurePreparation:{opaque:true}}
  assert.deepEqual(readCardAssetExtension(raw(extension)),extension)
})

test('even empty or null card cast tables are rejected; packages remain independently selectable', () => {
  for(const characters of [{},null,{actor:{figure:null}}]) {
    const extension=cardExtension()
    assert.throws(()=>validateCardAssetExtension({...extension,characters}),unknown)
    assert.throws(()=>validateCardAssetExtension({...extension,assetBindings:{...extension.assetBindings,characters}}),unknown)
  }
  const extension=cardExtension();extension.assetBindings.boundPackIds=[]
  assert.equal(validateCardAssetExtension(extension),extension)
})
