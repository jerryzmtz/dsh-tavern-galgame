// private fork (导入模型): the import sheet's Live2D reader and mapping core, no network or live writes.
import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import {readFile} from 'node:fs/promises'
const source=await readFile(new URL('../tavern-plugin/src/client/fork-asset-pack-import-ui.js',import.meta.url),'utf8')
const context={Uint8Array,TextDecoder,TextEncoder,JSON,Error}
vm.runInNewContext(source.slice(source.indexOf('// begin model-import-core'),source.indexOf('// end model-import-core'))+';this.core={modelKindOf,prepareLive2dEntries,live2dPrefill,live2dImportResult,live2dRef}',context)
const {core}=context
const plain=value=>JSON.parse(JSON.stringify(value))
const bytes=value=>Uint8Array.from(Buffer.from(value))
const entry=(path,value='x')=>({path,read:async()=>bytes(value)})
const doc={Version:3,FileReferences:{Moc:'body.moc3',Textures:['tex/body.png'],Expressions:[{Name:'smile',File:'exp/smile.exp3.json'}],Motions:{Idle:[{File:'idle.motion3.json',Sound:'voice.wav'}]}}}
const entries=(model=doc)=>[entry('folder/nested/body.model3.json',JSON.stringify(model)),entry('folder/nested/body.moc3','MOC3\u0003rest'),
  ...['tex/body.png','exp/smile.exp3.json','idle.motion3.json','voice.wav'].map(name=>entry('folder/nested/'+name)),entry('folder/unrelated.exe'),entry('__MACOSX/folder/._body.moc3')]

test('a nested model imports only its own closure, rebased to the model3.json',async()=>{
  assert.equal(core.modelKindOf(entries()),'live2d')
  const prepared=await core.prepareLive2dEntries(entries())
  assert.deepEqual(plain(prepared.descriptor),{kind:'live2d',entry:'body.model3.json'})
  assert.deepEqual([...prepared.files.keys()].sort(),['body.moc3','body.model3.json','exp/smile.exp3.json','idle.motion3.json','tex/body.png','voice.wav'])
  // pixi-live2d-display's saved `url` (the model3.json's own path) would be a self-reference on the stage.
  const saved=await core.prepareLive2dEntries(entries({url:'body.model3.json',...doc}))
  assert.equal('url' in saved.document,false);assert.equal('url' in JSON.parse(new TextDecoder().decode(saved.files.get('body.model3.json'))),false)
})
test('unsupported or incomplete models are refused in Chinese before upload',async()=>{
  const fails=async(list,pattern)=>assert.rejects(core.prepareLive2dEntries(list),error=>pattern.test(error.message))
  await fails(entries().filter(e=>!e.path.endsWith('voice.wav')),/缺少模型文件：voice\.wav/)
  await fails([...entries(),entry('folder/other.model3.json',JSON.stringify(doc))],/多个 model3\.json/)
  await fails(entries({...doc,FileReferences:{...doc.FileReferences,Moc:'../body.moc3'}}),/路径不受支持/)
  await fails(entries().map(e=>e.path.endsWith('.moc3')?entry(e.path,'MOC2'):e),/不是 Cubism 3/)
  assert.throws(()=>core.modelKindOf([entry('old/model.json','{}'),entry('old/body.moc')]),/Cubism 2/)
  assert.throws(()=>core.modelKindOf([entry('pics/a.png')]),/没有找到模型/)
})
test('prefill uses names the model declares that exactly equal an emotion key',()=>{
  const model={FileReferences:{Expressions:[{Name:'joy'},{Name:'Smile'},{Name:'sad_01'}],Motions:{Idle:[{File:'i.motion3.json'}],anger:[{File:'a.motion3.json'}],Mood_sad:[{File:'s.motion3.json'}]}}}
  const rows=[{id:'joy',label:'喜悦'},{id:'anger',label:'愤怒'},{id:'sad',label:'悲伤'},{id:'calm',label:'平和'}]
  assert.deepEqual(plain(core.live2dPrefill(model,rows)),{idle:core.live2dRef('Idle'),map:{joy:{expression:'joy'},anger:{motion:core.live2dRef('anger')}}})
})
test('a model without Idle gets one from the chosen clip; one clip of a group becomes its own group',()=>{
  const clips=['m0','m1','m2'].map(n=>({File:n+'.motion3.json',FadeInTime:0.4}))
  const model={Version:3,FileReferences:{Moc:'b.moc3',Textures:['t.png'],Motions:{Motion:clips}}}
  const made=core.live2dImportResult(model,{idle:core.live2dRef('Motion',0),map:{joy:{motion:core.live2dRef('Motion',2),expression:'smile'},anger:{motion:core.live2dRef('Motion')}}})
  assert.equal(made.changed,true)
  assert.deepEqual(plain(made.document.FileReferences.Motions),{Motion:clips,Idle:[clips[0]],Mood_joy:[clips[2]]})
  assert.deepEqual(plain(made.emotionMap),{joy:{expression:'smile',motion:'Mood_joy'},anger:{motion:'Motion'}})
  assert.equal(model.FileReferences.Motions.Idle,undefined)
  const own={...model,FileReferences:{...model.FileReferences,Motions:{Idle:clips}}},kept=core.live2dImportResult(own,{idle:core.live2dRef('Idle'),map:{}})
  assert.equal(kept.changed,false);assert.equal(kept.document,own)
})
