// private fork: ownership schema groundwork, independent of the still-pending card/editor cutover.
import test from 'node:test'
import assert from 'node:assert/strict'
import {validateFigureEmotions,figureEmotionRows,validateFigure} from '../tavern-plugin/packages/dsh-asset-library/src/asset-packs/index.js'
import {syntheticPack,FIGURE_ID} from './fixtures/asset-packs/pack.mjs'
import {defaultAssetEngineSettings,validateAssetEngineSettings,patchAssetEngineSettings} from '../tavern-plugin/lib/domain/asset-engine-settings.js'

// private fork: no compatibility reader for the removed figure/engine display preferences.
test('appearance is exclusively a cast field, never an engine or figure preference',async()=>{
  const figure=(await syntheticPack()).figures[FIGURE_ID]
  for(const stageForm of ['auto','live2d','sprite',null])assert.throws(()=>validateFigure({...figure,stageForm}),{code:'UNKNOWN_FIELD'})
  const settings=defaultAssetEngineSettings()
  assert.equal(Object.hasOwn(settings,'defaultStageForm'),false)
  assert.deepEqual(validateAssetEngineSettings(settings),settings)
  for(const defaultStageForm of ['auto','live2d','sprite',null]){
    assert.throws(()=>validateAssetEngineSettings({...settings,defaultStageForm}),{code:'UNKNOWN_FIELD'})
    assert.throws(()=>patchAssetEngineSettings(settings,{defaultStageForm}),{code:'UNKNOWN_FIELD'})
  }
})

// private fork: no virtual slots and no global reserved vocabulary.
test('empty figures declare no variants and all names are ordinary data',()=>{
 assert.deepEqual(figureEmotionRows(),[]);
 assert.deepEqual(figureEmotionRows({emotions:[]}),[]);
 assert.deepEqual(validateFigureEmotions([{id:'e-123',label:'喜悦'}]),[{id:'e-123',label:'喜悦'}]);
});
// private fork: order and behavior metadata are authored, not inferred from IDs.
test('figure persists explicit labels and guidance without mutating author data',async()=>{
 const figure=(await syntheticPack()).figures[FIGURE_ID];figure.imageColor='#CF7649';
 figure.emotions=[{id:'joy',label:'微笑',guidance:'克制地表达喜悦'},{id:'smug',label:'得意',guidance:'略带炫耀'}];
 for(const outfit of figure.outfits)if(!figure.emotions.some(row=>row.id===outfit.defaultEmotion))delete outfit.defaultEmotion; // private fork
 const before=structuredClone(figure);assert.equal(validateFigure(figure),figure);
 const rows=figureEmotionRows(figure);assert.equal(rows.length,2);assert.equal(rows[0].id,'joy');
 assert.equal(rows[0].guidance,'克制地表达喜悦');assert.equal(rows[1].id,'smug');
 rows[0].label='caller edit';assert.deepEqual(figure,before);
 assert.equal(figureEmotionRows(figure).some(row=>row.id==='crying'),false);
});

test('figure color accepts six-digit hex only and remains optional for first import',async()=>{
  const figure=(await syntheticPack()).figures[FIGURE_ID]
  validateFigure(figure)
  // private fork: both manual and derived fields use exactly the same portable hex shape.
  for(const field of ['imageColor','autoColor']){
    for(const value of ['#000000','#FFFFFF','#a0B1c2'])validateFigure({...figure,[field]:value})
    for(const value of ['','#fff','red','#12345678','123456',null,12])assert.throws(()=>validateFigure({...figure,[field]:value}))
  }
})

// private fork: explicit aliases and optional behavior metadata replace legacy semantics.
test('labels may change and undeclared legacy field names remain invalid',()=>{
 validateFigureEmotions([{id:'calm',label:'Other',words:'quiet',guidance:''},{id:'joy',label:'开心',guidance:'字'.repeat(60)}]);
 assert.throws(()=>validateFigureEmotions([{id:'joy',label:'开心',note:'old'}]),{code:'UNKNOWN_FIELD'});
 assert.throws(()=>validateFigureEmotions([{id:'joy',label:'开心',guidance:'字'.repeat(61)}]));
});
// private fork: collision checks apply only to the supplied declarations.
test('ordinary variants have bounded unambiguous IDs and labels',()=>{
 validateFigureEmotions(Array.from({length:9},(_,i)=>({id:'e_'+i,label:'差分'+i})));
 for(const row of [{id:'smug',label:'smug'},{id:'default',label:'默认'},{id:'smug',label:'JOY'},{id:'smug',label:'平和'}])validateFigureEmotions([row]);
 for(const rows of [[{id:'smug',label:' '}],[{id:'smug',label:' 得意'}],[{id:'smug',label:'一二三四五六七'}],[{id:'Smug',label:'得意'}],[{id:'a'.repeat(25),label:'得意'}],[{id:'smug',label:'得意'},{id:'proud',label:'得意'}],[{id:'smug',label:'proud'},{id:'proud',label:'得意'}],[{id:'smug',label:''}],[{id:'smug'},{id:'proud',label:'得意'}],[{id:'smug'},{id:'proud'}]])assert.throws(()=>validateFigureEmotions(rows));
 // private fork: a sole unlabelled {id} is an image identity, not an ordinary variant; mixed or annotated unlabelled entries stay invalid.
 const image=[{id:'smug'}];assert.deepEqual(validateFigureEmotions(image),image);
 assert.deepEqual(figureEmotionRows({emotions:image}),[]);
 for(const field of ['guidance','voiceEmotion','words','oldLabel'])assert.throws(()=>validateFigureEmotions([{id:'smug',[field]:'old'}]),{code:'UNKNOWN_FIELD'});
});
